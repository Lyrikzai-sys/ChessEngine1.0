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
