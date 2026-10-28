import type { Color, PieceType } from '../engine';
import { type VoxelModel, VoxelGrid } from './voxelMesh';

/**
 * A weapon per piece, and the kind of strike it makes.
 *
 * The weapon and the animation are one decision, not two: a cannon that swung
 * like a sword would be worse than no cannon. So this module owns both the
 * geometry and the `StrikeStyle` that says how it is used, and the renderer
 * just does what the style says.
 *
 * Models are built pointing up the +Y axis and oriented at render time, which
 * keeps the geometry independent of where on the board the capture happens.
 */

const GRID = 15;
const C = 7;

/** The cross-staff needs a wider bed than the rest for its crossbar. */
const CROSS_GRID = 19;
const CROSS_C = 9;

/** Three value steps per material: weapons move fast, so fine shading is lost. */
type Ladder = readonly [string, string, string];

interface Kit {
  steel: Ladder;
  wood: Ladder;
  gold: Ladder;
  gem: Ladder;
}

/**
 * The white set is cool and the black set warm, matching the two piece
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

/** The glow each side casts, for light a weapon emits rather than reflects. */
export const ACCENT: Record<Color, string> = { w: '#9fe4ff', b: '#ffd98a' };

/** How a piece uses its weapon. The renderer switches on this. */
export type StrikeStyle = 'slash' | 'thrust' | 'overhead' | 'cannon' | 'bolt' | 'channel';

export const WEAPON_STYLE: Record<PieceType, StrikeStyle> = {
  P: 'slash',     // short sword, swung in a flat arc
  N: 'thrust',    // spear, driven straight in
  B: 'bolt',      // crozier, looses a mote of light down the diagonal
  R: 'cannon',    // cannon, recoils and fires a ball
  Q: 'channel',   // holy staff, calls down a column of light
  K: 'overhead',  // greatsword, raised and brought straight down
};

/** Seconds from the weapon appearing to the moment it lands. */
export const STRIKE_SECONDS: Record<StrikeStyle, number> = {
  slash: 0.34,
  thrust: 0.3,
  overhead: 0.38,
  cannon: 0.46,
  bolt: 0.4,
  channel: 0.44,
};

/** Fraction of the strike spent winding up before the payload is committed. */
export const RELEASE_AT: Record<StrikeStyle, number> = {
  slash: 0.32,
  thrust: 0.34,
  overhead: 0.42,
  cannon: 0.36,
  bolt: 0.34,
  channel: 0.4,
};

/** A filled disc in the XZ plane, about an explicit centre. */
function discAt(g: VoxelGrid, y: number, radius: number, hex: string, c: number) {
  for (let x = c - radius; x <= c + radius; x++)
    for (let z = c - radius; z <= c + radius; z++)
      if ((x - c) ** 2 + (z - c) ** 2 <= radius * radius + radius * 0.5) g.set(x, y, z, hex);
}

/** The same, on the default grid axis. */
function disc(g: VoxelGrid, y: number, radius: number, hex: string) {
  discAt(g, y, radius, hex, C);
}

/**
 * One row of a blade: bright down the central fuller, darker along the flats
 * and the edges. Three cells deep rather than one, because a single-cell blade
 * disappears entirely when the swing turns it edge-on to the camera.
 */
function bladeRow(g: VoxelGrid, y: number, halfWidth: number, k: Kit) {
  for (let x = C - halfWidth; x <= C + halfWidth; x++) {
    const edge = Math.abs(x - C) === halfWidth;
    for (let z = C - 1; z <= C + 1; z++) {
      const flat = z !== C;
      g.set(x, y, z, edge ? k.steel[0] : flat ? k.steel[1] : k.steel[2]);
    }
  }
}

function blade(g: VoxelGrid, y0: number, y1: number, halfWidth: number, k: Kit) {
  for (let y = y0; y < y1; y++) bladeRow(g, y, halfWidth, k);
}

/** Taper a blade to a point over `height` rows. */
function point(g: VoxelGrid, y0: number, height: number, halfWidth: number, k: Kit) {
  for (let i = 0; i < height; i++) {
    const w = Math.max(0, halfWidth - Math.round((i / height) * (halfWidth + 1)));
    bladeRow(g, y0 + i, w, k);
  }
}

/** Pawn: an arming sword, short and broad enough to read at a glance. */
function buildSword(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 30, GRID);
  g.box(C, 0, C, 1, 7, 1, k.wood[1]);     // grip
  disc(g, 7, 1, k.gold[2]);               // pommel
  g.box(C - 3, 8, C, 7, 2, 1, k.gold[1]); // crossguard
  blade(g, 10, 25, 2, k);
  point(g, 25, 5, 2, k);
  return g;
}

