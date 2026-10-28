import { describe, expect, it } from 'vitest';

import {
  type GameState,
  applyMove,
  createInitialState,
  evaluatePosition,
  explainEvaluation,
  findBestMove,
} from '../src/engine';

/**
 * `explainEvaluation` restates `evaluatePosition` term by term so the demo can
 * show why a position scored what it did. Two implementations of one formula
 * drift apart silently, which is the whole reason this file exists: the
 * comment above `explainEvaluation` claims a test pins them together, and
 * until now that claim was false.
 */
describe('explainEvaluation', () => {
  it('totals to exactly what evaluatePosition returns, every ply of a game', () => {
    let state: GameState = createInitialState('standard');

    for (let ply = 0; ply < 24; ply++) {
      if (state.status === 'checkmate' || state.status === 'stalemate' || state.status === 'draw') break;

      for (const perspective of ['w', 'b'] as const) {
        const breakdown = explainEvaluation(state, perspective);
        expect(breakdown.total).toBe(evaluatePosition(state, perspective));
      }

      const move = findBestMove(state, 1600);
      if (!move) break;
      state = applyMove(state, move);
    }
  });

  it('reports the terms it claims to, and they sum to the total', () => {
    const state = createInitialState('standard');
    const b = explainEvaluation(state, 'w');

    expect(b).toHaveProperty('material');
    expect(b).toHaveProperty('position');
    expect(b).toHaveProperty('mobility');
    expect(b).toHaveProperty('check');
    expect(b.material + b.position + b.mobility + b.check).toBe(b.total);
  });

  it('is symmetric at the start: neither side is ahead on material or position', () => {
    const state = createInitialState('standard');
    const white = explainEvaluation(state, 'w');
    const black = explainEvaluation(state, 'b');

    expect(white.material).toBe(0);
    expect(black.material).toBe(0);
    expect(white.position).toBe(0);
    expect(black.position).toBe(0);
  });

});
