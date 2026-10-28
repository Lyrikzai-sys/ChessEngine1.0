import type { Color, PieceType } from '../engine';
import { type VoxelModel, VoxelGrid } from './voxelMesh';

/**
 * A weapon per piece, for the capture sequence.
 *
 * Each one is drawn from how the piece actually moves, so the set reads as a
 * single idea rather than six unrelated effects: the rook only ever travels in
 * straight lines, so it brings a battering ram; the bishop lives on the
 * diagonal, so it gets a faceted prism; the knight is the one piece that
 * leaps, so it carries a couched lance.
 *
 * Models are built pointing up the +Y axis and rotated toward the victim at
 * render time, which keeps the geometry independent of where on the board the
 * capture happens.
 */

const GRID = 14;
const C = Math.round((GRID - 1) / 2);

/** Three value steps per material: weapons move fast, so fine shading is lost. */
type Ladder = readonly [string, string, string];

interface Kit {
  steel: Ladder;
  wood: Ladder;
  gold: Ladder;
  gem: Ladder;
}

/**
 * The white set is cool and the black set is warm, matching the two piece
 * palettes, so a weapon reads as belonging to the side that swung it even
 * mid-flight over the far half of the board.
 */
const KITS: Record<Color, Kit> = {
  w: {
    steel: ['#2b3340', '#6d7b8d', '#c9d6e3'],
    wood: ['#4a4136', '#8a7a63', '#c7b79b'],
    gold: ['#6b5a1a', '#b9a24a', '#eadf9c'],
    gem: ['#13304a', '#2f7fb8', '#9fe4ff'],
  },
  b: {
    steel: ['#1a1410', '#423a33', '#6e635a'],
    wood: ['#2e1c0c', '#5a3a1a', '#8a5c2c'],
    gold: ['#5a3406', '#9a6a12', '#d8a63a'],
    gem: ['#2a0f2e', '#6b2470', '#c86fd0'],
  },
};

/** A square shaft up the middle — the spine of most of these. */
function shaft(g: VoxelGrid, y0: number, y1: number, half: number, hex: string) {
  g.box(C - half, y0, C - half, half * 2 + 1, y1 - y0, half * 2 + 1, hex);
}

/** A filled disc in the XZ plane, used for hafts and orbs. */
function disc(g: VoxelGrid, y: number, r: number, hex: string) {
  for (let x = C - r; x <= C + r; x++)
    for (let z = C - r; z <= C + r; z++)
      if ((x - C) ** 2 + (z - C) ** 2 <= r * r + r * 0.5) g.set(x, y, z, hex);
}

function buildSpear(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 34, GRID);
  shaft(g, 0, 24, 1, k.wood[1]);
  shaft(g, 0, 24, 0, k.wood[2]);
  // Leaf blade: widest a third of the way up, tapering to a point.
  for (let y = 24; y < 34; y++) {
    const w = Math.round(3 * Math.sin(Math.PI * Math.min(1, ((y - 24) / 10) * 1.15)));
    for (let x = C - w; x <= C + w; x++) {
      g.set(x, y, C, k.steel[2]);
      g.set(x, y, C - 1, k.steel[1]);
      g.set(x, y, C + 1, k.steel[1]);
    }
  }
  g.box(C - 2, 23, C - 2, 5, 1, 5, k.steel[0]); // collar under the blade
  return g;
}

function buildLance(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 40, GRID);
  // A couched lance is mostly length, banded so the spin reads in flight.
  for (let y = 0; y < 34; y++) {
    const half = y < 20 ? 1 : 0;
    shaft(g, y, y + 1, half, k.wood[y % 6 < 3 ? 1 : 2]);
  }
  for (let y = 34; y < 40; y++) g.set(C, y, C, k.steel[2]);
  // Vamplate: the cone that guards the hand.
  for (let y = 14; y < 18; y++) disc(g, y, 4 - (y - 14), k.steel[1]);
  return g;
}

