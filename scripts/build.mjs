// Construit les paquets Chrome et Firefox dans dist/ (sans dépendance externe).
// Usage : node scripts/build.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const { version } = manifest;

rmSync(dist, { recursive: true, force: true });

const variants = {
  chrome: (m) => {
    delete m.browser_specific_settings;
    delete m.background.scripts;
    return m;
  },
  firefox: (m) => {
    delete m.background.service_worker;
    return m;
  },
};

for (const [name, transform] of Object.entries(variants)) {
  const out = join(dist, name);
  mkdirSync(out, { recursive: true });
  cpSync(src, out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(transform(structuredClone(manifest)), null, 2));

  const zip = join(dist, `grab-media-${name}-v${version}.zip`);
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("zip", ["-r", "-q", zip, "."], { cwd: out, stdio: "inherit" });
  }
  console.log(`✔ ${zip}`);
}
