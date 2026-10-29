/**
 * CHESS ENGINE
 * ---------------------------------------------------------------------------
 * Standard legal moves: castling, en passant, promotion, check, checkmate,
 * stalemate, and draws by insufficient material. Threefold repetition and the
 * fifty-move rule are NOT implemented; `halfMoveCount` is tracked but never
 * ends a game. Pure logic with no imports, no DOM and no I/O, which is what
 * lets it run unchanged in a Web Worker and be tested directly.
 *
 * Search is minimax with alpha-beta pruning. Positions are scored on
 * material, per-piece square tables, mobility and check, with captures
 * ordered first so cutoffs do more work. Playing strength is banded by
 * rating-like difficulty bands (700-2000) through search depth and a modelled
 * blunder rate, not depth alone. Those numbers are product controls; they have
 * not been calibrated against rated engines or players.
 * ---------------------------------------------------------------------------
 */

export type Color = 'w' | 'b';
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
export type Coord = [number, number]; // [row, col]
export type Mode = 'standard';
export type DrawReason = 'insufficient-material' | 'threefold-repetition' | 'fifty-move';

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
  /** Position identities, including the initial position, for threefold draws. */
  positionHistory?: string[];
  status: 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw';
  /** Present only when status is draw; stalemate remains its own status. */
  drawReason?: DrawReason | null;
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
  positionHistory: [...(s.positionHistory ?? [repetitionKey(s)])],
  status: s.status,
  drawReason: s.drawReason ?? null,
  winner: s.winner,
  mode: s.mode,
});/**
 * Search never mutates a piece object: moved pieces are replaced, and captures
 * clear a square. A speculative node can therefore share untouched pieces and
 * only copy the eight board rows. Public applyMove still uses cloneState so
 * callers retain the fully independent state they expect.
 */
function cloneSearchState(s: GameState): GameState {
  return {
    board: [...s.board],
    turn: s.turn,
    halfMoveCount: s.halfMoveCount,
    enPassantTarget: s.enPassantTarget ? [...s.enPassantTarget] as Coord : null,
    white: { capturedByOpponent: [] },
    black: { capturedByOpponent: [] },
    history: [],
    positionHistory: [],
    status: s.status,
    drawReason: null,
    winner: s.winner,
    mode: s.mode,
  };
}/** Copy only rows that this speculative move writes. */
function prepareSearchRows(state: GameState, move: Move): void {
  const rows = new Set<number>();
  if (move.from) rows.add(move.from[0]);
  if (move.to) rows.add(move.to[0]);
  if (move.capturedSquare) rows.add(move.capturedSquare[0]);
  for (const row of rows) state.board[row] = [...state.board[row]];
}

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
    history: [], positionHistory: [], status: 'playing', drawReason: null, winner: null, mode,
  };
}

