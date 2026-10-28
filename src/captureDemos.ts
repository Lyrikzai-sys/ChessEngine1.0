import {
  type Color,
  type Coord,
  type GameState,
  type PieceType,
  createInitialState,
} from './engine';

/**
 * One staged capture per attacker, so every weapon can be seen in turn
 * without playing a game into the right shape six times over.
 *
 * This lives apart from the React component on purpose: hand-placed squares
 * are exactly the kind of arithmetic that goes wrong silently, and keeping it
 * free of any renderer import means the test suite can assert that all six
 * positions really are legal and really do offer the capture claimed.
 */
export interface CaptureDemo {
  attacker: PieceType;
  attackerSquare: Coord;
  victimSquare: Coord;
  whiteKing: Coord;
}

/**
 * Every one is a position the engine accepts: both kings present, the line to
 * the victim clear, and the capture returned by `legalMovesFromSquare`.
 *
 * The king's demo makes the attacker and the white king the same piece, since
 * that is the only way a king ever captures anything.
 */
export const CAPTURE_DEMOS: CaptureDemo[] = [
  { attacker: 'P', attackerSquare: [4, 4], victimSquare: [3, 3], whiteKing: [7, 4] },
  { attacker: 'N', attackerSquare: [4, 4], victimSquare: [2, 5], whiteKing: [7, 4] },
  { attacker: 'B', attackerSquare: [5, 2], victimSquare: [2, 5], whiteKing: [7, 4] },
  { attacker: 'R', attackerSquare: [5, 3], victimSquare: [2, 3], whiteKing: [7, 4] },
  { attacker: 'Q', attackerSquare: [5, 3], victimSquare: [2, 3], whiteKing: [7, 4] },
  { attacker: 'K', attackerSquare: [4, 4], victimSquare: [3, 4], whiteKing: [4, 4] },
];

/** Builds the board for one demo: two kings, one attacker, one victim. */
export function stagedPosition(demo: CaptureDemo): GameState {
  const state = createInitialState('standard');
  state.board = Array.from({ length: 8 }, () => Array(8).fill(null));

  const put = (at: Coord, type: PieceType, color: Color, id: string) => {
    state.board[at[0]][at[1]] = { type, color, hasMoved: true, id };
  };

  // Tucked into the far corner, out of every demo's line of fire.
  put([0, 0], 'K', 'b', 'bK');
  put(demo.whiteKing, 'K', 'w', 'wK');
  if (demo.attacker !== 'K') put(demo.attackerSquare, demo.attacker, 'w', 'wA');

  // The victim is a queen every time: it is the densest piece on the board,
  // so it shows the most of what the shatter actually does.
  put(demo.victimSquare, 'Q', 'b', 'bV');

  state.turn = 'w';
  return state;
}
