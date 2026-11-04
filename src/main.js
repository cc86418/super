import { createWheelFeed, deriveWorldEnergy } from './api.js';

const HS_KEY = 'wheel-run-best-v1';
const W = 960;
const H = 540;
const GROUND_Y = 430;
const GRAVITY = 2200;
const JUMP_V = -720;
const SLIDE_MS = 420;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const panel = document.getElementById('panel');
const hud = document.getElementById('hud');
const liveBadge = document.getElementById('liveBadge');
const liveLabel = document.getElementById('liveLabel');

const els = {
  score: document.getElementById('hudScore'),
  best: document.getElementById('hudBest'),
  mult: document.getElementById('hudMult'),
  rpm: document.getElementById('hudRpm'),
  block: document.getElementById('hudBlock'),
  settled: document.getElementById('hudSettled'),
};

const state = {
  mode: 'title', // title | playing | paused | over
  t: 0,
  score: 0,
  best: Number(localStorage.getItem(HS_KEY) || 0) || 0,
  distancePx: 0,
  energy: deriveWorldEnergy(null),
  tel: null,
  quake: 0,
  quakeFlash: 0,
  quakeBonusArmed: false,
  lastSettledSeen: null,
  obstacles: [],
  particles: [],
  debris: [],
  spawnAcc: 0,
  hills: [],
  stars: [],
  player: null,
  message: '',
  inputDown: false,
};

function makePlayer() {
  return {
    x: 140,
    y: GROUND_Y,
    w: 42,
    h: 48,
    vy: 0,
    onGround: true,
    sliding: false,
    slideLeft: 0,
    dead: false,
    invuln: 0,
    runPhase: 0,
  };
}

function resetRun() {
  state.t = 0;
  state.score = 0;
  state.distancePx = 0;
  state.obstacles = [];
  state.particles = [];
  state.debris = [];
  state.spawnAcc = 0.4;
  state.quake = 0;
  state.quakeFlash = 0;
  state.quakeBonusArmed = false;
  state.player = makePlayer();
  state.message = '';
  seedDecor();
}

function seedDecor() {
  state.hills = Array.from({ length: 6 }, (_, i) => ({
    x: i * 220,
    w: 180 + Math.random() * 120,
    h: 40 + Math.random() * 70,
    speed: 0.15 + Math.random() * 0.2,
  }));
  state.stars = Array.from({ length: 48 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (GROUND_Y - 80),
    r: Math.random() * 1.8 + 0.4,
    a: 0.2 + Math.random() * 0.7,
  }));
}

