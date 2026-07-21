(() => {
  'use strict';

  const GAME_VERSION = '1.36.5';
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
  const specialIndicatorEl = document.getElementById('special-indicator');
  const rushAlertEl = document.getElementById('rush-alert');
  const killsEl = document.getElementById('kills');
  const startScreen = document.getElementById('start-screen');
  const characterSelectScreen = document.getElementById('character-select-screen');
  const characterChoicesEl = document.getElementById('character-choices');
  const weaponChoicesEl = document.getElementById('weapon-choices');
  const confirmCharacterBtn = document.getElementById('confirm-character-btn');
  const levelupScreen = document.getElementById('levelup-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const upgradeChoicesEl = document.getElementById('upgrade-choices');
  const finalStatsEl = document.getElementById('final-stats');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const pauseScreen = document.getElementById('pause-screen');
  const pauseStatsEl = document.getElementById('pause-stats');
  const resumeBtn = document.getElementById('resume-btn');
  const backToTitleBtn = document.getElementById('back-to-title-btn');

  // Two independent rosters, picked separately before a run:
  // - CHARACTERS differentiate on survivability/utility stats (HP, move
  //   speed, regen, pickup range) and, later, on double-tap special
  //   abilities/passives.
  // - WEAPONS differentiate on offense stats (damage, fire rate, pierce)
  //   and each carries its own weapon-innate effect (see WEAPON_INNATE_*
  //   below) - standard's is multishot.
  // Multiple CHARACTERS entries exist now; WEAPONS still has only the one
  // placeholder. New options slot in by adding array entries, each with an
  // `apply(player)` that tweaks starting stats.
  // Tank's reflect passive scales off two of the player's own stats rather
  // than a fixed number, so investing in either raw damage or (fittingly,
  // for a tank) max HP both feed back into how hard the counter hits.
  const REFLECT_DMG_PCT_OF_ATTACK = 0.3;
  const REFLECT_DMG_PCT_OF_MAXHP = 0.08;

  const CHARACTERS = [
    {
      id: 'standard',
      name: 'スタンダード',
      desc: 'バランス型。レベルアップしやすく扱いやすい初心者向けタイプ。パッシブでいろいろなビルドを試しやすい。',
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
        buffPickupRadiusMult: Infinity,
        buffXpMult: 1.5,
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
    {
      id: 'tank',
      name: 'タンク',
      desc: '最大HPが高く、移動速度は低いタフ型。被弾しても反撃パッシブで攻撃してきた敵にダメージを返せる。',
      apply: (p) => {
        p.maxHp = 180;
        p.hp = p.maxHp;
        p.speedMult *= 0.7;
      },
      // Special: a burst of survivability rather than raw offense - heals
      // a big chunk back and grants a temporary mobility window to
      // reposition/collect gems (and keep landing the reflect passive
      // below) instead of just tanking hits in place. Short cooldown
      // relative to Standard's bomb since it's a sustain tool, not a
      // one-shot-clears-the-screen panic button.
      special: {
        name: 'リカバリーダッシュ',
        desc: '最大HPの50%を回復し、20秒間移動速度が50%アップする(クールタイム60秒)',
        cooldown: 60,
        buffSpeedMult: 1.5,
        activate(p, game) {
          p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5);
          p.specialBuffTimer = 20;
        },
      },
      // Passive: always-on counterattack. Scales with both attack power
      // and max HP, so it pays off whether the build goes offense-heavy
      // or leans into Tank's naturally high HP pool even further.
      passive: {
        name: '鉄の反撃',
        desc: `被ダメージ時、攻撃してきた敵に反射ダメージを与える(攻撃力の${Math.round(REFLECT_DMG_PCT_OF_ATTACK * 100)}% + 最大HPの${Math.round(REFLECT_DMG_PCT_OF_MAXHP * 100)}%)`,
        apply(p) {},
        onContactDamage(p, enemy, game) {
          const reflect = Math.round(p.damage * REFLECT_DMG_PCT_OF_ATTACK + p.maxHp * REFLECT_DMG_PCT_OF_MAXHP);
          enemy.hp -= reflect;
          enemy.hitFlash = 0.12;
        },
      },
    },
    {
      id: 'speed',
      name: 'スピード',
      desc: '最大HPが低く、移動速度が速い機動型。攻撃速度2倍・攻撃力半減のパッシブを持つ、操作難易度が高い上級者向け。',
      apply: (p) => {
        p.maxHp = 70;
        p.hp = p.maxHp;
        p.speedMult *= 1.35;
      },
      // Special: short cooldown relative to its own duration (10s buff /
      // 10s cooldown, back-to-back = a 20s cycle), so a player who lands
      // it on cooldown spends roughly half the run buffed - rewarding
      // active, attentive play over Standard's rarer, more deliberate bomb.
      special: {
        name: 'オーバードライブ',
        desc: '10秒間、攻撃力が50%アップ・ジェム回収範囲が3倍になる(クールタイム10秒)',
        cooldown: 10,
        buffDamageMult: 1.5,
        buffPickupRadiusMult: 3,
        activate(p, game) {
          p.specialBuffTimer = 10;
        },
      },
      // Passive: always-on glass-cannon weapon trait. Total DPS at
      // baseline is unchanged (half damage x double attack rate), but it
      // shifts the weapon toward synergizing with per-hit-count effects
      // (chain's proc chance) rather than raw per-hit power.
      passive: {
        name: '高速連射',
        desc: '武器の攻撃間隔が半分(攻撃速度2倍)になる代わりに、攻撃力が半分になる',
        apply(p) {
          p.atkCooldown = Math.max(STAT_LIMITS.minAtkCooldown, p.atkCooldown * 0.5);
          p.damage = Math.max(STAT_LIMITS.minDamage, Math.round(p.damage * 0.5));
        },
      },
    },
  ];

  // Weapon-innate effect: an effect baked into the weapon itself, distinct
  // per weapon, rather than a level-up pool pick - it can't be skipped or
  // missed, and doesn't compete against real choices for a slot. Ranks up
  // automatically as the player levels rather than being chosen. Multishot
  // moved here (off of BULLET_EFFECTS) because it had become a de facto
  // mandatory pick in practically every run; an "upgrade" nobody actually
  // skips isn't really offering a choice. Other weapons are each expected
  // to get their own distinct innate effect instead of also getting
  // multishot.
  const WEAPON_INNATE_MAX_RANK = 5;
  const WEAPON_INNATE_LEVELS_PER_RANK = 3;
  function weaponInnateRankForLevel(level) {
    return Math.min(WEAPON_INNATE_MAX_RANK, Math.floor((level - 1) / WEAPON_INNATE_LEVELS_PER_RANK) + 1);
  }

  const WEAPONS = [
    {
      id: 'standard',
      name: 'スタンダード',
      desc: '標準武器。今後ダメージ・発射速度・貫通などが異なる武器が追加されます。',
      apply: (p) => {},
      innateEffect: {
        name: 'マルチショット',
        desc: `自機レベルアップ${WEAPON_INNATE_LEVELS_PER_RANK}ごとにランクが上昇(最大Lv.${WEAPON_INNATE_MAX_RANK})し、同時発射数がランクと同じ数になる`,
        applyRank(p, rank) { p.projCount = rank; },
      },
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

  // Grace-period invulnerability granted when control returns to the
  // player after a level-up pick or unpausing (see pickUpgrade() and the
  // pause button handler). Replaces the old "tap the screen to resume"
  // gate: that gate could leave an enemy already at point-blank range by
  // the time the player was allowed to act again, with no way to have
  // dodged it in the meantime. A brief window of the same invulnerability
  // already used for normal post-hit i-frames gives a fair chance to
  // reposition instead.
  const RESUME_INVULN_DURATION = 1.0;

  // ---------- Entity classes ----------
  class Player {
    constructor(character, weapon) {
      this.x = 0;
      this.y = 0;
      this.radius = 16;
      // Raised from 190 (v1.35.0) to fold in roughly what one move-speed
      // upgrade pick used to add, now that the upgrade itself is gone.
      this.baseSpeed = 210;
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
      // Raised from 70 (v1.35.0) to fold in exactly what one pickup-range
      // upgrade pick used to add, now that the upgrade itself is gone.
      this.pickupRadius = 100;
      this.regen = 0;
      // Multiplier on the weapon's firing range (see weaponRange() below).
      // 1 = the default screen-relative range; left open for a future
      // range upgrade to multiply.
      this.rangeMult = 1;

      // Bullet effects: 0 means not yet acquired. First pick sets it to 1
      // (activates the effect); further picks raise the level (stronger
      // effect) up to BULLET_EFFECTS' maxLevel, after which the upgrade
      // stops appearing as a choice. Pierce reuses the existing `pierce`
      // count directly as its level instead of a separate field.
      this.explosionLevel = 0;
      this.chainLevel = 0;
      this.slowLevel = 0;
      this.interceptLevel = 0;
      this.poisonLevel = 0;
      this.frenzyLevel = 0;
      // Named bombifyLevel (not "bomb") to avoid confusion with the
      // unrelated "emergency bomb" special ability (§ CHARACTERS).
      this.bombifyLevel = 0;

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

      // Weapon-innate effect (§ WEAPONS): kept reference so its rank can be
      // recomputed on every level-up, not just once at game start.
      this.weapon = weapon || null;

      if (character) character.apply(this);
      if (weapon) weapon.apply(this);
      this.applyWeaponInnateEffect();
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

    get speed() {
      // A special's timed buff can include a temporary move-speed
      // multiplier (e.g. tank's recovery dash) - declared on the special
      // itself (buffSpeedMult) rather than hardcoded here, since which
      // characters get a speed buff at all varies per character.
      const buffMult = this.specialBuffTimer > 0 && this.special && this.special.buffSpeedMult != null
        ? this.special.buffSpeedMult : 1;
      return this.baseSpeed * this.speedMult * buffMult;
    }

    takeDamage(amount) {
      if (this.invulnTimer > 0) return;
      this.hp -= amount;
      this.invulnTimer = 0.6;
      if (this.hp <= 0) { this.hp = 0; game.onPlayerDeath(); }
    }

    // Recomputes the current weapon's innate-effect rank from this.level
    // and re-applies it. Idempotent (applyRank sets an absolute value, not
    // an increment), so it's safe to call unconditionally on every level-up
    // rather than only when the rank actually changed.
    applyWeaponInnateEffect() {
      if (!this.weapon || !this.weapon.innateEffect) return;
      const rank = weaponInnateRankForLevel(this.level);
      this.weapon.innateEffect.applyRank(this, rank);
    }

    gainXp(amount) {
      this.xp += amount;
      while (this.xp >= this.xpNext) {
        this.xp -= this.xpNext;
        this.level++;
        this.xpNext = xpNextForLevel(this.level);
        this.applyWeaponInnateEffect();
        game.onLevelUp();
      }
    }
  }

  // Overall enemy spawn throughput multiplier: raises how often/how many
  // enemies spawn (see curInterval below) without changing the total HP
  // the player needs to burn through per second - individual enemy HP in
  // ENEMY_TYPES is scaled down by this same factor to compensate, and the
  // gem drop chance (BASE_GEM_DROP_CHANCE below) is divided by it too, so
  // total XP income per second doesn't just inflate for free alongside the
  // extra kills. Introduced after spawn density felt too sparse in some
  // sessions.
  const ENEMY_SPAWN_RATE_MULT = 1.5;

  // Absolute floor/ceiling on how many spawn EVENTS (not enemies - see
  // ENEMY_TYPES.burst) can fire per second, regardless of how the
  // difficulty/crowd-driven cadence below computes out. Without a
  // ceiling, tierInterval bottoming out at high difficulty while
  // ENEMY_SPAWN_RATE_MULT/crowdExtra keep pushing the rate up further
  // could reach spawn rates far beyond what's actually playable or even
  // visible; the floor is a safety net for the opposite direction should
  // future tuning ever push the raw cadence below it.
  const SPAWN_RATE_MIN = 1;
  const SPAWN_RATE_MAX = 5;

  // Once the raw spawn cadence (difficulty + crowd investment) wants to
  // exceed SPAWN_RATE_MAX, that excess no longer buys a faster spawn rate
  // - instead it buys tougher enemies, so crowd investment (pierce/chain
  // today, whatever gets added later) keeps having *some* cost even past
  // the point where it can't spawn more enemies per second any faster.
  // Scales with however far past the ceiling the raw rate would have
  // gone (e.g. raw rate at 2x the ceiling = 1.0 overflow = +30% HP), so a
  // future crowd-clear upgrade that pushes players past the ceiling even
  // sooner automatically taxes itself via this same knob, with no extra
  // tuning required per upgrade.
  const SPAWN_OVERFLOW_HP_COEFF = 0.3;

  // Hard ceiling on enemies simultaneously alive. Independent of the
  // spawn-rate cap above - even a bounded spawn rate can still pile up an
  // unbounded total if the player can't kill enemies as fast as they
  // arrive, so this is the backstop for that case.
  const MAX_ALIVE_ENEMIES = 120;

  // burst = how many of this type spawn together as a single identity
  // trait (e.g. fast enemies arrive in pairs), independent of difficulty/
  // crowd-build scaling - see the spawn-pacing block in update() below,
  // which now scales purely via how often a spawn event fires, not via
  // how many enemies each event produces.
  const ENEMY_TYPES = {
    // HP values are the pre-v1.28.0 baseline divided by ENEMY_SPAWN_RATE_MULT
    // (18/10/70/500 -> 12/7/47/333), rounded.
    grunt:  { hp: 12,  speed: 78,  radius: 13, color: '#ff5a5a', dmg: 8,  xp: 3,  score: 1, burst: 1 },
    fast:   { hp: 7,   speed: 140, radius: 10, color: '#ffd23a', dmg: 6,  xp: 4,  score: 1, burst: 2 },
    tank:   { hp: 47,  speed: 48,  radius: 20, color: '#a15aff', dmg: 14, xp: 10, score: 2, burst: 1 },
    // Deliberately huge single-target HP pool: a pure multishot build
    // spreads its damage across many enemies and struggles to burn this
    // down alone, so surviving bosses well pushes toward also investing in
    // single-target-friendly upgrades (raw damage, explosion/chain).
    boss:   { hp: 333, speed: 35,  radius: 32, color: '#c81e3a', dmg: 20, xp: 50, score: 5, burst: 1 },
  };

  // Bosses don't roll into the normal per-spawn type dice - they arrive on
  // their own clock once difficulty is high enough, as a rare, singular
  // event rather than blending into the regular swarm composition.
  const BOSS_MIN_DIFFICULTY = 8;
  const BOSS_SPAWN_INTERVAL = 90;

  // Rush: a reward event for sustained high performance. Clearing 90%+ of
  // a single 50s difficulty-check window's spawns triggers a short warning
  // countdown, then a burst of extra, tougher enemies deliberately exceeding
  // the normal spawn-rate ceiling (via burst count rather than event
  // frequency - see spawnEnemy() and §6-3's SPAWN_RATE_MAX), followed by an
  // instant HP heal + full gem collection as the payoff. MAX_ALIVE_ENEMIES
  // still applies during a rush - only the rate ceiling is deliberately
  // bypassed.
  const RUSH_KILL_RATE_THRESHOLD = 0.9;
  const RUSH_WARNING_DURATION = 10; // "ラッシュまであとN秒" countdown before it starts
  // Deliberately equal to DIFFICULTY_CHECK_INTERVAL - RUSH_WARNING_DURATION
  // (50 - 10 = 40): warning + active always spans exactly one full
  // difficulty-check window, so a rush's active phase reliably concludes on
  // the very tick the next window's kill-rate check runs (see update()) -
  // that's what lets the difficulty check treat "a rush just ended" as a
  // simple state check instead of racing two independent timers.
  const RUSH_DURATION = 40;
  const RUSH_BURST_MULT = 2; // multiplies ENEMY_TYPES burst, not spawn-event frequency
  const RUSH_SPEED_MULT = 1.2;
  const RUSH_HP_MULT = 1.5; // multiplies HP of enemies spawned during an active rush
  const RUSH_HEAL_FRAC = 0.5; // fraction of maxHp healed on rush end
  // Difficulty step size on the window a rush concludes in, in place of the
  // usual step, if that window's kill rate also cleared RUSH_KILL_RATE_THRESHOLD
  // (see DIFFICULTY_STEP_HIGH_KILL_RATE below, whose non-rush tier this sits
  // on top of) - clearing a rush cleanly earns the single biggest difficulty
  // jump in the game.
  const RUSH_DIFFICULTY_BONUS = 3;
  // Minimum difficulty-check windows (50s each) between two rush triggers.
  // Without this, a player clearing 90%+ every window gets a rush every
  // single window, which stops reading as a special event - see §6-6.
  const RUSH_WINDOW_COOLDOWN = 3;

  // Player stat values at game start, used as the "no upgrades taken" yardstick
  // for the build-aware difficulty scaling below.
  const BASELINE_STATS = { damage: 10, atkCooldown: 0.7, pierce: 0, maxHp: 100 };

  // How often (in seconds) the kill-rate rubber-band re-evaluates difficulty.
  // Shortened from 60s to let a well-performing run's natural difficulty
  // climb move a bit faster, now that the XP curve (v1.9.0) caps out and
  // stops slowing leveling down at high player levels.
  const DIFFICULTY_CHECK_INTERVAL = 50;

  // Kill-rate rubber-band step sizes for the two "extreme" tiers layered on
  // top of the original +-1/hold three-band system (see the cascade in
  // update()): coasting at RUSH_KILL_RATE_THRESHOLD (90%) or above jumps by
  // more than the normal +1 even outside a rush, and cratering to 30% or
  // below backs off by more than the normal -1 in a single window.
  const DIFFICULTY_STEP_HIGH_KILL_RATE = 2; // killRate >= RUSH_KILL_RATE_THRESHOLD, non-rush window
  const DIFFICULTY_STEP_LOW_KILL_RATE = 2; // killRate <= 0.3 (magnitude subtracted)

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
    // Multishot no longer counts here - it's now the standard weapon's
    // innate effect (auto-ranks with player level, see WEAPONS) rather
    // than a chosen upgrade, so it shouldn't feed into "you invested in
    // crowd-clearing power, so face a bigger crowd" scaling the way an
    // actual choice like pierce/chain does.
    const base = 1 + p.pierce * 0.15;
    // Chain is effectively "hit more enemies per shot", the same crowd-
    // clearing role pierce plays, so it feeds the same multiplier.
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

  // The weapon can only target enemies within this radius. Tied to the
  // current viewport (half the LARGER of W/H, the player being fixed at
  // screen center - see camera code) rather than a fixed pixel value, so
  // it scales sensibly across devices/orientations. Basing it on the
  // longer side (with a small deliberate overshoot) rather than the
  // shorter one keeps engagement range generous - a circle inscribed in
  // the shorter side alone would be needlessly short on wide/tall aspect
  // ratios. The tradeoff is that along the shorter axis, kills can now
  // happen slightly beyond that edge of the screen - acceptable since it's
  // only a modest amount, not the effectively-unbounded range from before
  // this whole range concept existed.
  const WEAPON_RANGE_OVERSHOOT = 1.1;
  function weaponRange(p) {
    return Math.max(W, H) * 0.5 * WEAPON_RANGE_OVERSHOOT * p.rangeMult;
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
      // Poison (v1.36.1): poisonTimer counts down from POISON_DURATION and
      // is never refreshed/extended by later hits - only poisonStacks goes
      // up (capped at poisonMaxStacksForLevel(p.poisonLevel)), raising the
      // tick damage instead. Both clear together once poisonTimer reaches
      // 0 (see update()).
      this.poisonTimer = 0;
      this.poisonStacks = 0;
      // Frenzy (v1.36.4): same duration-doesn't-reset/rank-gates-stack-cap
      // rules as poison, but the stacks buff the frenzied enemy's own
      // damage instead of dealing damage directly - see FRENZY_SPEED_MULT/
      // FRENZY_DMG_MULT_PER_STACK and the friendly-fire check in update().
      this.frenzyTimer = 0;
      this.frenzyStacks = 0;
      // Bombify (v1.36.5): no stack counter (doesn't stack) - a later hit
      // while already bombified just refreshes bombifyTimer back to
      // BOMBIFY_DURATION, since there's no stack benefit to reward instead.
      // Detonation (on death while bombifyTimer > 0) is resolved in
      // update(), not here.
      this.bombifyTimer = 0;
      // Set by the emergency-bomb special so its mass-kill burst is exempt
      // from GEM_CAP below - the whole point of that ability is stockpiling
      // gems for one big level-up burst, which the cap would otherwise gut.
      this.forceKilled = false;
    }
  }

  class Projectile {
    constructor(x, y, vx, vy, damage, pierce, radius, explosionRadius, chainHops, slowDuration, poisons, frenzies, bombifies) {
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
      this.poisons = poisons || false;
      this.frenzies = frenzies || false;
      this.bombifies = bombifies || false;
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
  // times the enemy's xpValue when it does. The 0.5 base was chosen so a
  // build that never pushes crowdExtra above 0 saw the same expected
  // XP/kill as the old always-drop-at-face-value scheme (0.5 x 2 = 1x);
  // now divided by ENEMY_SPAWN_RATE_MULT so that baseline no longer shifts
  // just because there are 1.5x as many kills available per second.
  const BASE_GEM_DROP_CHANCE = 0.5 / ENEMY_SPAWN_RATE_MULT;
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

  // Move speed and pickup radius upgrades were removed (v1.35.0): neither
  // feeds into any difficulty-scaling axis (§6-2), and both had a
  // lopsided value curve - move speed is only good in moderation (too
  // much makes the character harder to control precisely), while pickup
  // radius has no downside at all but is effectively fully solved after
  // one pick, making repeat picks pure filler either way. Their value was
  // folded into the base stats instead (see Player constructor).
  const UPGRADE_POOL = [
    { id: 'damage', title: 'ダメージ強化', desc: '攻撃ダメージ +50%', apply: p => p.damage = Math.round(p.damage * 1.5) },
    {
      id: 'atkspeed',
      title: '攻撃速度アップ',
      desc: '攻撃間隔 -20%',
      apply: p => p.atkCooldown = Math.max(STAT_LIMITS.minAtkCooldown, p.atkCooldown * 0.8),
      // Once atkCooldown is already at its floor, this upgrade does nothing
      // at all - stop offering it rather than presenting a dead choice.
      available: p => p.atkCooldown > STAT_LIMITS.minAtkCooldown,
    },
    {
      id: 'maxhp',
      title: '最大HPアップ',
      desc: '最大HP +15%、HP回復',
      // Percentage rather than a flat +25, so it stays meaningfully
      // proportional to whatever the current maxHp already is (e.g. much
      // bigger in absolute terms on Tank's 180 base than a flat number
      // would be) instead of mattering less and less on higher-HP builds.
      apply: p => {
        const added = Math.round(p.maxHp * 0.15);
        p.maxHp += added;
        p.hp = Math.min(p.maxHp, p.hp + added);
      },
    },
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
      // Unlike the other tradeoffs (where the downside saturates and the
      // upside keeps paying off for free, see STAT_LIMITS comment), here
      // it's the upside (atkCooldown) that has the floor - once already at
      // minAtkCooldown, this card would be a real damage cut for zero
      // benefit, so stop offering it once that floor is reached.
      available: p => p.atkCooldown > STAT_LIMITS.minAtkCooldown,
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
      id: 'trade-maxhp',
      title: '鉄壁の構え',
      desc: '最大HP +25% / ダメージ -15%',
      apply: p => {
        const added = Math.round(p.maxHp * 0.25);
        p.maxHp += added;
        p.hp = Math.min(p.maxHp, p.hp + added);
        p.damage = Math.max(STAT_LIMITS.minDamage, Math.round(p.damage * 0.85));
      },
    },
  ];

  // Bullet effects: unlike the plain stat upgrades above, these have levels
  // and a cap. The first pick activates the effect; later picks strengthen
  // it. Once maxLevel is reached, onLevelUp() below stops offering that
  // entry at all. Pierce reuses the existing `pierce` field directly as
  // its level rather than a separate counter.
  const EXPLOSION_DAMAGE_PCT = 0.8;
  const CHAIN_DAMAGE_PCT = 0.5;
  const CHAIN_RADIUS = 150;
  // Chain is now a proc rather than a guaranteed on-hit effect: each hit
  // only has a chance to trigger it at all. Net nerf (fewer hits actually
  // chain), but raising the per-trigger damage to compensate shifts chain
  // toward synergizing with attack speed (more swings = more chances to
  // proc) rather than raw single-hit damage, which the guaranteed version
  // didn't care about either way.
  const CHAIN_TRIGGER_CHANCE = 0.5;
  const SLOW_MULT = 0.5;
  const SLOWED_DMG_MULT = 0.5; // a slowed enemy's contact damage is also halved

  // Status-effect indicator dots (v1.36.0): rather than recoloring an
  // enemy's own body per status (which only ever supported showing one
  // status at a time, and fought with hitFlash for the same fillStyle),
  // each active status gets a small dot drawn above the enemy instead - see
  // draw(). Keyed by status name so future statuses (e.g. poison) just add
  // an entry here and a condition in draw() without touching enemy color.
  const STATUS_DOT_COLORS = { slow: '#7ec8ff', poison: '#39d353', frenzy: '#ff8c1a', bombify: '#ff3b3b' };
  function explosionRadiusForLevel(level) { return 50 + 20 * (level - 1); }
  function slowDurationForLevel(level) { return 1.0 + 0.5 * (level - 1); }

  // Poison (v1.36.1, stacking rework v1.36.3): a fixed-length damage-over-
  // time status, independent of the player's own damage stat - tick damage
  // is a percent of the POISONED ENEMY's own maxHp, so it stays meaningful
  // against both fragile swarm enemies and huge single-target HP pools
  // (bosses) alike, the same niche explosion/chain fill for AoE/crowd
  // (§5's boss design note). Re-hitting an already-poisoned enemy adds a
  // stack (more tick damage) but does NOT restart POISON_DURATION - only
  // the first hit while unpoisoned sets that timer, so stacking rewards
  // attack speed without also letting rapid hits keep an enemy poisoned
  // indefinitely.
  const POISON_DURATION = 5;
  // Per-stack tick rate is a flat constant rather than scaling with rank
  // (v1.36.3) - ranking up instead raises how many stacks can pile up (see
  // poisonMaxStacksForLevel), so power still grows with level but through
  // stacking headroom rather than a per-tick multiplier. A capped stack
  // count (still true after this change) matters for the same two reasons
  // as before: an unbounded count would let DPS runaway on any fast-firing
  // build, and since stacks are shown as one dot each (see draw()), would
  // clutter the screen with dots well past the point of being readable.
  const POISON_DMG_PCT = 0.04;
  function poisonMaxStacksForLevel(level) { return level; }

  // Frenzy (v1.36.4): a high-risk status - it makes the afflicted enemy
  // itself more dangerous (faster, harder-hitting), but a frenzied enemy
  // also deals contact damage to whichever OTHER enemy it touches, not
  // just the player. Landed well into a dense cluster, this can trigger
  // enemy-on-enemy friendly fire that thins the swarm out on its own; badly
  // placed, it just hands the enemy that reaches the player a much harder
  // hit. Same duration/stacking rules as poison: FRENZY_DURATION doesn't
  // reset on a later hit, only frenzyStacks (capped by
  // frenzyMaxStacksForLevel) goes up, raising the damage multiplier.
  // FRENZY_SPEED_MULT itself is flat - it applies in full the moment an
  // enemy is frenzied at all, regardless of stack count.
  const FRENZY_DURATION = 5;
  const FRENZY_SPEED_MULT = 1.5;
  const FRENZY_DMG_MULT_PER_STACK = 0.5;
  function frenzyMaxStacksForLevel(level) { return level; }

  // Bombify (v1.36.5): unlike poison/frenzy, this status doesn't stack at
  // all and has no effect while the target is alive - a later hit while
  // already bombified just refreshes bombifyTimer back to full rather than
  // adding a stack. Its entire payoff is conditional: if the target dies
  // while bombifyTimer > 0, it detonates for a percent of ITS OWN maxHp
  // (like poison, so it scales naturally with difficulty/enemy type) to
  // every other enemy within BOMBIFY_RADIUS. Rank raises that percent
  // directly (there's no stack count to raise instead). Detonating a
  // bombified enemy can itself kill neighboring bombified enemies, chaining
  // into further detonations - see the resolution loop in update().
  const BOMBIFY_DURATION = 5;
  const BOMBIFY_RADIUS = 180;
  function bombifyDmgPctForLevel(level) { return 0.3 + 0.1 * (level - 1); }

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
      introDesc: `着弾時${Math.round(CHAIN_TRIGGER_CHANCE * 100)}%の確率で、近くの敵にダメージ(本体ダメージの${Math.round(CHAIN_DAMAGE_PCT * 100)}%)が連鎖するようになる`,
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
      id: 'poison',
      name: '猛毒',
      maxLevel: 5,
      getLevel: p => p.poisonLevel,
      levelUp: p => { p.poisonLevel++; },
      introDesc: `着弾した敵を${POISON_DURATION}秒間の毒状態にし、敵自身の最大HPの${Math.round(POISON_DMG_PCT * 100)}%を毎秒毒ダメージ(1スタックあたり)として与えるようになる。毒状態中に再度攻撃が当たると重ね掛けされ、毒ダメージが増加する(持続時間は延長されない)`,
      upgradeDesc: level => `毒の重ね掛け上限が増加する(最大${poisonMaxStacksForLevel(level)}スタック → 最大${poisonMaxStacksForLevel(level + 1)}スタック)`,
    },
    {
      id: 'frenzy',
      name: '狂乱',
      maxLevel: 5,
      getLevel: p => p.frenzyLevel,
      levelUp: p => { p.frenzyLevel++; },
      introDesc: `着弾した敵を${FRENZY_DURATION}秒間の狂乱状態にする。狂乱状態の敵は移動速度が${FRENZY_SPEED_MULT}倍になり、重ね掛け数に応じて攻撃力が増加する(1スタックあたり+${Math.round(FRENZY_DMG_MULT_PER_STACK * 100)}%)。狂乱状態の敵は、自機だけでなく接触した他の敵にもこの強化された攻撃力でダメージを与えるようになる(敵同士のフレンドリーファイア)。持続時間は重ね掛けで延長されない。ハイリスクな状態異常: 個々の敵は強化されるが、うまくいけば敵集団の自滅を誘発できる`,
      upgradeDesc: level => `狂乱の重ね掛け上限が増加する(最大${frenzyMaxStacksForLevel(level)}スタック → 最大${frenzyMaxStacksForLevel(level + 1)}スタック)`,
    },
    {
      id: 'bombify',
      name: '爆弾化',
      maxLevel: 5,
      getLevel: p => p.bombifyLevel,
      levelUp: p => { p.bombifyLevel++; },
      introDesc: `着弾した敵を${BOMBIFY_DURATION}秒間爆弾化する。生存中は特に効果はないが、爆弾化状態のまま倒された敵は、その敵自身の最大HPの${Math.round(bombifyDmgPctForLevel(1) * 100)}%を周囲(半径${BOMBIFY_RADIUS}px)の他の敵に爆発ダメージとして与える。重ね掛けはされず、再度攻撃が当たると持続時間が最大まで更新される`,
      upgradeDesc: level => `爆弾化ダメージが増加する(敵自身の最大HPの${Math.round(bombifyDmgPctForLevel(level) * 100)}% → ${Math.round(bombifyDmgPctForLevel(level + 1) * 100)}%)`,
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

      // How far past SPAWN_RATE_MAX the raw spawn cadence would have gone
      // this tick, recomputed every spawn-pacing check (see update()) and
      // read by spawnEnemy() to convert that excess into extra enemy HP
      // instead. 0 until the cap is actually being pushed against.
      this.spawnRateOverflow = 0;

      // Rush state machine: 'idle' (eligible to trigger on the next
      // difficulty-check window, see update()) -> 'warning' (countdown
      // alert) -> 'active' (the burst itself) -> back to 'idle'.
      // rushTimer counts down within whichever of warning/active is current.
      this.rushState = 'idle';
      this.rushTimer = 0;
      // Counts down once per difficulty-check window (see update()); a
      // trigger is only allowed while this is 0, and resets it to
      // RUSH_WINDOW_COOLDOWN on trigger, so back-to-back windows can't
      // both fire a rush even if killRate clears the threshold both times.
      this.rushWindowCooldown = 0;
    }

    onLevelUp() {
      this.levelingUp = true;
      const picks = [];
      const notMaxedEffects = BULLET_EFFECTS.filter(eff => eff.getLevel(this.player) < eff.maxLevel);
      // Most UPGRADE_POOL/TRADEOFF_POOL entries have no cap and stay useful
      // forever, so `available` is opt-in (defaults to always-true) rather
      // than every entry needing to declare one - only atkspeed/trade-atkspeed
      // currently gate on it, since STAT_LIMITS.minAtkCooldown is a floor on
      // their own upside rather than a downside that's fine to saturate.
      const pool = [
        ...UPGRADE_POOL.filter(up => !up.available || up.available(this.player)),
        ...TRADEOFF_POOL.filter(up => !up.available || up.available(this.player)),
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
      // Grant a brief invulnerability window instead of gating movement
      // behind a "tap to resume" screen (see RESUME_INVULN_DURATION).
      this.player.invulnTimer = Math.max(this.player.invulnTimer, RESUME_INVULN_DURATION);
      this.updateHud();
    }

    tryActivateSpecial() {
      if (this.over || this.levelingUp || paused) return;
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
      const D = this.difficulty;

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
      // Both per-tier coefficients were halved (0.14->0.07, 0.11->0.055,
      // v1.35.7) after verifying that a well-performing run reaching
      // difficulty ~43 by the 15-minute mark was taking single boss hits
      // for 100%+ of maxHp even with heavy HP investment - offense had
      // outpaced defense so early that HP upgrades never felt worth taking
      // until it was already too late to catch up. Their ratio to each
      // other (dmg:hp) is kept the same, only the overall pace is slower.
      const tierHpMult = 1 + (D - 1) * 0.07;
      const offenseExtra = Math.max(0, offensePowerMult(p) - 1);
      // Once spawn pacing is pinned at SPAWN_RATE_MAX, further crowd
      // investment can't buy a faster spawn rate anymore - it buys
      // tougher enemies instead (see SPAWN_OVERFLOW_HP_COEFF). Enemies
      // spawned during an active rush get a further flat RUSH_HP_MULT on
      // top, so the burst is a real spike in danger, not just more targets.
      const hpMult = tierHpMult * (1 + offenseExtra * 0.25) * (1 + this.spawnRateOverflow * SPAWN_OVERFLOW_HP_COEFF) * (this.rushState === 'active' ? RUSH_HP_MULT : 1);

      const tierDmgMult = 1 + (D - 1) * 0.055;
      const survivalExtra = Math.max(0, survivalPowerMult(p) - 1);
      // 0.7 -> 0.5 (v1.35.8): maxHp is already pre-damped to half weight
      // inside survivalExtra (see survivalPowerMult), so at 0.7 here, doubling
      // maxHp alone still fed back as a net +35% enemy dmg - meaningfully
      // harsher than doubling damage/atkspeed feeding back as only +25% extra
      // enemy HP via the symmetric offenseExtra * 0.25 above. 0.5 brings
      // maxHp's net feedback (0.5 pre-damping * 0.5 here = 0.25) in line with
      // that offense-side rate instead of penalizing HP investment more.
      const dmgMult = tierDmgMult * (1 + survivalExtra * 0.5);

      // A spawn event places def.burst enemies of the rolled type together
      // as a loose cluster (same general direction, small angular jitter)
      // rather than one at a time - burst count is a per-type identity
      // trait (see ENEMY_TYPES), not a difficulty/crowd-scaling lever.
      // During an active rush, burst is doubled - this is the mechanism by
      // which a rush deliberately exceeds SPAWN_RATE_MAX (§6-3): that cap
      // only bounds how often a spawn event fires, not how many enemies
      // one event produces.
      const def = ENEMY_TYPES[type];
      const burstCount = def.burst * (this.rushState === 'active' ? RUSH_BURST_MULT : 1);
      const baseAngle = rand(0, TAU);
      const spawnDist = Math.max(W, H) * 0.65 + 60;
      for (let i = 0; i < burstCount; i++) {
        // Forced spawns (currently only the boss's periodic arrival) are
        // exempt from MAX_ALIVE_ENEMIES, same spirit as the emergency
        // bomb's exemption from GEM_CAP - a rare, deliberately singular
        // event shouldn't get silently swallowed by an unrelated cap.
        if (!forceType && this.enemies.length >= MAX_ALIVE_ENEMIES) break;
        const angle = baseAngle + rand(-0.15, 0.15);
        const x = p.x + Math.cos(angle) * spawnDist;
        const y = p.y + Math.sin(angle) * spawnDist;
        this.totalSpawned++;
        this.enemies.push(new Enemy(type, x, y, hpMult, dmgMult));
      }
    }

    fireWeapon(dt) {
      const p = this.player;
      p.atkTimer -= dt;
      if (p.atkTimer > 0) return;
      if (this.enemies.length === 0) return;

      // find nearest N enemies within weapon range - out-of-range enemies
      // (typically still off-screen) are ignored entirely rather than
      // being auto-targeted, so kills happen where the player can actually
      // see them.
      const range2 = weaponRange(p) ** 2;
      const sorted = this.enemies
        .map(e => ({ e, d: dist2(e.x, e.y, p.x, p.y) }))
        .filter(o => o.d <= range2)
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.max(1, p.projCount));

      if (sorted.length === 0) return;
      p.atkTimer = p.atkCooldown;

      const explosionRadius = p.explosionLevel > 0 ? explosionRadiusForLevel(p.explosionLevel) : 0;
      const chainHops = p.chainLevel;
      const slowDuration = p.slowLevel > 0 ? slowDurationForLevel(p.slowLevel) : 0;
      const poisons = p.poisonLevel > 0;
      const frenzies = p.frenzyLevel > 0;
      const bombifies = p.bombifyLevel > 0;
      // Some specials (e.g. speed-type's overdrive) include a timed damage
      // buff, declared on the special itself (buffDamageMult) rather than
      // hardcoded here. Baked into the shot at fire time, same as p.damage
      // normally is - not re-evaluated later at the moment of the hit.
      const buffDamageMult = p.specialBuffTimer > 0 && p.special && p.special.buffDamageMult != null
        ? p.special.buffDamageMult : 1;
      const shotDamage = p.damage * buffDamageMult;

      for (let i = 0; i < p.projCount; i++) {
        const target = sorted[i % sorted.length].e;
        const ang = Math.atan2(target.y - p.y, target.x - p.x) + rand(-0.05, 0.05);
        const vx = Math.cos(ang) * p.projSpeed;
        const vy = Math.sin(ang) * p.projSpeed;
        this.projectiles.push(new Projectile(p.x, p.y, vx, vy, shotDamage, p.pierce, 5, explosionRadius, chainHops, slowDuration, poisons, frenzies, bombifies));
      }
    }

    update(dt) {
      if (this.over || this.levelingUp || paused) return;
      this.time += dt;
      const p = this.player;

      // Kill-rate rubber-band, checked once per DIFFICULTY_CHECK_INTERVAL
      // window: a single discrete "difficulty" tier replaced the old
      // continuous time-based curves so difficulty reads as legible steps.
      // Step rule (killRate this window -> difficulty delta, never below 1):
      //   >= 90% (rush-concluding window): +RUSH_DIFFICULTY_BONUS (3)
      //   >= 90% (normal window):          +DIFFICULTY_STEP_HIGH_KILL_RATE (2)
      //   >= 70% (and < 90%):              +1
      //   > 50% and < 70%:                 hold
      //   <= 50% (and > 30%):              -1
      //   <= 30%:                          -DIFFICULTY_STEP_LOW_KILL_RATE (2)
      // The 70%/50% band is the original three-tier rubber-band; the >=90%
      // and <=30% tiers layer extra feedback at the extremes on top of it.
      this.levelCheckTimer -= dt;
      if (this.levelCheckTimer <= 0) {
        this.levelCheckTimer += DIFFICULTY_CHECK_INTERVAL;
        const spawnedThisWindow = this.totalSpawned - this.spawnedAtCheckpoint;
        const killsThisWindow = this.kills - this.killsAtCheckpoint;
        const killRate = spawnedThisWindow > 0 ? killsThisWindow / spawnedThisWindow : 1;

        // RUSH_DURATION is sized so an active rush always concludes exactly
        // on this window boundary (see its definition) - a still-'active'
        // state here means this window fully contained that rush's burst.
        const rushConcluding = this.rushState === 'active';
        if (killRate >= RUSH_KILL_RATE_THRESHOLD) {
          this.difficulty += rushConcluding ? RUSH_DIFFICULTY_BONUS : DIFFICULTY_STEP_HIGH_KILL_RATE;
        } else if (killRate >= 0.7) {
          this.difficulty += 1;
        } else if (killRate <= 0.3) {
          this.difficulty = Math.max(1, this.difficulty - DIFFICULTY_STEP_LOW_KILL_RATE);
        } else if (killRate <= 0.5) {
          this.difficulty = Math.max(1, this.difficulty - 1);
        }
        // else: 0.5 < killRate < 0.7 -> hold, no change

        if (rushConcluding) {
          this.rushState = 'idle';
          // Payoff: heal RUSH_HEAL_FRAC of maxHp and sweep every gem
          // currently on screen straight into XP, rewarding the player for
          // having just weathered the burst instead of interrupting play
          // with forced level-up picks.
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * RUSH_HEAL_FRAC);
          for (const g of this.gems) this.player.gainXp(g.value);
          this.gems.length = 0;
        }

        // Rush eligibility rides along the same 50s window/checkpoint as
        // the difficulty rubber-band above, rather than a separate
        // dedicated tracker - if this window's kill rate alone cleared
        // RUSH_KILL_RATE_THRESHOLD, that's sufficient to trigger (no
        // multi-window "sustained" streak needed). rushWindowCooldown
        // additionally caps how often that can actually fire, so a
        // consistently high kill rate doesn't trigger a rush every window.
        // Decrementing it unconditionally (even on a rushConcluding window)
        // keeps the "once every RUSH_WINDOW_COOLDOWN windows" cadence
        // accurate regardless of how that window was otherwise spent.
        if (this.rushWindowCooldown > 0) this.rushWindowCooldown--;
        if (this.rushState === 'idle' && this.rushWindowCooldown <= 0 && killRate > RUSH_KILL_RATE_THRESHOLD) {
          this.rushState = 'warning';
          this.rushTimer = RUSH_WARNING_DURATION;
          this.rushWindowCooldown = RUSH_WINDOW_COOLDOWN;
        }
        this.spawnedAtCheckpoint = this.totalSpawned;
        this.killsAtCheckpoint = this.kills;
      }

      // Rush's warning -> active transition, independent of the 50s check
      // above. active -> idle is instead handled inside that check (see
      // rushConcluding), so this only ever decrements rushTimer while
      // 'active' for the HUD's "残りN秒" display - it never itself ends the
      // rush, avoiding any drift between two independent countdowns.
      if (this.rushState === 'warning') {
        this.rushTimer -= dt;
        if (this.rushTimer <= 0) {
          this.rushState = 'active';
          this.rushTimer = RUSH_DURATION;
        }
      } else if (this.rushState === 'active') {
        this.rushTimer = Math.max(0, this.rushTimer - dt);
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

      // spawn
      this.spawnTimer -= dt;
      const D = this.difficulty;
      const tierInterval = Math.max(0.22, this.spawnInterval - (D - 1) * 0.11);
      // Pierce/chain make a player good at handling crowds, so a build
      // that stacks those sees a faster spawn cadence than the tier
      // baseline; a build that never picks them up keeps the gentle
      // baseline. Multishot doesn't count here - it's the standard
      // weapon's innate effect now, not a chosen investment (see
      // crowdPowerMult). Pacing is expressed as spawn events/second
      // (clamped to [SPAWN_RATE_MIN, SPAWN_RATE_MAX]) rather than enemies/
      // second - how many enemies a single event produces is now a
      // per-type trait (ENEMY_TYPES.burst), not a scaling lever here.
      const crowdExtra = Math.max(0, crowdPowerMult(p) - 1);
      const rawEventsPerSec = (1 + crowdExtra * 0.5) * ENEMY_SPAWN_RATE_MULT / tierInterval;
      const eventsPerSec = clamp(rawEventsPerSec, SPAWN_RATE_MIN, SPAWN_RATE_MAX);
      const curInterval = 1 / eventsPerSec;
      // How much spawn-pace demand the ceiling is currently swallowing -
      // spawnEnemy() converts this into extra HP instead (see
      // SPAWN_OVERFLOW_HP_COEFF).
      this.spawnRateOverflow = Math.max(0, rawEventsPerSec / SPAWN_RATE_MAX - 1);
      if (this.spawnTimer <= 0) {
        this.spawnTimer = curInterval;
        if (this.enemies.length < MAX_ALIVE_ENEMIES) this.spawnEnemy();
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
      const rushSpeedMult = this.rushState === 'active' ? RUSH_SPEED_MULT : 1;
      for (const e of this.enemies) {
        const d = dist(e.x, e.y, p.x, p.y) || 1;
        const frenzySpeedMult = e.frenzyTimer > 0 ? FRENZY_SPEED_MULT : 1;
        const effSpeed = (e.slowTimer > 0 ? e.speed * SLOW_MULT : e.speed) * frenzySpeedMult * rushSpeedMult;
        e.x += (p.x - e.x) / d * effSpeed * dt;
        e.y += (p.y - e.y) / d * effSpeed * dt;
        if (e.hitFlash > 0) e.hitFlash -= dt;
        if (e.contactCd > 0) e.contactCd -= dt;
        if (e.slowTimer > 0) e.slowTimer -= dt;
        if (e.poisonTimer > 0) {
          // Tick damage is a percent of the enemy's OWN maxHp at a flat
          // rate (POISON_DMG_PCT) per stack - rank only affects how many
          // stacks can pile up (see poisonMaxStacksForLevel, applied where
          // stacks are added on hit), not this per-tick rate itself.
          e.hp -= e.maxHp * POISON_DMG_PCT * e.poisonStacks * dt;
          e.poisonTimer -= dt;
          if (e.poisonTimer <= 0) e.poisonStacks = 0;
        }
        if (e.frenzyTimer > 0) {
          e.frenzyTimer -= dt;
          if (e.frenzyTimer <= 0) e.frenzyStacks = 0;
        }
        if (e.bombifyTimer > 0) e.bombifyTimer -= dt; // no effect while alive - see the detonation-resolution block below

        if (d < e.radius + p.radius && e.contactCd <= 0) {
          // Slowed enemies hit softer, frenzied enemies hit harder - both
          // stack multiplicatively in the unlikely case a build applies
          // both to the same enemy.
          const frenzyDmgMult = e.frenzyTimer > 0 ? 1 + e.frenzyStacks * FRENZY_DMG_MULT_PER_STACK : 1;
          const dmg = (e.slowTimer > 0 ? e.dmg * SLOWED_DMG_MULT : e.dmg) * frenzyDmgMult;
          p.takeDamage(dmg);
          // Passive hook for characters like Tank whose passive reacts to
          // being hit (e.g. reflect damage). Fires on the contact event
          // itself, not gated on invulnerability - the enemy touched the
          // player either way.
          if (p.passive && p.passive.onContactDamage) p.passive.onContactDamage(p, e, this);
          e.contactCd = 0.5;
          this.shakeTime = 0.15;
        }
      }

      // Frenzy friendly fire: a frenzied enemy also deals its (boosted)
      // contact damage to whichever OTHER enemy it physically touches, not
      // just the player - this is the risk half of 狂乱's design (see
      // FRENZY_DMG_MULT_PER_STACK). Shares contactCd with the player-contact
      // check above, so a frenzied enemy can only land one hit (on the
      // player or a neighbor, whichever it touches) per cooldown window.
      // Only iterates frenzied enemies as the outer loop (cheap - normally
      // a small subset of the swarm) rather than checking every pair.
      for (const e of this.enemies) {
        if (e.frenzyTimer <= 0 || e.contactCd > 0) continue;
        const frenzyDmgMult = 1 + e.frenzyStacks * FRENZY_DMG_MULT_PER_STACK;
        for (const other of this.enemies) {
          if (other === e) continue;
          const rr = e.radius + other.radius;
          if (dist2(e.x, e.y, other.x, other.y) < rr * rr) {
            other.hp -= e.dmg * frenzyDmgMult;
            other.hitFlash = 0.12;
            e.contactCd = 0.5;
            break;
          }
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
            if (proj.poisons) {
              if (e.poisonTimer <= 0) { e.poisonTimer = POISON_DURATION; e.poisonStacks = 1; }
              else e.poisonStacks = Math.min(poisonMaxStacksForLevel(p.poisonLevel), e.poisonStacks + 1);
            }
            if (proj.frenzies) {
              if (e.frenzyTimer <= 0) { e.frenzyTimer = FRENZY_DURATION; e.frenzyStacks = 1; }
              else e.frenzyStacks = Math.min(frenzyMaxStacksForLevel(p.frenzyLevel), e.frenzyStacks + 1);
            }
            if (proj.bombifies) e.bombifyTimer = BOMBIFY_DURATION; // no stacking - just (re)starts at full duration

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

            if (proj.chainHops > 0 && Math.random() < CHAIN_TRIGGER_CHANCE) {
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

      // Bombify detonation: any bombified enemy that ends this frame at
      // hp<=0 (from a projectile, poison, frenzy friendly fire, or an
      // earlier detonation this same frame) explodes for a percent of its
      // OWN maxHp to every other enemy within BOMBIFY_RADIUS. Resolved in a
      // loop rather than a single pass so a detonation that drops another
      // bombified enemy to 0 chains into that enemy's own detonation too,
      // regardless of array order - it keeps re-scanning until nothing new
      // qualifies. `detonated` guards against processing the same enemy
      // twice as the outer loop re-scans.
      const detonated = new Set();
      let moreToDetonate = true;
      while (moreToDetonate) {
        moreToDetonate = false;
        for (const e of this.enemies) {
          if (e.hp > 0 || e.bombifyTimer <= 0 || detonated.has(e)) continue;
          detonated.add(e);
          const bombDmg = e.maxHp * bombifyDmgPctForLevel(p.bombifyLevel);
          for (const other of this.enemies) {
            if (other === e) continue;
            if (dist2(other.x, other.y, e.x, e.y) <= BOMBIFY_RADIUS * BOMBIFY_RADIUS) {
              other.hp -= bombDmg;
              other.hitFlash = 0.12;
            }
          }
          for (let i = 0; i < 10; i++) this.particles.push(new Particle(e.x, e.y, STATUS_DOT_COLORS.bombify, 3));
          moreToDetonate = true;
        }
      }

      // dead enemies -> gems + particles
      // Gems are no longer a guaranteed drop: a kill has a chance to drop
      // one at all, rather than every kill dropping a smaller and smaller
      // gem. At baseline (crowdExtra=0) this averages out to the same
      // expected XP/kill as the old always-drop scheme (BASE_GEM_DROP_CHANCE
      // 0.5 x GEM_VALUE_MULT 2 = 1x). A crowd-clearing build (pierce/chain)
      // pushes crowdExtra up, which further lowers the drop
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
      // Which specials grant a pickup-range/XP buff (and by how much) is
      // declared per-special (buffPickupRadiusMult/buffXpMult) rather than
      // hardcoded here, since different characters' buffs grant different
      // amounts (or none at all). buffPickupRadiusMult multiplies the
      // player's current pickupRadius rather than overriding it outright,
      // so it still scales with pickup-range upgrades - standard's
      // Infinity just makes that multiplication Infinity regardless.
      const specialBuffActive = p.specialBuffTimer > 0;
      const effectivePickupRadius = specialBuffActive && p.special && p.special.buffPickupRadiusMult != null
        ? p.pickupRadius * p.special.buffPickupRadiusMult : p.pickupRadius;
      // Gems collected during the vacuum buff are worth extra, so stockpiling
      // XP and popping the ability pays off more than using it on cooldown.
      const buffXpMult = specialBuffActive && p.special && p.special.buffXpMult != null
        ? p.special.buffXpMult : 1;
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

      if (this.rushState === 'warning') {
        rushAlertEl.classList.remove('hidden');
        rushAlertEl.classList.add('rush-warning');
        rushAlertEl.classList.remove('rush-active');
        rushAlertEl.textContent = `ラッシュまであと${Math.ceil(this.rushTimer)}秒`;
      } else if (this.rushState === 'active') {
        rushAlertEl.classList.remove('hidden');
        rushAlertEl.classList.remove('rush-warning');
        rushAlertEl.classList.add('rush-active');
        rushAlertEl.textContent = `ラッシュ発生中！ 残り${Math.ceil(this.rushTimer)}秒`;
      } else {
        rushAlertEl.classList.add('hidden');
      }
    }

    draw() {
      ctx.clearRect(0, 0, W, H);

      let shakeX = 0, shakeY = 0;
      if (this.shakeTime > 0 && !paused && !this.levelingUp) {
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
        ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
        ctx.arc(sx, sy, e.radius, 0, TAU);
        ctx.fill();

        // Status-effect dots, drawn in a row above the enemy instead of
        // recoloring its body (see STATUS_DOT_COLORS) - only 'slow' exists
        // today, but the list naturally grows as more statuses are added.
        const activeStatusDots = [];
        if (e.slowTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.slow);
        // Poison/frenzy stacks: one dot per stack, so the stack count reads
        // at a glance rather than needing a number readout.
        for (let i = 0; i < e.poisonStacks; i++) activeStatusDots.push(STATUS_DOT_COLORS.poison);
        for (let i = 0; i < e.frenzyStacks; i++) activeStatusDots.push(STATUS_DOT_COLORS.frenzy);
        // Bombify doesn't stack, so just a single dot like slow.
        if (e.bombifyTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.bombify);
        if (activeStatusDots.length > 0) {
          const dotRadius = 3;
          const dotSpacing = 9;
          const dotY = sy - e.radius - 8;
          const rowStartX = sx - (activeStatusDots.length - 1) * dotSpacing / 2;
          for (let i = 0; i < activeStatusDots.length; i++) {
            ctx.beginPath();
            ctx.fillStyle = activeStatusDots[i];
            ctx.arc(rowStartX + i * dotSpacing, dotY, dotRadius, 0, TAU);
            ctx.fill();
          }
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
      const innateLine = entry.innateEffect ? `<div class="u-desc">武器固有効果「${entry.innateEffect.name}」: ${entry.innateEffect.desc}</div>` : '';
      card.innerHTML = `<div class="u-title">${entry.name}</div><div class="u-desc">${entry.desc}</div>${passiveLine}${innateLine}`;
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

  // Renders a snapshot of the player's current build into the pause
  // screen - stats that otherwise have no single place they're all
  // visible together mid-run (HUD only shows a handful of them).
  function renderPauseStats(g) {
    const p = g.player;
    const mm = String(Math.floor(g.time / 60)).padStart(2, '0');
    const ss = String(Math.floor(g.time % 60)).padStart(2, '0');
    const bulletLines = [];
    if (p.explosionLevel > 0) bulletLines.push(`爆発 Lv.${p.explosionLevel}`);
    if (p.chainLevel > 0) bulletLines.push(`連鎖 Lv.${p.chainLevel}`);
    if (p.slowLevel > 0) bulletLines.push(`低速 Lv.${p.slowLevel}`);
    if (p.interceptLevel > 0) bulletLines.push(`迎撃 Lv.${p.interceptLevel}`);
    if (p.pierce > 0) bulletLines.push(`貫通 Lv.${p.pierce}`);
    if (p.poisonLevel > 0) bulletLines.push(`猛毒 Lv.${p.poisonLevel}`);
    if (p.frenzyLevel > 0) bulletLines.push(`狂乱 Lv.${p.frenzyLevel}`);
    if (p.bombifyLevel > 0) bulletLines.push(`爆弾化 Lv.${p.bombifyLevel}`);
    pauseStatsEl.innerHTML = `
      <p>HP: ${Math.ceil(p.hp)} / ${p.maxHp}</p>
      <p>レベル: ${p.level}</p>
      <p>ダメージ: ${p.damage} / 攻撃間隔: ${p.atkCooldown.toFixed(2)}秒</p>
      <p>同時発射数: ${p.projCount}</p>
      <p>移動速度: ${Math.round(p.speed)}</p>
      <p>HP自然回復: ${p.regen}/秒 / 回収範囲: ${Math.round(p.pickupRadius)}</p>
      ${bulletLines.length ? `<p>弾丸効果: ${bulletLines.join(' / ')}</p>` : ''}
      <p>生存時間: ${mm}:${ss} / 撃破数: ${g.kills} / 難易度: ${g.difficulty}</p>
    `;
  }

  // The pause screen is a full overlay (like the other screens), which
  // would otherwise sit on top of and block the small pause-btn itself -
  // so pausing hides that button and resuming happens via the explicit
  // "再開" button on the pause screen instead of re-clicking pause-btn.
  pauseBtn.addEventListener('click', () => {
    if (!game || game.over) return;
    paused = true;
    renderPauseStats(game);
    pauseScreen.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
  });

  resumeBtn.addEventListener('click', () => {
    if (!game || game.over) return;
    paused = false;
    pauseScreen.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    // Grant a brief invulnerability window on resume, same as after a
    // level-up pick (see RESUME_INVULN_DURATION) - the player couldn't
    // react while paused, so an enemy that closed to point-blank range
    // during that time shouldn't land a free hit the instant control
    // returns.
    game.player.invulnTimer = Math.max(game.player.invulnTimer, RESUME_INVULN_DURATION);
  });

  backToTitleBtn.addEventListener('click', () => {
    if (!game) return;
    // Reuses the same "over" flag the normal game-over path sets, so the
    // render loop stops driving this game instance the same way it
    // already does after death - no separate teardown path needed.
    game.over = true;
    paused = false;
    pauseScreen.classList.add('hidden');
    pauseBtn.classList.add('hidden');
    startScreen.classList.remove('hidden');
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
