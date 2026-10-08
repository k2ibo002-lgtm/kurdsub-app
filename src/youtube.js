// On-device YouTube caption fetching via the InnerTube player API.
// No PC/server needed — the phone talks to YouTube directly.

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const PLAYER_URL = `https://youtubei.googleapis.com/youtubei/v1/player?key=${INNERTUBE_KEY}`;

/** fetch with one retry (LTE connections drop requests sometimes). */
async function rfetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1200));
    return await fetch(url, opts);
  }
}

export function extractVideoId(url) {
  const u = (url || "").trim();
  let m = u.match(/[?&]v=([\w-]{6,})/);
  if (m) return m[1];
  m = u.match(/youtu\.be\/([\w-]{6,})/);
  if (m) return m[1];
  m = u.match(/\/shorts\/([\w-]{6,})/);
  if (m) return m[1];
  m = u.match(/\/embed\/([\w-]{6,})/);
  if (m) return m[1];
  if (/^[\w-]{6,}$/.test(u)) return u;
  return null;
}

const CLIENTS = [
  // ANDROID: returns captions reliably on normal (non-datacenter) IPs.
  // NOTE: 19.09.37 is now rejected by YouTube ("Precondition check failed"),
  // so keep this version current.
  { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 },
  // WEB: fallback.
  { clientName: "WEB", clientVersion: "2.20241201" },
];

async function fetchPlayer(videoId) {
  for (const client of CLIENTS) {
    const res = await rfetch(PLAYER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, context: { client } }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const tracks =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks && tracks.length) return { data, tracks };
  }
  return null;
}

/** Extract a balanced {...} JSON object starting at index i. */
function extractBalancedJson(html, i) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return html.slice(i, j + 1);
      }
    }
  }
  return null;
}

/** Fallback: parse captions from the watch page HTML. */
async function fetchPlayerFromWatchPage(videoId) {
  const res = await rfetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const key = "ytInitialPlayerResponse";
  const ki = html.indexOf(key);
  if (ki < 0) return null;
  const bi = html.indexOf("{", ki + key.length);
  if (bi < 0) return null;
  const jsonStr = extractBalancedJson(html, bi);
  if (!jsonStr) return null;
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  const tracks =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || !tracks.length) return null;
  return { data, tracks };
}

function pickTrack(tracks) {
  if (!tracks || !tracks.length) return null;
  const score = (t) => {
    let s = 0;
    if ((t.languageCode || "").startsWith("en")) s += 10;
    if (t.kind !== "asr") s += 5; // prefer human-made captions
    return s;
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/**
 * Returns { lines: [{start, end, text}], lang, title }.
 * Throws coded errors:
 *   yt_unreachable  — YouTube itself could not be reached
 *   no_captions     — video has no captions
 *   caps_dl_failed  — caption file download failed
 */
export async function fetchCaptions(videoId) {
  let player = null;
  try {
    player = await fetchPlayer(videoId);
  } catch (e) {
    throw new Error("yt_unreachable");
  }
  if (!player) {
    try {
      player = await fetchPlayerFromWatchPage(videoId);
    } catch (e) {
      throw new Error("yt_unreachable");
    }
  }
  if (!player) throw new Error("no_captions");

  const { data, tracks } = player;
  const track = pickTrack(tracks);
  if (!track) throw new Error("no_captions");

  let xml;
  try {
    const res = await rfetch(track.baseUrl);
    if (!res.ok) throw new Error("bad");
    xml = await res.text();
  } catch (e) {
    throw new Error("caps_dl_failed");
  }

  const lines = [];
  const re = /<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const start = parseFloat(m[1]);
    const dur = m[2] ? parseFloat(m[2]) : 2.0;
    const text = decodeEntities(
      m[3].replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim()
    );
    if (text) lines.push({ start, end: start + dur, text });
  }
  if (!lines.length) throw new Error("no_captions");
  return {
    lines,
    lang: track.languageCode || "en",
    title: data?.videoDetails?.title || "",
  };
}
