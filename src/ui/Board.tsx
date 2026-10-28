import { MATERIALS, SQUARE_SIZE, BOARD_EDGE } from './materials';

/**
 * The squares and the frame around them.
 *
 * Drawn as geometry rather than loaded as a board model, so the only thing a
 * clone needs in order to render is this repository.
 */

function Square({
  r,
  c,
  isSelected,
  isValid,
  onSelect,
}: {
  r: number;
  c: number;
  isSelected?: boolean;
  isValid?: boolean;
  onSelect: (r: number, c: number) => void;
}) {
  const x = (c - 3.5) * SQUARE_SIZE;
  const z = (r - 3.5) * SQUARE_SIZE;
  const isDark = (r + c) % 2 === 1;

  return (
    <group position={[x, 0, z]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        material={isDark ? MATERIALS.darkSquare : MATERIALS.lightSquare}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(r, c);
        }}
      >
        <planeGeometry args={[SQUARE_SIZE, SQUARE_SIZE]} />
      </mesh>

      {(isSelected || isValid) && (
        // Lifted a hair above the square so it never z-fights with it.
        <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[SQUARE_SIZE * 0.95, SQUARE_SIZE * 0.95]} />
          <meshBasicMaterial
            color={isSelected ? '#fbbf24' : '#34d399'}
            transparent
            opacity={0.45}
          />
        </mesh>
      )}
    </group>
  );
}

export function Board({
  selected,
  validSquares,
  onSelect,
}: {
  selected: [number, number] | null;
  validSquares: [number, number][];
  onSelect: (r: number, c: number) => void;
}) {
  const isValid = (r: number, c: number) =>
    validSquares.some(([vr, vc]) => vr === r && vc === c);

  return (
    <group>
      {/* Top face sits at y = -0.02, clear of the squares at y = 0. Sharing
          that plane makes the depth buffer pick a winner per fragment, which
          reads as horizontal banding across the board. */}
      <mesh position={[0, -0.22, 0]} receiveShadow material={MATERIALS.boardFrame}>
        <boxGeometry args={[BOARD_EDGE + 0.9, 0.4, BOARD_EDGE + 0.9]} />
      </mesh>

      {Array.from({ length: 8 }, (_, r) =>
        Array.from({ length: 8 }, (_, c) => (
          <Square
            key={`${r}-${c}`}
            r={r}
            c={c}
            isSelected={selected?.[0] === r && selected?.[1] === c}
            isValid={isValid(r, c)}
            onSelect={onSelect}
          />
        )),
      )}
    </group>
  );
}
