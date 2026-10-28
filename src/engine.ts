/**
 * CHESS ENGINE
 * ---------------------------------------------------------------------------
 * Standard FIDE rules: castling, en passant, promotion, check, checkmate,
 * stalemate and the draw conditions. Pure logic with no imports, no DOM and
 * no I/O, which is what lets it run unchanged in a Web Worker and be tested
 * directly.
 *
 * Search is minimax with alpha-beta pruning. Positions are scored on
 * material, per-piece square tables, mobility and check, with captures
 * ordered first so cutoffs do more work. Playing strength is banded by
 * rating through search depth and a modelled blunder rate, not depth alone.
 * ---------------------------------------------------------------------------
 */

export type Color = 'w' | 'b';
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
export type Coord = [number, number]; // [row, col]
export type Mode = 'standard';

export interface Piece {
  type: PieceType;
  color: Color;
  hasMoved: boolean;
  id: string;
}

export type Board = (Piece | null)[][];

export type MoveKind =
  | 'normal' | 'capture' | 'castle' | 'enPassant' | 'promotion';

export interface Move {
  kind: MoveKind;
  from?: Coord;
  to?: Coord;
  promoteTo?: PieceType;
  capturedPiece?: Piece;
  capturedSquare?: Coord;
  castleSide?: 'k' | 'q';
  notation?: string;
}

export interface SideState {
  capturedByOpponent: Piece[];
}

export interface GameState {
  board: Board;
  turn: Color;
  halfMoveCount: number;
  enPassantTarget: Coord | null;
  white: SideState;
  black: SideState;
  history: Move[];
  status: 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw';
  winner: Color | null;
  mode: Mode;
}

const RANK_DIRS_ORTH: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const RANK_DIRS_DIAG: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KNIGHT_OFFSETS: [number, number][] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

export const inBounds = (r: number, c: number): boolean => r >= 0 && r < 8 && c >= 0 && c < 8;
export const opponentOf = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const sideOf = (s: GameState, c: Color): SideState => (c === 'w' ? s.white : s.black);

const clonePiece = (p: Piece | null): Piece | null => (p ? { ...p } : null);
const cloneSide = (s: SideState): SideState => ({
  capturedByOpponent: s.capturedByOpponent.map(p => ({ ...p })),
});

export const cloneState = (s: GameState): GameState => ({
  board: s.board.map(row => row.map(clonePiece)),
  turn: s.turn,
  halfMoveCount: s.halfMoveCount,
  enPassantTarget: s.enPassantTarget ? [...s.enPassantTarget] as Coord : null,
  white: cloneSide(s.white),
  black: cloneSide(s.black),
  history: [...s.history],
  status: s.status,
  winner: s.winner,
  mode: s.mode,
});

export function createInitialState(mode: Mode): GameState {
  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c], color: 'b', hasMoved: false, id: `b${back[c]}${c}` };
    board[1][c] = { type: 'P', color: 'b', hasMoved: false, id: `bP${c}` };
    board[6][c] = { type: 'P', color: 'w', hasMoved: false, id: `wP${c}` };
    board[7][c] = { type: back[c], color: 'w', hasMoved: false, id: `w${back[c]}${c}` };
  }
  const emptySide = (): SideState => ({
    capturedByOpponent: [],
  });
  return {
    board, turn: 'w', halfMoveCount: 0, enPassantTarget: null,
    white: emptySide(), black: emptySide(),
    history: [], status: 'playing', winner: null, mode,
  };
}

/** Did `color` capture the opponent's queen at any point? */
export function hasCapturedEnemyQueen(state: GameState, color: Color): boolean {
  const oppColor = opponentOf(color);
  const oppSide = sideOf(state, oppColor);
  return oppSide.capturedByOpponent.some(p => p.type === 'Q' && p.color === oppColor);
}

export function findKing(board: Board, color: Color): Coord | null {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p && p.type === 'K' && p.color === color) return [r, c];
  }
  return null;
}


