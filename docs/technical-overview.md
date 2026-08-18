# Chronodox Technical Overview

## 1. Project Summary

Chronodox is a browser-based, turn-driven strategy game built with React, TypeScript, Zustand, and Vite. Its core design revolves around three linked timelines, hidden information, shared traversal nodes, timeline collapse, and paradox mechanics. The project combines:

- a custom game engine implemented in TypeScript
- a React UI with animated timeline canvases
- a local/offline and browser-based AI self-play pipeline
- a simple online/LAN multiplayer transport implemented with a Node HTTP server
- an in-browser terminal interface that exposes game actions, diagnostics, and training workflows

Chronodox is not a generic web app with game-like visuals layered on top. The repository contains an actual rules engine, simulation loop, AI action generation system, training-data recorder, and retrainable hybrid policy artifacts.

## 2. Platform and Runtime Stack

### Frontend platform

- React 18.3.1 for UI composition
- React DOM 18.3.1 for browser rendering
- TypeScript 5.2.2 for typed application and engine code
- Vite 5.1.0 for development server and bundling
- Framer Motion 11.18.2 for screen and UI transitions
- Zustand 4.4.7 for client-side game state management
- Tailwind CSS 3.4.1 plus PostCSS and Autoprefixer for styling

### Backend / hosting platform

- Node.js runtime for:
  - static hosting of the built client
  - simple REST-style matchmaking and room-state APIs
  - offline self-play generation
  - offline hybrid policy training

### Browser platform features used

- `fetch` for room/queue networking
- `localStorage` for browser-side training dataset persistence
- `navigator.storage.estimate()` for storage-capacity checks
- `sessionStorage` for temporary save/restore of VS-AI sessions
- `ResizeObserver` for responsive canvas layout
- HTML audio elements for music and sound effects

## 3. Repository Structure

### Core gameplay engine

- `src/engine/actionResolver.ts`
- `src/engine/mapGenerator.ts`
- `src/engine/collapseRules.ts`
- `src/engine/intelSystem.ts`
- `src/engine/gameFactory.ts`
- `src/engine/terminal.ts`

### AI and training

- `src/engine/selfPlay.ts`
- `src/engine/aiTraining.ts`
- `src/engine/hybridPolicy.ts`
- `src/data/hybridPolicyArtifact.easy.json`
- `src/data/hybridPolicyArtifact.normal.json`
- `src/data/hybridPolicyArtifact.hard.json`
- `scripts/selfplay.ts`
- `scripts/train-hybrid.ts`
- `docs/ai-training.md`

### Frontend / app integration

- `src/App.tsx`
- `src/store/gameStore.ts`
- `src/canvas/TimelineCanvas.tsx`
- `src/components/*`

### Networking

- `src/network/onlineClient.ts`
- `src/network/gameSnapshot.ts`
- `scripts/host.mjs`

## 4. Game Model and State Architecture

The full gameplay model is defined in [`src/types/game.ts`](../src/types/game.ts). The central entities are:

- `TimePeriod`: `PAST`, `PRESENT`, `FUTURE`
- `PlayerId`: `P1`, `P2`
- `City`: location with normalized canvas coordinates, control state, and optional shared node identity
- `Route`: within-period edge between cities
- `Agent`: unit with:
  - origin period identity
  - current period
  - current city
  - hidden-information fields such as `cover`, `lastKnownCityId`, and `possibleCityIds`
  - action budget
  - deep-cover state
  - creation round for temporal-stability handling
- `GameState`: aggregate state for map, players, vision, rewards, log, current turn, and winner

### Important design choice

Chronodox distinguishes an agent's origin timeline (`period`) from its current timeline (`currentPeriod`). That separation is the backbone of:

- time traversal
- collapse propagation
- paradox checks
- “protect your past-origin agent” win condition

## 5. Map Generation and Spatial Algorithms

Map generation is implemented in [`src/engine/mapGenerator.ts`](../src/engine/mapGenerator.ts).

### Map characteristics

- Three separate timeline maps are generated for `PAST`, `PRESENT`, and `FUTURE`
- Each timeline contains a randomized set of cities
- Some cities are shared traversal nodes across two or three timelines via `nodeId`
- Routes exist only within a timeline; traversal links are implicit through shared nodes

### Procedural generation approach

The generator is stochastic, not seed-replay deterministic. It uses:

- randomized city-name assignment per period
- jittered sampling from predefined board slots
- minimum-distance rejection sampling for city placement
- optional multi-period and pairwise shared-node placement
- graph construction constrained by geometry

### Spatial optimization heuristics

