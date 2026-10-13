// Pure game logic. Runs at a fixed 60 steps per second, like the handheld.
// No DOM, no audio: step() returns events that the shell turns into sound.

export const COLS = 10;
export const ROWS = 18;

export const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Spawn shapes as [x, y] cells inside a box of the given size.
const SHAPES = {
  I: { box: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], states: 2 },
  O: { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], states: 1 },
  T: { box: 3, cells: [[0, 0], [1, 0], [2, 0], [1, 1]], states: 4 },
  S: { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], states: 2 },
  Z: { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], states: 2 },
  J: { box: 3, cells: [[0, 0], [1, 0], [2, 0], [2, 1]], states: 4 },
  L: { box: 3, cells: [[0, 0], [1, 0], [2, 0], [0, 1]], states: 4 }
};

// Pieces that only flip between two orientations, as on the handheld.
const rotateCells = (cells, box) => cells.map(([x, y]) => [box - 1 - y, x]);

const ORIENTATIONS = {};
for (const p of PIECES) {
  const { box, cells, states } = SHAPES[p];
  const list = [cells];
  for (let i = 1; i < states; i++) list.push(rotateCells(list[i - 1], box));
  ORIENTATIONS[p] = list;
}

export function pieceCells(type, rot) {
  const list = ORIENTATIONS[type];
  return list[((rot % list.length) + list.length) % list.length];
}

// Frames per row of gravity, by level (handheld table).
const GRAVITY = [53, 49, 45, 41, 37, 33, 28, 22, 17, 11, 10, 9, 8, 7, 6, 6, 5, 5, 4, 4, 3];
export const gravityFrames = (level) => GRAVITY[Math.min(level, GRAVITY.length - 1)];

const LINE_SCORE = [0, 40, 100, 300, 1200];
const DAS_DELAY = 16; // frames before auto-repeat starts
const DAS_REPEAT = 6; // frames between repeats
const SOFT_DROP_FRAMES = 3; // down held: one row per 3 frames
const ENTRY_DELAY = 10; // frames between a lock and the next piece
const CLEAR_FRAMES = 24; // line-clear flash

// First level-up threshold: depends on the starting level, like the handheld.
export const firstLevelUpLines = (startLevel) =>
  Math.min(startLevel * 10 + 10, Math.max(100, startLevel * 10 - 50));

export function createGame({ startLevel = 0, rng = Math.random } = {}) {
  const g = {
    rng,
    field: Array.from({ length: ROWS }, () => new Array(COLS).fill(0)),
    phase: 'play', // play | entry | clearing | gameover
    timer: 0,
    score: 0,
    lines: 0,
    startLevel,
    level: startLevel,
    nextLevelAt: firstLevelUpLines(startLevel),
    piece: null,
    next: null,
    lastType: null,
    gravityCount: 0,
    softCount: 0,
    softRows: 0,
    das: { dir: 0, count: 0 },
    clearRows: [],
    events: []
  };
  g.next = draw(g);
  spawn(g);
  return g;
}

// The handheld re-rolls once if the same piece comes up twice in a row.
function draw(g) {
  let t = PIECES[Math.floor(g.rng() * PIECES.length)];
  if (t === g.lastType) t = PIECES[Math.floor(g.rng() * PIECES.length)];
  g.lastType = t;
  return t;
}

function collides(g, type, rot, x, y) {
  for (const [cx, cy] of pieceCells(type, rot)) {
    const fx = x + cx;
    const fy = y + cy;
    if (fx < 0 || fx >= COLS || fy >= ROWS) return true;
    if (fy >= 0 && g.field[fy][fx]) return true;
  }
  return false;
}

function spawn(g) {
  const type = g.next;
  g.next = draw(g);
  const x = type === 'O' ? 4 : 3;
  const y = type === 'I' ? -1 : 0;
  g.piece = { type, rot: 0, x, y };
  g.gravityCount = 0;
  g.softCount = 0;
  g.softRows = 0;
  if (collides(g, type, 0, x, y)) {
    g.phase = 'gameover';
    g.events.push({ type: 'gameover' });
  } else {
    g.phase = 'play';
  }
}

