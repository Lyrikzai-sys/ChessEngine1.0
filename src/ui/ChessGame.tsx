import { OrbitControls, PerspectiveCamera, Environment } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import {
  type Color,
  type GameState,
  type Move,
  applyMove,
  createInitialState,
  legalMovesFromSquare,
} from '../engine';
import { searchBestMove } from '../searchClient';
import { Board } from './Board';
import { Piece3D } from './Pieces';

/**
 * A playable board. You are white; the engine answers in a Web Worker so the
 * scene keeps rendering while it searches.
 */
export function ChessGame({ elo = 1200 }: { elo?: number }) {
  const [state, setState] = useState<GameState>(() => createInitialState('standard'));
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [thinking, setThinking] = useState(false);

  const moves: Move[] = useMemo(
    () => (selected ? legalMovesFromSquare(state, selected) : []),
    [state, selected],
  );

  const validSquares = useMemo(
    () => moves.map((m) => m.to).filter(Boolean) as [number, number][],
    [moves],
  );

  const humanColor: Color = 'w';
  const isHumanTurn = state.turn === humanColor && state.status !== 'checkmate' && state.status !== 'stalemate';

  const onSelect = useCallback(
    (r: number, c: number) => {
      if (!isHumanTurn || thinking) return;

      // Second click: if it lands on a legal destination, play that move.
      const target = moves.find((m) => m.to?.[0] === r && m.to?.[1] === c);
      if (target) {
        setState((s) => applyMove(s, target));
        setSelected(null);
        return;
      }

      const piece = state.board[r][c];
      setSelected(piece && piece.color === humanColor ? [r, c] : null);
    },
    [isHumanTurn, thinking, moves, state],
  );

  // The engine replies whenever it is its turn.
  useEffect(() => {
    if (state.turn === humanColor) return;
    if (state.status === 'checkmate' || state.status === 'stalemate' || state.status === 'draw') return;

    let cancelled = false;
    setThinking(true);

    searchBestMove(state, elo)
      .then((move) => {
        if (cancelled || !move) return;
        setState((s) => applyMove(s, move));
      })
      .finally(() => {
        if (!cancelled) setThinking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [state, elo]);

  const pieces = useMemo(() => {
    const out: { key: string; r: number; c: number; type: GameState['board'][0][0] }[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (p) out.push({ key: `${p.id}-${r}-${c}`, r, c, type: p });
      }
    }
    return out;
  }, [state.board]);

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

        <ambientLight intensity={0.25} />
        <hemisphereLight intensity={0.2} groundColor="#000000" />
        <directionalLight
          position={[10, 20, 10]}
          intensity={2.0}
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
          <Environment preset="studio" environmentIntensity={0.8} />
          <Board selected={selected} validSquares={validSquares} onSelect={onSelect} />
          {pieces.map(({ key, r, c, type }) => (
            <Piece3D
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
      </Canvas>

      <StatusBar state={state} thinking={thinking} />
    </div>
  );
}

function StatusBar({ state, thinking }: { state: GameState; thinking: boolean }) {
  const text = (() => {
    if (state.status === 'checkmate') return state.winner === 'w' ? 'Checkmate. You win.' : 'Checkmate. The engine wins.';
    if (state.status === 'stalemate') return 'Stalemate.';
    if (state.status === 'draw') return 'Draw.';
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
