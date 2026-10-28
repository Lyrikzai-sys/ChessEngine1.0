import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import type { Color, PieceType } from '../engine';
import { meshVoxels } from '../voxel/voxelMesh';
import { pieceModel } from '../voxel/pieces';
import {
  ACCENT,
  RELEASE_AT,
  STRIKE_SECONDS,
  WEAPON_STYLE,
  projectileModel,
  weaponModel,
} from '../voxel/weapons';
import { SQUARE_SIZE } from './materials';

/**
 * The capture sequence: the attacker brings out its own weapon, uses it the
 * way that weapon is used, and the victim comes apart into the very voxels it
 * was built from.
 *
 * Everything runs off elapsed time in `useFrame` rather than a physics engine.
 * The weapon follows a deterministic curve between two known squares, so the
 * moment of impact is already known from that curve. The debris does need
 * integrating, but only against a flat board, which is eight lines of code
 * rather than a WASM dependency.
 *
 * These components own no game state. They report when each stage finishes and
 * the board decides what that means.
 */

type Square = [number, number];

/** Long enough to watch the debris arc, hit the board and tumble. */
export const BURST_SECONDS = 0.8;
const FADE_FROM = 0.62;

const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 9.2;

const squarePosition = ([row, col]: Square, y: number) => new THREE.Vector3(
  (col - 3.5) * SQUARE_SIZE,
  y,
  (row - 3.5) * SQUARE_SIZE,
);

const geometryCache = new Map<string, THREE.BufferGeometry>();

function voxelGeometry(key: string, build: () => ReturnType<typeof meshVoxels>): THREE.BufferGeometry {
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const mesh = build();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(mesh.colors, 3));
  geometry.setIndex(mesh.index);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

/** Rotate a horizontal vector about the Y axis, in place. */
function rotateY(v: THREE.Vector3, angle: number) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const x = v.x * c - v.z * s;
  const z = v.x * s + v.z * c;
  return v.set(x, v.y, z);
}

/* ------------------------------------------------------------------ strike */

