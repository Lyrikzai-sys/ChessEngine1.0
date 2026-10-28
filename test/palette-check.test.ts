import { describe, expect, it } from 'vitest';
import { pieceModel } from '../src/voxel/pieces';
import type { PieceType } from '../src/engine';

describe('voxel models', () => {
  it('never reference a palette slot that does not exist', () => {
    const bad: string[] = [];
    for (const t of ['P','R','N','B','Q','K'] as PieceType[]) {
      for (const c of ['w','b'] as const) {
        const m = pieceModel(t, c);
        m.palette.forEach((hex, i) => {
          if (typeof hex !== 'string') bad.push(`${t}${c} palette[${i}] = ${hex}`);
        });
        for (let i = 1; i < m.cells.length; i += 2) {
          if (m.cells[i] >= m.palette.length) bad.push(`${t}${c} cell -> palette[${m.cells[i]}] of ${m.palette.length}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