The route builder uses several geometry-aware heuristics rather than a standard library graph generator:

- nearest-neighbor candidate selection
- edge crowding penalty based on:
  - endpoint proximity to other cities
  - point-to-segment distance for near-crossings or visually crowded edges
- angular spacing constraints at endpoints to avoid dense fan-outs
- node bonus to slightly favor edges touching traversal nodes
- center bias to slightly penalize edges that cluster toward the middle
- hard degree cap of 4 per city

This is effectively a constrained heuristic graph-layout optimization, not a formally optimal solver such as MST, simulated annealing, or ILP. The goal is readable tactical topology rather than mathematically optimal network structure.

## 6. Turn System and Core Rules

The main rules engine is in [`src/engine/actionResolver.ts`](../src/engine/actionResolver.ts).

### Turn structure

- Players act sequentially by `currentTurn` in the real-time/local control flow
- Each agent starts with 3 actions per round
- End of round:
  - deep-cover and temporary intel-operation flags are cleared
  - rewards are collected
  - intel is generated
  - rewards may spawn
  - action budgets are reset, including any extra-action bonuses

### Win and collapse conditions

Causal-collapse logic is implemented in [`src/engine/collapseRules.ts`](../src/engine/collapseRules.ts).

- Primary win condition:
  - if a player has no surviving `PAST`-origin agents, the opponent wins
- Timeline occupation:
  - if a period contains agents from only one player, it enters a held state instead of collapsing
  - if that hold survives the opposing turn, the holder gains `+20` intel in that period and `+1` action for agents in that timeline
  - foreign entry can force cover exposure unless deep cover was active before arrival
  - if foreign city control persists through the defender’s reply turn, the occupation bonuses shut off and the background returns to neutral
- If all agents die:
  - draw, or single-sided elimination win if only one side is empty

### Paradox system

Paradox handling is separate from collapse and is checked after actions.

- If the same owner creates duplicate same-origin presence at the same city/period combination, a paradox can destroy the city
- A paradox destroys:
  - the city
  - all connected routes touching that city
  - all agents currently at that city

This creates a risk-reward tension around traversal and temporal duplication.

### Temporal stability rule

If a player exceeds `MAX_AGENTS_PER_PERIOD` after forward traversal, the oldest agent in that period is removed. This acts as a hard cap to prevent runaway timeline flooding.

## 7. Resource and Information Systems

### Intel economy

Implemented in [`src/engine/intelSystem.ts`](../src/engine/intelSystem.ts).

- Base intel per round per occupied period: `2`
- Additional intel per controlled city in a period: `2`
- Starting intel: `10` in each period for each player

### Intel operation costs

From [`src/types/game.ts`](../src/types/game.ts):

- `TRAVERSE`: 20
- `ENCRYPTION`: 25
- `RAPID_RECON`: 40
- `LOCATE`: 10
- `STRIKE_REPORT`: 10
- `DEEP_COVER`: 20
- `PREPARE_ACTION`: 40
- `MULTI_TIMELINE_STRIKE`: 15

### Hidden information model

Chronodox has a meaningful imperfect-information system:

- agents may be under cover
- each enemy agent can have:
  - revealed exact position
  - last known city
  - a set of possible positions
- vision is updated after actions, turn boundaries, controlled-city contact, locate actions, rapid recon, and traversal effects

This is more sophisticated than a simple fog-of-war boolean. The game tracks uncertainty sets, which are later reused as ML features.

## 8. Player Tools and Skills

There are two meanings of “skills” in this project:

1. gameplay skills / agent abilities
2. developer/runtime capabilities exposed by the codebase

### 8.1 Gameplay skills and actions

Supported action types are defined in [`src/types/game.ts`](../src/types/game.ts) and parsed in [`src/engine/terminal.ts`](../src/engine/terminal.ts).

- `MOVE`
  - move to an adjacent city
  - restores cover
- `WAIT`
  - spend an action without moving
  - updates hidden-position possibilities
- `CONTROL`
  - capture the current city
  - reveals the agent
- `STRIKE`
  - attack an enemy at the same city
  - one target eliminated per strike
  - if the multi-strike upgrade has been purchased, strikes also hit linked overlap cities
- `TRAVERSE`
  - real cross-timeline movement through a shared node
  - moving forward spawns a new agent copy
  - moving backward relocates the current agent
- `LOCATE`
  - reveals enemy agents in the same timeline unless deep cover blocks it
- `STRIKE_REPORT`
  - if active on the victim side, successful strikes reveal the attacker
- `DEEP_COVER`
  - strengthens stealth and modifies visibility behavior
