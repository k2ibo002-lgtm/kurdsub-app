import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiInfo, getSubtitles } from "../api";
import { extractVideoId, fetchCaptions, parseCaptionsBody } from "../youtube";
import { translateBatch } from "../translate";
import CaptionWebView from "../CaptionWebView";

const BACKEND_KEY = "kurdsub_backend";

export default function HomeScreen({ navigation }) {
  const [backend, setBackend] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [serverOk, setServerOk] = useState(null);
  const [error, setError] = useState("");
  const [wvJob, setWvJob] = useState(null);
  const wvJobRef = useRef(null);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(BACKEND_KEY);
      if (saved) { setBackend(saved); ping(saved); }
    })();
  }, []);

  const ping = async (b) => {
    if (!b) return;
    try { await apiInfo(b.replace(/\/$/, "")); setServerOk(true); }
    catch { setServerOk(false); }
  };

  const saveBackend = async (b) => {
    setBackend(b);
    await AsyncStorage.setItem(BACKEND_KEY, b);
  };

  // Official-player fallback: hidden WebView loads YouTube's real embed player,
  // which mints its own PO tokens and passes bot checks. We capture the
  // caption file it downloads. Resolves with the raw caption body text.
  const fetchViaWebView = (videoId) =>
    new Promise((resolve, reject) => {
      const job = { videoId, key: Date.now(), resolve, reject };
      wvJobRef.current = job;
      setWvJob(job);
    });
  const wvFinish = (ok, arg) => {
    const j = wvJobRef.current;
    wvJobRef.current = null;
    setWvJob(null);
    if (!j) return;
    if (ok) j.resolve(arg);
    else j.reject(arg);
  };

  // Standalone: fetch captions from YouTube + translate on the phone.
  // No computer needed.
  const goStandalone = async (videoId) => {
    let caps = null;
    try {
      setStatus("⏳ ژێرنووسەکان لە یووتیوبەوە دەهێنرێن...");
      caps = await fetchCaptions(videoId);
    } catch (e) {
      const m = e.message || "";
      if (m === "no_captions" || m === "caps_parse_failed" || m === "caps_dl_failed") {
        // Fall back to the official player in a hidden WebView.
        setStatus("⏳ هێنانی ژێرنووس لە پلیەری فەرمییەوە...");
        let body;
        try {
          body = await fetchViaWebView(videoId);
        } catch (we) {
          const err = new Error(we.message || "webview_error");
          err.details = "webview:" + (we.message || "error");
          throw err;
        }
        const lines = parseCaptionsBody(body);
        if (!lines.length) {
          const err = new Error("no_captions");
          err.details = "webview:0lines";
          throw err;
        }
        caps = { lines, lang: "en", title: "" };
      } else {
        throw e;
      }
    }
    setStatus(`⏳ وەرگێڕانی ${caps.lines.length} دێڕ بۆ کوردی...`);
    const kuTexts = await translateBatch(
      caps.lines.map((l) => l.text), caps.lang, "ckb"
    );
    const lines = caps.lines.map((l, i) => ({
      start: l.start,
      end: l.end,
      en: l.text,
      ku: kuTexts[i] || "",
    }));
    return {
      video_id: videoId,
      title: caps.title,
      title_ku: "",
      source: "youtube",
      lines,
    };
  };

  const go = async (demoUrl) => {
    const link = (demoUrl || url).trim();
    setError("");
    setStatus("");
    if (!link) { setError("تکایە لینکی یووتیوب دابنێ"); return; }
    const videoId = extractVideoId(link);
    if (!videoId) { setError("لینکەکە نەناسرایەوە — لینکی تەواوی یووتیوب دابنێ"); return; }
    setLoading(true);
    try {
      const base = backend.replace(/\/$/, "");
      let data, be = null;
      if (base) {
        // Full server flow: subtitles + Kurdish AI dubbing (needs the PC).
        setStatus("⏳ پەیوەندی بە سێرڤەرەوە دەکرێت...");
        data = await getSubtitles(base, link);
        await AsyncStorage.setItem(BACKEND_KEY, base);
        be = base;
      } else {
        data = await goStandalone(videoId);
      }
      navigation.navigate("Player", { data, backend: be });
    } catch (e) {
      const msg = e.message || "";
      const det = e.details ? `\n\n🔧 وردەکاری: ${e.details}` : "";
      const base =
        msg === "no_captions"
          ? "ئەم ڤیدیۆیە ژێرنووسی ئامادەی نییە — بۆ ئەم جۆرە ڤیدیۆیانە (و بۆ دەنگی AI) ناونیشانی سێرڤەر (کۆمپیوتەر) لە خوارەوە بنووسە"
          : msg === "yt_unreachable"
          ? "نەتوانرا پەیوەندی بە یووتیوبەوە بکرێت — هێڵی ئینتەرنێتەکە بپشکنە و دووبارە تاقیبکەرەوە"
          : msg === "caps_dl_failed"
          ? "ژێرنووسەکان دۆزرانەوە بەڵام دابەزینیان سەرکەوتوو نەبوو — دووبارە تاقیبکەرەوە"
          : msg === "caps_parse_failed"
          ? "ژێرنووسەکان دۆزرانەوە بەڵام خوێندنەوەیان سەرکەوتوو نەبوو — وێنەی ئەمە بگرە و بینێرە"
          : msg === "webview_timeout" || msg === "webview_error"
          ? "پلیەری فەرمی وەڵامی نەدایەوە — دڵنیابە ڤیدیۆکە گشتییە و دووبارە تاقیبکەرەوە"
          : msg === "tr_failed"
          ? "نەتوانرا پەیوەندی بە خزمەتی وەرگێڕانەوە بکرێت — هێڵی ئینتەرنێت بپشکنە و دووبارە تاقیبکەرەوە"
          : msg === "no-server"
          ? "نەتوانرا پەیوەندی بە سێرڤەرەوە بکرێت — دڵنیابە run.bat لەسەر کۆمپیوتەرەکە کار دەکات و هەمان وایفاین"
          : `هەڵە: ${String(msg || e)}`;
      setError(base + det);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Text style={s.logo}>کوردسەب</Text>
      <Text style={s.tag}>هەموو ڤیدیۆیەکی یووتیوب بە کوردی — بێ کۆمپیوتەر، تەنها بە مۆبایل 📱</Text>

      <Text style={[s.label, { marginTop: 6 }]}>لینکی یووتیوب</Text>
      <TextInput
        style={[s.input, { textAlign: "left" }]} value={url} onChangeText={setUrl}
        placeholder="https://www.youtube.com/watch?v=..." placeholderTextColor="#5b6579"
        autoCapitalize="none" keyboardType="url"
      />

      {error ? <Text style={s.err}>{error}</Text> : null}
      {!!status && <Text style={s.status}>{status}</Text>}

      <TouchableOpacity style={s.btn} onPress={() => go()} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>وەریبگێڕە بۆ کوردی 🎬</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.ghost]} onPress={() => go("https://www.youtube.com/watch?v=evxnkVV2SkU")} disabled={loading}>
        <Text style={[s.btnText, { color: "#cbd5e1" }]}>نموونە ببینە</Text>
      </TouchableOpacity>

      <Text style={s.section}>🔊 دەنگی AI (ئیختیاری)</Text>
      <Text style={s.hint}>
        ژێرنووس بەبێ کۆمپیوتەر کاردەکات. تەنها بۆ دەنگی کوردی AI ناونیشانی سێرڤەر بنووسە:
      </Text>
      <TextInput
        style={[s.input, { textAlign: "left", marginTop: 8 }]} value={backend}
        onChangeText={(t) => { saveBackend(t); setServerOk(null); }}
        onBlur={() => ping(backend.replace(/\/$/, ""))}
        placeholder="http://192.168.1.5:5000" placeholderTextColor="#5b6579"
        autoCapitalize="none" keyboardType="url"
      />
      {serverOk === true && <Text style={s.ok}>✅ پەیوەندی بە سێرڤەرەوە هەیە — دەنگی AI چالاکە</Text>}
      {serverOk === false && <Text style={s.warn}>⚠️ سێرڤەر نەدۆزرایەوە — run.bat کار بکە لەسەر کۆمپیوتەرەکە</Text>}

      <Text style={s.credit}>وەرگێڕان: Google • دەنگی AI: Vekol-TTS (Sorani) لەلایەن Revge — CC-BY-NC 4.0</Text>

      {wvJob && (
        <CaptionWebView
          key={wvJob.key}
          videoId={wvJob.videoId}
          onCaptions={(xml) => wvFinish(true, xml)}
          onError={(code) => wvFinish(false, new Error(code))}
        />
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 24, paddingBottom: 60 },
  logo: { fontSize: 42, fontWeight: "800", color: "#4ade80", textAlign: "center", marginTop: 30 },
  tag: { color: "#8b94a7", textAlign: "center", marginTop: 8, marginBottom: 24, lineHeight: 22 },
  label: { color: "#cbd5e1", fontWeight: "700", marginBottom: 8, textAlign: "right" },
  input: { backgroundColor: "#121826", borderColor: "#2a3348", borderWidth: 1, borderRadius: 12, color: "#fff", padding: 14, fontSize: 15, marginBottom: 6 },
  ok: { color: "#4ade80", textAlign: "right", marginBottom: 4 },
  warn: { color: "#fbbf24", textAlign: "right", marginBottom: 4, lineHeight: 20 },
  err: { color: "#fca5a5", backgroundColor: "#3b1215", padding: 12, borderRadius: 10, marginTop: 12, textAlign: "right", lineHeight: 22 },
  status: { color: "#22d3ee", textAlign: "center", marginTop: 12, lineHeight: 22 },
  btn: { backgroundColor: "#16a34a", borderRadius: 12, padding: 16, marginTop: 16, alignItems: "center" },
  ghost: { backgroundColor: "#1a2233", borderWidth: 1, borderColor: "#2a3348" },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  section: { color: "#fff", fontWeight: "800", fontSize: 16, textAlign: "right", marginTop: 30 },
  hint: { color: "#5b6579", fontSize: 13, textAlign: "right", marginTop: 8, lineHeight: 22 },
  credit: { color: "#3f4756", fontSize: 11, textAlign: "center", marginTop: 24 },
});
