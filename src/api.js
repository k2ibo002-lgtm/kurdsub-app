// KurdSub mobile — API layer (talks to the KurdSub server on your PC)
export async function apiInfo(backend) {
  const r = await fetch(`${backend}/api/info`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("no-server");
  return r.json();
}

export async function getSubtitles(backend, url) {
  const r = await fetch(`${backend}/api/subtitles?url=${encodeURIComponent(url)}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error || "fetch-failed");
  return d;
}

export async function makeDub(backend, videoId) {
  const r = await fetch(`${backend}/api/dub`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: videoId }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error || "dub-failed");
  return d;
}

export const audioUrl = (backend, videoId, i) => `${backend}/audio/${videoId}/${i}.wav`;
export const srtUrl = (backend, videoId, mode) => `${backend}/api/srt?video_id=${videoId}&mode=${mode}`;
export const dubDownloadUrl = (backend, videoId) => `${backend}/api/dub-download?video_id=${videoId}`;

export function fmt(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
