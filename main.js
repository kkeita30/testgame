(() => {
  'use strict';

  const GAME_VERSION = '1.13.0';
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
  const difficultyEl = document.getElementById('difficulty');
  const killRateEl = document.getElementById('kill-rate');
  const killsEl = document.getElementById('kills');
  const startScreen = document.getElementById('start-screen');
  const characterSelectScreen = document.getElementById('character-select-screen');
  const characterChoicesEl = document.getElementById('character-choices');
  const weaponChoicesEl = document.getElementById('weapon-choices');
  const confirmCharacterBtn = document.getElementById('confirm-character-btn');
  const levelupScreen = document.getElementById('levelup-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const resumeHint = document.getElementById('resume-hint');
  const upgradeChoicesEl = document.getElementById('upgrade-choices');
  const finalStatsEl = document.getElementById('final-stats');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');
  const pauseBtn = document.getElementById('pause-btn');

  // Two independent rosters, picked separately before a run:
  // - CHARACTERS differentiate on survivability/utility stats (HP, move
  //   speed, regen, pickup range) and, later, on double-tap special
  //   abilities/passives.
  // - WEAPONS differentiate on offense stats (damage, fire rate, pierce,
  //   multishot).
  // Only one placeholder entry exists in each today; new options slot in by
  // adding array entries, each with an `apply(player)` that tweaks starting
  // stats (or, once built, assigns the actual weapon/ability behavior).
  const CHARACTERS = [
    {
      id: 'standard',
      name: 'スタンダード',
      desc: 'バランス型。今後HP・移動速度・リジェネ・回収範囲や特殊能力が異なるキャラクターが追加されます。',
      apply: (p) => {},
    },
  ];

  const WEAPONS = [
    {
      id: 'standard',
      name: 'スタンダード',
      desc: '標準武器。今後ダメージ・発射速度・貫通・マルチショットが異なる武器が追加されます。',
      apply: (p) => {},
    },
  ];

  // Required XP grows with level^1.5 rather than compounding multiplicatively
  // (the old `xpNext * 1.35 + 5` recurrence), so it stays a smooth, roughly
  // steady climb instead of snowballing into a wall by level ~15. A hard
  // cap keeps very long runs from ever facing an unbounded requirement.
  const XP_NEXT_CAP = 1000;
  function xpNextForLevel(level) {
    return Math.min(XP_NEXT_CAP, Math.round(10 + 8 * Math.pow(level, 1.5)));
  }

  // ---------- Entity classes ----------
  class Player {
    constructor(character, weapon) {
      this.x = 0;
      this.y = 0;
      this.radius = 16;
      this.baseSpeed = 190;
      this.speedMult = 1;
      this.maxHp = 100;
      this.hp = 100;
      this.level = 1;
      this.xp = 0;
      this.xpNext = xpNextForLevel(this.level);
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

      // Bullet effects: 0 means not yet acquired. First pick sets it to 1
      // (activates the effect); further picks raise the level (stronger
      // effect) up to BULLET_EFFECTS' maxLevel, after which the upgrade
      // stops appearing as a choice. Pierce reuses the existing `pierce`
      // count directly as its level instead of a separate field.
      this.explosionLevel = 0;
      this.chainLevel = 0;
      this.slowLevel = 0;

      if (character) character.apply(this);
      if (weapon) weapon.apply(this);
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
        this.xpNext = xpNextForLevel(this.level);
        game.onLevelUp();
      }
    }
  }

  const ENEMY_TYPES = {
    grunt:  { hp: 18, speed: 78,  radius: 13, color: '#ff5a5a', dmg: 8,  xp: 3,  score: 1 },
    fast:   { hp: 10, speed: 140, radius: 10, color: '#ffd23a', dmg: 6,  xp: 4,  score: 1 },
    tank:   { hp: 70, speed: 48,  radius: 20, color: '#a15aff', dmg: 14, xp: 10, score: 2 },
  };

  // Player stat values at game start, used as the "no upgrades taken" yardstick
  // for the build-aware difficulty scaling below.
  const BASELINE_STATS = { damage: 10, atkCooldown: 0.7, projCount: 1, pierce: 0, maxHp: 100 };

  // These three convert "how far past baseline has the player pushed this
  // stat" into a multiplier (1 = no upgrades in that direction yet). Difficulty
  // scaling only kicks in on an axis once the player has actually invested in
  // the matching upgrades, so e.g. skipping damage/attack-speed the whole run
  // keeps enemy HP on the slow time-based curve instead of also compounding
  // with a build that never got stronger.
  function offensePowerMult(p) {
    return (p.damage / BASELINE_STATS.damage) * (BASELINE_STATS.atkCooldown / p.atkCooldown);
  }
  function crowdPowerMult(p) {
    return 1 + Math.max(0, p.projCount - BASELINE_STATS.projCount) * 0.18 + p.pierce * 0.15;
  }
  function survivalPowerMult(p) {
    return p.maxHp / BASELINE_STATS.maxHp;
  }

  class Enemy {
    constructor(type, x, y, hpMult, dmgMult) {
      const def = ENEMY_TYPES[type];
      this.type = type;
      this.x = x;
      this.y = y;
      this.radius = def.radius;
      this.color = def.color;
      this.speed = def.speed;
      this.maxHp = Math.round(def.hp * hpMult);
      this.hp = this.maxHp;
      this.dmg = Math.round(def.dmg * dmgMult);
      this.xpValue = def.xp;
      this.scoreValue = def.score;
      this.hitFlash = 0;
      this.contactCd = 0;
      this.slowTimer = 0;
    }
  }

  class Projectile {
    constructor(x, y, vx, vy, damage, pierce, radius, explosionRadius, chainHops, slowDuration) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.damage = damage;
      this.pierce = pierce;
      this.radius = radius || 5;
      this.life = 1.6;
      this.hitSet = new Set();
      this.explosionRadius = explosionRadius || 0;
      this.chainHops = chainHops || 0;
      this.slowDuration = slowDuration || 0;
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

  // Brief fading line drawn between a chain jump's origin and its target,
  // so the chain effect reads as visibly "arcing" between enemies rather
  // than just being invisible bonus damage.
  class ChainZap {
    constructor(x1, y1, x2, y2) {
      this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
      this.life = 0.15;
      this.maxLife = 0.15;
    }
  }

  const UPGRADE_POOL = [
    { id: 'damage', title: 'ダメージ強化', desc: '攻撃ダメージ +50%', apply: p => p.damage = Math.round(p.damage * 1.5) },
    { id: 'atkspeed', title: '攻撃速度アップ', desc: '攻撃間隔 -15%', apply: p => p.atkCooldown = Math.max(0.15, p.atkCooldown * 0.85) },
    { id: 'speed', title: '移動速度アップ', desc: '移動速度 +12%', apply: p => p.speedMult *= 1.12 },
    { id: 'maxhp', title: '最大HPアップ', desc: '最大HP +25、HP回復', apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
    { id: 'pickup', title: '回収範囲アップ', desc: 'XP回収範囲 +30', apply: p => p.pickupRadius += 30 },
    { id: 'regen', title: 'リジェネ', desc: '毎秒HP自然回復 +1', apply: p => p.regen += 1 },
  ];

  // Floors/ceilings for the tradeoff upgrades below, so stacking the same
  // downside repeatedly can't reduce a stat to uselessness (or, on the
  // cooldown side, to unplayable slowness). Once a stat is saturated at its
  // limit, further picks of that tradeoff still grant the upside "for free".
  const STAT_LIMITS = { minDamage: 3, maxAtkCooldown: 1.4, minAtkCooldown: 0.15, minMaxHp: 40 };

  // Each grants a strong upside alongside a real downside, for players who
  // want to commit to a build rather than only stacking safe, one-sided
  // upgrades.
  const TRADEOFF_POOL = [
    {
      id: 'trade-damage',
      title: '捨て身の一撃',
      desc: 'ダメージ +80% / 攻撃間隔 +15%(発射速度ダウン)',
      apply: p => {
        p.damage = Math.round(p.damage * 1.8);
        p.atkCooldown = Math.min(STAT_LIMITS.maxAtkCooldown, p.atkCooldown * 1.15);
      },
    },
    {
      id: 'trade-atkspeed',
      title: '速射特化',
      desc: '攻撃間隔 -23%(発射速度アップ) / ダメージ -20%',
      apply: p => {
        p.atkCooldown = Math.max(STAT_LIMITS.minAtkCooldown, p.atkCooldown / 1.3);
        p.damage = Math.max(STAT_LIMITS.minDamage, Math.round(p.damage * 0.8));
      },
    },
    {
      id: 'trade-regen',
      title: '生命転化',
      desc: 'HP自然回復 +2 / 最大HP -15%',
      apply: p => {
        p.regen += 2;
        p.maxHp = Math.max(STAT_LIMITS.minMaxHp, Math.round(p.maxHp * 0.85));
        p.hp = Math.min(p.hp, p.maxHp);
      },
    },
    {
      id: 'trade-speed',
      title: '俊足の代償',
      desc: '移動速度 +30% / 最大HP -15%',
      apply: p => {
        p.speedMult *= 1.3;
        p.maxHp = Math.max(STAT_LIMITS.minMaxHp, Math.round(p.maxHp * 0.85));
        p.hp = Math.min(p.hp, p.maxHp);
      },
    },
  ];

  // Bullet effects: unlike the plain stat upgrades above, these have levels
  // and a cap. The first pick activates the effect; later picks strengthen
  // it. Once maxLevel is reached, onLevelUp() below stops offering that
  // entry at all. Pierce and multishot reuse the existing `pierce`/
  // `projCount` fields directly as their level rather than a separate
  // counter - multishot's `projCount` starts at 1 (base weapon already
  // fires one shot), so it's always in the "upgrade" state, never "(New)".
  const EXPLOSION_DAMAGE_PCT = 0.6;
  const CHAIN_DAMAGE_PCT = 0.3;
  const CHAIN_RADIUS = 150;
  const SLOW_MULT = 0.5;
  function explosionRadiusForLevel(level) { return 50 + 20 * (level - 1); }
  function slowDurationForLevel(level) { return 1.0 + 0.5 * (level - 1); }

  const BULLET_EFFECTS = [
    {
      id: 'explosion',
      name: '爆発',
      maxLevel: 5,
      getLevel: p => p.explosionLevel,
      levelUp: p => { p.explosionLevel++; },
      introDesc: '着弾地点の周囲に範囲ダメージを与えるようになる',
      upgradeDesc: level => `爆発範囲が拡大する(${Math.round(explosionRadiusForLevel(level))} → ${Math.round(explosionRadiusForLevel(level + 1))})`,
    },
    {
      id: 'chain',
      name: '連鎖',
      maxLevel: 5,
      getLevel: p => p.chainLevel,
      levelUp: p => { p.chainLevel++; },
      introDesc: '着弾時、近くの敵にダメージが連鎖するようになる',
      upgradeDesc: level => `連鎖回数が増加する(${level} → ${level + 1}体)`,
    },
    {
      id: 'slow',
      name: '低速',
      maxLevel: 5,
      getLevel: p => p.slowLevel,
      levelUp: p => { p.slowLevel++; },
      introDesc: '着弾した敵を一時的に減速させるようになる',
      upgradeDesc: level => `減速時間が増加する(${slowDurationForLevel(level).toFixed(1)}秒 → ${slowDurationForLevel(level + 1).toFixed(1)}秒)`,
    },
    {
      id: 'pierce',
      name: '貫通',
      maxLevel: 5,
      getLevel: p => p.pierce,
      levelUp: p => { p.pierce++; },
      introDesc: '弾が敵を貫通するようになる',
      upgradeDesc: level => `貫通数が増加する(${level} → ${level + 1})`,
    },
    {
      id: 'multishot',
      name: 'マルチショット',
      maxLevel: 5,
      // projCount starts at 1 (the base weapon already fires one shot), so
      // this is always in the "upgrade" state, never the "(New)" state.
      // baseLevel marks that starting value so the "already invested in
      // this effect" check below (used for the priority slot) isn't
      // fooled into thinking the player has invested before ever picking it.
      baseLevel: 1,
      getLevel: p => p.projCount,
      levelUp: p => { p.projCount++; },
      introDesc: '同時発射数が増加する',
      upgradeDesc: level => `同時発射数が増加する(${level} → ${level + 1})`,
    },
  ];

  function bulletEffectUpgrade(effect, player) {
    const level = effect.getLevel(player);
    return {
      id: `bullet-${effect.id}`,
      title: level === 0 ? `${effect.name}(New)` : `${effect.name} Lv.${level}→${level + 1}`,
      desc: level === 0 ? effect.introDesc : effect.upgradeDesc(level),
      apply: p => effect.levelUp(p),
    };
  }

  // Not part of the random pool: always offered as an extra choice so the
  // player can decline a bad draw. No stat changes, but banks a chunk of
  // progress toward the next level instead of leaving XP near empty.
  const SKIP_UPGRADE = {
    id: 'skip',
    title: 'スキップ',
    desc: '強化なし。次のレベルアップまでのXPを30%獲得した状態にする',
    apply: p => { p.xp = p.xpNext * 0.3; },
  };

  // ---------- Game controller ----------
  class Game {
    constructor(character, weapon) {
      this.player = new Player(character, weapon);
      this.enemies = [];
      this.projectiles = [];
      this.gems = [];
      this.particles = [];
      this.chainZaps = [];
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

      // Kill-rate rubber-band: difficulty is no longer a pure function of
      // elapsed time. Every 60s it is re-evaluated against how much of the
      // last window's spawns actually got killed, so a player who is
      // falling behind gets the ramp held (or walked back) instead of
      // ratcheting up regardless of how the fight is actually going.
      this.difficulty = 1;
      this.levelCheckTimer = 60;
      this.totalSpawned = 0;
      this.spawnedAtCheckpoint = 0;
      this.killsAtCheckpoint = 0;
    }

    onLevelUp() {
      this.levelingUp = true;
      const picks = [];
      const notMaxedEffects = BULLET_EFFECTS.filter(eff => eff.getLevel(this.player) < eff.maxLevel);
      const pool = [
        ...UPGRADE_POOL,
        ...TRADEOFF_POOL,
        ...notMaxedEffects.map(eff => bulletEffectUpgrade(eff, this.player)),
      ];

      // Slot 1 is a "bullet effect priority" slot: if the player already
      // has at least one level in some not-yet-maxed effect, that slot is
      // reserved for deepening one of those instead of a plain random draw,
      // so committing to an effect keeps paying off instead of getting
      // diluted by the rest of the pool. With nothing owned yet (or
      // everything owned already maxed), it just behaves like a normal slot.
      const ownedEffects = notMaxedEffects.filter(eff => eff.getLevel(this.player) > (eff.baseLevel || 0));
      const firstSlotPool = ownedEffects.length > 0
        ? ownedEffects.map(eff => bulletEffectUpgrade(eff, this.player))
        : pool;
      const firstPick = firstSlotPool[randInt(0, firstSlotPool.length - 1)];
      picks.push(firstPick);

      const remainingPool = pool.filter(up => up.id !== firstPick.id);
      for (let i = 0; i < 2 && remainingPool.length; i++) {
        const idx = randInt(0, remainingPool.length - 1);
        picks.push(remainingPool.splice(idx, 1)[0]);
      }
      upgradeChoicesEl.innerHTML = '';
      for (const up of picks) {
        const card = document.createElement('div');
        card.className = 'upgrade-card';
        card.innerHTML = `<div class="u-title">${up.title}</div><div class="u-desc">${up.desc}</div>`;
        card.addEventListener('click', () => this.pickUpgrade(up));
        upgradeChoicesEl.appendChild(card);
      }
      const skipCard = document.createElement('div');
      skipCard.className = 'upgrade-card skip-card';
      skipCard.innerHTML = `<div class="u-title">${SKIP_UPGRADE.title}</div><div class="u-desc">${SKIP_UPGRADE.desc}</div>`;
      skipCard.addEventListener('click', () => this.pickUpgrade(SKIP_UPGRADE));
      upgradeChoicesEl.appendChild(skipCard);
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
      // update() (and its HUD refresh) is skipped while awaitingResume, so
      // refresh once here - otherwise picking Skip wouldn't show its XP
      // top-up on the bar until the player taps to resume.
      this.updateHud();
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
      const D = this.difficulty;
      this.totalSpawned++;

      let type = 'grunt';
      const r = Math.random();
      if (D >= 5 && r < 0.22) type = 'tank';
      else if (D >= 2 && r < 0.5) type = 'fast';

      // Stepped time-based baseline, plus a build-aware top-up: enemy HP
      // tracks how much dps the player has stacked (damage x attack speed)
      // beyond the starting weapon, and enemy contact damage tracks how
      // tanky the player has made themselves via max HP. A run that skips
      // those upgrades never sees the extra factor kick in, so it stays on
      // the tier baseline instead of getting hard-countered by a stat the
      // player never invested in. The offense coefficient is kept low
      // (0.25) on purpose - upgrading damage/attack speed should mostly
      // just feel stronger, not get mostly cancelled out by tougher enemies.
      const tierHpMult = 1 + (D - 1) * 0.18;
      const offenseExtra = Math.max(0, offensePowerMult(p) - 1);
      const hpMult = tierHpMult * (1 + offenseExtra * 0.25);

      const tierDmgMult = 1 + (D - 1) * 0.14;
      const survivalExtra = Math.max(0, survivalPowerMult(p) - 1);
      const dmgMult = tierDmgMult * (1 + survivalExtra * 0.7);

      this.enemies.push(new Enemy(type, x, y, hpMult, dmgMult));
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

      const explosionRadius = p.explosionLevel > 0 ? explosionRadiusForLevel(p.explosionLevel) : 0;
      const chainHops = p.chainLevel;
      const slowDuration = p.slowLevel > 0 ? slowDurationForLevel(p.slowLevel) : 0;

      for (let i = 0; i < p.projCount; i++) {
        const target = sorted[i % sorted.length].e;
        const ang = Math.atan2(target.y - p.y, target.x - p.x) + rand(-0.05, 0.05);
        const vx = Math.cos(ang) * p.projSpeed;
        const vy = Math.sin(ang) * p.projSpeed;
        this.projectiles.push(new Projectile(p.x, p.y, vx, vy, p.damage, p.pierce, 5, explosionRadius, chainHops, slowDuration));
      }
    }

    update(dt) {
      if (this.over || this.levelingUp || this.awaitingResume || paused) return;
      this.time += dt;
      const p = this.player;

      // Kill-rate rubber-band, checked once per 60s window: a single
      // discrete "difficulty" tier replaced the old continuous time-based
      // curves so difficulty reads as legible steps. This is the step
      // rule - normally +1 per window, but if the player killed 70% or
      // less of what spawned last window the tier holds instead of
      // advancing, and at 50% or less it steps back down (never below 1).
      this.levelCheckTimer -= dt;
      if (this.levelCheckTimer <= 0) {
        this.levelCheckTimer += 60;
        const spawnedThisWindow = this.totalSpawned - this.spawnedAtCheckpoint;
        const killsThisWindow = this.kills - this.killsAtCheckpoint;
        const killRate = spawnedThisWindow > 0 ? killsThisWindow / spawnedThisWindow : 1;
        if (killRate <= 0.5) this.difficulty = Math.max(1, this.difficulty - 1);
        else if (killRate > 0.7) this.difficulty += 1;
        this.spawnedAtCheckpoint = this.totalSpawned;
        this.killsAtCheckpoint = this.kills;
      }

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
      const D = this.difficulty;
      const tierInterval = Math.max(0.22, this.spawnInterval - (D - 1) * 0.11);
      // Multishot/pierce make a player good at handling crowds, so a build
      // that stacks those sees extra enemies on top of the tier baseline;
      // a build that never picks them up keeps the gentle baseline.
      const crowdExtra = Math.max(0, crowdPowerMult(p) - 1);
      const curInterval = Math.max(0.15, tierInterval / (1 + crowdExtra * 0.5));
      if (this.spawnTimer <= 0) {
        this.spawnTimer = curInterval;
        const tierBurst = 1 + Math.floor((D - 1) / 5);
        const burst = tierBurst + Math.round(crowdExtra * 2);
        for (let i = 0; i < burst; i++) this.spawnEnemy();
      }

      this.fireWeapon(dt);

      // enemies
      for (const e of this.enemies) {
        const d = dist(e.x, e.y, p.x, p.y) || 1;
        const effSpeed = e.slowTimer > 0 ? e.speed * SLOW_MULT : e.speed;
        e.x += (p.x - e.x) / d * effSpeed * dt;
        e.y += (p.y - e.y) / d * effSpeed * dt;
        if (e.hitFlash > 0) e.hitFlash -= dt;
        if (e.contactCd > 0) e.contactCd -= dt;
        if (e.slowTimer > 0) e.slowTimer -= dt;

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
            if (proj.slowDuration > 0) e.slowTimer = Math.max(e.slowTimer, proj.slowDuration);

            if (proj.explosionRadius > 0) {
              for (const other of this.enemies) {
                if (other === e) continue;
                if (dist(other.x, other.y, e.x, e.y) <= proj.explosionRadius) {
                  other.hp -= proj.damage * EXPLOSION_DAMAGE_PCT;
                  other.hitFlash = 0.12;
                  for (let i = 0; i < 4; i++) this.particles.push(new Particle(e.x, e.y, '#ffa040'));
                }
              }
            }

            if (proj.chainHops > 0) {
              const chained = new Set([e]);
              let fromX = e.x, fromY = e.y;
              for (let hop = 0; hop < proj.chainHops; hop++) {
                let nearest = null, nearestD2 = CHAIN_RADIUS * CHAIN_RADIUS;
                for (const cand of this.enemies) {
                  if (chained.has(cand)) continue;
                  const d2 = dist2(fromX, fromY, cand.x, cand.y);
                  if (d2 <= nearestD2) { nearest = cand; nearestD2 = d2; }
                }
                if (!nearest) break;
                nearest.hp -= proj.damage * CHAIN_DAMAGE_PCT;
                nearest.hitFlash = 0.12;
                if (proj.slowDuration > 0) nearest.slowTimer = Math.max(nearest.slowTimer, proj.slowDuration);
                this.chainZaps.push(new ChainZap(fromX, fromY, nearest.x, nearest.y));
                chained.add(nearest);
                fromX = nearest.x; fromY = nearest.y;
              }
            }

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

      // chain zaps
      for (const zap of this.chainZaps) zap.life -= dt;
      this.chainZaps = this.chainZaps.filter(zap => zap.life > 0);

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
      difficultyEl.textContent = `難易度${this.difficulty}`;
      // Live view of the same window the difficulty checkpoint judges -
      // shows "--" until at least one enemy has spawned in the current
      // window, since dividing by zero spawns has no meaningful rate yet.
      const spawnedThisWindow = this.totalSpawned - this.spawnedAtCheckpoint;
      const killsThisWindow = this.kills - this.killsAtCheckpoint;
      killRateEl.textContent = spawnedThisWindow > 0
        ? `撃破率 ${Math.round((killsThisWindow / spawnedThisWindow) * 100)}%`
        : '撃破率 --';
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

      // chain zaps
      for (const zap of this.chainZaps) {
        ctx.globalAlpha = clamp(zap.life / zap.maxLife, 0, 1);
        ctx.strokeStyle = '#7ec8ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(zap.x1 + offX, zap.y1 + offY);
        ctx.lineTo(zap.x2 + offX, zap.y2 + offY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // enemies
      for (const e of this.enemies) {
        const sx = e.x + offX, sy = e.y + offY;
        if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
        ctx.beginPath();
        ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : (e.slowTimer > 0 ? '#7ec8ff' : e.color);
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
  let selectedCharacter = null;
  let selectedWeapon = null;

  function updateConfirmState() {
    confirmCharacterBtn.disabled = !(selectedCharacter && selectedWeapon);
  }

  // Shared by both the character and weapon groups: renders `roster` as
  // cards into `containerEl`, wiring each card to set `onPick(entry)` and
  // toggle its own "selected" highlight when tapped.
  function renderSelectCards(containerEl, roster, onPick) {
    containerEl.innerHTML = '';
    for (const entry of roster) {
      const card = document.createElement('div');
      card.className = 'upgrade-card character-card';
      card.innerHTML = `<div class="u-title">${entry.name}</div><div class="u-desc">${entry.desc}</div>`;
      card.addEventListener('click', () => {
        onPick(entry);
        for (const el of containerEl.children) el.classList.remove('selected');
        card.classList.add('selected');
        updateConfirmState();
      });
      containerEl.appendChild(card);
    }
  }

  function showCharacterSelect() {
    startScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    selectedCharacter = null;
    selectedWeapon = null;
    updateConfirmState();
    renderSelectCards(characterChoicesEl, CHARACTERS, (ch) => { selectedCharacter = ch; });
    renderSelectCards(weaponChoicesEl, WEAPONS, (w) => { selectedWeapon = w; });
    characterSelectScreen.classList.remove('hidden');
  }

  function startGame(character, weapon) {
    game = new Game(character || CHARACTERS[0], weapon || WEAPONS[0]);
    paused = false;
    lastTime = 0;
    characterSelectScreen.classList.add('hidden');
    startScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    levelupScreen.classList.add('hidden');
    resumeHint.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    pauseBtn.textContent = 'II';
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  startBtn.addEventListener('click', showCharacterSelect);
  restartBtn.addEventListener('click', showCharacterSelect);
  confirmCharacterBtn.addEventListener('click', () => {
    if (!selectedCharacter || !selectedWeapon) return;
    startGame(selectedCharacter, selectedWeapon);
  });

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

  // Prevent page scroll/bounce on iOS while playing. Overlay screens (e.g.
  // the start-setup screen) can legitimately need to scroll internally on
  // short viewports, so this only blocks touches outside of them - a
  // blanket preventDefault here would silently block that scrolling too.
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest('.overlay')) return;
    e.preventDefault();
  }, { passive: false });

})();
