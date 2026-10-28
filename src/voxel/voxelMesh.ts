/**
 * Voxel core for the chess set and its capture effects.
 *
 * A model is a sparse grid of palette-indexed cells. At render time the mesher
 * emits only the faces exposed to air as indexed Three.js geometry with
 * per-vertex colour. That gives the pieces crisp, intentional silhouettes
 * without shipping any external model files.
 *
 * Keeping the compact grid is also useful for the game layer: the same cells
 * that form a king or knight can be sampled into fragments when that piece is
 * captured, rather than maintaining a separate explosion asset.
 */

export interface VoxelModel {
  /** Grid dimensions in cells. */
  size: [number, number, number];
  /** Hex colours; `cells` indexes into this. */
  palette: string[];
  /** Sparse pairs: [linearIndex, paletteIndex, linearIndex, paletteIndex, ...]. */
  cells: number[];
  /** World units per cell (default 0.1 — chunky-but-not-huge characters). */
  voxelSize?: number;
}

export interface VoxelMeshResult {
  positions: number[];
  index: number[];
  /** Flat rgb triples, one per vertex, already in 0..1. */
  colors: number[];
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  // sRGB -> approximately linear, so voxel colours match the rest of the
  // renderer (three.js works in linear space with ColorManagement on).
  const srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  return srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as [number, number, number];
};

/** Editable sparse grid used while building a model. */
export class VoxelGrid {
  readonly sx: number; readonly sy: number; readonly sz: number;
  private cells = new Map<number, number>();
  private palette: string[] = [];
  private paletteIndex = new Map<string, number>();

  constructor(sx: number, sy: number, sz: number) { this.sx = sx; this.sy = sy; this.sz = sz; }

  private idx(x: number, y: number, z: number) { return (y * this.sz + z) * this.sx + x; }
  private colorId(hex: string) {
    let i = this.paletteIndex.get(hex);
    if (i === undefined) { i = this.palette.length; this.palette.push(hex); this.paletteIndex.set(hex, i); }
    return i;
  }

  inBounds(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  set(x: number, y: number, z: number, hex: string) {
    if (!this.inBounds(x, y, z)) return;
    this.cells.set(this.idx(x, y, z), this.colorId(hex));
  }

  clear(x: number, y: number, z: number) {
    if (this.inBounds(x, y, z)) this.cells.delete(this.idx(x, y, z));
  }

  has(x: number, y: number, z: number) {
    return this.inBounds(x, y, z) && this.cells.has(this.idx(x, y, z));
  }

  /** Axis-aligned filled box, inclusive of min, exclusive of max. */
  box(x0: number, y0: number, z0: number, w: number, h: number, d: number, hex: string) {
    for (let y = y0; y < y0 + h; y++)
      for (let z = z0; z < z0 + d; z++)
        for (let x = x0; x < x0 + w; x++) this.set(x, y, z, hex);
  }

  /** Box mirrored across the X centre line — the workhorse for limbs. */
  boxMirrored(x0: number, y0: number, z0: number, w: number, h: number, d: number, hex: string) {
    this.box(x0, y0, z0, w, h, d, hex);
    this.box(this.sx - x0 - w, y0, z0, w, h, d, hex);
  }

  /** Only paint cells that are already solid — used for clothing over a body. */
  paintBox(x0: number, y0: number, z0: number, w: number, h: number, d: number, hex: string) {
    for (let y = y0; y < y0 + h; y++)
      for (let z = z0; z < z0 + d; z++)
        for (let x = x0; x < x0 + w; x++) if (this.has(x, y, z)) this.set(x, y, z, hex);
  }

  toModel(voxelSize = 0.1): VoxelModel {
    const cells: number[] = [];
    this.cells.forEach((c, i) => { cells.push(i, c); });
    return { size: [this.sx, this.sy, this.sz], palette: [...this.palette], cells, voxelSize };
  }
}

const FACES: Array<{ n: [number, number, number]; v: number[][] }> = [
  { n: [0, 0, 1],  v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] }, // +Z
  { n: [0, 0, -1], v: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] }, // -Z
  { n: [1, 0, 0],  v: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] }, // +X
  { n: [-1, 0, 0], v: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] }, // -X
  { n: [0, 1, 0],  v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] }, // +Y
  { n: [0, -1, 0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] }, // -Y
];

/**
 * Culled meshing: emit a quad only where a solid cell touches empty space.
 * Interior faces are skipped, which is the bulk of the savings; we deliberately
 * do NOT greedy-merge coplanar quads, because keeping one quad per face keeps
 * per-voxel colour trivial and gives the capture effect clean, even fragments.
 *
 * The model is centred on X/Z and rests on Y=0, so every chess piece sits
 * cleanly on its board square.
 */
export function meshVoxels(model: VoxelModel): VoxelMeshResult {
  const [sx, sy, sz] = model.size;
  const s = model.voxelSize ?? 0.1;
  const solid = new Map<number, number>();
  for (let i = 0; i < model.cells.length; i += 2) solid.set(model.cells[i], model.cells[i + 1]);
  const rgb = model.palette.map(hexToRgb);

  const at = (x: number, y: number, z: number) =>
    (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) ? undefined : solid.get((y * sz + z) * sx + x);

  const positions: number[] = [];
  const index: number[] = [];
  const colors: number[] = [];
  const ox = (sx * s) / 2, oz = (sz * s) / 2;

  solid.forEach((colorIdx, linear) => {
    const x = linear % sx;
    const z = Math.floor(linear / sx) % sz;
    const y = Math.floor(linear / (sx * sz));
    const c = rgb[colorIdx] || [1, 1, 1];

    for (const f of FACES) {
      if (at(x + f.n[0], y + f.n[1], z + f.n[2]) !== undefined) continue; // hidden interior face
      const base = positions.length / 3;
      for (const v of f.v) {
        positions.push((x + v[0]) * s - ox, (y + v[1]) * s, (z + v[2]) * s - oz);
        colors.push(c[0], c[1], c[2]);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  });

  return { positions, index, colors };
}

/** Solid-cell count — handy for UI readouts. */
export const voxelCount = (m: VoxelModel) => m.cells.length / 2;
