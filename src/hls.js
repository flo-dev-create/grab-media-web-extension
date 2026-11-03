// Téléchargement de flux HLS (.m3u8) : récupération des segments et assemblage.
// Écriture en flux sur disque (File System Access API, Chrome/Edge) pour ne pas saturer la mémoire ;
// repli sur un Blob (Firefox). Chargé avant grab.js (dépend de progress(), sanitize() et pageTitle).

function isHls(url) {
  return /\.m3u8(\?|$)/i.test(url);
}

const HLS_STATUS_NO_RETRY = [401, 403, 404, 410];

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
      if (HLS_STATUS_NO_RETRY.includes(e.status)) break; // inutile de réessayer
      await new Promise((r) => setTimeout(r, 500 * (t + 1)));
    }
  }
  throw err;
}

const m3u8Attr = (line, name) => {
  const m = line.match(new RegExp(name + '="?([^",]+)"?'));
  return m ? m[1] : null;
};

// Lit la playlist (maître → meilleure variante) et renvoie la liste des segments.
async function loadHlsPlaylist(playlistUrl) {
  let url = playlistUrl;
  let text = await fetchRetry(url, "text");
  if (!text.includes("#EXTM3U")) throw new Error("Playlist invalide");

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
  return { segments, mapUrl, ext: mapUrl ? "mp4" : "ts" };
}

// Destinations d'écriture
function makeBlobSink(mime) {
  const parts = [];
  return {
    kind: "blob",
    async write(buf) {
      parts.push(new Blob([buf]));
    },
    async close() {
      return new Blob(parts, { type: mime });
    },
    async abort() {
      parts.length = 0;
    },
  };
}

async function makeFileSink(handle) {
  const writable = await handle.createWritable();
  return {
    kind: "file",
    write: (buf) => writable.write(buf),
    close: () => writable.close(),
    abort: () => writable.abort().catch(() => {}),
  };
}

const HLS_PARALLEL = 6;
const HLS_WINDOW = 16; // segments récupérés d'avance au maximum (limite la mémoire)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Récupère les segments en parallèle mais les écrit dans l'ordre.
async function downloadHlsTo(info, sink, onProgress) {
  const { segments, mapUrl } = info;
  const total = segments.length;
  const ready = new Map();
  let nextFetch = 0;
  let nextWrite = 0;
  let failure = null;
  let writeChain = Promise.resolve();

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

  if (mapUrl) await sink.write(await fetchRetry(mapUrl, "buf"));

  const drain = async () => {
    while (!failure && ready.has(nextWrite)) {
      const buf = ready.get(nextWrite);
      ready.delete(nextWrite);
      await sink.write(buf);
      nextWrite++;
      onProgress(nextWrite, total);
    }
  };

  const fail = (e) => {
    failure ??= e;
  };

  const worker = async () => {
    while (!failure) {
      while (nextFetch >= nextWrite + HLS_WINDOW && !failure) await sleep(30);
      if (failure || nextFetch >= total) return;
      const i = nextFetch++;
      const seg = segments[i];
      try {
        let buf = await fetchRetry(seg.url, "buf");
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
        ready.set(i, buf);
        writeChain = writeChain.then(drain).catch(fail);
      } catch (e) {
        if (e.status === 401 || e.status === 403) {
          fail(
            new Error(
              `le serveur refuse l'accès au segment ${i + 1} (HTTP ${e.status}) alors que ${nextWrite} segment(s) sur ${total} ont été récupérés. ` +
                "Ce site limite l'accès à ce flux : téléchargement impossible."
            )
          );
        } else {
          fail(new Error(`échec du segment ${i + 1} sur ${total} (${e.message || e})`));
        }
      }
    }
  };

  await Promise.all(Array.from({ length: HLS_PARALLEL }, worker));
  await writeChain;
  if (failure) throw failure;
}

// Prépare les téléchargements HLS : lit les playlists et, si possible, demande l'emplacement
// du fichier tout de suite (le sélecteur de fichier exige un geste récent de l'utilisateur).
async function planHls(urls) {
  const plans = [];
  const used = new Set();
  for (const [n, url] of urls.entries()) {
    const plan = { url, n, total: urls.length, handle: null, skip: false };
    plans.push(plan);
    try {
      plan.info = await loadHlsPlaylist(url);
    } catch (e) {
      plan.error = e;
      continue;
    }
    let name = sanitize(pageTitle);
    for (let k = 2; used.has(name); k++) name = sanitize(pageTitle) + "-" + k;
    used.add(name);
    plan.name = `${name}.${plan.info.ext}`;
    if (window.showSaveFilePicker) {
      try {
        plan.handle = await window.showSaveFilePicker({ suggestedName: plan.name });
      } catch (e) {
        if (e.name === "AbortError") plan.skip = true; // annulé par l'utilisateur
        // autre erreur (pas de geste utilisateur…) : repli sur le Blob
      }
    }
  }
  return plans;
}

async function runHlsPlans(plans) {
  for (const plan of plans) {
    if (plan.skip) continue;
    const label = plan.total > 1 ? ` (${plan.n + 1}/${plan.total})` : "";
    if (plan.error) {
      progress(0, 1, `Flux HLS${label} en échec : ${plan.error.message || plan.error}`);
      await sleep(2500);
      continue;
    }
    const sink = plan.handle
      ? await makeFileSink(plan.handle)
      : makeBlobSink(plan.info.ext === "mp4" ? "video/mp4" : "video/mp2t");
    try {
      progress(0, 1, `Flux HLS${label} : préparation…`);
      await downloadHlsTo(plan.info, sink, (d, t) => progress(d, t, `Flux HLS${label} : segment ${d} / ${t}`));
      const result = await sink.close();
      if (sink.kind === "blob") {
        const href = URL.createObjectURL(result);
        const a = document.createElement("a");
        a.href = href;
        a.download = plan.name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10 * 60_000);
      }
      progress(1, 1, `Flux HLS${label} terminé : ${plan.name}`);
    } catch (e) {
      await sink.abort();
      progress(0, 1, `Flux HLS${label} en échec : ${e.message || e}`);
      console.warn("HLS", plan.url, e);
      await sleep(2500);
    }
  }
}
