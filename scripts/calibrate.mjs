#!/usr/bin/env node
/**
 * Headless UCI calibration for Voxel Chess.
 *
 * Plays the project engine against Stockfish without opening the 3D app. The
 * result is an estimate against the exact Stockfish UCI_Elo setting used here,
 * not a certified human rating. Use paired colours for a less biased sample.
 *
 * Example:
 *   node scripts/calibrate.mjs --stockfish .calibration/stockfish/stockfish.exe \
 *     --games 20 --concurrency 4 --our-elo 2000 --probe-elo 1320 --colors both
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const files = 'abcdefgh';
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));

const numberArg = (name, fallback, minimum = 0) => {
  const value = Number(args[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`--${name} must be a number >= ${minimum}`);
  return value;
};

const config = {
  stockfish: args.stockfish,
  games: numberArg('games', 20, 1),
  // Raising this to 20 is supported, but a small default avoids starving the
  // machine and turning a timing calibration into a CPU-contention test.
  concurrency: numberArg('concurrency', 4, 1),
  ourElo: numberArg('our-elo', 2000, 400),
  probeElo: numberArg('probe-elo', 1320, 100),
  probeMoveMs: numberArg('probe-movetime', 30, 1),
  maxPlies: numberArg('max-plies', 240, 2),
  colors: args.colors ?? 'white',
};

if (!config.stockfish) throw new Error('Pass --stockfish path/to/stockfish.exe');
if (!['white', 'black', 'both'].includes(config.colors)) throw new Error('--colors must be white, black, or both');

function square([row, column]) {
  return `${files[column]}${8 - row}`;
}

function moveToUci(move) {
  if (!move.from || !move.to) throw new Error('Cannot send a non-board move to UCI');
  return `${square(move.from)}${square(move.to)}${move.promoteTo?.toLowerCase() ?? ''}`;
}

function legalMoveFromUci(engine, state, uci) {
  const match = /^([a-h])([1-8])([a-h])([1-8])([qrbn])?$/.exec(uci);
  if (!match) throw new Error(`Probe returned an invalid UCI move: ${uci}`);
  const from = [8 - Number(match[2]), files.indexOf(match[1])];
  const to = [8 - Number(match[4]), files.indexOf(match[3])];
  const promoteTo = match[5]?.toUpperCase();
  const move = engine.generateLegalMoves(state).find((candidate) =>
    candidate.from?.[0] === from[0]
    && candidate.from?.[1] === from[1]
    && candidate.to?.[0] === to[0]
    && candidate.to?.[1] === to[1]
    && (!promoteTo || candidate.promoteTo === promoteTo),
  );
  if (!move) throw new Error(`Probe played ${uci}, which is not legal in the project engine`);
  return move;
}

class UciProbe {
  constructor(binary) {
    this.process = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = [];
    this.waiters = [];
    this.stdoutBuffer = '';
    this.stderr = '';
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => this.receive(chunk));
    this.process.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.process.on('error', (error) => this.rejectAll(error));
    this.process.on('exit', (code) => {
      if (code && this.waiters.length) this.rejectAll(new Error(`Stockfish exited with code ${code}: ${this.stderr.trim()}`));
    });
  }

  receive(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const waiter = this.waiters.find((candidate) => candidate.match(line));
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(line);
      } else {
        this.lines.push(line);
      }
    }
  }

  rejectAll(error) {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  send(command) {
    this.process.stdin.write(`${command}\n`);
  }

  waitFor(match, timeoutMs = 15_000) {
    const queued = this.lines.findIndex(match);
    if (queued >= 0) return Promise.resolve(this.lines.splice(queued, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for Stockfish (${this.stderr.trim()})`));
      }, timeoutMs);
      const waiter = {
        match,
        resolve: (line) => { clearTimeout(timer); resolve(line); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      this.waiters.push(waiter);
    });
  }

  async initialise() {
    this.send('uci');
    await this.waitFor((line) => line === 'uciok');
    this.send('setoption name Threads value 1');
    this.send('setoption name UCI_LimitStrength value true');
    this.send(`setoption name UCI_Elo value ${config.probeElo}`);
    this.send('isready');
    await this.waitFor((line) => line === 'readyok');
  }

  async bestMove(moves) {
    this.send(`position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
    this.send(`go movetime ${config.probeMoveMs}`);
    const line = await this.waitFor((candidate) => candidate.startsWith('bestmove '), Math.max(15_000, config.probeMoveMs * 40));
    return line.split(/\s+/)[1];
  }

  close() {
    this.send('quit');
    this.process.kill();
  }
}

async function play(engine, ourColor) {
  const probe = new UciProbe(config.stockfish);
  await probe.initialise();
  let state = engine.createInitialState('standard');
  const moves = [];
  let plies = 0;

  try {
    while (!['checkmate', 'stalemate', 'draw'].includes(state.status) && plies < config.maxPlies) {
      let move;
      if (state.turn === ourColor) {
        move = engine.findBestMove(state, config.ourElo);
        if (!move) break;
      } else {
        const uci = await probe.bestMove(moves);
        if (uci === '(none)') break;
        move = legalMoveFromUci(engine, state, uci);
      }
      moves.push(moveToUci(move));
      state = engine.applyMove(state, move);
      plies++;
    }
  } finally {
    probe.close();
  }

  if (state.status === 'checkmate') return { result: state.winner === ourColor ? 'win' : 'loss', plies, terminal: state.status };
  if (state.status === 'stalemate' || state.status === 'draw') return { result: 'draw', plies, terminal: state.status };
  return { result: 'unfinished', plies, terminal: 'max-plies' };
}

function eloDelta(score) {
  return 400 * Math.log10(score / (1 - score));
}

function report(results) {
  const counts = Object.fromEntries(['win', 'draw', 'loss', 'unfinished'].map((key) => [key, 0]));
  for (const result of results) counts[result.result]++;
  const completed = counts.win + counts.draw + counts.loss;
  const score = completed ? (counts.win + counts.draw * 0.5) / completed : 0;
  console.log(JSON.stringify({
    probe: { engine: 'Stockfish UCI', configuredElo: config.probeElo, moveTimeMs: config.probeMoveMs },
    ours: { configuredDifficulty: config.ourElo, colorMode: config.colors },
    games: { requested: config.games, completed, ...counts },
    score: Number(score.toFixed(3)),
    estimate: completed && score > 0 && score < 1
      ? { elo: Math.round(config.probeElo + eloDelta(score)), note: 'Approximate engine-relative estimate; expand the match set and balance colours before publishing.' }
      : { note: 'No finite Elo estimate: all completed games had the same result. Try another probe setting or more games.' },
    averagePlies: Math.round(results.reduce((sum, game) => sum + game.plies, 0) / results.length),
  }, null, 2));
}

async function main() {
  // Bundle the TypeScript engine once for Node rather than starting Vite's
  // development server. Calibration should run beside `npm run dev`, not
  // compete for its HMR WebSocket port.
  const calibrationDir = resolve('.calibration');
  const bundledEngine = resolve(calibrationDir, 'engine-for-calibration.mjs');
  await mkdir(calibrationDir, { recursive: true });
  await build({
    entryPoints: [resolve('src/engine.ts')],
    outfile: bundledEngine,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
  });
  const engine = await import(`${pathToFileURL(bundledEngine).href}?run=${Date.now()}`);
  const colors = config.colors === 'both' ? ['w', 'b'] : [config.colors === 'white' ? 'w' : 'b'];
  const jobs = Array.from({ length: config.games }, (_, index) => colors[index % colors.length]);
  const results = [];
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      const index = next++;
      const game = await play(engine, jobs[index]);
      results[index] = game;
      console.log(`game ${index + 1}/${jobs.length}: ${game.result} in ${game.plies} plies (${game.terminal})`);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(config.concurrency, jobs.length) }, worker));
    report(results);
  } finally { /* probe processes close after each match */ }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
