import { describe, expect, it } from 'vitest';

import type { PieceType } from '../src/engine';
import { weaponModel } from '../src/voxel/weapons';
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

        expect(voxelCount(model), `${type}${color} is empty`).toBeGreaterThan(80);
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
