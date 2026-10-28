import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import type { Color, PieceType } from '../engine';
import { meshVoxels } from '../voxel/voxelMesh';
import { pieceModel } from '../voxel/pieces';
import { weaponModel } from '../voxel/weapons';
import { SQUARE_SIZE } from './materials';

/**
 * The capture sequence: the attacker manifests its own voxel weapon, swings it
 * into the victim, and the victim bursts into its own voxels and fades.
 *
 * Both halves run off elapsed time in `useFrame` rather than a physics engine.
 * The weapon travels a deterministic curve between two known squares, so the
 * moment of impact is already known from that curve; simulating it would add a
 * WASM dependency to rediscover a number we have. These components own no game
 * state — they only report when each stage finishes.
 */

type Square = [number, number];

const WIND_UP = 0.3;
const STRIKE_DURATION = 0.55;
const BURST_DURATION = 0.68;

const squarePosition = ([row, col]: Square, y: number) => new THREE.Vector3(
  (col - 3.5) * SQUARE_SIZE,
  y,
  (row - 3.5) * SQUARE_SIZE,
);

const weaponGeometryCache = new Map<string, THREE.BufferGeometry>();

function weaponGeometry(type: PieceType, color: Color): THREE.BufferGeometry {
  const key = `${type}${color}`;
  const cached = weaponGeometryCache.get(key);
  if (cached) return cached;

  const mesh = meshVoxels(weaponModel(type, color));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(mesh.colors, 3));
  geometry.setIndex(mesh.index);
  geometry.computeVertexNormals();
  weaponGeometryCache.set(key, geometry);
  return geometry;
}

/**
 * Carries the attacker's weapon into the victim's square: a short wind-up away
 * from the target, then an accelerating fall onto it. `onImpact` fires once,
 * on the frame the weapon lands.
 */
export function WeaponStrike({
  attacker,
  color,
  from,
  to,
  onImpact,
}: {
  attacker: PieceType;
  color: Color;
  from: Square;
  to: Square;
  onImpact: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const struck = useRef(false);

  const geometry = useMemo(() => weaponGeometry(attacker, color), [attacker, color]);

  const path = useMemo(() => {
    const origin = squarePosition(from, 1.9);
    const target = squarePosition(to, 0.75);

    // Horizontal heading from attacker to victim. No move ever starts and ends
    // on the same square, so this is always a real direction.
    const heading = target.clone().sub(origin).setY(0).normalize();

    // The weapon comes down at an angle rather than driving in flat, which
    // reads as a swing instead of as a projectile.
    const facing = heading.clone().addScaledVector(new THREE.Vector3(0, 1, 0), -0.45).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), facing);

    // Wind-up pose: back off along the heading and lift, giving the strike
    // somewhere to accelerate from.
    const raised = origin.clone().addScaledVector(heading, -0.45).setY(2.5);

    return { origin, target, raised, quaternion };
  }, [from, to]);

  useFrame((_, delta) => {
    if (struck.current || !group.current) return;

    elapsed.current += delta;
    const progress = Math.min(elapsed.current / STRIKE_DURATION, 1);

    if (progress < WIND_UP) {
      // Ease out of the resting pose into the cocked pose.
      const t = progress / WIND_UP;
      group.current.position.copy(path.origin).lerp(path.raised, 1 - (1 - t) ** 2);
    } else {
      // Drive into the victim. Quadratic, so the last frames are the fastest.
      const t = (progress - WIND_UP) / (1 - WIND_UP);
      group.current.position.copy(path.raised).lerp(path.target, t * t);
    }

    if (progress === 1) {
      struck.current = true;
      onImpact();
    }
  });

  return (
    <group ref={group} position={path.origin} quaternion={path.quaternion}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.3} metalness={0.35} flatShading />
      </mesh>
    </group>
  );
}

type Fragment = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  spin: THREE.Vector3;
};

