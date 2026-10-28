import type { PieceType } from '../engine';
import { type VoxelModel, VoxelGrid } from './voxelMesh';

/**
 * Chess pieces, built as voxels from classic Staunton silhouettes.
 *
 * Resolution is the whole argument. Earlier attempts at 16 and 24 cells across
 * could not hold a knight's muzzle or a bishop's mitre slit: below roughly 32
 * cells every piece collapses into the same turned blob and only height tells
 * them apart. A chess set is read at a glance, from above, at thumbnail size,
 * so definition is not a luxury. 40 across and up to 68 tall is what it takes.
 *
 * Shading is baked into the palette rather than lit. Voxels have no smooth
 * normals, so a seven-step value ladder per side does the work a curved
 * surface would: dark in the hollows and beneath the collars, bright along the
 * flares and the crown where a key light would catch.
 */

const GRID = 40;
const C = (GRID - 1) / 2;

const HEIGHTS: Record<PieceType, number> = { P: 30, R: 38, N: 46, B: 52, Q: 60, K: 68 };

/**
 * Seven steps, darkest first.
 *
 * The light side tops out near 68% luminance deliberately. A directional key
 * plus an environment map saturates anything brighter, and three earlier
 * attempts lost the entire light set to that clipping: the top steps flattened
 * to white and the pieces dissolved into the pale squares. Pewter reads on a
 * white square; white does not.
 */
const PALETTE: Record<'w' | 'b', string[]> = {
  w: ['#12161d', '#1f2733', '#333f50', '#4d5c71', '#6b7c93', '#8c9bb0', '#adbccb'],
  b: ['#2a1203', '#4a2407', '#6f3d0c', '#9a5f14', '#c08425', '#dfa93f', '#f3cd72'],
};

type Shade = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function disc(g: VoxelGrid, y: number, radius: number, hex: string) {
  const r2 = radius * radius;
  const lo = Math.max(0, Math.floor(C - radius));
  const hi = Math.min(GRID - 1, Math.ceil(C + radius));
  for (let x = lo; x <= hi; x++) {
    for (let z = lo; z <= hi; z++) {
      if ((x - C) ** 2 + (z - C) ** 2 <= r2) g.set(x, y, z, hex);
    }
  }
}

function ring(g: VoxelGrid, y: number, outer: number, inner: number, hex: string) {
  const lo = Math.max(0, Math.floor(C - outer));
  const hi = Math.min(GRID - 1, Math.ceil(C + outer));
  for (let x = lo; x <= hi; x++) {
    for (let z = lo; z <= hi; z++) {
      const d2 = (x - C) ** 2 + (z - C) ** 2;
      if (d2 <= outer * outer && d2 > inner * inner) g.set(x, y, z, hex);
    }
  }
}

type Stop = { y: number; r: number; s: Shade };

/** A turned profile: radius against height, swept into a solid. */
function lathe(g: VoxelGrid, color: 'w' | 'b', stops: Stop[]) {
  const pal = PALETTE[color];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const span = Math.max(1, b.y - a.y);
    for (let y = a.y; y < b.y; y++) {
      disc(g, y, a.r + (b.r - a.r) * ((y - a.y) / span), pal[a.s]);
    }
  }
  const last = stops[stops.length - 1];
  disc(g, last.y, last.r, pal[last.s]);
}

/** The flared, stepped base they all share, so the tops carry the difference. */
const BASE: Stop[] = [
  { y: 0, r: 13.0, s: 0 },
  { y: 2, r: 13.0, s: 1 },
  { y: 3, r: 12.2, s: 2 },
  { y: 4, r: 11.0, s: 1 },
  { y: 5, r: 9.4, s: 2 },
  { y: 7, r: 7.6, s: 3 },
  { y: 9, r: 6.0, s: 2 },
  { y: 11, r: 5.0, s: 3 },
];

function buildPawn(color: 'w' | 'b'): VoxelGrid {
  const g = new VoxelGrid(GRID, HEIGHTS.P, GRID);
  lathe(g, color, [
    ...BASE,
    { y: 13, r: 4.0, s: 3 },
    { y: 17, r: 3.4, s: 2 },
    { y: 18, r: 6.4, s: 4 },
    { y: 20, r: 5.2, s: 3 },
    { y: 21, r: 4.2, s: 4 },
    { y: 22, r: 5.6, s: 5 },
    { y: 26, r: 5.8, s: 6 },
    { y: 28, r: 4.2, s: 5 },
    { y: 29, r: 2.6, s: 5 },
  ]);
  return g;
}

