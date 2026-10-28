import { createRoot } from 'react-dom/client';

import { ChessGame } from '../src/ui/ChessGame';

createRoot(document.getElementById('root')!).render(<ChessGame elo={1400} />);
