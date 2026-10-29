# Design notes

Decisions in this project that were not obvious, and what forced them.

---

## The move generator is verified, not asserted

Chess engines fail quietly. A move generator can be wrong about en passant
for years and still look like it plays chess.

So correctness here is measured with **perft**: generate every legal move to a
fixed depth and count the leaf nodes. Those counts are published and identical
for every correct engine — the initial position has exactly 197,281 nodes at
depth 4. Matching them is strong evidence the generator is right; failing to
match them is proof that it is not.

`test/perft.test.ts` checks four positions, including Kiwipete (dense with
castling and pins) and two endgames chosen because they catch en-passant and
promotion mistakes specifically.

This mattered beyond correctness. The engine was extracted from a larger
application that added seven themed abilities, and removing them was
structural — it touched move kinds, state, `applyMove` and the evaluator, and
took the file from 973 lines to 650. Perft is what made that strip
demonstrably safe rather than hopefully safe.

## Rating is modelled, not just depth-limited

A weak engine that simply searches shallower plays like a strong engine with
less time: still inhuman, just worse. Here a rating sets three things —
search depth, a blunder rate, and whether the engine reliably knows castling
and en passant at all. Below 1250 it mostly stumbles into them.

The result reads as inexperience rather than as a smaller budget.

`describeStrength(elo)` is exported and the UI consumes it, so the difficulty
panel describes the engine from the same numbers the search uses. Two copies
of that table would drift, and the interface would start quietly lying about
what the setting does.

## Response time is a promise, not an outcome

The search used to run to one fixed depth, which made how long it thought a
property of the position. On an ordinary middlegame board the top rating took
about **seven seconds** — long enough that the game looks broken and the player
clicks again.

It now deepens iteratively against a wall-clock budget: search one ply, then
two, keeping the best move from the last pass that *finished*, and stop when
the budget is spent. A partially searched depth is discarded whole, because
its moves were scored against an incomplete window and the best of them is not
the best move.

That alone took the worst case from ~7,000 ms to ~517 ms. The budgets were
later raised deliberately when the difficulty bands were calibrated, so the
top one now spends up to 8,000 ms on purpose — but it spends it to a
schedule, which is the part that changed. What a setting costs is now a
number chosen in `describeStrength`, not a property of how busy the board
happens to be.

Two details that are easy to get wrong:

- **Re-searching shallower depths is not waste.** Each pass leaves the root
  moves ordered best-first for the next, and alpha-beta prunes far harder
  against a good first guess. Ordering by the previous pass is most of why
  this is affordable.
- **The deadline is sampled, and the interval has to suit the engine.**
  Reading the clock every node costs more than the work between nodes. The
  first version sampled every 1024 nodes, a figure borrowed from engines that
  run millions of nodes a second. This one managed a few thousand at the
  time, so a single gap was ~200 ms and a 180 ms budget overran to 281 ms.
  Sampling every 64 nodes bounds the overrun to one small batch without
  letting timer reads dominate. Throughput has since gone from roughly 3–7k
  to 16–20k nodes a second, which makes that interval cheaper rather than
  wrong: it is the *lower* bound on speed that decides how coarse a sample
  can safely be.

The honest trade: bounded latency costs depth, and the budgets were later
raised considerably when the difficulty bands were measured rather than
guessed (below).

Some of that depth was bought back. The search now carries a transposition
table keyed on placement, side to move, en passant and per-piece castling
rights, plus killer-move and history ordering, and it makes and unmakes moves
in place rather than cloning the position at every node. Against the same
budget the strongest band went from three plies to five.

Make/unmake is the part worth reading carefully, because it is where this
kind of change usually goes wrong. `makeSearchMove` writes new piece objects
instead of mutating the ones already on the board, and keeps the originals in
the undo record, so restoring a reference is enough and neither `hasMoved`
nor a promotion can leak back up the tree. Perft is what proves it: a state
restore that is even slightly wrong changes the node counts immediately.

One honest limit: `makeSearchMove` always increments the half-move clock and
never resets it on a pawn move or capture, so the search itself cannot see a
fifty-move draw. The game layer can, and unmake restores the counter, so this
costs accuracy inside the search rather than correctness outside it.

## The difficulty labels were guesses, so they were measured

A setting called "1200" is a claim about strength, and it was never checked.
When it finally was — by playing complete games in code against Elo-limited
Stockfish and Fairy-Stockfish — the band scored **0.02 and 0.00**. It lost 41
of 42 completed games to the opponent it was named after.

The top band was no better off: it lost 17 of 19 to Stockfish limited to
1320, and every game to two full-strength engines.

Raising the time budget helped a little (0.02 → 0.25). The fix that mattered
was **quiescence search**.

