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

- **Chrome / Edge** : décompressez `grab-media-chrome-vX.Y.Z.zip`, ouvrez `chrome://extensions`, activez le mode développeur, « Charger l'extension non empaquetée ».
- **Firefox** : ouvrez `about:debugging#/runtime/this-firefox`, « Charger un module complémentaire temporaire… » et choisissez `grab-media-firefox-vX.Y.Z.zip`.

## Développement

```sh
node scripts/build.mjs   # génère dist/chrome, dist/firefox et les zip
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
