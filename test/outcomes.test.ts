import { describe, expect, it } from 'vitest';

import {
  type Color,
  type Coord,
  type GameState,
  type PieceType,
  applyMove,
  createInitialState,
  describeStrength,
  FULL_RULES_ELO,
  legalMovesFromSquare,
} from '../src/engine';
import { isOver } from '../src/ui/GameOverlay';

/**
 * The result banner and the check badge are driven entirely by
 * `state.status`, so what is worth testing is not the markup but that the
 * engine actually reaches those states and that `isOver` agrees about which
 * ones end the game. A banner that never appears looks identical to one that
 * was never written.
 */

function emptyBoard(): GameState {
  const state = createInitialState('standard');
  state.board = Array.from({ length: 8 }, () => Array(8).fill(null));
  return state;
}

function put(state: GameState, at: Coord, type: PieceType, color: Color, id: string) {
  state.board[at[0]][at[1]] = { type, color, hasMoved: true, id };
}

function moveTo(state: GameState, from: Coord, to: Coord) {
  const move = legalMovesFromSquare(state, from)
    .find((m) => m.to?.[0] === to[0] && m.to?.[1] === to[1]);
  expect(move, `no legal move ${from} -> ${to}`).toBeDefined();
  return applyMove(state, move!);
}

describe('game outcomes', () => {
  it('reports checkmate, and names the winner', () => {
    // Black king boxed in on a8 by its own pawns; a rook arriving on the back
    // rank gives check with every escape square covered.
    const state = emptyBoard();
    put(state, [0, 0], 'K', 'b', 'bK');
    put(state, [1, 0], 'P', 'b', 'bP0');
    put(state, [1, 1], 'P', 'b', 'bP1');
    put(state, [7, 4], 'K', 'w', 'wK');
    put(state, [7, 7], 'R', 'w', 'wR');
    state.turn = 'w';

    const after = moveTo(state, [7, 7], [0, 7]);

    expect(after.status).toBe('checkmate');
    expect(after.winner).toBe('w');
    expect(isOver(after.status)).toBe(true);
  });

  it('reports stalemate without a winner', () => {
    // Black king on a8 is not in check, but every square it could move to is
    // covered by the queen on c7.
    const state = emptyBoard();
    put(state, [0, 0], 'K', 'b', 'bK');
    put(state, [7, 4], 'K', 'w', 'wK');
    put(state, [4, 2], 'Q', 'w', 'wQ');
    state.turn = 'w';

    const after = moveTo(state, [4, 2], [1, 2]);

    expect(after.status).toBe('stalemate');
    expect(after.winner).toBeNull();
    expect(isOver(after.status)).toBe(true);
  });

  it('reports check as a state the game continues from', () => {
    const state = emptyBoard();
    put(state, [0, 0], 'K', 'b', 'bK');
    put(state, [7, 4], 'K', 'w', 'wK');
    put(state, [7, 7], 'R', 'w', 'wR');
    state.turn = 'w';

    // The same back-rank check as the mate above, except the king's own pawns
    // are not there to block it, so a7 and b7 are both available.
    const after = moveTo(state, [7, 7], [0, 7]);

    expect(after.status).toBe('check');
    // Check must NOT end the game, or the banner would cover a live board.
    expect(isOver(after.status)).toBe(false);
  });

  it('treats a playable position as not over', () => {
    const fresh = createInitialState('standard');
    expect(isOver(fresh.status)).toBe(false);
  });
});

/**
 * The difficulty slider describes the engine using `describeStrength`. If that
 * ever stops matching the search, the interface starts lying about what the
 * setting does, which is worse than showing a bare number.
 */
describe('describeStrength', () => {
  it('gets stronger, never weaker, as the rating rises', () => {
    let lastDepth = 0;
    let lastBlunder = 1;

    for (let elo = 400; elo <= 2600; elo += 50) {
      const { depth, blunderChance } = describeStrength(elo);
      expect(depth).toBeGreaterThanOrEqual(lastDepth);
      expect(blunderChance).toBeLessThanOrEqual(lastBlunder);
      lastDepth = depth;
      lastBlunder = blunderChance;
    }
  });

  it('flags the rating below which castling and en passant are unreliable', () => {
    expect(describeStrength(FULL_RULES_ELO - 50).knowsFullRules).toBe(false);
    expect(describeStrength(FULL_RULES_ELO).knowsFullRules).toBe(true);
  });
});
