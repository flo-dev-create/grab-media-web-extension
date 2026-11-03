# Grab Media

Extension **Chrome** et **Firefox** (Manifest V3) qui récupère tous les médias d'une page (images, vidéos, audios) et les affiche dans une fenêtre où l'on peut les sélectionner et les télécharger en une fois.

## Fonctionnalités

- Détection : `<img>` (y compris `srcset` et attributs lazy-load), `<picture>`, `<video>`, `<audio>`, `<source>`, images CSS de fond, liens directs vers des fichiers média, balises `og:image`/`og:video`, icônes, iframes et shadow DOM.
- Fenêtre de sélection avec aperçus, filtres par type, recherche par URL et taille minimale.
- Téléchargement **en ZIP** (un seul fichier) ou **séparément** (via l'API downloads).

## Utilisation

Cliquez sur l'icône de l'extension sur la page à analyser → une fenêtre s'ouvre avec tous les médias trouvés.

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