- `PREPARE_ACTION`
  - grants extra action capacity for the next round
- `ENCRYPTION`
  - obscures intel-operation labels from the opponent
- `RAPID_RECON`
  - improves contact-based reveal behavior
- `MULTI_TIMELINE_STRIKE`
  - shop-only permanent upgrade that converts future strikes into cross-timeline strikes

### 8.2 Terminal tools

The in-game shell in [`src/engine/terminal.ts`](../src/engine/terminal.ts) exposes:

- navigation and status tools:
  - `status`, `intel`, `map`, `routes`, `agents`, `scan`, `node`
- action-entry tools:
  - `move`, `wait`, `control`, `strike`, `traverse`, `multi-strike`, `locate`, `prepare`, etc.
- log and debug tools:
  - `tail`, `grep`, `history`, `killfeed`, `locate-report`
- training tools:
  - `selfplay run`
  - `selfplay status`
  - `training status`
  - `training audit`
  - `training export`
  - `training clear`
- privilege simulation tools:
  - `su`, `sudo`, `passwd`

That terminal is not cosmetic only. It is wired into game control and training-data workflows.

## 9. AI System: Design and Behavior

Chronodox uses a hybrid AI in [`src/engine/actionResolver.ts`](../src/engine/actionResolver.ts) and [`src/engine/hybridPolicy.ts`](../src/engine/hybridPolicy.ts).

### 9.1 Baseline AI policy

The baseline AI is heuristic and candidate-based.

For each agent with actions remaining, the engine generates a set of legal or semi-legal candidate actions and assigns heuristic scores using tactical signals such as:

- enemy presence at the same node
- ownership state of the current or destination city
- visible enemies in the current period
- whether the agent is at a traversal node
- whether high-value intel abilities are available
- target pressure in another timeline after traversal

Examples:

- immediate `STRIKE` gets a very high base score
- `CONTROL` is strongly favored on uncaptured or enemy-controlled cities
- `TRAVERSE` scoring depends on target control value and enemy pressure
- `LOCATE`, `RAPID_RECON`, and `STRIKE_REPORT` are valued situationally

The AI then sorts candidates by `heuristic_score + learned_bonus + noise` and picks the highest-ranked valid action.

### 9.2 Learned policy component

The learned part is a linear scoring model, not a deep neural network and not a tree-search policy.

- feature extractor: hand-engineered tactical/state features
- model family: linear regression over action-state feature vectors
- runtime use: additive bonus on top of heuristic AI scores, using the artifact that matches the selected AI difficulty
- blend control: artifact `blend` scalar multiplies learned score before merging

Checked-in difficulty-specific artifacts live at:

- [`src/data/hybridPolicyArtifact.easy.json`](../src/data/hybridPolicyArtifact.easy.json)
- [`src/data/hybridPolicyArtifact.normal.json`](../src/data/hybridPolicyArtifact.normal.json)
- [`src/data/hybridPolicyArtifact.hard.json`](../src/data/hybridPolicyArtifact.hard.json)

The repository currently seeds those three files from the same baseline artifact so the game remains playable immediately, but the training pipeline can now regenerate them independently.

### 9.3 Feature engineering

The hybrid model uses 59 named features. These include:

- normalized round count
- per-period player intel
- per-period opponent intel
- player and opponent agent counts
- controlled-city delta
- destroyed-city count
- reward count
- acting-agent action budget
- cover state
- one-hot origin/current/target periods
- one-hot action type
- agent advantage
- same-node enemy pressure
- destination enemy pressure
- paradox risk
- control opportunity
- traversal leverage
- past-origin survival importance
- revealed and hidden enemy counts
- uncertainty pressure
- strike viability
- multi-timeline strike viability
- target city metadata:
  - node status
  - reward occupancy
  - ownership class
- contact reveal chance
- same-node allied support

This is a manually designed feature space intended to encode tactical reasoning and hidden-information pressure explicitly.

## 10. Training Pipeline

### 10.1 Data collection

Training collection is implemented in [`src/engine/aiTraining.ts`](../src/engine/aiTraining.ts).

For each recorded action, the system stores:

- acting player
- round number
- action type
- acting agent ID
- optional target city and target period
- a player-perspective state snapshot
- final reward label

Reward labels are outcome-based:

- `+1` win
- `0` draw
- `-1` loss

### 10.2 Match-level data hygiene

The dataset supports match tainting.

- matches can be marked `tainted`
- taint reasons are stored
- offline retraining skips tainted matches

This is useful because the game exposes privileged/testing commands, and the training pipeline explicitly tries to avoid learning from manipulated sessions.

