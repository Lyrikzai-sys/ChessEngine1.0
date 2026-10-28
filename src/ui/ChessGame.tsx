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
import { CAPTURE_DEMOS, stagedPosition } from '../captureDemos';
import { searchBestMove } from '../searchClient';
import { Board } from './Board';
import { BURST_SECONDS, VoxelExplosion, WeaponStrike } from './CombatEffects';
import {
  DifficultyPanel,
  CheckBadge,
  ResultBanner,
  StatusBar,
  isOver,
} from './GameOverlay';
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
export function ChessGame({ elo: initialElo = 1200 }: { elo?: number }) {
  const [state, setState] = useState<GameState>(() => createInitialState('standard'));
  const [elo, setElo] = useState(initialElo);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [capture, setCapture] = useState<CaptureSequence | null>(null);
  const timers = useRef<number[]>([]);
  const completedCaptureId = useRef<number | null>(null);
  const demoIndex = useRef(0);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const commitMove = useCallback((move: Move) => {
    setState((current) => applyMove(current, move));
    setResolving(false);
  }, []);

  const newGame = useCallback(() => {
    // Pending timers belong to a capture in the old game; left running they
    // would commit a move into the new one.
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    completedCaptureId.current = null;

    setState(createInitialState('standard'));
    setSelected(null);
    setCapture(null);
    setThinking(false);
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

  // The burst completes itself from its own frame callback. This only covers
  // the case where a browser pauses that callback partway through, during a
  // WebGL context loss or a tab lifecycle event.
  useEffect(() => {
    if (!capture?.exploded) return;
    const timer = window.setTimeout(() => completeCapture(capture), BURST_SECONDS * 1000 + 400);
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
  // `isOver` covers draws too. Checking only checkmate and stalemate here
  // left a drawn game still accepting moves.
  const isHumanTurn = !resolving && state.turn === humanColor && !isOver(state.status);

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

    // Cycle the demos so every weapon can be seen in turn, rather than only
    // whichever piece a reviewer happened to trade first.
    const demo = CAPTURE_DEMOS[demoIndex.current % CAPTURE_DEMOS.length];
    demoIndex.current++;

    const preview = stagedPosition(demo);
    const captureMove = legalMovesFromSquare(preview, demo.attackerSquare)
      .find((move) => move.to?.[0] === demo.victimSquare[0] && move.to?.[1] === demo.victimSquare[1])!;

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
    if (isOver(state.status)) return;

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
            from={capture.from}
            onComplete={() => completeCapture(capture)}
          />
        )}
      </Canvas>

      <StatusBar state={state} thinking={thinking} resolving={resolving} />
      <CheckBadge state={state} hidden={!!capture} />
      <DifficultyPanel elo={elo} onChange={setElo} disabled={resolving} />
      <ResultBanner state={state} onNewGame={newGame} />
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
