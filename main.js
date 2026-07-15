(() => {
  'use strict';

  const GAME_VERSION = '1.3.1';
  const versionTag = document.getElementById('version-tag');
  if (versionTag) versionTag.textContent = 'v' + GAME_VERSION;

  // ---------- Canvas setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Utility ----------
  const TAU = Math.PI * 2;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---------- Input: touch-drag-anywhere (no visible stick) + Keyboard ----------
  const input = { dx: 0, dy: 0 };

  // Drag surface is the canvas itself. No on-screen widget is drawn; the
  // player just presses anywhere on the game area and drags to steer.
  // Touch capture guarantees move/end events keep targeting this element
  // even if the finger leaves the canvas bounds, so this is safe to use
  // for the full play area without losing tracking.
  const dragSurface = canvas;
  let dragTouchId = null;
  let dragOrigin = { x: 0, y: 0 };
  const DRAG_RADIUS = 42; // px of drag needed to reach full speed

  function dragSet(x, y) {
    let dx = x - dragOrigin.x;
    let dy = y - dragOrigin.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const mag = clamp(d / DRAG_RADIUS, 0, 1);
    if (d > 0.0001) {
      input.dx = (dx / d) * mag;
      input.dy = (dy / d) * mag;
    } else {
      input.dx = 0;
      input.dy = 0;
    }
  }
  function dragStart(id, x, y) {
    dragTouchId = id;
    dragOrigin.x = x;
    dragOrigin.y = y;
    input.dx = 0;
    input.dy = 0;
    if (game && game.awaitingResume) {
      game.awaitingResume = false;
      resumeHint.classList.add('hidden');
    }
  }
  function dragEnd() {
    dragTouchId = null;
    input.dx = 0;
    input.dy = 0;
  }

  dragSurface.addEventListener('touchstart', (e) => {
    e.preventDefault();
    // Always (re)claim the newest touch as the drag anchor. If the finger
    // previously slid off the screen edge, the OS can swallow the
    // touchend/touchcancel for that old touch (e.g. edge-swipe gestures),
    // leaving dragTouchId stuck pointing at a touch that will never end.
    // Gating on "no active drag" would then ignore every future touch, so
    // a fresh touchstart always wins instead of being dropped.
    const t = e.changedTouches[0];
    dragStart(t.identifier, t.clientX, t.clientY);
  }, { passive: false });

  dragSurface.addEventListener('touchmove', (e) => {
    e.preventDefault();
    let stillTracked = false;
    for (const t of e.touches) {
      if (t.identifier === dragTouchId) stillTracked = true;
    }
    // Safety net for the same stuck-touch scenario: if the browser stopped
    // reporting our tracked touch as active without ever sending an
    // end/cancel event, drop it so the player stops drifting in a stale
    // direction instead of waiting forever for an event that won't come.
    if (!stillTracked) { dragEnd(); return; }
    for (const t of e.changedTouches) {
      if (t.identifier === dragTouchId) dragSet(t.clientX, t.clientY);
    }
  }, { passive: false });

  function touchEndHandler(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === dragTouchId) dragEnd();
    }
  }
  dragSurface.addEventListener('touchend', touchEndHandler);
  dragSurface.addEventListener('touchcancel', touchEndHandler);

  // Mouse support for desktop testing (drag anywhere on canvas)
  let mouseDown = false;
  dragSurface.addEventListener('mousedown', (e) => {
    mouseDown = true;
    dragStart('mouse', e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', (e) => {
    if (mouseDown) dragSet(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => {
    if (mouseDown) { mouseDown = false; dragEnd(); }
  });

  // Keyboard (desktop convenience)
  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  function keyboardVector() {
    let dx = 0, dy = 0;
    if (keys['arrowleft'] || keys['a']) dx -= 1;
    if (keys['arrowright'] || keys['d']) dx += 1;
    if (keys['arrowup'] || keys['w']) dy -= 1;
    if (keys['arrowdown'] || keys['s']) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const d = Math.sqrt(dx * dx + dy * dy);
      return { dx: dx / d, dy: dy / d };
    }
    return null;
  }

  // ---------- Game state ----------
  let game = null;
  let lastTime = 0;
  let rafId = null;
  let paused = false;

  const hpBar = document.getElementById('hp-bar');
  const hpText = document.getElementById('hp-text');
  const xpBar = document.getElementById('xp-bar');
  const timerEl = document.getElementById('timer');
  const levelEl = document.getElementById('level');
  const killsEl = document.getElementById('kills');
  const startScreen = document.getElementById('start-screen');
  const levelupScreen = document.getElementById('levelup-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const resumeHint = document.getElementById('resume-hint');
  const upgradeChoicesEl = document.getElementById('upgrade-choices');
  const finalStatsEl = document.getElementById('final-stats');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');
  const pauseBtn = document.getElementById('pause-btn');

  // ---------- Entity classes ----------
  class Player {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.radius = 16;
      this.baseSpeed = 190;
      this.speedMult = 1;
      this.maxHp = 100;
      this.hp = 100;
      this.level = 1;
      this.xp = 0;
      this.xpNext = 10;
      this.invulnTimer = 0;
      this.facing = 1;

      // weapon stats
      this.damage = 10;
      this.atkCooldown = 0.7;
      this.atkTimer = 0;
      this.projSpeed = 380;
      this.projCount = 1;
      this.pierce = 0;
      this.pickupRadius = 70;
      this.regen = 0;
    }

    get speed() { return this.baseSpeed * this.speedMult; }

    takeDamage(amount) {
      if (this.invulnTimer > 0) return;
      this.hp -= amount;
      this.invulnTimer = 0.6;
      if (this.hp <= 0) { this.hp = 0; game.onPlayerDeath(); }
    }

    gainXp(amount) {
      this.xp += amount;
      while (this.xp >= this.xpNext) {
        this.xp -= this.xpNext;
        this.level++;
        this.xpNext = Math.round(this.xpNext * 1.35 + 5);
        game.onLevelUp();
      }
    }
  }

  const ENEMY_TYPES = {
    grunt:  { hp: 18, speed: 78,  radius: 13, color: '#ff5a5a', dmg: 8,  xp: 3,  score: 1 },
    fast:   { hp: 10, speed: 140, radius: 10, color: '#ffd23a', dmg: 6,  xp: 4,  score: 1 },
    tank:   { hp: 70, speed: 48,  radius: 20, color: '#a15aff', dmg: 14, xp: 10, score: 2 },
  };

  class Enemy {
    constructor(type, x, y, waveMult) {
      const def = ENEMY_TYPES[type];
      this.type = type;
      this.x = x;
      this.y = y;
      this.radius = def.radius;
      this.color = def.color;
      this.speed = def.speed;
      this.maxHp = Math.round(def.hp * waveMult);
      this.hp = this.maxHp;
      this.dmg = def.dmg;
      this.xpValue = def.xp;
      this.scoreValue = def.score;
      this.hitFlash = 0;
      this.contactCd = 0;
    }
  }

  class Projectile {
    constructor(x, y, vx, vy, damage, pierce, radius) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.damage = damage;
      this.pierce = pierce;
      this.radius = radius || 5;
      this.life = 1.6;
      this.hitSet = new Set();
    }
  }

  class Gem {
    constructor(x, y, value) {
      this.x = x; this.y = y;
      this.value = value;
      this.radius = 5;
      this.vx = 0; this.vy = 0;
    }
  }

  class Particle {
    constructor(x, y, color) {
      this.x = x; this.y = y;
      const ang = rand(0, TAU);
      const spd = rand(40, 140);
      this.vx = Math.cos(ang) * spd;
      this.vy = Math.sin(ang) * spd;
      this.life = rand(0.25, 0.5);
      this.maxLife = this.life;
      this.color = color;
      this.radius = rand(2, 4);
    }
  }

  const UPGRADE_POOL = [
    { id: 'damage', title: 'ダメージ強化', desc: '攻撃ダメージ +30%', apply: p => p.damage = Math.round(p.damage * 1.3) },
    { id: 'atkspeed', title: '攻撃速度アップ', desc: '攻撃間隔 -15%', apply: p => p.atkCooldown = Math.max(0.15, p.atkCooldown * 0.85) },
    { id: 'speed', title: '移動速度アップ', desc: '移動速度 +12%', apply: p => p.speedMult *= 1.12 },
    { id: 'maxhp', title: '最大HPアップ', desc: '最大HP +25、HP回復', apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
    { id: 'multishot', title: 'マルチショット', desc: '同時発射数 +1', apply: p => p.projCount += 1 },
    { id: 'pickup', title: '回収範囲アップ', desc: 'XP回収範囲 +30', apply: p => p.pickupRadius += 30 },
    { id: 'pierce', title: '貫通強化', desc: '弾の貫通数 +1', apply: p => p.pierce += 1 },
    { id: 'regen', title: 'リジェネ', desc: '毎秒HP自然回復 +1', apply: p => p.regen += 1 },
  ];

  // ---------- Game controller ----------
  class Game {
    constructor() {
      this.player = new Player();
      this.enemies = [];
      this.projectiles = [];
      this.gems = [];
      this.particles = [];
      this.camX = 0;
      this.camY = 0;
      this.time = 0;
      this.kills = 0;
      this.spawnTimer = 0;
      this.spawnInterval = 1.1;
      this.over = false;
      this.levelingUp = false;
      this.awaitingResume = false;
      this.shakeTime = 0;
    }

    onLevelUp() {
      this.levelingUp = true;
      const picks = [];
      const pool = UPGRADE_POOL.slice();
      for (let i = 0; i < 3 && pool.length; i++) {
        const idx = randInt(0, pool.length - 1);
        picks.push(pool.splice(idx, 1)[0]);
      }
      upgradeChoicesEl.innerHTML = '';
      for (const up of picks) {
        const card = document.createElement('div');
        card.className = 'upgrade-card';
        card.innerHTML = `<div class="u-title">${up.title}</div><div class="u-desc">${up.desc}</div>`;
        card.addEventListener('click', () => this.pickUpgrade(up));
        upgradeChoicesEl.appendChild(card);
      }
      levelupScreen.classList.remove('hidden');
    }

    pickUpgrade(up) {
      up.apply(this.player);
      levelupScreen.classList.add('hidden');
      this.levelingUp = false;
      // The player's finger just lifted off the upgrade card, so there is
      // no active drag. Keep gameplay stopped until they deliberately
      // touch the screen again, instead of leaving them briefly
      // uncontrollable while enemies keep closing in.
      this.awaitingResume = true;
      resumeHint.classList.remove('hidden');
    }

    onPlayerDeath() {
      this.over = true;
      const mm = String(Math.floor(this.time / 60)).padStart(2, '0');
      const ss = String(Math.floor(this.time % 60)).padStart(2, '0');
      finalStatsEl.innerHTML = `生存時間: ${mm}:${ss}<br>撃破数: ${this.kills}<br>到達レベル: ${this.player.level}`;
      gameoverScreen.classList.remove('hidden');
      pauseBtn.classList.add('hidden');
    }

    spawnEnemy() {
      const p = this.player;
      const angle = rand(0, TAU);
      const spawnDist = Math.max(W, H) * 0.65 + 60;
      const x = p.x + Math.cos(angle) * spawnDist;
      const y = p.y + Math.sin(angle) * spawnDist;

      let type = 'grunt';
      const r = Math.random();
      const t = this.time;
      if (t > 90 && r < 0.22) type = 'tank';
      else if (t > 30 && r < 0.5) type = 'fast';

      const waveMult = 1 + this.time / 45;
      this.enemies.push(new Enemy(type, x, y, waveMult));
    }

    fireWeapon(dt) {
      const p = this.player;
      p.atkTimer -= dt;
      if (p.atkTimer > 0) return;
      if (this.enemies.length === 0) return;

      // find nearest N enemies
      const sorted = this.enemies
        .map(e => ({ e, d: dist2(e.x, e.y, p.x, p.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.max(1, p.projCount));

      if (sorted.length === 0) return;
      p.atkTimer = p.atkCooldown;

      for (let i = 0; i < p.projCount; i++) {
        const target = sorted[i % sorted.length].e;
        const ang = Math.atan2(target.y - p.y, target.x - p.x) + rand(-0.05, 0.05);
        const vx = Math.cos(ang) * p.projSpeed;
        const vy = Math.sin(ang) * p.projSpeed;
        this.projectiles.push(new Projectile(p.x, p.y, vx, vy, p.damage, p.pierce, 5));
      }
    }

    update(dt) {
      if (this.over || this.levelingUp || this.awaitingResume || paused) return;
      this.time += dt;
      const p = this.player;

      // movement
      let mx = input.dx, my = input.dy;
      const kb = keyboardVector();
      if (kb) { mx = kb.dx; my = kb.dy; }
      const mag = Math.sqrt(mx * mx + my * my);
      if (mag > 0.02) {
        // mx/my already encode direction * magnitude (0-1), so scale by
        // speed directly - do not re-normalize/re-multiply by mag here.
        p.x += mx * p.speed * dt;
        p.y += my * p.speed * dt;
        if (mx !== 0) p.facing = mx > 0 ? 1 : -1;
      }

      if (p.invulnTimer > 0) p.invulnTimer -= dt;
      if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

      // spawn
      this.spawnTimer -= dt;
      const curInterval = Math.max(0.18, this.spawnInterval - this.time * 0.01);
      if (this.spawnTimer <= 0) {
        this.spawnTimer = curInterval;
        const burst = 1 + Math.floor(this.time / 60);
        for (let i = 0; i < burst; i++) this.spawnEnemy();
      }

      this.fireWeapon(dt);

      // enemies
      for (const e of this.enemies) {
        const d = dist(e.x, e.y, p.x, p.y) || 1;
        e.x += (p.x - e.x) / d * e.speed * dt;
        e.y += (p.y - e.y) / d * e.speed * dt;
        if (e.hitFlash > 0) e.hitFlash -= dt;
        if (e.contactCd > 0) e.contactCd -= dt;

        if (d < e.radius + p.radius && e.contactCd <= 0) {
          p.takeDamage(e.dmg);
          e.contactCd = 0.5;
          this.shakeTime = 0.15;
        }
      }

      // projectiles
      for (const proj of this.projectiles) {
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        proj.life -= dt;
      }

      // projectile-enemy collision
      for (const proj of this.projectiles) {
        if (proj.life <= 0) continue;
        for (const e of this.enemies) {
          if (proj.hitSet.has(e)) continue;
          if (dist2(proj.x, proj.y, e.x, e.y) < (proj.radius + e.radius) * (proj.radius + e.radius)) {
            e.hp -= proj.damage;
            e.hitFlash = 0.12;
            proj.hitSet.add(e);
            if (proj.pierce <= 0) { proj.life = 0; break; }
            proj.pierce -= 1;
          }
        }
      }

      // dead enemies -> gems + particles
      this.enemies = this.enemies.filter(e => {
        if (e.hp <= 0) {
          this.kills++;
          this.gems.push(new Gem(e.x, e.y, e.xpValue));
          for (let i = 0; i < 6; i++) this.particles.push(new Particle(e.x, e.y, e.color));
          return false;
        }
        return true;
      });

      this.projectiles = this.projectiles.filter(pr => pr.life > 0);

      // gems: attract + collect
      for (const g of this.gems) {
        const d = dist(g.x, g.y, p.x, p.y);
        if (d < p.pickupRadius) {
          const pull = 500;
          g.x += (p.x - g.x) / Math.max(d, 1) * pull * dt;
          g.y += (p.y - g.y) / Math.max(d, 1) * pull * dt;
        }
      }
      this.gems = this.gems.filter(g => {
        if (dist(g.x, g.y, p.x, p.y) < p.radius + g.radius) {
          p.gainXp(g.value);
          return false;
        }
        return true;
      });

      // particles
      for (const pt of this.particles) {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 0.9; pt.vy *= 0.9;
        pt.life -= dt;
      }
      this.particles = this.particles.filter(pt => pt.life > 0);

      if (this.shakeTime > 0) this.shakeTime -= dt;

      // camera follows player
      this.camX = p.x;
      this.camY = p.y;

      this.updateHud();
    }

    updateHud() {
      const p = this.player;
      hpBar.style.width = clamp(p.hp / p.maxHp, 0, 1) * 100 + '%';
      hpText.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
      xpBar.style.width = clamp(p.xp / p.xpNext, 0, 1) * 100 + '%';
      levelEl.textContent = `Lv.${p.level}`;
      killsEl.textContent = `${this.kills} kills`;
      const mm = String(Math.floor(this.time / 60)).padStart(2, '0');
      const ss = String(Math.floor(this.time % 60)).padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;
    }

    draw() {
      ctx.clearRect(0, 0, W, H);

      let shakeX = 0, shakeY = 0;
      if (this.shakeTime > 0 && !paused) {
        shakeX = rand(-4, 4);
        shakeY = rand(-4, 4);
      }

      const offX = W / 2 - this.camX + shakeX;
      const offY = H / 2 - this.camY + shakeY;

      // background grid
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      const gridSize = 64;
      const startX = ((offX % gridSize) + gridSize) % gridSize;
      const startY = ((offY % gridSize) + gridSize) % gridSize;
      for (let x = startX; x < W; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = startY; y < H; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();

      // gems
      for (const g of this.gems) {
        const sx = g.x + offX, sy = g.y + offY;
        if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#7fffd4';
        ctx.fillRect(-g.radius, -g.radius, g.radius * 2, g.radius * 2);
        ctx.restore();
      }

      // particles
      for (const pt of this.particles) {
        const sx = pt.x + offX, sy = pt.y + offY;
        ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(sx, sy, pt.radius, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // enemies
      for (const e of this.enemies) {
        const sx = e.x + offX, sy = e.y + offY;
        if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
        ctx.beginPath();
        ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
        ctx.arc(sx, sy, e.radius, 0, TAU);
        ctx.fill();
        // hp bar for tougher enemies
        if (e.maxHp > 15) {
          const w = e.radius * 2;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(sx - w / 2, sy - e.radius - 8, w, 4);
          ctx.fillStyle = '#5aff7a';
          ctx.fillRect(sx - w / 2, sy - e.radius - 8, w * clamp(e.hp / e.maxHp, 0, 1), 4);
        }
      }

      // projectiles
      for (const proj of this.projectiles) {
        const sx = proj.x + offX, sy = proj.y + offY;
        ctx.beginPath();
        ctx.fillStyle = '#ffe45a';
        ctx.arc(sx, sy, proj.radius, 0, TAU);
        ctx.fill();
      }

      // player
      const p = this.player;
      const psx = p.x + offX, psy = p.y + offY;
      ctx.save();
      if (p.invulnTimer > 0 && Math.floor(this.time * 20) % 2 === 0) ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.fillStyle = '#3ad1ff';
      ctx.arc(psx, psy, p.radius, 0, TAU);
      ctx.fill();
      // eyes to show facing
      ctx.fillStyle = '#0d0d12';
      ctx.beginPath();
      ctx.arc(psx + p.facing * 5, psy - 4, 2.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Loop ----------
  function loop(ts) {
    if (!lastTime) lastTime = ts;
    let dt = (ts - lastTime) / 1000;
    lastTime = ts;
    dt = Math.min(dt, 0.05); // clamp to avoid big jumps on tab switch

    if (game && !game.over) {
      game.update(dt);
      game.draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  // ---------- Screen management ----------
  function startGame() {
    game = new Game();
    paused = false;
    lastTime = 0;
    startScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    levelupScreen.classList.add('hidden');
    resumeHint.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    pauseBtn.textContent = 'II';
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  pauseBtn.addEventListener('click', () => {
    if (!game || game.over) return;
    if (paused) {
      // Resuming: the tap that hit this button isn't a movement gesture,
      // so gate play behind the same "tap the screen to resume" flow used
      // after a level-up pick, instead of letting enemies act on an
      // uncontrolled player the instant the button is released.
      paused = false;
      game.awaitingResume = true;
      resumeHint.classList.remove('hidden');
    } else {
      paused = true;
    }
    pauseBtn.textContent = paused ? '>' : 'II';
  });

  // Prevent page scroll/bounce on iOS
  document.addEventListener('touchmove', (e) => {
    e.preventDefault();
  }, { passive: false });

})();
