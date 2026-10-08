// On-device YouTube caption fetching — no PC/server needed.
// Tries, in order:
//   1. InnerTube player API (ANDROID / IOS / WEB clients)
//   2. Legacy timedtext endpoint (no API key, no InnerTube)
//   3. Watch-page HTML fallback
// Throws coded errors: yt_unreachable, no_captions, caps_dl_failed,
// caps_parse_failed. Each error carries e.details — a short diagnostic trail
// shown in the UI so failures can be diagnosed from a screenshot.

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const PLAYER_URL = `https://youtubei.googleapis.com/youtubei/v1/player?key=${INNERTUBE_KEY}`;

let diag = [];
let anyHttp = false;
function dlog(s) {
  diag.push(s);
  if (diag.length > 24) diag.shift();
}
function derr(code) {
  const e = new Error(code);
  e.details = diag.join(" · ");
  return e;
}

/** fetch with one retry (LTE connections drop requests sometimes). */
async function rfetch(url, opts) {
  try {
    const r = await fetch(url, opts);
    anyHttp = true;
    return r;
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1200));
    const r = await fetch(url, opts);
    anyHttp = true;
    return r;
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
  // NOTE: keep versions current — YouTube rejects outdated client versions
  // with 400 "Precondition check failed" (19.09.37 died ~Oct 2026).
  { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 },
  // IOS: same client family as the iPhone YouTube app itself.
  { clientName: "IOS", clientVersion: "20.10.38" },
  // WEB: fallback (can be served bot-check responses without captions).
  { clientName: "WEB", clientVersion: "2.20241201" },
];

async function fetchPlayer(videoId) {
  for (const client of CLIENTS) {
    const tag = client.clientName.toLowerCase();
    let res;
    try {
      res = await rfetch(PLAYER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, context: { client } }),
      });
    } catch (e) {
      dlog(`${tag}:neterr`);
      continue;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      dlog(`${tag}:${res.status}/badjson`);
      continue;
    }
    const pb = (data && data.playabilityStatus && data.playabilityStatus.status) || "?";
    const tracks =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const n = tracks && tracks.length ? tracks.length : 0;
    const langs = n
      ? tracks.map((t) => t.languageCode + (t.kind === "asr" ? "(asr)" : "")).join(",")
      : "-";
    dlog(`${tag}:${res.status}/pb=${pb}/t=${n}/${langs}`);
    if (n) return { data, tracks };
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
  let res;
  try {
    res = await rfetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    });
  } catch (e) {
    dlog("watch:neterr");
    return null;
  }
  dlog(`watch:${res.status}`);
  if (!res.ok) return null;
  const html = await res.text();
  const key = "ytInitialPlayerResponse";
  const ki = html.indexOf(key);
  dlog(`watch:ytpr=${ki >= 0 ? "yes" : "no"}`);
  if (ki < 0) return null;
  const bi = html.indexOf("{", ki + key.length);
  if (bi < 0) return null;
  const jsonStr = extractBalancedJson(html, bi);
  if (!jsonStr) return null;
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    dlog("watch:badjson");
    return null;
  }
  const tracks =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  const n = tracks && tracks.length ? tracks.length : 0;
  dlog(`watch:t=${n}`);
  if (!n) return null;
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

/** Parse YouTube timedtext XML (<transcript><text start=.. dur=..>..</text>). */
export function parseTimedtextXml(xml) {
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
  return lines;
}

/** Parse YouTube json3 captions ({"events":[{"tStartMs","dDurationMs","segs":[{"utf8"}]}]}). */
export function parseJson3(json) {
  const lines = [];
  let d;
  try {
    d = JSON.parse(json);
  } catch {
    return lines;
  }
  for (const ev of d.events || []) {
    const text = decodeEntities(
      (ev.segs || [])
        .map((s) => s.utf8 || "")
        .join("")
        .replace(/\n/g, " ")
        .trim()
    );
    if (!text) continue;
    const start = (ev.tStartMs || 0) / 1000;
    const dur = (ev.dDurationMs || 2000) / 1000;
    lines.push({ start, end: start + dur, text });
  }
  return lines;
}

/**
 * Parse a captured caption body (XML or json3) into lines.
 * Returns [] when the format is not recognized.
 */
export function parseCaptionsBody(body) {
  if (!body) return [];
  if (body.indexOf("<transcript") !== -1) return parseTimedtextXml(body);
  if (body.indexOf('"events"') !== -1) return parseJson3(body);
  return [];
}

