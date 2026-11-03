// Résolution d'une page d'embed (iframe) vers les fichiers média réels qu'elle référence.
// Chargé avant grab.js (scripts classiques : fonctions globales).

const MEDIA_URL_RE = /https?:\/\/[^\s"'<>\\()]+?\.(?:mp4|webm|mov|m4v|ogv|mp3|m4a|ogg|wav|m3u8)(?:\?[^\s"'<>\\()]*)?/gi;
const MEDIA_KEY_RE =
  /["']?(?:file|src|source|url|contentUrl|video_url|videoUrl|hls|stream|mp4|playlist)["']?\s*[:=]\s*["']([^"'\s]+?\.(?:mp4|webm|m3u8|mov|m4v|mp3)(?:\?[^"'\s]*)?)["']/gi;
const PACKER_RE = /}\('((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
const NOT_MEDIA_RE = /\.(jpe?g|png|gif|webp|svg|vtt|srt|ts|m4s|js|css)(\?|$)/i;
const AUDIO_RE = /\.(mp3|m4a|ogg|wav)(\?|$)/i;
const RESOLVE_MAX_DEPTH = 2;

// Décode un script « Dean Edwards packer » : eval(function(p,a,c,k,e,d){…}('…',base,n,'a|b|c'.split('|'),0,{}))
function unpackPacked(source) {
  const out = [];
  for (const m of source.matchAll(PACKER_RE)) {
    try {
      const radix = Number(m[2]);
      let count = Number(m[3]);
      const dict = m[4].split("|");
      const payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      const toBase = (n) =>
        (n < radix ? "" : toBase(Math.floor(n / radix))) +
        ((n = n % radix) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
      const lookup = {};
      while (count--) lookup[toBase(count)] = dict[count] || toBase(count);
      out.push(payload.replace(/\b\w+\b/g, (w) => lookup[w] ?? w));
    } catch {}
  }
  return out;
}

// Texte « enrichi » : échappements JSON retirés + contenus de scripts packés / base64 décodés.
function expandText(raw) {
  const clean = (s) =>
    s
      .replace(/\\\//g, "/")
      .replace(/\\u0026/g, "&")
      .replace(/\\x2F/gi, "/")
      .replace(/&amp;/g, "&");
  const base = clean(raw);
  const extra = unpackPacked(base);
  for (const m of base.matchAll(/atob\(\s*["']([A-Za-z0-9+/=]{16,})["']\s*\)/g)) {
    try {
      extra.push(atob(m[1]));
    } catch {}
  }
  return clean([base, ...extra].join("\n"));
}

async function resolveEmbed(embedUrl, depth = 0, seen = new Set()) {
  if (seen.has(embedUrl)) return [];
  seen.add(embedUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(embedUrl, { signal: ctrl.signal, credentials: "include" });
    if (!res.ok) return [];
    const finalUrl = res.url || embedUrl;
    const ctype = res.headers.get("content-type") || "";
    if (/^(video|audio)\//i.test(ctype) || /mpegurl/i.test(ctype)) {
      res.body?.cancel();
      return [{ url: finalUrl, type: ctype.startsWith("audio") ? "audio" : "video" }];
    }

    const raw = await res.text();
    const text = expandText(raw);
    const found = new Map();
    const push = (u) => {
      try {
        const abs = new URL(u, finalUrl).href;
        if (/^https?:/i.test(abs) && !NOT_MEDIA_RE.test(abs)) {
          found.set(abs, { url: abs, type: AUDIO_RE.test(abs) ? "audio" : "video" });
        }
      } catch {}
    };

    for (const m of text.matchAll(MEDIA_URL_RE)) push(m[0]);
    for (const m of text.matchAll(MEDIA_KEY_RE)) push(m[1]);

    const doc = new DOMParser().parseFromString(raw, "text/html");
    doc
      .querySelectorAll("video[src], video source[src], audio[src], audio source[src]")
      .forEach((e) => push(e.getAttribute("src")));
    doc.querySelectorAll('meta[property^="og:video"], meta[property="og:audio"]').forEach((m) => {
      if (/\.(mp4|webm|mov|m4v|mp3|m3u8)(\?|$)/i.test(m.content)) push(m.content);
    });
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      for (const m of s.textContent.matchAll(/"contentUrl"\s*:\s*"([^"]+)"/g)) push(m[1]);
    });

    // Rien trouvé : l'embed contient peut-être lui-même une iframe (lecteur imbriqué)
    if (!found.size && depth < RESOLVE_MAX_DEPTH) {
      const nested = [...doc.querySelectorAll("iframe[src]")]
        .map((f) => {
          try {
            return new URL(f.getAttribute("src"), finalUrl).href;
          } catch {
            return null;
          }
        })
        .filter((u) => u && /^https?:/i.test(u))
        .slice(0, 3);
      for (const u of nested) {
        for (const item of await resolveEmbed(u, depth + 1, seen)) found.set(item.url, item);
      }
    }
    return [...found.values()];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
