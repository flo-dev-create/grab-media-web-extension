const api = globalThis.browser ?? chrome;

const $ = (id) => document.getElementById(id);
const grid = $("grid");
const TYPES = ["image", "video", "audio"];

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

  for (const t of TYPES) $(`c-${t}`).textContent = `(${items.filter((i) => i.type === t).length})`;
  items.forEach(buildCard);
  applyFilters();
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
  el.addEventListener("click", (e) => {
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
  updateCount();
}

function visibleUrls() {
  return [...cards.values()].filter((c) => !c.el.hidden).map((c) => c.item.url);
}

["f-image", "f-video", "f-audio"].forEach((id) => $(id).addEventListener("change", applyFilters));
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
  const urls = [...selected];
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
  progress(urls.length, urls.length, `${ok} téléchargement(s) lancé(s)${failed ? `, ${failed} échec(s)` : ""}`);
  setBusy(false);
});

// ---------- Téléchargement ZIP ----------
$("dl-zip").addEventListener("click", async () => {
  const urls = [...selected];
  const namer = makeNamer();
  const files = [];
  const failures = [];
  let done = 0;
  setBusy(true);
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
  setBusy(false);
});

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
