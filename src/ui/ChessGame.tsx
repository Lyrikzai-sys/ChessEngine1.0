import { OrbitControls, PerspectiveCamera, Environment } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type Color,
  type GameState,
  type Move,
  type PieceType,
  applyMove,
  createInitialState,
  legalMovesFromSquare,
} from '../engine';
import { searchBestMove } from '../searchClient';
import { Board } from './Board';
import { VoxelExplosion, WeaponStrike } from './CombatEffects';
import { VoxelPiece } from './VoxelPiece';

type Square = [number, number];

type CaptureSequence = {
  id: number;
  move: Move;
  attacker: { type: PieceType; color: Color };
  victim: { type: PieceType; color: Color };
  from: Square;
  target: Square;
  exploded: boolean;
};

/**
 * A playable board. You are white; the engine answers in a Web Worker so the
 * scene keeps rendering while it searches.
 */
export function ChessGame({ elo = 1200 }: { elo?: number }) {
  const [state, setState] = useState<GameState>(() => createInitialState('standard'));
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [capture, setCapture] = useState<CaptureSequence | null>(null);
  const timers = useRef<number[]>([]);
  const completedCaptureId = useRef<number | null>(null);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const commitMove = useCallback((move: Move) => {
    setState((current) => applyMove(current, move));
    setResolving(false);
  }, []);

  const completeCapture = useCallback((sequence: CaptureSequence) => {
    if (completedCaptureId.current === sequence.id) return;
    completedCaptureId.current = sequence.id;

    const timer = window.setTimeout(() => {
      setCapture((current) => (current?.id === sequence.id ? null : current));
      commitMove(sequence.move);
    }, 100);
    timers.current.push(timer);
  }, [commitMove]);

  const beginMove = useCallback((move: Move, position = state) => {
    const from = move.from as Square | undefined;
    const target = (move.kind === 'enPassant' ? move.capturedSquare : move.to) as Square | undefined;
    const attacker = from ? position.board[from[0]][from[1]] : null;
    const victim = move.capturedPiece;

    setSelected(null);
    setResolving(true);

    if (from && target && attacker && victim) {
      completedCaptureId.current = null;
      setCapture({
        id: Date.now(),
        move,
        attacker: { type: attacker.type, color: attacker.color },
        victim: { type: victim.type, color: victim.color },
        from,
        target,
        exploded: false,
      });
      return;
    }

    // Quiet moves still take a beat so captures never feel like a UI hiccup.
    const timer = window.setTimeout(() => commitMove(move), 260);
    timers.current.push(timer);
  }, [commitMove, state]);

  const onImpact = useCallback(() => {
    setCapture((current) => (current ? { ...current, exploded: true } : null));
  }, []);

  // useFrame stops entirely in a backgrounded tab, so neither the strike's
  // own progress check nor Rapier can land the hit there. Without this, a
  // move begun just before the tab was hidden would never commit.
  useEffect(() => {
    if (!capture || capture.exploded) return;
    const timer = window.setTimeout(onImpact, 1_500);
    return () => window.clearTimeout(timer);
  }, [capture, onImpact]);

  // Rapier contact is authoritative for starting the burst. The visual's
  // frame callback normally completes it at 0.68s; this only protects a move
  // if a browser pauses that callback during a WebGL or tab lifecycle event.
  useEffect(() => {
    if (!capture?.exploded) return;
    const timer = window.setTimeout(() => completeCapture(capture), 1_000);
    return () => window.clearTimeout(timer);
  }, [capture, completeCapture]);

  const moves: Move[] = useMemo(
    () => (selected ? legalMovesFromSquare(state, selected) : []),
    [state, selected],
  );

  const validSquares = useMemo(
    () => moves.map((m) => m.to).filter(Boolean) as [number, number][],
    [moves],
  );

  const humanColor: Color = 'w';
  const isHumanTurn = !resolving && state.turn === humanColor && state.status !== 'checkmate' && state.status !== 'stalemate';

  const onSelect = useCallback(
    (r: number, c: number) => {
      if (!isHumanTurn || thinking) return;

      // Second click: if it lands on a legal destination, play that move.
      const target = moves.find((m) => m.to?.[0] === r && m.to?.[1] === c);
      if (target) {
        beginMove(target);
        return;
      }

      const piece = state.board[r][c];
      setSelected(piece && piece.color === humanColor ? [r, c] : null);
    },
    [beginMove, isHumanTurn, thinking, moves, state],
  );

  const previewCapture = useCallback(() => {
    if (resolving || thinking) return;

    // A legal e4 / d5 position keeps the combat presentation inspectable
    // without a reviewer having to play several opening moves first.
    let preview = createInitialState('standard');
    const whiteAdvance = legalMovesFromSquare(preview, [6, 4]).find((move) => move.to?.[0] === 4 && move.to?.[1] === 4)!;
    preview = applyMove(preview, whiteAdvance);
    const blackAdvance = legalMovesFromSquare(preview, [1, 3]).find((move) => move.to?.[0] === 3 && move.to?.[1] === 3)!;
    preview = applyMove(preview, blackAdvance);
    const captureMove = legalMovesFromSquare(preview, [4, 4]).find((move) => move.to?.[0] === 3 && move.to?.[1] === 3)!;

    setState(preview);
    setSelected(null);
    setThinking(false);
    setCapture(null);
    beginMove(captureMove, preview);
  }, [beginMove, resolving, thinking]);

  // The engine replies whenever it is its turn.
  useEffect(() => {
    if (resolving) return;
    if (state.turn === humanColor) return;
    if (state.status === 'checkmate' || state.status === 'stalemate' || state.status === 'draw') return;

    let cancelled = false;
    setThinking(true);

    searchBestMove(state, elo)
      .then((move) => {
        if (cancelled || !move) return;
        beginMove(move);
      })
      .finally(() => {
        if (!cancelled) setThinking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [beginMove, elo, resolving, state]);

  const pieces = useMemo(() => {
    const out: { key: string; r: number; c: number; type: GameState['board'][0][0] }[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        const isExploding = capture?.exploded && capture.target[0] === r && capture.target[1] === c;
        if (p && !isExploding) out.push({ key: `${p.id}-${r}-${c}`, r, c, type: p });
      }
    }
    return out;
  }, [capture, state.board]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
        <PerspectiveCamera makeDefault position={[0, 14, 14]} fov={35} />
        <OrbitControls
          maxPolarAngle={Math.PI / 2.1}
          minDistance={6}
          maxDistance={40}
          enablePan={false}
          autoRotate={thinking}
          autoRotateSpeed={0.3}
          makeDefault
        />

        <ambientLight intensity={0.18} />
        <hemisphereLight intensity={0.2} groundColor="#000000" />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={100}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          shadow-bias={-0.0001}
        />
        <pointLight position={[-10, 15, -10]} intensity={0.5} color="#ccddff" />
        <spotLight
          position={[0, 24, 6]}
          angle={0.8}
          penumbra={1}
          intensity={0.25}
          color="#ffffff"
          castShadow
          shadow-mapSize={[1024, 1024]}
        />

        <Suspense fallback={null}>
          <Environment preset="studio" environmentIntensity={0.35} />
        </Suspense>
        <Suspense fallback={null}>
          <Board selected={selected} validSquares={validSquares} onSelect={onSelect} />
          {pieces.map(({ key, r, c, type }) => (
            <VoxelPiece
              key={key}
              type={type!.type}
              color={type!.color}
              row={r}
              col={c}
              isSelected={selected?.[0] === r && selected?.[1] === c}
              onSelect={onSelect}
            />
          ))}
        </Suspense>
        {capture && !capture.exploded && (
          <WeaponStrike
            key={capture.id}
            attacker={capture.attacker.type}
            color={capture.attacker.color}
            from={capture.from}
            to={capture.target}
            onImpact={onImpact}
          />
        )}
        {capture?.exploded && (
          <VoxelExplosion
            key={`burst-${capture.id}`}
            type={capture.victim.type}
            color={capture.victim.color}
            square={capture.target}
            onComplete={() => completeCapture(capture)}
          />
        )}
      </Canvas>

      <StatusBar state={state} thinking={thinking} resolving={resolving} />
      <button
        type="button"
        onClick={previewCapture}
        disabled={resolving || thinking}
        style={{
          position: 'absolute', top: 16, right: 16, padding: '9px 12px',
          border: '1px solid #d4af37', borderRadius: 6, background: '#171108', color: '#fde68a',
          font: '600 12px ui-sans-serif, system-ui, sans-serif', cursor: resolving || thinking ? 'wait' : 'pointer',
        }}
      >
        Preview capture
      </button>
    </div>
  );
}

function StatusBar({ state, thinking, resolving }: { state: GameState; thinking: boolean; resolving: boolean }) {
  const text = (() => {
    if (state.status === 'checkmate') return state.winner === 'w' ? 'Checkmate. You win.' : 'Checkmate. The engine wins.';
    if (state.status === 'stalemate') return 'Stalemate.';
    if (state.status === 'draw') return 'Draw.';
    if (resolving) return 'Resolving capture…';
    if (thinking) return 'Thinking…';
    if (state.status === 'check') return state.turn === 'w' ? 'You are in check.' : 'The engine is in check.';
    return state.turn === 'w' ? 'Your move. Click a piece, then a highlighted square.' : 'Engine to move.';
  })();

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '12px 16px',
        font: '13px/1.5 ui-sans-serif, system-ui, sans-serif',
        color: '#cbd5e1',
        background: 'linear-gradient(transparent, rgba(0,0,0,.65))',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}