function buildRook(color: 'w' | 'b'): VoxelGrid {
  const g = new VoxelGrid(GRID, HEIGHTS.R, GRID);
  const pal = PALETTE[color];
  lathe(g, color, [
    ...BASE,
    { y: 13, r: 5.6, s: 3 },
    { y: 24, r: 5.2, s: 3 },
    { y: 25, r: 7.0, s: 4 },
    { y: 27, r: 8.6, s: 5 },
    { y: 29, r: 8.6, s: 5 },
  ]);
  for (let y = 30; y < 38; y++) ring(g, y, 8.6, 5.6, pal[y > 34 ? 6 : 5]);
  // Four square gaps cut through the rim.
  for (let y = 31; y < 38; y++) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let d = -2; d <= 2; d++) {
        for (let depth = 5; depth <= 9; depth++) {
          const x = Math.round(C + dx * depth + (dx === 0 ? d : 0));
          const z = Math.round(C + dz * depth + (dz === 0 ? d : 0));
          g.clear(x, y, z);
        }
      }
    }
  }
  return g;
}

function buildKnight(color: 'w' | 'b'): VoxelGrid {
  const g = new VoxelGrid(GRID, HEIGHTS.N, GRID);
  const pal = PALETTE[color];
  lathe(g, color, [
    ...BASE,
    { y: 13, r: 5.4, s: 3 },
    { y: 17, r: 5.0, s: 3 },
    { y: 18, r: 6.2, s: 4 },
    { y: 20, r: 5.4, s: 3 },
  ]);

  const cx = Math.round(C);
  const slab = (y: number, z0: number, z1: number, s: Shade, w = 4) => {
    for (let x = cx - w; x <= cx + w; x++) {
      for (let z = Math.max(0, z0); z <= Math.min(GRID - 1, z1); z++) g.set(x, y, z, pal[s]);
    }
  };

  // Neck rises and leans forward over the board.
  for (let y = 20; y < 32; y++) {
    const lean = Math.round((y - 20) * 0.62);
    slab(y, 17 - lean, 25 - lean, y < 26 ? 3 : 4);
  }
  // Jaw and muzzle pushed well forward. The overhang is what makes a horse.
  for (let y = 30; y < 38; y++) {
    const drop = Math.max(0, 34 - y);
    slab(y, 5 + Math.round(drop * 0.4), 18, y < 34 ? 4 : 5);
  }
  slab(37, 7, 15, 5, 3);
  slab(38, 9, 15, 5, 2);
  for (let y = 38; y < 42; y++) slab(y, 11, 22, 5);
  slab(42, 13, 22, 6);
  slab(43, 15, 22, 6, 3);
  // Mane falls behind, darker so it separates from the skull.
  for (let y = 24; y < 44; y++) {
    const back = 23 + Math.round((44 - y) * 0.18);
    for (let x = cx - 3; x <= cx + 3; x++) {
      for (let z = back; z <= back + 3 && z < GRID; z++) g.set(x, y, z, pal[1]);
    }
  }
  for (const dx of [-3, 3]) {
    for (let y = 43; y < 46; y++) {
      g.set(cx + dx, y, 20, pal[6]);
      g.set(cx + dx, y, 21, pal[6]);
    }
  }
  // Eye and nostril punched dark, so the face reads at a glance.
  for (const dx of [-4, 4]) {
    for (let y = 37; y < 40; y++) {
      g.set(cx + dx, y, 16, pal[0]);
      g.set(cx + dx, y, 17, pal[0]);
    }
    g.set(cx + dx, 33, 7, pal[0]);
  }
  return g;
}

