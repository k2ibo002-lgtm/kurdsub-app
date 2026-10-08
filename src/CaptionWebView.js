import React, { useRef, useEffect } from "react";
import { WebView } from "react-native-webview";

// VISIBLE WebView that loads YouTube's OFFICIAL embed player and captures the
// caption file it downloads. The official player mints its own PO tokens and
// passes YouTube's bot checks, so this works where anonymous API requests
// get empty responses.
//
// v3.5: the WebView is VISIBLE (iOS throttles invisible WebViews, which broke v3.4).
// Triple-redundant capture:
//   1. Hook fetch/XHR -> capture timedtext response BODY.
//   2. Poll performance entries -> capture timedtext/get_transcript URLS,
//      then the app fetches the URL directly (it carries valid tokens).
//   3. Capture the InnerTube player response -> extract captionTracks baseUrls.
//
// Props: videoId, onCaptions({body, via}), onError(code, details)
export default function CaptionWebView({ videoId, onCaptions, onError }) {
  const done = useRef(false);
  const timer = useRef(null);
  const seen = useRef({ urls: [] });

  useEffect(() => {
    timer.current = setTimeout(() => {
      if (!done.current) {
        done.current = true;
        onError("webview_timeout", "urls_seen:" + seen.current.urls.length);
      }
    }, 45000);
    return () => clearTimeout(timer.current);
  }, [videoId]);

  const finish = (ok, arg, extra) => {
    if (done.current) return;
    done.current = true;
    clearTimeout(timer.current);
    if (ok) onCaptions(arg);
    else onError(arg, extra);
  };

  const injected = `
(function() {
  var sent = false;
  function post(o) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  function sendBody(text, via) {
    if (sent) return; sent = true;
    post({ t: "caps", via: via, xml: text.slice(0, 900000) });
  }
  function sendUrl(url, via) {
    post({ t: "url", via: via, url: url.slice(0, 1200) });
  }
  function isCapUrl(u) {
    return u && (u.indexOf("timedtext") !== -1 || u.indexOf("get_transcript") !== -1);
  }
  function checkBody(url, text) {
    if (!isCapUrl(url) || !text) return;
    if (text.indexOf("<transcript") !== -1 || text.indexOf('"events"') !== -1) {
      sendBody(text, "hook");
    }
  }
  function checkPlayerResponse(text) {
    if (!text || text.indexOf("captionTracks") === -1) return;
    try {
      var key = '"captionTracks"';
      var ki = text.indexOf(key);
      if (ki === -1) return;
      var si = text.indexOf("[", ki + key.length);
      if (si === -1) return;
      var depth = 0, ei = si;
      for (; ei < text.length && ei < si + 20000; ei++) {
        var c = text[ei];
        if (c === "[") depth++;
        else if (c === "]") { depth--; if (depth === 0) break; }
      }
      if (depth !== 0) return;
      var tracks = JSON.parse(text.slice(si, ei + 1));
      var urls = [];
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].baseUrl) urls.push(tracks[i].baseUrl);
      }
      if (urls.length) post({ t: "trackurls", urls: urls.slice(0, 8) });
    } catch (e) {}
  }
  try {
    var ofetch = window.fetch;
    window.fetch = function(u, o) {
      var url = "";
      try { url = String((u && u.url) || u); } catch (e) {}
      var isPlayer = url.indexOf("/youtubei/v1/player") !== -1;
      return ofetch.apply(this, arguments).then(function(res) {
        if (isCapUrl(url) || isPlayer) {
          res.clone().text().then(function(t) {
            checkBody(url, t);
            if (isPlayer) checkPlayerResponse(t);
          }).catch(function() {});
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
        try {
          var u = this._u || "";
          checkBody(u, this.responseText || "");
          if (u.indexOf("/youtubei/v1/player") !== -1) checkPlayerResponse(this.responseText || "");
        } catch (e) {}
      });
      return osend.apply(this, arguments);
    };
    setInterval(function() {
      try {
        var rs = performance.getEntriesByType("resource") || [];
        for (var i = 0; i < rs.length; i++) {
          var n = rs[i].name || "";
          if (isCapUrl(n)) sendUrl(n, "perf");
        }
      } catch (e) {}
    }, 1500);
  } catch (e) {}
  post({ t: "ready" });
})();
true;
`;

  const url =
    `https://www.youtube.com/embed/${videoId}` +
    `?autoplay=1&mute=1&cc_load_policy=1&hl=en&playsinline=1&rel=0`;

  return (
    <WebView
      source={{ uri: url }}
      style={{ width: 320, height: 180, backgroundColor: "#000" }}
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
        if (msg.t === "caps") {
          finish(true, { body: msg.xml, via: msg.via || "hook" });
        } else if (msg.t === "url") {
          if (seen.current.urls.indexOf(msg.url) === -1) {
            seen.current.urls.push(msg.url);
          }
          // Fallback: fetch the captured URL directly from the app.
          fetch(msg.url)
            .then((r) => r.text())
            .then((text) => {
              if (
                text.indexOf("<transcript") !== -1 ||
                text.indexOf('"events"') !== -1
              ) {
                finish(true, { body: text, via: "urlfetch" });
              }
            })
            .catch(() => {});
        } else if (msg.t === "trackurls") {
          (msg.urls || []).forEach((u) => {
            fetch(u)
              .then((r) => r.text())
              .then((text) => {
                if (
                  text &&
                  (text.indexOf("<transcript") !== -1 ||
                    text.indexOf('"events"') !== -1)
                ) {
                  finish(true, { body: text, via: "trackurl" });
                }
              })
              .catch(() => {});
          });
        }
      }}
      onError={() => finish(false, "webview_error", "webview onerror")}
      onHttpError={(e) => {
        /* keep waiting; player may recover */
      }}
    />
  );
}
