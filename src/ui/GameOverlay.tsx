import { type GameState, describeStrength } from '../engine';

/**
 * The flat HTML laid over the canvas: whose move it is, whether a king is in
 * check, how the game ended, and how strong the engine should be.
 *
 * None of this is drawn in WebGL on purpose. Text in a 3D scene costs a font
 * atlas and still reads worse at small sizes, and a result banner has to stay
 * legible on a phone, where the board itself is only a few hundred pixels.
 */

const FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';

const PANEL: React.CSSProperties = {
  background: 'rgba(8, 11, 18, 0.82)',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 10,
  backdropFilter: 'blur(6px)',
};

export type Outcome = 'checkmate' | 'stalemate' | 'draw';

/** The terminal states, and who they belong to. */
export function isOver(status: GameState['status']): status is Outcome {
  return status === 'checkmate' || status === 'stalemate' || status === 'draw';
}

/* ------------------------------------------------------------------ status */

export function StatusBar({
  state,
  thinking,
  resolving,
}: {
  state: GameState;
  thinking: boolean;
  resolving: boolean;
}) {
  // The result gets its own banner, so this line stays out of its way.
  const text = isOver(state.status)
    ? ''
    : resolving
      ? 'Resolving capture…'
      : thinking
        ? 'Engine is thinking…'
        : state.turn === 'w'
          ? 'Your move. Click a piece, then a highlighted square.'
          : 'Engine to move.';

  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '12px 16px',
        font: `13px/1.5 ${FONT}`,
        color: '#cbd5e1',
        background: 'linear-gradient(transparent, rgba(0,0,0,.65))',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------- check */

/**
 * Check is the one state a player must not miss, and it is also the one the
 * board itself does not show — a king in check looks exactly like a king.
 */
export function CheckBadge({ state, hidden }: { state: GameState; hidden: boolean }) {
  if (hidden || state.status !== 'check') return null;

  const yours = state.turn === 'w';

  return (
    <div
      style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
        padding: '7px 16px', borderRadius: 999,
        font: `600 13px ${FONT}`, letterSpacing: 0.3, whiteSpace: 'nowrap',
        color: yours ? '#fecaca' : '#bbf7d0',
        background: yours ? 'rgba(127, 29, 29, 0.85)' : 'rgba(6, 78, 59, 0.85)',
        border: `1px solid ${yours ? 'rgba(248,113,113,.55)' : 'rgba(52,211,153,.5)'}`,
        boxShadow: '0 6px 20px rgba(0,0,0,.45)',
        pointerEvents: 'none',
      }}
    >
      {yours ? 'Check — your king is attacked' : 'Check — the engine is in check'}
    </div>
  );
}

/* ------------------------------------------------------------------ result */

export function ResultBanner({ state, onNewGame }: { state: GameState; onNewGame: () => void }) {
  if (!isOver(state.status)) return null;

  const { heading, detail, accent } = (() => {
    if (state.status === 'checkmate') {
      return state.winner === 'w'
        ? { heading: 'Checkmate', detail: 'You win.', accent: '#4ade80' }
        : { heading: 'Checkmate', detail: 'The engine wins.', accent: '#f87171' };
    }
    if (state.status === 'stalemate') {
      return {
        heading: 'Stalemate',
        detail: 'No legal move, and no king in check. The game is drawn.',
        accent: '#fbbf24',
      };
    }
    return { heading: 'Draw', detail: 'Neither side can force a win.', accent: '#fbbf24' };
  })();

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(2, 4, 8, 0.55)',
      }}
    >
      <div style={{ ...PANEL, padding: '22px 26px', textAlign: 'center', maxWidth: 320 }}>
        <div style={{ font: `700 24px ${FONT}`, color: accent, letterSpacing: 0.4 }}>{heading}</div>
        <div style={{ font: `14px/1.5 ${FONT}`, color: '#cbd5e1', margin: '8px 0 18px' }}>{detail}</div>
        <button
          type="button"
          onClick={onNewGame}
          style={{
            padding: '9px 20px', borderRadius: 7, cursor: 'pointer',
            border: '1px solid #d4af37', background: '#171108', color: '#fde68a',
            font: `600 13px ${FONT}`,
          }}
        >
          New game
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- difficulty */

export const ELO_MIN = 600;
export const ELO_MAX = 2200;

/**
 * The slider reports what the rating actually changes, taken from the engine's
 * own `describeStrength`. A difficulty control that only shows a number asks
 * the player to guess what it does.
 */
export function DifficultyPanel({
  elo,
  onChange,
  disabled,
}: {
  elo: number;
  onChange: (elo: number) => void;
  disabled: boolean;
}) {
  const { depth, budgetMs, blunderChance, knowsFullRules } = describeStrength(elo);

  // The full description is what the rating actually buys, but it is three
  // lines of prose and the board needs the width more than the reader does.
  // It moves into the tooltip; the strip keeps only what changes at a glance.
  const summary = [
    `Engine strength ${elo}`,
    `Thinks for up to ${budgetMs}ms`,
    `Searches up to ${depth} ${depth === 1 ? 'ply' : 'plies'} ahead`,
    blunderChance > 0
      ? `Plays a weaker move ${Math.round(blunderChance * 100)}% of the time`
      : 'Always plays the best move it finds',
    knowsFullRules ? 'Knows castling and en passant' : 'Rarely finds castling or en passant',
  ].join('\n');

  return (
    <div
      title={summary}
      style={{
        ...PANEL,
        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
        padding: '10px 6px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}
    >
      <label
        htmlFor="engine-elo"
        style={{
          font: `600 10px ${FONT}`, color: '#94a3b8',
          letterSpacing: 0.6, textTransform: 'uppercase',
        }}
      >
        Elo
      </label>

      <span style={{ font: `600 12px ${FONT}`, color: '#fde68a', fontVariantNumeric: 'tabular-nums' }}>
        {elo}
      </span>

      <input
        id="engine-elo"
        type="range"
        min={ELO_MIN}
        max={ELO_MAX}
        step={50}
        value={elo}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          // `writing-mode: vertical-*` is the standard way to stand a range
          // control up; `appearance: slider-vertical` was removed in Chrome
          // 121. `direction: rtl` puts the strongest setting at the top,
          // which is the only way round that reads as "more".
          writingMode: 'vertical-lr',
          direction: 'rtl',
          height: 140,
          width: 20,
          accentColor: '#d4af37',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />

      <span
        style={{ font: `10px ${FONT}`, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}
      >
        {budgetMs}ms
      </span>
      {!knowsFullRules && <span style={{ font: `10px ${FONT}`, color: '#fbbf24' }}>basic</span>}
    </div>
  );
}
