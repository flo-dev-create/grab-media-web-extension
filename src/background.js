const api = globalThis.browser ?? chrome;

// Fonction injectée dans la page (et ses iframes) : doit être autonome.
function collectMedia() {
  const found = new Map();
  const EXT = {
    image: /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|tiff?)$/i,
    video: /\.(mp4|webm|mov|m4v|mkv|ogv|avi)$/i,
    audio: /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i,
  };

  const guessType = (url, fallback) => {
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {}
    for (const [type, re] of Object.entries(EXT)) if (re.test(path)) return type;
    return fallback;
  };

  const add = (raw, fallbackType, extra = {}) => {
    if (!raw || typeof raw !== "string") return;
    let url;
    try {
      url = new URL(raw.trim(), document.baseURI).href;
    } catch {
      return;
    }
    if (!/^(https?|data|file|ftp):/i.test(url)) return; // blob:, javascript:, etc. exclus
    const type = fallbackType === "embed" ? "embed" : guessType(url, fallbackType);
    const prev = found.get(url);
    if (prev) {
      Object.assign(prev, { width: prev.width || extra.width, height: prev.height || extra.height });
      return;
    }
    found.set(url, { url, type, ...extra });
  };

  const bestFromSrcset = (srcset) => {
    if (!srcset) return null;
    let best = null;
    let bestScore = -1;
    for (const part of srcset.split(",")) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const score = d ? parseFloat(d) || 1 : 1;
      if (score > bestScore) {
        best = u;
        bestScore = score;
      }
    }
    return best;
  };

  const walk = (root) => {
    root.querySelectorAll("img").forEach((img) => {
      const dims = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
      add(img.currentSrc || img.src, "image", dims);
      add(bestFromSrcset(img.srcset), "image", dims);
      for (const attr of ["data-src", "data-original", "data-lazy-src", "data-full", "data-large"]) {
        add(img.getAttribute(attr), "image");
      }
      add(bestFromSrcset(img.getAttribute("data-srcset")), "image");
    });

    root.querySelectorAll("picture source").forEach((s) => {
      add(bestFromSrcset(s.srcset), "image");
    });

    root.querySelectorAll("video").forEach((v) => {
      const dims = { width: v.videoWidth || 0, height: v.videoHeight || 0 };
      add(v.currentSrc || v.src, "video", dims);
      if (v.poster) add(v.poster, "image");
    });

    root.querySelectorAll("audio").forEach((a) => add(a.currentSrc || a.src, "audio"));

    root.querySelectorAll("video source, audio source").forEach((s) => {
      const parentTag = s.parentElement?.tagName.toLowerCase();
      add(s.src, parentTag === "audio" ? "audio" : "video");
    });

    root.querySelectorAll("a[href]").forEach((a) => {
      const type = guessType(a.href, null);
      if (type) add(a.href, type);
    });

    root.querySelectorAll("object[data], embed[src]").forEach((el) => {
      const u = el.getAttribute("data") || el.getAttribute("src");
      const type = guessType(u || "", null);
      if (type) add(u, type);
    });

    root.querySelectorAll("iframe[src], iframe[data-src]").forEach((f) => {
      add(f.getAttribute("src") || f.getAttribute("data-src"), "embed");
    });

    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot);
      // Attributs contenant du HTML (ex. data-html="<iframe …>") ou une URL média directe
      for (const attr of el.attributes) {
        const val = attr.value;
        if (!val || val.length < 8) continue;
        if (/<(iframe|video|audio|source|img|embed)\b/i.test(val)) {
          try {
            const doc = new DOMParser().parseFromString(val, "text/html");
            doc.querySelectorAll("iframe[src], embed[src]").forEach((f) => add(f.getAttribute("src"), "embed"));
            doc.querySelectorAll("video").forEach((v) => {
              add(v.getAttribute("src"), "video");
              add(v.getAttribute("poster"), "image");
            });
            doc.querySelectorAll("audio").forEach((a) => add(a.getAttribute("src"), "audio"));
            doc.querySelectorAll("source").forEach((s) => {
              add(s.getAttribute("src"), s.parentElement?.tagName === "AUDIO" ? "audio" : "video");
            });
            doc.querySelectorAll("img").forEach((i) => add(i.getAttribute("src"), "image"));
          } catch {}
        } else if (
          !/^(src|href|style|srcset)$/i.test(attr.name) &&
          /^[^\s"'<>]+\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4v|mkv|ogv|mp3|wav|ogg|m4a|aac|flac|opus)(\?[^\s"'<>]*)?$/i.test(val)
        ) {
          add(val, null);
        }
      }
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") {
        for (const m of bg.matchAll(/url\((['"]?)(.*?)\1\)/g)) add(m[2], "image");
      }
    });
  };

  walk(document);

  document
    .querySelectorAll(
      'meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"]'
    )
    .forEach((m) => {
      const prop = m.getAttribute("property") || "";
      add(m.content, prop.includes("video") ? "video" : prop.includes("audio") ? "audio" : "image");
    });

  document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((l) => add(l.href, "image"));

  return Array.from(found.values());
}

async function grab(tab) {
  let items = [];
  let error = null;
  try {
    const results = await api.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: collectMedia,
    });
    const merged = new Map();
    for (const r of results) {
      for (const item of r.result || []) if (!merged.has(item.url)) merged.set(item.url, item);
    }
    items = Array.from(merged.values());
  } catch (e) {
    error = String(e?.message || e);
  }

  const id = `${Date.now()}`;
  await api.storage.local.set({
    [`grab_${id}`]: { title: tab.title || "", pageUrl: tab.url || "", items, error },
  });

  await api.windows.create({
    url: api.runtime.getURL(`grab.html?id=${id}`),
    type: "popup",
    width: 1000,
    height: 760,
  });
}

api.action.onClicked.addListener((tab) => {
  grab(tab);
});

// Nettoyage des anciennes captures
api.windows.onRemoved.addListener(async () => {
  const all = await api.storage.local.get(null);
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const stale = Object.keys(all).filter((k) => k.startsWith("grab_") && Number(k.slice(5)) < cutoff);
  if (stale.length) await api.storage.local.remove(stale);
});
