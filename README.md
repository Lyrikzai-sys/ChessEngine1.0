# Voxel Chess

A chess engine with a verified move generator, and a 3D board to play it on.
Every piece, weapon and effect is generated in code — no imported models, and
nothing fetched at runtime, so the desktop build works offline.

![The board](docs/images/board.jpg)

The engine is the point. Its move generation is checked against published
**perft** node counts, which are identical for every correct engine: the
initial position has exactly 197,281 legal continuations at depth 4. Matching
them is strong evidence the generator is right, and failing to is proof that
it is not.

| | |
|---|---|
| ![A capture, mid-strike](docs/images/strike.jpg) | ![The piece shattering](docs/images/shatter.jpg) |
| Each piece brings its own weapon | Captured pieces come apart into their own voxels |

---

## Running it

```bash
npm install
npm run dev
```

Then open the address Vite prints (`http://localhost:5173` by default).

### Desktop

Prebuilt Windows binaries are in [`releases/`](releases/) — an installer, and
an executable that runs without installing. Neither is code-signed, so
SmartScreen will warn on first run.

To build it yourself:

```bash
npm run tauri build
```

This needs the Rust toolchain and, on Windows, MSVC. See
[`releases/README.md`](releases/README.md) for a toolchain trap worth knowing
about before you spend an afternoon on it.

## Playing

You are white; the engine plays black in a Web Worker, so the board keeps
rendering while it thinks.

- **Click a piece**, then click one of the highlighted squares.
- **Drag** to orbit, **scroll** to zoom.
- **Engine strength** is the vertical slider on the left. It sets search depth,
  a blunder rate, and whether the engine reliably knows castling and en
  passant at all — below 1250 it mostly stumbles into them, so weak play reads
  as inexperience rather than as a smaller budget.
- **Preview capture** cycles six staged positions, one per attacking piece, so
  you can see all six weapons without playing a game into the right shape.

## Tests

```bash
npm test            # 43 tests
npm run typecheck
```

What they actually cover:

| file | what it proves |
|---|---|
| `test/perft.test.ts` | move generation against published node counts, four positions |
| `test/game.test.ts` | full games never reach an illegal position |
| `test/evaluation.test.ts` | the evaluation explainer sums to what the evaluator returns |
| `test/weapons.test.ts` | weapon models are solid, distinct, and legible in silhouette |
| `test/captureDemos.test.ts` | every staged demo position is legal and offers the capture it claims |
| `test/outcomes.test.ts` | checkmate, stalemate and check are actually reached and reported |

## How it works

- **`src/engine.ts`** — the whole engine, no imports. Minimax with alpha-beta
  pruning over its own move generator, captures ordered first. Evaluation on
  material, piece-square tables, mobility and check. Full rules: castling, en
  passant, promotion, check, checkmate, stalemate, draws.
- **`src/search.worker.ts`** — the search, off the main thread, with a sticky
  fallback to inline execution so a failed worker degrades instead of breaking.
- **`src/voxel/`** — a sparse voxel grid and a culled mesher that emits only
  the faces touching air. The pieces and the weapons are both built with it.
- **`src/ui/`** — React Three Fiber, lit with local lights only. The engine commits a move only after the
  capture animation resolves, so `engine.ts` never learns the effects exist.

[`docs/DESIGN-NOTES.md`](docs/DESIGN-NOTES.md) covers the decisions that were
not obvious — why resolution had to go up, why the physics engine came back
out, and three weapons that had to be redrawn because their silhouettes were
unreadable.

## License

MIT — see [LICENSE](LICENSE).