/** Knight: a spear, the only piece that leaps carries the longest reach. */
function buildSpear(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 34, GRID);
  for (let y = 0; y < 24; y++) {
    disc(g, y, 1, k.wood[1]);
    g.set(C, y, C, k.wood[2]);
  }
  g.box(C - 2, 23, C - 2, 5, 1, 5, k.steel[0]); // collar under the head
  // Leaf blade: widest a third of the way up, tapering to a point.
  for (let y = 24; y < 34; y++) {
    const w = Math.round(3 * Math.sin(Math.PI * Math.min(1, ((y - 24) / 10) * 1.15)));
    for (let x = C - w; x <= C + w; x++) {
      g.set(x, y, C, k.steel[2]);
      g.set(x, y, C - 1, k.steel[1]);
      g.set(x, y, C + 1, k.steel[1]);
    }
  }
  return g;
}

/**
 * Bishop: a cross-staff.
 *
 * This was a crozier — the shepherd's crook — which is the historically
 * correct item and completely illegible as voxels. A 270-degree hook on a
 * thin pole is, silhouette for silhouette, a question mark, and at this
 * resolution the curl closed into a ring and read as a lollipop.
 *
 * A cross reads instantly at any size because the silhouette is two crossed
 * bars and nothing else, it still says bishop, and it cannot be confused with
 * the queen's halo. Flared tips and a gem at the crossing keep it from
 * flattening into a plain plus sign.
 */
function buildCrossStaff(k: Kit): VoxelGrid {
  const g = new VoxelGrid(CROSS_GRID, 40, CROSS_GRID);
  const c = CROSS_C;

  // Shaft, with a bright core so it does not read as a flat bar.
  for (let y = 0; y < 23; y++) {
    discAt(g, y, 1, k.gold[1], c);
    g.set(c, y, c, k.gold[2]);
  }
  for (let y = 4; y < 22; y += 6) discAt(g, y, 2, k.gold[2], c);

  // Knop: the swelling where the staff becomes the cross.
  for (let y = 23; y < 28; y++) discAt(g, y, 3 - Math.abs(y - 25), k.gold[2], c);

  const bar = (x0: number, y0: number, w: number, h: number, hex: string) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++)
        for (let dz = -1; dz <= 1; dz++) g.set(x, y, c + dz, dz === 0 ? hex : k.gold[1]);
  };

  bar(c - 1, 28, 3, 12, k.gold[2]);  // upright
  bar(c - 6, 32, 13, 3, k.gold[2]);  // crossbar

  // Flared tips, so the four ends widen instead of stopping dead.
  bar(c - 2, 38, 5, 2, k.gold[2]);   // top
  bar(c - 7, 31, 2, 5, k.gold[2]);   // left
  bar(c + 6, 31, 2, 5, k.gold[2]);   // right

  // The gem at the crossing is the mote this weapon throws.
  for (let y = 32; y < 35; y++)
    for (let x = c - 1; x <= c + 1; x++)
      for (let dz = -1; dz <= 1; dz++) g.set(x, y, c + dz, dz === 0 ? k.gem[2] : k.gem[1]);

  return g;
}

/**
 * Rook: a cannon. The rook fires down a rank; so does this.
 *
 * A plain tube is not a cannon — it is a pipe. What makes the shape read is
 * the taper from a heavy breech to a narrow muzzle, the trunnions it would
 * pivot on, and the cascabel knob at the back.
 */
function buildCannon(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 28, GRID);

  for (let y = 0; y < 3; y++) disc(g, y, 2, k.steel[0]);  // cascabel knob
  for (let y = 3; y < 9; y++) disc(g, y, 5, k.steel[1]);  // breech, the heavy end

  // Barrel tapers toward the muzzle, which is the whole silhouette.
  for (let y = 9; y < 25; y++) {
    const r = Math.round(5 - 2 * ((y - 9) / 16));
    for (let x = C - r; x <= C + r; x++) {
      for (let z = C - r; z <= C + r; z++) {
        const d2 = (x - C) ** 2 + (z - C) ** 2;
        if (d2 <= r * r) g.set(x, y, z, d2 > (r - 1) * (r - 1) ? k.steel[1] : k.steel[2]);
      }
    }
  }

  for (const ring of [12, 19]) disc(g, ring, 4, k.steel[0]); // reinforcing bands

  // Trunnions: the stubs a gun pivots on, and the detail that stops this
  // reading as a length of pipe.
  for (let y = 11; y < 14; y++) {
    for (let d = 3; d <= 6; d++) {
      g.set(C - d, y, C, k.steel[0]);
      g.set(C + d, y, C, k.steel[0]);
      g.set(C - d, y, C - 1, k.steel[1]);
      g.set(C + d, y, C + 1, k.steel[1]);
    }
  }

  for (let y = 25; y < 28; y++) disc(g, y, 4, k.steel[1]); // muzzle flare

  // Hollow the bore, so the muzzle reads as an opening rather than a stub.
  for (let y = 20; y < 28; y++)
    for (let x = C - 2; x <= C + 2; x++)
      for (let z = C - 2; z <= C + 2; z++)
        if ((x - C) ** 2 + (z - C) ** 2 <= 2.5) g.clear(x, y, z);

  return g;
}

