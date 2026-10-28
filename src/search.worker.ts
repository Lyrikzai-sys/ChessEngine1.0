/// <reference lib="webworker" />
import { findBestMove, onSearchTrace, type GameState, type Move, type SearchTrace } from './engine';

/**
 * The chess search, off the main thread.
 *
 * At depth 4 the search visits tens of thousands of positions, and every one
 * of them is JavaScript running where the renderer wants to be. On the main
 * thread that is a frame budget blown: the board stops turning, the hover
 * states stick, and the page feels like it has hung at exactly the moment
 * the engine is doing the thing worth watching.
 *
 * Nothing about the search changed to get here. GameState is plain arrays and
 * objects, so it survives being structured-cloned without a custom
 * serialiser, and the same findBestMove runs on the other side of the
 * message. The trace it emits is collected here and sent back with the move,
 * so the page can still show what the search did.
 */

export interface SearchRequest {
  id: number;
  state: GameState & { knownMoves?: string[] };
  elo: number;
}

export interface SearchResponse {
  id: number;
  move: Move | null;
  trace: SearchTrace | null;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  const { id, state, elo } = event.data;

  let captured: SearchTrace | null = null;
  const stop = onSearchTrace((t: SearchTrace) => { captured = t; });

  try {
    const move = findBestMove(state, elo);
    ctx.postMessage({ id, move, trace: captured } satisfies SearchResponse);
  } catch (err) {
    // A search that throws must not leave the caller waiting forever; it
    // falls back to searching on the main thread instead.
    ctx.postMessage({
      id,
      move: null,
      trace: null,
      error: err instanceof Error ? err.message : String(err),
    } satisfies SearchResponse);
  } finally {
    stop();
  }
});