### 10.3 Self-play generation

Self-play is implemented in [`src/engine/selfPlay.ts`](../src/engine/selfPlay.ts) and wrapped by [`scripts/selfplay.ts`](../scripts/selfplay.ts).

Default script behavior:

- `matches`: 100
- `maxRounds`: 40
- outputs:
  - one large `.json`
  - one line-delimited `.jsonl`

The self-play loop:

1. creates a fresh random map
2. runs AI vs AI using the current hybrid-augmented policy
3. records each executed action
4. terminates on win, draw cap, or safety limit
5. writes complete persisted matches to disk

### 10.4 Training method

Training is implemented in [`scripts/train-hybrid.ts`](../scripts/train-hybrid.ts).

This is plain linear regression trained with iterative gradient updates:

- weights initialized to zero
- model prediction: dot product `w · x`
- loss proxy during training: squared error against final reward
- update rule:
  - `weights[i] -= lr * error * feature[i]`
- training proceeds example-by-example across multiple epochs

This is effectively stochastic/online gradient descent over a linear model, with:

- default epochs: `8`
- default learning rate: `0.08`
- default blend written to artifact: `12`

### 10.5 What it is not

The Chronodox training system does **not** currently use:

- supervised softmax classification
- policy gradients
- Q-learning
- Monte Carlo Tree Search
- minimax / alpha-beta search
- neural networks
- embeddings
- GPU acceleration
- replay-buffer prioritization
- train/validation/test splits
- regularization terms such as L1/L2
- batch normalization or optimizer families like Adam/RMSProp

This matters because the project is much lighter-weight and easier to reason about than a modern deep-RL stack, but it also has lower modeling capacity.

## 11. Optimization Algorithms Used

To be technically precise, the repository uses several kinds of optimization or scoring logic:

### Explicit optimization / learning

- linear regression via online gradient descent
- mean squared error computation for artifact reporting

### Heuristic scoring / search

- candidate-action generation with weighted tactical heuristics
- greedy best-action selection from scored candidates
- shortest-path search for tutorial logic using BFS-style traversal in the store layer

### Procedural layout heuristics

- rejection sampling for city placement
- geometric penalty minimization for route readability
- constrained graph construction under angular and degree limits

These are mostly heuristic optimization techniques, not global-optimum solvers.

## 12. Networking and Multiplayer Model

Networking is split between client and server.

### Client

- [`src/network/onlineClient.ts`](../src/network/onlineClient.ts)
- [`src/network/gameSnapshot.ts`](../src/network/gameSnapshot.ts)

Client responsibilities:

- queue join/poll/cancel
- private room create/join/leave
- room readiness updates
- room presence updates
- room state push/pull
- serialization/deserialization of `Map`, `Set`, and `Map<string, string[]>` data structures

### Server

- [`scripts/host.mjs`](../scripts/host.mjs)

Server responsibilities:

- serve built static assets from `dist/`
- expose `/api/presence`
- manage queue tickets
- create and manage rooms
- track connected/ready players
- gate room activation with a 3-second countdown
- maintain authoritative room revision numbers
- reject stale client writes on revision mismatch

This is a lightweight in-memory coordination server. It is appropriate for local/LAN or small hobby deployment, but not a hardened production backend.

## 13. State Management and App Integration

The main application state is centralized in [`src/store/gameStore.ts`](../src/store/gameStore.ts).

It handles:

- game initialization
- local action execution
- AI turn scheduling
- tutorial orchestration
- online synchronization state
- audio/UI settings
- terminal history and privilege state
- training session lifecycle
- collapse/traversal effect timers

This makes the store more of an application orchestrator than a simple data cache.

### Architectural consequence

This is convenient for a solo or small-team game project because the control flow is easy to trace in one place, but the store is also large and highly responsible. Over time, that increases coupling between gameplay, UI state, tutorial state, networking, and training workflows.

## 14. Build and Tooling

### Package scripts

From [`package.json`](../package.json):

- `npm run dev`
  - Vite development server
- `npm run build`
  - TypeScript compile plus Vite production build
- `npm run host`
  - build then start Node host server
- `npm run preview`
  - Vite preview
- `npm run selfplay`
  - build Node self-play bundle then run it
- `npm run hybrid:train`
  - build Node training bundle then run it

### Build configuration

- [`vite.config.ts`](../vite.config.ts)
  - React plugin
  - relative asset base
  - manual chunking into `react-vendor`, `motion-vendor`, and `vendor`
- [`vite.selfplay.config.ts`](../vite.selfplay.config.ts)
  - SSR bundle for self-play runner into `.selfplay-dist/`
