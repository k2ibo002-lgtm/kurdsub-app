// Build SRT subtitle text on-device (no server needed).

function fmt(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const x = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${x}`;
}

/**
 * mode: "ckb" (Kurdish only) or "both" (English + Kurdish)
 */
export function buildSrt(lines, mode = "ckb") {
  return lines
    .map((l, i) => {
      const body = mode === "both" ? `${l.en}\n${l.ckb}` : l.ckb;
      return `${i + 1}\n${fmt(l.start)} --> ${fmt(l.end)}\n${body}`;
    })
    .join("\n\n");
}