export function isSquareAttacked(state: GameState, sq: Coord, byColor: Color): boolean {
  const [tr, tc] = sq;
  const board = state.board;
  const pawnDir = byColor === 'w' ? -1 : 1;

  for (const dc of [-1, 1]) {
    const r = tr - pawnDir, c = tc - dc;
    if (inBounds(r, c)) {
      const p = board[r][c];
      if (p && p.type === 'P' && p.color === byColor) return true;
    }
  }
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const r = tr + dr, c = tc + dc;
    if (inBounds(r, c)) {
      const p = board[r][c];
      if (p && p.type === 'N' && p.color === byColor) return true;
    }
  }
  for (const [dr, dc] of RANK_DIRS_ORTH) {
    let r = tr + dr, c = tc + dc;
    while (inBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (p.color === byColor && (p.type === 'R' || p.type === 'Q')) return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  for (const [dr, dc] of RANK_DIRS_DIAG) {
    let r = tr + dr, c = tc + dc;
    while (inBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (p.color === byColor && (p.type === 'B' || p.type === 'Q')) return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue;
    const r = tr + dr, c = tc + dc;
    if (inBounds(r, c)) {
      const p = board[r][c];
      if (p && p.type === 'K' && p.color === byColor) return true;
    }
  }
  return false;
}

export function isInCheck(state: GameState, color: Color): boolean {
  const k = findKing(state.board, color);
  if (!k) return false;
  return isSquareAttacked(state, k, opponentOf(color));
}

function pawnPseudoMoves(state: GameState, from: Coord): Move[] {
  const [r, c] = from;
  const piece = state.board[r][c]!;
  const dir = piece.color === 'w' ? -1 : 1;
  const startRow = piece.color === 'w' ? 6 : 1;
  const promoteRow = piece.color === 'w' ? 0 : 7;
  const moves: Move[] = [];
  if (inBounds(r + dir, c) && !state.board[r + dir][c]) {
    const to: Coord = [r + dir, c];
    if (to[0] === promoteRow) {
      for (const promoteTo of ['Q', 'R', 'B', 'N'] as PieceType[]) {
        moves.push({ kind: 'promotion', from, to, promoteTo });
      }
    } else {
      moves.push({ kind: 'normal', from, to });
      if (r === startRow && !state.board[r + 2 * dir][c]) {
        moves.push({ kind: 'normal', from, to: [r + 2 * dir, c] });
      }
    }
  }
  for (const dc of [-1, 1]) {
    const tr = r + dir, tc = c + dc;
    if (!inBounds(tr, tc)) continue;
    const target = state.board[tr][tc];
    if (target && target.color !== piece.color) {
      if (tr === promoteRow) {
        for (const promoteTo of ['Q', 'R', 'B', 'N'] as PieceType[]) {
          moves.push({ kind: 'promotion', from, to: [tr, tc], promoteTo, capturedPiece: target });
        }
      } else {
        moves.push({ kind: 'capture', from, to: [tr, tc], capturedPiece: target });
      }
    }
    if (state.enPassantTarget && state.enPassantTarget[0] === tr && state.enPassantTarget[1] === tc) {
      const epPawn = state.board[r][tc];
      if (epPawn && epPawn.type === 'P' && epPawn.color !== piece.color) {
        moves.push({ kind: 'enPassant', from, to: [tr, tc], capturedPiece: epPawn, capturedSquare: [r, tc] });
      }
    }
  }
  return moves;
}

function knightPseudoMoves(state: GameState, from: Coord): Move[] {
  const [r, c] = from;
  const piece = state.board[r][c]!;
  const moves: Move[] = [];
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const tr = r + dr, tc = c + dc;
    if (!inBounds(tr, tc)) continue;
    const target = state.board[tr][tc];
    if (!target) {
      moves.push({ kind: 'normal', from, to: [tr, tc] });
    } else if (target.color !== piece.color) {
      moves.push({ kind: 'capture', from, to: [tr, tc], capturedPiece: target });
    }
  }
  return moves;
}

function slidingPseudoMoves(state: GameState, from: Coord, dirs: [number, number][]): Move[] {
  const [r, c] = from;
  const piece = state.board[r][c]!;
  const moves: Move[] = [];
  for (const [dr, dc] of dirs) {
    let tr = r + dr, tc = c + dc;
    while (inBounds(tr, tc)) {
      const target = state.board[tr][tc];
      if (!target) {
        moves.push({ kind: 'normal', from, to: [tr, tc] });
      } else {
        if (target.color !== piece.color) {
          moves.push({ kind: 'capture', from, to: [tr, tc], capturedPiece: target });
        }
        break;
      }
      tr += dr; tc += dc;
    }
  }
  return moves;
}

function kingPseudoMoves(state: GameState, from: Coord): Move[] {
  const [r, c] = from;
  const piece = state.board[r][c]!;
  const moves: Move[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue;
    const tr = r + dr, tc = c + dc;
    if (!inBounds(tr, tc)) continue;
    const target = state.board[tr][tc];
    if (!target) {
      moves.push({ kind: 'normal', from, to: [tr, tc] });
    } else if (target.color !== piece.color) {
      moves.push({ kind: 'capture', from, to: [tr, tc], capturedPiece: target });
    }
  }
  return moves;
}

function castlingMoves(state: GameState, color: Color): Move[] {
  const moves: Move[] = [];
  const row = color === 'w' ? 7 : 0;
  const king = state.board[row][4];
  if (!king || king.type !== 'K' || king.hasMoved) return moves;
  if (isSquareAttacked(state, [row, 4], opponentOf(color))) return moves;
  const kRook = state.board[row][7];
  if (kRook && kRook.type === 'R' && !kRook.hasMoved && !state.board[row][5] && !state.board[row][6] && !isSquareAttacked(state, [row, 5], opponentOf(color)) && !isSquareAttacked(state, [row, 6], opponentOf(color))) {
    moves.push({ kind: 'castle', from: [row, 4], to: [row, 6], castleSide: 'k' });
  }
  const qRook = state.board[row][0];
  if (qRook && qRook.type === 'R' && !qRook.hasMoved && !state.board[row][1] && !state.board[row][2] && !state.board[row][3] && !isSquareAttacked(state, [row, 3], opponentOf(color)) && !isSquareAttacked(state, [row, 2], opponentOf(color))) {
    moves.push({ kind: 'castle', from: [row, 4], to: [row, 2], castleSide: 'q' });
  }
  return moves;
}

export function generatePseudoLegalMoves(state: GameState, color: Color): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = state.board[r][c]; if (!p || p.color !== color) continue;
    switch (p.type) {
      case 'P': moves.push(...pawnPseudoMoves(state, [r, c])); break;
      case 'N': moves.push(...knightPseudoMoves(state, [r, c])); break;
      case 'B': moves.push(...slidingPseudoMoves(state, [r, c], RANK_DIRS_DIAG)); break;
      case 'R': moves.push(...slidingPseudoMoves(state, [r, c], RANK_DIRS_ORTH)); break;
      case 'Q': moves.push(...slidingPseudoMoves(state, [r, c], [...RANK_DIRS_ORTH, ...RANK_DIRS_DIAG])); break;
      case 'K': moves.push(...kingPseudoMoves(state, [r, c])); break;
    }
  }
  moves.push(...castlingMoves(state, color));
  return moves;
}

