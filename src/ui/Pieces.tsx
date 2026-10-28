import { useMemo } from 'react';
import * as THREE from 'three';

import type { Color, PieceType } from '../engine';
import { SQUARE_SIZE, pickMaterial } from './materials';

/**
 * Pieces are built from lathed profiles rather than loaded from model files.
 *
 * The original application rendered OBJ and 3DS sets from object storage.
 * Those are not included here: hosting an asset is not the same as holding the
 * right to redistribute it, and a public repository that cannot be cloned and
 * run is worth less than one with simpler pieces.
 *
 * A lathe suits the subject. Real chess pieces are turned on one, so revolving
 * a silhouette around the vertical axis is how the originals were actually
 * shaped, and it gives every piece a consistent family resemblance for free.
 * Knights get an extra wedge, since a horse's head is the one shape a lathe
 * cannot produce.
 */

/** Silhouettes in [radius, height] pairs, bottom to top, before scaling. */
const PROFILES: Record<PieceType, [number, number][]> = {
  P: [[0.34, 0], [0.34, 0.06], [0.22, 0.12], [0.16, 0.34], [0.23, 0.46], [0.20, 0.56], [0.00, 0.62]],
  R: [[0.36, 0], [0.36, 0.07], [0.24, 0.14], [0.22, 0.62], [0.32, 0.70], [0.32, 0.86], [0.00, 0.86]],
  N: [[0.36, 0], [0.36, 0.07], [0.24, 0.16], [0.21, 0.52], [0.24, 0.60], [0.00, 0.64]],
  B: [[0.35, 0], [0.35, 0.07], [0.23, 0.15], [0.17, 0.60], [0.25, 0.76], [0.14, 0.92], [0.07, 1.02], [0.00, 1.06]],
  Q: [[0.40, 0], [0.40, 0.08], [0.27, 0.17], [0.19, 0.70], [0.32, 0.88], [0.26, 1.00], [0.30, 1.12], [0.00, 1.18]],
  K: [[0.41, 0], [0.41, 0.08], [0.28, 0.18], [0.20, 0.78], [0.33, 0.96], [0.27, 1.10], [0.30, 1.20], [0.00, 1.26]],
};

/** Tallest-to-shortest ordering, so a king reads as a king next to a pawn. */
const HEIGHT: Record<PieceType, number> = {
  P: 0.52, R: 0.62, N: 0.68, B: 0.78, Q: 0.92, K: 1.0,
};

function latheGeometry(type: PieceType): THREE.LatheGeometry {
  const points = PROFILES[type].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(points, 48);
  geo.computeVertexNormals();
  return geo;
}

/** The crosspiece on a king, the orb on a queen. */
function TopDetail({ type, material }: { type: PieceType; material: THREE.Material }) {
  if (type === 'K') {
    return (
      <group position={[0, 1.3, 0]}>
        <mesh material={material} castShadow>
          <boxGeometry args={[0.07, 0.3, 0.07]} />
        </mesh>
        <mesh material={material} position={[0, 0.07, 0]} castShadow>
          <boxGeometry args={[0.22, 0.07, 0.07]} />
        </mesh>
      </group>
    );
  }
  if (type === 'Q') {
    return (
      <mesh material={material} position={[0, 1.2, 0]} castShadow>
        <sphereGeometry args={[0.09, 20, 20]} />
      </mesh>
    );
  }
  return null;
}

/** A horse's head cannot be turned on a lathe, so the knight gets a wedge. */
function KnightHead({ material }: { material: THREE.Material }) {
  return (
    <group position={[0, 0.74, 0.02]} rotation={[0.32, 0, 0]}>
      <mesh material={material} castShadow>
        <boxGeometry args={[0.2, 0.34, 0.42]} />
      </mesh>
      <mesh material={material} position={[0, 0.2, -0.14]} rotation={[-0.5, 0, 0]} castShadow>
        <boxGeometry args={[0.17, 0.2, 0.18]} />
      </mesh>
    </group>
  );
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
  const geometry = useMemo(() => latheGeometry(type), [type]);
  const material = pickMaterial(color, isSelected, isValid);

  const x = (col - 3.5) * SQUARE_SIZE;
  const z = (row - 3.5) * SQUARE_SIZE;
  const scale = (HEIGHT[type] / 1.0) * SQUARE_SIZE * 0.78;

  return (
    <group
      position={[x, 0.02, z]}
      scale={[scale, scale, scale]}
      // Black faces down the board, so its knights look at the opponent.
      rotation={[0, color === 'w' ? 0 : Math.PI, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(row, col);
      }}
    >
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
      {type === 'N' && <KnightHead material={material} />}
      <TopDetail type={type} material={material} />
    </group>
  );
}
