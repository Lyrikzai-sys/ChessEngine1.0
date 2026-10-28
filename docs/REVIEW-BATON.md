# Claude Baton — Chess Engine: Voxel Pieces, Weapons and the Capture Sequence

## Mission

Review the presentation layer that has been built on top of the chess engine
reviewed on 2026-10-27, and say whether it is ready to be a public repository.

The engine itself was reviewed in the previous round and has not been touched
since. **What is new is everything you can see**: the pieces, the board, the
per-piece weapons and the capture animation. That is also where the risk is,
because almost none of it is the kind of thing a test can fully pin down.

This is a review, not a build. The most useful output is a blunt opinion on
whether this reads as a serious engineering sample or as a toy with effects
bolted on.

## Location

This repository. It is its own git history, deliberately separate from the
application the engine came from, so it carries none of that project's
commits. **Not yet pushed to any remote.**

```
src/engine.ts            650   the engine (reviewed previously, unchanged)
src/voxel/voxelMesh.ts   155   sparse voxel grid + culled mesher
src/voxel/pieces.ts      320   the six chess pieces, 40 cells across
src/voxel/weapons.ts     298   six weapons + two projectiles + strike styles
src/ui/CombatEffects.tsx 526   strike animation + the shatter
src/ui/ChessGame.tsx     322   board state, capture sequencing
src/captureDemos.ts       61   staged positions, renderer-free so it is testable
```

`npm install && npm test` → **34 tests, 6 files, all passing.**
`npx tsc --noEmit` → clean.

```
test/perft.test.ts        14   engine move generation vs published node counts
test/weapons.test.ts       7   weapon models, styles, projectiles
test/game.test.ts          5   full games stay legal
test/captureDemos.test.ts  4   the six staged demo positions are legal
test/evaluation.test.ts    3   explainEvaluation matches evaluatePosition
test/palette-check.test.ts 1   no model references a missing palette slot
```

## What was built

### Voxel pieces

Pieces are generated as voxels in code — no model files ship, and nothing is
fetched at runtime. A `VoxelGrid` is filled by hand, then a culled mesher emits
only the faces touching air, as indexed geometry with per-vertex colour.

