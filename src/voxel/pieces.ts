import type { PieceType } from '../engine';
import { type VoxelModel, VoxelGrid } from './voxelMesh';

/**
 * Chess pieces, built as voxels.
 *
 * Silhouette is the whole job here. A chess set is the purest test of
 * readable shape there is: six pieces, seen small, from above, at a glance,
 * and a player who mistakes a bishop for a pawn loses the game. So these are
 * authored silhouette-first and judged at thumbnail size, not by how they look
 * in a hero render.
 *
 * Three rules do the work:
 *
 *   Height is the primary signal. The ladder runs pawn through king with no
 *   ties, so even a blurred silhouette ranks correctly.
 *
 *   Each piece gets one unmistakable feature at the top: the rook's
 *   crenellations, the bishop's split mitre, the queen's ring of points, the
 *   king's cross, the knight's muzzle. Bases are deliberately similar so the
 *   eye goes straight to the differing part.
 *
 *   The palette is a value ladder, not a hue collection. Each side is one
 *   colour at three luminances: a dark base so pieces read as standing on the
 *   board rather than floating, a mid body, and a bright cap that catches the
 *   key light and separates the silhouette from the square behind it.
 */

/** Per-side value ladder: [shadow, body, highlight]. */
const PALETTE: Record<'w' | 'b', [string, string, string]> = {
  // Each side spans a real value range. The first attempt used three
  // near-whites for the light side; under the studio environment they
  // collapsed into one value and the pieces disappeared into the pale
  // squares. The darkest step now sits well below the board's light square
  // so every piece keeps a grounded base.
  w: ['#3f4a5a', '#8fa0b4', '#dbe4ee'],
  b: ['#5c2c0a', '#b07a1e', '#f2cf63'],
};

/** Grid is 16 wide and deep; height varies so the ladder reads at a glance. */
const GRID = 16;
const HEIGHTS: Record<PieceType, number> = { P: 11, R: 13, N: 15, B: 17, Q: 20, K: 22 };

/** A ring of cells at radius r, so bodies are round rather than boxy. */
function disc(g: VoxelGrid, cy: number, radius: number, hex: string) {
  const c = GRID / 2 - 0.5;
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const dx = x - c;
      const dz = z - c;
      if (dx * dx + dz * dz <= radius * radius) g.set(x, cy, z, hex);
    }
  }
}

/** A hollow ring, used for crowns and crenellations. */
function ring(g: VoxelGrid, cy: number, outer: number, inner: number, hex: string) {
  const c = GRID / 2 - 0.5;
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const d2 = (x - c) ** 2 + (z - c) ** 2;
      if (d2 <= outer * outer && d2 > inner * inner) g.set(x, cy, z, hex);
    }
  }
}

/** The base and stem every piece shares, so the tops carry the difference. */
function pedestal(g: VoxelGrid, color: 'w' | 'b', stemTop: number, stemRadius: number) {
  const [shadow, body] = PALETTE[color];
  disc(g, 0, 5.2, shadow);
  disc(g, 1, 5.0, shadow);
  disc(g, 2, 4.2, shadow);
  disc(g, 3, 3.4, body);
  for (let y = 4; y < stemTop; y++) disc(g, y, stemRadius, body);
}

function buildPawn(color: 'w' | 'b'): VoxelGrid {
  const [, body, hi] = PALETTE[color];
  const g = new VoxelGrid(GRID, HEIGHTS.P, GRID);
  pedestal(g, color, 7, 2.2);
  disc(g, 7, 3.0, body);   // collar
  disc(g, 8, 3.2, hi);     // head
  disc(g, 9, 3.0, hi);
  disc(g, 10, 2.1, hi);
  return g;
}

function buildRook(color: 'w' | 'b'): VoxelGrid {
  const [, body, hi] = PALETTE[color];
  const g = new VoxelGrid(GRID, HEIGHTS.R, GRID);
  pedestal(g, color, 9, 3.2);
  disc(g, 9, 3.8, body);
  ring(g, 10, 3.8, 2.0, hi);
  // Four merlons, the rook's one unmistakable feature.
  ring(g, 11, 3.8, 2.0, hi);
  for (const [x, z] of [[2, 7], [13, 7], [7, 2], [7, 13]] as const) {
    g.clear(x, 11, z);
    g.clear(x, 11, z + 1);
  }
  ring(g, 12, 3.8, 2.0, hi);
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const ang = Math.atan2(j - 7.5, i - 7.5);
      if (g.has(i, 12, j) && Math.abs(Math.cos(2 * ang)) < 0.45) g.clear(i, 12, j);
    }
  }
  return g;
}