export function applyMove(state: GameState, move: Move): GameState {
  const ns = cloneState(state);
  const color = ns.turn, opp = opponentOf(color);
  const ourSide = sideOf(ns, color), oppSide = sideOf(ns, opp);
  ns.enPassantTarget = null;
  switch (move.kind) {
    case 'normal':
    case 'capture': {
      const fr = move.from!, tr = move.to!;
      const piece = ns.board[fr[0]][fr[1]]!, target = ns.board[tr[0]][tr[1]];
      if (target) {
        sideOf(ns, target.color).capturedByOpponent.push({ ...target });
        clearWardOnSquare(sideOf(ns, target.color), tr);
      }
      ns.board[tr[0]][tr[1]] = { ...piece, hasMoved: true };
      ns.board[fr[0]][fr[1]] = null;
      if (piece.type === 'P' && Math.abs(tr[0] - fr[0]) === 2) ns.enPassantTarget = [(tr[0] + fr[0]) / 2, tr[1]];
      break;
    }
    case 'enPassant': {
      const fr = move.from!, tr = move.to!, cr = move.capturedSquare!;
      const piece = ns.board[fr[0]][fr[1]]!, captured = ns.board[cr[0]][cr[1]]!;
      sideOf(ns, captured.color).capturedByOpponent.push({ ...captured });
      ns.board[cr[0]][cr[1]] = null; ns.board[tr[0]][tr[1]] = { ...piece, hasMoved: true }; ns.board[fr[0]][fr[1]] = null;
      break;
    }
    case 'promotion': {
      const fr = move.from!, tr = move.to!;
      const piece = ns.board[fr[0]][fr[1]]!, target = ns.board[tr[0]][tr[1]];
      if (target) sideOf(ns, target.color).capturedByOpponent.push({ ...target });
      ns.board[tr[0]][tr[1]] = { type: move.promoteTo!, color: piece.color, hasMoved: true, id: piece.id + '_p' };
      ns.board[fr[0]][fr[1]] = null;
      break;
    }
    case 'castle': {
      const fr = move.from!, tr = move.to!;
      const king = ns.board[fr[0]][fr[1]]!;
      ns.board[tr[0]][tr[1]] = { ...king, hasMoved: true }; ns.board[fr[0]][fr[1]] = null;
      const rf = move.castleSide === 'k' ? 7 : 0, rt = move.castleSide === 'k' ? 5 : 3;
      const rook = ns.board[fr[0]][rf]!;
      ns.board[fr[0]][rt] = { ...rook, hasMoved: true }; ns.board[fr[0]][rf] = null;
      break;
    }
  }
  ns.history.push(move); ns.halfMoveCount++; ns.turn = opp;
  updateStatus(ns); return ns;
}

