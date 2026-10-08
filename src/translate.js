// Direct on-device translation via Google's free translate endpoint.
// No PC/server needed. Lines are joined with "\n" (preserved by Google)
// and split back after translation.

const BATCH = 25;
const HOSTS = [
  "https://translate.googleapis.com/translate_a/single",
  "https://translate.google.com/translate_a/single",
];

/** fetch with one retry (LTE connections drop requests sometimes). */
async function rfetch(url) {
  try {
    return await fetch(url);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1200));
    return await fetch(url);
  }
}

async function translateText(q, sourceLang, targetLang) {
  let lastErr = null;
  for (const host of HOSTS) {
    try {
      const params = new URLSearchParams({
        client: "gtx",
        sl: sourceLang,
        tl: targetLang,
        dt: "t",
        q,
      });
      const res = await rfetch(`${host}?${params.toString()}`);
      if (!res.ok) {
        lastErr = new Error("bad");
        continue;
      }
      const data = await res.json();
      return data[0].map((s) => s[0]).join("");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("tr_failed");
}

/**
 * Translate an array of strings. Returns an array of translated strings
 * in the same order. Throws Error("tr_failed") when unreachable.
 */
export async function translateBatch(texts, sourceLang = "en", targetLang = "ckb") {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    let joined;
    try {
      joined = await translateText(chunk.join("\n"), sourceLang, targetLang);
    } catch (e) {
      throw new Error("tr_failed");
    }
    const parts = joined.split("\n");
    if (parts.length === chunk.length) {
      out.push(...parts);
    } else {
      // Fallback: translate line by line if Google merged/split lines.
      for (const t of chunk) {
        try {
          out.push(await translateText(t, sourceLang, targetLang));
        } catch (e) {
          throw new Error("tr_failed");
        }
      }
    }
  }
  return out;
}
