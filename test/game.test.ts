import { describe, expect, it } from 'vitest';

import {
  type GameState,
  applyMove,
  createInitialState,
  findBestMove,
  generateLegalMoves,
  legalMovesFromSquare,
} from '../src/engine';

/**
 * The engine playing a game, rather than counting nodes.
 *
 * Perft proves the move generator enumerates correctly. These cover the parts
 * a player actually touches: that selecting a piece offers the right squares,
 * that the engine answers with a legal move, and that strength bands behave
 * differently from one another.
 */
describe('playing a game', () => {
  it('offers both pawn pushes from the starting rank', () => {
    const state = createInitialState('standard');
    // e2 is row 6, column 4.
    const moves = legalMovesFromSquare(state, [6, 4]);
    const destinations = moves.map((m) => `${m.to?.[0]},${m.to?.[1]}`).sort();
    expect(destinations).toEqual(['4,4', '5,4']);
  });

  it('offers nothing for an empty square', () => {
    const state = createInitialState('standard');
    expect(legalMovesFromSquare(state, [4, 4])).toEqual([]);
  });

  it('answers with a legal move', () => {
    let state = createInitialState('standard');
    state = applyMove(state, legalMovesFromSquare(state, [6, 4])[1]); // e4

    const reply = findBestMove(state, 1400);
    expect(reply).not.toBeNull();

    const legal = generateLegalMoves(state);
    const matches = legal.some(
      (m) => m.kind === reply!.kind
        && m.from?.[0] === reply!.from?.[0] && m.from?.[1] === reply!.from?.[1]
        && m.to?.[0] === reply!.to?.[0] && m.to?.[1] === reply!.to?.[1],
    );
    expect(matches).toBe(true);
  });

  it('plays twenty plies without producing an illegal position', () => {
    let state: GameState = createInitialState('standard');

    for (let ply = 0; ply < 20; ply++) {
      if (state.status === 'checkmate' || state.status === 'stalemate' || state.status === 'draw') break;

      const legal = generateLegalMoves(state);
      expect(legal.length).toBeGreaterThan(0);

      const move = findBestMove(state, 1600);
      expect(move).not.toBeNull();

      const next = applyMove(state, move!);
      // Each side must still have a king; losing one means applyMove corrupted
      // the board rather than the engine finding a winning line.
      const kings = next.board.flat().filter((p) => p && p.type === 'K');
      expect(kings).toHaveLength(2);

      state = next;
    }
  });

  it('searches deeper for a stronger rating', () => {
    const state = createInitialState('standard');

    // The weakest band blunders deliberately, so repeated searches disagree.
    // The strongest does not, so it is stable. Comparing the two is how the
    // blunder model shows up without asserting a specific move.
    const weak = new Set(
      Array.from({ length: 12 }, () => JSON.stringify(findBestMove(state, 700))),
    );
    const strong = new Set(
      Array.from({ length: 6 }, () => JSON.stringify(findBestMove(state, 2000))),
    );

    expect(strong.size).toBe(1);
    expect(weak.size).toBeGreaterThan(1);
  });
});
