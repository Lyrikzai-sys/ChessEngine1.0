import { useMemo } from 'react';
import * as THREE from 'three';

import type { Color, PieceType } from '../engine';
import { meshVoxels } from '../voxel/voxelMesh';
import { pieceModel } from '../voxel/pieces';
import { SQUARE_SIZE } from './materials';

/**
 * Renders a voxel piece.
 *
 * The mesher returns per-vertex colours, so the piece carries its own palette
 * and the material only has to light it. Selection and legal-move states tint
 * through `emissive` rather than replacing the colours, which keeps the value
 * ladder intact instead of flattening the piece to a single highlight hue.
 */

const BASE_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.45,
  metalness: 0.1,
  flatShading: true,
});

const SELECTED_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.4,
  metalness: 0.1,
  flatShading: true,
  emissive: new THREE.Color('#fbbf24'),
  emissiveIntensity: 0.55,
});

const VALID_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.4,
  metalness: 0.1,
  flatShading: true,
  emissive: new THREE.Color('#10b981'),
  emissiveIntensity: 0.45,
});

function geometryFor(type: PieceType, color: Color): THREE.BufferGeometry {
  const { positions, index, colors } = meshVoxels(pieceModel(type, color === 'w' ? 'w' : 'b'));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();

  // The mesher centres X and Z but leaves Y starting at zero, which is what we
  // want: the piece stands on the board rather than sinking through it.
  return geo;
}

const geometryCache = new Map<string, THREE.BufferGeometry>();

export function VoxelPiece({
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
  const geometry = useMemo(() => {
    const key = `${type}${color}`;
    let geo = geometryCache.get(key);
    if (!geo) {
      geo = geometryFor(type, color);
      geometryCache.set(key, geo);
    }
    return geo;
  }, [type, color]);

  const material = isSelected ? SELECTED_MATERIAL : isValid ? VALID_MATERIAL : BASE_MATERIAL;

  return (
    <group
      position={[(col - 3.5) * SQUARE_SIZE, 0.02, (row - 3.5) * SQUARE_SIZE]}
      // Knights face the opponent, so black turns to look up the board.
      rotation={[0, color === 'w' ? 0 : Math.PI, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(row, col);
      }}
    >
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
    </group>
  );
}
