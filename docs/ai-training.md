# Chronodox AI Training

Chronodox now records compact training data from completed matches in browser storage.

## AI Difficulty Presets

Chronodox uses three named presets across live VS AI matches, self-play, and hybrid-policy training:

- `easy`: more forgiving, more random, and more likely to spend actions less efficiently
- `normal`: the default preset for general play and mixed self-play batches
- `hard`: tighter action ordering, stronger strategic weighting, and less hesitation

In the live client, choose the preset from the `VS AI` deployment panel before starting a new solo match.

In saved training data, each recorded match keeps its `aiDifficulty`, and the runtime now loads a separate learned artifact for each preset:

- `src/data/hybridPolicyArtifact.easy.json`
- `src/data/hybridPolicyArtifact.normal.json`
- `src/data/hybridPolicyArtifact.hard.json`

That means the selected difficulty now changes both:

- the runtime scoring profile
- the learned artifact file used in-game

The checked-in `easy`, `normal`, and `hard` artifacts are currently bootstrapped from the last shared model so the game stays stable immediately. They become truly different once you retrain them separately.

## What Gets Recorded

Each action example stores:

- acting player
- round number
- action type
- acting agent id
- optional target city and target period
- a compact game-state snapshot from the acting player's perspective
- final reward after the match ends

The stored state snapshot includes:

- both intel pools
- player and opponent agent summaries
- controlled-city counts
- destroyed-city count
- rewards currently in play
- city control, route links, node membership, and reward occupancy for richer hybrid features
- current reveal/uncertainty information for opponent tracking

## How To Build A Learning Agent

1. Generate training data with browser self-play or disk self-play.
2. Train one or more difficulty-specific hybrid artifacts from saved match files.
3. Reload the app so the updated artifacts are used by the in-game AI.

## Reward Scheme

The current recorder assigns:

- `+1` if the acting player eventually wins
- `0` for a draw
- `-1` if the acting player eventually loses

This is intentionally simple and works as a starting point for supervised learning or reinforcement learning fine-tuning.

## Useful Next Steps

- add legal-action masks so the model only scores valid actions
- add richer spatial features for routes and node links
- record hidden-information beliefs separately from exact state
- run offline evaluation against the current heuristic AI

## VS Code Self-Play

For larger batches, use the Node runner from the project root:

```bash
npm run selfplay -- --matches 1000 --difficulty hard --out training-data --prefix run
```

This writes both:

- a full `.json` batch file
- a `.jsonl` file with one completed match per line

Those files are written to disk, not browser storage, so they avoid `localStorage` limits.

Notes:

- `--difficulty` accepts `easy`, `normal`, or `hard`
- the difficulty is included in the saved match metadata and in the generated filename
- if you omit `--difficulty`, the runner defaults to `normal`

## Hybrid Retraining

Train all three difficulty artifacts from saved match files:

```bash
npm run hybrid:train -- --input training-data
```

This command:

- reads all `.json` and `.jsonl` matches under `training-data`
- groups examples by recorded `aiDifficulty`
- writes fresh artifacts to:
  - `src/data/hybridPolicyArtifact.easy.json`
  - `src/data/hybridPolicyArtifact.normal.json`
  - `src/data/hybridPolicyArtifact.hard.json`

Train one difficulty only:

```bash
npm run hybrid:train -- --input training-data --difficulty hard
```

Optional knobs:

```bash
npm run hybrid:train -- --input training-data --epochs 12 --lr 0.05 --blend 14
npm run hybrid:train -- --input training-data --difficulty easy --output /tmp/hybridPolicyArtifact.easy.json
```

Notes:

- `hybrid:train` now defaults to `--difficulty all`
- `--difficulty` accepts `easy`, `normal`, `hard`, or `all`
- when you train `all`, do not pass `--output`; the script writes the three default artifact files together
- when you train a single difficulty, `--output` is optional and defaults to that difficulty's checked-in artifact path
- if any requested difficulty has no clean examples in the dataset, training fails so you do not silently ship a stale file

## Using `training export`

The in-game terminal command `training export` downloads two browser-side files:

- `chronodox-training-*.json`: full dataset, including tainted matches
- `chronodox-training-clean-*.json`: clean dataset only

Recommended handling:

1. keep the clean export as the default file for retraining
2. move the downloaded `.json` file into your project `training-data/` folder
3. you can mix browser-exported `.json` files with Node self-play `.json` and `.jsonl` files in the same folder
4. retrain from that folder with `npm run hybrid:train -- --input training-data`
5. if you want one preset only, add `--difficulty easy`, `--difficulty normal`, or `--difficulty hard`

Use the full export mainly for auditing or debugging. Use the clean export for model training unless you intentionally want to inspect tainted matches.

## Managing Browser Storage

Browser-side training data lives in local storage, so it is finite.

- after a completed match, the game now warns on the mission-end screen if storage is getting tight or a save failed
- `training clear` wipes the saved browser-side training archive so new completed matches can be stored again
- `training export` should be run before `training clear` if you want to keep the accumulated matches

## Reloading The New Artifact

The in-game hybrid AI now reads one artifact per difficulty:

- `src/data/hybridPolicyArtifact.easy.json`
- `src/data/hybridPolicyArtifact.normal.json`
- `src/data/hybridPolicyArtifact.hard.json`

After retraining:

1. keep each generated artifact in its matching path
2. restart `npm run dev` if your dev server is already running, or reload after rebuild
3. the AI will then use the heuristic generator plus the learned bonus from the artifact that matches the selected difficulty

Older artifacts still load safely after feature-set upgrades, but any newly added features score as
`0` until you retrain and regenerate that artifact.

## How Much Data Is Good

Practical starting points:

- `200-500` matches: enough to verify the pipeline works
- `1,000-3,000` matches: a reasonable first hybrid model
- `5,000+` matches: much better signal for stable improvements

If match quality is noisy, more data helps more than aggressive hyperparameter tuning.

## Quick Reference

Live match difficulty:

- start a new `VS AI` match
- pick `easy`, `normal`, or `hard` in the deployment panel

Browser self-play difficulty:

- terminal: `selfplay run 50 hard`
- terminal: `selfplay status`

Node self-play difficulty:

- `npm run selfplay -- --matches 500 --difficulty hard --out training-data/hard --prefix hard`

Hybrid training for all presets:

- `npm run hybrid:train -- --input training-data`

Hybrid training for one preset:

- `npm run hybrid:train -- --input training-data --difficulty hard`