function tryMove(g, dx) {
  const p = g.piece;
  if (collides(g, p.type, p.rot, p.x + dx, p.y)) return false;
  p.x += dx;
  g.events.push({ type: 'move' });
  return true;
}

function tryRotate(g, dir) {
  const p = g.piece;
  const rot = p.rot + dir;
  // No wall kicks: a blocked rotation simply does nothing.
  if (collides(g, p.type, rot, p.x, p.y)) return false;
  p.rot = ((rot % 4) + 4) % 4;
  g.events.push({ type: 'rotate' });
  return true;
}

function lock(g) {
  const p = g.piece;
  const id = PIECES.indexOf(p.type) + 1;
  for (const [cx, cy] of pieceCells(p.type, p.rot)) {
    const fy = p.y + cy;
    if (fy >= 0) g.field[fy][p.x + cx] = id;
  }
  g.score += g.softRows;
  g.piece = null;
  const full = [];
  for (let y = 0; y < ROWS; y++) if (g.field[y].every(Boolean)) full.push(y);
  if (full.length) {
    g.clearRows = full;
    g.phase = 'clearing';
    g.timer = CLEAR_FRAMES;
    g.events.push({ type: 'clear', count: full.length });
  } else {
    g.phase = 'entry';
    g.timer = ENTRY_DELAY;
    g.events.push({ type: 'lock' });
  }
}

function finishClear(g) {
  const n = g.clearRows.length;
  g.field = g.field.filter((_, y) => !g.clearRows.includes(y));
  while (g.field.length < ROWS) g.field.unshift(new Array(COLS).fill(0));
  g.clearRows = [];
  g.score += LINE_SCORE[n] * (g.level + 1);
  g.lines += n;
  while (g.lines >= g.nextLevelAt) {
    g.level += 1;
    g.nextLevelAt += 10;
    g.events.push({ type: 'levelup', level: g.level });
  }
  g.phase = 'entry';
  g.timer = ENTRY_DELAY;
}

// keys: { left, right, down } held this frame; { a, b } pressed this frame.
export function step(g, keys) {
  g.events = [];
  if (g.phase === 'gameover') return g.events;

  if (g.phase === 'clearing') {
    if (--g.timer <= 0) finishClear(g);
    return g.events;
  }
  if (g.phase === 'entry') {
    if (--g.timer <= 0) spawn(g);
    return g.events;
  }

  const p = g.piece;

  // Horizontal movement with auto-repeat.
  const dir = keys.left && !keys.right ? -1 : keys.right && !keys.left ? 1 : 0;
  if (dir === 0) {
    g.das.dir = 0;
    g.das.count = 0;
  } else if (dir !== g.das.dir) {
    g.das.dir = dir;
    g.das.count = 0;
    tryMove(g, dir);
  } else if (++g.das.count >= DAS_DELAY) {
    if ((g.das.count - DAS_DELAY) % DAS_REPEAT === 0) tryMove(g, dir);
  }

  if (keys.a) tryRotate(g, 1);
  else if (keys.b) tryRotate(g, -1);

  // Gravity. Holding down is a steady soft drop that scores a point per row.
  let fall = false;
  if (keys.down) {
    if (++g.softCount >= SOFT_DROP_FRAMES) {
      g.softCount = 0;
      fall = true;
      g.gravityCount = 0;
    }
  } else {
    g.softCount = 0;
    g.softRows = 0;
    if (++g.gravityCount >= gravityFrames(g.level)) {
      g.gravityCount = 0;
      fall = true;
    }
  }
  if (fall) {
    if (collides(g, p.type, p.rot, p.x, p.y + 1)) lock(g);
    else {
      p.y += 1;
      if (keys.down) g.softRows += 1;
    }
  }
  return g.events;
}
