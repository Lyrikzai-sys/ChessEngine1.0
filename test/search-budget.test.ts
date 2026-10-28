import { describe, expect, it } from 'vitest';

import {
  type GameState,
  applyMove,
  createInitialState,
  describeStrength,
  findBestMove,
  legalMovesFromSquare,
  onSearchTrace,
} from '../src/engine';

/**
 * Response time is a promise to the player, not a property of the position.
 *
 * The engine used to search one fixed depth, so how long it thought depended
 * on how busy the board was. At the top rating that was about seven seconds on
 * an ordinary middlegame position — long enough that the game looks broken and
 * the player clicks again.
 *
 * It now deepens iteratively against a budget and answers from the last pass
 * that finished. These tests exist because that is a claim about latency, and
 * a latency claim nobody measures goes stale the first time someone adds a
 * term to the evaluator.
 */

/** A middlegame-ish position; the opening is too quiet to be a fair test. */
function busyPosition(): GameState {
  let s = createInitialState('standard');
  s = applyMove(s, legalMovesFromSquare(s, [6, 4]).find((m) => m.to?.[0] === 4 && m.to?.[1] === 4)!);
  s = applyMove(s, legalMovesFromSquare(s, [1, 4]).find((m) => m.to?.[0] === 3 && m.to?.[1] === 4)!);
  return s;
}

/**
 * Generous. A tight bound here would fail on a loaded CI runner and teach
 * everyone to ignore the suite; this still catches the regression that
 * matters, which is a search going seconds over budget.
 */
const SLACK_MS = 400;

describe('search budget', () => {
  const position = busyPosition();

  // Warm the JIT. The first call through a cold path is not representative
  // and would make this test about V8 rather than about the engine.
  for (let i = 0; i < 3; i++) findBestMove(position, 2200);

  for (const elo of [600, 1200, 1600, 2200]) {
    it(`answers within its budget at ${elo}`, () => {
      const { budgetMs } = describeStrength(elo);

      let worst = 0;
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        const move = findBestMove(position, elo);
        worst = Math.max(worst, performance.now() - started);
        expect(move, 'a legal position must always yield a move').not.toBeNull();
      }

      expect(
        worst,
        `${elo} took ${worst.toFixed(0)}ms against a ${budgetMs}ms budget`,
      ).toBeLessThan(budgetMs + SLACK_MS);
    });
  }

  it('spends its budget rather than returning early', () => {
    // The mirror of the test above. A search that aborted instantly would pass
    // every deadline check while playing like it never thought at all, so this
    // pins the other side: the strongest setting must do real work.
    const traces: { depth: number; nodes: number; blundered: boolean }[] = [];
    const off = onSearchTrace((t) => traces.push(t));

    try {
      for (let i = 0; i < 5; i++) findBestMove(position, 2200);
    } finally {
      off();
    }

    const real = traces.filter((t) => !t.blundered);
    expect(real.length).toBeGreaterThan(0);
    expect(Math.max(...real.map((t) => t.depth)), 'never searched past one ply').toBeGreaterThanOrEqual(2);
    expect(Math.max(...real.map((t) => t.nodes)), 'barely visited any nodes').toBeGreaterThan(200);
  });

  it('gives a bigger budget and a deeper ceiling to a higher rating', () => {
    let lastBudget = 0;
    let lastDepth = 0;

    for (const elo of [600, 1000, 1400, 1800, 2200]) {
      const { budgetMs, depth } = describeStrength(elo);
      expect(budgetMs).toBeGreaterThanOrEqual(lastBudget);
      expect(depth).toBeGreaterThanOrEqual(lastDepth);
      lastBudget = budgetMs;
      lastDepth = depth;
    }
  });
});