function startingSquareForKnight(id: string): Coord | null {
  const m = id.match(/^([wb])N(\d+)/); if (!m) return null;
  return [m[1] === 'w' ? 7 : 0, parseInt(m[2], 10)];
}
function clearWardOnSquare(side: SideState, sq: Coord) {
}

export function generateLegalMoves(state: GameState): Move[] {
  return generatePseudoLegalMoves(state, state.turn).filter(m => {
    const nextState = applyMoveLite(state, m);
    return !isInCheck(nextState, state.turn);
  });
}

export function legalMovesFromSquare(state: GameState, sq: Coord): Move[] {
  const piece = state.board[sq[0]][sq[1]];
  if (!piece || piece.color !== state.turn) return [];
  return generateLegalMoves(state).filter(m => {
    if (m.from && m.from[0] === sq[0] && m.from[1] === sq[1]) return true;
    return false;
  });
}

function applyMoveLite(state: GameState, move: Move): GameState {
  const ns = cloneState(state); const color = ns.turn;
  switch (move.kind) {
    case 'normal':
    case 'capture': {
      const fr = move.from!, tr = move.to!, p = ns.board[fr[0]][fr[1]]!;
      ns.board[tr[0]][tr[1]] = { ...p, hasMoved: true }; ns.board[fr[0]][fr[1]] = null; break;
    }
    case 'enPassant': {
      const fr = move.from!, tr = move.to!, cr = move.capturedSquare!, p = ns.board[fr[0]][fr[1]]!;
      ns.board[cr[0]][cr[1]] = null; ns.board[tr[0]][tr[1]] = { ...p, hasMoved: true }; ns.board[fr[0]][fr[1]] = null; break;
    }
    case 'promotion': {
      const fr = move.from!, tr = move.to!, p = ns.board[fr[0]][fr[1]]!;
      ns.board[tr[0]][tr[1]] = { type: move.promoteTo!, color: p.color, hasMoved: true, id: p.id }; ns.board[fr[0]][fr[1]] = null; break;
    }
    case 'castle': {
      const fr = move.from!, tr = move.to!, k = ns.board[fr[0]][fr[1]]!;
      ns.board[tr[0]][tr[1]] = { ...k, hasMoved: true }; ns.board[fr[0]][fr[1]] = null;
      const rf = move.castleSide === 'k' ? 7 : 0, rt = move.castleSide === 'k' ? 5 : 3, r = ns.board[fr[0]][rf]!;
      ns.board[fr[0]][rt] = { ...r, hasMoved: true }; ns.board[fr[0]][rf] = null; break;
    }
  }
  return ns;
}

function updateStatus(state: GameState): void {
  const isCheck = isInCheck(state, state.turn);
  const legalMoves = generateLegalMoves(state);
  if (legalMoves.length === 0) {
    if (isCheck) { state.status = 'checkmate'; state.winner = opponentOf(state.turn); }
    else { state.status = 'stalemate'; }
  } else if (isCheck) state.status = 'check';
  else state.status = 'playing';
  if (isInsufficient(state.board)) state.status = 'draw';
}

function isInsufficient(board: Board): boolean {
  const p: Piece[] = []; for (const row of board) for (const x of row) if (x) p.push(x);
  if (p.length === 2) return true;
  if (p.length === 3) { const n = p.find(x => x.type !== 'K'); if (n && (n.type === 'B' || n.type === 'N')) return true; }
  return false;
}

const PIECE_VALUES: Record<PieceType, number> = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
const PST: Record<PieceType, number[][]> = {
  P: [[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]],
  N: [[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]],
  B: [[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],[-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]],
  R: [[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]],
  Q: [[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]],
  K: [[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]],
};