Resolution was argued up twice under direct criticism ("not enough voxels for
definition"). It settled at **40 cells across, 30–68 tall**. Below roughly 32
across, every piece collapses into the same turned blob and only height
distinguishes them. Shading is baked into a seven-step palette per side rather
than lit, because voxels have no smooth normals.

The light side deliberately tops out near 68% luminance. Brighter steps clipped
to white against the pale squares under the key light and the environment map,
and the whole light set dissolved.

### Six weapons, six animations

Weapon and animation are one decision, owned together in `weapons.ts` via
`WEAPON_STYLE`. The renderer switches on the style; it does not know what a
cannon is.

| piece | weapon | strike | seconds |
|---|---|---|---|
| pawn | arming sword | flat arc through the victim | 0.34 |
| knight | spear | couched, drawn back, driven through | 0.30 |
| bishop | crozier | looses a mote of light down the diagonal | 0.40 |
| rook | **cannon** | rolls up, recoils, throws a ball | 0.46 |
| queen | **holy staff** | calls down a column of light | 0.44 |
| king | greatsword | raised overhead, brought straight down | 0.38 |

Weapons are tinted to the side swinging them — cool for white, warm for black —
so they read mid-flight over the far half of the board.

### The shatter

This is the part worth looking at hardest, because it was wrong twice.

A captured piece is replaced by **every one of its surface voxels, as a real
cube, at its real size, in its real position**. The first frame is therefore
pixel-identical to the piece that was standing there; it stops being the piece
only because it is thrown apart. The debris is integrated against the board —
it arcs, lands, bounces once with most of the energy scrubbed off, tumbles and
fades.

Interior voxels are skipped. They were never visible, and a king drops from
10,650 cells to 3,841, so this is both cheaper and more correct.

## What went wrong, and how far to trust the fixes

Four real defects were found by looking at the thing rather than by any test.
I would like each of them independently checked.

**1. `<Physics>` blanked the entire board.** The first version drove the strike
through `@react-three/rapier`. `<Physics>` suspends while loading its WASM, and
the only `<Suspense>` boundary was nested *inside* it, so the suspend propagated
past the whole canvas: starting a capture blanked the board until the safety
timeouts fired.

The fix was to delete the dependency, not to move the boundary. The weapon
travels a deterministic curve between two known squares, so the impact time is
already known from that curve — Rapier was being paid a WASM dependency to
rediscover a number we had. **Please check I did not lose anything real here.**
The debris integrator that replaced it is about ten lines in
`CombatEffects.tsx`; the floor response in particular is tuned by eye, not
derived.

**2. The burst was a particle effect wearing voxel clothing.** The first
shatter strided through every ~20th cell and drew them as slightly oversized
cubes, so frame one was already a sparse cloud. This was my code, not the
previous reviewer's. Replaced as described above.

**3. Bursts came out near-black regardless of whose piece it was.** The stride
walked cells in build order, which is weighted toward the dark steps buried
inside the model. Taking only surface cells fixed the colour as a side effect of
fixing the sampling. **This is the one I would most like a second opinion on** —
the reasoning is that interior cells are invisible and therefore safe to drop,
and it held up on inspection, but it is an argument about what a reader will
notice, not a proof.

**4. Three weapons spawned inside the piece holding them.** The cannon, crozier
and staff stay put while they work, and were being placed at the attacker's own
square below the piece's full height. A bishop is tall enough to swallow a
cannon whole, which is why the cannon appeared to be missing entirely. They now
stand off to one side. **The offsets are hand-tuned and I am not confident they
hold for every square on the board** — in particular, a capture on a file edge
may push a weapon off the board. I did not test every square.

## Specific things to attack

1. **The per-square offsets.** `path.side` is a fixed lateral offset. Captures
   near the board edge, or along a file versus a diagonal, were not all checked.
   Worth a sweep.

2. **The frame loop cost.** The shatter updates up to 3,841 instanced matrices
   per frame in JS. It measured fine, but it was measured on one machine with a
   discrete GPU, by eye, not profiled. A reviewer with a laptop should say
   whether this drops frames.

3. **The commit timing.** The engine commits a move only after the animation
   resolves, so game state never knows the effects exist. That is the property I
   most want preserved — but it means every capture costs 1.1–1.3s of wall
   clock. Is that too slow to actually play? I think it is borderline.

4. **Three layers of timeout.** `useFrame` stops in a backgrounded tab, so
   neither the strike nor the burst can finish there. `ChessGame.tsx` carries
   two safety timeouts that force the sequence forward. They work, but three
   mechanisms racing to advance one state machine is a smell. Is there a
   cleaner formulation?

5. **The staged demos.** `captureDemos.ts` is hand-placed, square by square, and
   is the kind of arithmetic that fails silently — a transposed row is just a
   button that does nothing. It is tested, but check the test actually proves
   what it claims.

6. **Does the whole thing help or hurt?** Honest question. A chess engine with
   perft-verified move generation is a serious sample. A chess engine with
   exploding voxel knights might read as less serious to some reviewers, not
   more. Say so if you think so.

## Open items the owner has not decided

- **`src-tauri/` is untracked.** A Tauri desktop shell appeared in the repo and
  has deliberately not been committed, pending the owner's decision. `.gitignore`
  covers `src-tauri/target/` and `releases/` — together about 1.2GB of build
  output that must never land in a commit.
- **`tauri.conf.json` names the product "Sacred Chess"**, identifier
  `com.lyrikzai.sacredchess`. That is the proprietary application this engine
  was extracted from. In a public repository called ChessEngine1.0 that is at
  least confusing. Flagged twice; not resolved.
- **No README, no LICENSE, no CI.** Still outstanding from the previous baton.
- **Not pushed anywhere.**

## What is explicitly not in scope

The engine (`src/engine.ts`) was reviewed last round and is unchanged. The
caveat from that baton still stands and has not been re-checked: during the
original Wizard-mode strip, an automated brace-matching edit removed a
legitimate block and was restored from backup. The original is held privately
and can be diffed against on request, but that is last round's question, not
this one's.

## Commits in this round

```
4d5b901  Give each piece its own weapon, and shatter the real voxels
70ab056  Capture sequence: voxel weapons, bursts, and no physics engine
aeb604a  Rebuild the pieces at 40 cells across for actual definition
93f31b4  Rebuild the pieces as voxels, and correct three false claims
```

---

## Addendum — game-state UI, difficulty, and the Windows build

Added after the review above was written. Two further commits:

```
439675b  Restore the game-state UI and add a difficulty control
```

### What changed

Check, checkmate, stalemate and draw previously had no presentation beyond one
line of grey text at the bottom of the canvas. There is now a check badge at
the top of the board (coloured by whose king is attacked — the board cannot
show this, since a king in check looks exactly like a king) and a centred
result banner with a New game button. Difficulty is a vertical strip pinned to
the left edge: rating, slider, search depth.

`describeStrength(elo)` and `FULL_RULES_ELO` are now exported from
`engine.ts`, and `findBestMove` consumes them, so the difficulty panel and the
search read the same numbers instead of the interface restating them.

### A bug worth a second look

`isHumanTurn` excluded `checkmate` and `stalemate` but **not** `draw`, so a
drawn game carried on accepting moves. Both that check and the engine-reply
effect now use one `isOver` predicate. **Please check there is no third place
that enumerates terminal states separately** — I found two and fixed two, which
is exactly the situation where a third tends to exist.

### New tests

`test/outcomes.test.ts` reaches checkmate, stalemate and check from hand-built
positions and asserts the engine reports each one and that `isOver` agrees. The
first draft of the check case was wrong — it put a rook on rank 7 against a
king on rank 8 and asserted check, which the engine correctly denied. Worth
confirming the corrected positions are actually what they claim.

Totals now: **40 tests, 7 files, all passing.** `tsc --noEmit` clean.

### Windows desktop build — resolved, with a caveat worth recording

The repo carries an untracked Tauri shell. Building it failed repeatedly with
`C1083: Cannot open include file: 'excpt.h'`. The cause was **not** the project:

```
C:\Program Files\Microsoft Visual Studio\18\Community
  VC\Tools\MSVC\14.51.36231\include\   0 files
  VC\Tools\MSVC\14.51.36231\lib\       onecore only, no x64
  VC\Auxiliary\Build\vcvarsall.bat     missing
```

That install is broken. A **second, intact** toolchain was already present and
I did not check for it before escalating:

```
C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools
  VC\Tools\MSVC\14.50.35717\include\   271 files, excpt.h present
  VC\Tools\MSVC\14.50.35717\lib\x64\   108 files
```

`vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` names the
working one in a single call. Anyone building this on Windows should run that
first rather than trusting whichever Visual Studio is on PATH.

### Still open

Unchanged from the main baton: `src-tauri/` is deliberately untracked, the
Tauri product name is still "Sacred Chess" / `com.lyrikzai.sacredchess` inside
a repository called ChessEngine1.0, and there is still no README, LICENSE or
CI. Nothing is pushed to a remote.