function buildPrism(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 30, GRID);
  shaft(g, 0, 16, 0, k.gold[1]);
  // Two pyramids base to base; the outermost ring is brighter so facets read.
  for (let y = 16; y < 30; y++) {
    const r = Math.round(5 * Math.sin(Math.PI * ((y - 16) / 14)));
    for (let x = C - r; x <= C + r; x++) {
      for (let z = C - r; z <= C + r; z++) {
        const manhattan = Math.abs(x - C) + Math.abs(z - C);
        if (manhattan <= r) g.set(x, y, z, manhattan === r ? k.gem[2] : k.gem[1]);
      }
    }
  }
  return g;
}

function buildRam(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 32, GRID);
  // A banded log: the rook charges in a straight line and nothing else.
  for (let y = 0; y < 26; y++) {
    if (y % 8 < 2) { disc(g, y, 4, k.steel[0]); continue; }
    for (let x = C - 4; x <= C + 4; x++)
      for (let z = C - 4; z <= C + 4; z++)
        if ((x - C) ** 2 + (z - C) ** 2 <= 16) g.set(x, y, z, k.wood[1 + ((x + z) % 2)]);
  }
  // Iron head, squared off like the rook itself.
  for (let y = 26; y < 32; y++) {
    for (let x = C - 4; x <= C + 4; x++) {
      for (let z = C - 4; z <= C + 4; z++) {
        const rim = Math.abs(x - C) === 4 || Math.abs(z - C) === 4;
        g.set(x, y, z, rim ? k.steel[1] : k.steel[2]);
      }
    }
  }
  return g;
}

function buildGreatsword(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 38, GRID);
  g.box(C - 1, 0, C, 3, 8, 1, k.gold[0]);     // grip
  g.box(C - 1, 7, C - 1, 3, 1, 3, k.gold[2]); // pommel
  g.box(C - 4, 9, C, 9, 2, 1, k.gold[1]);     // crossguard
  // Broad blade with a bright fuller down the centre, tapering to a point.
  for (let y = 11; y < 34; y++) {
    const w = y > 29 ? Math.max(0, 3 - Math.round((y - 29) * 0.7)) : 3;
    for (let x = C - w; x <= C + w; x++) g.set(x, y, C, x === C ? k.steel[2] : k.steel[1]);
  }
  for (let y = 34; y < 38; y++) g.set(C, y, C, k.steel[2]);
  return g;
}

function buildScepter(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 32, GRID);
  shaft(g, 0, 22, 0, k.gold[1]);
  for (let y = 4; y < 22; y += 6) shaft(g, y, y + 1, 1, k.gold[2]);
  // Orb and cross: the king carries his own crown into the fight.
  for (let y = 22; y < 28; y++) disc(g, y, 3 - Math.abs(y - 25), k.gold[2]);
  for (let y = 28; y < 32; y++) g.set(C, y, C, k.gold[2]);
  g.box(C - 2, 29, C, 5, 1, 1, k.gold[2]);
  return g;
}

const BUILDERS: Record<PieceType, (kit: Kit) => VoxelGrid> = {
  P: buildSpear,
  N: buildLance,
  B: buildPrism,
  R: buildRam,
  Q: buildGreatsword,
  K: buildScepter,
};

/**
 * Sized so a weapon stands a little taller than the pawn that swings it. The
 * pieces are 1.5 units at their shortest, and a weapon that merely matched
 * that read as a smudge in motion.
 */
const VOXEL_SIZE = 2.1 / 34;

const cache = new Map<string, VoxelModel>();

export function weaponModel(type: PieceType, color: Color): VoxelModel {
  const key = `${type}${color}`;
  let model = cache.get(key);
  if (!model) {
    model = BUILDERS[type](KITS[color]).toModel(VOXEL_SIZE);
    cache.set(key, model);
  }
  return model;
}

export { VOXEL_SIZE as WEAPON_VOXEL_SIZE };
