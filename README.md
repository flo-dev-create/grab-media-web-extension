# Grab Media

Extension **Chrome** et **Firefox** (Manifest V3) qui récupère tous les médias d'une page (images, vidéos, audios) et les affiche dans une fenêtre où l'on peut les sélectionner et les télécharger en une fois.

## Fonctionnalités

- Détection : `<img>` (y compris `srcset` et attributs lazy-load), `<picture>`, `<video>`, `<audio>`, `<source>`, images CSS de fond, liens directs vers des fichiers média, balises `og:image`/`og:video`, icônes, iframes et shadow DOM.
- Fenêtre de sélection avec aperçus, filtres par type, recherche par URL et taille minimale.
- Téléchargement **en ZIP** (un seul fichier) ou **séparément** (via l'API downloads).

## Utilisation

Cliquez sur l'icône de l'extension sur la page à analyser → une fenêtre s'ouvre avec tous les médias trouvés.

## Détection avancée

- **Iframes / embeds** : l'URL de l'iframe (même cachée dans un attribut `data-html`) est ouverte en arrière-plan ; l'extension y cherche les fichiers (`<video>`, `<source>`, JSON, scripts « packés », base64, iframes imbriquées).
- **Flux réseau** : les requêtes média (mp4, m3u8, audio…) réellement faites par la page sont mémorisées. Si un lecteur reste « non résolu », lancez la lecture de la vidéo dans la page puis cliquez à nouveau sur l'extension.
- **HLS (.m3u8)** : segments assemblés en un seul fichier `.ts` (écriture directe sur disque dans Chrome/Edge, via Blob dans Firefox). Un site qui refuse les segments (HTTP 403) est signalé clairement.
- **Gros fichiers** (> 100 Mo) : en mode ZIP, ils sont téléchargés à part par le navigateur plutôt que chargés en mémoire.

## Installation

Téléchargez les paquets depuis les [Releases](../../releases).

- **Chrome / Edge / Brave** : décompressez `grab-media-chrome-vX.Y.Z.zip` dans un dossier, ouvrez `chrome://extensions`, activez le mode développeur, puis « Charger l'extension non empaquetée » et choisissez ce dossier. (Chrome n'autorise pas l'installation d'un .crx hors Chrome Web Store.)
- **Firefox** : ouvrez `grab-media-firefox-vX.Y.Z.xpi` dans Firefox (glisser-déposer) pour l'installer. Le .xpi n'est installable de façon permanente que s'il est signé par Mozilla (voir ci-dessous) ; sinon, utilisez `about:debugging#/runtime/this-firefox` → « Charger un module complémentaire temporaire… ».

### Signature Firefox (une fois)
Créez des clés API sur https://addons.mozilla.org/developers/addon/api/key/ puis ajoutez-les dans les secrets du dépôt : `AMO_JWT_ISSUER` et `AMO_JWT_SECRET`. Le workflow signe alors automatiquement le .xpi (distribution non listée).

## Développement

```sh
node scripts/build.mjs   # génère dist/chrome, dist/firefox, le .zip Chrome et le .xpi Firefox
```

Les sources sont dans `src/`. Le manifest source contient les clés des deux navigateurs ; le build retire celles qui ne s'appliquent pas.

## Publier une release

1. Mettre à jour `version` dans `src/manifest.json`.
2. Commit, puis :
   ```sh
   git tag v1.0.0
   git push origin main --tags
   ```
3. Le workflow `.github/workflows/release.yml` construit les zip Chrome et Firefox et crée la release GitHub.

## Limites

Les URLs `blob:` (flux MSE/streaming) ne sont pas téléchargeables par l'extension.

## Mises à jour automatiques Firefox (distribution non listée)

Le manifest Firefox contient `update_url` → `updates.json` (à la racine de `main`, servi par `raw.githubusercontent.com`). À chaque release **signée**, le workflow ajoute la nouvelle version (lien du `.xpi` + hash SHA-256) dans `updates.json`, et Firefox met l'extension à jour tout seul. Cela suppose que le dépôt soit **public** : un dépôt privé ne peut pas être lu par le navigateur.
