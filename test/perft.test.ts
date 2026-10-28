/**
 * Perft — the standard correctness test for a chess move generator.
 *
 * It counts leaf nodes at a fixed depth from a known position. The expected
 * counts are published and identical for every correct engine, so they cannot
 * be fudged: a single missing en-passant capture, an illegal castle through
 * check, or a promotion counted once instead of four shows up as a wrong
 * total immediately.
 *
 * These positions are the usual suspects. Kiwipete in particular exists to
 * break generators that handle castling or pinned pieces loosely.
 */
import { describe, expect, it } from 'vitest';

import {
  type Board,
  type Color,
  type GameState,
  type Piece,
  type PieceType,
  applyMove,
  createInitialState,
  generateLegalMoves,
} from '../src/engine';

/** Build a GameState from a FEN string. */
function fromFen(fen: string): GameState {
  const [placement, turn, castling, enPassant] = fen.split(' ');
  const state = createInitialState('standard');

  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  placement.split('/').forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { c += Number(ch); continue; }
      const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
      const type = ch.toUpperCase() as PieceType;
      // Castling rights are expressed through hasMoved, so a rook or king
      // keeps its right only when the FEN grants it.
      const home = color === 'w' ? 7 : 0;
      let hasMoved = true;
      if (type === 'K') hasMoved = !(castling.includes(color === 'w' ? 'K' : 'k') || castling.includes(color === 'w' ? 'Q' : 'q'));
      if (type === 'R' && r === home) {
        if (c === 7) hasMoved = !castling.includes(color === 'w' ? 'K' : 'k');
        if (c === 0) hasMoved = !castling.includes(color === 'w' ? 'Q' : 'q');
      }
      const piece: Piece = { type, color, hasMoved, id: `${type}${color}${r}${c}` };
      board[r][c] = piece;
      c++;
    }
  });

  state.board = board;
  state.turn = turn === 'w' ? 'w' : 'b';
  state.enPassantTarget = enPassant && enPassant !== '-'
    ? [8 - Number(enPassant[1]), enPassant.charCodeAt(0) - 97]
    : null;
  return state;
}

function perft(state: GameState, depth: number): number {
  if (depth === 0) return 1;
  const moves = generateLegalMoves(state);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) nodes += perft(applyMove(state, move), depth - 1);
  return nodes;
}

describe('perft — move generation against published node counts', () => {
  describe('initial position', () => {
    // https://www.chessprogramming.org/Perft_Results
    const expected: [number, number][] = [[1, 20], [2, 400], [3, 8902], [4, 197281]];
    it.each(expected)('depth %i yields %i nodes', (depth, nodes) => {
      expect(perft(createInitialState('standard'), depth)).toBe(nodes);
    });
  });

  describe('Kiwipete — castling, pins and a dense middlegame', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -';
    const expected: [number, number][] = [[1, 48], [2, 2039], [3, 97862]];
    it.each(expected)('depth %i yields %i nodes', (depth, nodes) => {
      expect(perft(fromFen(fen), depth)).toBe(nodes);
    });
  });

  describe('position 3 — en passant and promotion edge cases', () => {
    const fen = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -';
    const expected: [number, number][] = [[1, 14], [2, 191], [3, 2812], [4, 43238]];
    it.each(expected)('depth %i yields %i nodes', (depth, nodes) => {
      expect(perft(fromFen(fen), depth)).toBe(nodes);
    });
  });

  describe('position 4 — promotions under check', () => {
    const fen = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -';
    const expected: [number, number][] = [[1, 6], [2, 264], [3, 9467]];
    it.each(expected)('depth %i yields %i nodes', (depth, nodes) => {
      expect(perft(fromFen(fen), depth)).toBe(nodes);
    });
  });
});
