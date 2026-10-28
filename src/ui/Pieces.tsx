import { useLoader } from '@react-three/fiber';
import { Component, type ReactNode, Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import type { Color, PieceType } from '../engine';
import { BOARD_EDGE, SQUARE_SIZE, pickMaterial } from './materials';

/**
 * Where the piece models are loaded from.
 *
 * Defaults to the copies bundled under `public/models`, so a fresh clone
 * renders without any network access or configuration.
 *
 * Set `VITE_MODEL_BASE` to serve them from somewhere else instead, which is
 * worth doing if you are deploying the demo and would rather the models came
 * from a CDN or object store than from the app bundle:
 *
 *     VITE_MODEL_BASE=https://cdn.example.com/chess npm run build
 *
 * That host has to send `Access-Control-Allow-Origin`, since the loader reads
 * the files with fetch. If a model cannot be loaded from wherever it is
 * pointed, the piece falls back to a lathed silhouette and the board stays
 * playable rather than failing to render.
 */
export const MODEL_BASE = import.meta.env.VITE_MODEL_BASE ?? './models';

const MODEL_NAME: Record<PieceType, string> = {
  P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King',
};

const modelUrl = (type: PieceType) => `${MODEL_BASE}/${MODEL_NAME[type]}.obj`;

/** Heights in board units, so a king reads as a king beside a pawn. */
const HEIGHT_TARGET: Record<PieceType, number> = {
  P: 1.30, N: 1.70, B: 1.80, R: 1.40, Q: 2.10, K: 2.20,
};

/**
 * Scale a loaded model to its target height, stand it on the board, and centre
 * it on its square.
 *
 * Models arrive at arbitrary scale, arbitrary origin and sometimes lying on
 * their side, so none of that can be assumed. Scale comes from the largest
 * physical dimension rather than height, because a model authored lying down
 * has its length on a different axis. Grounding is then measured in the
 * rotated orientation and shifted back through the inverse rotation, so the
 * piece sits on the board rather than through it whichever way it was authored.
 */
function normalizePiece(
  obj: THREE.Object3D,
  type: PieceType,
  targetRotation: [number, number, number] = [0, 0, 0],
): THREE.Object3D {
  const root = obj.clone(true);
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const physicalSize = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(physicalSize);
  const physicalMax = Math.max(physicalSize.x, physicalSize.y, physicalSize.z);

  root.scale.setScalar((HEIGHT_TARGET[type] || 1.5) / (physicalMax || 1));
  root.updateMatrixWorld(true);

  const standing = root.clone();
  standing.rotation.set(...targetRotation);
  standing.updateMatrixWorld(true);

  const rotatedBox = new THREE.Box3().setFromObject(standing);
  const rotatedCenter = new THREE.Vector3();
  rotatedBox.getCenter(rotatedCenter);

  const worldShift = new THREE.Vector3(-rotatedCenter.x, -rotatedBox.min.y, -rotatedCenter.z);
  // The king model carries extra empty space beneath it.
  if (type === 'K') worldShift.y -= 0.52;

  const inverseRotation = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(...targetRotation))
    .invert();

  root.position.copy(worldShift.applyMatrix4(inverseRotation));
  root.updateMatrixWorld(true);
  return root;
}

/** Scale the board model to the squares and tuck it just beneath them. */
function normalizeBoard(obj: THREE.Object3D): THREE.Object3D {
  const root = obj.clone(true);
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const rawSize = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(rawSize);
  if (rawSize.x === 0 || rawSize.z === 0) return root;

  root.scale.setScalar((BOARD_EDGE * 1.18) / Math.max(rawSize.x, rawSize.z));
  root.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const scaledCenter = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);
  root.position.x = -scaledCenter.x;
  root.position.z = -scaledCenter.z;
  root.position.y = -scaledBox.max.y - 0.005;
  return root;
}

// ── fallback geometry ───────────────────────────────────────────────────
// Used only when a model cannot be fetched. Real pieces are turned on a
// lathe, so revolving a silhouette is the honest primitive for the job.

const PROFILES: Record<PieceType, [number, number][]> = {
  P: [[0.34, 0], [0.34, 0.06], [0.22, 0.12], [0.16, 0.34], [0.23, 0.46], [0.20, 0.56], [0.00, 0.62]],
  R: [[0.36, 0], [0.36, 0.07], [0.24, 0.14], [0.22, 0.62], [0.32, 0.70], [0.32, 0.86], [0.00, 0.86]],
  N: [[0.36, 0], [0.36, 0.07], [0.24, 0.16], [0.21, 0.52], [0.24, 0.60], [0.00, 0.64]],
  B: [[0.35, 0], [0.35, 0.07], [0.23, 0.15], [0.17, 0.60], [0.25, 0.76], [0.14, 0.92], [0.00, 1.06]],
  Q: [[0.40, 0], [0.40, 0.08], [0.27, 0.17], [0.19, 0.70], [0.32, 0.88], [0.26, 1.00], [0.00, 1.18]],
  K: [[0.41, 0], [0.41, 0.08], [0.28, 0.18], [0.20, 0.78], [0.33, 0.96], [0.27, 1.10], [0.00, 1.26]],
};

function LatheFallback({ type, material }: { type: PieceType; material: THREE.Material }) {
  const geometry = useMemo(() => {
    const geo = new THREE.LatheGeometry(PROFILES[type].map(([r, y]) => new THREE.Vector2(r, y)), 48);
    geo.computeVertexNormals();
    return geo;
  }, [type]);

  const scale = (HEIGHT_TARGET[type] / 2.2) * SQUARE_SIZE;
  return (
    <group scale={[scale, scale, scale]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
    </group>
  );
}

/** Renders `children`, or `fallback` if loading them threw. */
class ModelBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function LoadedPiece({ type, material }: { type: PieceType; material: THREE.Material }) {
  const model = useLoader(OBJLoader, modelUrl(type));
  const normalized = useMemo(() => {
    const piece = normalizePiece(model, type);
    piece.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return piece;
  }, [model, type, material]);

  return <primitive object={normalized} />;
}

export function Piece3D({
  type,
  color,
  row,
  col,
  isSelected,
  isValid,
  onSelect,
}: {
  type: PieceType;
  color: Color;
  row: number;
  col: number;
  isSelected?: boolean;
  isValid?: boolean;
  onSelect: (r: number, c: number) => void;
}) {
  const material = pickMaterial(color, isSelected, isValid);
  const fallback = <LatheFallback type={type} material={material} />;

  return (
    <group
      position={[(col - 3.5) * SQUARE_SIZE, 0.02, (row - 3.5) * SQUARE_SIZE]}
      rotation={[0, color === 'w' ? 0 : Math.PI, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(row, col);
      }}
    >
      <ModelBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <LoadedPiece type={type} material={material} />
        </Suspense>
      </ModelBoundary>
    </group>
  );
}

function LoadedBoard() {
  const model = useLoader(OBJLoader, `${MODEL_BASE}/ChessBoard.obj`);
  const normalized = useMemo(() => normalizeBoard(model), [model]);
  return <primitive object={normalized} />;
}

/** The decorative board model beneath the playable squares. */
export function BoardModel() {
  return (
    <ModelBoundary fallback={null}>
      <Suspense fallback={null}>
        <LoadedBoard />
      </Suspense>
    </ModelBoundary>
  );
}