The search stopped at a fixed depth and evaluated whatever position it found
there, including positions in the middle of a capture sequence. A board where
your queen is about to be taken looks fine to a material count if the capture
happens one ply past the horizon. So the engine walked into exchanges it could
not see the end of, which is exactly the mistake that makes an engine feel
weak rather than merely shallow.

Searching captures — and all evasions when in check — out to a quiet position
first took the band from **0.02 to 0.70** against the same probe. The 0.70
result was then deliberately retuned down: the current 1200 setting uses a
440 ms budget and 8.5% weak-move rate, scoring **8W–6L (0.57)** over fourteen
completed games against the same probe.

What this does not prove: the samples are ten to fifty games at a fast time
control, and the figure is relative to one engine configuration, not a human
rating. It shows the collapse is fixed. It does not make the label exact, and
the top band has not been re-measured since quiescence landed.

The runner lives in `scripts/calibrate.mjs` and never opens the browser game;
engine strength has nothing to do with the renderer.

## Pieces are generated, not loaded

No model files ship. Each piece is built by filling a sparse voxel grid in
code; a culled mesher then emits only the faces that touch air, as indexed
geometry with per-vertex colour.

The scene is also lit entirely locally. Drei's `<Environment preset>` looks
richer, but it downloads an HDR map from a CDN at runtime — which left the
board black until the fetch landed, and would have broken the packaged
desktop build offline altogether. Three lights and a fill replaced it.

**Resolution was argued up twice.** Below roughly 32 cells across, every piece
collapses into the same turned blob and only height tells them apart. A chess
set is read at a glance, from above, at thumbnail size, so definition is not a
luxury. It settled at 40 across and up to 68 tall.

**Shading is baked into the palette, not lit.** Voxels have no smooth normals,
so a seven-step value ladder per side does the work a curved surface would:
dark in the hollows, bright along the flares. The light set deliberately tops
out near 68% luminance — brighter steps clipped to white against the pale
squares and the whole set dissolved.

## Silhouette is the whole job for weapons

Each piece brings a weapon drawn from how it moves: the rook a cannon, the
bishop a cross-staff, the knight a spear. Weapon and animation are one
decision, owned together, so the renderer switches on a style and never knows
what a cannon is.

These are seen small, in motion, against a busy board, so the outline is all
that survives — and three of them failed on exactly that:

- The bishop originally carried a **crozier**. Historically correct, and
  silhouette for silhouette a question mark: a 270° hook on a thin pole. At
  this resolution the curl closed into a ring and read as a lollipop.
- The **cannon** was a uniform tube, which is a pipe, not a gun.
- The queen's **halo** was a bare circle on a pole — the crozier's problem
  again.

All three were caught by eye, which is why `test/weapons.test.ts` now measures
the outline: no weapon may be a uniform stick, the cross-staff's bar must
dwarf its shaft, and the cannon must widen toward the breech.

## Captured pieces shatter into their own voxels

A captured piece is replaced by **every one of its surface voxels, as a real
cube, at its real size and position**. The first frame is therefore identical
to the piece that was standing there, and it stops being that piece only
because it is thrown apart. The debris integrates against the board: it arcs,
lands, bounces once with most of the energy scrubbed off, tumbles and fades.

The first attempt sampled every twentieth cell and drew them slightly
oversized, so frame one was already a sparse cloud — a particle effect wearing
voxel clothing.

Taking only *surface* voxels fixed a second bug as a side effect. Striding
through cells in build order is weighted toward the dark steps buried inside
the model, so bursts came out near-black whoever they belonged to. Interior
cells were never visible, so skipping them is both cheaper and more correct: a
king drops from 10,650 cells to 3,841.

## No physics engine

An earlier version drove the strike through a physics library. Two problems.

The weapon travels a deterministic curve between two known squares, so the
moment of impact is already known from that curve — the simulation was being
paid a WASM dependency to rediscover a number already in hand.

Worse, `<Physics>` suspends while loading that WASM, and the only `<Suspense>`
boundary sat inside it, so the suspend propagated past the entire canvas:
starting a capture blanked the whole board until a safety timeout fired.

Both problems disappeared with the dependency. What replaced it is a few lines
of integration against a flat floor.

## Game state never learns the effects exist

The engine commits a move only after the animation resolves. `engine.ts` has
no idea any of this is happening, which is what keeps it a chess engine rather
than a game.

The cost is honest: a capture takes roughly 1.1–1.3 seconds of wall clock.

## Known rough edges

- Weapons that stand still while they work are placed with hand-tuned lateral
  offsets. Captures very near a board edge were not exhaustively checked.
- The shatter updates up to 3,841 instanced matrices per frame in JavaScript.
  It measures fine on a discrete GPU; it has not been profiled on integrated
  graphics.
- `useFrame` stops in a backgrounded tab, so two safety timeouts exist to force
  a stalled capture sequence forward. Three mechanisms advancing one state
  machine works, but a cleaner formulation probably exists.
