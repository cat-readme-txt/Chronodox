# Chronodox

Chronodox is a browser-based, turn-driven strategy game about agents fighting across three linked timelines. It combines a React/TypeScript client, a custom rules engine, hidden-information mechanics, timeline traversal, paradox resolution, AI self-play, and retrainable hybrid policy artifacts.

The original idea came from playing the iOS app Two Spies, then expanding that spy-strategy foundation with paradox mechanics and layered timelines.

The live game uses the checked-in AI artifacts in `src/data/`:

- `src/data/hybridPolicyArtifact.easy.json`
- `src/data/hybridPolicyArtifact.normal.json`
- `src/data/hybridPolicyArtifact.hard.json`

The large `training-data/` folder is intentionally ignored. It is useful for retraining models, but it is not required to run the current game or use the current AI behavior.

## Features

- Three linked timelines: past, present, and future
- Shared traversal nodes between timelines
- Hidden enemy positions with reveal and uncertainty tracking
- Intel economy and special operations
- Timeline occupation bonuses and collapse rules
- Paradox destruction when temporal duplicates collide
- Local play, VS AI play, and lightweight LAN/online room hosting
- Browser and Node self-play pipelines for AI training data
- Hybrid AI policy artifacts split by difficulty preset

## Quick Start

Requirements:

- Node.js 20.19.x or Node.js 22.12+
- npm

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build a production bundle:

```bash
npm run build
```

Preview the production bundle locally:

```bash
npm run preview
```

Run the build behind the bundled Node host:

```bash
npm run host
```

## GitHub Publishing

The repository is set up to publish source code, not generated build folders. After pushing to GitHub:

- CI runs `npm ci`, `npm audit`, and all build scripts on pushes and pull requests.
- The GitHub Pages workflow builds `dist/` from source and uploads it as a Pages artifact on pushes to `main` or when run manually.
- To host the game directly from GitHub, enable GitHub Pages for the repository and select GitHub Actions as the Pages source. The next push, or a manual run of `Deploy GitHub Pages`, will publish the built app.

Do not use `Deploy from a branch` with `/ (root)` for this app. That serves the Vite source `index.html`, which points at TypeScript source files instead of the compiled production bundle and will render as a blank page in the browser.

Users do not need `training-data/` to play the current game. If there is no hosted Pages deployment, they will need to clone or download the repository and run the local setup commands above. With Pages enabled, they can play the built static app in the browser without cloning the source.

## AI And Training

The game can be played without the raw training corpus. The current AI scoring reads the versioned policy artifacts in `src/data/`.

To generate new self-play data:

```bash
npm run selfplay -- --matches 1000 --difficulty hard --out training-data --prefix run
```

To retrain the difficulty-specific policy artifacts from local training files:

```bash
npm run hybrid:train -- --input training-data
```

Generated training corpora can be very large, so `training-data/` is excluded from Git by default. If you want to publish sample training data, add a small curated sample under a separate tracked path or use Git LFS intentionally.

## Documentation

- [Technical overview](docs/technical-overview.md)
- [AI training guide](docs/ai-training.md)

## Repository Notes

This repository tracks source code, public assets, documentation, lockfiles, and trained AI artifacts. It does not track installed dependencies, production build output, local self-play bundles, OS metadata, environment files, or raw training corpora.