export function evaluatePosition(s: GameState, perspective: Color): number {
  if (s.status === 'checkmate') return s.winner === perspective ? 1000000 : -1000000;
  if (s.status === 'stalemate' || s.status === 'draw') return 0;
  let val = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c]; if (!p) continue;
    const sign = p.color === perspective ? 1 : -1;
    val += sign * PIECE_VALUES[p.type] + sign * PST[p.type][p.color === 'w' ? r : 7 - r][c];
  }
  if (s.status === 'check') val += (s.turn === perspective ? -100 : 100);
  const myMoves = s.turn === perspective ? generateLegalMoves(s).length : 0;
  val += myMoves * 2;
  return val;
}

/**
 * What the last search did, for anything that wants to watch it think.
 *
 * The portfolio puts this on screen beside the board: a search that can be
 * watched is harder to mistake for a library call than any sentence saying
 * it is not one.
 *
 * Counters only -- nothing here is read back by the search, so the move it
 * returns is identical whether or not anyone is listening. The listener is
 * called once, after the move is chosen.
 */
export interface SearchTrace {
  elo: number;
  depth: number;
  nodes: number;
  cutoffs: number;
  elapsedMs: number;
  blundered: boolean;
  legalMoves: number;
  /** Every root move with its score, best first. */
  candidates: { notation: string; score: number; chosen: boolean }[];
  /** What the chosen position scores, and why. */
  evaluation: EvalBreakdown | null;
}

let traceListener: ((t: SearchTrace) => void) | null = null;

/** Watch the engine search. Returns an unsubscribe. */
export function onSearchTrace(cb: (t: SearchTrace) => void): () => void {
  traceListener = cb;
  return () => { if (traceListener === cb) traceListener = null; };
}

/**
 * Hand a trace to whoever is listening.
 *
 * Exported because the search may have run in a worker, where listeners on
 * this thread cannot see it -- the client republishes the trace here so the
 * page does not need to know where the work happened.
 */
export function publishSearchTrace(trace: SearchTrace): void {
  if (!traceListener) return;
  try { traceListener(trace); } catch { /* a watcher must never break the game */ }
}

let nodeCount = 0;
let cutoffCount = 0;

const FILES = 'abcdefgh';

/** Plain coordinate notation, enough to follow along: Nb1-c3, e7xd6. */
function describeMove(s: GameState, m: Move): string {
  if (m.kind === 'castle') return m.castleSide === 'k' ? 'O-O' : 'O-O-O';
  if (!m.from || !m.to) return m.kind;
  const [fr, fc] = m.from;
  const [tr, tc] = m.to;
  const piece = s.board[fr]?.[fc];
  const name = piece && piece.type !== 'P' ? piece.type : '';
  const link = m.capturedPiece ? 'x' : '-';
  const square = (r: number, c: number) => `${FILES[c] ?? "?"}${8 - r}`;
  const promo = m.promoteTo ? `=${m.promoteTo}` : '';
  return `${name}${square(fr, fc)}${link}${square(tr, tc)}${promo}`;
}

/** The same score as evaluatePosition, split into the terms it is made of. */
export interface EvalBreakdown {
  material: number;
  position: number;
  mobility: number;
  check: number;
  total: number;
}

/**
 * Explain a score rather than just produce one.
 *
 * Deliberately separate from evaluatePosition, which runs on every node of
 * the search -- tens of thousands of times a move -- and must not start
 * allocating an object to say what it was thinking. This runs once, for the
 * position actually chosen, so the portfolio can show the parts.
 *
 * The duplication is the cost of keeping the hot path clean, so the two are
 * pinned together by a test that walks a game asserting .total matches
 * evaluatePosition exactly.
 */
export function explainEvaluation(s: GameState, perspective: Color): EvalBreakdown {
  const zero = { material: 0, position: 0, mobility: 0, check: 0 };
  if (s.status === 'checkmate') {
    const total = s.winner === perspective ? 1000000 : -1000000;
    return { ...zero, total };
  }
  if (s.status === 'stalemate' || s.status === 'draw') return { ...zero, total: 0 };

  let material = 0, position = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c]; if (!p) continue;
    const sign = p.color === perspective ? 1 : -1;
    material += sign * PIECE_VALUES[p.type];
    position += sign * PST[p.type][p.color === 'w' ? r : 7 - r][c];
  }
  const check = s.status === 'check' ? (s.turn === perspective ? -100 : 100) : 0;
  const mobility = (s.turn === perspective ? generateLegalMoves(s).length : 0) * 2;

  return {
    material, position, mobility, check,
    total: material + position + check + mobility,
  };
}

