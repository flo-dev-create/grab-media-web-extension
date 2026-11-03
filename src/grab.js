const api = globalThis.browser ?? chrome;

const $ = (id) => document.getElementById(id);
const grid = $("grid");
const TYPES = ["image", "video", "audio", "embed"];

let items = [];
let pageTitle = "page";
const selected = new Set();
const cards = new Map(); // url -> { el, checkbox, item }

// ---------- Chargement ----------
async function init() {
  const id = new URLSearchParams(location.search).get("id");
  const key = `grab_${id}`;
  const data = (await api.storage.local.get(key))[key];
  if (!data) {
    showEmpty("Données introuvables. Relancez l'extension depuis la page.");
    return;
  }
  items = data.items;
  pageTitle = data.title || "page";
  $("page-info").textContent = `${data.title} — ${data.pageUrl}`;
  document.title = `Grab Media — ${data.title}`;

  if (data.error) showEmpty(`Impossible d'analyser cette page : ${data.error}`);
  else if (!items.length) showEmpty("Aucun média trouvé sur cette page.");

  items.forEach(buildCard);
  applyFilters();
  await resolveEmbeds();
}

function updateTypeCounts() {
  for (const t of TYPES) {
    const n = [...cards.values()].filter((c) => c.item.type === t).length;
    $(`c-${t}`).textContent = `(${n})`;
  }
}

