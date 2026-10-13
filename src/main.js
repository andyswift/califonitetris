import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-700.css';
import './styles.css';
import { createGame, step } from './engine.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const audio = createAudio();
const renderer = createRenderer($('field'), $('next'));

const STEP_MS = 1000 / 60;
const keys = { left: false, right: false, down: false };
const pressed = { a: false, b: false };

let screen = 'title'; // title | playing | paused | over
let game = null;
let startLevel = 0;
let best = 0;
try { best = Number(localStorage.getItem('cali-best')) || 0; } catch { /* storage unavailable */ }
let frame = 0;
let acc = 0;
let last = performance.now();

const pad = (n, w) => String(n).padStart(w, '0');

// ---------- layout: scale the fixed stage to the window ----------
function fit() {
  const portrait = window.innerHeight > window.innerWidth * 1.1;
  stage.classList.toggle('portrait', portrait);
  const w = portrait ? 480 : 960;
  const h = portrait ? 940 : 720;
  stage.style.transform = `translate(-50%, -50%) scale(${Math.min(window.innerWidth / w, window.innerHeight / h)})`;
}
window.addEventListener('resize', fit);
fit();

// ---------- screens ----------
function setScreen(s) {
  screen = s;
  stage.dataset.screen = s === 'playing' ? 'play' : s;
}

function setTheme(level) {
  stage.dataset.theme = String(level % 4);
}

function renderLevelPicker() {
  const el = $('levels');
  el.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const b = document.createElement('button');
    b.textContent = i;
    b.className = i === startLevel ? 'sel' : '';
    b.addEventListener('click', () => { startLevel = i; renderLevelPicker(); audio.resume(); audio.sfx('move'); });
    el.appendChild(b);
  }
}
renderLevelPicker();

function startGame() {
  audio.resume();
  audio.unpause();
  game = createGame({ startLevel });
  keys.left = keys.right = keys.down = false;
  pressed.a = pressed.b = false;
  setTheme(game.level);
  audio.setLevel(game.level);
  audio.stopMusic();
  audio.startMusic();
  audio.sfx('start');
  setScreen('playing');
  hud(true);
}

function gameOver() {
  audio.stopMusic();
  audio.sfx('gameover');
  if (game.score > best) {
    best = game.score;
    try { localStorage.setItem('cali-best', String(best)); } catch { /* storage unavailable */ }
  }
  $('o-score').textContent = pad(game.score, 6);
  $('o-best').textContent = pad(best, 6);
  $('o-level').textContent = pad(game.level, 2);
  $('o-lines').textContent = pad(game.lines, 3);
  setScreen('over');
}

function togglePause() {
  if (screen === 'playing') {
    setScreen('paused');
    audio.pause();
  } else if (screen === 'paused') {
    setScreen('playing');
    audio.unpause();
    last = performance.now();
  }
}

// ---------- HUD ----------
const hudCache = {};
function hud(force) {
  const vals = { score: pad(game.score, 6), level: pad(game.level, 2), lines: pad(game.lines, 3) };
  for (const k in vals) {
    if (force || hudCache[k] !== vals[k]) {
      $(k).textContent = vals[k];
      hudCache[k] = vals[k];
    }
  }
}

// ---------- input ----------
const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down'
};

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const code = e.code;
  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(code)) e.preventDefault();

  if (code === 'KeyM') { audio.resume(); audio.toggleMute(); return; }

  if (screen === 'title') {
    if (code === 'Enter' || code === 'Space') startGame();
    else if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
      const d = code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : code === 'ArrowUp' ? -5 : 5;
      startLevel = Math.max(0, Math.min(9, startLevel + d));
      renderLevelPicker();
      audio.resume();
      audio.sfx('move');
    }
    return;
  }
  if (screen === 'over') {
    if (code === 'Enter' || code === 'Space') startGame();
    return;
  }
  if (code === 'KeyP' || code === 'Escape' || code === 'Enter') { togglePause(); return; }
  if (screen !== 'playing') return;

  if (MAP[code]) keys[MAP[code]] = true;
  else if (!e.repeat) {
    if (code === 'KeyX' || code === 'ArrowUp' || code === 'KeyW' || code === 'Space') pressed.a = true;
    else if (code === 'KeyZ' || code === 'KeyQ') pressed.b = true;
  }
});

window.addEventListener('keyup', (e) => {
  if (MAP[e.code]) keys[MAP[e.code]] = false;
});

window.addEventListener('blur', () => {
  keys.left = keys.right = keys.down = false;
  if (screen === 'playing') togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'playing') togglePause();
});

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('pause').addEventListener('click', togglePause);

// touch buttons: hold for left/right/down, tap for rotate and meta
for (const btn of document.querySelectorAll('.touch button')) {
  const k = btn.dataset.k;
  const down = (e) => {
    e.preventDefault();
    audio.resume();
    btn.classList.add('on');
    if (k === 'pause') togglePause();
    else if (k === 'mute') audio.toggleMute();
    else if (k === 'a' || k === 'b') pressed[k] = true;
    else keys[k] = true;
  };
  const up = () => { btn.classList.remove('on'); if (k in keys) keys[k] = false; };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
}

// ---------- main loop: fixed 60 Hz logic, render every animation frame ----------
function tick(now) {
  requestAnimationFrame(tick);
  acc += Math.min(now - last, 100);
  last = now;

  if (screen === 'playing') {
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      frame++;
      const events = step(game, { ...keys, a: pressed.a, b: pressed.b });
      pressed.a = pressed.b = false;
      for (const ev of events) {
        if (ev.type === 'clear') audio.sfx(ev.count === 4 ? 'tetris' : 'clear');
        else if (ev.type === 'levelup') { setTheme(ev.level); audio.setLevel(ev.level); audio.sfx('levelup'); }
        else if (ev.type !== 'gameover') audio.sfx(ev.type);
        else gameOver();
      }
      if (screen !== 'playing') break;
    }
    hud(false);
  } else {
    acc = 0;
  }
  if (game) renderer.draw(game, frame);
}
requestAnimationFrame(tick);
