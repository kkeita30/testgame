(() => {
  'use strict';

  const GAME_VERSION = '1.36.26';
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

  // Whether the player is actively pressing/holding a move-input right now
  // (touch, mouse, or a movement key), regardless of whether that input is
  // currently producing any actual movement (e.g. a touch held stationary
  // right at its own origin still counts as "held"). Used by the charge
  // beam weapon (see Game.updateChargeBeam) to tie its charge-up to the
  // same press/hold gesture that drives movement, rather than wiring up a
  // separate input path just for that one weapon.
  function isMoveInputHeld() {
    return dragTouchId !== null || mouseDown || keyboardVector() !== null;
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
  const threatVignetteEl = document.getElementById('threat-vignette');
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

  // Wide weapon (v1.36.15): a short-range melee-style sweep that hits every
  // enemy inside a cone in front of the player in one go, instead of firing
  // a traveling Projectile. WIDE_ATTACK_RANGE piggybacks on INTERCEPT_RADIUS
  // (already the game's established "close" distance), just a bit longer -
  // the tradeoff for guaranteed multi-target coverage and above-average
  // damage is that the player has to get in close to use it at all. Its
  // innate effect (see WEAPONS below) widens the cone with rank instead of
  // adding more shots, so this weapon never gets multishot's raw
  // shot-count scaling. Declared here (ahead of its usual position among
  // the other bullet-effect constants) because WEAPONS' desc strings below
  // reference it directly at module-load time, not just from inside a
  // later-called function.
  const WIDE_ATTACK_RANGE = INTERCEPT_RADIUS + 30;
  const WIDE_DAMAGE_MULT = 2.0;
  function wideHalfWidthForRank(rank) { return 16 + 10 * (rank - 1); }

  // A player's starting atkCooldown - named so the charge beam weapon
  // below can express its charge-rate multiplier as a ratio against this
  // same baseline, rather than a second hardcoded 0.7. Player's own
  // constructor also uses this constant for its initial atkCooldown.
  const ATK_COOLDOWN_BASE = 0.7;

  // Charge beam (v1.36.18): the only weapon that isn't driven by
  // atkTimer/atkCooldown as a per-shot cooldown at all. Holding the
  // move-input (the same press/hold gesture that drives movement, so
  // charging never costs mobility) builds up charge in discrete stages
  // (v1.36.22); releasing fires an instant, infinite-pierce beam, then
  // resets chargeTime to 0 regardless of whether anything was hit -
  // releasing with no target in range wastes the charge, which is the
  // real cost of committing to a release at the wrong moment. The
  // atkspeed upgrade still lowers atkCooldown as normal; here that
  // translates to a faster charge rate (ATK_COOLDOWN_BASE / atkCooldown)
  // rather than a shorter cooldown, so it's never a dead pick.
  //
  // Stages (v1.36.22): rank no longer widens the beam directly (that used
  // to stack multiplicatively with the charge-time width bonus below,
  // ballooning into an excessive max width at high rank + full charge).
  // Instead rank raises Player.chargeMaxStages (see WEAPONS' innate
  // effect) - width now grows in fixed per-stage steps up to whatever
  // stage cap the player's rank allows, unifying rank and charge-time into
  // one progression instead of two multiplying axes. CHARGE_TIME_PER_STAGE
  // is constant regardless of rank, so a higher stage cap directly means a
  // longer total hold to reach this weapon's (now higher) max width - the
  // width ceiling itself is what rank buys, not a speed-up.
  const CHARGE_TIME_PER_STAGE = 0.5;
  function chargeMaxStagesForRank(rank) { return rank; }
  const CHARGE_BASE_HALF_WIDTH = 8;
  const CHARGE_WIDTH_PER_STAGE = 8;
  function chargeHalfWidthForStage(stage) { return CHARGE_BASE_HALF_WIDTH + CHARGE_WIDTH_PER_STAGE * (stage - 1); }
  // Damage is a flat, relatively high multiplier regardless of charge
  // stage (v1.36.20) - charge time no longer scales damage at all. What it
  // scales instead is the beam's width: the longer you wait to release,
  // the more enemies have accumulated on screen, so a longer hold buys
  // wider coverage to actually clear them, rather than just a harder hit
  // on however few are in a narrow beam.
  const CHARGE_DAMAGE_MULT = 3.0;

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
    {
      id: 'wide',
      name: 'パルスウェーブ',
      desc: `近距離専用、自機の前後に同時に放たれる衝撃波。射程は「迎撃」よりわずかに長い程度(${WIDE_ATTACK_RANGE}px)だが、前後の範囲内の敵を一度に全て攻撃でき、威力も高め(通常武器の${WIDE_DAMAGE_MULT}倍)。マルチショットは持たない代わりに、ランクアップで衝撃波の幅が広がっていく。`,
      apply: (p) => {},
      innateEffect: {
        name: '波動拡大',
        desc: `自機レベルアップ${WEAPON_INNATE_LEVELS_PER_RANK}ごとにランクが上昇(最大Lv.${WEAPON_INNATE_MAX_RANK})し、衝撃波の幅が広がる`,
        applyRank(p, rank) { p.wideHalfWidth = wideHalfWidthForRank(rank); },
      },
    },
    {
      id: 'charge',
      name: 'チャージビーム',
      desc: `画面を押し続けている間チャージが進み(移動操作と同じ操作なので、チャージ自体は移動を妨げない)、指を離すと無限貫通のビームを発射する。チャージ${CHARGE_TIME_PER_STAGE}秒(1段階)未満での即離しでは発射されない。連射は不可能だが、威力は常に高め(通常武器の${CHARGE_DAMAGE_MULT}倍)。その代わりチャージ段階が進むほどビームの幅が広がる。ランクアップで最大チャージ段階数が増える(1段階あたりの時間は変わらないため、最大までの時間も伸びる)。`,
      apply: (p) => {},
      innateEffect: {
        name: '最大チャージ数アップ',
        desc: `自機レベルアップ${WEAPON_INNATE_LEVELS_PER_RANK}ごとにランクが上昇(最大Lv.${WEAPON_INNATE_MAX_RANK})し、最大チャージ段階数が増える(ランクと同じ数)`,
        applyRank(p, rank) { p.chargeMaxStages = chargeMaxStagesForRank(rank); },
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
      this.atkCooldown = ATK_COOLDOWN_BASE;
      this.atkTimer = 0;
      this.projSpeed = 380;
      this.projCount = 1;
      this.pierce = 0;
      // Wide weapon only (see WEAPONS/fireWideSweep) - unused by any other
      // weapon, harmless default otherwise.
      this.wideHalfWidth = 16;
      // Charge beam weapon only (see WEAPONS/updateChargeBeam) - unused by
      // any other weapon, harmless default otherwise.
      this.chargeTime = 0;
      this.chargeMaxStages = 1;
      this.chargeWasHeld = false;
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
      this.weakenLevel = 0;

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
  // fraction of maxHp healed on rush end, ON TOP OF the WINDOW_HEAL_FRAC
  // heal every window already gets (see update()) - together they total
  // WINDOW_HEAL_FRAC + RUSH_HEAL_FRAC = 45% on a rush-concluding window.
  const RUSH_HEAL_FRAC = 0.25;
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
  // Heals this fraction of maxHp on every difficulty-check window,
  // regardless of rush (v1.36.12) - added after removing regen/生命転化 as
  // pickable upgrades (v1.36.11) took away the player's only passive
  // recovery tools. On a rush-concluding window this stacks with
  // RUSH_HEAL_FRAC for 20% + 25% = 45% total.
  const WINDOW_HEAL_FRAC = 0.2;

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
    const crowdBase = base * (1 + p.chainLevel * 0.15);
    // Bombify (v1.36.10) is a genuine AoE payoff (a percent of the target's
    // own maxHp splashed to every other enemy in a wide radius, with
    // chain-reaction potential - see §4-3) even though it's not framed as a
    // per-hit crowd-clearing tool like pierce/chain, so it feeds the same
    // spawn-pace scaling those do rather than sitting outside it for free.
    return crowdBase * (1 + p.bombifyLevel * 0.15);
  }
  function survivalPowerMult(p) {
    // Max HP's own contribution is dampened (only half the overshoot
    // counts) - at full weight, stacking HP mostly just fed back into
    // harder-hitting enemies and cancelled out its own survivability gain.
    // Slow/intercept/weaken count at full weight since they reduce how
    // often the player actually gets hit at all, or how hard, rather than
    // just how tanky a hit is.
    const hpExtra = Math.max(0, p.maxHp / BASELINE_STATS.maxHp - 1) * 0.5;
    const base = 1 + hpExtra;
    return base * (1 + p.slowLevel * 0.15) * (1 + p.interceptLevel * 0.15) * (1 + p.weakenLevel * 0.15);
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

  // Camera zoom (v1.36.23): the 射程アップ upgrade raises rangeMult, which
  // would otherwise let the standard/charge weapons' auto-aim reach well
  // past what's actually visible on screen (weaponRange already extends
  // slightly past the screen edge even at rangeMult=1 - see the overshoot
  // comment above). Tying zoom directly to 1/rangeMult keeps that same
  // "range reaches just past the visible edge" relationship intact
  // regardless of how much rangeMult has grown, rather than the extra
  // range being functionally invisible. rangeMult=1 (no range upgrades
  // taken) gives scale=1 - pixel-identical to the game's behavior before
  // this existed.
  function viewScale(p) {
    return 1 / p.rangeMult;
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
      // Weaken (v1.36.8): no stack counter either, same refresh-on-rehit
      // rule as bombify. Reduces this enemy's own dealt contact damage
      // (both to the player and, if also frenzied, to other enemies) while
      // active - see weakenDmgMultForLevel and its uses in update().
      this.weakenTimer = 0;
      // Set by the emergency-bomb special so its mass-kill burst is exempt
      // from GEM_CAP below - the whole point of that ability is stockpiling
      // gems for one big level-up burst, which the cap would otherwise gut.
      this.forceKilled = false;
    }
  }

  class Projectile {
    constructor(x, y, vx, vy, damage, pierce, radius, explosionRadius, chainHops, slowDuration, poisons, frenzies, bombifies, weakens) {
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
      this.weakens = weakens || false;
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

  // Brief fading wedge for the wide weapon's sweep (see Game.fireWideSweep),
  // sized to match the actual hitbox (range x halfWidth) so what flashes on
  // screen lines up with what could actually get hit.
  class SweepEffect {
    constructor(x, y, angle, range, halfWidth) {
      this.x = x; this.y = y;
      this.angle = angle;
      this.range = range;
      this.halfWidth = halfWidth;
      this.life = 0.15;
      this.maxLife = 0.15;
    }
  }

  // Brief fading beam flash for the charge beam's release (see
  // Game.fireChargeBeam), sized to match the actual hitbox (range x
  // halfWidth). chargeFrac (0-1, how full the charge was) brightens/thickens
  // the flash so a weak tap-release reads as visibly less dramatic than a
  // full-charge release.
  class BeamEffect {
    constructor(x, y, angle, range, halfWidth, chargeFrac) {
      this.x = x; this.y = y;
      this.angle = angle;
      this.range = range;
      this.halfWidth = halfWidth;
      this.chargeFrac = chargeFrac;
      this.life = 0.2;
      this.maxLife = 0.2;
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
      id: 'range',
      title: '射程アップ',
      desc: '射程 +10%(視界も拡大)',
      // rangeMult drives both weaponRange() (standard/charge weapons'
      // auto-aim reach) and viewScale() (camera zoom, see draw()) - the
      // two are deliberately the same multiplier, so a longer reach never
      // extends past what the player can actually see.
      apply: p => p.rangeMult = Math.min(STAT_LIMITS.maxRangeMult, p.rangeMult * 1.1),
      // Once rangeMult is already at its cap, stop offering it rather than
      // presenting a dead choice (same pattern as atkspeed's floor gate).
      available: p => p.rangeMult < STAT_LIMITS.maxRangeMult,
    },
    {
      id: 'movespeed',
      title: '移動速度アップ',
      desc: '移動速度 +10%',
      // Re-added (v1.36.24) after being folded into the base speed and
      // removed entirely in v1.35.0 - that removal's actual complaint was
      // the old version being uncapped (too much speed makes precise
      // dodging harder, but nothing stopped stacking it indefinitely), not
      // that a modest speed upgrade is inherently bad. A cap fixes that
      // directly instead of removing the choice altogether.
      apply: p => p.speedMult = Math.min(STAT_LIMITS.maxSpeedMult, p.speedMult * 1.1),
      available: p => p.speedMult < STAT_LIMITS.maxSpeedMult,
    },
    {
      id: 'pickup',
      title: '回収範囲アップ',
      desc: 'XP回収範囲 +10%',
      // Re-added (v1.36.24) after v1.35.0 folded it into the base pickup
      // radius and removed it - the old complaint was that a single pick
      // already covered practically every situation, making a 2nd+ pick
      // "harmless but pointless." A cap doesn't fix that by itself, but it
      // does mean the choice has a defined ceiling instead of being an
      // open-ended non-choice; how much value the later picks carry is
      // left to feel, not a hard number.
      apply: p => p.pickupRadius = Math.min(STAT_LIMITS.maxPickupRadius, Math.round(p.pickupRadius * 1.1)),
      available: p => p.pickupRadius < STAT_LIMITS.maxPickupRadius,
    },
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
  ];

  // Regen as a choosable upgrade/tradeoff was removed (v1.36.11) - with hits
  // this infrequent, even +1/sec was enough to fully out-heal an occasional
  // graze as long as the player just kept dodging, making it feel too
  // strong for something with no real downside (or, on 生命転化's side, a
  // downside that didn't actually address the same problem). Player.regen
  // itself and its tick in update() are intentionally left in place - a
  // future character passive/special can still grant it directly without
  // it being a pickable upgrade.

  // Floors/ceilings for the tradeoff upgrades below, so stacking the same
  // downside repeatedly can't reduce a stat to uselessness (or, on the
  // cooldown side, to unplayable slowness). Once a stat is saturated at its
  // limit, further picks of that tradeoff still grant the upside "for free".
  // maxRangeMult caps how far the range upgrade can zoom the camera out -
  // unlike damage/maxHp (safe to stack indefinitely), range is tied
  // directly to camera zoom (viewScale), so an uncapped stack would
  // eventually zoom out to the point of hurting readability/performance.
  // maxSpeedMult caps movement speed upgrades - too much speed makes
  // precise dodging harder, the exact problem that got the old uncapped
  // version removed entirely (v1.35.0); a cap keeps the choice meaningful
  // without letting it run away. Set above Speed character's own passive
  // (speedMult *= 1.35, see CHARACTERS) since the cap applies to the same
  // field regardless of source - otherwise the upgrade would already be
  // "available: false" from the very start for that character. maxPickupRadius
  // similarly caps the re-added pickup-range upgrade (v1.36.24, see UPGRADE_POOL).
  const STAT_LIMITS = { minDamage: 3, maxAtkCooldown: 1.4, minAtkCooldown: 0.15, maxRangeMult: 2.0, maxSpeedMult: 1.5, maxPickupRadius: 200 };

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
  // The attack-power reduction that used to be bundled into slow was split
  // out into its own status, 衰弱/weaken (v1.36.8) - slow now only affects
  // movement speed, nothing else.

  // Status-effect indicator dots (v1.36.0): rather than recoloring an
  // enemy's own body per status (which only ever supported showing one
  // status at a time, and fought with hitFlash for the same fillStyle),
  // each active status gets a small dot drawn above the enemy instead - see
  // draw(). Keyed by status name so future statuses (e.g. poison) just add
  // an entry here and a condition in draw() without touching enemy color.
  const STATUS_DOT_COLORS = { slow: '#7ec8ff', poison: '#39d353', frenzy: '#ff8c1a', bombify: '#ff3b3b', weaken: '#aaaaaa' };
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
  // Duration cut 5s -> 3s (v1.36.7): re-hitting the same enemy still
  // refreshes the timer without limit, but the shorter window means a
  // build has to keep focusing fire on one enemy to have a real chance of
  // killing it while still bombified, rather than tagging a bunch of
  // enemies once and letting the crowd's natural kill pace trigger it.
  const BOMBIFY_DURATION = 3;
  const BOMBIFY_RADIUS = 180;
  function bombifyDmgPctForLevel(level) { return 0.3 + 0.1 * (level - 1); }

  // Weaken (v1.36.8): split out of slow, which used to also halve a
  // slowed enemy's contact damage - that coupling meant taking slow always
  // meant taking a damage debuff too, with no way to get one without the
  // other. Weaken is now its own gated pick (like bombify, only appears
  // once slow is maxed) so a player who wants the offense-suppression
  // effect specifically has to actually invest in it. Same non-stacking,
  // refresh-on-rehit design as bombify: no stack count, a later hit just
  // resets weakenTimer to WEAKEN_DURATION. Rank raises the damage
  // reduction directly, reusing bombify's exact 30%->70% curve.
  const WEAKEN_DURATION = 5;
  function weakenDmgMultForLevel(level) { return 1 - (0.3 + 0.1 * (level - 1)); }

  // Threat vignette: difficulty-driven enemy stats scale flexibly enough
  // that a player can't eyeball "difficulty N means this much contact
  // damage" - so instead of a numeric readout, warn directly whenever an
  // enemy within THREAT_RADIUS could one-shot the player at its current
  // effective damage (frenzy/weaken multipliers included), checked every
  // frame in the same loop that already computes those multipliers.
  const THREAT_RADIUS = 220;

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
      // Wide weapon hits every enemy in its cone in one go, and the charge
      // beam already has unconditional infinite pierce baked in (§7-4-1,
      // §7-4-2) - both have no travel/pierce lifecycle at all, so pierce
      // would be a completely dead pick for either. Hide it entirely
      // rather than presenting a choice that does nothing.
      available: p => !p.weapon || (p.weapon.id !== 'wide' && p.weapon.id !== 'charge'),
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
      introDesc: `着弾した敵を${FRENZY_DURATION}秒間の狂乱状態にする。狂乱状態の敵は移動速度が${FRENZY_SPEED_MULT}倍になり、重ね掛け数に応じて攻撃力が増加する(1スタックあたり+${Math.round(FRENZY_DMG_MULT_PER_STACK * 100)}%)。狂乱状態の敵は、自機だけでなく接触した他の敵にもこの強化された攻撃力でダメージを与えるようになる。持続時間は重ね掛けで延長されない。`,
      upgradeDesc: level => `狂乱の重ね掛け上限が増加する(最大${frenzyMaxStacksForLevel(level)}スタック → 最大${frenzyMaxStacksForLevel(level + 1)}スタック)`,
    },
    {
      id: 'bombify',
      name: '爆弾化',
      maxLevel: 5,
      getLevel: p => p.bombifyLevel,
      levelUp: p => { p.bombifyLevel++; },
      // Gated behind 爆発 being fully ranked up (v1.36.7) - on its own,
      // stacking with poison/frenzy/explosion made it too strong too early.
      // Requiring the player to already have committed to explosion's own
      // maxLevel first pushes it later into a run and onto builds that
      // have already invested in AoE.
      available: p => p.explosionLevel >= 5,
      introDesc: `着弾した敵を${BOMBIFY_DURATION}秒間爆弾化する。生存中は特に効果はないが、爆弾化状態のまま倒された敵は、その敵自身の最大HPの${Math.round(bombifyDmgPctForLevel(1) * 100)}%を周囲(半径${BOMBIFY_RADIUS}px)の他の敵に爆発ダメージとして与える。重ね掛けはされず、再度攻撃が当たると持続時間が最大まで更新される`,
      upgradeDesc: level => `爆弾化ダメージが増加する(敵自身の最大HPの${Math.round(bombifyDmgPctForLevel(level) * 100)}% → ${Math.round(bombifyDmgPctForLevel(level + 1) * 100)}%)`,
    },
    {
      id: 'weaken',
      name: '衰弱',
      maxLevel: 5,
      getLevel: p => p.weakenLevel,
      levelUp: p => { p.weakenLevel++; },
      // Gated behind 低速 being fully ranked up, same idea as bombify/爆発.
      available: p => p.slowLevel >= 5,
      introDesc: `着弾した敵を${WEAKEN_DURATION}秒間衰弱状態にし、攻撃力を${Math.round((1 - weakenDmgMultForLevel(1)) * 100)}%低下させる。重ね掛けはされず、再度攻撃が当たると持続時間が最大まで更新される`,
      upgradeDesc: level => `衰弱による攻撃力低下率が増加する(${Math.round((1 - weakenDmgMultForLevel(level)) * 100)}% → ${Math.round((1 - weakenDmgMultForLevel(level + 1)) * 100)}%)`,
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
  // player can decline a bad draw. No stat changes, and (see apply below)
  // undoes the level-up itself rather than letting it stand - otherwise
  // "declining" a bad draw would still have consumed a level (raising
  // xpNext for the real level-up after it, via xpNextForLevel's curve)
  // for nothing in return. The refund percentage is per-player
  // (p.skipRefundPct) rather than a fixed 30%, so a character passive can
  // raise it - hence desc is a function of the current player instead of
  // a static string.
  const SKIP_REFUND_PCT_BASE = 0.3;
  const SKIP_UPGRADE = {
    id: 'skip',
    title: 'スキップ',
    desc: p => `強化なし。このレベルアップを見送り、現レベルを維持したまま次のレベルアップまでのXPを${Math.round(p.skipRefundPct * 100)}%獲得した状態にする`,
    apply: p => {
      // gainXp() already incremented p.level/xpNext and re-applied the
      // weapon's innate effect (in case it just ranked up) before this
      // screen was ever shown - roll all three back to how they were
      // immediately before that happened, then refund a percentage of the
      // (now-reverted, lower) xpNext, so skipping never comes with a
      // free-floating level the player got nothing for.
      p.level--;
      p.xpNext = xpNextForLevel(p.level);
      p.applyWeaponInnateEffect();
      p.xp = p.xpNext * p.skipRefundPct;
    },
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
      this.sweepEffects = [];
      this.beamEffects = [];
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
      this.wave = 1;
      this.threatNearby = false;
      this.levelCheckTimer = DIFFICULTY_CHECK_INTERVAL;
      this.totalSpawned = 0;
      this.spawnedAtCheckpoint = 0;
      // Kills since the last wave checkpoint (unlike this.kills, a lifetime
      // total left untouched by any of this) - reset to 0 at each wave
      // boundary (see update()).
      this.killsThisWave = 0;
      // How many enemies were already alive (backlog carried over from the
      // previous wave) at the moment the current wave started - captured
      // at each checkpoint for use by the *next* one. The kill-rate
      // denominator is this backlog plus the wave's own new spawns
      // (aliveAtWaveStart + spawnedThisWindow), not spawns alone - a kill
      // of a backlog enemy is real progress the player should get credit
      // for, and without the backlog term the denominator undercounts
      // everything actually facing the player that wave, letting the rate
      // read >100% if enough backlog gets cleared. 0 for wave 1 (nothing
      // could have carried over before the game started).
      this.aliveAtWaveStart = 0;

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
      // `available` is the same opt-in gate used by UPGRADE_POOL/
      // TRADEOFF_POOL below - most BULLET_EFFECTS have no such prerequisite,
      // only bombify/weaken do (require explosion/slow maxed respectively -
      // see their definitions).
      const notMaxedEffects = BULLET_EFFECTS.filter(eff =>
        eff.getLevel(this.player) < eff.maxLevel && (!eff.available || eff.available(this.player))
      );
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

      // Charge beam isn't driven by atkTimer/atkCooldown as a per-shot
      // cooldown at all (see updateChargeBeam) - it needs to keep charging
      // even with zero enemies on screen, so it's branched off before
      // either of the guards below would otherwise skip it.
      if (p.weapon && p.weapon.id === 'charge') { this.updateChargeBeam(dt); return; }

      p.atkTimer -= dt;
      if (p.atkTimer > 0) return;
      if (this.enemies.length === 0) return;

      if (p.weapon && p.weapon.id === 'wide') { this.fireWideSweep(); return; }

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
      const weakens = p.weakenLevel > 0;
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
        this.projectiles.push(new Projectile(p.x, p.y, vx, vy, shotDamage, p.pierce, 5, explosionRadius, chainHops, slowDuration, poisons, frenzies, bombifies, weakens));
      }
    }

    // Wide weapon's attack (see WEAPONS): an instant cone-shaped sweep
    // instead of a traveling Projectile - every enemy within
    // WIDE_ATTACK_RANGE and inside the cone's width is hit in one go, no
    // travel time and no pierce/hitSet lifecycle to track. Aims at the
    // single nearest in-range enemy, same "ignore anything out of reach"
    // rule as the standard weapon, but gated to WIDE_ATTACK_RANGE (much
    // shorter than weaponRange()) so this weapon only works at melee range.
    // Backshot (v1.36.17): the identical sweep also fires in the exact
    // opposite direction at the same time, covering the player's blind
    // spot - deliberately added as a second direction rather than a longer
    // WIDE_ATTACK_RANGE, so the weapon's "high-risk, must get in close"
    // identity survives while its biggest practical gap (an enemy closing
    // in from directly behind) gets covered.
    fireWideSweep() {
      const p = this.player;
      const range2 = WIDE_ATTACK_RANGE * WIDE_ATTACK_RANGE;
      let nearest = null, nearestD2 = range2;
      for (const e of this.enemies) {
        const d2 = dist2(e.x, e.y, p.x, p.y);
        if (d2 <= nearestD2) { nearest = e; nearestD2 = d2; }
      }
      if (!nearest) return;
      p.atkTimer = p.atkCooldown;

      const aimAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      const halfWidth = p.wideHalfWidth;
      // Rotate each candidate into the sweep's local frame (forward =
      // +localX) so both the front cone and its mirrored backshot become
      // simple axis-aligned box tests: front reach up to WIDE_ATTACK_RANGE
      // in +localX, back reach the same distance in -localX, lateral
      // spread up to halfWidth on either side of the axis (plus the
      // enemy's own radius, so an enemy just grazing the edge still
      // counts, matching the +radius margin used elsewhere).
      const cosA = Math.cos(-aimAngle), sinA = Math.sin(-aimAngle);

      const buffDamageMult = p.specialBuffTimer > 0 && p.special && p.special.buffDamageMult != null
        ? p.special.buffDamageMult : 1;
      // Virtual "projectile" carrying the same bullet-effect flags a real
      // shot would - never added to this.projectiles (no travel, no
      // pierce/hitSet), just handed to resolveProjectileHit per struck
      // enemy so both attack types share identical hit-resolution logic.
      const virtualProj = {
        damage: p.damage * buffDamageMult * WIDE_DAMAGE_MULT,
        explosionRadius: p.explosionLevel > 0 ? explosionRadiusForLevel(p.explosionLevel) : 0,
        chainHops: p.chainLevel,
        slowDuration: p.slowLevel > 0 ? slowDurationForLevel(p.slowLevel) : 0,
        poisons: p.poisonLevel > 0,
        frenzies: p.frenzyLevel > 0,
        bombifies: p.bombifyLevel > 0,
        weakens: p.weakenLevel > 0,
      };

      let hitAny = false;
      for (const e of this.enemies) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const localX = dx * cosA - dy * sinA;
        const localY = dx * sinA + dy * cosA;
        if (Math.abs(localY) > halfWidth + e.radius) continue;
        const inFront = localX >= -e.radius && localX <= WIDE_ATTACK_RANGE + e.radius;
        const inBack = localX <= e.radius && localX >= -WIDE_ATTACK_RANGE - e.radius;
        if (!inFront && !inBack) continue;
        hitAny = true;
        this.resolveProjectileHit(virtualProj, e);
      }
      if (!hitAny) return;

      this.sweepEffects.push(new SweepEffect(p.x, p.y, aimAngle, WIDE_ATTACK_RANGE, halfWidth));
      this.sweepEffects.push(new SweepEffect(p.x, p.y, aimAngle + Math.PI, WIDE_ATTACK_RANGE, halfWidth));
      this.shakeTime = Math.max(this.shakeTime, 0.08);
    }

    // Charge beam's per-frame tick (see WEAPONS): accumulates p.chargeTime
    // while the move-input is actively held (isMoveInputHeld - the same
    // gesture that drives movement, so charging never costs mobility),
    // capped at this player's current max (chargeMaxStages *
    // CHARGE_TIME_PER_STAGE - see WEAPONS' innate effect for how rank
    // raises chargeMaxStages). atkCooldown (lowered by the atkspeed
    // upgrade like any other weapon) is read as a charge-rate multiplier
    // against ATK_COOLDOWN_BASE rather than as a per-shot cooldown, so
    // investing in attack speed still pays off for this weapon. Firing
    // happens on the falling edge of "held" (release), not on a timer - but
    // only once stage 1 (CHARGE_TIME_PER_STAGE) has actually been reached;
    // a release below that threshold just resets chargeTime with no shot
    // at all, the same as any other release, closing the "rapid-tap = free
    // rapid-fire" loophole a zero-minimum would otherwise leave open.
    updateChargeBeam(dt) {
      const p = this.player;
      const holding = isMoveInputHeld();
      if (holding) {
        const chargeRate = ATK_COOLDOWN_BASE / p.atkCooldown;
        const chargeTimeMax = p.chargeMaxStages * CHARGE_TIME_PER_STAGE;
        p.chargeTime = Math.min(chargeTimeMax, p.chargeTime + dt * chargeRate);
      }
      if (p.chargeWasHeld && !holding) {
        if (p.chargeTime >= CHARGE_TIME_PER_STAGE) this.fireChargeBeam();
        else p.chargeTime = 0;
      }
      p.chargeWasHeld = holding;
    }

    // Fires the charge beam on release: an instant, infinite-pierce hit
    // along a straight line toward the nearest in-range enemy, using the
    // same rotated-local-frame box test as the wide weapon's sweep
    // (fireWideSweep) but reaching out to the normal long weaponRange()
    // instead of a short melee range, and in one direction only. Damage is
    // a flat CHARGE_DAMAGE_MULT regardless of how long it was held - what
    // scales with hold time is the beam's width, in discrete steps per
    // completed stage (chargeHalfWidthForStage), since a longer wait means
    // more enemies have accumulated on screen to clear, not a need to hit
    // harder. chargeTime always resets to 0 on release, even if no target
    // was in range to actually hit - committing to a release at the wrong
    // moment genuinely wastes the charge.
    fireChargeBeam() {
      const p = this.player;
      const stage = Math.min(p.chargeMaxStages, Math.floor(p.chargeTime / CHARGE_TIME_PER_STAGE));
      p.chargeTime = 0;

      const range = weaponRange(p);
      let nearest = null, nearestD2 = range * range;
      for (const e of this.enemies) {
        const d2 = dist2(e.x, e.y, p.x, p.y);
        if (d2 <= nearestD2) { nearest = e; nearestD2 = d2; }
      }
      if (!nearest) return;

      const aimAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      const halfWidth = chargeHalfWidthForStage(stage);
      const cosA = Math.cos(-aimAngle), sinA = Math.sin(-aimAngle);

      const buffDamageMult = p.specialBuffTimer > 0 && p.special && p.special.buffDamageMult != null
        ? p.special.buffDamageMult : 1;
      const virtualProj = {
        damage: p.damage * buffDamageMult * CHARGE_DAMAGE_MULT,
        explosionRadius: p.explosionLevel > 0 ? explosionRadiusForLevel(p.explosionLevel) : 0,
        chainHops: p.chainLevel,
        slowDuration: p.slowLevel > 0 ? slowDurationForLevel(p.slowLevel) : 0,
        poisons: p.poisonLevel > 0,
        frenzies: p.frenzyLevel > 0,
        bombifies: p.bombifyLevel > 0,
        weakens: p.weakenLevel > 0,
      };

      let hitAny = false;
      for (const e of this.enemies) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const localX = dx * cosA - dy * sinA;
        const localY = dx * sinA + dy * cosA;
        if (localX < -e.radius || localX > range + e.radius) continue;
        if (Math.abs(localY) > halfWidth + e.radius) continue;
        hitAny = true;
        this.resolveProjectileHit(virtualProj, e);
      }
      if (!hitAny) return;

      const stageFrac = stage / p.chargeMaxStages;
      this.beamEffects.push(new BeamEffect(p.x, p.y, aimAngle, range, halfWidth, stageFrac));
      this.shakeTime = Math.max(this.shakeTime, 0.1 + stageFrac * 0.2);
    }

    // Applies every status effect a projectile carries (slow/poison/
    // frenzy/bombify/weaken) to one target enemy. Shared between the
    // primary hit and each chain hop (see update()) so the two paths can't
    // silently drift apart as new status effects get added - chain used to
    // only forward slow (and, via a separate check, explosion), leaving
    // poison/frenzy/bombify/weaken unable to ever spread through it.
    applyOnHitStatuses(proj, target) {
      const p = this.player;
      if (proj.slowDuration > 0) target.slowTimer = Math.max(target.slowTimer, proj.slowDuration);
      if (proj.poisons) {
        if (target.poisonTimer <= 0) { target.poisonTimer = POISON_DURATION; target.poisonStacks = 1; }
        else target.poisonStacks = Math.min(poisonMaxStacksForLevel(p.poisonLevel), target.poisonStacks + 1);
      }
      if (proj.frenzies) {
        if (target.frenzyTimer <= 0) { target.frenzyTimer = FRENZY_DURATION; target.frenzyStacks = 1; }
        else target.frenzyStacks = Math.min(frenzyMaxStacksForLevel(p.frenzyLevel), target.frenzyStacks + 1);
      }
      if (proj.bombifies) target.bombifyTimer = BOMBIFY_DURATION; // no stacking - just (re)starts at full duration
      if (proj.weakens) target.weakenTimer = WEAKEN_DURATION; // no stacking - just (re)starts at full duration
    }

    // Applies a single hit's damage, on-hit statuses, explosion splash, and
    // chain propagation. Shared between a normal projectile's collision
    // (see update()) and the wide weapon's instant sweep (fireWideSweep),
    // which hits every enemy in its cone the same way but has no
    // travel/pierce lifecycle of its own. `proj` only needs to duck-type
    // the fields read here (damage/explosionRadius/chainHops/statuses) - it
    // doesn't have to be a real Projectile instance.
    resolveProjectileHit(proj, e) {
      e.hp -= proj.damage;
      e.hitFlash = 0.12;
      this.applyOnHitStatuses(proj, e);

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
          this.applyOnHitStatuses(proj, nearest);
          this.chainZaps.push(new ChainZap(fromX, fromY, nearest.x, nearest.y));

          // Chain's role is spreading damage/status to more targets, not
          // diminishing whatever it spreads - so if explosion is also
          // equipped, each chained hit detonates its own explosion too,
          // using the player's full attack power (proj.damage) rather than
          // chain's own reduced damage.
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
        // Denominator is the full pool the player actually had to deal
        // with this wave - backlog carried in from the previous wave
        // (aliveAtWaveStart) plus this wave's own new spawns - not just
        // new spawns alone. Killing a backlog enemy is real progress and
        // has to count, or the rate can't reach 100% even when the player
        // fully clears the field; killsThisWave is a plain tally of every
        // kill since the last checkpoint (no filtering by which wave the
        // kill's target spawned in needed), so it's naturally bounded by
        // this pool - you can't kill more than what existed to kill.
        const spawnedThisWindow = this.totalSpawned - this.spawnedAtCheckpoint;
        const poolThisWindow = this.aliveAtWaveStart + spawnedThisWindow;
        const killsThisWindow = this.killsThisWave;
        const killRate = poolThisWindow > 0 ? killsThisWindow / poolThisWindow : 1;
        this.wave++;

        // Every window heals a flat WINDOW_HEAL_FRAC of maxHp, regardless
        // of performance or rush - the closest thing to a passive recovery
        // tool left now that regen/生命転化 aren't pickable upgrades
        // (v1.36.11). A rush-concluding window adds RUSH_HEAL_FRAC on top
        // (see below) for a bigger combined heal.
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * WINDOW_HEAL_FRAC);

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
          // Payoff: heal an additional RUSH_HEAL_FRAC of maxHp (on top of
          // the WINDOW_HEAL_FRAC heal above, for 45% total) and sweep every
          // gem currently on screen straight into XP, rewarding the player
          // for having just weathered the burst instead of interrupting
          // play with forced level-up picks.
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
        this.killsThisWave = 0;
        // Whatever's still alive right now carries into the new wave as
        // its starting backlog, read by this same block next checkpoint.
        this.aliveAtWaveStart = this.enemies.length;
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
      let threatNearby = false;
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
        if (e.weakenTimer > 0) e.weakenTimer -= dt;

        // Frenzied enemies hit harder, weakened enemies hit softer - both
        // stack multiplicatively in the unlikely case a build applies both
        // to the same enemy. Slow itself no longer touches damage (that's
        // weaken's job now, split apart in v1.36.8). Computed once here so
        // both the contact-damage check and the threat-vignette check below
        // agree on the same effective damage value.
        const frenzyDmgMult = e.frenzyTimer > 0 ? 1 + e.frenzyStacks * FRENZY_DMG_MULT_PER_STACK : 1;
        const weakenDmgMult = e.weakenTimer > 0 ? weakenDmgMultForLevel(p.weakenLevel) : 1;
        const effDmg = e.dmg * frenzyDmgMult * weakenDmgMult;

        if (d < THREAT_RADIUS && effDmg >= p.hp) threatNearby = true;

        if (d < e.radius + p.radius && e.contactCd <= 0) {
          p.takeDamage(effDmg);
          // Passive hook for characters like Tank whose passive reacts to
          // being hit (e.g. reflect damage). Fires on the contact event
          // itself, not gated on invulnerability - the enemy touched the
          // player either way.
          if (p.passive && p.passive.onContactDamage) p.passive.onContactDamage(p, e, this);
          e.contactCd = 0.5;
          this.shakeTime = 0.15;
        }
      }
      this.threatNearby = threatNearby;

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
        const weakenDmgMult = e.weakenTimer > 0 ? weakenDmgMultForLevel(p.weakenLevel) : 1;
        for (const other of this.enemies) {
          if (other === e) continue;
          const rr = e.radius + other.radius;
          if (dist2(e.x, e.y, other.x, other.y) < rr * rr) {
            other.hp -= e.dmg * frenzyDmgMult * weakenDmgMult;
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
            proj.hitSet.add(e);
            this.resolveProjectileHit(proj, e);
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
          this.killsThisWave++;
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

      // wide weapon sweep flashes
      for (const sw of this.sweepEffects) sw.life -= dt;
      this.sweepEffects = this.sweepEffects.filter(sw => sw.life > 0);

      // charge beam flashes
      for (const b of this.beamEffects) b.life -= dt;
      this.beamEffects = this.beamEffects.filter(b => b.life > 0);

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
      difficultyEl.textContent = `ウェーブ${this.wave} 残り${Math.ceil(this.levelCheckTimer)}秒 難易度${this.difficulty}`;
      // Live view of the same window the difficulty checkpoint judges (see
      // its pool-based formula above) - shows "--" until there's anything
      // in the pool yet (nothing carried over and nothing spawned), since
      // dividing by zero has no meaningful rate.
      const spawnedThisWindow = this.totalSpawned - this.spawnedAtCheckpoint;
      const poolThisWindow = this.aliveAtWaveStart + spawnedThisWindow;
      killRateEl.textContent = poolThisWindow > 0
        ? `撃破率 ${Math.round((this.killsThisWave / poolThisWindow) * 100)}%`
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

      threatVignetteEl.classList.toggle('active', this.threatNearby);
    }

    draw() {
      ctx.clearRect(0, 0, W, H);

      let shakeX = 0, shakeY = 0;
      if (this.shakeTime > 0 && !paused && !this.levelingUp) {
        shakeX = rand(-4, 4);
        shakeY = rand(-4, 4);
      }

      // Camera transform: everything below draws in plain world
      // coordinates (matching the same units gameplay logic already uses
      // elsewhere), with translation AND zoom handled once here instead of
      // manually adding an offX/offY to every single coordinate. Shake is
      // applied as a raw screen-pixel nudge OUTSIDE the zoom scale, so it
      // reads as a constant-size camera jolt regardless of current zoom
      // level, rather than shrinking/growing with it.
      const scale = viewScale(this.player);
      ctx.save();
      ctx.translate(W / 2 + shakeX, H / 2 + shakeY);
      ctx.scale(scale, scale);
      ctx.translate(-this.camX, -this.camY);

      // background grid - swept across the currently visible world extent,
      // which grows as scale shrinks (further zoomed out covers more world
      // per screen), so the grid always fills the screen regardless of zoom.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1 / scale;
      const gridSize = 64;
      const viewHalfW = (W / 2) / scale;
      const viewHalfH = (H / 2) / scale;
      const left = this.camX - viewHalfW, right = this.camX + viewHalfW;
      const top = this.camY - viewHalfH, bottom = this.camY + viewHalfH;
      const startGX = Math.floor(left / gridSize) * gridSize;
      const startGY = Math.floor(top / gridSize) * gridSize;
      for (let x = startGX; x <= right; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      }
      for (let y = startGY; y <= bottom; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      }
      ctx.restore();

      // gems
      for (const g of this.gems) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#7fffd4';
        ctx.fillRect(-g.radius, -g.radius, g.radius * 2, g.radius * 2);
        ctx.restore();
      }

      // enemies
      for (const e of this.enemies) {
        ctx.beginPath();
        ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
        ctx.arc(e.x, e.y, e.radius, 0, TAU);
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
        // Bombify/weaken don't stack, so just a single dot each like slow.
        if (e.bombifyTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.bombify);
        if (e.weakenTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.weaken);
        if (activeStatusDots.length > 0) {
          const dotRadius = 3;
          const dotSpacing = 9;
          const dotY = e.y - e.radius - 8;
          const rowStartX = e.x - (activeStatusDots.length - 1) * dotSpacing / 2;
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
        ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.radius, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // chain zaps
      for (const zap of this.chainZaps) {
        ctx.globalAlpha = clamp(zap.life / zap.maxLife, 0, 1);
        ctx.strokeStyle = '#7ec8ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(zap.x1, zap.y1);
        ctx.lineTo(zap.x2, zap.y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // projectiles
      for (const proj of this.projectiles) {
        ctx.beginPath();
        ctx.fillStyle = '#ffe45a';
        ctx.arc(proj.x, proj.y, proj.radius, 0, TAU);
        ctx.fill();
      }

      // wide weapon sweep flashes - concentric crescent arcs facing the
      // swing's direction (the "))) " look originally envisioned), rather
      // than drawing the literal rectangular hitbox shape itself. The angle
      // spanned by each arc is derived from the same range/halfWidth the
      // hit test actually uses, so a wider rank visibly reads as a wider
      // sweep even though the arcs themselves are a stylization, not the
      // hitbox outline (see Game.fireWideSweep).
      for (const sw of this.sweepEffects) {
        const alpha = clamp(sw.life / sw.maxLife, 0, 1);
        const angHalf = Math.atan2(sw.halfWidth, sw.range);
        ctx.save();
        ctx.translate(sw.x, sw.y);
        ctx.rotate(sw.angle);
        ctx.strokeStyle = '#ffe45a';
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const r = sw.range * (0.5 + i * 0.18);
          ctx.globalAlpha = alpha * (0.8 - i * 0.2);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, r, -angHalf, angHalf);
          ctx.stroke();
        }
        ctx.restore();
      }

      // charge beam release flashes - a straight glowing bar spanning the
      // actual hitbox (range x halfWidth), brighter/thicker the fuller the
      // charge was (see Game.fireChargeBeam).
      for (const b of this.beamEffects) {
        const lifeAlpha = clamp(b.life / b.maxLife, 0, 1);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.globalAlpha = lifeAlpha * (0.5 + b.chargeFrac * 0.5);
        ctx.fillStyle = b.chargeFrac > 0.9 ? '#eaffff' : '#8ef0ff';
        ctx.beginPath();
        ctx.moveTo(0, -b.halfWidth);
        ctx.lineTo(b.range, -b.halfWidth);
        ctx.lineTo(b.range, b.halfWidth);
        ctx.lineTo(0, b.halfWidth);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // player
      const p = this.player;
      ctx.save();
      if (p.invulnTimer > 0 && Math.floor(this.time * 20) % 2 === 0) ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.fillStyle = '#3ad1ff';
      ctx.arc(p.x, p.y, p.radius, 0, TAU);
      ctx.fill();
      // eyes to show facing
      ctx.fillStyle = '#0d0d12';
      ctx.beginPath();
      ctx.arc(p.x + p.facing * 5, p.y - 4, 2.5, 0, TAU);
      ctx.fill();
      ctx.restore();

      // charge beam charging indicator - a ring around the player that
      // grows and brightens with p.chargeTime, so the player has live
      // feedback on how much they'd lose by releasing right now. Dim gray
      // below stage 1 (CHARGE_TIME_PER_STAGE - releasing now would fire
      // nothing), switching to the normal cyan progression once a release
      // would actually land a shot. The ring itself still grows smoothly
      // (continuous chargeFrac) as ambient "how close to the next stage"
      // feedback, even though the beam's actual width only changes in the
      // discrete per-stage steps the aim preview below shows.
      if (p.weapon && p.weapon.id === 'charge' && p.chargeTime > 0) {
        const chargeTimeMax = p.chargeMaxStages * CHARGE_TIME_PER_STAGE;
        const chargeFrac = clamp(p.chargeTime / chargeTimeMax, 0, 1);
        const canFire = p.chargeTime >= CHARGE_TIME_PER_STAGE;
        ctx.save();
        ctx.globalAlpha = canFire ? 0.5 + chargeFrac * 0.5 : 0.35;
        ctx.strokeStyle = !canFire ? '#888888' : chargeFrac > 0.9 ? '#eaffff' : '#8ef0ff';
        ctx.lineWidth = canFire ? 2 + chargeFrac * 3 : 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius + 6 + chargeFrac * 10, 0, TAU);
        ctx.stroke();
        ctx.restore();

        // Aim preview: which enemy fireChargeBeam would actually target if
        // released this instant, and the exact hitbox (direction + current
        // stage's width) that would result - re-derived fresh every frame
        // with the same nearest-in-range-enemy search fireChargeBeam
        // itself uses, so it's never out of sync with where a real release
        // would go. Solves "which direction will it fire" being otherwise
        // invisible until the shot has already committed.
        const range = weaponRange(p);
        let previewTarget = null, previewD2 = range * range;
        for (const e of this.enemies) {
          const d2 = dist2(e.x, e.y, p.x, p.y);
          if (d2 <= previewD2) { previewTarget = e; previewD2 = d2; }
        }
        if (previewTarget) {
          const aimAngle = Math.atan2(previewTarget.y - p.y, previewTarget.x - p.x);
          const stage = Math.min(p.chargeMaxStages, Math.floor(p.chargeTime / CHARGE_TIME_PER_STAGE));
          const halfWidth = chargeHalfWidthForStage(Math.max(1, stage));
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(aimAngle);
          ctx.globalAlpha = canFire ? 0.5 : 0.3;
          ctx.strokeStyle = canFire ? '#8ef0ff' : '#888888';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(0, -halfWidth);
          ctx.lineTo(range, -halfWidth);
          ctx.lineTo(range, halfWidth);
          ctx.lineTo(0, halfWidth);
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

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
    if (p.weakenLevel > 0) bulletLines.push(`衰弱 Lv.${p.weakenLevel}`);
    pauseStatsEl.innerHTML = `
      <p>HP: ${Math.ceil(p.hp)} / ${p.maxHp}</p>
      <p>レベル: ${p.level}</p>
      <p>ダメージ: ${p.damage} / 攻撃間隔: ${p.atkCooldown.toFixed(2)}秒</p>
      <p>同時発射数: ${p.projCount} / 射程: ${Math.round(p.rangeMult * 100)}%</p>
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