/** Queen: a holy staff, crowned with a haloed gem. */
function buildHolyStaff(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 33, GRID);
  for (let y = 0; y < 24; y++) {
    disc(g, y, 1, k.gold[1]);
    g.set(C, y, C, k.gold[2]);
  }
  for (let y = 3; y < 22; y += 5) disc(g, y, 2, k.gold[2]);

  // Halo standing in the XY plane, so it reads as a ring from the side, two
  // cells deep so it does not vanish when seen edge-on mid-strike.
  for (let y = 23; y < 32; y++) {
    for (let x = C - 4; x <= C + 4; x++) {
      const d2 = (x - C) ** 2 + (y - 27.5) ** 2;
      if (d2 <= 16 && d2 >= 5.5) {
        for (let dz = -1; dz <= 1; dz++) g.set(x, y, C + dz, dz === 0 ? k.gold[2] : k.gold[1]);
      }
    }
  }
  for (const y of [26, 27, 28, 29]) {
    for (let dz = -1; dz <= 1; dz++) g.set(C, y, C + dz, dz === 0 ? k.gem[2] : k.gem[1]);
  }

  // Rays off the halo. Without them the ring is just a circle on a pole, and
  // a circle on a pole is the same silhouette problem the crozier had.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    for (let d = 4; d <= 5; d++) {
      g.set(Math.round(C + dx * d), Math.round(27.5 + dy * d), C, k.gold[2]);
    }
  }
  return g;
}

/** King: a greatsword, the heaviest thing on the board. */
function buildGreatsword(k: Kit): VoxelGrid {
  const g = new VoxelGrid(GRID, 38, GRID);
  g.box(C, 0, C, 1, 8, 1, k.wood[1]);     // grip
  disc(g, 8, 1, k.gold[2]);               // pommel
  g.box(C - 4, 9, C, 9, 2, 1, k.gold[1]); // crossguard
  blade(g, 11, 32, 3, k);
  point(g, 32, 6, 3, k);
  return g;
}

const BUILDERS: Record<PieceType, (kit: Kit) => VoxelGrid> = {
  P: buildSword,
  N: buildSpear,
  B: buildCrossStaff,
  R: buildCannon,
  Q: buildHolyStaff,
  K: buildGreatsword,
};

/** A solid ball, used for both things that get thrown. */
function buildBall(radius: number, shell: string, core: string): VoxelGrid {
  const size = radius * 2 + 3;
  const c = Math.floor(size / 2);
  const g = new VoxelGrid(size, size, size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const d2 = (x - c) ** 2 + (y - c) ** 2 + (z - c) ** 2;
        if (d2 <= radius * radius) g.set(x, y, z, d2 > (radius - 1) ** 2 ? shell : core);
      }
    }
  }
  return g;
}

/** Sized so a weapon stands a little taller than the pawn that swings it. */
const VOXEL_SIZE = 2.1 / 34;
const PROJECTILE_VOXEL_SIZE = 0.5 / 9;

const weaponCache = new Map<string, VoxelModel>();
const projectileCache = new Map<string, VoxelModel>();

export function weaponModel(type: PieceType, color: Color): VoxelModel {
  const key = `${type}${color}`;
  let model = weaponCache.get(key);
  if (!model) {
    model = BUILDERS[type](KITS[color]).toModel(VOXEL_SIZE);
    weaponCache.set(key, model);
  }
  return model;
}

/**
 * The ball a cannon fires, or the mote a crozier looses. Everything else
 * strikes with the weapon itself, so this is null for the other four.
 */
export function projectileModel(type: PieceType, color: Color): VoxelModel | null {
  if (type !== 'R' && type !== 'B') return null;

  const key = `${type}${color}`;
  let model = projectileCache.get(key);
  if (!model) {
    const kit = KITS[color];
    const grid = type === 'R'
      ? buildBall(4, kit.steel[0], kit.steel[1])
      : buildBall(4, kit.gem[1], kit.gem[2]);
    model = grid.toModel(PROJECTILE_VOXEL_SIZE);
    projectileCache.set(key, model);
  }
  return model;
}

export { VOXEL_SIZE as WEAPON_VOXEL_SIZE };
