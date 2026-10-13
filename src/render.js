import { COLS, ROWS, PIECES, pieceCells } from './engine.js';

export const CELL = 22;
const SCALE = 4; // backing-store pixels per CSS pixel, for crisp scaling

// Level themes cycle every level: sunset, midday, neon dusk, redwood fog.
export const THEMES = [
  { a: '#FFB36B', b: '#E5566D', c: '#3A2350' },
  { a: '#3FB8AF', b: '#FF6F61', c: '#1F3B5C' },
  { a: '#FF9A3C', b: '#C2185B', c: '#2A0F3D' },
  { a: '#E0A458', b: '#C0603E', c: '#243B2F' }
];

// Which shade each piece wears, indexed by PIECES order (I O T S Z J L).
const SHADE_OF = ['a', 'b', 'c', 'a', 'b', 'c', 'a'];

function mix(hex, to, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * amt));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function drawBlock(ctx, x, y, size, color) {
  const s = size * SCALE;
  const px = x * SCALE;
  const py = y * SCALE;
  const bevel = 3 * SCALE;
  ctx.fillStyle = color;
  ctx.fillRect(px, py, s, s);
  ctx.fillStyle = mix(color, 255, 0.45);
  ctx.fillRect(px, py, s, bevel);
  ctx.fillRect(px, py, bevel, s);
  ctx.fillStyle = mix(color, 0, 0.4);
  ctx.fillRect(px, py + s - bevel, s, bevel);
  ctx.fillRect(px + s - bevel, py, bevel, s);
}

export function createRenderer(fieldCanvas, nextCanvas) {
  const fctx = fieldCanvas.getContext('2d');
  const nctx = nextCanvas.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  nctx.imageSmoothingEnabled = false;

  const colorOf = (id, theme) => THEMES[theme][SHADE_OF[id - 1]];

  function drawField(g, frame) {
    const theme = g.level % THEMES.length;
    fctx.clearRect(0, 0, fieldCanvas.width, fieldCanvas.height);
    // Faint grid so the well reads as a Game Boy-style LCD.
    fctx.fillStyle = 'rgba(42,26,51,0.07)';
    for (let x = 1; x < COLS; x++) fctx.fillRect(x * CELL * SCALE, 0, SCALE, ROWS * CELL * SCALE);
    for (let y = 1; y < ROWS; y++) fctx.fillRect(0, y * CELL * SCALE, COLS * CELL * SCALE, SCALE);

    const flash = g.phase === 'clearing' && Math.floor(frame / 4) % 2 === 0;
    for (let y = 0; y < ROWS; y++) {
      const clearing = g.phase === 'clearing' && g.clearRows.includes(y);
      for (let x = 0; x < COLS; x++) {
        const id = g.field[y][x];
        if (!id) continue;
        drawBlock(fctx, x * CELL, y * CELL, CELL, clearing && flash ? '#FFF1D6' : colorOf(id, theme));
      }
    }
    if (g.piece) {
      const id = PIECES.indexOf(g.piece.type) + 1;
      for (const [cx, cy] of pieceCells(g.piece.type, g.piece.rot)) {
        const y = g.piece.y + cy;
        if (y < 0) continue;
        drawBlock(fctx, (g.piece.x + cx) * CELL, y * CELL, CELL, colorOf(id, theme));
      }
    }
  }

  function drawNext(g) {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!g.next) return;
    const size = 20;
    const cells = pieceCells(g.next, 0);
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    const ox = (4 - w) / 2 - Math.min(...xs);
    const oy = (2 - h) / 2 - Math.min(...ys);
    const id = PIECES.indexOf(g.next) + 1;
    for (const [cx, cy] of cells) drawBlock(nctx, (cx + ox) * size, (cy + oy) * size, size, colorOf(id, g.level % THEMES.length));
  }

  return { draw(g, frame) { drawField(g, frame); drawNext(g); } };
}
