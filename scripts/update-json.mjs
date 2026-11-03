// Ajoute la version courante à updates.json (mises à jour automatiques Firefox, distribution non listée).
// Usage : node scripts/update-json.mjs <fichier.xpi> <tag>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [xpi, tag] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
const version = tag.replace(/^v/, "");
const id = manifest.browser_specific_settings.gecko.id;
const repo = process.env.GITHUB_REPOSITORY || "flo-dev-create/grab-media-web-extension";
const hash = createHash("sha256").update(readFileSync(xpi)).digest("hex");

const file = "updates.json";
const data = JSON.parse(readFileSync(file, "utf8"));
const updates = (data.addons[id] ??= { updates: [] }).updates.filter((u) => u.version !== version);
updates.push({
  version,
  update_link: `https://github.com/${repo}/releases/download/${tag}/${xpi.split(/[\/]/).pop()}`,
  update_hash: `sha256:${hash}`,
});
data.addons[id].updates = updates;
writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`updates.json : ${version} → ${hash}`);
