import { describe, expect, it } from 'vitest';

import type { PieceType } from '../src/engine';
import {
  RELEASE_AT,
  STRIKE_SECONDS,
  WEAPON_STYLE,
  projectileModel,
  weaponModel,
} from '../src/voxel/weapons';
import { meshVoxels, voxelCount } from '../src/voxel/voxelMesh';

const TYPES: PieceType[] = ['P', 'R', 'N', 'B', 'Q', 'K'];

/**
 * The capture effect is only worth having if a reviewer can tell which piece
 * struck, so these assert the thing that is easy to get wrong by hand: six
 * weapons that are actually six different shapes, every one of them meshable.
 */
describe('voxel weapons', () => {
  it('builds a solid, meshable model for every piece and colour', () => {
    for (const type of TYPES) {
      for (const color of ['w', 'b'] as const) {
        const model = weaponModel(type, color);

        expect(voxelCount(model), `${type}${color} is empty`).toBeGreaterThan(150);
        for (let i = 1; i < model.cells.length; i += 2) {
          expect(model.cells[i]).toBeLessThan(model.palette.length);
        }

        const mesh = meshVoxels(model);
        expect(mesh.positions.length).toBeGreaterThan(0);
        // One colour triple per vertex, three vertex components per position.
        expect(mesh.colors.length).toBe(mesh.positions.length);
        expect(mesh.index.length % 3).toBe(0);
      }
    }
  });

  it('gives each piece a silhouette no other piece shares', () => {
    const signatures = new Map<string, PieceType>();

    for (const type of TYPES) {
      const model = weaponModel(type, 'w');
      // Occupied cells per layer: a crude profile, but enough to catch two
      // builders that were accidentally left as the same shape.
      const [sx, sy, sz] = model.size;
      const layers = new Array<number>(sy).fill(0);
      for (let i = 0; i < model.cells.length; i += 2) {
        layers[Math.floor(model.cells[i] / (sx * sz))]++;
      }

      const signature = layers.join(',');
      const clash = signatures.get(signature);
      expect(clash, `${type} has the same profile as ${clash}`).toBeUndefined();
      signatures.set(signature, type);
    }
  });

  it('tints the weapon to the side that swings it', () => {
    for (const type of TYPES) {
      const white = weaponModel(type, 'w').palette.join();
      const black = weaponModel(type, 'b').palette.join();
      expect(white, `${type} is the same colour for both sides`).not.toBe(black);
    }
  });

  it('returns the cached model rather than rebuilding it per frame', () => {
    expect(weaponModel('Q', 'w')).toBe(weaponModel('Q', 'w'));
    expect(weaponModel('Q', 'w')).not.toBe(weaponModel('Q', 'b'));
  });
});

describe('strike styles', () => {
  it('gives every piece a style, and every style a timing', () => {
    for (const type of TYPES) {
      const style = WEAPON_STYLE[type];
      expect(style, `${type} has no strike style`).toBeDefined();
      expect(STRIKE_SECONDS[style], `${style} has no duration`).toBeGreaterThan(0);
      // The weapon has to be released before the blow lands, or the payload
      // never travels and the strike reads as a teleport.
      expect(RELEASE_AT[style]).toBeGreaterThan(0);
      expect(RELEASE_AT[style]).toBeLessThan(1);
    }
  });

  it('arms only the two pieces that throw something', () => {
    for (const type of TYPES) {
      for (const color of ['w', 'b'] as const) {
        const shot = projectileModel(type, color);
        if (type === 'R' || type === 'B') {
          expect(shot, `${type} should have a projectile`).not.toBeNull();
          expect(voxelCount(shot!)).toBeGreaterThan(40);
        } else {
          expect(shot, `${type} should strike with the weapon itself`).toBeNull();
        }
      }
    }
  });

  it('keeps the strike snappy enough to play through', () => {
    for (const style of Object.values(WEAPON_STYLE)) {
      expect(STRIKE_SECONDS[style], `${style} drags`).toBeLessThanOrEqual(0.5);
    }
  });
});

/**
 * Silhouette width per row, flattened through the depth axis.
 *
 * Shape is the whole job here: these are seen small, in motion, against a
 * busy board, so what matters is the outline. The bishop's first weapon was a
 * crozier, which is a correct crozier and reads as a question mark, and the
 * first cannon was a uniform tube that read as a pipe. Both were caught by
 * eye; these assertions are what stops them coming back.
 */
function profile(type: PieceType): number[] {
  const model = weaponModel(type, 'w');
  const [sx, sy, sz] = model.size;
  const solid = new Set<number>();
  for (let i = 0; i < model.cells.length; i += 2) solid.add(model.cells[i]);

  const widths: number[] = [];
  for (let y = 0; y < sy; y++) {
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < sx; x++) {
      for (let z = 0; z < sz; z++) {
        if (solid.has((y * sz + z) * sx + x)) { min = Math.min(min, x); max = Math.max(max, x); break; }
      }
    }
    widths.push(max < min ? 0 : max - min + 1);
  }
  return widths;
}

describe('weapon silhouettes', () => {
  it('are never a uniform stick', () => {
    for (const type of TYPES) {
      const solidRows = profile(type).filter((w) => w > 0);
      const widest = Math.max(...solidRows);
      const narrowest = Math.min(...solidRows);

      // A shape whose widest part barely exceeds its narrowest has no
      // features at all, and at this size reads as a rod.
      expect(widest / narrowest, `${type} has no shape to it`).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('give the cross-staff a bar far wider than its shaft', () => {
    const widths = profile('B');
    // The narrowest solid row is bare shaft; picking a row by index lands on
    // a decorative band instead and understates the ratio.
    const shaft = Math.min(...widths.filter((w) => w > 0));
    expect(Math.max(...widths) / shaft, 'crossbar is not distinct from the shaft').toBeGreaterThanOrEqual(4);
  });

  it('taper the cannon from breech to muzzle', () => {
    const widths = profile('R');
    const muzzle = widths[widths.length - 2];
    const breech = widths[5];
    // Built pointing +Y, so the muzzle is the high end.
    expect(breech, 'cannon does not widen toward the breech').toBeGreaterThan(muzzle);
  });
});