/** Did `color` capture the opponent's queen at any point? */
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
}/** Identity used for threefold repetition: pieces, turn, castling and en passant. */
function repetitionKey(state: GameState): string {
  let board = '';
  for (const row of state.board) for (const piece of row) board += piece ? `${piece.color}${piece.type}` : '..';
  const rights = (color: Color, side: 'k' | 'q') => {
    const row = color === 'w' ? 7 : 0;
    const king = state.board[row][4];
    const rook = state.board[row][side === 'k' ? 7 : 0];
    return king?.type === 'K' && king.color === color && !king.hasMoved && rook?.type === 'R' && rook.color === color && !rook.hasMoved;
  };
  const castling = `${rights('w', 'k') ? 'K' : ''}${rights('w', 'q') ? 'Q' : ''}${rights('b', 'k') ? 'k' : ''}${rights('b', 'q') ? 'q' : ''}` || '-';
  const ep = state.enPassantTarget && generatePseudoLegalMoves(state, state.turn).some(move => move.kind === 'enPassant') ? state.enPassantTarget.join(',') : '-';
  return `${state.turn}|${castling}|${ep}|${board}`;
}
function isThreefoldRepetition(state: GameState): boolean {
  const history = state.positionHistory ?? [];
  const current = repetitionKey(state);
  return history.filter(key => key === current).length >= 3;
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

export function applyMove(state: GameState, move: Move, updateGameStatus = true): GameState {
  const ns = updateGameStatus ? cloneState(state) : cloneSearchState(state);
  if (!updateGameStatus) prepareSearchRows(ns, move);
  const color = ns.turn, opp = opponentOf(color);
  const movedPiece = move.from ? ns.board[move.from[0]][move.from[1]] : null;
  const isCapture = move.kind === 'capture' || move.kind === 'enPassant' || Boolean(move.to && ns.board[move.to[0]][move.to[1]]);
  ns.enPassantTarget = null;
  switch (move.kind) {
    case 'normal':
    case 'capture': {
      const fr = move.from!, tr = move.to!;
      const piece = ns.board[fr[0]][fr[1]]!, target = ns.board[tr[0]][tr[1]];
      if (target) {
        sideOf(ns, target.color).capturedByOpponent.push({ ...target });
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
  ns.halfMoveCount = movedPiece?.type === 'P' || isCapture ? 0 : state.halfMoveCount + 1;
  ns.turn = opp;
  if (updateGameStatus) {
    const positions = ns.positionHistory?.length ? ns.positionHistory : [repetitionKey(state)];
    ns.positionHistory = positions;
    ns.history.push(move);
    updateStatus(ns);
    positions.push(repetitionKey(ns));
    if (ns.status !== 'checkmate' && ns.status !== 'stalemate' && ns.status !== 'draw') {
      if (ns.halfMoveCount >= 100) { ns.status = 'draw'; ns.drawReason = 'fifty-move'; }
      else if (isThreefoldRepetition(ns)) { ns.status = 'draw'; ns.drawReason = 'threefold-repetition'; }
    }
  } else {
    // Search nodes need a correct immediate check/draw state, but not a full
    // legal-move pass just to compute checkmate or stalemate at every child.
    ns.history = [];
    ns.white.capturedByOpponent = [];
    ns.black.capturedByOpponent = [];
    ns.winner = null;
    ns.status = isInsufficient(ns.board) ? 'draw' : (isInCheck(ns, ns.turn) ? 'check' : 'playing');
  }
  return ns;
}

/**
 * Legal filtering is the hottest operation in the engine. Temporarily update
 * only the squares a candidate touches, test the king, then restore those
 * exact references. Unlike public applyMove this allocates no state or board.
 */
function leavesKingSafe(state: GameState, move: Move, king: Coord): boolean {
  const board = state.board;
  const from = move.from!;
  const to = move.to!;
  const moving = board[from[0]][from[1]]!;
  const target = board[to[0]][to[1]];
  const moved: Piece = move.kind === 'promotion'
    ? { type: move.promoteTo!, color: moving.color, hasMoved: true, id: moving.id }
    : { ...moving, hasMoved: true };
  const kingSquare: Coord = moving.type === 'K' ? to : king;
  const captureSquare = move.capturedSquare;
  const captured = captureSquare ? board[captureSquare[0]][captureSquare[1]] : null;
  let rookFrom: Coord | null = null;
  let rookTo: Coord | null = null;
  let rook: Piece | null = null;

  board[from[0]][from[1]] = null;
  board[to[0]][to[1]] = moved;
  if (captureSquare) board[captureSquare[0]][captureSquare[1]] = null;
  if (move.kind === 'castle') {
    const fileFrom = move.castleSide === 'k' ? 7 : 0;
    const fileTo = move.castleSide === 'k' ? 5 : 3;
    rookFrom = [from[0], fileFrom];
    rookTo = [from[0], fileTo];
    rook = board[rookFrom[0]][rookFrom[1]];
    board[rookFrom[0]][rookFrom[1]] = null;
    board[rookTo[0]][rookTo[1]] = rook ? { ...rook, hasMoved: true } : null;
  }

  try {
    return !isSquareAttacked(state, kingSquare, opponentOf(state.turn));
  } finally {
    if (rookFrom && rookTo) {
      board[rookFrom[0]][rookFrom[1]] = rook;
      board[rookTo[0]][rookTo[1]] = null;
    }
    if (captureSquare) board[captureSquare[0]][captureSquare[1]] = captured;
    board[from[0]][from[1]] = moving;
    board[to[0]][to[1]] = target;
  }
}

export function generateLegalMoves(state: GameState): Move[] {
  const color = state.turn;
  const king = findKing(state.board, color);
  if (!king) return [];
  return generatePseudoLegalMoves(state, color).filter(move => leavesKingSafe(state, move, king));
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
  const ns = cloneSearchState(state); prepareSearchRows(ns, move); const color = ns.turn;
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
  state.drawReason = null;
  const isCheck = isInCheck(state, state.turn);
  const legalMoves = generateLegalMoves(state);
  if (legalMoves.length === 0) {
    if (isCheck) { state.status = 'checkmate'; state.winner = opponentOf(state.turn); }
    else { state.status = 'stalemate'; state.winner = null; }
    return;
  }
  state.winner = null;
  state.status = isCheck ? 'check' : 'playing';
  if (isInsufficient(state.board)) { state.status = 'draw'; state.drawReason = 'insufficient-material'; }
}

function isInsufficient(board: Board): boolean {
  const pieces: { piece: Piece; row: number; column: number }[] = [];
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
    const piece = board[row][column]; if (piece) pieces.push({ piece, row, column });
  }
  const nonKings = pieces.filter(({ piece }) => piece.type !== 'K');
  if (nonKings.length === 0) return true;
  if (nonKings.length === 1) return nonKings[0].piece.type === 'B' || nonKings[0].piece.type === 'N';
  if (nonKings.every(({ piece }) => piece.type === 'N')) return nonKings.length <= 2;
  if (nonKings.every(({ piece }) => piece.type === 'B')) return new Set(nonKings.map(({ row, column }) => (row + column) % 2)).size === 1;
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

function evaluateScore(s: GameState, perspective: Color, legalMoveCount?: number): number {
  if (s.status === 'checkmate') return s.winner === perspective ? 1_000_000 : -1_000_000;
  if (s.status === 'stalemate' || s.status === 'draw') return 0;
  let val = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c]; if (!p) continue;
    const sign = p.color === perspective ? 1 : -1;
    val += sign * PIECE_VALUES[p.type] + sign * PST[p.type][p.color === 'w' ? r : 7 - r][c];
  }
  if (s.status === 'check') val += (s.turn === perspective ? -100 : 100);
  const mobility = legalMoveCount ?? generateLegalMoves(s).length;
  return val + (s.turn === perspective ? mobility : -mobility) * 2;
}

export function evaluatePosition(s: GameState, perspective: Color): number {
  return evaluateScore(s, perspective);
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
  const legalMoves = generateLegalMoves(s).length;
  const mobility = (s.turn === perspective ? legalMoves : -legalMoves) * 2;

  return {
    material, position, mobility, check,
    total: material + position + check + mobility,
  };
}

/**
 * Thrown to unwind the search when the time budget is spent.
 *
 * A sentinel rather than a return value because every frame of minimax would
 * otherwise need to distinguish "this position scores zero" from "stop", and
 * one missed check silently returns a bogus score as if it were real.
 */
const SEARCH_ABORTED = Symbol('search-aborted');

let deadline = Infinity;

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** A compact state identity: piece placement, castling-relevant moved bits,
 * side to move and en-passant target. Search does not use history or captures. */
function positionKey(s: GameState): string {
  let key = s.turn;
  key += s.enPassantTarget ? `${s.enPassantTarget[0]}${s.enPassantTarget[1]}` : '-';
  for (const row of s.board) for (const piece of row) {
    key += piece ? `${piece.color}${piece.type}${piece.hasMoved ? '1' : '0'}` : '..';
  }
  return key;
}

function moveKey(move: Move): string {
  return `${move.kind}:${move.from?.join(',') ?? ''}:${move.to?.join(',') ?? ''}:${move.promoteTo ?? ''}:${move.castleSide ?? ''}`;
}

type Bound = 'exact' | 'lower' | 'upper';
type Transposition = { depth: number; score: number; bound: Bound; bestMove: string };
const transpositionTable = new Map<string, Transposition>();
const MAX_TRANSPOSITIONS = 120_000;
const killerMoves: [string?, string?][] = [];
const historyScores = new Map<string, number>();
const MAX_HISTORY_SCORE = 50_000;

function recordCutoff(depth: number, move: Move): void {
  const key = moveKey(move);
  const killers = killerMoves[depth] ?? [];
  if (killers[0] !== key) killerMoves[depth] = [key, killers[0]];
  if (!move.capturedPiece && !move.promoteTo) {
    historyScores.set(key, Math.min(MAX_HISTORY_SCORE, (historyScores.get(key) ?? 0) + depth * depth));
  }
}

type SearchUndo = {
  from: Coord; to: Coord; moving: Piece; target: Piece | null;
  capturedSquare: Coord | null; captured: Piece | null;
  rookFrom: Coord | null; rookTo: Coord | null; rook: Piece | null;
  turn: Color; halfMoveCount: number; enPassantTarget: Coord | null;
  status: GameState['status']; drawReason: DrawReason | null | undefined; winner: Color | null;
};

/** Mutate one search node in place, then restore it with searchAfterMove. */
function makeSearchMove(s: GameState, move: Move): SearchUndo {
  const from = move.from!, to = move.to!;
  const moving = s.board[from[0]][from[1]]!, target = s.board[to[0]][to[1]];
  const capturedSquare = move.capturedSquare ?? null;
  const captured = capturedSquare ? s.board[capturedSquare[0]][capturedSquare[1]] : null;
  const undo: SearchUndo = { from, to, moving, target, capturedSquare, captured, rookFrom: null, rookTo: null, rook: null, turn: s.turn, halfMoveCount: s.halfMoveCount, enPassantTarget: s.enPassantTarget ? [...s.enPassantTarget] as Coord : null, status: s.status, drawReason: s.drawReason, winner: s.winner };
  s.enPassantTarget = null;
  s.board[from[0]][from[1]] = null;
  s.board[to[0]][to[1]] = move.kind === 'promotion' ? { type: move.promoteTo!, color: moving.color, hasMoved: true, id: moving.id + '_p' } : { ...moving, hasMoved: true };
  if (capturedSquare) s.board[capturedSquare[0]][capturedSquare[1]] = null;
  if (moving.type === 'P' && Math.abs(to[0] - from[0]) === 2) s.enPassantTarget = [(to[0] + from[0]) / 2, to[1]];
  if (move.kind === 'castle') {
    const rookFile = move.castleSide === 'k' ? 7 : 0, rookTarget = move.castleSide === 'k' ? 5 : 3;
    undo.rookFrom = [from[0], rookFile]; undo.rookTo = [from[0], rookTarget];
    undo.rook = s.board[undo.rookFrom[0]][undo.rookFrom[1]];
    s.board[undo.rookFrom[0]][undo.rookFrom[1]] = null;
    s.board[undo.rookTo[0]][undo.rookTo[1]] = undo.rook ? { ...undo.rook, hasMoved: true } : null;
  }
  s.turn = opponentOf(s.turn); s.halfMoveCount++; s.winner = null;
  s.drawReason = isInsufficient(s.board) ? 'insufficient-material' : null;
  s.status = s.drawReason ? 'draw' : (isInCheck(s, s.turn) ? 'check' : 'playing');
  return undo;
}
function unmakeSearchMove(s: GameState, undo: SearchUndo): void {
  if (undo.rookFrom && undo.rookTo) { s.board[undo.rookFrom[0]][undo.rookFrom[1]] = undo.rook; s.board[undo.rookTo[0]][undo.rookTo[1]] = null; }
  if (undo.capturedSquare) s.board[undo.capturedSquare[0]][undo.capturedSquare[1]] = undo.captured;
  s.board[undo.from[0]][undo.from[1]] = undo.moving; s.board[undo.to[0]][undo.to[1]] = undo.target;
  s.turn = undo.turn; s.halfMoveCount = undo.halfMoveCount; s.enPassantTarget = undo.enPassantTarget; s.status = undo.status; s.drawReason = undo.drawReason; s.winner = undo.winner;
}
function searchAfterMove<T>(s: GameState, move: Move, run: () => T): T {
  const undo = makeSearchMove(s, move); try { return run(); } finally { unmakeSearchMove(s, undo); }
}

function orderSearchMoves(moves: Move[], depth: number, preferredMove?: string): Move[] {
  const killers = killerMoves[depth] ?? [];
  return moves.sort((a, b) => {
    const score = (move: Move) => {
      const key = moveKey(move);
      if (key === preferredMove) return 1_000_000;
      if (key === killers[0]) return 900_000;
      if (key === killers[1]) return 800_000;
      return (move.capturedPiece ? PIECE_VALUES[move.capturedPiece.type] * 16 : 0)
        + (move.promoteTo ? PIECE_VALUES[move.promoteTo] : 0)
        + (historyScores.get(key) ?? 0);
    };
    return score(b) - score(a);
  });
}

/**
 * Continue only forcing captures after the regular search horizon. A raw
 * material evaluation at depth zero mistakes "my queen is en prise" for a
 * stable position, which is especially punishing at intermediate budgets.
 * Four capture plies cap the work while covering the usual exchange sequence.
 */
function quiescence(s: GameState, alpha: number, beta: number, perspective: Color, remaining = 4): number {
  nodeCount++;
  if ((nodeCount & 63) === 0 && clock() > deadline) throw SEARCH_ABORTED;
  if (['checkmate', 'stalemate', 'draw'].includes(s.status)) return evaluatePosition(s, perspective);
  const legalMoves = generateLegalMoves(s);
  // The old path generated every legal move twice at each leaf: once for
  // mobility in evaluatePosition, again to choose quiescence candidates.
  const standPat = evaluateScore(s, perspective, legalMoves.length);
  if (remaining === 0) return standPat;
  // A checked side must search all legal evasions, not just captures.
  const candidates = (s.status === 'check' ? legalMoves : legalMoves.filter((move) => move.capturedPiece || move.promoteTo))
    .sort((a, b) => (b.capturedPiece ? PIECE_VALUES[b.capturedPiece.type] : 0) - (a.capturedPiece ? PIECE_VALUES[a.capturedPiece.type] : 0));
  if (legalMoves.length === 0) {
    return isInCheck(s, s.turn) ? (s.turn === perspective ? -1_000_000 : 1_000_000) : 0;
  }
  if (candidates.length === 0) return standPat;

  if (s.turn === perspective) {
    if (standPat >= beta) return standPat;
    let best = Math.max(alpha, standPat);
    for (const move of candidates) {
      best = Math.max(best, searchAfterMove(s, move, () => quiescence(s, best, beta, perspective, remaining - 1)));
      if (best >= beta) { cutoffCount++; break; }
    }
    return best;
  }

  if (standPat <= alpha) return standPat;
  let best = Math.min(beta, standPat);
  for (const move of candidates) {
    best = Math.min(best, searchAfterMove(s, move, () => quiescence(s, alpha, best, perspective, remaining - 1)));
    if (best <= alpha) { cutoffCount++; break; }
  }
  return best;
}
function minimax(s: GameState, depth: number, alpha: number, beta: number, perspective: Color): number {
  nodeCount++;
  if ((nodeCount & 63) === 0 && clock() > deadline) throw SEARCH_ABORTED;
  if (['checkmate', 'stalemate', 'draw'].includes(s.status)) return evaluatePosition(s, perspective);
  if (depth === 0) return quiescence(s, alpha, beta, perspective);

  const key = positionKey(s);
  const originalAlpha = alpha;
  const originalBeta = beta;
  const cached = transpositionTable.get(key);
  if (cached && cached.depth >= depth) {
    if (cached.bound === 'exact') return cached.score;
    if (cached.bound === 'lower') alpha = Math.max(alpha, cached.score);
    else beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  const moves = generateLegalMoves(s);
  if (moves.length === 0) {
    return isInCheck(s, s.turn) ? (s.turn === perspective ? -1_000_000 : 1_000_000) : 0;
  }
  orderSearchMoves(moves, depth, cached?.bestMove);
  const max = s.turn === perspective;
  let best = max ? -Infinity : Infinity;
  let bestMove = moves[0];

  let first = true;
  for (const move of moves) {
    let score: number;
    if (first) {
      score = searchAfterMove(s, move, () => minimax(s, depth - 1, alpha, beta, perspective));
      first = false;
    } else if (max) {
      // Principal variation search: a well-ordered sibling usually cannot beat
      // the current alpha. Test it through a one-point window first, then pay
      // for a full re-search only when it proves competitive.
      score = searchAfterMove(s, move, () => minimax(s, depth - 1, alpha, Math.min(beta, alpha + 1), perspective));
      if (score > alpha && score < beta) score = searchAfterMove(s, move, () => minimax(s, depth - 1, alpha, beta, perspective));
    } else {
      score = searchAfterMove(s, move, () => minimax(s, depth - 1, Math.max(alpha, beta - 1), beta, perspective));
      if (score < beta && score > alpha) score = searchAfterMove(s, move, () => minimax(s, depth - 1, alpha, beta, perspective));
    }
    if ((max && score > best) || (!max && score < best)) {
      best = score;
      bestMove = move;
    }
    if (max) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (alpha >= beta) { recordCutoff(depth, move); cutoffCount++; break; }
  }

  if (transpositionTable.size >= MAX_TRANSPOSITIONS) transpositionTable.clear();
  transpositionTable.set(key, {
    depth,
    score: best,
    bound: best <= originalAlpha ? 'upper' : best >= originalBeta ? 'lower' : 'exact',
    bestMove: moveKey(bestMove),
  });
  return best;
}
/** Below this the engine only stumbles into castling and en passant. */
export const FULL_RULES_ELO = 800;

export interface Strength {
  /** Ceiling on plies. The search stops earlier if the budget runs out. */
  depth: number;
  /** Wall-clock budget for one move, in milliseconds. */
  budgetMs: number;
  /** Chance the engine takes a weaker move than the one it found. */
  blunderChance: number;
  /** Whether castling and en passant are reliably available to it. */
  knowsFullRules: boolean;
}

/**
 * What a rating actually buys.
 *
 * Exported so the interface can describe a difficulty setting from the same
 * numbers the search uses, rather than restating them and drifting out of
 * step the next time a band moves.
 */
export function describeStrength(elo: number): Strength {
  let depth = 1;
  let budgetMs = 60;
  let blunderChance = 0;
  if (elo < 800)       { depth = 1; budgetMs = 60;   blunderChance = 0.4; }
  else if (elo < 1200) { depth = 2; budgetMs = 100;  blunderChance = 0.2; }
  // Calibrated against limited-strength Stockfish and Fairy-Stockfish. The
  // previous 1200 band (depth 4 / 180ms / 10% random move) scored near zero.
  // Its first quiescence retest overshot 50%; this budget targets parity.
  else if (elo < 1600) { depth = 7; budgetMs = 440;   blunderChance = 0.085; }
  else if (elo < 2000) { depth = 8; budgetMs = 1250;  blunderChance = 0.01; }
  else                 { depth = 11; budgetMs = 8000;  blunderChance = 0; }
  return { depth, budgetMs, blunderChance, knowsFullRules: elo >= FULL_RULES_ELO };
}

export function findBestMove(s: GameState, elo: number = 1200): Move | null {
  const moves = generateLegalMoves(s);
  if (moves.length === 0) return null;
  const perspective = s.turn;
  const { depth: maxDepth, budgetMs, blunderChance } = describeStrength(elo);

  // Below FULL_RULES_ELO the engine does not reliably know castling or en
  // passant, so
  // it only plays them when it has seen them before or stumbles into one.
  // This is what makes weak play read as inexperience rather than as a
  // shallower search.
  const isSecretKind = (k: MoveKind) => k === 'enPassant' || k === 'castle';
  const knownMoves: MoveKind[] = (s as unknown as { knownMoves?: MoveKind[] }).knownMoves || [];
  const filteredMoves = moves.filter(m => {
    if (!isSecretKind(m.kind)) return true;
    if (elo >= FULL_RULES_ELO) return true;
    if (knownMoves.includes(m.kind)) return true;
    return Math.random() < 0.15;
  });

const finalMoves = filteredMoves.length > 0 ? filteredMoves : moves;
  const searchRoot: GameState = {
    ...s,
    history: [],
    white: { capturedByOpponent: [] },
    black: { capturedByOpponent: [] },
  };
  transpositionTable.clear();
  killerMoves.length = 0;
  historyScores.clear();

  const started = clock();
  nodeCount = 0;
  cutoffCount = 0;
  let reachedDepth = 0;

  const report = (chosen: Move, scored: { notation: string; score: number; chosen: boolean }[], blundered: boolean) => {
    if (!traceListener) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try {
      publishSearchTrace({
        elo, depth: reachedDepth, nodes: nodeCount, cutoffs: cutoffCount,
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

  // A deliberate blunder does not search at all. Start the deadline only for
  // the path that enters minimax, so every early return leaves the module in
  // the same idle state as the finally block below.
  deadline = started + budgetMs;

  // Captures first for the opening pass; later passes reorder by what the
  // previous one learned.
  finalMoves.sort((a, b) => {
    const valA = a.capturedPiece ? PIECE_VALUES[a.capturedPiece.type] : 0;
    const valB = b.capturedPiece ? PIECE_VALUES[b.capturedPiece.type] : 0;
    return valB - valA;
  });

  /**
   * Iterative deepening.
   *
   * The engine used to search one fixed depth, which made its response time a
   * property of the position rather than a promise to the player: the top
   * rating took about seven seconds on a middlegame board, long enough to look
   * broken. Now it searches depth 1, then 2, and so on, keeping the best move
   * from the last pass that finished, and stops when the budget is spent. The
   * answer is always from a completed search, and it always arrives on time.
   *
   * Re-searching shallower depths is not the waste it appears to be. Each pass
   * leaves the moves ordered best-first for the next one, and alpha-beta prunes
   * far harder against a good first guess -- which is why this is usually
   * faster to a given depth than going straight there.
   */
  let bestM = finalMoves[0];
  let scored: { notation: string; score: number; chosen: boolean }[] = [];

  try {
  for (let d = 1; d <= maxDepth; d++) {
    let alpha = -Infinity;
    const beta = Infinity;
    let passBest = finalMoves[0];
    let passBestV = -Infinity;
    const passScored: { notation: string; score: number; chosen: boolean }[] = [];

    try {
      for (const m of finalMoves) {
        const v = searchAfterMove(searchRoot, m, () => minimax(searchRoot, d - 1, alpha, beta, perspective));
        passScored.push({ notation: traceListener ? describeMove(s, m) : '', score: v, chosen: false });
        if (v > passBestV) { passBestV = v; passBest = m; }
        alpha = Math.max(alpha, passBestV);
      }
    } catch (err) {
      if (err !== SEARCH_ABORTED) throw err;
      // Out of time partway through this depth. The completed moves were
      // searched against an incomplete window, so this pass is discarded
      // whole and the previous depth's answer stands.
      break;
    }

    // The pass finished, so its result supersedes the shallower one.
    bestM = passBest;
    scored = passScored;
    reachedDepth = d;

    // Order the next pass by this one's scores. This is the real payoff of
    // iterative deepening: the best move first means the deeper search cuts
    // off almost immediately on everything else.
    const rank = new Map(finalMoves.map((m, i) => [m, passScored[i].score]));
    finalMoves.sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));

    // No point starting a pass that cannot finish.
    if (clock() > deadline) break;
  }
  } finally {
    // Unconditional: if anything unexpected escapes the loop, a stale deadline
    // would make the *next* search abort instantly and silently return a
    // depth-zero move.
    deadline = Infinity;
  }

  if (traceListener) {
    const best = describeMove(s, bestM);
    for (const row of scored) row.chosen = row.notation === best;
    scored.sort((a, b) => b.score - a.score);
    report(bestM, scored, false);
  }
  return bestM;
}
