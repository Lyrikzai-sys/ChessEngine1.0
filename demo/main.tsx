import { createRoot } from 'react-dom/client';

import { ChessGame } from '../src/ui/ChessGame';
import { onSearchTrace } from '../src/engine';

/**
 * When this demo is embedded in a page that wants to show what the engine is
 * doing, forward each completed search to the host.
 *
 * The host cannot read into a cross-origin frame, so without this the board
 * would be a black box: anything outside it claiming to show the engine's
 * work would be reading a different engine, or nothing at all.
 *
 * Only the search trace is ever posted — node counts, cut-offs, elapsed time,
 * candidate moves and their scores. There is no account, no input and nothing
 * private in this application to leak, which is why `'*'` is an acceptable
 * target here: the demo has no way to know which origin embedded it, and the
 * payload is the same information already drawn on its own screen.
 */
if (window.parent !== window) {
  onSearchTrace((trace) => {
    try {
      window.parent.postMessage({ source: 'voxel-chess', type: 'search-trace', trace }, '*');
    } catch {
      // A host that rejects the message is not a reason to break the game.
    }
  });
}

createRoot(document.getElementById('root')!).render(<ChessGame elo={1400} />);
