import {
  findBestMove,
  publishSearchTrace,
  type GameState,
  type Move,
  type SearchTrace,
} from './engine';
import type { SearchRequest, SearchResponse } from './search.worker';

/**
 * Ask for a move without stopping the page to get it.
 *
 * The worker is created once, on the first search, and kept: starting one
 * costs a few milliseconds and the engine is asked for a move every turn.
 *
 * Every path here ends in a move. If the browser has no module workers, if
 * constructing one throws, or if the search fails on the other side, it is
 * run on this thread instead -- a dropped frame is a far better outcome than
 * a board that will not reply. Falling back is sticky: once the worker has
 * failed, later searches stop trying to use it.
 */

type Pending = { resolve: (value: Move | null) => void; state: GameState; elo: number };

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Run it here, and tell the page what happened, exactly as the worker would. */
function searchOnThisThread(state: GameState, elo: number): Move | null {
  return findBestMove(state, elo);
}

function retireWorker() {
  workerUnavailable = true;
  try { worker?.terminate(); } catch { /* already gone */ }
  worker = null;
  // Anything still waiting is answered here rather than left hanging.
  for (const [, job] of pending) job.resolve(searchOnThisThread(job.state, job.elo));
  pending.clear();
}

function ensureWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') { workerUnavailable = true; return null; }

  try {
    worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerUnavailable = true;
    return null;
  }

  worker.addEventListener('message', (event: MessageEvent<SearchResponse>) => {
    const { id, move, trace, error } = event.data;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);

    if (error) { job.resolve(searchOnThisThread(job.state, job.elo)); return; }
    // The search ran elsewhere, so the trace has to be republished here for
    // anything on this thread that is watching.
    if (trace) publishSearchTrace(trace);
    job.resolve(move);
  });

  worker.addEventListener('error', retireWorker);
  return worker;
}

/**
 * The engine's move for this position.
 *
 * Resolves with the same move findBestMove would return; only where the work
 * happens is different.
 */
export function searchBestMove(
  state: GameState & { knownMoves?: string[] },
  elo: number,
): Promise<Move | null> {
  const active = ensureWorker();
  if (!active) return Promise.resolve(searchOnThisThread(state, elo));

  const id = nextId++;
  return new Promise<Move | null>((resolve) => {
    pending.set(id, { resolve, state, elo });
    try {
      active.postMessage({ id, state, elo } satisfies SearchRequest);
    } catch {
      // A state that will not clone is a bug worth surviving, not crashing on.
      pending.delete(id);
      retireWorker();
      resolve(searchOnThisThread(state, elo));
    }
  });
}

/** True once a search has actually come back from the worker. */
export function isSearchThreaded(): boolean {
  return !workerUnavailable && worker !== null;
}

export type { SearchTrace };