function buildBishop(color: 'w' | 'b'): VoxelGrid {
  const g = new VoxelGrid(GRID, HEIGHTS.B, GRID);
  lathe(g, color, [
    ...BASE,
    { y: 13, r: 4.6, s: 3 },
    { y: 22, r: 3.8, s: 2 },
    { y: 23, r: 7.2, s: 4 },
    { y: 25, r: 5.8, s: 3 },
    { y: 26, r: 7.4, s: 4 },
    { y: 34, r: 7.0, s: 5 },
    { y: 40, r: 5.0, s: 6 },
    { y: 45, r: 2.6, s: 6 },
    { y: 47, r: 1.6, s: 5 },
    { y: 48, r: 2.6, s: 6 },
    { y: 50, r: 2.2, s: 6 },
    { y: 51, r: 1.4, s: 5 },
  ]);
  // The mitre's slit, angled front to back.
  for (let y = 28; y < 44; y++) {
    const z0 = Math.round(C - 9 + (y - 28) * 0.42);
    for (let z = z0; z < z0 + 17 && z < GRID; z++) {
      for (const dx of [-1, 0, 1]) g.clear(Math.round(C) + dx, y, z);
    }
  }
  return g;
}

function buildQueen(color: 'w' | 'b'): VoxelGrid {
  const g = new VoxelGrid(GRID, HEIGHTS.Q, GRID);
  const pal = PALETTE[color];
  lathe(g, color, [
    ...BASE,
    { y: 13, r: 5.2, s: 3 },
    { y: 26, r: 4.2, s: 2 },
    { y: 27, r: 8.2, s: 4 },
    { y: 30, r: 6.6, s: 3 },
    { y: 31, r: 7.2, s: 4 },
    { y: 42, r: 9.4, s: 5 },
  ]);
  // Coronet: a toothed ring, ten points.
  for (let y = 43; y < 52; y++) ring(g, y, 9.4, 6.4, pal[y > 48 ? 6 : 5]);
  for (let y = 46; y < 52; y++) {
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.5) / 10) * Math.PI * 2;
      for (let w = -2; w <= 2; w++) {
        const ax = a + w * 0.045;
        for (const rad of [6.8, 7.6, 8.4, 9.2]) {
          g.clear(Math.round(C + Math.cos(ax) * rad), y, Math.round(C + Math.sin(ax) * rad));
        }
      }
    }
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.round(C + Math.cos(a) * 7.9);
    const z = Math.round(C + Math.sin(a) * 7.9);
    for (let y = 52; y < 54; y++) g.set(x, y, z, pal[6]);
  }
  lathe(g, color, [
    { y: 54, r: 3.0, s: 5 },
    { y: 56, r: 3.4, s: 6 },
    { y: 58, r: 2.2, s: 6 },
    { y: 59, r: 1.4, s: 5 },
  ]);
  return g;
}

function buildKing(color: 'w' | 'b'): VoxelGrid {
  const g = new VoxelGrid(GRID, HEIGHTS.K, GRID);
  const pal = PALETTE[color];
  lathe(g, color, [
    ...BASE,
    { y: 13, r: 5.6, s: 3 },
    { y: 28, r: 4.6, s: 2 },
    { y: 29, r: 8.6, s: 4 },
    { y: 32, r: 7.0, s: 3 },
    { y: 33, r: 7.6, s: 4 },
    { y: 46, r: 9.6, s: 5 },
  ]);
  for (let y = 47, i = 0; y < 55; y++, i++) ring(g, y, 9.6, 6.6, pal[i > 4 ? 6 : 5]);
  // Shallower notches than the queen's, so the two never confuse.
  for (let y = 52; y < 55; y++) {
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2;
      for (const rad of [7.2, 8.1, 9.0]) {
        g.clear(Math.round(C + Math.cos(a) * rad), y, Math.round(C + Math.sin(a) * rad));
      }
    }
  }
  lathe(g, color, [
    { y: 55, r: 4.4, s: 5 },
    { y: 57, r: 3.2, s: 6 },
  ]);
  // The cross: tallest piece, most literal crown.
  const cx = Math.round(C);
  for (let y = 58; y < 68; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      for (let z = cx - 2; z <= cx + 2; z++) g.set(x, y, z, pal[6]);
    }
  }
  for (let y = 61; y < 65; y++) {
    for (let x = cx - 7; x <= cx + 7; x++) {
      for (let z = cx - 2; z <= cx + 2; z++) g.set(x, y, z, pal[6]);
    }
  }
  return g;
}

const BUILDERS: Record<PieceType, (c: 'w' | 'b') => VoxelGrid> = {
  P: buildPawn, R: buildRook, N: buildKnight,
  B: buildBishop, Q: buildQueen, K: buildKing,
};

/** The base spans 26 cells, sized to sit inside a 1.5-unit square with air. */
const VOXEL_SIZE = 1.5 / 30;

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
