import * as THREE from 'three';

import type { Color } from '../engine';

/**
 * Piece and board materials.
 *
 * Fully metallic with a clearcoat on top: the pieces read as polished metal
 * rather than plastic, which is what makes a procedurally generated shape look
 * deliberate instead of cheap. The squares are the opposite, fully rough and
 * non-reflective, so they never compete with the pieces for the eye.
 */
export const MATERIALS = {
  white: new THREE.MeshPhysicalMaterial({
    color: '#e2e8f0',
    metalness: 1.0,
    roughness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    reflectivity: 1.0,
  }),
  black: new THREE.MeshPhysicalMaterial({
    color: '#d4af37',
    metalness: 1.0,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    reflectivity: 1.0,
  }),

  highlight: new THREE.MeshPhysicalMaterial({
    color: '#34d399',
    transparent: true,
    opacity: 0.65,
    emissive: '#10b981',
    emissiveIntensity: 0.7,
    roughness: 0.1,
  }),
  selected: new THREE.MeshPhysicalMaterial({
    color: '#fbbf24',
    transparent: true,
    opacity: 0.75,
    emissive: '#fbbf24',
    emissiveIntensity: 1.0,
    roughness: 0.1,
  }),

  lightSquare: new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 1.0,
    metalness: 0.0,
    reflectivity: 0.0,
  }),
  darkSquare: new THREE.MeshPhysicalMaterial({
    color: '#08040d',
    roughness: 1.0,
    metalness: 0.0,
    reflectivity: 0.0,
  }),
  boardFrame: new THREE.MeshPhysicalMaterial({
    color: '#1a0d06',
    roughness: 0.9,
    metalness: 0.0,
    clearcoat: 0.2,
  }),
};

export function pickMaterial(
  color: Color,
  isSelected?: boolean,
  isValid?: boolean,
): THREE.MeshPhysicalMaterial {
  if (isSelected) return MATERIALS.selected;
  if (isValid) return MATERIALS.highlight;
  return color === 'w' ? MATERIALS.white : MATERIALS.black;
}

export const SQUARE_SIZE = 1.5;
export const BOARD_EDGE = SQUARE_SIZE * 8;