- [`vite.train.config.ts`](../vite.train.config.ts)
  - SSR bundle for training runner into `.train-dist/`

This split build setup is a nice detail: the project cleanly distinguishes browser app bundling from Node-side simulation/training bundling.

## 15. Strengths of the Project

### Strong design positives

- The game rules are genuinely original and mechanically coherent
- Time-travel and hidden-information systems are structurally encoded in state, not faked in UI
- The AI pipeline is practical and inspectable
- The training workflow is integrated into the product experience through terminal commands and browser export
- The project uses typed domain models consistently
- The Node host server is intentionally simple and easy to run
- The hybrid policy artifact is forward-compatible with feature-set changes through artifact normalization

### Engineering positives

- Good separation between engine, UI, training, and networking modules
- Training data captures uncertainty and map structure, which is unusually thoughtful for a lightweight project
- Revision-based room synchronization prevents silent overwrite conflicts
- Procedural map generation includes nontrivial geometry/readability heuristics

## 16. Limitations and Technical Cons

### AI and ML limitations

- The learned policy is linear, so it cannot model high-order nonlinear interactions directly
- Rewards are sparse and terminal-only, which can blur credit assignment
- There is no legal-action mask inside the model itself; legality is handled externally by candidate generation
- There is no offline benchmark/evaluation harness in the repository to compare artifacts rigorously
- No data split or held-out validation is used
- No regularization or optimizer tuning beyond epochs and learning rate

### Gameplay / engine limitations

- Some action resolution remains heuristic/greedy rather than adversarially searched
- Real simultaneity is approximated; `resolveActions` uses shuffle order, but much play flow is effectively sequential
- Map generation is randomized but not reproducible from persisted seeds
- Training labels are coarse outcome labels rather than dense strategic values

### Platform / operations limitations

- Browser-side training storage relies on `localStorage`, which is limited and fragile for large datasets
- The host server is in-memory only:
  - no durable room persistence
  - no authentication
  - no horizontal scaling
  - no rate limiting
- `gameStore.ts` is a large orchestration module and likely future refactor pressure point

## 17. Technical Assessment of the Project as a Whole

Chronodox is best understood as a custom strategy game engine with an embedded experimentation loop for lightweight game AI. Its most interesting technical property is that the project does not separate “gameplay code” from “AI research code” with a hard boundary. Instead, the same rules engine powers:

- user-facing matches
- AI-vs-AI self-play
- training-data generation
- retraining of a deployable policy artifact

That makes it a coherent full-stack game simulation project rather than just a frontend prototype.

From an engineering perspective, the project sits in a strong middle ground:

- more technically serious than a typical hobby React game because it includes procedural map generation, state serialization, hidden-information tracking, offline training, and multiplayer synchronization
- lighter and more maintainable than a deep-RL or authoritative server game stack because it relies on interpretable heuristics and a linear model

The biggest strategic strength is interpretability. The biggest strategic weakness is ceiling. The current hybrid policy is easy to train, debug, and ship, but it will eventually hit limits against stronger tactical complexity because linear models with terminal rewards cannot fully capture long-horizon, nonlinear time-travel interactions.

## 18. Recommended Next Technical Steps

If the goal is to improve the project without overcomplicating it, the highest-value next steps are:

1. Add an offline evaluation harness for artifact-vs-artifact and artifact-vs-heuristic comparisons.
2. Add deterministic seeds to map generation and self-play for reproducible experiments.
3. Record legal-action masks and maybe candidate ranks during training.
4. Introduce train/validation splits and artifact metadata for experiment tracking.
5. Consider a slightly richer model before jumping to deep learning:
   - regularized linear model
   - shallow boosted trees
   - pairwise ranking objective over candidate actions
6. Split `gameStore.ts` into gameplay, tutorial, terminal, audio, and online slices.

## 19. Key Files to Read First

- [`src/types/game.ts`](../src/types/game.ts)
- [`src/engine/actionResolver.ts`](../src/engine/actionResolver.ts)
- [`src/engine/mapGenerator.ts`](../src/engine/mapGenerator.ts)
- [`src/engine/hybridPolicy.ts`](../src/engine/hybridPolicy.ts)
- [`src/engine/aiTraining.ts`](../src/engine/aiTraining.ts)
- [`src/engine/selfPlay.ts`](../src/engine/selfPlay.ts)
- [`scripts/train-hybrid.ts`](../scripts/train-hybrid.ts)
- [`src/store/gameStore.ts`](../src/store/gameStore.ts)
- [`scripts/host.mjs`](../scripts/host.mjs)