/**
 * Brings the attacker's weapon to bear. Each `StrikeStyle` gets the motion
 * that weapon actually has: a sword sweeps, a spear drives straight, a cannon
 * recoils and throws a ball. `onImpact` fires once, when the blow lands.
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
  const style = WEAPON_STYLE[attacker];
  const duration = STRIKE_SECONDS[style];
  const release = RELEASE_AT[style];

  const weapon = useRef<THREE.Group>(null);
  const shot = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  const struck = useRef(false);

  const weaponGeometry = useMemo(
    () => voxelGeometry(`w:${attacker}${color}`, () => meshVoxels(weaponModel(attacker, color))),
    [attacker, color],
  );

  const shotGeometry = useMemo(() => {
    const model = projectileModel(attacker, color);
    if (!model) return null;
    return voxelGeometry(`p:${attacker}${color}`, () => meshVoxels(model));
  }, [attacker, color]);

  const path = useMemo(() => {
    const origin = squarePosition(from, 0);
    const target = squarePosition(to, 0);
    const heading = target.clone().sub(origin).setY(0).normalize();

    // Where the weapon is held, and which way it points, depend on the style.
    // Resolving both here keeps the frame callback to arithmetic.
    const facing = new THREE.Quaternion();
    switch (style) {
      case 'thrust':
        // Couched well down rather than level. A spear driven flat along the
        // board points almost straight away from the camera and foreshortens
        // into a stub; angled down, its whole length stays visible.
        facing.setFromUnitVectors(UP, heading.clone().addScaledVector(UP, -0.6).normalize());
        break;
      case 'overhead':
        facing.setFromUnitVectors(UP, heading.clone().multiplyScalar(0.25).addScaledVector(UP, -1).normalize());
        break;
      case 'cannon':
        facing.setFromUnitVectors(UP, heading.clone().addScaledVector(UP, 0.18).normalize());
        break;
      default:
        // Crozier and staff are carried upright; the sword sets its own angle
        // every frame as it sweeps.
        break;
    }

    // Weapons that stay put would otherwise spawn inside the piece holding
    // them, which is tall enough to swallow a cannon whole. They stand off to
    // one side instead, clear of the model.
    const side = new THREE.Vector3().crossVectors(UP, heading).normalize();

    return { origin, target, heading, side, facing };
  }, [from, to, style]);

  // Scratch vectors, so a 60fps callback allocates nothing.
  const scratch = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }), []);

  useFrame((_, delta) => {
    if (struck.current || !weapon.current) return;

    elapsed.current += delta;
    const progress = Math.min(elapsed.current / duration, 1);
    const { origin, target, heading } = path;
    const { a, b } = scratch;

    // How far through the committed part of the strike we are: 0 until the
    // weapon is released, then 0..1 as the blow actually travels.
    const after = progress <= release ? 0 : (progress - release) / (1 - release);
    const windUp = Math.min(progress / release, 1);

    switch (style) {
      case 'slash': {
        // The sword orbits the victim, closing in as it comes round.
        const angle = 2.0 - 2.6 * (after > 0 ? after * after : 0) - 0.25 * windUp;
        const radius = 1.3 - 1.0 * after;
        a.copy(heading).multiplyScalar(-1);
        rotateY(a, angle);
        weapon.current.position.copy(target).addScaledVector(a, radius).setY(1.5 - 0.6 * after);
        // Blade leads along the tangent, so it sweeps edge-first.
        b.copy(UP).cross(a).normalize();
        weapon.current.quaternion.setFromUnitVectors(UP, b);
        break;
      }

      case 'thrust': {
        // Draw back, then drive the point straight through.
        a.copy(target).addScaledVector(heading, -1.4 - 0.5 * windUp).setY(1.9 + 0.3 * windUp);
        weapon.current.position.copy(a).lerp(b.copy(target).setY(1.0), after * after);
        weapon.current.quaternion.copy(path.facing);
        break;
      }

      case 'overhead': {
        // Raise over the victim, then bring it down.
        a.copy(target).addScaledVector(heading, -1.2 + 0.85 * windUp).setY(2.0 + 1.3 * windUp);
        weapon.current.position.copy(a).lerp(b.copy(target).setY(0.95), after * after);
        weapon.current.quaternion.copy(path.facing);
        break;
      }

      case 'cannon': {
        // The gun rolls up, then kicks back along its own barrel as it fires.
        const recoil = after > 0 ? Math.max(0, 0.5 - after * 1.6) : 0;
        weapon.current.position
          .copy(origin)
          .addScaledVector(heading, 0.7 - recoil)
          .addScaledVector(path.side, 0.5)
          .setY(0.6 + 0.5 * windUp);
        weapon.current.quaternion.copy(path.facing);

        if (shot.current) {
          shot.current.visible = after > 0;
          if (after > 0) {
            // Out of the muzzle, with just enough arc to read as a shot.
            a.copy(weapon.current.position).addScaledVector(heading, 1.1).setY(1.5);
            shot.current.position.copy(a).lerp(b.copy(target).setY(0.9), after);
            shot.current.position.y += Math.sin(Math.PI * after) * 0.4;
          }
        }
        break;
      }

      case 'bolt': {
        // The crozier is held up and the mote leaves the crook.
        weapon.current.position
          .copy(origin)
          .addScaledVector(heading, 0.35)
          .addScaledVector(path.side, 0.5)
          .setY(1.1 + 0.6 * windUp);
        weapon.current.quaternion.identity();

        if (shot.current) {
          shot.current.visible = after > 0;
          if (after > 0) {
            a.copy(weapon.current.position).addScaledVector(heading, 0.2).setY(2.6);
            shot.current.position.copy(a).lerp(b.copy(target).setY(0.9), after * after);
          }
        }
        break;
      }

      case 'channel': {
        // The staff is raised and held; the light does the travelling.
        weapon.current.position
          .copy(origin)
          .addScaledVector(heading, 0.3)
          .addScaledVector(path.side, 0.55)
          .setY(1.2 + 0.8 * windUp);
        weapon.current.quaternion.identity();

        if (beam.current) {
          beam.current.visible = after > 0;
          if (after > 0) {
            const width = 0.12 + 0.5 * Math.sin(Math.PI * Math.min(1, after * 1.2));
            beam.current.scale.set(width, 1, width);
            (beam.current.material as THREE.Material).opacity = 0.9 * Math.sin(Math.PI * after) + 0.1;
          }
        }
        break;
      }
    }

    if (progress === 1) {
      struck.current = true;
      onImpact();
    }
  });

  const beamHeight = 6;

  return (
    <>
      <group ref={weapon} position={path.origin}>
        <mesh geometry={weaponGeometry} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.3} metalness={0.35} flatShading />
        </mesh>
      </group>

      {shotGeometry && (
        <group ref={shot} visible={false}>
          <mesh geometry={shotGeometry} castShadow>
            <meshStandardMaterial
              vertexColors
              flatShading
              roughness={0.25}
              metalness={0.4}
              emissive={new THREE.Color(ACCENT[color])}
              emissiveIntensity={attacker === 'B' ? 1.4 : 0.15}
            />
          </mesh>
        </group>
      )}

      {style === 'channel' && (
        <mesh ref={beam} visible={false} position={squarePosition(to, beamHeight / 2)}>
          <cylinderGeometry args={[0.5, 0.5, beamHeight, 16, 1, true]} />
          <meshBasicMaterial
            color={ACCENT[color]}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- shatter */

