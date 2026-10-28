import { describe, expect, it } from 'vitest';

import { CAPTURE_DEMOS, stagedPosition } from '../src/captureDemos';
import { applyMove, generateLegalMoves, legalMovesFromSquare } from '../src/engine';
import { WEAPON_STYLE } from '../src/voxel/weapons';

/**
 * The demo positions are placed by hand, square by square. A transposed row
 * and column, a blocked diagonal or a king left in check would all show up as
 * a button that silently does nothing, so each one is checked here instead.
 */
describe('staged capture demos', () => {
  it('covers every piece exactly once', () => {
    const attackers = CAPTURE_DEMOS.map((demo) => demo.attacker);
    expect([...attackers].sort()).toEqual(['B', 'K', 'N', 'P', 'Q', 'R']);
    expect(new Set(attackers).size).toBe(attackers.length);
  });

  it('offers the claimed capture as a legal move, from a legal position', () => {
    for (const demo of CAPTURE_DEMOS) {
      const state = stagedPosition(demo);

      // A position with no legal moves at all would mean the staging left
      // white checkmated or stalemated before the demo could start.
      expect(generateLegalMoves(state).length, `${demo.attacker}: no legal moves`).toBeGreaterThan(0);

      const move = legalMovesFromSquare(state, demo.attackerSquare)
        .find((m) => m.to?.[0] === demo.victimSquare[0] && m.to?.[1] === demo.victimSquare[1]);

      expect(move, `${demo.attacker} cannot reach its victim`).toBeDefined();
      expect(move!.capturedPiece, `${demo.attacker} move is not a capture`).toBeDefined();
      expect(move!.capturedPiece!.color).toBe('b');
    }
  });

  it('puts the right attacker on the attacking square', () => {
    for (const demo of CAPTURE_DEMOS) {
      const state = stagedPosition(demo);
      const piece = state.board[demo.attackerSquare[0]][demo.attackerSquare[1]];

      expect(piece, `${demo.attacker}: attacking square is empty`).not.toBeNull();
      expect(piece!.type).toBe(demo.attacker);
      expect(piece!.color).toBe('w');
      // Each attacker must map to a weapon, or the strike renders nothing.
      expect(WEAPON_STYLE[piece!.type]).toBeDefined();
    }
  });

  it('leaves a position the game can carry on from after the capture', () => {
    for (const demo of CAPTURE_DEMOS) {
      const state = stagedPosition(demo);
      const move = legalMovesFromSquare(state, demo.attackerSquare)
        .find((m) => m.to?.[0] === demo.victimSquare[0] && m.to?.[1] === demo.victimSquare[1])!;

      const after = applyMove(state, move);
      expect(after.turn).toBe('b');
      // Black is down to a lone king, but it must still have somewhere to go,
      // or the demo ends in a game-over banner instead of showing the weapon.
      expect(generateLegalMoves(after).length, `${demo.attacker}: black is stuck`).toBeGreaterThan(0);
    }
  });
});