/**
 * Samples the captured piece's own voxels into debris. Reusing those cells
 * means the fragments are always the right colours and the right shape for
 * whatever was taken, with no second asset to keep in sync with the pieces.
 */
function fragmentsFor(type: PieceType, color: Color): Fragment[] {
  const model = pieceModel(type, color === 'w' ? 'w' : 'b');
  const [sx, , sz] = model.size;
  const cellSize = model.voxelSize ?? 0.05;
  const count = model.cells.length / 2;
  // A king runs to several thousand cells. Around 220 instances is plenty of
  // debris and keeps the instanced draw cheap on a laptop GPU.
  const stride = Math.max(1, Math.ceil(count / 220));
  const fragments: Fragment[] = [];

  for (let pair = 0; pair < count; pair += stride) {
    const linear = model.cells[pair * 2];
    const paletteIndex = model.cells[pair * 2 + 1];
    const x = linear % sx;
    const z = Math.floor(linear / sx) % sz;
    const y = Math.floor(linear / (sx * sz));

    const position = new THREE.Vector3(
      (x + 0.5) * cellSize - (sx * cellSize) / 2,
      (y + 0.5) * cellSize,
      (z + 0.5) * cellSize - (sz * cellSize) / 2,
    );

    // Throw each cell outward from the piece's own axis, so the burst opens up
    // in the shape of the piece rather than as a uniform ball.
    const outward = new THREE.Vector3(position.x, 0, position.z);
    if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
    outward.normalize().multiplyScalar(1.1 + ((pair * 7) % 9) * 0.07);

    fragments.push({
      position,
      velocity: new THREE.Vector3(outward.x, 1.3 + ((pair * 5) % 10) * 0.11, outward.z),
      color: new THREE.Color(model.palette[paletteIndex]),
      spin: new THREE.Vector3((pair % 5) - 2, ((pair * 3) % 5) - 2, ((pair * 11) % 5) - 2),
    });
  }

  return fragments;
}

/** The captured piece coming apart: debris flies, shrinks and fades out. */
export function VoxelExplosion({
  type,
  color,
  square,
  onComplete,
}: {
  type: PieceType;
  color: Color;
  square: Square;
  onComplete: () => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const elapsed = useRef(0);
  const completed = useRef(false);

  const fragments = useMemo(() => fragmentsFor(type, color), [type, color]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const origin = useMemo(() => squarePosition(square, 0.03), [square]);

  useLayoutEffect(() => {
    if (!mesh.current) return;

    fragments.forEach((fragment, index) => {
      dummy.position.copy(fragment.position);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(index, dummy.matrix);
      mesh.current!.setColorAt(index, fragment.color);
    });

    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [dummy, fragments]);

  useFrame((_, delta) => {
    if (!mesh.current) return;

    elapsed.current += delta;
    const t = elapsed.current;
    const age = Math.min(t / BURST_DURATION, 1);
    const scale = Math.max(0.04, 1 - age * 0.96);
    const drop = -2.5 * t * t;

    fragments.forEach((fragment, index) => {
      dummy.position.copy(fragment.position).addScaledVector(fragment.velocity, t);
      dummy.position.y += drop;
      dummy.rotation.set(fragment.spin.x * t, fragment.spin.y * t, fragment.spin.z * t);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(index, dummy.matrix);
    });

    mesh.current.instanceMatrix.needsUpdate = true;
    if (material.current) material.current.opacity = 1 - age;

    if (age === 1 && !completed.current) {
      completed.current = true;
      onComplete();
    }
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, fragments.length]} position={origin} castShadow>
      <boxGeometry args={[0.055, 0.055, 0.055]} />
      {/* No `vertexColors`: a box geometry carries no colour attribute, so the
          per-fragment colour comes from the instance colours set above. */}
      <meshStandardMaterial ref={material} transparent depthWrite={false} roughness={0.35} metalness={0.2} />
    </instancedMesh>
  );
}