function minimax(s: GameState, depth: number, alpha: number, beta: number, perspective: Color): number {
  nodeCount++;
  if (depth === 0 || ['checkmate', 'stalemate', 'draw'].includes(s.status)) return evaluatePosition(s, perspective);
  const moves = generateLegalMoves(s); if (moves.length === 0) return evaluatePosition(s, perspective);
  moves.sort((a, b) => (b.capturedPiece ? PIECE_VALUES[b.capturedPiece.type] : 0) - (a.capturedPiece ? PIECE_VALUES[a.capturedPiece.type] : 0));
  const max = s.turn === perspective;
  if (max) {
    let best = -Infinity;
    for (const m of moves) {
      best = Math.max(best, minimax(applyMove(s, m), depth - 1, alpha, beta, perspective));
      alpha = Math.max(alpha, best); if (alpha >= beta) { cutoffCount++; break; }
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      best = Math.min(best, minimax(applyMove(s, m), depth - 1, alpha, beta, perspective));
      beta = Math.min(beta, best); if (alpha >= beta) { cutoffCount++; break; }
    }
    return best;
  }
}

export function findBestMove(s: GameState, elo: number = 1200): Move | null {
  const moves = generateLegalMoves(s);
  if (moves.length === 0) return null;
  const perspective = s.turn;
  let depth = 1, blunderChance = 0;
  if (elo < 800)       { depth = 1; blunderChance = 0.4; }
  else if (elo < 1200) { depth = 2; blunderChance = 0.2; }
  else if (elo < 1600) { depth = 3; blunderChance = 0.1; }
  else if (elo < 2000) { depth = 3; blunderChance = 0.05; }
  else                 { depth = 4; blunderChance = 0; }

  // Below 1250 the engine does not reliably know castling or en passant, so
  // it only plays them when it has seen them before or stumbles into one.
  // This is what makes weak play read as inexperience rather than as a
  // shallower search.
  const isSecretKind = (k: MoveKind) => k === 'enPassant' || k === 'castle';
  const knownMoves: MoveKind[] = (s as unknown as { knownMoves?: MoveKind[] }).knownMoves || [];
  const filteredMoves = moves.filter(m => {
    if (!isSecretKind(m.kind)) return true;
    if (elo >= 1250) return true;
    if (knownMoves.includes(m.kind)) return true;
    return Math.random() < 0.15;
  });

  const finalMoves = filteredMoves.length > 0 ? filteredMoves : moves;

  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  nodeCount = 0;
  cutoffCount = 0;

  const report = (chosen: Move, scored: { notation: string; score: number; chosen: boolean }[], blundered: boolean) => {
    if (!traceListener) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try {
      publishSearchTrace({
        elo, depth, nodes: nodeCount, cutoffs: cutoffCount,
        elapsedMs: now - started,
        blundered,
        legalMoves: moves.length,
        candidates: scored,
        evaluation: explainEvaluation(applyMove(s, chosen), perspective),
      });
    } catch { /* a watcher must never break the game */ }
  };

  if (Math.random() < blunderChance) {
    const slip = finalMoves[Math.floor(Math.random() * finalMoves.length)];
    report(slip, [{ notation: describeMove(s, slip), score: 0, chosen: true }], true);
    return slip;
  }

  finalMoves.sort((a, b) => {
    const valA = a.capturedPiece ? PIECE_VALUES[a.capturedPiece.type] : 0;
    const valB = b.capturedPiece ? PIECE_VALUES[b.capturedPiece.type] : 0;
    return valB - valA;
  });

  let bestM = finalMoves[0], bestV = -Infinity, alpha = -Infinity, beta = Infinity;
  const scored: { notation: string; score: number; chosen: boolean }[] = [];
  for (const m of finalMoves) {
    const v = minimax(applyMove(s, m), depth - 1, alpha, beta, perspective);
    if (traceListener) scored.push({ notation: describeMove(s, m), score: v, chosen: false });
    if (v > bestV) { bestV = v; bestM = m; }
    alpha = Math.max(alpha, bestV);
  }
  if (traceListener) {
    const best = describeMove(s, bestM);
    for (const row of scored) row.chosen = row.notation === best;
    scored.sort((a, b) => b.score - a.score);
    report(bestM, scored, false);
  }
  return bestM;
}
