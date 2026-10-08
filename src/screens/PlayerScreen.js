import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { audioUrl, dubDownloadUrl, fmt, makeDub, srtUrl } from "../api";
import { buildSrt } from "../srt";

export default function PlayerScreen({ route }) {
  const { data, backend } = route.params;
  const playerRef = useRef(null);
  const [cue, setCue] = useState(-1);
  const [mode, setMode] = useState("bi"); // bi | ku | off
  const [dubState, setDubState] = useState("idle"); // idle | working | ready | on
  const [dubError, setDubError] = useState("");
  const soundRef = useRef(null);
  const cueRef = useRef(-1);
  const dubOnRef = useRef(false);
  const listRef = useRef(null);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
    const iv = setInterval(async () => {
      try {
        if (!playerRef.current?.getCurrentTime) return;
        const t = await playerRef.current.getCurrentTime();
        const L = data.lines;
        let idx = -1;
        for (let i = 0; i < L.length; i++) {
          if (t >= L[i].start && t <= L[i].end) { idx = i; break; }
        }
        if (idx !== cueRef.current) {
          cueRef.current = idx;
          setCue(idx);
          if (idx >= 0 && dubOnRef.current) playCue(idx);
        }
      } catch {}
    }, 400);
    return () => {
      clearInterval(iv);
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (cue >= 0) {
      try { listRef.current?.scrollToIndex({ index: cue, viewPosition: 0.3 }); } catch {}
    }
  }, [cue]);

  const playCue = async (idx) => {
    try {
      if (!soundRef.current) soundRef.current = new Audio.Sound();
      const snd = soundRef.current;
      await snd.unloadAsync().catch(() => {});
      await snd.loadAsync({ uri: audioUrl(backend, data.video_id, idx) });
      await snd.playAsync();
    } catch {}
  };

  const toggleDub = async () => {
    setDubError("");
    if (dubState === "on") {
      dubOnRef.current = false;
      setDubState("ready");
      try { await playerRef.current?.unMute(); } catch {}
      try { await soundRef.current?.stopAsync(); } catch {}
      return;
    }
    if (dubState === "ready") {
      dubOnRef.current = true;
      setDubState("on");
      try { await playerRef.current?.mute(); } catch {}
      cueRef.current = -2;
      return;
    }
    // idle -> generate
    setDubState("working");
    try {
      await makeDub(backend, data.video_id);
      setDubState("ready");
      toggleDubReady();
    } catch (e) {
      setDubState("idle");
      setDubError("نەتوانرا دابینگ دروست بکرێت: " + String(e.message || e));
    }
  };

  const toggleDubReady = async () => {
    dubOnRef.current = true;
    setDubState("on");
    try { await playerRef.current?.mute(); } catch {}
    cueRef.current = -2;
  };

  const seek = async (sec) => {
    try { await playerRef.current?.seekTo(sec, true); } catch {}
  };

  const download = async (url, name) => {
    try {
      const uri = FileSystem.documentDirectory + name;
      await FileSystem.downloadAsync(url, uri);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {}
  };

  // On-device SRT (no server): build + share the .srt file directly.
  const shareSrt = async (mode) => {
    try {
      const srt = buildSrt(data.lines, mode);
      const uri =
        FileSystem.documentDirectory +
        `${data.video_id}.${mode === "both" ? "ku-bi" : "ckb"}.srt`;
      await FileSystem.writeAsStringAsync(uri, srt, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {}
  };

  const srtKu = () =>
    backend
      ? download(srtUrl(backend, data.video_id, "ku"), `${data.video_id}.ckb.srt`)
      : shareSrt("ckb");
  const srtBi = () =>
    backend
      ? download(srtUrl(backend, data.video_id, "bi"), `${data.video_id}.ku-bi.srt`)
      : shareSrt("both");

  const active = cue >= 0 ? data.lines[cue] : null;

  return (
    <View style={s.container}>
      <View style={s.playerBox}>
        <YoutubePlayer ref={playerRef} height={230} videoId={data.video_id} play={false} />
        {mode !== "off" && active && (
          <View style={s.subBox} pointerEvents="none">
            <Text style={s.subKu}>{active.ku}</Text>
            {mode === "bi" && !!active.en && <Text style={s.subEn}>{active.en}</Text>}
          </View>
        )}
      </View>

      <Text style={s.title}>{data.title_ku || data.title}</Text>
      <Text style={s.src}>
        {data.source === "whisper" ? "🎙 گوێ لە ڤیدیۆکە گیرا (ژێرنووسی ئامادەی نەبوو)"
          : data.source === "demo" ? "نموونە"
          : data.source === "youtube" ? "📱📝 ژێرنووسەکانی یووتیوب — لەسەر مۆبایل وەرگێڕدرا (بێ کۆمپیوتەر)"
          : "📝 ژێرنووسەکانی یووتیوب"}
      </Text>

      <View style={s.row}>
        {[["bi", "دووزمانە"], ["ku", "کوردی"], ["off", "ناچالاک"]].map(([m, label]) => (
          <TouchableOpacity key={m} style={[s.seg, mode === m && s.segOn]} onPress={() => setMode(m)}>
            <Text style={[s.segText, mode === m && s.segTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {backend ? (
        <TouchableOpacity style={[s.dubBtn, dubState === "on" && s.dubOff]} onPress={toggleDub} disabled={dubState === "working"}>
          {dubState === "working"
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.dubText}>
                {dubState === "on" ? "🔇 کوژاندنەوەی دابینگ" : "🔊 دابینگ بە دەنگی کوردی"}
              </Text>}
        </TouchableOpacity>
      ) : (
        <Text style={s.note}>💡 بۆ دەنگی کوردی AI: ناونیشانی سێرڤەر (کۆمپیوتەر) لە شاشەی سەرەکی بنووسە</Text>
      )}
      {!!dubError && <Text style={s.err}>{dubError}</Text>}

      <View style={s.row}>
        <TouchableOpacity style={s.mini} onPress={srtKu}>
          <Text style={s.miniText}>⬇ SRT کوردی</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.mini} onPress={srtBi}>
          <Text style={s.miniText}>⬇ SRT دووزمانە</Text>
        </TouchableOpacity>
        {backend && (dubState === "ready" || dubState === "on") && (
          <TouchableOpacity style={s.mini} onPress={() => download(dubDownloadUrl(backend, data.video_id), `${data.video_id}-dub.wav`)}>
            <Text style={s.miniText}>⬇ دەنگی دابینگ</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={data.lines}
        keyExtractor={(_, i) => String(i)}
        style={s.list}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={[s.line, index === cue && s.lineOn]}
            onPress={() => seek(item.start)}
          >
            <Text style={s.t}>{fmt(item.start)}</Text>
            <Text style={s.ku}>{item.ku}</Text>
            {!!item.en && <Text style={s.en}>{item.en}</Text>}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0e14" },
  playerBox: { backgroundColor: "#000" },
  subBox: { position: "absolute", bottom: 10, left: 16, right: 16, alignItems: "center" },
  subKu: { backgroundColor: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 19, fontWeight: "700", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, textAlign: "center", lineHeight: 30 },
  subEn: { color: "#fde68a", fontSize: 12, marginTop: 4, textAlign: "center" },
  title: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "right", paddingHorizontal: 16, marginTop: 10 },
  src: { color: "#5b6579", fontSize: 12, textAlign: "right", paddingHorizontal: 16, marginTop: 2 },
  row: { flexDirection: "row-reverse", paddingHorizontal: 16, marginTop: 10, gap: 8 },
  seg: { backgroundColor: "#121826", borderWidth: 1, borderColor: "#2a3348", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  segOn: { backgroundColor: "#1e293b", borderColor: "#22d3ee" },
  segText: { color: "#8b94a7", fontSize: 13 },
  segTextOn: { color: "#fff", fontWeight: "700" },
  dubBtn: { backgroundColor: "#7c3aed", borderRadius: 12, padding: 14, marginHorizontal: 16, marginTop: 10, alignItems: "center" },
  dubOff: { backgroundColor: "#3f3f46" },
  dubText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  note: { color: "#8b94a7", fontSize: 13, textAlign: "right", paddingHorizontal: 16, marginTop: 10, lineHeight: 20 },
  err: { color: "#fca5a5", textAlign: "right", paddingHorizontal: 16, marginTop: 6, fontSize: 13 },
  mini: { backgroundColor: "#1a2233", borderWidth: 1, borderColor: "#2a3348", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  miniText: { color: "#cbd5e1", fontSize: 13 },
  list: { flex: 1, marginTop: 10, paddingHorizontal: 12 },
  line: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#161d2c", borderRadius: 8 },
  lineOn: { backgroundColor: "#14324a" },
  t: { color: "#22d3ee", fontSize: 11 },
  ku: { color: "#e8ecf4", fontSize: 14, textAlign: "right", marginTop: 2, lineHeight: 24 },
  en: { color: "#8b94a7", fontSize: 12, textAlign: "right", marginTop: 2 },
});