function showOverlay(html) {
  panel.innerHTML = html;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

function titleScreen() {
  state.mode = 'title';
  hud.hidden = true;
  showOverlay(`
    <h2>🐹 Wheel Run</h2>
    <p>Survive the burrow while the <strong>live Squeekchain hamster wheel</strong> drives world speed, hazards, and your score multiplier.</p>
    <p>When the wheel is <strong>ACTIVE</strong>, the tunnel races. When it is <strong>IDLE</strong>, catch your breath — and wait for the hamster.</p>
    <div class="actions">
      <button class="btn" data-action="start">Start Run</button>
    </div>
    <p class="tiny">Best: <strong>${Math.floor(state.best)}</strong> · Powered by <a href="https://squeekchain.com" target="_blank" rel="noopener">squeekchain.com</a> · <a href="https://docs.squeekchain.com" target="_blank" rel="noopener">docs</a></p>
  `);
}

function pauseScreen() {
  state.mode = 'paused';
  showOverlay(`
    <h2>Paused</h2>
    <p>Wheel status: <strong>${state.energy.status}</strong> · Mult ×${state.energy.multiplier.toFixed(2)}</p>
    <div class="actions">
      <button class="btn" data-action="resume">Resume</button>
      <button class="btn secondary" data-action="quit">Quit to Title</button>
    </div>
  `);
}

function gameOverScreen() {
  state.mode = 'over';
  const score = Math.floor(state.score);
  const isBest = score >= state.best && score > 0;
  if (score > state.best) {
    state.best = score;
    localStorage.setItem(HS_KEY, String(score));
  }
  showOverlay(`
    <h2>${isBest ? 'New High Score!' : 'Run Over'}</h2>
    <div class="big-score">${score}</div>
    <p>You lasted ${formatDist(state.distancePx)}. Best: <strong>${Math.floor(state.best)}</strong></p>
    <p>${state.message || 'Hit an obstacle. Jump smarter next time.'}</p>
    <div class="actions">
      <button class="btn" data-action="retry">Retry</button>
      <button class="btn secondary" data-action="quit">Title</button>
    </div>
    <p class="tiny">Powered by live Squeekchain hamster wheel · <a href="https://squeekchain.com" target="_blank" rel="noopener">squeekchain.com</a></p>
  `);
}

function formatDist(px) {
  const m = px / 40;
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.floor(m)} m`;
}

function startGame() {
  resetRun();
  state.mode = 'playing';
  hud.hidden = false;
  hideOverlay();
  updateHud();
}

function jump() {
  const p = state.player;
  if (!p || p.dead || state.mode !== 'playing') return;
  if (p.sliding) {
    p.sliding = false;
    p.slideLeft = 0;
    p.h = 48;
  }
  if (p.onGround) {
    p.vy = JUMP_V;
    p.onGround = false;
    burst(p.x + p.w * 0.5, GROUND_Y - 4, '#f4a261', 8);
  }
}

function slide() {
  const p = state.player;
  if (!p || p.dead || state.mode !== 'playing') return;
  if (!p.onGround) return;
  p.sliding = true;
  p.slideLeft = SLIDE_MS;
  p.h = 28;
}

function spawnObstacle() {
  const roll = Math.random();
  const speedBoost = state.energy.active ? 1 : 0;
  if (roll < 0.45) {
    // ground rock / crate
    const h = 34 + Math.random() * 28 + speedBoost * 8;
    state.obstacles.push({
      kind: 'rock',
      x: W + 40,
      y: GROUND_Y - h,
      w: 34 + Math.random() * 18,
      h,
      passed: false,
    });
  } else if (roll < 0.75) {
    // low spike — jump
    state.obstacles.push({
      kind: 'spike',
      x: W + 40,
      y: GROUND_Y - 36,
      w: 40,
      h: 36,
      passed: false,
    });
  } else {
    // hanging root — slide or careful jump timing
    const h = 110 + Math.random() * 70;
    state.obstacles.push({
      kind: 'root',
      x: W + 40,
      y: 70,
      w: 28,
      h,
      passed: false,
    });
  }
}

function triggerQuake() {
  if (state.quake > 0.05) return; // still shaking
  state.quake = 1;
  state.quakeFlash = 0.55;
  state.quakeBonusArmed = true;
  state.message = 'Settlement quake!';
  for (let i = 0; i < 7; i++) {
    state.debris.push({
      x: 80 + Math.random() * (W - 160),
      y: -20 - Math.random() * 80,
      w: 18 + Math.random() * 22,
      h: 16 + Math.random() * 18,
      vy: 80 + Math.random() * 160,
      vx: (Math.random() - 0.5) * 60,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 4,
      life: 2.4,
    });
  }
}

function burst(x, y, color, n = 10) {
  for (let i = 0; i < n; i++) {
    state.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 220,
      vy: -Math.random() * 260 - 40,
      life: 0.4 + Math.random() * 0.5,
      color,
      r: 2 + Math.random() * 3,
    });
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function playerHitbox(p) {
  // Slightly forgiving
  const padX = 8;
  const padY = p.sliding ? 2 : 6;
  return {
    x: p.x + padX,
    y: p.y - p.h + padY,
    w: p.w - padX * 2,
    h: p.h - padY * 2,
  };
}

function kill(reason) {
  if (state.player.dead) return;
  state.player.dead = true;
  state.message = reason;
  burst(state.player.x + 20, state.player.y - 24, '#e76f51', 18);
  setTimeout(() => gameOverScreen(), 420);
}

function update(dt) {
  const energy = state.energy;
  state.t += dt;

  // Decor scroll
  for (const h of state.hills) {
    h.x -= energy.scroll * h.speed * 60 * dt;
    if (h.x + h.w < 0) h.x += W + h.w + 80;
  }
  for (const s of state.stars) {
    s.x -= energy.scroll * 0.08 * 60 * dt;
    if (s.x < 0) s.x += W;
  }

  if (state.quake > 0) state.quake = Math.max(0, state.quake - dt * 1.6);
  if (state.quakeFlash > 0) state.quakeFlash = Math.max(0, state.quakeFlash - dt);

  if (state.mode !== 'playing' || !state.player || state.player.dead) {
    // still animate particles lightly
    updateParticles(dt);
    return;
  }

  const p = state.player;
  p.runPhase += dt * (8 + energy.scroll * 0.8);

  // Physics
  p.vy += GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y >= GROUND_Y) {
    p.y = GROUND_Y;
    p.vy = 0;
    p.onGround = true;
  } else {
    p.onGround = false;
  }

  if (p.sliding) {
    p.slideLeft -= dt * 1000;
    if (p.slideLeft <= 0) {
      p.sliding = false;
      p.h = 48;
    }
  }

  // Score & distance from player "run"
  const runSpeed = energy.scroll * 60;
  state.distancePx += runSpeed * dt;
  const quakeBonus = state.quakeBonusArmed && state.quake < 0.2 ? 1 : 0;
  if (quakeBonus) {
    state.score += 120 * energy.multiplier;
    state.quakeBonusArmed = false;
    burst(p.x + 20, p.y - 60, '#f4d35e', 12);
  }
  state.score += runSpeed * dt * 0.085 * energy.multiplier;

  // Spawns
  state.spawnAcc += dt;
  if (state.spawnAcc >= energy.spawnEvery) {
    state.spawnAcc = 0;
    spawnObstacle();
    if (energy.active && Math.random() < 0.28) {
      // pack a follow-up hazard when wheel is hot
      setTimeout(() => {
        if (state.mode === 'playing' && !state.player?.dead) spawnObstacle();
      }, 280 + Math.random() * 220);
    }
  }

  // Move obstacles
  for (const o of state.obstacles) {
    o.x -= runSpeed * dt;
    if (!o.passed && o.x + o.w < p.x) {
      o.passed = true;
      state.score += 15 * energy.multiplier;
    }
  }
  state.obstacles = state.obstacles.filter((o) => o.x + o.w > -40);

  // Debris from quake
  for (const d of state.debris) {
    d.vy += 900 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.rot += d.vr * dt;
    d.life -= dt;
  }
  state.debris = state.debris.filter((d) => d.life > 0 && d.y < H + 40);

  // Collisions
  const ph = playerHitbox(p);
  for (const o of state.obstacles) {
    const oh = { x: o.x + 4, y: o.y + 2, w: o.w - 8, h: o.h - 4 };
    if (rectsOverlap(ph, oh)) {
      kill(o.kind === 'root' ? 'Clipped a hanging root — try sliding!' : 'Bonked a burrow hazard.');
      break;
    }
  }
  if (!p.dead) {
    for (const d of state.debris) {
      const dh = { x: d.x, y: d.y, w: d.w, h: d.h };
      if (rectsOverlap(ph, dh)) {
        kill('Crushed by settlement debris!');
        break;
      }
    }
  }

  updateParticles(dt);
  updateHud();
}

function updateParticles(dt) {
  for (const pt of state.particles) {
    pt.vy += 600 * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
  }
  state.particles = state.particles.filter((pt) => pt.life > 0);
}

function updateHud() {
  els.score.textContent = String(Math.floor(state.score));
  els.best.textContent = String(Math.floor(state.best));
  els.mult.textContent = `×${state.energy.multiplier.toFixed(2)}`;
  els.rpm.textContent = `${state.energy.rpm.toFixed(1)} rpm`;
  const tel = state.tel;
  els.block.textContent = tel?.blockHeight ? String(tel.blockHeight) : '—';
  els.settled.textContent = tel?.settledThroughRound ? String(tel.settledThroughRound) : '—';
}

function updateLiveBadge(tel, energy) {
  liveBadge.classList.remove('online', 'active', 'offline', 'fault');
  if (!tel || !tel.ok || energy.offline) {
    liveBadge.classList.add(energy.fault ? 'fault' : 'offline');
    liveLabel.textContent = energy.fault ? 'wheel fault' : 'wheel offline';
    return;
  }
  if (energy.active) {
    liveBadge.classList.add('active');
    liveLabel.textContent = `ACTIVE · ${energy.rpm.toFixed(1)} rpm`;
  } else {
    liveBadge.classList.add('online');
    liveLabel.textContent = `IDLE · day ${(tel.distanceMm / 1000).toFixed(1)} m`;
  }
}

function draw() {
  const shakeX = state.quake > 0 ? (Math.random() - 0.5) * 10 * state.quake : 0;
  const shakeY = state.quake > 0 ? (Math.random() - 0.5) * 8 * state.quake : 0;

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.translate(shakeX, shakeY);

  // Sky / burrow back
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b0f18');
  g.addColorStop(0.55, '#2a1610');
  g.addColorStop(1, '#3a2414');
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // Stars / dust motes
  for (const s of state.stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#f7e7d3';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Far hills
  for (const h of state.hills) {
    ctx.fillStyle = '#4a2a1c';
    ctx.beginPath();
    ctx.moveTo(h.x, GROUND_Y);
    ctx.quadraticCurveTo(h.x + h.w * 0.5, GROUND_Y - h.h, h.x + h.w, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }

  // Tunnel arches
  ctx.strokeStyle = '#5a3424';
  ctx.lineWidth = 10;
  for (let i = 0; i < 5; i++) {
    const ax = ((i * 240 - (state.distancePx * 0.35) % 240) + 240) % (W + 240) - 40;
    ctx.beginPath();
    ctx.moveTo(ax, GROUND_Y);
    ctx.quadraticCurveTo(ax + 100, 40, ax + 200, GROUND_Y);
    ctx.stroke();
  }

  // Ground
  ctx.fillStyle = '#5c3a24';
  ctx.fillRect(-20, GROUND_Y, W + 40, H - GROUND_Y + 20);
  ctx.fillStyle = '#3d2618';
  ctx.fillRect(-20, GROUND_Y, W + 40, 14);

  // Ground stripes for motion feel
  ctx.fillStyle = '#6b4530';
  const stripe = (state.distancePx * 1.2) % 48;
  for (let x = -48; x < W + 48; x += 48) {
    ctx.fillRect(x - stripe, GROUND_Y + 18, 24, 6);
  }

  // Obstacles
  for (const o of state.obstacles) drawObstacle(o);

  // Debris
  for (const d of state.debris) {
    ctx.save();
    ctx.translate(d.x + d.w / 2, d.y + d.h / 2);
    ctx.rotate(d.rot);
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    ctx.fillStyle = '#c48a5a';
    ctx.fillRect(-d.w / 2 + 3, -d.h / 2 + 3, d.w * 0.4, d.h * 0.35);
    ctx.restore();
  }

  // Player
  if (state.player) drawPlayer(state.player);

  // Particles
  for (const pt of state.particles) {
    ctx.globalAlpha = Math.max(0, pt.life * 2);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Quake flash
  if (state.quakeFlash > 0) {
    ctx.fillStyle = `rgba(244, 211, 94, ${state.quakeFlash * 0.25})`;
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }

  // Wheel energy ribbon
  drawEnergyRibbon();

  // Idle / offline cues
  if (state.mode === 'playing') {
    if (state.energy.offline) {
      drawBanner('wheel offline — running on last known / soft fallback', '#e07a5f');
    } else if (!state.energy.active) {
      drawBanner('hamster IDLE — lower mult · wait for the wheel', '#c9a88a');
    } else if (state.quake > 0.3) {
      drawBanner('SETTLEMENT QUAKE', '#f4d35e');
    }
  }

  ctx.restore();

  // Title idle preview
  if (state.mode === 'title') {
    // subtle motion already from update when we keep looping
  }
}

function drawBanner(text, color) {
  ctx.fillStyle = '#00000066';
  ctx.fillRect(W * 0.5 - 220, 86, 440, 28);
  ctx.fillStyle = color;
  ctx.font = '700 13px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, W * 0.5, 105);
}

function drawEnergyRibbon() {
  const e = state.energy;
  const w = Math.min(1, (e.multiplier - 0.5) / 3) * (W - 80);
  ctx.fillStyle = '#00000055';
  ctx.fillRect(40, H - 28, W - 80, 8);
  const rg = ctx.createLinearGradient(40, 0, 40 + w, 0);
  rg.addColorStop(0, '#e76f51');
  rg.addColorStop(1, '#f4d35e');
  ctx.fillStyle = rg;
  ctx.fillRect(40, H - 28, Math.max(8, w), 8);
}

function drawObstacle(o) {
  if (o.kind === 'rock') {
    ctx.fillStyle = '#7a5240';
    roundRect(o.x, o.y, o.w, o.h, 8);
    ctx.fill();
    ctx.fillStyle = '#a07858';
    roundRect(o.x + 6, o.y + 6, o.w * 0.35, o.h * 0.3, 4);
    ctx.fill();
  } else if (o.kind === 'spike') {
    ctx.fillStyle = '#c45c3e';
    ctx.beginPath();
    ctx.moveTo(o.x, o.y + o.h);
    ctx.lineTo(o.x + o.w * 0.5, o.y);
    ctx.lineTo(o.x + o.w, o.y + o.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f0a090';
    ctx.beginPath();
    ctx.moveTo(o.x + o.w * 0.35, o.y + o.h * 0.55);
    ctx.lineTo(o.x + o.w * 0.5, o.y + 8);
    ctx.lineTo(o.x + o.w * 0.55, o.y + o.h * 0.55);
    ctx.closePath();
    ctx.fill();
  } else {
    // hanging root
    ctx.strokeStyle = '#6b3f28';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(o.x + o.w * 0.5, 0);
    ctx.quadraticCurveTo(o.x + o.w * 0.5 + 18, o.h * 0.4, o.x + o.w * 0.5, o.y + o.h);
    ctx.stroke();
    ctx.fillStyle = '#8a5538';
    ctx.beginPath();
    ctx.ellipse(o.x + o.w * 0.5, o.y + o.h, 14, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer(p) {
  const bob = p.onGround && !p.sliding ? Math.sin(p.runPhase) * 2 : 0;
  const x = p.x;
  const y = p.y - p.h + bob;
  const bodyH = p.h;

  // shadow
  ctx.fillStyle = '#00000055';
  ctx.beginPath();
  ctx.ellipse(x + p.w * 0.5, GROUND_Y + 4, p.sliding ? 28 : 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // body (runner hamster-ish)
  ctx.fillStyle = '#f0b27a';
  roundRect(x + 4, y + 8, p.w - 8, bodyH - 12, 12);
  ctx.fill();

  // head
  ctx.fillStyle = '#f4c28a';
  ctx.beginPath();
  ctx.arc(x + p.w * 0.62, y + 14, 14, 0, Math.PI * 2);
  ctx.fill();

  // ear
  ctx.fillStyle = '#e89b6a';
  ctx.beginPath();
  ctx.arc(x + p.w * 0.72, y + 4, 7, 0, Math.PI * 2);
  ctx.fill();

  // eye
  ctx.fillStyle = '#1a0f0a';
  ctx.beginPath();
  ctx.arc(x + p.w * 0.68, y + 13, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // cheeks
  ctx.fillStyle = '#e76f5188';
  ctx.beginPath();
  ctx.arc(x + p.w * 0.78, y + 18, 3, 0, Math.PI * 2);
  ctx.fill();

  // legs
  if (!p.sliding) {
    const swing = Math.sin(p.runPhase) * 10;
    ctx.strokeStyle = '#d08955';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 14, y + bodyH - 10);
    ctx.lineTo(x + 14 - swing, y + bodyH + 2);
    ctx.moveTo(x + 28, y + bodyH - 10);
    ctx.lineTo(x + 28 + swing, y + bodyH + 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#d08955';
    roundRect(x + 2, y + bodyH - 10, p.w - 4, 10, 4);
    ctx.fill();
  }

  // scarf for flair
  ctx.fillStyle = '#e76f51';
  roundRect(x + 10, y + 22, 16, 6, 3);
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Input
function onKeyDown(e) {
  if (e.repeat) return;
  const k = e.key;
  if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
    e.preventDefault();
    if (state.mode === 'title' || state.mode === 'over') startGame();
    else if (state.mode === 'paused') {
      state.mode = 'playing';
      hideOverlay();
    } else jump();
  } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
    e.preventDefault();
    slide();
  } else if (k === 'Escape' || k === 'p' || k === 'P') {
    if (state.mode === 'playing') pauseScreen();
    else if (state.mode === 'paused') {
      state.mode = 'playing';
      hideOverlay();
    }
  }
}

function pointerJump(e) {
  // Don't steal clicks from overlay buttons
  if (e.target.closest?.('.panel')) return;
  if (state.mode === 'title' || state.mode === 'over') {
    // canvas click starts
    if (e.target === canvas) startGame();
    return;
  }
  if (state.mode === 'playing') {
    e.preventDefault();
    jump();
  }
}

panel.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  if (action === 'start' || action === 'retry') startGame();
  if (action === 'resume') {
    state.mode = 'playing';
    hideOverlay();
  }
  if (action === 'quit') titleScreen();
});

window.addEventListener('keydown', onKeyDown);
canvas.addEventListener('pointerdown', pointerJump);

// Live feed
const feed = createWheelFeed((tel) => {
  state.tel = tel;
  state.energy = deriveWorldEnergy(tel);
  updateLiveBadge(tel, state.energy);
  if (tel.settlementIncreased && state.mode === 'playing') {
    triggerQuake();
  }
  if (state.mode === 'playing') updateHud();
});

// Loop
seedDecor();
state.player = makePlayer();
els.best.textContent = String(Math.floor(state.best));
titleScreen();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  // Keep mild ambient motion on title
  if (state.mode === 'title' || state.mode === 'paused' || state.mode === 'over') {
    state.distancePx += 30 * dt;
    for (const h of state.hills) {
      h.x -= 20 * h.speed * dt;
      if (h.x + h.w < 0) h.x += W + h.w + 80;
    }
    updateParticles(dt);
  } else {
    update(dt);
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Resize canvas internally crisp
function fit() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fit();
window.addEventListener('resize', fit);

window.addEventListener('beforeunload', () => feed.stop());