interface Debris {
  /** Starting offsets, colours and spin, one entry per surface voxel. */
  origin: Float32Array;
  color: Float32Array;
  spin: Float32Array;
  velocity: Float32Array;
  count: number;
  cell: number;
}

/**
 * Every surface voxel of the piece, as a real cube at its real size and real
 * position. At the first frame this is pixel-for-pixel the piece that was
 * standing there; it only stops being the piece because it is thrown apart.
 *
 * Interior voxels are skipped because they were never visible, which is also
 * what keeps the colours right: the buried cells are the darkest steps of the
 * ladder, and sampling them is what made an earlier version burst into soot.
 */
function debrisFor(type: PieceType, color: Color, heading: THREE.Vector3): Debris {
  const model = pieceModel(type, color === 'w' ? 'w' : 'b');
  const [sx, sy, sz] = model.size;
  const cell = model.voxelSize ?? 0.05;

  const solid = new Map<number, number>();
  for (let i = 0; i < model.cells.length; i += 2) solid.set(model.cells[i], model.cells[i + 1]);

  const filled = (x: number, y: number, z: number) =>
    !(x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) && solid.has((y * sz + z) * sx + x);

  const palette = model.palette.map((hex) => new THREE.Color(hex));
  const ox = (sx * cell) / 2;
  const oz = (sz * cell) / 2;

  const origin: number[] = [];
  const colors: number[] = [];
  const spin: number[] = [];
  const velocity: number[] = [];

  // The blow lands high on the piece and drives through it, so the top is
  // thrown hardest and the base is barely disturbed.
  const impactHeight = sy * cell * 0.72;

  let index = 0;
  solid.forEach((paletteIndex, linear) => {
    const x = linear % sx;
    const z = Math.floor(linear / sx) % sz;
    const y = Math.floor(linear / (sx * sz));

    const exposed =
      !filled(x + 1, y, z) || !filled(x - 1, y, z) ||
      !filled(x, y + 1, z) || !filled(x, y - 1, z) ||
      !filled(x, y, z + 1) || !filled(x, y, z - 1);
    if (!exposed) return;

    const px = (x + 0.5) * cell - ox;
    const py = (y + 0.5) * cell;
    const pz = (z + 0.5) * cell - oz;
    origin.push(px, py, pz);

    const c = palette[paletteIndex] ?? palette[0];
    colors.push(c.r, c.g, c.b);

    // Cheap deterministic jitter: the same piece always shatters the same way,
    // which makes the effect reproducible when something looks wrong.
    const n = index * 2654435761;
    const j1 = ((n >>> 8) % 1000) / 1000 - 0.5;
    const j2 = ((n >>> 16) % 1000) / 1000 - 0.5;
    const j3 = ((n >>> 24) % 1000) / 1000 - 0.5;

    // Outward from the piece axis, upward, and onward along the blow.
    const radial = Math.hypot(px, pz) || 1e-4;
    const share = 1 - Math.min(1, Math.abs(py - impactHeight) / (sy * cell));
    const force = 0.9 + 3.4 * share * share;

    velocity.push(
      (px / radial) * force * (0.7 + j1 * 0.5) + heading.x * force * 0.55,
      1.1 + force * 0.75 + j2 * 0.9,
      (pz / radial) * force * (0.7 + j3 * 0.5) + heading.z * force * 0.55,
    );

    spin.push(j1 * 26, j2 * 26, j3 * 26);
    index++;
  });

  return {
    origin: new Float32Array(origin),
    color: new Float32Array(colors),
    spin: new Float32Array(spin),
    velocity: new Float32Array(velocity),
    count: index,
    cell,
  };
}

