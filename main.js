(() => {
  'use strict';

  const GAME_VERSION = '1.21.0';
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

  // Double-tap: two touchdowns close together in both time and position
  // trigger the active character's special ability. This rides along the
  // same touchstart/mousedown that starts a drag, so the second tap both
  // activates the ability and immediately continues as a normal move.
  let lastTapTime = 0;
  let lastTapX = 0, lastTapY = 0;
  const DOUBLE_TAP_MAX_INTERVAL_MS = 350;
  const DOUBLE_TAP_MAX_DIST = 40;
  function checkDoubleTap(x, y) {
    const now = performance.now();
    const closeInTime = now - lastTapTime < DOUBLE_TAP_MAX_INTERVAL_MS;
    const closeInSpace = Math.hypot(x - lastTapX, y - lastTapY) < DOUBLE_TAP_MAX_DIST;
    if (closeInTime && closeInSpace) {
      if (game) game.tryActivateSpecial();
      lastTapTime = 0; // consume it, so a 3rd quick tap doesn't chain another activation
    } else {
      lastTapTime = now;
      lastTapX = x;
      lastTapY = y;
    }
  }

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
    checkDoubleTap(x, y);
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
  const comboIndicatorEl = document.getElementById('combo-indicator');
  const specialIndicatorEl = document.getElementById('special-indicator');
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
      desc: 'バランス型。今後HP・移動速度・リジェネ・回収範囲や特殊能力・パッシブが異なるキャラクターが追加されます。',
      apply: (p) => {},
      // Double-tap special: a comeback tool for the classic "surrounded by
      // enemies I can't kill, can't reach gems, can't level up" death
      // spiral. The bomb alone would just leave the player back in the same
      // spot moments later, so it's paired with a gem-vacuum window that
      // turns the cleared enemies' drops into an immediate level-up burst.
      special: {
        name: 'エマージェンシーボム',
        desc: 'その場にいる敵を強制撃破し、10秒間ジェム回収範囲が全画面・獲得XPが1.5倍になる(クールタイム120秒)',
        cooldown: 120,
        activate(p, game) {
          for (const e of game.enemies) { e.hp = 0; e.forceKilled = true; }
          p.specialBuffTimer = 10;
        },
      },
      // Passive: always-on, no activation needed (unlike the special
      // above). Raises the "skip a level-up" refund from the base 30% to
      // 60%, making Standard's skip a much more genuine alternative to
      // taking a mediocre upgrade instead of a near-total loss.
      passive: {
        name: '倹約家',
        desc: 'レベルアップの「スキップ」時に払い戻されるXPが60%になる(通常30%)',
        apply(p) { p.skipRefundPct = 0.6; },
      },
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
  const XP_NEXT_CAP = 3000;
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
      this.interceptLevel = 0;

      // Combo: consecutive hits on the SAME enemy ramp up damage, resetting
      // if the target changes or too long passes between hits. Rewards
      // sustained single-target focus (attack speed/damage synergy), which
      // multishot tends to work against since it usually spreads shots
      // across different enemies in a swarm.
      this.comboLevel = 0;
      this.comboTarget = null;
      this.comboCount = 0;
      this.comboResetTimer = 0;

      // Double-tap special ability, defined per character (§ CHARACTERS).
      // null until a character with one is applied below.
      this.special = null;
      this.specialCooldownRemaining = 0;
      this.specialBuffTimer = 0;

      // Passive: an always-on per-character trait, defined per character
      // (§ CHARACTERS), as opposed to the double-tap-activated special
      // above. null until a character with one is applied below.
      this.passive = null;
      this.skipRefundPct = SKIP_REFUND_PCT_BASE;

      if (character) character.apply(this);
      if (weapon) weapon.apply(this);
      if (character && character.special) {
        this.special = character.special;
        // Start on cooldown rather than immediately usable, so the
        // ability reads as an earned comeback tool, not a free opener.
        this.specialCooldownRemaining = this.special.cooldown;
      }
      if (character && character.passive) {
        this.passive = character.passive;
        this.passive.apply(this);
      }
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
    grunt:  { hp: 18,  speed: 78,  radius: 13, color: '#ff5a5a', dmg: 8,  xp: 3,  score: 1 },
    fast:   { hp: 10,  speed: 140, radius: 10, color: '#ffd23a', dmg: 6,  xp: 4,  score: 1 },
    tank:   { hp: 70,  speed: 48,  radius: 20, color: '#a15aff', dmg: 14, xp: 10, score: 2 },
    // Deliberately huge single-target HP pool: a pure multishot build
    // spreads its damage across many enemies and struggles to burn this
    // down alone, so surviving bosses well pushes toward also investing in
    // single-target-friendly upgrades (combo, raw damage, explosion/chain).
    boss:   { hp: 500, speed: 35,  radius: 32, color: '#c81e3a', dmg: 20, xp: 50, score: 5 },
  };

  // Bosses don't roll into the normal per-spawn type dice - they arrive on
  // their own clock once difficulty is high enough, as a rare, singular
  // event rather than blending into the regular swarm composition.
  const BOSS_MIN_DIFFICULTY = 8;
  const BOSS_SPAWN_INTERVAL = 90;

  // Player stat values at game start, used as the "no upgrades taken" yardstick
  // for the build-aware difficulty scaling below.
  const BASELINE_STATS = { damage: 10, atkCooldown: 0.7, projCount: 1, pierce: 0, maxHp: 100 };

  // How often (in seconds) the kill-rate rubber-band re-evaluates difficulty.
  // Shortened from 60s to let a well-performing run's natural difficulty
  // climb move a bit faster, now that the XP curve (v1.9.0) caps out and
  // stops slowing leveling down at high player levels.
  const DIFFICULTY_CHECK_INTERVAL = 50;

  // These three convert "how far past baseline has the player pushed this
  // stat" into a multiplier (1 = no upgrades in that direction yet). Difficulty
  // scaling only kicks in on an axis once the player has actually invested in
  // the matching upgrades, so e.g. skipping damage/attack-speed the whole run
  // keeps enemy HP on the slow time-based curve instead of also compounding
  // with a build that never got stronger.
  function offensePowerMult(p) {
    const base = (p.damage / BASELINE_STATS.damage) * (BASELINE_STATS.atkCooldown / p.atkCooldown);
    // Explosion is effectively bonus AoE damage, so it counts toward
    // offense power the same way raw damage/attack-speed does.
    return base * (1 + p.explosionLevel * 0.15);
  }
  function crowdPowerMult(p) {
    const base = 1 + Math.max(0, p.projCount - BASELINE_STATS.projCount) * 0.18 + p.pierce * 0.15;
    // Chain is effectively "hit more enemies per shot", the same crowd-
    // clearing role multishot/pierce play, so it feeds the same multiplier.
    return base * (1 + p.chainLevel * 0.15);
  }
  function survivalPowerMult(p) {
    // Max HP's own contribution is dampened (only half the overshoot
    // counts) - at full weight, stacking HP mostly just fed back into
    // harder-hitting enemies and cancelled out its own survivability gain.
    // Slow/intercept count at full weight since they reduce how often the
    // player actually gets hit at all, not just how tanky a hit is.
    const hpExtra = Math.max(0, p.maxHp / BASELINE_STATS.maxHp - 1) * 0.5;
    const base = 1 + hpExtra;
    return base * (1 + p.slowLevel * 0.15) * (1 + p.interceptLevel * 0.15);
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
      // Set by the emergency-bomb special so its mass-kill burst is exempt
      // from GEM_CAP below - the whole point of that ability is stockpiling
      // gems for one big level-up burst, which the cap would otherwise gut.
      this.forceKilled = false;
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

  const GEM_LIFESPAN = 60; // seconds before an uncollected gem despawns
  // Hard ceiling on gems simultaneously alive on screen. Late-run crowd
  // builds kill fast enough that, combined with GEM_LIFESPAN, the field can
  // otherwise get carpeted in gems well before any of them expire. Bomb
  // kills (forceKilled) are exempt - the ability's whole point is banking a
  // pile of gems for one big burst, which this cap would otherwise defeat.
  const GEM_CAP = 60;
  // Gem drops are probabilistic rather than guaranteed: a kill has a
  // BASE_GEM_DROP_CHANCE chance of dropping a gem at all, worth GEM_VALUE_MULT
  // times the enemy's xpValue when it does. Chosen so a build that never
  // pushes crowdExtra above 0 sees the same expected XP/kill as the old
  // always-drop-at-face-value scheme (0.5 x 2 = 1x).
  const BASE_GEM_DROP_CHANCE = 0.5;
  const GEM_VALUE_MULT = 2;

  class Gem {
    constructor(x, y, value) {
      this.x = x; this.y = y;
      this.value = value;
      this.radius = 5;
      this.vx = 0; this.vy = 0;
      this.life = GEM_LIFESPAN;
    }
  }

  class Particle {
    constructor(x, y, color, sizeMult) {
      this.x = x; this.y = y;
      const ang = rand(0, TAU);
      const spd = rand(40, 140);
      this.vx = Math.cos(ang) * spd;
      this.vy = Math.sin(ang) * spd;
      this.life = rand(0.25, 0.5);
      this.maxLife = this.life;
      this.color = color;
      this.radius = rand(2, 4) * (sizeMult || 1);
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
    { id: 'atkspeed', title: '攻撃速度アップ', desc: '攻撃間隔 -20%', apply: p => p.atkCooldown = Math.max(0.15, p.atkCooldown * 0.8) },
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
      desc: '攻撃間隔 -31%(発射速度アップ) / ダメージ -20%',
      apply: p => {
        p.atkCooldown = Math.max(STAT_LIMITS.minAtkCooldown, p.atkCooldown / 1.45);
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
  const EXPLOSION_DAMAGE_PCT = 0.8;
  const CHAIN_DAMAGE_PCT = 0.3;
  const CHAIN_RADIUS = 150;
  const SLOW_MULT = 0.5;
  const SLOWED_DMG_MULT = 0.5; // a slowed enemy's contact damage is also halved
  function explosionRadiusForLevel(level) { return 50 + 20 * (level - 1); }
  function slowDurationForLevel(level) { return 1.0 + 0.5 * (level - 1); }

  // Intercept: a passive aura around the player, independent of any bullet
  // hit, that slows enemies which get too close. Level raises how many
  // enemies it can affect at once (nearest-first); its duration piggybacks
  // on the slow bullet effect's rank if the player has it (same scaling),
  // else falls back to a short base duration that's really just meant to
  // survive one frame - it re-applies continuously while an enemy stays
  // within range anyway.
  const INTERCEPT_RADIUS = 60;
  const INTERCEPT_BASE_DURATION = 0.4;
  function interceptDuration(p) { return p.slowLevel > 0 ? slowDurationForLevel(p.slowLevel) : INTERCEPT_BASE_DURATION; }
  function interceptTargetCount(level) { return level; }

  const COMBO_PER_STACK_BONUS = 0.08;
  const COMBO_RESET_WINDOW = 1.5; // seconds since the last hit on the same target
  function comboMaxStacks(level) { return level * 4; }

  const BULLET_EFFECTS = [
    {
      id: 'combo',
      name: '連撃',
      maxLevel: 5,
      getLevel: p => p.comboLevel,
      levelUp: p => { p.comboLevel++; },
      introDesc: '同じ敵に連続ヒットさせるほどダメージが上昇するようになる',
      upgradeDesc: level => `連撃の上限段数が増加する(+${Math.round(comboMaxStacks(level) * COMBO_PER_STACK_BONUS * 100)}% → +${Math.round(comboMaxStacks(level + 1) * COMBO_PER_STACK_BONUS * 100)}%)`,
    },
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
      id: 'intercept',
      name: '迎撃',
      maxLevel: 5,
      getLevel: p => p.interceptLevel,
      levelUp: p => { p.interceptLevel++; },
      introDesc: '自機のごく至近距離に入った敵を自動で低速化するようになる(低速を取得済みならその減速時間がそのまま適用される)',
      upgradeDesc: level => `迎撃で同時に低速化できる敵の数が増加する(${interceptTargetCount(level)}体 → ${interceptTargetCount(level + 1)}体)`,
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

  // Slots 2-3 of a level-up draw from the full pool but at reduced odds for
  // bullet effects specifically - slot 1 already exists to funnel players
  // toward bullet effects (either deepening one they own, or a normal draw
  // when they own none yet), so without this the other two slots would
  // double up on that same bias instead of mostly offering plain/tradeoff
  // variety.
  const BULLET_EFFECT_SLOT_WEIGHT = 0.4;
  function pickWeightedIndex(pool) {
    const weights = pool.map(up => up.id.startsWith('bullet-') ? BULLET_EFFECT_SLOT_WEIGHT : 1);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return pool.length - 1;
  }

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
  // progress toward the next level instead of leaving XP near empty. The
  // refund percentage is per-player (p.skipRefundPct) rather than a fixed
  // 30%, so a character passive can raise it - hence desc is a function of
  // the current player instead of a static string.
  const SKIP_REFUND_PCT_BASE = 0.3;
  const SKIP_UPGRADE = {
    id: 'skip',
    title: 'スキップ',
    desc: p => `強化なし。次のレベルアップまでのXPを${Math.round(p.skipRefundPct * 100)}%獲得した状態にする`,
    apply: p => { p.xp = p.xpNext * p.skipRefundPct; },
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
      // elapsed time. Every DIFFICULTY_CHECK_INTERVAL seconds it is
      // re-evaluated against how much of the last window's spawns actually
      // got killed, so a player who is falling behind gets the ramp held
      // (or walked back) instead of ratcheting up regardless of how the
      // fight is actually going.
      this.difficulty = 1;
      this.levelCheckTimer = DIFFICULTY_CHECK_INTERVAL;
      this.totalSpawned = 0;
      this.spawnedAtCheckpoint = 0;
      this.killsAtCheckpoint = 0;

      this.bossSpawnTimer = BOSS_SPAWN_INTERVAL;
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
        const idx = pickWeightedIndex(remainingPool);
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
      skipCard.innerHTML = `<div class="u-title">${SKIP_UPGRADE.title}</div><div class="u-desc">${SKIP_UPGRADE.desc(this.player)}</div>`;
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

    tryActivateSpecial() {
      if (this.over || this.levelingUp || this.awaitingResume || paused) return;
      const p = this.player;
      if (!p.special || p.specialCooldownRemaining > 0 || p.specialBuffTimer > 0) return;
      // Cooldown doesn't start here - it starts once the buff itself runs
      // out (see update()), so the full cycle is buff duration + cooldown
      // back to back, not the two running in parallel.
      p.special.activate(p, this);
    }

    onPlayerDeath() {
      this.over = true;
      const mm = String(Math.floor(this.time / 60)).padStart(2, '0');
      const ss = String(Math.floor(this.time % 60)).padStart(2, '0');
      finalStatsEl.innerHTML = `生存時間: ${mm}:${ss}<br>撃破数: ${this.kills}<br>到達レベル: ${this.player.level}`;
      gameoverScreen.classList.remove('hidden');
      pauseBtn.classList.add('hidden');
    }

    spawnEnemy(forceType) {
      const p = this.player;
      const angle = rand(0, TAU);
      const spawnDist = Math.max(W, H) * 0.65 + 60;
      const x = p.x + Math.cos(angle) * spawnDist;
      const y = p.y + Math.sin(angle) * spawnDist;
      const D = this.difficulty;
      this.totalSpawned++;

      let type = forceType || 'grunt';
      if (!forceType) {
        const r = Math.random();
        if (D >= 5 && r < 0.22) type = 'tank';
        else if (D >= 2 && r < 0.5) type = 'fast';
      }

      // Stepped time-based baseline, plus a build-aware top-up: enemy HP
      // tracks how much dps the player has stacked (damage x attack speed)
      // beyond the starting weapon, and enemy contact damage tracks how
      // tanky the player has made themselves via max HP. A run that skips
      // those upgrades never sees the extra factor kick in, so it stays on
      // the tier baseline instead of getting hard-countered by a stat the
      // player never invested in. The offense coefficient is kept low
      // (0.25) on purpose - upgrading damage/attack speed should mostly
      // just feel stronger, not get mostly cancelled out by tougher enemies.
      const tierHpMult = 1 + (D - 1) * 0.14;
      const offenseExtra = Math.max(0, offensePowerMult(p) - 1);
      const hpMult = tierHpMult * (1 + offenseExtra * 0.25);

      const tierDmgMult = 1 + (D - 1) * 0.11;
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

      // Kill-rate rubber-band, checked once per DIFFICULTY_CHECK_INTERVAL
      // window: a single discrete "difficulty" tier replaced the old
      // continuous time-based curves so difficulty reads as legible steps.
      // This is the step rule - normally +1 per window, but if the player
      // killed 70% or less of what spawned last window the tier holds
      // instead of advancing, and at 50% or less it steps back down
      // (never below 1).
      this.levelCheckTimer -= dt;
      if (this.levelCheckTimer <= 0) {
        this.levelCheckTimer += DIFFICULTY_CHECK_INTERVAL;
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
      // Cooldown only ticks once the buff itself has fully ended, so a run
      // is buff-duration-then-cooldown back to back rather than the two
      // counting down at the same time.
      if (p.specialBuffTimer > 0) {
        p.specialBuffTimer -= dt;
        if (p.specialBuffTimer <= 0 && p.special) p.specialCooldownRemaining = p.special.cooldown;
      } else if (p.specialCooldownRemaining > 0) {
        p.specialCooldownRemaining -= dt;
      }
      if (p.comboResetTimer > 0) p.comboResetTimer -= dt;

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

      // Boss: a periodic, singular arrival rather than a dice roll mixed
      // into the regular spawn burst above, once difficulty is high enough.
      this.bossSpawnTimer -= dt;
      if (this.bossSpawnTimer <= 0) {
        this.bossSpawnTimer = BOSS_SPAWN_INTERVAL;
        if (D >= BOSS_MIN_DIFFICULTY) this.spawnEnemy('boss');
      }

      this.fireWeapon(dt);

      // Intercept: slow whatever wanders inside the tiny aura radius,
      // regardless of whether any shot has actually hit it. Capped to the
      // nearest N enemies (N = intercept level) so a full swarm doesn't get
      // slowed for free - only the immediate threats pressing right up
      // against the player do.
      if (p.interceptLevel > 0) {
        const nearby = this.enemies
          .filter(e => dist2(e.x, e.y, p.x, p.y) <= INTERCEPT_RADIUS * INTERCEPT_RADIUS)
          .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y));
        const duration = interceptDuration(p);
        const maxTargets = interceptTargetCount(p.interceptLevel);
        for (let i = 0; i < Math.min(maxTargets, nearby.length); i++) {
          const e = nearby[i];
          // Only flash on the newly-caught transition (slowTimer was at 0),
          // not every single frame it continues to sit in range - otherwise
          // the line would just be permanently on-screen instead of reading
          // as a "zap" the way chain's does.
          if (e.slowTimer <= 0) this.chainZaps.push(new ChainZap(p.x, p.y, e.x, e.y));
          e.slowTimer = Math.max(e.slowTimer, duration);
        }
      }

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
          // Slowed enemies also hit softer - the status should meaningfully
          // blunt an enemy, not just its approach speed.
          const dmg = e.slowTimer > 0 ? e.dmg * SLOWED_DMG_MULT : e.dmg;
          p.takeDamage(dmg);
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
            let hitDamage = proj.damage;
            if (p.comboLevel > 0) {
              // A hit on a different target (or one that arrives after the
              // reset window has lapsed) starts a fresh combo instead of
              // continuing the old one.
              if (p.comboTarget !== e || p.comboResetTimer <= 0) p.comboCount = 0;
              const maxStacks = comboMaxStacks(p.comboLevel);
              hitDamage = proj.damage * (1 + Math.min(p.comboCount, maxStacks) * COMBO_PER_STACK_BONUS);
              p.comboTarget = e;
              p.comboCount += 1;
              p.comboResetTimer = COMBO_RESET_WINDOW;
            }
            e.hp -= hitDamage;
            e.hitFlash = 0.12;
            proj.hitSet.add(e);
            if (proj.slowDuration > 0) e.slowTimer = Math.max(e.slowTimer, proj.slowDuration);

            if (proj.explosionRadius > 0) {
              for (const other of this.enemies) {
                if (other === e) continue;
                if (dist(other.x, other.y, e.x, e.y) <= proj.explosionRadius) {
                  other.hp -= proj.damage * EXPLOSION_DAMAGE_PCT;
                  other.hitFlash = 0.12;
                  for (let i = 0; i < 8; i++) this.particles.push(new Particle(e.x, e.y, '#ff4500', 2.5));
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

                // Chain's role is spreading damage/status to more targets,
                // not diminishing whatever it spreads - so if explosion is
                // also equipped, each chained hit detonates its own
                // explosion too, using the player's full attack power
                // (proj.damage) rather than chain's own reduced damage.
                if (proj.explosionRadius > 0) {
                  for (const other of this.enemies) {
                    if (other === nearest || chained.has(other)) continue;
                    if (dist(other.x, other.y, nearest.x, nearest.y) <= proj.explosionRadius) {
                      other.hp -= proj.damage * EXPLOSION_DAMAGE_PCT;
                      other.hitFlash = 0.12;
                      for (let i = 0; i < 8; i++) this.particles.push(new Particle(nearest.x, nearest.y, '#ff4500', 2.5));
                    }
                  }
                }

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
      // Gems are no longer a guaranteed drop: a kill has a chance to drop
      // one at all, rather than every kill dropping a smaller and smaller
      // gem. At baseline (crowdExtra=0) this averages out to the same
      // expected XP/kill as the old always-drop scheme (BASE_GEM_DROP_CHANCE
      // 0.5 x GEM_VALUE_MULT 2 = 1x). A crowd-clearing build (multishot/
      // pierce/chain) pushes crowdExtra up, which further lowers the drop
      // chance below that baseline - without this, clearing bigger swarms
      // would feed back into leveling faster, which spawns even bigger
      // swarms, and so on. Unlike the old per-gem value dampening, this
      // also directly cuts down how many gem entities pile up on screen in
      // the first place.
      const gemDropChance = Math.min(1, BASE_GEM_DROP_CHANCE / (1 + crowdExtra));
      this.enemies = this.enemies.filter(e => {
        if (e.hp <= 0) {
          this.kills++;
          // The emergency bomb's forced kills always drop, uncapped and at
          // full chance - the ability's whole point is a guaranteed gem
          // burst, not one gated behind the same odds as a normal kill.
          const drops = e.forceKilled || Math.random() < gemDropChance;
          if (drops && (e.forceKilled || this.gems.length < GEM_CAP)) {
            this.gems.push(new Gem(e.x, e.y, Math.round(e.xpValue * GEM_VALUE_MULT)));
          }
          for (let i = 0; i < 6; i++) this.particles.push(new Particle(e.x, e.y, e.color));
          return false;
        }
        return true;
      });

      this.projectiles = this.projectiles.filter(pr => pr.life > 0);

      // gems: attract + collect
      const effectivePickupRadius = p.specialBuffTimer > 0 ? Infinity : p.pickupRadius;
      // Gems collected during the vacuum buff are worth extra, so stockpiling
      // XP and popping the ability pays off more than using it on cooldown.
      const buffXpMult = p.specialBuffTimer > 0 ? 1.5 : 1;
      for (const g of this.gems) {
        const d = dist(g.x, g.y, p.x, p.y);
        if (d < effectivePickupRadius) {
          const pull = 500;
          g.x += (p.x - g.x) / Math.max(d, 1) * pull * dt;
          g.y += (p.y - g.y) / Math.max(d, 1) * pull * dt;
        }
        g.life -= dt;
      }
      this.gems = this.gems.filter(g => {
        if (dist(g.x, g.y, p.x, p.y) < p.radius + g.radius) {
          p.gainXp(g.value * buffXpMult);
          return false;
        }
        // Uncollected gems despawn after GEM_LIFESPAN so a high-difficulty
        // run's kill volume doesn't leave the screen carpeted in gems.
        return g.life > 0;
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

      const comboActive = p.comboLevel > 0 && p.comboResetTimer > 0 && p.comboCount > 1;
      comboIndicatorEl.classList.toggle('hidden', !comboActive);
      if (comboActive) {
        const maxStacks = comboMaxStacks(p.comboLevel);
        const bonusPct = Math.round(Math.min(p.comboCount - 1, maxStacks) * COMBO_PER_STACK_BONUS * 100);
        comboIndicatorEl.textContent = `連撃 x${p.comboCount} (+${bonusPct}%)`;
      }

      const mm = String(Math.floor(this.time / 60)).padStart(2, '0');
      const ss = String(Math.floor(this.time % 60)).padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;

      if (!p.special) {
        specialIndicatorEl.classList.add('hidden');
      } else {
        specialIndicatorEl.classList.remove('hidden');
        const buffActive = p.specialBuffTimer > 0;
        const ready = !buffActive && p.specialCooldownRemaining <= 0;
        specialIndicatorEl.classList.toggle('ready', ready);
        specialIndicatorEl.classList.toggle('buff-active', buffActive);
        if (buffActive) {
          specialIndicatorEl.textContent = `${p.special.name}バフ有効中 ${Math.ceil(p.specialBuffTimer)}秒`;
        } else if (ready) {
          specialIndicatorEl.textContent = `${p.special.name} 準備完了(ダブルタップ)`;
        } else {
          specialIndicatorEl.textContent = `${p.special.name} ${Math.ceil(p.specialCooldownRemaining)}s`;
        }
      }
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

      // particles - drawn above enemies so death/explosion bursts read
      // clearly instead of being hidden underneath enemy graphics
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
      const passiveLine = entry.passive ? `<div class="u-desc">パッシブ「${entry.passive.name}」: ${entry.passive.desc}</div>` : '';
      card.innerHTML = `<div class="u-title">${entry.name}</div><div class="u-desc">${entry.desc}</div>${passiveLine}`;
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
