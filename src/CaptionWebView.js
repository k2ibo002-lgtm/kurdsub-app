import React, { useRef, useEffect } from "react";
import { WebView } from "react-native-webview";

// Hidden WebView that loads YouTube's OFFICIAL embed player and captures the
// caption file it downloads. The official player mints its own PO tokens and
// passes YouTube's bot checks, so this works where anonymous API requests
// get empty responses.
//
// Props: videoId, onCaptions(xmlText), onError(code)
export default function CaptionWebView({ videoId, onCaptions, onError }) {
  const done = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    timer.current = setTimeout(() => {
      if (!done.current) {
        done.current = true;
        onError("webview_timeout");
      }
    }, 30000);
    return () => clearTimeout(timer.current);
  }, [videoId]);

  const injected = `
(function() {
  var sent = false;
  function send(text) {
    if (sent) return; sent = true;
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ t: "caps", xml: text.slice(0, 900000) }));
    } catch (e) {}
  }
  function check(url, text) {
    if (sent || !url || url.indexOf("timedtext") === -1 || !text) return;
    if (text.indexOf("<transcript") !== -1 || text.indexOf('"events"') !== -1) send(text);
  }
  try {
    var ofetch = window.fetch;
    window.fetch = function(u, o) {
      var url = "";
      try { url = String((u && u.url) || u); } catch (e) {}
      return ofetch.apply(this, arguments).then(function(res) {
        if (url.indexOf("timedtext") !== -1) {
          res.clone().text().then(function(t) { check(url, t); }).catch(function() {});
        }
        return res;
      });
    };
    var oopen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u) {
      try { this._u = String(u); } catch (e) {}
      return oopen.apply(this, arguments);
    };
    var osend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener("load", function() {
        try { check(this._u || "", this.responseText || ""); } catch (e) {}
      });
      return osend.apply(this, arguments);
    };
  } catch (e) {}
  try { window.ReactNativeWebView.postMessage(JSON.stringify({ t: "ready" })); } catch (e) {}
})();
true;
`;

  const url =
    `https://www.youtube.com/embed/${videoId}` +
    `?autoplay=1&mute=1&cc_load_policy=1&hl=en&playsinline=1&rel=0`;

  return (
    <WebView
      source={{ uri: url }}
      style={{ width: 2, height: 2, opacity: 0, position: "absolute" }}
      injectedJavaScriptBeforeContentLoaded={injected}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback={true}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      onMessage={(e) => {
        let msg;
        try {
          msg = JSON.parse(e.nativeEvent.data);
        } catch {
          return;
        }
        if (msg.t === "caps" && !done.current) {
          done.current = true;
          clearTimeout(timer.current);
          onCaptions(msg.xml);
        }
      }}
      onError={() => {
        if (!done.current) {
          done.current = true;
          clearTimeout(timer.current);
          onError("webview_error");
        }
      }}
    />
  );
}
