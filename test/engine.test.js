import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, pieceCells, gravityFrames, firstLevelUpLines, COLS, ROWS } from '../src/engine.js';

const none = { left: false, right: false, down: false, a: false, b: false };
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const run = (g, n, keys = none) => { for (let i = 0; i < n; i++) step(g, keys); };

test('gravity falls one row after the level frame count', () => {
  const g = createGame({ rng: seq(0.5) });
  const y = g.piece.y;
  run(g, gravityFrames(0));
  assert.equal(g.piece.y, y + 1);
});

test('gravity table speeds up and clamps', () => {
  assert.equal(gravityFrames(0), 53);
  assert.ok(gravityFrames(9) < gravityFrames(5));
  assert.equal(gravityFrames(99), gravityFrames(20));
});

test('rotation has no wall kicks: blocked rotation does nothing', () => {
  const g = createGame({ rng: seq(0.0) }); // I piece, horizontal
  g.piece.x = 6; // against the right wall once vertical? vertical needs x+2..; fill below
  g.field[2][8] = 1;
  g.field[1][8] = 1;
  g.field[3][8] = 1;
  const before = g.piece.rot;
  step(g, { ...none, a: true });
  assert.equal(g.piece.rot, before);
});

test('I piece flips between two states; O never changes', () => {
  assert.deepEqual(pieceCells('I', 2), pieceCells('I', 0));
  assert.deepEqual(pieceCells('O', 3), pieceCells('O', 0));
  assert.notDeepEqual(pieceCells('I', 1), pieceCells('I', 0));
});

test('walls stop horizontal movement', () => {
  const g = createGame({ rng: seq(0.5) });
  for (let i = 0; i < 40; i++) { step(g, { ...none, left: i === 0 }); }
  g.piece.x = 0;
  const x = g.piece.x;
  step(g, { ...none, left: true });
  assert.equal(g.piece.x, x);
});

test('soft drop scores one point per row and locks on the floor', () => {
  const g = createGame({ rng: seq(0.2) }); // O piece
  let guard = 0;
  while (g.phase === 'play' && guard++ < 400) step(g, { ...none, down: true });
  assert.ok(g.score > 0);
  assert.notEqual(g.phase, 'play');
});

test('clearing four lines scores 1200 x (level + 1)', () => {
  const g = createGame({ rng: seq(0.0) }); // I piece first
  // Fill rows 14-17 except column 0.
  for (let y = ROWS - 4; y < ROWS; y++) for (let x = 1; x < COLS; x++) g.field[y][x] = 3;
  g.piece = { type: 'I', rot: 1, x: -2, y: 14 }; // vertical I in column 0 (cells at x+2)
  g.score = 0;
  let guard = 0;
  while (g.phase === 'play' && guard++ < 400) step(g, { ...none, down: true });
  assert.equal(g.phase, 'clearing');
  const soft = g.score;
  run(g, 40);
  assert.equal(g.lines, 4);
  assert.equal(g.score - soft, 1200 * 1);
  assert.ok(g.field.every((row) => row.every((c) => c === 0)));
});

test('level goes up every 10 lines', () => {
  assert.equal(firstLevelUpLines(0), 10);
  assert.equal(firstLevelUpLines(9), 100);
});

test('game over when a new piece spawns into the stack', () => {
  const g = createGame({ rng: seq(0.5) });
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) g.field[y][x] = 1;
  g.field[ROWS - 1][0] = 0;
  g.phase = 'entry';
  g.timer = 1;
  g.piece = null;
  run(g, 3);
  assert.equal(g.phase, 'gameover');
});