// ---------- Résolution des embeds (iframes) vers les fichiers vidéo/audio réels ----------
const MEDIA_RE = /https?:\/\/[^\s"'<>\\()]+?\.(?:mp4|webm|mov|m4v|ogv|mp3|m4a|ogg|wav|m3u8)(?:\?[^\s"'<>\\()]*)?/gi;

async function resolveEmbed(embedUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(embedUrl, { signal: ctrl.signal, credentials: "include" });
    if (!res.ok) return [];
    const type = res.headers.get("content-type") || "";
    if (/^(video|audio)\//i.test(type)) return [{ url: res.url || embedUrl, type: type.startsWith("audio") ? "audio" : "video" }];
    const text = (await res.text()).split(String.fromCharCode(92) + "/").join("/").split(String.fromCharCode(92) + "u0026").join("&").replace(/&amp;/g, "&").replace(/\u0026/g, "&");
    const out = new Map();
    const push = (u) => {
      try {
        const abs = new URL(u, embedUrl).href;
        if (/^https?:/i.test(abs)) out.set(abs, { url: abs, type: /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(abs) ? "audio" : "video" });
      } catch {}
    };
    for (const m of text.matchAll(MEDIA_RE)) push(m[0]);
    const doc = new DOMParser().parseFromString(text, "text/html");
    doc.querySelectorAll("video[src], video source[src], audio[src], audio source[src]").forEach((e) => push(e.getAttribute("src")));
    doc.querySelectorAll('meta[property^="og:video"], meta[property="og:audio"]').forEach((m) => {
      if (/\.(mp4|webm|mov|m4v|mp3|m3u8)(\?|$)/i.test(m.content)) push(m.content);
    });
    return [...out.values()];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function resolveEmbeds() {
  const embeds = items.filter((i) => i.type === "embed");
  if (!embeds.length) return;
  const info = $("page-info");
  const base = info.textContent;
  let done = 0;
  const queue = [...embeds];
  const worker = async () => {
    while (queue.length) {
      const embed = queue.shift();
      info.textContent = `Analyse des iframes (${done}/${embeds.length})… — ${base}`;
      const found = await resolveEmbed(embed.url);
      done++;
      if (found.length) {
        cards.get(embed.url)?.el.remove();
        cards.delete(embed.url);
        for (const f of found) {
          if (cards.has(f.url)) continue;
          const item = { ...f, from: embed.url };
          items.push(item);
          buildCard(item);
        }
      }
      applyFilters();
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  info.textContent = base;
}

function showEmpty(msg) {
  const e = $("empty");
  e.textContent = msg;
  e.hidden = false;
}

// ---------- Cartes ----------
function buildCard(item) {
  const el = document.createElement("div");
  el.className = "card";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = item.type;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const isEmbed = item.type === "embed";
  if (isEmbed) cb.hidden = true;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = item.width && item.height ? `${item.width}×${item.height}` : "";

  if (item.type === "image") {
    const img = new Image();
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = item.url;
    img.onload = () => {
      item.width = img.naturalWidth;
      item.height = img.naturalHeight;
      meta.textContent = `${item.width}×${item.height}`;
      applyFilters();
    };
    img.onerror = () => {
      thumb.innerHTML = '<span class="ph">Aperçu indisponible</span>';
    };
    thumb.append(img);
  } else if (item.type === "video" && isHls(item.url)) {
    thumb.innerHTML = '<span class="ph">Flux HLS (.m3u8)<br />assemblé en fichier .ts au téléchargement</span>';
    meta.textContent = "HLS";
  } else if (item.type === "video") {
    const v = document.createElement("video");
    v.src = item.url;
    v.preload = "metadata";
    v.muted = true;
    v.controls = true;
    v.onloadedmetadata = () => {
      item.width = v.videoWidth;
      item.height = v.videoHeight;
      meta.textContent = `${item.width}×${item.height}`;
      applyFilters();
    };
    v.onclick = (e) => e.stopPropagation();
    thumb.append(v);
  } else if (isEmbed) {
    thumb.innerHTML = '<span class="ph">Iframe — aucun fichier direct trouvé</span>';
  } else {
    const a = document.createElement("audio");
    a.src = item.url;
    a.controls = true;
    a.preload = "none";
    a.onclick = (e) => e.stopPropagation();
    thumb.append(a);
  }

  const info = document.createElement("div");
  info.className = "info";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = baseName(item.url);
  name.title = item.url;
  info.append(name, meta);

  el.append(cb, badge, thumb, info);
  if (isEmbed) {
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Ouvrir la page";
    info.append(link);
  }
  el.addEventListener("click", (e) => {
    if (isEmbed) return;
    if (e.target !== cb) cb.checked = !cb.checked;
    setSelected(item.url, cb.checked);
  });
  grid.append(el);
  cards.set(item.url, { el, cb, item });
}

function setSelected(url, on) {
  const c = cards.get(url);
  if (on) selected.add(url);
  else selected.delete(url);
  c.cb.checked = on;
  c.el.classList.toggle("selected", on);
  updateCount();
}

function updateCount() {
  const n = selected.size;
  $("selected-count").textContent = `${n} sélectionné${n > 1 ? "s" : ""}`;
  $("dl-zip").disabled = $("dl-separate").disabled = n === 0;
}

// ---------- Filtres ----------
function isVisible({ item }) {
  if (!$(`f-${item.type}`)?.checked) return false;
  const q = $("search").value.trim().toLowerCase();
  if (q && !item.url.toLowerCase().includes(q)) return false;
  const min = Number($("minsize").value) || 0;
  if (min && item.type !== "audio" && Math.max(item.width || 0, item.height || 0) < min) return false;
  return true;
}

function applyFilters() {
  for (const c of cards.values()) c.el.hidden = !isVisible(c);
  updateTypeCounts();
  updateCount();
}

function visibleUrls() {
  return [...cards.values()].filter((c) => !c.el.hidden).map((c) => c.item.url);
}

["f-image", "f-video", "f-audio", "f-embed"].forEach((id) => $(id).addEventListener("change", applyFilters));
$("search").addEventListener("input", applyFilters);
$("minsize").addEventListener("input", applyFilters);
$("select-all").addEventListener("click", () => visibleUrls().forEach((u) => setSelected(u, true)));
$("select-none").addEventListener("click", () => [...selected].forEach((u) => setSelected(u, false)));

// ---------- Noms de fichiers ----------
function baseName(url) {
  if (url.startsWith("data:")) return "data-uri";
  try {
    const p = new URL(url).pathname;
    return decodeURIComponent(p.substring(p.lastIndexOf("/") + 1)) || new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

const MIME_EXT = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif",
  "image/svg+xml": "svg", "image/bmp": "bmp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
  "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv", "video/quicktime": "mov",
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac",
  "audio/mp4": "m4a", "audio/flac": "flac", "audio/webm": "weba",
};

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}

function makeNamer() {
  const used = new Set();
  return (url, mime, index) => {
    let name = sanitize(baseName(url));
    if (name === "data-uri") name = `media-${index + 1}`;
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
      const ext = MIME_EXT[(mime || "").split(";")[0].trim().toLowerCase()];
      if (ext) name += `.${ext}`;
    }
    let final = name;
    let n = 1;
    while (used.has(final.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      final = dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
      n++;
    }
    used.add(final.toLowerCase());
    return final;
  };
}

// ---------- Progression ----------
function progress(done, total, text) {
  $("progress").hidden = false;
  $("progress-bar").style.width = `${total ? (done / total) * 100 : 0}%`;
  $("progress-text").textContent = text ?? `${done} / ${total}`;
}

function setBusy(busy) {
  $("dl-zip").disabled = $("dl-separate").disabled = busy || selected.size === 0;
}

// ---------- Téléchargement séparé ----------
$("dl-separate").addEventListener("click", async () => {
  const urls = [...selected].filter((u) => !isHls(u));
  const hlsUrls = [...selected].filter(isHls);
  const namer = makeNamer();
  setBusy(true);
  let ok = 0;
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    try {
      await api.downloads.download({
        url,
        filename: `${sanitize(pageTitle)}/${namer(url, "", i)}`,
        conflictAction: "uniquify",
      });
      ok++;
    } catch {
      failed++;
    }
    progress(i + 1, urls.length);
  }
  if (urls.length) progress(urls.length, urls.length, `${ok} téléchargement(s) lancé(s)${failed ? `, ${failed} échec(s)` : ""}`);
  await saveHlsList(hlsUrls);
  setBusy(false);
});

// ---------- Téléchargement ZIP ----------
$("dl-zip").addEventListener("click", async () => {
  const urls = [...selected].filter((u) => !isHls(u));
  const hlsUrls = [...selected].filter(isHls);
  const namer = makeNamer();
  const files = [];
  const failures = [];
  let done = 0;
  setBusy(true);
  if (!urls.length) {
    await saveHlsList(hlsUrls); // flux HLS trop lourds pour un ZIP : fichiers séparés
    setBusy(false);
    return;
  }
  progress(0, urls.length, "Récupération des fichiers…");

  const queue = urls.map((url, i) => ({ url, i }));
  const worker = async () => {
    while (queue.length) {
      const { url, i } = queue.shift();
      try {
        const res = await fetch(url, { credentials: "include", referrerPolicy: "no-referrer" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        files[i] = { url, blob, mime: blob.type || res.headers.get("content-type") || "" };
      } catch (e) {
        failures.push(url);
      }
      progress(++done, urls.length, `Récupération ${done} / ${urls.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const ready = files.filter(Boolean);
  if (!ready.length) {
    progress(0, 1, "Aucun fichier n'a pu être récupéré.");
    setBusy(false);
    return;
  }

  progress(urls.length, urls.length, "Création du ZIP…");
  const entries = [];
  for (const [i, f] of ready.entries()) {
    entries.push({ name: namer(f.url, f.mime, i), data: new Uint8Array(await f.blob.arrayBuffer()) });
  }
  const zip = buildZip(entries);
  const href = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${sanitize(pageTitle)}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);

  progress(
    urls.length,
    urls.length,
    `ZIP créé : ${ready.length} fichier(s)${failures.length ? `, ${failures.length} échec(s)` : ""}`
  );
  if (failures.length) console.warn("Échecs de téléchargement :", failures);
  await saveHlsList(hlsUrls);
  setBusy(false);
});

// ---------- HLS (.m3u8) : téléchargement des segments et assemblage ----------
function isHls(url) {
  return /\.m3u8(\?|$)/i.test(url);
}

async function fetchRetry(url, kind, tries = 3) {
  let err;
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) {
        const e = new Error("HTTP " + res.status);
        e.status = res.status;
        throw e;
      }
      return kind === "text" ? await res.text() : await res.arrayBuffer();
    } catch (e) {
      err = e;
      if ([401, 403, 404, 410].includes(e.status)) break; // inutile de réessayer
      await new Promise((r) => setTimeout(r, 500 * (t + 1)));
    }
  }
  throw err;
}

const m3u8Attr = (line, name) => {
  const m = line.match(new RegExp(name + '="?([^",]+)"?'));
  return m ? m[1] : null;
};

async function downloadHls(playlistUrl, onProgress) {
  let url = playlistUrl;
  let text = await fetchRetry(url, "text");
  if (!text.includes("#EXTM3U")) throw new Error("Playlist invalide");

  // Playlist maître : on prend la variante avec le plus haut débit
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split(/\r?\n/);
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const bw = Number(m3u8Attr(lines[i], "BANDWIDTH")) || 0;
      const uri = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#"));
      if (uri && (!best || bw > best.bw)) best = { bw, uri: uri.trim() };
    }
    if (!best) throw new Error("Aucune variante trouvée");
    url = new URL(best.uri, url).href;
    text = await fetchRetry(url, "text");
  }

  const segments = [];
  let key = null;
  let mapUrl = null;
  let seq = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      seq = Number(line.split(":")[1]) || 0;
    } else if (line.startsWith("#EXT-X-KEY")) {
      const method = m3u8Attr(line, "METHOD");
      if (method === "NONE") key = null;
      else if (method === "AES-128") {
        const iv = line.match(/IV=0x([0-9a-fA-F]+)/);
        key = { uri: new URL(m3u8Attr(line, "URI"), url).href, iv: iv ? iv[1] : null };
      } else throw new Error("Chiffrement non supporté : " + method);
    } else if (line.startsWith("#EXT-X-MAP")) {
      mapUrl = new URL(m3u8Attr(line, "URI"), url).href;
    } else if (!line.startsWith("#")) {
      segments.push({ url: new URL(line, url).href, key, seq: seq + segments.length });
    }
  }
  if (!segments.length) throw new Error("Aucun segment");

  const keyCache = new Map();
  const getKey = (k) => {
    if (!keyCache.has(k.uri)) {
      keyCache.set(
        k.uri,
        fetchRetry(k.uri, "buf").then((buf) => crypto.subtle.importKey("raw", buf, "AES-CBC", false, ["decrypt"]))
      );
    }
    return keyCache.get(k.uri);
  };

  const offset = mapUrl ? 1 : 0;
  const parts = new Array(segments.length + offset);
  if (mapUrl) parts[0] = new Blob([await fetchRetry(mapUrl, "buf")]);

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < segments.length) {
      const i = next++;
      const seg = segments[i];
      let buf;
      try {
        buf = await fetchRetry(seg.url, "buf");
      } catch (e) {
        next = segments.length; // arrête les autres téléchargements
        if (e.status === 401 || e.status === 403) {
          throw new Error(
            `le serveur refuse l'accès au segment ${i + 1} (HTTP ${e.status}) alors que ${done} segment(s) sur ${segments.length} ont été récupérés. ` +
              "Ce site limite l'accès à ce flux : téléchargement impossible."
          );
        }
        throw new Error(`échec du segment ${i + 1} sur ${segments.length} (${e.message || e})`);
      }
      if (seg.key) {
        const iv = new Uint8Array(16);
        if (seg.key.iv) {
          const hex = seg.key.iv.padStart(32, "0");
          for (let b = 0; b < 16; b++) iv[b] = parseInt(hex.substr(b * 2, 2), 16);
        } else {
          new DataView(iv.buffer).setUint32(12, seg.seq);
        }
        buf = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, await getKey(seg.key), buf);
      }
      parts[i + offset] = new Blob([buf]);
      onProgress(++done, segments.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  return { blob: new Blob(parts, { type: mapUrl ? "video/mp4" : "video/mp2t" }), ext: mapUrl ? "mp4" : "ts" };
}

async function saveHlsList(urls) {
  const used = new Set();
  for (const [n, url] of urls.entries()) {
    const label = urls.length > 1 ? ` (${n + 1}/${urls.length})` : "";
    try {
      progress(0, 1, `Flux HLS${label} : préparation…`);
      const { blob, ext } = await downloadHls(url, (d, t) => progress(d, t, `Flux HLS${label} : segment ${d} / ${t}`));
      let name = sanitize(pageTitle);
      for (let k = 2; used.has(name); k++) name = sanitize(pageTitle) + "-" + k;
      used.add(name);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${name}.${ext}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10 * 60_000);
      progress(1, 1, `Flux HLS${label} terminé : ${name}.${ext}`);
    } catch (e) {
      progress(0, 1, `Flux HLS${label} en échec : ${e.message || e}`);
      console.warn("HLS", url, e);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

// ---------- Écriture ZIP (méthode "store", sans dépendance) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // noms en UTF-8
    local.setUint16(8, 0, true); // store
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, nameBytes, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(cen.buffer, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

init();