/**
 * The captured piece coming apart. The debris is integrated against the board
 * so the voxels arc, land, bounce once and tumble, then fade out.
 */
export function VoxelExplosion({
  type,
  color,
  square,
  from,
  onComplete,
}: {
  type: PieceType;
  color: Color;
  square: Square;
  from: Square;
  onComplete: () => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const elapsed = useRef(0);
  const completed = useRef(false);
  const opaque = useRef(true);

  // A piece is drawn turned to face its opponent, so the debris sits inside a
  // group with that same turn. The blow therefore has to be expressed in the
  // piece's own frame, and a half turn about Y simply negates it.
  const heading = useMemo(() => {
    const h = squarePosition(square, 0).sub(squarePosition(from, 0)).setY(0).normalize();
    return color === 'w' ? h : h.multiplyScalar(-1);
  }, [color, from, square]);

  const debris = useMemo(() => debrisFor(type, color, heading), [type, color, heading]);
  const live = useMemo(
    () => ({ position: new Float32Array(debris.origin), velocity: new Float32Array(debris.velocity), rotation: new Float32Array(debris.count * 3) }),
    [debris],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tint = useMemo(() => new THREE.Color(), []);

  useLayoutEffect(() => {
    if (!mesh.current) return;

    // Frame zero has to be the piece exactly: same cells, same places.
    for (let i = 0; i < debris.count; i++) {
      dummy.position.set(debris.origin[i * 3], debris.origin[i * 3 + 1], debris.origin[i * 3 + 2]);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
      mesh.current.setColorAt(i, tint.setRGB(debris.color[i * 3], debris.color[i * 3 + 1], debris.color[i * 3 + 2]));
    }

    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [debris, dummy, tint]);

  useFrame((_, delta) => {
    if (!mesh.current) return;

    elapsed.current += delta;
    const age = Math.min(elapsed.current / BURST_SECONDS, 1);
    const step = Math.min(delta, 1 / 30); // a dropped frame must not teleport debris
    const floor = debris.cell / 2;
    const { position, velocity, rotation } = live;

    for (let i = 0; i < debris.count; i++) {
      const p = i * 3;

      velocity[p + 1] -= GRAVITY * step;
      position[p] += velocity[p] * step;
      position[p + 1] += velocity[p + 1] * step;
      position[p + 2] += velocity[p + 2] * step;

      if (position[p + 1] < floor) {
        // Land on the board: lose most of the bounce, scrub off sideways
        // speed and spin, so the debris settles instead of skating away.
        position[p + 1] = floor;
        velocity[p + 1] *= -0.26;
        velocity[p] *= 0.62;
        velocity[p + 2] *= 0.62;
        rotation[p] *= 0.5;
        rotation[p + 1] *= 0.5;
        rotation[p + 2] *= 0.5;
      } else {
        rotation[p] += debris.spin[p] * step;
        rotation[p + 1] += debris.spin[p + 1] * step;
        rotation[p + 2] += debris.spin[p + 2] * step;
      }

      dummy.position.set(position[p], position[p + 1], position[p + 2]);
      dummy.rotation.set(rotation[p], rotation[p + 1], rotation[p + 2]);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }

    mesh.current.instanceMatrix.needsUpdate = true;

    if (age > FADE_FROM && material.current) {
      if (opaque.current) {
        // Only once fading starts, and only once: sorting thousands of
        // transparent cubes against each other is not worth the cost while
        // they are still solid.
        material.current.depthWrite = false;
        material.current.needsUpdate = true;
        opaque.current = false;
      }
      material.current.opacity = 1 - (age - FADE_FROM) / (1 - FADE_FROM);
    }

    if (age === 1 && !completed.current) {
      completed.current = true;
      onComplete();
    }
  });

  return (
    <group position={squarePosition(square, 0.02)} rotation={[0, color === 'w' ? 0 : Math.PI, 0]}>
      <instancedMesh ref={mesh} args={[undefined, undefined, debris.count]} castShadow>
        <boxGeometry args={[debris.cell, debris.cell, debris.cell]} />
        {/* No `vertexColors`: a box geometry carries no colour attribute, so
            the per-voxel colour comes from the instance colours set above. */}
        <meshStandardMaterial ref={material} transparent roughness={0.5} metalness={0.08} flatShading />
      </instancedMesh>
    </group>
  );
}