function buildKnight(color: 'w' | 'b'): VoxelGrid {
  const [, body, hi] = PALETTE[color];
  const g = new VoxelGrid(GRID, HEIGHTS.N, GRID);
  pedestal(g, color, 8, 2.6);

  // Neck rising and leaning forward, then a muzzle pushed out over the board.
  // The horse is read from the side, so depth carries the shape, not width.
  for (let y = 8; y < 13; y++) {
    const lean = Math.floor((y - 8) * 0.8);
    g.box(6, y, 6 - lean, 4, 1, 5, body);
  }
  g.box(6, 13, 2, 4, 1, 7, hi);     // muzzle
  g.box(6, 14, 3, 4, 1, 4, hi);     // brow
  g.box(6, 12, 9, 4, 1, 3, body);   // mane at the back
  g.box(5, 14, 8, 2, 1, 2, hi);     // ears
  g.box(9, 14, 8, 2, 1, 2, hi);
  return g;
}

function buildBishop(color: 'w' | 'b'): VoxelGrid {
  const [, body, hi] = PALETTE[color];
  const g = new VoxelGrid(GRID, HEIGHTS.B, GRID);
  pedestal(g, color, 9, 2.4);
  disc(g, 9, 3.6, body);
  disc(g, 10, 3.2, body);
  disc(g, 11, 3.4, hi);
  disc(g, 12, 3.0, hi);
  disc(g, 13, 2.4, hi);
  disc(g, 14, 1.8, hi);
  disc(g, 15, 1.2, hi);
  disc(g, 16, 0.9, hi);
  // The mitre's slit, cut front to back.
  for (let y = 12; y < 16; y++) {
    g.clear(7, y, 7);
    g.clear(8, y, 7);
    g.clear(7, y, 8);
    g.clear(8, y, 8);
  }
  return g;
}

function buildQueen(color: 'w' | 'b'): VoxelGrid {
  const [, body, hi] = PALETTE[color];
  const g = new VoxelGrid(GRID, HEIGHTS.Q, GRID);
  pedestal(g, color, 11, 2.6);
  disc(g, 11, 3.5, body);
  disc(g, 12, 3.6, body);
  disc(g, 13, 3.6, hi);
  ring(g, 14, 3.8, 1.8, hi);
  // Eight points around the crown, the queen's signature.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.round(7.5 + Math.cos(a) * 3.4);
    const z = Math.round(7.5 + Math.sin(a) * 3.4);
    g.set(x, 15, z, hi);
    g.set(x, 16, z, hi);
  }
  disc(g, 17, 1.4, hi);
  disc(g, 18, 1.0, hi);
  return g;
}

function buildKing(color: 'w' | 'b'): VoxelGrid {
  const [, body, hi] = PALETTE[color];
  const g = new VoxelGrid(GRID, HEIGHTS.K, GRID);
  pedestal(g, color, 12, 2.8);
  disc(g, 12, 3.7, body);
  disc(g, 13, 3.8, body);
  disc(g, 14, 3.8, hi);
  ring(g, 15, 3.8, 1.9, hi);
  disc(g, 16, 2.4, hi);
  disc(g, 17, 1.8, hi);
  // The cross: tallest piece, most literal crown.
  for (let y = 18; y < 22; y++) g.box(7, y, 7, 2, 1, 2, hi);
  g.box(5, 19, 7, 6, 1, 2, hi);
  return g;
}

const BUILDERS: Record<PieceType, (c: 'w' | 'b') => VoxelGrid> = {
  P: buildPawn,
  R: buildRook,
  N: buildKnight,
  B: buildBishop,
  Q: buildQueen,
  K: buildKing,
};

/** Cells are 1/16 of a square, so a king stands a little over a square tall. */
const VOXEL_SIZE = 1.5 / 16;

const cache = new Map<string, VoxelModel>();

export function pieceModel(type: PieceType, color: 'w' | 'b'): VoxelModel {
  const key = `${type}${color}`;
  let model = cache.get(key);
  if (!model) {
    model = BUILDERS[type](color).toModel(VOXEL_SIZE);
    cache.set(key, model);
  }
  return model;
}

export { HEIGHTS as PIECE_VOXEL_HEIGHTS, VOXEL_SIZE };