/**
 * Legacy timedtext endpoint — needs no API key and no InnerTube player call.
 * Often still serves captions when the player API is degraded.
 */
async function fetchLegacy(videoId) {
  const dl = async (lang, kind) => {
    const u =
      `https://video.google.com/timedtext?v=${videoId}&lang=${lang}` +
      (kind === "asr" ? "&kind=asr" : "");
    const res = await rfetch(u);
    dlog(`legacy:${lang}${kind === "asr" ? "(asr)" : ""}=${res.status}`);
    if (!res.ok) return null;
    const lines = parseTimedtextXml(await res.text());
    dlog(`legacy:lines=${lines.length}`);
    return lines.length ? { lines, lang, title: "" } : null;
  };
  try {
    // First ask which tracks exist.
    try {
      const lr = await rfetch(
        `https://video.google.com/timedtext?v=${videoId}&type=list`
      );
      dlog(`legacy-list:${lr.status}`);
      if (lr.ok) {
        const xml = await lr.text();
        const found = [];
        const re = /<track\b([^>]*)\/>/g;
        let m;
        while ((m = re.exec(xml)) !== null) {
          const attrs = m[1];
          const lc = (attrs.match(/lang_code="([^"]+)"/) || [])[1];
          const kind = (attrs.match(/kind="([^"]+)"/) || [])[1] || "manual";
          if (lc) found.push({ lc, kind });
        }
        dlog(
          `legacy-tracks:${found.map((t) => t.lc + (t.kind === "asr" ? "(asr)" : "")).join(",") || "none"}`
        );
        found.sort((a, b) => {
          const ae = a.lc.startsWith("en") ? 1 : 0;
          const be = b.lc.startsWith("en") ? 1 : 0;
          if (ae !== be) return be - ae;
          return (a.kind === "asr" ? 1 : 0) - (b.kind === "asr" ? 1 : 0);
        });
        for (const t of found.slice(0, 3)) {
          const r = await dl(t.lc, t.kind);
          if (r) return r;
        }
        if (found.length) return null;
      }
    } catch (e) {
      dlog("legacy-list:err");
    }
    // Blind attempts if the list call failed.
    return (await dl("en", "manual")) || (await dl("en", "asr"));
  } catch (e) {
    dlog("legacy:err");
    return null;
  }
}

/** Download + parse the chosen InnerTube track. Throws on failure. */
async function resolvePlayer(player) {
  const { data, tracks } = player;
  const track = pickTrack(tracks);
  dlog(`pick:${track ? track.languageCode + "/" + (track.kind || "manual") : "none"}`);
  if (!track) throw derr("no_captions");
  let xml;
  try {
    const res = await rfetch(track.baseUrl);
    dlog(`dl:${res.status}`);
    if (!res.ok) throw derr("caps_dl_failed");
    xml = await res.text();
  } catch (e) {
    if (e.details !== undefined) throw e;
    throw derr("caps_dl_failed");
  }
  dlog(`dl:bytes=${xml.length}`);
  const lines = parseTimedtextXml(xml);
  dlog(`dl:lines=${lines.length}`);
  if (!lines.length) throw derr("caps_parse_failed");
  return {
    lines,
    lang: track.languageCode || "en",
    title: data?.videoDetails?.title || "",
  };
}

/**
 * Returns { lines: [{start, end, text}], lang, title }.
 * Throws coded errors (each with e.details diagnostic trail):
 *   yt_unreachable   — YouTube itself could not be reached
 *   no_captions      — video has no captions on any source
 *   caps_dl_failed   — caption file download failed
 *   caps_parse_failed— caption file downloaded but contained no parseable lines
 */
export async function fetchCaptions(videoId) {
  diag = [];
  anyHttp = false;
  dlog(`vid=${videoId}`);

  const p1 = await fetchPlayer(videoId);
  if (p1) return await resolvePlayer(p1);

  const leg = await fetchLegacy(videoId);
  if (leg) {
    dlog("src=legacy");
    return leg;
  }

  const p2 = await fetchPlayerFromWatchPage(videoId);
  if (p2) {
    const r = await resolvePlayer(p2);
    dlog("src=watch");
    return r;
  }

  if (!anyHttp) throw derr("yt_unreachable");
  throw derr("no_captions");
}
