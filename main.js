(() => {
  'use strict';

  const GAME_VERSION = '1.36.93';
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
  const heartCompassEl = document.getElementById('heart-compass');
  const heartCompassNeedleEl = heartCompassEl.querySelector('.compass-needle');
  const killsEl = document.getElementById('kills');
  const startScreen = document.getElementById('start-screen');
  const characterSelectScreen = document.getElementById('character-select-screen');
  const characterChoicesEl = document.getElementById('character-choices');
  const weaponChoicesEl = document.getElementById('weapon-choices');
  const confirmCharacterBtn = document.getElementById('confirm-character-btn');
  const levelupScreen = document.getElementById('levelup-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const upgradeChoicesEl = document.getElementById('upgrade-choices');
  const upgradePicksEl = document.getElementById('upgrade-picks');
  const rejectHintEl = document.getElementById('reject-hint');
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
  // Reflect passive scales off two of the player's own stats rather than a
  // fixed number, so investing in either raw damage or max HP both feed
  // back into how hard the counter hits.
  const REFLECT_DMG_PCT_OF_ATTACK = 0.3;
  const REFLECT_DMG_PCT_OF_MAXHP = 0.08;

  // 鉄の反撃(旧タンクのパッシブ)。ヒーラーへの改名(v1.36.65)に伴い自然回復
  // パッシブへ差し替えたため、現在はどのキャラクターにも割り当てられていない
  // - ただし処理自体は将来の再利用に備えてそのまま残してある(onContactDamage
  // フックの仕組み自体はキャラクター固有ではない汎用の仕組みなので、この定数
  // ・オブジェクトを消してもエンジン側には影響しない)。
  const REFLECT_PASSIVE = {
    name: '鉄の反撃',
    desc: '被ダメージ時、攻撃してきた敵に反射ダメージを与える',
    apply(p) {},
    onContactDamage(p, enemy, game) {
      const reflect = Math.round(p.damage * REFLECT_DMG_PCT_OF_ATTACK + p.maxHp * REFLECT_DMG_PCT_OF_MAXHP);
      game.damageEnemy(enemy, reflect);
      enemy.hitFlash = 0.12;
    },
  };

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
        desc: 'その場にいる敵を強制撃破し、一定時間ジェム回収範囲が拡大し獲得XPも増加する',
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
        desc: 'レベルアップの「スキップ」時に払い戻されるXPが増加する',
        apply(p) { p.skipRefundPct = 0.6; },
      },
    },
    {
      id: 'healer',
      // タンク→ヒーラーへ改名(v1.36.65): 移動速度が遅いという特徴が、
      // fast・ガンナーのような足の速い/遠距離型の敵に対して回避不能な
      // 不利になり、「移動速度アップグレードを取らないと一部ウェーブを
      // 突破できない」というバランス崩壊を起こしていたため、移動速度の
      // ペナルティ自体を撤廃し、代わりにHP自然回復を持つ耐久型に再設計。
      name: 'ヒーラー',
      desc: '最大HPがやや高く、移動速度はスタンダードと同じタフ型。攻撃力は控えめだが、HPが時間経過で徐々に回復するパッシブを持つ。',
      apply: (p) => {
        p.maxHp = 130;
        p.hp = p.maxHp;
        p.damage = Math.max(STAT_LIMITS.minDamage, Math.round(p.damage * 0.7));
      },
      // Special: a burst of survivability rather than raw offense - heals
      // a big chunk back and grants a temporary mobility window to
      // reposition/collect gems instead of just tanking hits in place.
      // Short cooldown relative to Standard's bomb since it's a sustain
      // tool, not a one-shot-clears-the-screen panic button.
      special: {
        name: 'リカバリーダッシュ',
        // 被ダメージ70%カット追加(v1.36.34): 移動速度アップだけだと結局
        // 発動中に被弾すればすぐHPが減り戻ってしまい、「回復してもすぐ
        // 相殺される」感が強かった。効果時間中は被ダメージそのものを
        // 大きく抑えることで、回復した分を維持しやすい真の耐久バフにした。
        desc: '最大HPを大きく回復し、一定時間移動速度が上昇し被ダメージも大幅に軽減される',
        cooldown: 60,
        buffSpeedMult: 1.5,
        buffDamageTakenMult: 0.3,
        activate(p, game) {
          p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5);
          p.specialBuffTimer = 20;
        },
      },
      // Passive: always-on HP regen (v1.36.65, replaces the old reflect
      // passive - see REFLECT_PASSIVE below). Matches the old removed
      // 'リジェネ' upgrade's rate exactly (+1/sec) rather than inventing a
      // new number.
      passive: {
        name: '自然回復',
        desc: 'HPが時間経過で徐々に回復する',
        apply(p) { p.regen += 1; },
      },
    },
    {
      id: 'speed',
      name: 'スピード',
      desc: '最大HPが低く、移動速度が速い機動型。攻撃速度が大幅に上昇する代わりに攻撃力が低下するパッシブを持つ、操作難易度が高い上級者向け。',
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
        desc: '一定時間、攻撃力が上昇しジェム回収範囲も大幅に拡大する',
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
        desc: '攻撃速度が大幅に上昇する代わりに、攻撃力が低下する',
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

  // Drones (v1.36.63, reframed from a single-slot "aux weapon" into
  // independently-owned drones in v1.36.82): passive auras around the
  // player, independent of any bullet hit, that act on whatever enemies get
  // too close. Any number of drone types can be owned at once - owning N of
  // a given type means N drones of that type are active, which is also
  // exactly droneTargetCount's N (how many nearby enemies that type can
  // affect at once, nearest-first). What actually happens to each affected
  // enemy differs per drone type (see the dispatch in update()).
  // DRONE_RANGE_BASE predates this generalization (jamming, née intercept,
  // was the only drone, and the sole bullet effect this aura ever applied)
  // - kept as a neutral base name since WIDE_ATTACK_RANGE (the unrelated
  // Pulse Wave weapon's range, below) also piggybacks on it.
  const DRONE_RANGE_BASE = 60;
  function droneTargetCount(count) { return count; }
  // Attack interval (v1.36.64, shortened v1.36.67, quadrupled v1.36.84): a
  // drone originally applied its effect every single frame to anything in
  // range - far stronger than intended (it effectively never let go once
  // something wandered in). Gated to once every DRONE_ATK_INTERVAL seconds
  // instead, like a real weapon's cooldown, rather than a continuous
  // field. Shortened from 1.0s to 0.5s in v1.36.67 (alongside widening the
  // aura itself, see DRONE_RADIUS_BASE) to compensate for the v1.36.66
  // wasted-cooldown fix having made it feel weaker overall. Quadrupled
  // again to 2.0s in v1.36.84 as an explicit balance pass once three drone
  // types could be owned simultaneously (each firing on this same
  // interval independently) - see droneAtkIntervalForRank below for how
  // the new attack-speed upgrade buys some of this back per-run.
  const DRONE_ATK_INTERVAL = 2.0;
  // Attack-speed upgrade (v1.36.84): DRONE_ATK_INTERVAL_FLOOR is set to
  // exactly half of DRONE_ATK_INTERVAL, so a maxed-out upgrade brings the
  // interval back down to the pre-v1.36.84 0.5s baseline's 2x (not all the
  // way back to 0.5s itself - the quadrupling above is a real, only
  // partially-recoverable nerf, not just relocated behind an upgrade).
  const DRONE_ATK_SPEED_UPGRADE_MAX_RANK = 3;
  const DRONE_ATK_INTERVAL_FLOOR = DRONE_ATK_INTERVAL / 2;
  const DRONE_ATK_INTERVAL_REDUCTION_PER_RANK = (DRONE_ATK_INTERVAL - DRONE_ATK_INTERVAL_FLOOR) / DRONE_ATK_SPEED_UPGRADE_MAX_RANK;
  function droneAtkIntervalForRank(rank) { return DRONE_ATK_INTERVAL - DRONE_ATK_INTERVAL_REDUCTION_PER_RANK * rank; }
  // Aura radius (v1.36.67, made a per-player upgradeable rank in v1.36.84):
  // widened to 1.5x the original DRONE_RANGE_BASE. Kept as its own
  // constant rather than just multiplying DRONE_RANGE_BASE itself, since
  // WIDE_ATTACK_RANGE (the Pulse Wave weapon's range, below) piggybacks on
  // DRONE_RANGE_BASE's original value - widening that constant directly
  // would have silently also buffed Pulse Wave's range, which nobody
  // asked for. DRONE_RADIUS_BASE (renamed from DRONE_RADIUS in v1.36.84)
  // is still what WIDE_ATTACK_RANGE piggybacks on - only the drones'
  // actual runtime range (droneRangeForRank below) grows with the new
  // range upgrade, so that upgrade can never leak into Pulse Wave's reach.
  const DRONE_RADIUS_BASE = DRONE_RANGE_BASE * 1.5;
  // Range upgrade (v1.36.84): all three drone types already shared one
  // identical detection radius (DRONE_RADIUS_BASE) even before this - what
  // this adds is a per-player rank (0-3) that grows it further, landing
  // at roughly DRONE_RANGE_MAX at max rank (chosen to land close to what
  // the impact drone's knockback used to make its effective reach feel
  // like pre-nerf, see IMPACT_DRONE_PUSH_DISTANCE below).
  const DRONE_RANGE_UPGRADE_MAX_RANK = 3;
  const DRONE_RANGE_MAX = 140;
  const DRONE_RANGE_PER_RANK = (DRONE_RANGE_MAX - DRONE_RADIUS_BASE) / DRONE_RANGE_UPGRADE_MAX_RANK;
  function droneRangeForRank(rank) { return DRONE_RADIUS_BASE + DRONE_RANGE_PER_RANK * rank; }
  // Shared drone slot pool (v1.36.84): previously each drone type had its
  // own independent maxLevel(5) with no cross-type cap at all, so a player
  // could in principle own up to 15 drones total (5 of each type). Capped
  // total ownership across all three types instead - DRONE_SLOTS_BASE is
  // the starting cap, raised by the new slot upgrade (0-3 ranks, +1 each).
  // Each type's own maxLevel(5, see DRONES) still applies on top of this
  // shared cap, so dumping every slot into one type is still bounded.
  const DRONE_SLOTS_BASE = 3;
  const DRONE_SLOT_UPGRADE_MAX_RANK = 3;
  function droneSlotCap(rank) { return DRONE_SLOTS_BASE + rank; }
  function totalDroneCount(p) { return p.jammingDroneCount + p.impactDroneCount + p.attackDroneCount; }
  // Jamming drone's own activation flash/status-dot color - cyan, same as
  // the original intercept aux weapon's default ChainZap color, made
  // explicit here now that every drone type needs one for both its zap
  // effect and the above-player drone-dot UI (v1.36.82).
  const JAMMING_DRONE_ZAP_COLOR = '#7ec8ff';
  // Impact drone (インパクトドローン, née shockwave, v1.36.63): pushes
  // whatever's caught in the same aura directly away from the player
  // instead of slowing it, once per DRONE_ATK_INTERVAL (a discrete
  // knockback per "shot", not a continuous force - see v1.36.64 above).
  // Fixed push distance regardless of owned count - count only raises how
  // many enemies it can hit at once, exactly like jamming's own count only
  // raises its target count rather than the slow's own strength. Reduced
  // 50->20 in v1.36.84: since the knockback moves an already-affected
  // enemy further away from the player, it made this drone's *felt* reach
  // (how far away it visibly influences enemies) noticeably longer than
  // jamming/attack's, even though all three shared the exact same
  // detection radius underneath - shrinking the push keeps a real
  // knockback while no longer making impact feel like the odd one out on
  // range.
  const IMPACT_DRONE_PUSH_DISTANCE = 20;
  // Impact drone's own activation flash color (v1.36.67) - same ChainZap
  // line effect the jamming drone already uses, just a different color so
  // the two read as visually distinct when either fires (orange for
  // impact's knockback vs jamming's cyan slow).
  const IMPACT_DRONE_ZAP_COLOR = '#ffa53d';
  // Attack drone (アタックドローン, née strike, v1.36.79): a direct damage
  // hit instead of a status effect/knockback, once per DRONE_ATK_INTERVAL
  // like the other two. Damage formula is the old tank passive's reflect
  // math verbatim (REFLECT_DMG_PCT_OF_ATTACK/OF_MAXHP) - see the dispatch
  // in update(). Zap color matches the "offense" category's red (same red
  // used for offense-category upgrade cards, §4-5-3) rather than reusing
  // jamming/impact's cyan/orange, both already spoken for.
  const ATTACK_DRONE_ZAP_COLOR = '#ff5a5a';
  // Empty drone-slot dot color (v1.36.84, see the above-player drone-dot
  // UI in draw()) - neutral gray, distinct from any drone's own color, so
  // an unused slot in the row reads as "not yet filled" rather than being
  // mistaken for a 4th drone type.
  const DRONE_SLOT_EMPTY_COLOR = '#5a5a66';

  // Wide weapon (v1.36.15): a short-range melee-style sweep that hits every
  // enemy inside a cone in front of the player in one go, instead of firing
  // a traveling Projectile. WIDE_ATTACK_RANGE piggybacks on DRONE_RADIUS_BASE
  // (v1.36.68, previously DRONE_RANGE_BASE - see DRONE_RADIUS_BASE above),
  // just a bit longer, so this weapon's reach stays deliberately ahead of
  // the drones' own base range rather than merely equal to it - the
  // tradeoff for guaranteed multi-target coverage and above-average
  // damage is that the player has to get in close to use it at all. Its
  // innate effect (see WEAPONS below) widens the cone with rank instead of
  // adding more shots, so this weapon never gets multishot's raw
  // shot-count scaling. Declared here (ahead of its usual position among
  // the other bullet-effect constants) because WEAPONS' desc strings below
  // reference it directly at module-load time, not just from inside a
  // later-called function. Deliberately still anchored to the STATIC
  // DRONE_RADIUS_BASE rather than the upgradeable droneRangeForRank() -
  // the drone range upgrade (§4-3-3) must never leak into this unrelated
  // weapon's reach.
  const WIDE_ATTACK_RANGE = DRONE_RADIUS_BASE + 30;
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
  // charging never costs mobility) builds up charge; releasing fires an
  // instant, infinite-pierce beam per target, then resets chargeTime to 0
  // regardless of whether anything was hit - releasing with no target in
  // range wastes the charge, which is the real cost of committing to a
  // release at the wrong moment. The atkspeed upgrade still lowers
  // atkCooldown as normal; here that translates to a faster charge rate
  // (ATK_COOLDOWN_BASE / atkCooldown) rather than a shorter cooldown, so
  // it's never a dead pick.
  //
  // Multi-beam rework (v1.36.83): previously rank raised Player.chargeMaxStages,
  // a cap on how many discrete charge "stages" a longer hold could reach,
  // with each stage widening AND strengthening the single beam
  // (chargeHalfWidthForStage/chargeDamageMultForStage, both removed). That
  // made this weapon a single-target, single-direction hit no matter how
  // far it was invested in - a poor fit for a game about surviving a
  // swarm from every side. Replaced with the same multishot model the
  // standard weapon already uses (WEAPONS' innate effect below sets
  // Player.chargeBeamCount = rank, mirroring projCount = rank): each beam
  // fires at the same fixed width/damage (CHARGE_HALF_WIDTH/
  // CHARGE_DAMAGE_MULT) and its own distinct nearest target
  // (fireChargeBeam below), instead of one beam that only ever gets
  // wider/stronger with a longer hold.
  //
  // Stage-gated beam count (v1.36.83 fired all chargeBeamCount beams the
  // instant CHARGE_TIME_PER_STAGE was reached; v1.36.85 reintroduced a
  // discrete per-stage ramp, now driving beam COUNT instead of the old
  // per-beam width/damage): charge climbs through chargeBeamCount discrete
  // stages, CHARGE_TIME_PER_STAGE seconds apart, and a release only fires
  // as many beams as stages actually reached (chargeStageForCharge below)
  // - a quick minimum-charge tap still fires (just 1 beam, the nearest
  // target), while holding all the way to full charge fires all
  // chargeBeamCount of them. Holding past the final stage does nothing
  // further, same as before.
  const CHARGE_TIME_PER_STAGE = 0.5;
  function chargeStageForCharge(chargeTime, beamCount) { return Math.min(beamCount, Math.floor(chargeTime / CHARGE_TIME_PER_STAGE)); }
  // Half-width narrowed 8->8/3 (v1.36.85, exactly 1/3 of the original) -
  // multiple simultaneous full-width beams (v1.36.83) read as visually
  // overwhelming/"too flashy" in practice, especially at high rank with
  // several firing across a wide spread of directions at once. Damage is
  // untouched - only the visual/hitbox width shrinks.
  const CHARGE_HALF_WIDTH = 8 / 3;
  const CHARGE_DAMAGE_MULT = 3.0;

  // Target lock interval (v1.36.78, generalized to a target SET in
  // v1.36.83, see Game.updateChargeBeam): targeting is "nearest N enemies
  // anywhere in range" (N = Player.chargeBeamCount), but that search is
  // only allowed to re-run (and thus change which enemies are locked on)
  // once every CHARGE_TARGET_LOCK_INTERVAL seconds, or immediately if any
  // currently-locked target has died/left play in the meantime - same
  // reasoning as the original single-target version: a multi-second hold
  // shouldn't keep re-chasing whatever's nearest frame to frame and flip
  // to totally different enemies right before release.
  const CHARGE_TARGET_LOCK_INTERVAL = 1.0;

  // Rapid Fire (v1.36.45, rebalanced v1.36.46): fires shots along the
  // player's current movement direction (Player.moveDirAngle, updated in
  // update()'s movement block whenever actually moving, and otherwise just
  // held at whatever it last was) rather than freely auto-aiming at the
  // nearest enemy on screen the way every other weapon does. Rewards
  // aggressive, keep-moving-forward play (clearing whatever's directly
  // ahead) but can't cover multiple threat directions the way the other
  // weapons' targeting can.
  // Damage raised 0.4->0.55 (v1.36.46, cooldown left untouched) - the
  // first pass felt too weak to justify giving up auto-aim entirely.
  const RAPIDFIRE_DAMAGE_MULT = 0.55;
  const RAPIDFIRE_COOLDOWN_MULT = 0.35;
  // Forward-strip auto-aim (v1.36.47, reworked from a cone to a rectangle
  // the same version): firing dead straight along moveDirAngle with zero
  // targeting at all proved too punishing in practice - a target has to be
  // pixel-perfect in front of the player, no margin at all. A cone was
  // tried first, but a cone's width shrinks to nothing near its origin, so
  // it stopped helping at all against enemies already close to the player
  // (the exact moment auto-aim matters most). A rectangle - fixed half-width
  // regardless of distance, extending out to weapon range - fixes that: the
  // nearest enemy inside this strip ahead of the player is preferred over
  // the raw movement direction if one exists; with nothing in the strip it
  // still falls back to firing straight ahead exactly as before. Keeps the
  // weapon's directional identity (this is a soft nudge onto a nearby
  // target roughly ahead, not the wide free-range targeting every other
  // weapon has) while smoothing over the "must be exactly aligned" problem.
  const RAPIDFIRE_AUTOAIM_HALF_WIDTH = 60;
  // Added v1.36.46: shots travel noticeably faster than every other
  // weapon's default Player.projSpeed, reinforcing the "fast" identity and
  // giving them a better chance of actually reaching whatever's ahead
  // before it closes the distance.
  const RAPIDFIRE_PROJ_SPEED_MULT = 1.5;
  // Changed v1.36.46: the innate effect (see WEAPONS below) used to add
  // more shots trailing behind each other on the identical trajectory
  // (same angle, staggered spawn position along that one line). Now it
  // instead lines them up side by side, perpendicular to the firing
  // direction, all still moving in that exact same direction - rank 1
  // fires a single shot ("-"), rank 2 fires two parallel shots ("="),
  // rank 3 three ("≡"), and so on, spreading coverage across a short
  // front rather than concentrating repeat hits on one exact line.
  // Centered around the movement axis (barrel i's offset is
  // (i - (barrels-1)/2) * RAPIDFIRE_BARREL_GAP), so the whole row stays
  // symmetric regardless of how many barrels are active.
  const RAPIDFIRE_BARREL_GAP = 14;

  const WEAPONS = [
    {
      id: 'standard',
      name: 'スタンダード',
      desc: '標準武器。今後ダメージ・発射速度・貫通などが異なる武器が追加されます。',
      apply: (p) => {},
      innateEffect: {
        name: 'マルチショット',
        desc: 'レベルアップに応じて自動でランクが上昇し、同時発射数が増えていく',
        applyRank(p, rank) { p.projCount = rank; },
      },
    },
    {
      id: 'wide',
      name: 'パルスウェーブ',
      desc: '近距離専用、自機の前後に同時に放たれる衝撃波。射程は「迎撃」よりわずかに長い程度だが、前後の範囲内の敵を一度に全て攻撃でき、威力も高め。マルチショットは持たない代わりに、ランクアップで衝撃波の幅が広がっていく。',
      apply: (p) => {},
      innateEffect: {
        name: '波動拡大',
        desc: 'レベルアップに応じて自動でランクが上昇し、衝撃波の幅が広がっていく',
        applyRank(p, rank) { p.wideHalfWidth = wideHalfWidthForRank(rank); },
      },
    },
    {
      id: 'charge',
      name: 'チャージビーム',
      desc: '画面を押し続けている間チャージが進み(移動操作と同じ操作なので、チャージ自体は移動を妨げない)、指を離すと無限貫通のビームを発射する。ごく短い即離しでは発射されない。1本ごとの威力・幅は常に一定だが、レベルアップに応じて同時に発射できるビーム数が増え、それぞれが別々の敵を自動で狙う。',
      apply: (p) => {},
      innateEffect: {
        name: 'マルチビーム',
        desc: 'レベルアップに応じて自動でランクが上昇し、同時発射できるビーム数が増えていく',
        applyRank(p, rank) { p.chargeBeamCount = rank; },
      },
    },
    {
      id: 'rapidfire',
      name: 'ラピッドファイア',
      desc: '威力はやや低めながら、自機の進行方向に向けて高速の弾を連射する武器。進行方向のごく近くに敵がいれば緩やかに自動照準するが、基本的には狙わないため、進んでいく先を切り開いたり、自ら敵に向かっていったりする積極的な立ち回りが得意。その反面、複数方向から同時に狙われる状況にはやや弱い。',
      apply: (p) => {},
      innateEffect: {
        name: '同時射撃数アップ',
        desc: 'レベルアップに応じて自動でランクが上昇し、進行方向に対して横一列に並ぶ形で同時発射数が増えていく',
        applyRank(p, rank) { p.rapidfireBarrels = rank; },
      },
    },
  ];

  // Required XP grows with level^1.5 rather than compounding multiplicatively
  // (the old `xpNext * 1.35 + 5` recurrence), so it stays a smooth, roughly
  // steady climb instead of snowballing into a wall by level ~15. A hard
  // cap keeps very long runs from ever facing an unbounded requirement.
  // Lowered 3000->1527 (v1.36.27, matches the uncapped formula's value at
  // level 33) - 3000 let the per-level requirement keep climbing far longer
  // than intended, making very long runs feel like they stalled out on
  // leveling; capping around the LV33-equivalent keeps late-run leveling
  // pace steady instead of grinding to a near-halt.
  // Scaled to 70% of the original curve (v1.36.70) - the upgrade pool has
  // grown substantially since this curve was tuned (bullet effects, aux
  // weapons, category rerolls), so a flatter requirement means more
  // level-ups - and more chances to actually see that larger pool - over
  // the same run length. Applied as a flat multiplier over the original
  // formula (including the cap) rather than re-deriving new constants, so
  // the underlying growth shape is unchanged, just uniformly faster.
  const XP_REQUIREMENT_MULT = 0.7;
  const XP_NEXT_CAP = Math.round(1527 * XP_REQUIREMENT_MULT);
  function xpNextForLevel(level) {
    return Math.min(XP_NEXT_CAP, Math.round((10 + 8 * Math.pow(level, 1.5)) * XP_REQUIREMENT_MULT));
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
      // Last known movement direction (radians), updated in update()'s
      // movement block only while actually moving - holds steady while
      // stationary rather than resetting, so Rapid Fire (the only weapon
      // that reads this instead of auto-aiming) still has a sensible
      // direction to fire in the instant the player stops. 0 = facing
      // right, matching the default `facing = 1`.
      this.moveDirAngle = 0;
      // Pity tracking for the level-up draw (v1.36.44): id -> consecutive
      // level-ups this upgrade has been eligible but NOT offered. Read by
      // Game.onLevelUp()/pickWeightedIndex to nudge a long-unseen upgrade's
      // odds upward over time, so wanting a specific upgrade out of a large
      // pool doesn't mean indefinite bad luck can just never surface it.
      this.upgradeMissStreak = {};
      // Reject (v1.36.93): permanently excludes an upgrade id from this
      // run's pool once long-pressed away, so a build can deliberately
      // prune the pool instead of only ever adding to it. rejectedUpgradeIds
      // holds final card ids (e.g. 'pierce', 'bullet-poison', 'drone-jamming')
      // - the same ids buildUpgradePool()'s entries already carry - so a
      // single filter there covers every pool source uniformly. Uses are
      // capped per run (REJECT_USES_BASE) rather than unlimited, so pruning
      // the pool down to a narrow, guaranteed-good draw isn't free.
      this.rejectedUpgradeIds = new Set();
      this.rejectUsesRemaining = REJECT_USES_BASE;

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
      this.chargeBeamCount = 1;
      this.chargeWasHeld = false;
      // Target lock (v1.36.78, generalized to an array in v1.36.83, see
      // updateChargeBeam/CHARGE_TARGET_LOCK_INTERVAL) - the (up to
      // chargeBeamCount) enemies currently locked onto during a hold, and
      // how much longer that lock has left before it's allowed to change.
      this.chargeTargets = [];
      this.chargeTargetLockTimer = 0;
      // Rapid Fire weapon only (see WEAPONS/fireRapidFire) - unused by any
      // other weapon, harmless default otherwise.
      this.rapidfireBarrels = 1;
      // Raised from 70 (v1.35.0) to fold in exactly what one pickup-range
      // upgrade pick used to add, now that the upgrade itself is gone.
      this.pickupRadius = 100;
      // Fraction of maxHp a heart pickup restores (see HEART_HEAL_FRAC and
      // the 'heartheal' upgrade below) - kept per-player rather than always
      // reading the constant directly, since the upgrade raises it.
      this.heartHealFrac = HEART_HEAL_FRAC;
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
      // Drones (v1.36.63, see DRONES; independently-owned per type since
      // v1.36.82) - each type gets its own owned count (how many of that
      // drone are out) plus its own attack-interval cooldown, all starting
      // at 0 so a freshly acquired drone can fire the very frame it's
      // picked up rather than waiting out a full interval first.
      this.jammingDroneCount = 0;
      this.jammingDroneCooldown = 0;
      this.impactDroneCount = 0;
      this.impactDroneCooldown = 0;
      this.attackDroneCount = 0;
      this.attackDroneCooldown = 0;
      // Shared drone stat upgrades (v1.36.84, see droneSlotCap/
      // droneRangeForRank/droneAtkIntervalForRank) - unlike the per-type
      // counts above, these three apply identically to all drone types at
      // once, so each is a single rank (0 to its own upgrade's max rank)
      // rather than a per-type field.
      this.droneSlotRank = 0;
      this.droneRangeRank = 0;
      this.droneAtkSpeedRank = 0;
      this.poisonLevel = 0;
      this.frenzyLevel = 0;
      // Named bombifyLevel (not "bomb") to avoid confusion with the
      // unrelated "emergency bomb" special ability (§ CHARACTERS).
      this.bombifyLevel = 0;
      this.weakenLevel = 0;
      // Vulnerable (脆弱, v1.36.87, split out of frenzy's old damage-taken
      // debuff) - see vulnerableDmgMultForLevel/VULNERABLE_DURATION.
      this.vulnerableLevel = 0;
      // Impact effects (v1.36.35): persistent zones left at a hit's impact
      // point, own ranks independent of the bullet effects above (see the
      // ImpactEffect constants block for details).
      this.magnetstormLevel = 0;
      this.killzoneLevel = 0;
      this.poisoncloudLevel = 0;

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
  // Raised 5->8 (v1.36.27) alongside the tier HP/dmg coefficient bump -
  // more room for spawn-pace investment (pierce/chain) to keep paying off
  // as a genuinely faster cadence before SPAWN_OVERFLOW_HP_COEFF's
  // enemy-HP conversion kicks in, rather than hitting the ceiling sooner.
  const SPAWN_RATE_MAX = 8;

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
  // minDifficulty (v1.36.62): each non-boss type's own unlock threshold,
  // now read directly off ENEMY_TYPES by both spawnEnemy() (forced spawns
  // aside) and Game.rollSpawnPattern() (see below) instead of being
  // hardcoded separately in each place - a type is only ever eligible to
  // spawn (via the normal roll) once the current difficulty meets its own
  // minDifficulty, full stop, regardless of which spawn pattern is active.
  const ENEMY_TYPES = {
    // HP values are the pre-v1.28.0 baseline divided by ENEMY_SPAWN_RATE_MULT
    // (18/10/70/500 -> 12/7/47/333), rounded.
    grunt:  { hp: 12,  speed: 78,  radius: 13, color: '#ff5a5a', dmg: 8,  xp: 3,  score: 1, burst: 1, minDifficulty: 1 },
    // wander (v1.36.58): a per-enemy movement wobble was tried on every
    // type in v1.36.56 and reverted the same session (v1.36.57) - it read
    // as visually nauseating overall, but fast specifically didn't have
    // that problem and looked good wobbling, so it's opted back in alone
    // here rather than reintroducing it globally.
    fast:   { hp: 7,   speed: 140, radius: 10, color: '#ffd23a', dmg: 6,  xp: 4,  score: 1, burst: 2, wander: true, minDifficulty: 2 },
    tank:   { hp: 47,  speed: 48,  radius: 20, color: '#a15aff', dmg: 14, xp: 10, score: 2, burst: 1, minDifficulty: 5 },
    // Deliberately huge single-target HP pool: a pure multishot build
    // spreads its damage across many enemies and struggles to burn this
    // down alone, so surviving bosses well pushes toward also investing in
    // single-target-friendly upgrades (raw damage, explosion/chain). No
    // minDifficulty - bosses don't participate in the normal type roll or
    // spawn-pattern system at all (see BOSS_MIN_DIFFICULTY/spawnEnemy below).
    boss:   { hp: 333, speed: 35,  radius: 32, color: '#c81e3a', dmg: 20, xp: 50, score: 5, burst: 1 },
    // Gunner (v1.36.60): approaches only until in mid-range, then holds
    // position and fires at the player instead of closing the rest of the
    // way - see Game.updateGunnerMovement. Low HP/contact damage on
    // purpose: its real threat is the ranged chip damage (further lowered
    // in v1.36.61, see GUNNER_ATK_DAMAGE_BASE), and it's meant to reward
    // players who close the distance and kill it rather than tanking shots
    // from range. `ranged: true` opts it into the hold-and-fire behavior
    // (see the movement dispatch in update()). Color changed from the
    // original cyan (v1.36.61) - it read too close to the gems' mint green
    // at a glance; both this and its projectile now use this same green.
    gunner: { hp: 9,   speed: 70,  radius: 12, color: '#22c55e', dmg: 6,  xp: 5,  score: 2, burst: 1, ranged: true, minDifficulty: 3 },
    // Blitz (v1.36.60): approaches to close range, pauses briefly (telegraph),
    // then locks a direction and dashes straight through at a large speed/
    // damage multiplier, continuing off past the player regardless of
    // whether it connects, before looping back to approach again - see
    // Game.updateBlitzMovement. `charger: true` opts it into that state
    // machine (see the movement dispatch in update()).
    // hp 10->18 (v1.36.74): too easy to just kill before the dash ever
    // triggered, across every difficulty/weapon/build tested - it barely
    // registered as a distinct threat. Still well short of tank (47,
    // minDifficulty 5) despite unlocking one tier later, since blitz's
    // real danger is the dash itself, not a war of attrition.
    blitz:  { hp: 18,  speed: 55,  radius: 13, color: '#ff6fd8', dmg: 8,  xp: 6,  score: 2, burst: 1, charger: true, minDifficulty: 6 },
  };

  // All spawnable non-boss types, derived from ENEMY_TYPES itself (not a
  // separately maintained list) so a future new type just needs a
  // minDifficulty field to automatically participate in both the normal
  // roll and the spawn-pattern system below - boss is excluded by name
  // since it never participates in either (see Game.rollSpawnPattern).
  const NON_BOSS_ENEMY_TYPES = Object.keys(ENEMY_TYPES).filter(t => t !== 'boss');

  // Category classification (v1.36.81): every non-boss type is either
  // "射撃系"/ranged (holds position and shoots from range - currently just
  // gunner) or "通常系"/normal (approaches and deals contact damage -
  // everything else). Derived once from each type's own `ranged` flag
  // rather than a second hardcoded list, so a future new ranged type only
  // needs `ranged: true` on its ENEMY_TYPES entry to automatically
  // participate in both RANGED_MAX_ALIVE (below) and rollSpawnPattern's
  // no-pure-ranged-pattern guarantee, without touching either of those.
  const RANGED_ENEMY_TYPES = NON_BOSS_ENEMY_TYPES.filter(t => ENEMY_TYPES[t].ranged);
  const NORMAL_ENEMY_TYPES = NON_BOSS_ENEMY_TYPES.filter(t => !ENEMY_TYPES[t].ranged);

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
  // Earliest wave a rush can trigger on (v1.36.75): previously a rush could
  // fire as early as wave 3 (rushWindowCooldown starts at 0, so the very
  // first 50s window was already eligible) - too early for a build that's
  // barely had 1-2 level-ups to actually weather RUSH_HP_MULT/RUSH_BURST_MULT
  // enemies. Gates the trigger check in update() so a rush's warning/active
  // phase can't begin until this wave.
  const RUSH_MIN_WAVE = 6;

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

  // Early-game HP relief (v1.36.73): D1-5 enemies felt too tanky for a
  // fresh, no-upgrades-yet build - grunt specifically could take 2+ hits
  // from base Standard/Rapid Fire, forcing a damage-side pick on the very
  // first level-up just to keep killing anything. Only enemy HP is
  // affected (not their damage or how often they spawn - both already felt
  // fine per feedback), and only through this multiplier, layered on top
  // of tierHpMult below so nothing about the tier curve's own math changes.
  // Fades linearly from EARLY_GAME_HP_DISCOUNT at D1 to fully gone (1.0,
  // no effect at all) by EARLY_GAME_HP_DISCOUNT_END_DIFFICULTY, so the rest
  // of the difficulty curve - and every enemy type that only unlocks at
  // D >= that threshold (tank included) - is completely untouched.
  const EARLY_GAME_HP_DISCOUNT = 0.25;
  const EARLY_GAME_HP_DISCOUNT_END_DIFFICULTY = 5;
  function earlyGameHpMult(D) {
    if (D >= EARLY_GAME_HP_DISCOUNT_END_DIFFICULTY) return 1;
    const frac = (EARLY_GAME_HP_DISCOUNT_END_DIFFICULTY - D) / (EARLY_GAME_HP_DISCOUNT_END_DIFFICULTY - 1);
    return 1 - EARLY_GAME_HP_DISCOUNT * frac;
  }

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
  // Reassigned (v1.36.72) to line up with the upgrade categories (§4-5-2):
  // crowdPowerMult now feeds off the same 5 upgrades as the "クラウド"
  // category (連鎖/貫通/キルゾーン/磁気嵐) plus 射程アップ - all upgrades
  // whose actual gameplay effect is "handle more enemies busier/wider per
  // engagement", which is exactly what a faster spawn pace tests. Bombify
  // (previously counted here) has no clear read as "more enemies handled at
  // once" on its own (its payoff depends entirely on already having
  // explosion built up) and now has no difficulty feedback at all.
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
    // Killzone/magnetstorm (v1.36.72) are area-effect zones that damage or
    // corral multiple enemies at once, the same "handle a crowd, not just
    // one target" role as pierce/chain.
    const withKillzone = crowdBase * (1 + p.killzoneLevel * 0.15);
    const withMagnetstorm = withKillzone * (1 + p.magnetstormLevel * 0.15);
    // Range (v1.36.72): more reach means more enemies are simultaneously
    // in engagement range at once (weaponRange/enemyEngagementRadius both
    // scale with it), which is the same "facing more enemies per moment"
    // pressure a faster spawn pace tests - same damping pattern as
    // survivalPowerMult's maxHp term below (only half the overshoot
    // counts).
    const rangeExtra = Math.max(0, p.rangeMult - 1) * 0.5;
    return withMagnetstorm * (1 + rangeExtra);
  }
  // Reassigned (v1.36.72): now covers 最大HPアップ/ハート回復量増加/
  // 鉄壁の構え(all p.maxHp)/低速 - the upgrades whose payoff is "take
  // less net damage over time" (bigger or more frequently-refilled HP
  // pool, or fewer/weaker hits landing at all). Aux weapons (迎撃/衝撃)
  // and 衰弱/weaken previously counted here too but were judged too
  // situational/minor a payoff to warrant their own difficulty feedback,
  // so both were dropped with no replacement axis.
  function survivalPowerMult(p) {
    // Max HP's own contribution is dampened (only half the overshoot
    // counts) - at full weight, stacking HP mostly just fed back into
    // harder-hitting enemies and cancelled out its own survivability gain.
    const hpExtra = Math.max(0, p.maxHp / BASELINE_STATS.maxHp - 1) * 0.5;
    // Heart heal (v1.36.72) follows the exact same reasoning/damping as
    // maxHp above - a bigger heal is really just a bigger *effective* HP
    // pool spread out over the run instead of all upfront.
    const heartHealExtra = Math.max(0, p.heartHealFrac / HEART_HEAL_FRAC - 1) * 0.5;
    const base = 1 + hpExtra + heartHealExtra;
    // Slow counts at full weight since it reduces how often the player
    // actually gets hit at all, rather than just how tanky a hit is.
    return base * (1 + p.slowLevel * 0.15);
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

  // Shared by spawnEnemy() (how far out a spawn burst appears) and the wall
  // pathfinding flow field (how far around the player it needs to cover) -
  // both are really asking the same question, "how far from the player does
  // this run's active play area extend on this screen size", so it's pulled
  // out once rather than risking the two formulas silently drifting apart.
  function enemyEngagementRadius() {
    return Math.max(W, H) * 0.65 + 60;
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
      // Frenzy (v1.36.4, no longer stacks as of v1.36.87 - see
      // frenzyDurationForLevel): no stack counter, same refresh-on-rehit
      // rule as bombify/weaken below - a later hit just resets frenzyTimer
      // to a fresh frenzyDurationForLevel(rank). Makes this enemy also deal
      // contact damage to other enemies it touches while active (the
      // friendly-fire check in update()) - purely that, no damage
      // multiplier of any kind attached anymore.
      this.frenzyTimer = 0;
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
      // Vulnerable (脆弱, v1.36.87, split out of frenzy's old damage-taken
      // debuff; reworked v1.36.88 to pair with weaken above instead of
      // poison): no stack counter, same refresh-on-rehit rule as weaken -
      // a later hit just resets vulnerableTimer to VULNERABLE_DURATION.
      // Raises how much extra damage this enemy takes from every source
      // while active - see vulnerableDmgMultForLevel and damageEnemy().
      this.vulnerableTimer = 0;
      // Set by the emergency-bomb special so its mass-kill burst is exempt
      // from GEM_CAP below - the whole point of that ability is stockpiling
      // gems for one big level-up burst, which the cap would otherwise gut.
      this.forceKilled = false;
      // Movement wander (v1.36.58, fast-only - see ENEMY_TYPES.fast and
      // ENEMY_WANDER_AMPLITUDE above). Phase/freq only allocated for
      // wandering types; non-wandering enemies skip the extra RNG calls.
      this.wanders = !!def.wander;
      if (this.wanders) {
        this.wanderPhase = rand(0, TAU);
        this.wanderFreq = rand(ENEMY_WANDER_FREQ_MIN, ENEMY_WANDER_FREQ_MAX);
      }
      // Gunner (v1.36.60, see ENEMY_TYPES.gunner/Game.updateGunnerMovement).
      // rangedCooldown starts at a random point within one interval so a
      // burst/wave of gunners doesn't all fire in lockstep the moment they
      // first hold position. rangedAtkDamage is computed here (not read
      // fresh from a flat constant at fire time) so it scales with
      // difficulty via dmgMult exactly like contact damage does.
      this.ranged = !!def.ranged;
      if (this.ranged) {
        this.rangedCooldown = rand(0, GUNNER_ATK_INTERVAL);
        this.rangedHolding = false;
        this.rangedAtkDamage = Math.round(GUNNER_ATK_DAMAGE_BASE * dmgMult);
      }
      // Blitz (v1.36.60, see ENEMY_TYPES.blitz/Game.updateBlitzMovement).
      // baseDmg preserves the difficulty-scaled contact damage (this.dmg
      // above already has dmgMult applied) so the charge's damage
      // multiplier has a stable value to multiply from and fully reverts
      // once the charge ends, rather than compounding across charges.
      this.charger = !!def.charger;
      if (this.charger) {
        this.blitzState = 'approach';
        this.blitzTimer = 0;
        this.blitzDirX = 0;
        this.blitzDirY = 0;
        this.blitzChargeDistanceRemaining = 0;
        this.baseDmg = this.dmg;
      }
    }
  }

  class Projectile {
    constructor(x, y, vx, vy, damage, pierce, radius, explosionRadius, chainHops, slowDuration, poisons, frenzies, bombifies, weakens, vulnerable) {
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
      this.vulnerable = vulnerable || false;
    }
  }

  // Enemy-fired projectile (v1.36.60, gunner only for now) - deliberately
  // much lighter than Projectile: no pierce/hitSet/bullet-effect fields at
  // all, since it only ever needs to hit the single player once and then be
  // gone. Kept as its own class/array (Game.enemyProjectiles) rather than
  // reusing Projectile/this.projectiles so the existing projectile-vs-enemy
  // collision loop never has to distinguish "whose shot is this" - enemy
  // shots simply never enter that array or that collision check at all.
  class EnemyProjectile {
    constructor(x, y, vx, vy, damage, radius) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.damage = damage;
      this.radius = radius;
      this.life = ENEMY_PROJ_LIFE;
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

  // Heart pickup (v1.36.27): a rare passive-recovery item, replacing the
  // wave-end HP heal removed the same version. Spawns away from the player
  // and just sits there (no lifespan, no magnetism like gems' pickup
  // radius) until physically touched - finding one is a small deliberate
  // detour, not an automatic drip.
  const HEART_SPAWN_CHECK_INTERVAL = 1.0; // seconds between spawn-chance rolls
  // 0.02->0.04 (v1.36.28): halves the expected wait (~50s -> ~25s per
  // heart) so going out of the way to find one is worth doing more often.
  const HEART_SPAWN_CHANCE = 0.04; // per roll, only while under HEART_MAX_COUNT are already on screen
  // 1->5 (v1.36.29): with hearts now able to land off-screen (v1.36.28),
  // a 1-heart cap meant a far-off heart blocked any closer one from
  // spawning until it was reached or the run moved on. Multiple hearts can
  // now coexist, so a search doesn't always mean chasing a single distant
  // point - there may be a closer one worth detouring for instead.
  const HEART_MAX_COUNT = 5;
  // 0.1->0.2 (v1.36.29), then back to 0.1 (v1.36.32), then doubled again to
  // 0.2 (v1.36.69): the 0.2 bump was originally meant to offset how hard
  // hearts were to find, and got reverted once the heart compass (v1.36.31)
  // solved that more directly. This second doubling is a separate, later
  // balance pass unrelated to that original reasoning - hearts simply
  // needed to be worth more given how (now, also v1.36.69) narrower their
  // spawn range is.
  const HEART_HEAL_FRAC = 0.2;
  const HEART_SPAWN_MIN_DIST = 200;
  // 400->1200 (v1.36.28), then narrowed to 900 (v1.36.69): the 1200 range
  // was originally widened so a heart could land well outside the current
  // screen, turning "get a heart" into a real search-and-detour decision.
  // 900 keeps that search-and-detour feel (still comfortably past a typical
  // viewport) while reining in how far a heart can end up from the player,
  // as part of the same balance pass that also doubled HEART_HEAL_FRAC.
  const HEART_SPAWN_MAX_DIST = 900;
  class Heart {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.radius = 12;
    }
  }

  // Terrain walls (v1.36.50): static, indestructible rectangular obstacles.
  // Neither the player nor enemies can pass through one, and most attacks
  // are stopped by one too (see segmentHitsWall's call sites) - the sole
  // exception is the charge beam's genuinely infinite pierce, which bypasses
  // wall checks entirely rather than getting stopped by the very first one
  // in its path.
  //
  // Generation is chunk-based rather than a one-time batch near the start
  // position: this game's world is effectively infinite (enemies/hearts
  // already spawn relative to the player's CURRENT position, not some fixed
  // map bounds - see spawnEnemy/heart spawning above), so a fixed batch of
  // walls placed once near (0,0) would stop mattering the moment a run
  // wanders far enough away. Instead, the world is divided into
  // WALL_CHUNK_SIZE squares; whenever the player gets within
  // WALL_GEN_RADIUS_CHUNKS chunks of an ungenerated one, that chunk rolls
  // its own walls once and remembers the result forever (Game.wallChunks/
  // generatedChunks) - so walls keep appearing as a run explores in any
  // direction, for its entire duration, not just the opening moments.
  const WALL_CHUNK_SIZE = 800;
  const WALL_GEN_RADIUS_CHUNKS = 2;
  // Chance 0.45->0.7 and count 1-2->1-3, size 100-260->50-130 (v1.36.51):
  // walls read as too big and too sparse in practice - halving the size
  // range while also raising both how often a chunk gets any walls at all
  // and how many it can roll gives noticeably more (smaller) obstacles per
  // chunk instead of a few large ones. Chance 0.7->0.85 and count max 3->4
  // (v1.36.54): still more wanted after playing with the above - roughly
  // +50% average walls/chunk (1.4 -> 2.125) on top of the previous pass.
  const WALL_CHANCE_PER_CHUNK = 0.85;
  const WALL_COUNT_MIN = 1;
  const WALL_COUNT_MAX = 4;
  const WALL_SIZE_MIN = 50;
  const WALL_SIZE_MAX = 130;
  // A wall roll that would land on top of the player's CURRENT position is
  // simply skipped (not relocated) - since chunks generate continuously as
  // the player explores, this is what actually prevents a wall from ever
  // popping into existence directly on top of them mid-run, not just at the
  // very first chunk at game start.
  const WALL_PLAYER_CLEARANCE = 250;
  // See resolveWallCollision - repeated passes so a corner formed by two
  // separate walls (possibly from two different chunks, which never check
  // each other at generation time) still gets fully resolved instead of
  // bouncing the entity from one wall straight into the other.
  const WALL_COLLISION_PASSES = 4;

  // Flow-field pathfinding (see Game.buildFlowField/flowFieldDirectionAt):
  // only used by enemies whose direct line to the player is actually
  // blocked by a wall - most enemies most of the time never touch this at
  // all and just walk straight at the player exactly as before this
  // feature existed.
  const FLOW_FIELD_CELL = 64;
  const FLOW_FIELD_REFRESH_INTERVAL = 0.4;

  class Wall {
    constructor(x, y, w, h) {
      this.x = x; this.y = y; // top-left corner, world space
      this.w = w; this.h = h;
    }
  }

  // Liang-Barsky line-clipping test: does segment (x1,y1)-(x2,y2) intersect
  // axis-aligned rect (rx,ry,rw,rh)? Used for both projectile travel (has
  // this shot's frame-to-frame movement crossed a wall) and line-of-sight
  // checks (is a wall directly between two points) - see Game.segmentHitsWall.
  function segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rx, (rx + rw) - x1, y1 - ry, (ry + rh) - y1];
    let tmin = 0, tmax = 1;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false; // parallel to this pair of edges and outside them
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > tmax) return false; if (t > tmin) tmin = t; }
        else { if (t < tmin) return false; if (t < tmax) tmax = t; }
      }
    }
    return tmin <= tmax;
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
    // color (v1.36.67): optional, defaults to the original cyan (used by
    // chain lightning) - each drone type passes its own color (see DRONES)
    // so their activation flashes read as visually distinct.
    constructor(x1, y1, x2, y2, color) {
      this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
      this.color = color || '#7ec8ff';
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
    { id: 'damage', title: 'ダメージ強化', desc: '攻撃ダメージが大きく上昇する', category: 'offense', apply: p => p.damage = Math.round(p.damage * 1.5) },
    {
      id: 'range',
      title: '射程アップ',
      desc: '射程が上昇する(視界も拡大)',
      category: 'utility',
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
      desc: '移動速度が上昇する',
      category: 'utility',
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
      desc: 'XP回収範囲が拡大する',
      category: 'utility',
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
      desc: '攻撃間隔が短縮する(攻撃速度アップ)',
      category: 'offense',
      apply: p => p.atkCooldown = Math.max(STAT_LIMITS.minAtkCooldown, p.atkCooldown * 0.8),
      // Once atkCooldown is already at its floor, this upgrade does nothing
      // at all - stop offering it rather than presenting a dead choice.
      available: p => p.atkCooldown > STAT_LIMITS.minAtkCooldown,
    },
    {
      id: 'maxhp',
      title: '最大HPアップ',
      desc: '最大HPが上昇し、その分HPが回復する',
      category: 'defense',
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
    {
      id: 'heartheal',
      title: 'ハート回復量増加',
      desc: 'ハートの回復量が増加する',
      category: 'defense',
      // Multiplicative-with-cap, same shape as range/movespeed/pickup above.
      // Base heal reverted to 10% (v1.36.32, see HEART_HEAL_FRAC) once the
      // heart compass made finding one reliable enough that the extra value
      // makes more sense as an investable upgrade than as a free baseline.
      apply: p => p.heartHealFrac = Math.min(STAT_LIMITS.maxHeartHealFrac, p.heartHealFrac * 1.1),
      available: p => p.heartHealFrac < STAT_LIMITS.maxHeartHealFrac,
    },
    // Shared drone stat upgrades (v1.36.84, see DRONE_SLOTS_BASE/
    // droneRangeForRank/droneAtkIntervalForRank and their surrounding
    // comments) - each applies identically to all three drone types at
    // once, so these live here as capped-rank UPGRADE_POOL entries (same
    // available-gated, fixed-max-rank shape as range/movespeed/pickup
    // above) rather than in DRONES itself. No difficulty-feedback
    // contribution, same as every existing drone-related upgrade
    // (§6-2) - none of the three power-mult functions reference these
    // rank fields. Additionally gated on owning at least one drone of any
    // type (v1.36.91, `totalDroneCount(p) > 0`) - offering "sharpen your
    // drones" upgrades before the player has ever taken a single drone
    // just cluttered the pool with cards that do nothing yet.
    {
      id: 'droneslots',
      title: 'ドローン保有上限増加',
      desc: 'ドローンの同時保有数上限(全種合計)が増加する',
      category: 'utility',
      apply: p => p.droneSlotRank = Math.min(DRONE_SLOT_UPGRADE_MAX_RANK, p.droneSlotRank + 1),
      available: p => totalDroneCount(p) > 0 && p.droneSlotRank < DRONE_SLOT_UPGRADE_MAX_RANK,
    },
    {
      id: 'dronerange',
      title: 'ドローン射程増加',
      desc: 'ドローンの索敵範囲が拡大する(全種共通)',
      category: 'utility',
      apply: p => p.droneRangeRank = Math.min(DRONE_RANGE_UPGRADE_MAX_RANK, p.droneRangeRank + 1),
      available: p => totalDroneCount(p) > 0 && p.droneRangeRank < DRONE_RANGE_UPGRADE_MAX_RANK,
    },
    {
      id: 'droneatkspeed',
      title: 'ドローン攻撃速度増加',
      desc: 'ドローンの攻撃間隔が短縮する(全種共通)',
      category: 'utility',
      apply: p => p.droneAtkSpeedRank = Math.min(DRONE_ATK_SPEED_UPGRADE_MAX_RANK, p.droneAtkSpeedRank + 1),
      available: p => totalDroneCount(p) > 0 && p.droneAtkSpeedRank < DRONE_ATK_SPEED_UPGRADE_MAX_RANK,
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
  // maxHeartHealFrac caps the 'heartheal' upgrade (v1.36.32) - lets full
  // investment reach 2.5x the current HEART_HEAL_FRAC base, without an
  // unbounded stack turning hearts into a full-heal-on-demand button.
  // Raised 0.25->0.5 (v1.36.69) in lockstep with HEART_HEAL_FRAC's own
  // 0.1->0.2 doubling, to keep that same 2.5x headroom ratio rather than
  // leaving the upgrade with almost no room left to raise it further.
  const STAT_LIMITS = { minDamage: 3, maxAtkCooldown: 1.4, minAtkCooldown: 0.15, maxRangeMult: 2.0, maxSpeedMult: 1.5, maxPickupRadius: 200, maxHeartHealFrac: 0.5 };

  // Each grants a strong upside alongside a real downside, for players who
  // want to commit to a build rather than only stacking safe, one-sided
  // upgrades.
  const TRADEOFF_POOL = [
    {
      id: 'trade-damage',
      title: '捨て身の一撃',
      desc: 'ダメージが大幅に上昇する代わりに、攻撃間隔が延びる(発射速度ダウン)',
      category: 'offense',
      apply: p => {
        p.damage = Math.round(p.damage * 1.8);
        p.atkCooldown = Math.min(STAT_LIMITS.maxAtkCooldown, p.atkCooldown * 1.15);
      },
    },
    {
      id: 'trade-atkspeed',
      title: '速射特化',
      desc: '攻撃間隔が大幅に短縮する(発射速度アップ)代わりに、ダメージが低下する',
      category: 'offense',
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
      desc: '最大HPが大きく上昇する代わりに、ダメージが低下する',
      category: 'defense',
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
  // Nerf (v1.36.43): explosion used to trigger unconditionally on every hit
  // that had explosionRadius > 0, making it a guaranteed AoE tacked onto
  // every single shot - straightforwardly too strong relative to chain
  // (which already only has a 50% chance to trigger at all, see
  // CHAIN_TRIGGER_CHANCE below). No compensating damage buff here, unlike
  // chain's own proc-chance nerf - this is a plain reduction in how often
  // explosion goes off, not a rebalance.
  const EXPLOSION_TRIGGER_CHANCE = 0.5;
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

  // Movement wander (v1.36.56, reverted v1.36.57, reintroduced fast-only in
  // v1.36.58 - see ENEMY_TYPES.fast's `wander` flag): a per-enemy sine
  // wobble rotates the enemy's chosen direction (straight-line or, once
  // blocked by a wall, the flow field's direction) by a small, smoothly
  // oscillating angle, so it weaves slightly instead of beelining exactly.
  // Phase and frequency are randomized per enemy so a whole burst doesn't
  // wobble in lockstep.
  const ENEMY_WANDER_AMPLITUDE = 25 * Math.PI / 180; // max rotation, ~25 degrees each way
  const ENEMY_WANDER_FREQ_MIN = 0.4; // rad/s - slow, organic weaving, not a jittery twitch
  const ENEMY_WANDER_FREQ_MAX = 0.9;

  // Gunner (v1.36.60): approaches until within GUNNER_STOP_DIST_FRAC of the
  // player's engagement radius (roughly mid-screen), then holds position
  // and fires. GUNNER_RESUME_DIST_FRAC is deliberately larger than the stop
  // fraction (both expressed as fractions of enemyEngagementRadius(), so
  // this scales with screen size the same way spawning already does) -
  // that gap is what stops it from flickering between holding and
  // approaching right at one single boundary distance: it only resumes
  // once the player has drifted far enough to be roughly off-screen again.
  const GUNNER_STOP_DIST_FRAC = 0.4;
  const GUNNER_RESUME_DIST_FRAC = 1.0;
  const GUNNER_ATK_INTERVAL = 1.8;
  // 6->3 (v1.36.61): too strong at the original value - roughly half of
  // fast's contact damage (ENEMY_TYPES.fast.dmg = 6) instead of matching it
  // outright. Still scaled by dmgMult at spawn, same as contact damage.
  const GUNNER_ATK_DAMAGE_BASE = 3;
  const GUNNER_PROJ_SPEED = 260;
  const GUNNER_PROJ_RADIUS = 6;
  const ENEMY_PROJ_LIFE = 4; // seconds before an unfired-into-anything shot just despawns
  // Combined alive cap for the whole "射撃系"/ranged category (v1.36.80,
  // generalized from a gunner-only cap in v1.36.81 - see
  // RANGED_ENEMY_TYPES): a spawn pattern that happens to be ranged-heavy
  // could let dozens pile up simultaneously, each independently shooting
  // from range - a swarm of ranged attackers spikes difficulty far harder
  // than the same headcount of any melee type, since there's no single
  // position that dodges all of their fire at once. Applies to the total
  // count across every ranged type combined (currently just gunner, but a
  // future second ranged type would share this same pool rather than each
  // getting its own separate 10). Capped independently of (and well under)
  // MAX_ALIVE_ENEMIES, which still applies on top for every type combined.
  const RANGED_MAX_ALIVE = 10;

  // Blitz (v1.36.60): approaches to BLITZ_STOP_DIST_FRAC of the engagement
  // radius (closer than the gunner's hold distance - it wants to actually
  // reach the player, not linger at range), pauses BLITZ_PAUSE_DURATION
  // seconds as a telegraph, then commits to a straight-line dash in
  // whatever direction the player was in at that instant (not homing - see
  // Game.updateBlitzMovement) at BLITZ_CHARGE_SPEED_MULT times its normal
  // speed, dealing BLITZ_CHARGE_DAMAGE_MULT times its normal contact damage
  // for the dash's duration. The dash covers a full screen-diameter's
  // worth of distance (2x engagement radius) before giving up and
  // reverting to approach, guaranteeing it visibly exits off-screen on the
  // far side regardless of where it started or whether it hit the player.
  const BLITZ_STOP_DIST_FRAC = 0.3;
  const BLITZ_PAUSE_DURATION = 1.0;
  // 4 -> derived from GUNNER_PROJ_SPEED (v1.36.74): the dash felt like it
  // didn't stand out enough from fast's own 140 base speed - at the old
  // multiplier, a baseline (unslowed) charge was only 55*4=220. Retargeted
  // so a baseline charge's absolute speed matches GUNNER_PROJ_SPEED (260)
  // exactly instead of just being "some multiple of blitz's own base
  // speed" - derived as a ratio (not a hardcoded 260/55) so it stays in
  // sync automatically if either constant changes later. Still expressed
  // as a multiplier on effSpeed (not a flat 260), so a slowed or
  // rush-sped-up blitz's charge continues to scale proportionally exactly
  // like before.
  const BLITZ_CHARGE_SPEED_MULT = GUNNER_PROJ_SPEED / ENEMY_TYPES.blitz.speed;
  const BLITZ_CHARGE_DAMAGE_MULT = 1.8;

  // Status-effect indicator dots (v1.36.0): rather than recoloring an
  // enemy's own body per status (which only ever supported showing one
  // status at a time, and fought with hitFlash for the same fillStyle),
  // each active status gets a small dot drawn above the enemy instead - see
  // draw(). Keyed by status name so future statuses (e.g. poison) just add
  // an entry here and a condition in draw() without touching enemy color.
  const STATUS_DOT_COLORS = { slow: '#7ec8ff', poison: '#39d353', frenzy: '#ff8c1a', bombify: '#ff3b3b', weaken: '#aaaaaa', vulnerable: '#c026d3' };
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
  // Eased 4%->1% per stack/sec (v1.36.90) - at max rank (5 stacks * 5s
  // duration), the old rate summed to 100% of the poisoned enemy's own
  // maxHp, meaning poison alone could kill any enemy regardless of the
  // player's actual damage output once 5 stacks landed. 1% caps the same
  // full-duration, max-stack burn at 25% of maxHp instead - still a
  // meaningful DoT, but no longer a standalone kill button.
  const POISON_DMG_PCT = 0.01;
  function poisonMaxStacksForLevel(level) { return level; }

  // Frenzy (v1.36.4, buff/debuff removed in v1.36.87): a frenzied enemy
  // also deals contact damage to whichever OTHER enemy it touches, not
  // just the player - landed well into a dense cluster, this can trigger
  // enemy-on-enemy friendly fire that thins the swarm out on its own.
  // Originally paired with a dealt-damage buff (frenzyDmgMultForStacks)
  // and a damage-taken debuff (frenzyTakenDmgMultForStacks) on top of the
  // friendly fire itself. A live simulation (comparing actual friendly-fire
  // damage/kills with and without those two multipliers) found the debuff
  // - not the friendly fire mechanic itself - was doing most of the felt
  // work, and that it wasn't even specific to friendly fire: it lived in
  // damageEnemy() itself, so it silently boosted every damage source
  // (the player's own hits included) against a frenzied enemy, not just
  // what other enemies did to it. Both are removed here - frenzy is now
  // purely "this enemy also attacks its neighbors," full stop, with no
  // side effect on how hard anything hits. The old debuff still exists,
  // just pulled out into its own standalone bullet effect (脆弱/vulnerable,
  // below) that a player has to choose to invest in separately, rather
  // than getting a share of it for free just from taking frenzy alone -
  // meant to open up (not remove) a friendly-fire-focused build: frenzy
  // (to start the fights) plus something that clusters enemies together
  // (chain, magnetstorm) plus vulnerable (to make those fights actually
  // finish enemies off) is now a deliberate combination to build toward,
  // instead of a side effect every frenzy pick came with automatically.
  //
  // No longer stacks (v1.36.87) - there's nothing left for a stack count
  // to modulate now that both multipliers are gone. Like bombify/weaken, a
  // later hit just refreshes frenzyTimer to a fresh
  // frenzyDurationForLevel(rank) instead of adding a stack; rank now
  // raises how long the status lasts instead of how many stacks can pile
  // up. FRENZY_DURATION_BASE(5) matches the old fixed FRENZY_DURATION, so
  // a fresh rank-1 pick is unchanged from before this rework. Used to also
  // speed the enemy up (FRENZY_SPEED_MULT) - removed in v1.36.59, movement
  // speed is unaffected by frenzy now.
  const FRENZY_DURATION_BASE = 5;
  const FRENZY_DURATION_PER_LEVEL = 2;
  function frenzyDurationForLevel(level) { return FRENZY_DURATION_BASE + FRENZY_DURATION_PER_LEVEL * (level - 1); }

  // Vulnerable (脆弱, v1.36.87, reworked v1.36.88 to mirror weaken's shape
  // instead of poison's): split out of frenzy's old damage-taken debuff,
  // now its own independent bullet effect a player has to pick on its own.
  // Originally a poison-style stacking status (+20%/stack, capped stack
  // count) - changed to pair conceptually with 衰弱/weaken (its exact
  // opposite: weaken reduces a dealt-damage multiplier by rank, vulnerable
  // increases a taken-damage multiplier by rank) rather than with poison,
  // since both weaken and vulnerable are single-flag "is this debuff
  // active or not" statuses with no real use for a magnitude-via-repeated-
  // hits mechanic. No stacking at all now - VULNERABLE_DURATION doesn't
  // extend, a later hit just refreshes vulnerableTimer back to full (same
  // non-stacking, refresh-on-rehit design as weaken/bombify). Rank now
  // raises the damage-taken multiplier directly instead of a stack cap.
  // Applies uniformly to EVERY damage source via damageEnemy() (player
  // hits, explosion, chain, poison, killzone, bombify splash, frenzy's own
  // friendly fire, Tank's reflect) - it isn't wired to frenzy or friendly
  // fire specifically at all, but naturally pairs well with anything that
  // lands repeated hits on the same clustered/afflicted enemies.
  const VULNERABLE_DURATION = 5;
  // Mirrors weakenDmgMultForLevel's exact curve, just as an increase
  // instead of a decrease - keeps the two "single-flag, rank-scales-the-
  // percentage" statuses on one shared number line instead of each
  // inventing its own curve. Both eased 30%->70%/rank down to 20%->48%/rank
  // (v1.36.89) after the original curve read as too strong for a flat,
  // always-on percentage modifier.
  function vulnerableDmgMultForLevel(level) { return 1 + (0.2 + 0.07 * (level - 1)); }

  // Bombify (v1.36.5): unlike poison/frenzy, this status doesn't stack at
  // all and has no effect while the target is alive - a later hit while
  // already bombified just refreshes bombifyTimer back to full rather than
  // adding a stack. Its entire payoff is conditional: if the target dies
  // while bombifyTimer > 0, it detonates for damage (see bombifyDamage
  // below) to every other enemy within BOMBIFY_RADIUS. Detonating a
  // bombified enemy can itself kill neighboring bombified enemies, chaining
  // into further detonations - see the resolution loop in update().
  // Duration cut 5s -> 3s (v1.36.7): re-hitting the same enemy still
  // refreshes the timer without limit, but the shorter window means a
  // build has to keep focusing fire on one enemy to have a real chance of
  // killing it while still bombified, rather than tagging a bunch of
  // enemies once and letting the crowd's natural kill pace trigger it.
  const BOMBIFY_DURATION = 3;
  const BOMBIFY_RADIUS = 180;
  // Damage source flipped from the detonated enemy's own maxHp to the
  // PLAYER's own offense (v1.36.91, single-rank now - see maxLevel:1 on
  // the BULLET_EFFECTS entry above). The old percent-of-own-maxHp formula
  // put bombify in the same "scales with the target, not the attacker"
  // niche as poison, but bombify's prerequisite (爆発 fully ranked) already
  // pushes it onto damage/attack-speed-heavy builds specifically, so tying
  // its payoff to the player's own DPS instead rewards exactly that
  // investment rather than duplicating poison's identity. Read live at
  // detonation time (like weakenDmgMultForLevel/vulnerableDmgMultForLevel
  // elsewhere), so a mid-run damage/attack-speed upgrade immediately
  // strengthens every bombified enemy already waiting to detonate. Doesn't
  // factor in multishot/pierce/etc. - just raw single-target damage over
  // time (damage / atkCooldown), matching the "roughly your own DPS"
  // framing this was designed around.
  function bombifyDamage(p) { return p.damage / p.atkCooldown; }

  // Weaken (v1.36.8): split out of slow, which used to also halve a
  // slowed enemy's contact damage - that coupling meant taking slow always
  // meant taking a damage debuff too, with no way to get one without the
  // other. Weaken is its own pick so a player who wants the offense-
  // suppression effect specifically has to actually invest in it (no
  // longer gated behind maxed-out slow as of v1.36.88 - always available
  // like most other bullet effects). Same non-stacking, refresh-on-rehit
  // design as bombify: no stack count, a later hit just resets weakenTimer
  // to WEAKEN_DURATION. Rank raises the damage reduction directly -
  // originally reused bombify's 30%->70% curve verbatim, eased down to
  // 20%->48%/rank (v1.36.89) after it read as too strong for a flat,
  // always-on percentage modifier (vulnerable's mirror curve, above, moved
  // with it to keep the two in lockstep).
  const WEAKEN_DURATION = 5;
  function weakenDmgMultForLevel(level) { return 1 - (0.2 + 0.07 * (level - 1)); }

  // Threat vignette: difficulty-driven enemy stats scale flexibly enough
  // that a player can't eyeball "difficulty N means this much contact
  // damage" - so instead of a numeric readout, warn directly whenever an
  // enemy within THREAT_RADIUS could one-shot the player at its current
  // effective damage (frenzy/weaken multipliers included), checked every
  // frame in the same loop that already computes those multipliers.
  const THREAT_RADIUS = 220;

  // Impact effects (v1.36.35): a persistent circular zone left behind at a
  // hit's impact point, rather than an instant effect on the target itself.
  // Deliberately excluded from chain - they're spawned directly inside
  // resolveProjectileHit (once per primary hit target), never inside
  // applyOnHitStatuses (the method chain hops call instead, see chain's
  // resolution loop) - so a chained hop never leaves its own zone behind.
  // Each type is its own independently-ranked bullet effect (own Player
  // level field, own BULLET_EFFECTS entry, same maxLevel=5 pattern as
  // explosion/chain/etc above), so a build can invest in some without
  // others.
  const IMPACT_EFFECT_COLORS = { magnetstorm: '#6a5cff', killzone: '#ff2d55', poisoncloud: '#39d353' };
  // How long before expiry a zone's circle starts fading out (see draw()) -
  // short relative to even the shortest zone (magnetstorm, 3s) so a
  // life/maxLife fade doesn't wash out most of a longer-lived zone's
  // visible lifetime.
  const IMPACT_EFFECT_FADE_OUT = 0.5;
  // At most one zone of each type can exist at a time - if one is already
  // active, a new hit of that type is simply skipped (v1.36.37: changed
  // from replacing the existing zone) so the effect reads as a placed trap
  // that stays put once set. See Game.spawnImpactEffect.

  // How often, in seconds, an enemy that's continuously standing inside a
  // killzone/poisoncloud zone gets hit again (v1.36.38) -
  // these share this same periodic-tick model; magnetstorm doesn't
  // use it at all (its pull is already continuous every frame, not a
  // discrete "tick"). The first tick lands this many seconds AFTER entry,
  // not instantly on entry (e.g. 5 poison stacks from a maxed poison cloud
  // takes 5 * 0.3s = 1.5s of continuous standing, matching the design
  // spec's own worked example).
  const IMPACT_EFFECT_TICK_INTERVAL = 0.3;

  class ImpactEffect {
    constructor(type, x, y, radius, life, dmgPerSec) {
      this.type = type;
      this.x = x; this.y = y;
      this.radius = radius;
      this.life = life;
      this.maxLife = life;
      this.dmgPerSec = dmgPerSec || 0; // killzone only
      // killzone/poisoncloud only: Map<Enemy, secondsUntilNextTick>
      // for every enemy currently inside this specific zone instance - each
      // tracks its own countdown independently of when other enemies
      // entered. An enemy that leaves the zone is dropped from this map
      // entirely, so re-entering later starts a fresh countdown rather than
      // resuming a stale one (see the per-frame tick in update()).
      this.tickTimers = new Map();
    }
  }

  // 磁気嵐/Magnetic Storm: pulls enemies within radius toward the zone's
  // center and holds them there (see the per-frame pull in update()).
  // Duration is fixed - rank only raises the pull radius, both because a
  // wider net is this effect's whole value proposition and to keep it
  // simple relative to the other three (which each only scale one thing).
  const MAGNETSTORM_DURATION = 3;
  // 100-200 (v1.36.35) -> halved to 50-100 (v1.36.37, too small) -> settled
  // on the midpoint of the two, 75-150 (v1.36.38).
  function magnetStormRadiusForLevel(level) { return 75 + 18.75 * (level - 1); }
  const MAGNETSTORM_PULL_SPEED = 220; // px/s enemies are dragged toward center while inside

  // キルゾーン/Kill Zone: periodic-tick DPS (see IMPACT_EFFECT_TICK_INTERVAL)
  // to anything standing inside. Damage is a percent of the triggering
  // hit's own damage (proj.damage, same basis explosion/chain already scale
  // off), snapshotted once at spawn time rather than re-read live -
  // consistent with how every other on-hit effect in this game bakes its
  // power in at the moment of the hit.
  const KILLZONE_DURATION = 5;
  // Radius now scales with rank too (v1.36.38) - originally fixed while only
  // damage scaled, but that left killzone as the only one of the four with
  // just one rank-up axis. Same 90-170 (v1.36.35) -> 45-85 (v1.36.37) ->
  // 67.5-127.5 (v1.36.38) progression as frenzy fountain/poison cloud below,
  // since killzone's old fixed value (90) matched their own Lv.1 base.
  function killZoneRadiusForLevel(level) { return 67.5 + 15 * (level - 1); }
  function killZoneDmgPctForLevel(level) { return 0.5 + 0.25 * (level - 1); } // fraction of proj.damage dealt per second

  // ポイズンクラウド/Poison Cloud: applies the existing poison status (same
  // POISON_DURATION, same duration/stack-cap formulas) to enemies standing
  // inside, once every IMPACT_EFFECT_TICK_INTERVAL seconds per enemy (see
  // ImpactEffect.tickTimers and the tick loop in update()) - so lingering
  // inside behaves like getting re-hit by a normal shot on that same
  // cadence, stacking poison up to its cap over time rather than only ever
  // applying once. Deliberately reuses the player's own poisonLevel rank to
  // determine how strong the applied status is - this zone is a new
  // delivery method for an existing status, not a second independent
  // version of it - so it's only offered once poison has at least one rank
  // (available gate on the BULLET_EFFECTS entry below), and only its own
  // radius scales with its own rank.
  //
  // 狂乱の泉/Frenzy Fountain (the same idea applied to frenzy) was removed
  // in v1.36.92 - it existed specifically to help low-attack-speed frenzy
  // builds keep re-stacking frenzy over time, but frenzy stopped stacking
  // at all once v1.36.87 redesigned it into a flat, non-stacking duration
  // effect, so the zone's entire reason for existing was gone.
  const POISONCLOUD_DURATION = 10;
  function poisonCloudRadiusForLevel(level) { return 67.5 + 15 * (level - 1); }

  const BULLET_EFFECTS = [
    {
      id: 'explosion',
      name: '爆発',
      maxLevel: 5,
      category: 'offense',
      getLevel: p => p.explosionLevel,
      levelUp: p => { p.explosionLevel++; },
      introDesc: '着弾時、一定確率で着弾地点の周囲に範囲ダメージを与えるようになる',
      upgradeDesc: level => `爆発範囲が拡大する`,
    },
    {
      id: 'chain',
      name: '連鎖',
      maxLevel: 5,
      category: 'crowd',
      getLevel: p => p.chainLevel,
      levelUp: p => { p.chainLevel++; },
      introDesc: '着弾時、一定確率で近くの敵にもダメージが連鎖するようになる',
      upgradeDesc: level => `連鎖回数が増加する`,
    },
    {
      id: 'slow',
      name: '低速',
      maxLevel: 5,
      category: 'defense',
      getLevel: p => p.slowLevel,
      levelUp: p => { p.slowLevel++; },
      introDesc: '着弾した敵を一時的に減速させるようになる',
      upgradeDesc: level => `減速時間が増加する`,
    },
    {
      id: 'pierce',
      name: '貫通',
      maxLevel: 5,
      category: 'crowd',
      getLevel: p => p.pierce,
      levelUp: p => { p.pierce++; },
      introDesc: '弾が敵を貫通するようになる',
      upgradeDesc: level => `貫通数が増加する`,
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
      category: 'offense',
      getLevel: p => p.poisonLevel,
      levelUp: p => { p.poisonLevel++; },
      introDesc: '着弾した敵を毒状態にし、継続的に毒ダメージを与えるようになる。毒状態中に再度攻撃が当たると重ね掛けされ、毒ダメージが増加する(持続時間は延長されない)',
      upgradeDesc: level => `毒の重ね掛け上限が増加する`,
    },
    {
      id: 'frenzy',
      name: '狂乱',
      maxLevel: 5,
      category: 'crowd',
      getLevel: p => p.frenzyLevel,
      levelUp: p => { p.frenzyLevel++; },
      introDesc: '着弾した敵を狂乱状態にし、自機だけでなく他の敵も攻撃するようになる(同士討ち)',
      upgradeDesc: level => `狂乱の持続時間が増加する`,
    },
    {
      // Single-rank now (v1.36.91, was maxLevel:5): the per-rank damage
      // curve (bombifyDmgPctForLevel) is gone along with the enemy-maxHp-
      // based formula itself (see bombifyDamage below) - there's no longer
      // a rank axis to spend further picks on, so this is a one-time
      // unlock like any other single-pick effect. upgradeDesc is
      // unreachable as a result (notMaxedEffects excludes it once
      // getLevel===maxLevel===1) and intentionally omitted.
      id: 'bombify',
      name: '爆弾化',
      maxLevel: 1,
      category: 'offense',
      getLevel: p => p.bombifyLevel,
      levelUp: p => { p.bombifyLevel++; },
      // Gated behind 爆発 being fully ranked up (v1.36.7) - on its own,
      // stacking with poison/frenzy/explosion made it too strong too early.
      // Requiring the player to already have committed to explosion's own
      // maxLevel first pushes it later into a run and onto builds that
      // have already invested in AoE.
      available: p => p.explosionLevel >= 5,
      introDesc: '着弾した敵を爆弾化する。生存中は特に効果はないが、爆弾化状態のまま倒された敵は周囲の他の敵に爆発ダメージを与える(威力は自機の攻撃力・攻撃間隔から算出した1秒あたりのダメージ量相当)。重ね掛けはされず、再度攻撃が当たると持続時間が最大まで更新される',
    },
    {
      id: 'weaken',
      name: '衰弱',
      maxLevel: 5,
      category: 'defense',
      getLevel: p => p.weakenLevel,
      levelUp: p => { p.weakenLevel++; },
      // Gate removed (v1.36.88) - previously required 低速 fully ranked up
      // first, same idea as bombify/爆発. Dropped to put weaken and its new
      // pair vulnerable (below) on equal footing: neither is gated behind
      // another bullet effect anymore.
      introDesc: '着弾した敵を衰弱状態にし、攻撃力を低下させる。重ね掛けはされず、再度攻撃が当たると持続時間が最大まで更新される',
      upgradeDesc: level => `衰弱による攻撃力低下率が増加する`,
    },
    {
      // Split out of frenzy's old damage-taken debuff (v1.36.87), reworked
      // (v1.36.88) from a poison-style stacking status into weaken's exact
      // mirror instead: no stacking, fixed duration, rank raises the
      // damage-taken multiplier directly (vulnerableDmgMultForLevel) - the
      // same shape as weakenDmgMultForLevel just as an increase rather
      // than a decrease. Applies to every damage source uniformly
      // (damageEnemy()), not just friendly fire - deliberately doesn't
      // reference frenzy at all here.
      id: 'vulnerable',
      name: '脆弱',
      maxLevel: 5,
      category: 'offense',
      getLevel: p => p.vulnerableLevel,
      levelUp: p => { p.vulnerableLevel++; },
      introDesc: '着弾した敵を脆弱状態にし、あらゆる攻撃に対する被ダメージを増加させる。重ね掛けはされず、再度攻撃が当たると持続時間が最大まで更新される',
      upgradeDesc: level => `脆弱による被ダメージ増加率が上昇する`,
    },
    {
      id: 'magnetstorm',
      name: '磁気嵐',
      maxLevel: 5,
      category: 'utility',
      getLevel: p => p.magnetstormLevel,
      levelUp: p => { p.magnetstormLevel++; },
      introDesc: '着弾地点に一定時間残る渦を発生させ、範囲内の敵を中心に引き寄せて留め置くようになる(連鎖では発生しない)',
      upgradeDesc: level => `磁気嵐の範囲が拡大する`,
    },
    {
      id: 'killzone',
      name: 'キルゾーン',
      maxLevel: 5,
      category: 'crowd',
      getLevel: p => p.killzoneLevel,
      levelUp: p => { p.killzoneLevel++; },
      introDesc: '着弾地点に一定時間残る領域を発生させ、範囲内に留まる敵に継続的にダメージを与え続けるようになる(連鎖では発生しない)',
      upgradeDesc: level => `キルゾーンの範囲とダメージが増加する`,
    },
    {
      id: 'poisoncloud',
      name: 'ポイズンクラウド',
      maxLevel: 5,
      category: 'crowd',
      getLevel: p => p.poisoncloudLevel,
      levelUp: p => { p.poisoncloudLevel++; },
      // Gated behind 猛毒 having at least 1 rank - this zone applies
      // whatever poison rank the player already has, so without 猛毒 taken
      // at all it would just be a zone that does nothing (same reasoning
      // as killzone's own applied-effect gates elsewhere).
      available: p => p.poisonLevel > 0,
      introDesc: '着弾地点に一定時間残る毒雲を発生させ、範囲内に留まる敵に継続的に毒状態を付与し続けるようになる(連鎖では発生しない)。付与される毒のランクは「猛毒」の取得状況がそのまま反映される',
      upgradeDesc: level => `ポイズンクラウドの範囲が拡大する`,
    },
  ];

  // Slots 2-3 of a level-up draw from the full pool but at reduced odds for
  // bullet effects specifically - slot 1 already exists to funnel players
  // toward bullet effects (either deepening one they own, or a normal draw
  // when they own none yet), so without this the other two slots would
  // double up on that same bias instead of mostly offering plain/tradeoff
  // variety.
  const BULLET_EFFECT_SLOT_WEIGHT = 0.4;
  // Pity (v1.36.44): each consecutive level-up an upgrade was eligible but
  // not offered adds this much to its own weight multiplier (1 + miss *
  // PITY_WEIGHT_PER_MISS), on top of the bullet-effect discount above - so
  // an upgrade that keeps not coming up gradually becomes more likely to,
  // rather than being purely at the mercy of the raw pool-size odds
  // forever. Uncapped by design: the longer something goes unseen, the
  // more it should stand out from the crowd, and since this only scales
  // relative weight (not a guarantee), a very long streak still has to win
  // an actual weighted draw against whatever else is also overdue.
  const PITY_WEIGHT_PER_MISS = 0.15;
  function pickWeightedIndex(pool, missStreak) {
    const weights = pool.map(up => {
      const base = up.id.startsWith('bullet-') ? BULLET_EFFECT_SLOT_WEIGHT : 1;
      const miss = (missStreak && missStreak[up.id]) || 0;
      return base * (1 + miss * PITY_WEIGHT_PER_MISS);
    });
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
      title: level === 0 ? `${effect.name}(New)` : `${effect.name} ランク${level}→${level + 1}`,
      desc: level === 0 ? effect.introDesc : effect.upgradeDesc(level),
      category: effect.category,
      apply: p => effect.levelUp(p),
    };
  }

  // Drones (v1.36.63 as "aux weapons", reframed v1.36.82): each entry is
  // structurally identical to a BULLET_EFFECTS entry (getLevel/levelUp/
  // maxLevel/category/introDesc/upgradeDesc, read the owned count directly
  // off the player) rather than the old single-shared-slot model - any
  // number of drone types can now be owned independently at once, so
  // there's no more "deepen the one already held vs switch to a different
  // one" distinction to handle (droneUpgrade below is accordingly much
  // simpler than the old auxWeaponUpgrade it replaces).
  const DRONES = [
    {
      // Multi-status pivot (v1.36.91): originally applied a flat slow
      // regardless of the player's own build (falling back to
      // JAMMING_BASE_DURATION if slow wasn't even taken), which made it a
      // weak pick on its own - slow alone barely functions as defense. Now
      // it instead re-applies whichever debuff(s) the player has actually
      // invested in (slow/vulnerable/weaken) to anything that wanders into
      // range, so its value scales with - and rewards - a debuff-focused
      // build rather than being a flat, low-impact freebie. Gated on
      // owning at least one of the three (see `available`) since with none
      // owned it would have nothing to apply at all.
      id: 'jamming',
      name: 'ジャミングドローン',
      maxLevel: 5,
      category: 'defense',
      color: JAMMING_DRONE_ZAP_COLOR,
      getLevel: p => p.jammingDroneCount,
      levelUp: p => { p.jammingDroneCount++; },
      available: p => p.slowLevel >= 1 || p.vulnerableLevel >= 1 || p.weakenLevel >= 1,
      introDesc: '自機のごく至近距離に入った敵に、自機が取得済みのデバフ状態異常(低速・脆弱・衰弱のうち保有しているもの全て)を自動で付与するジャミングドローンを1台獲得する',
      upgradeDesc: count => `ジャミングドローンをもう1台獲得する(同時にデバフを付与できる敵の数が増加する)`,
    },
    {
      id: 'impact',
      name: 'インパクトドローン',
      maxLevel: 5,
      category: 'defense',
      color: IMPACT_DRONE_ZAP_COLOR,
      getLevel: p => p.impactDroneCount,
      levelUp: p => { p.impactDroneCount++; },
      introDesc: '自機のごく至近距離に入った敵を自動で自機から遠ざかる方向へ押し出すインパクトドローンを1台獲得する',
      upgradeDesc: count => `インパクトドローンをもう1台獲得する(同時に押し出せる敵の数が増加する)`,
    },
    {
      // Damage formula reuses REFLECT_DMG_PCT_OF_ATTACK/OF_MAXHP verbatim -
      // the same numbers the old tank passive (REFLECT_PASSIVE, now dead
      // code kept around for exactly this kind of reuse - see its own
      // comment) used for its reflected counter-hit. This drone fires it
      // proactively on the shared DRONE_ATK_INTERVAL instead of reactively
      // on taking damage, but the "how hard does it hit" math is identical.
      id: 'attack',
      name: 'アタックドローン',
      maxLevel: 5,
      category: 'offense',
      color: ATTACK_DRONE_ZAP_COLOR,
      getLevel: p => p.attackDroneCount,
      levelUp: p => { p.attackDroneCount++; },
      introDesc: '自機のごく至近距離に入った敵に自動で攻撃を行うアタックドローンを1台獲得する(威力は自機の最大HP・攻撃力に応じて上昇する)。「爆発」を取得済みなら、その効果がアタックドローンの攻撃にも発生するようになる',
      upgradeDesc: count => `アタックドローンをもう1台獲得する(同時に攻撃できる敵の数が増加する)`,
    },
  ];

  function droneUpgrade(drone, player) {
    const count = drone.getLevel(player);
    return {
      id: `drone-${drone.id}`,
      title: count === 0 ? `${drone.name}(New)` : `${drone.name} ${count}→${count + 1}台`,
      desc: count === 0 ? drone.introDesc : drone.upgradeDesc(count),
      category: drone.category,
      apply: p => drone.levelUp(p),
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

  // Category-targeted reroll (v1.36.70): every upgrade/tradeoff/bullet
  // effect/aux weapon above is tagged with one of these three categories
  // (see each entry's `category` field). REROLL_OFFER_CHANCE of the time,
  // the level-up screen's 4th slot (normally always SKIP_UPGRADE) instead
  // offers a reroll restricted to one randomly-chosen category - picking it
  // re-draws the top 3 slots from just that category (excluding whatever
  // was already shown) and always ends with a plain skip as the 4th slot
  // this second time (no reroll-of-a-reroll).
  // 4 categories (v1.36.71, up from 3): offense was disproportionately
  // large (14 of 24 entries) since it had absorbed everything
  // damage-related regardless of single-target vs multi-target. Split out
  // a 'crowd' category (multi-target/AoE tools: hits or affects more than
  // one enemy per activation) to thin offense back down.
  const UPGRADE_CATEGORIES = ['offense', 'crowd', 'defense', 'utility'];
  const CATEGORY_NAMES = { offense: 'オフェンス', crowd: 'クラウド', defense: 'ディフェンス', utility: 'ユーティリティ' };
  const REROLL_OFFER_CHANCE = 0.5;

  // Reject (v1.36.93): long-press a level-up card to permanently exclude
  // that upgrade from this run's pool (see Player.rejectedUpgradeIds).
  // Applies to any of the 3 drawn cards (bullet effect/drone/stat upgrade/
  // tradeoff alike, no exceptions) - not to the always-present 4th slot
  // (skip or category reroll), since neither of those is actually drawn
  // from the pool in the same sense.
  const REJECT_USES_BASE = 3;
  // Long enough that an ordinary tap/click (pick) never accidentally
  // triggers it, short enough that a deliberate hold doesn't feel like a
  // stuck button.
  const REJECT_LONG_PRESS_MS = 600;
  // Moving the pointer/finger further than this while held cancels the
  // long-press entirely (neither pick nor reject fires on release) -
  // distinguishes a deliberate hold from a drag/scroll gesture that
  // happens to start on a card.
  const REJECT_LONG_PRESS_MOVE_CANCEL_PX = 20;

  // ---------- Game controller ----------
  class Game {
    constructor(character, weapon) {
      this.player = new Player(character, weapon);
      this.enemies = [];
      this.projectiles = [];
      this.enemyProjectiles = [];
      this.gems = [];
      this.hearts = [];
      this.heartSpawnTimer = HEART_SPAWN_CHECK_INTERVAL;
      this.particles = [];
      this.chainZaps = [];
      this.sweepEffects = [];
      this.beamEffects = [];
      this.impactEffects = [];
      this.camX = 0;
      this.camY = 0;
      this.time = 0;
      this.kills = 0;
      this.spawnTimer = 0;
      this.spawnInterval = 1.1;
      this.over = false;
      this.levelingUp = false;
      // The 3 real upgrade cards currently on screen (v1.36.93) - tracked
      // here rather than only as a local variable so rejectUpgrade() can
      // find and replace one slot from outside onLevelUp()'s own call
      // frame. Empty until the first level-up actually renders cards.
      this.currentPicks = [];
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

      // Terrain walls (v1.36.50): wallChunks maps a "cx,cy" chunk key to the
      // (possibly empty) array of Wall instances generated for that chunk;
      // generatedChunks just tracks which chunk keys have been rolled at all
      // (including ones that rolled zero walls), so a chunk is never
      // re-rolled once visited. flowFieldCache holds the last computed
      // pathfinding grid (see buildFlowField) - null until the first enemy
      // actually needs a detour. Chunks around the starting position are
      // generated immediately so walls can exist from frame 1, not just
      // after the first update() tick.
      this.wallChunks = new Map();
      this.generatedChunks = new Set();
      this.flowFieldCache = null;
      this.generateNearbyChunks();

      // Spawn pattern (v1.36.62, see rollSpawnPattern) - which non-boss
      // types are even eligible to spawn this wave. Rolled once here so
      // it's already valid for the very first spawn, then re-rolled at
      // every wave boundary (see update()).
      this.currentSpawnPattern = [];
      this.rollSpawnPattern();
    }

    // Picks which non-boss enemy types are allowed to spawn for the
    // current wave: a random-sized subset (1, 2, 3, or "all currently
    // unlocked") drawn from whichever types this.difficulty has actually
    // unlocked (ENEMY_TYPES[type].minDifficulty) at the moment the wave
    // starts. Re-rolled independently each wave (no rotation state to
    // track) - a run might see the same size or type set again next wave
    // purely by chance, which is fine given the ask was for random
    // variety, not a strict round-robin sequence.
    //
    // No pure-ranged pattern (v1.36.81): a pattern made up entirely of
    // 射撃系/ranged types (see RANGED_ENEMY_TYPES) would let the ranged
    // category's own RANGED_MAX_ALIVE cap fill up on its own, over and
    // over, every single spawn - the exact all-barrage scenario the cap
    // exists to prevent in the first place. Guaranteed by drawing one
    // 通常系/normal type first (whenever one is unlocked - grunt's
    // minDifficulty=1 means one always is, from the very first wave
    // onward) before filling the rest of the pattern from everything else
    // unlocked, ranged included.
    rollSpawnPattern() {
      const unlocked = NON_BOSS_ENEMY_TYPES.filter(t => this.difficulty >= ENEMY_TYPES[t].minDifficulty);
      const sizeOptions = [1, 2, 3, unlocked.length];
      const size = Math.min(sizeOptions[randInt(0, sizeOptions.length - 1)], unlocked.length);
      const normalUnlocked = unlocked.filter(t => NORMAL_ENEMY_TYPES.includes(t));
      const pattern = [];
      if (normalUnlocked.length > 0) {
        pattern.push(normalUnlocked[randInt(0, normalUnlocked.length - 1)]);
      }
      const pool = unlocked.filter(t => t !== pattern[0]);
      while (pattern.length < size && pool.length) {
        pattern.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
      }
      this.currentSpawnPattern = pattern;
    }

    // Builds the full eligible-upgrade pool for the player's current state
    // (same `available` gating as always). Factored out of onLevelUp() so
    // rerollCategory() (v1.36.70) can build the identical pool for its own
    // category-restricted draw without duplicating the gating logic - the
    // only thing that should ever differ between an initial draw and a
    // reroll is which subset of this same pool gets sampled from.
    buildUpgradePool() {
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
      // Drone candidates (v1.36.63 as aux weapons): each not-yet-maxed
      // drone type offers its own "own one more" card independently, same
      // gating as notMaxedEffects above (v1.36.82 - previously only the
      // single currently-held aux weapon could offer a card this way, with
      // every other one offered unconditionally as a "switch" card
      // instead; that whole distinction is gone now that drone types
      // coexist). Also gated on the shared pool cap (v1.36.84, see
      // droneSlotCap/totalDroneCount) - once total owned drones across all
      // types hits the cap, no drone card is offered at all, regardless of
      // whether any individual type is still under its own maxLevel(5).
      // Not part of the bullet-effect priority slot below (that's
      // specifically for BULLET_EFFECTS) or the bullet-effect pity-weight
      // discount (pickWeightedIndex only discounts ids prefixed `bullet-`)
      // - these draw at the normal weight like UPGRADE_POOL/TRADEOFF_POOL
      // entries.
      const notMaxedDrones = totalDroneCount(this.player) < droneSlotCap(this.player.droneSlotRank)
        ? DRONES.filter(d => d.getLevel(this.player) < d.maxLevel && (!d.available || d.available(this.player)))
        : [];
      // Reject filter (v1.36.93) applied once at the end, keyed off each
      // entry's own final `id` - the same string rejectUpgrade() records,
      // so this single filter covers every pool source (stat upgrades,
      // tradeoffs, bullet effects, drones) without needing its own gate on
      // each one individually.
      return [
        ...UPGRADE_POOL.filter(up => !up.available || up.available(this.player)),
        ...TRADEOFF_POOL.filter(up => !up.available || up.available(this.player)),
        ...notMaxedEffects.map(eff => bulletEffectUpgrade(eff, this.player)),
        ...notMaxedDrones.map(d => droneUpgrade(d, this.player)),
      ].filter(up => !this.player.rejectedUpgradeIds.has(up.id));
    }

    onLevelUp() {
      this.levelingUp = true;
      const picks = [];
      // Rejected ids filtered here too (in addition to buildUpgradePool()'s
      // own filter) since this method computes its own separate
      // notMaxedEffects/notMaxedDrones for the priority slot below, rather
      // than reusing buildUpgradePool()'s internal copies.
      const notMaxedEffects = BULLET_EFFECTS.filter(eff =>
        eff.getLevel(this.player) < eff.maxLevel && (!eff.available || eff.available(this.player))
          && !this.player.rejectedUpgradeIds.has(`bullet-${eff.id}`)
      );
      const pool = this.buildUpgradePool();

      // Slot 1 is an "already invested" priority slot: if the player
      // already has at least one level in some not-yet-maxed bullet effect,
      // or already owns at least one not-yet-maxed drone (v1.36.68 for the
      // original single-aux-weapon version; generalized to any number of
      // owned drone types in v1.36.82), that slot is reserved for deepening
      // one of those instead of a plain random draw, so committing to
      // something keeps paying off instead of getting diluted by the rest
      // of the pool. With nothing owned yet (or everything owned already
      // maxed), it just behaves like a normal slot (and so gets the same
      // pity-weighted draw as slots 2-3 - pity's whole point is helping a
      // wanted upgrade actually get OFFERED, which this fallback case is;
      // the owned branch above it is a deliberately narrow,
      // already-favorable choice on its own and isn't what players are
      // missing out on).
      const ownedEffects = notMaxedEffects.filter(eff => eff.getLevel(this.player) > (eff.baseLevel || 0));
      const notMaxedDrones = totalDroneCount(this.player) < droneSlotCap(this.player.droneSlotRank)
        ? DRONES.filter(d => d.getLevel(this.player) < d.maxLevel && (!d.available || d.available(this.player))
          && !this.player.rejectedUpgradeIds.has(`drone-${d.id}`))
        : [];
      const ownedDrones = notMaxedDrones.filter(d => d.getLevel(this.player) > 0);
      const missStreak = this.player.upgradeMissStreak;
      let firstPick;
      if (ownedEffects.length > 0 || ownedDrones.length > 0) {
        const firstSlotPool = [
          ...ownedEffects.map(eff => bulletEffectUpgrade(eff, this.player)),
          ...ownedDrones.map(d => droneUpgrade(d, this.player)),
        ];
        firstPick = firstSlotPool[randInt(0, firstSlotPool.length - 1)];
      } else {
        const idx = pickWeightedIndex(pool, missStreak);
        firstPick = pool[idx];
      }
      picks.push(firstPick);

      const remainingPool = pool.filter(up => up.id !== firstPick.id);
      for (let i = 0; i < 2 && remainingPool.length; i++) {
        const idx = pickWeightedIndex(remainingPool, missStreak);
        picks.push(remainingPool.splice(idx, 1)[0]);
      }

      // Update pity streaks: anything eligible this round (in `pool`) that
      // didn't make it into `picks` goes another level-up without being
      // seen; anything that did make it in resets to 0 (it just got its
      // chance, fair or not).
      const offeredIds = new Set(picks.map(up => up.id));
      for (const up of pool) {
        missStreak[up.id] = offeredIds.has(up.id) ? 0 : (missStreak[up.id] || 0) + 1;
      }

      // allowRerollOffer=true: this is the initial draw, so the 4th slot
      // may become a category reroll instead of a plain skip (v1.36.70,
      // see renderUpgradeCards).
      this.renderUpgradeCards(picks, true);
    }

    // Renders the level-up screen: `picks` (always 3 real upgrade cards)
    // plus a 4th slot that's either a plain skip or, when allowRerollOffer
    // is true, a REROLL_OFFER_CHANCE roll for a category-targeted reroll
    // card instead (v1.36.70). allowRerollOffer is false when called from
    // rerollCategory() itself - a reroll's own result screen always ends
    // with a plain skip, never a second reroll offer (per spec: "4つ目の
    // 選択肢はスキップになる").
    renderUpgradeCards(picks, allowRerollOffer) {
      upgradeChoicesEl.innerHTML = '';
      upgradeChoicesEl.appendChild(upgradePicksEl);
      // The 3 real picks live in their own tracked array + sub-container
      // (v1.36.93) rather than being rendered inline here, so rejectUpgrade()
      // can later swap just one of them and redraw only #upgrade-picks
      // without disturbing the 4th slot built below.
      this.currentPicks = picks;
      this.renderPickCards();

      const fourthCard = document.createElement('div');
      fourthCard.className = 'upgrade-card skip-card';
      const offerReroll = allowRerollOffer && Math.random() < REROLL_OFFER_CHANCE;
      if (offerReroll) {
        const category = UPGRADE_CATEGORIES[randInt(0, UPGRADE_CATEGORIES.length - 1)];
        // Captured now, while `picks` still refers to what's actually on
        // screen - these are exactly the 3 ids the reroll must not draw
        // again (per spec: "リロール前に出現していたアップグレードは
        // 再抽選されない").
        const excludedIds = new Set(picks.map(up => up.id));
        // Tinted the same as the category it's about to reroll into (v1.36.76)
        // - reinforces which color means what, and doubles as the "this is
        // an active choice, not a decline" signal that used to be a
        // hardcoded teal override (see the removed reroll-card title rule
        // in style.css).
        fourthCard.classList.add('reroll-card', `cat-${category}`);
        fourthCard.innerHTML = `<div class="u-title">リロール:${CATEGORY_NAMES[category]}</div><div class="u-desc">上3つの選択肢を「${CATEGORY_NAMES[category]}」系のアップグレードに絞って再抽選する(表示中の3つは再抽選の対象外。この次は必ずスキップになる)</div>`;
        fourthCard.addEventListener('click', () => this.rerollCategory(category, excludedIds));
      } else {
        fourthCard.innerHTML = `<div class="u-title">${SKIP_UPGRADE.title}</div><div class="u-desc">${SKIP_UPGRADE.desc(this.player)}</div>`;
        fourthCard.addEventListener('click', () => this.pickUpgrade(SKIP_UPGRADE));
      }
      upgradeChoicesEl.appendChild(fourthCard);
      levelupScreen.classList.remove('hidden');
    }

    // Rebuilds #upgrade-picks from this.currentPicks (v1.36.93). Split out
    // of renderUpgradeCards so rejectUpgrade() can redraw just the 3 real
    // cards after swapping one out, without touching the 4th slot (skip/
    // reroll) or re-rolling whether a reroll is even offered this time.
    renderPickCards() {
      upgradePicksEl.innerHTML = '';
      for (const up of this.currentPicks) {
        const card = document.createElement('div');
        // Category color-coding (v1.36.76): a `cat-<category>` class per
        // card (offense/crowd/defense/utility, see UPGRADE_CATEGORIES)
        // drives a left border accent + matching title color in CSS, so
        // a card's category reads at a glance without opening §4-5-2's
        // documentation. Drone cards (id prefixed `drone-`) additionally
        // get a small "ドローン" badge in the title, since those upgrades
        // otherwise look identical to a bullet effect card.
        card.className = `upgrade-card cat-${up.category}`;
        const auxBadge = up.id.startsWith('drone-') ? '<span class="aux-badge">ドローン</span>' : '';
        card.innerHTML = `<div class="u-title">${auxBadge}${up.title}</div><div class="u-desc">${up.desc}</div>`;
        this.attachCardPressHandlers(card, up);
        upgradePicksEl.appendChild(card);
      }
      this.updateRejectHint();
    }

    updateRejectHint() {
      const remaining = this.player.rejectUsesRemaining;
      rejectHintEl.textContent = `長押しでリジェクト　使用回数:残り${remaining}回`;
      rejectHintEl.classList.toggle('depleted', remaining <= 0);
    }

    // Reject (v1.36.93): a short tap/click on a card picks it as always; a
    // hold past REJECT_LONG_PRESS_MS instead rejects it (see
    // Player.rejectedUpgradeIds). Handles both mouse and touch, matching
    // the rest of this game's input handling (dragSurface above) rather
    // than the Pointer Events API.
    //
    // The pick/reject decision only actually fires on release (endPress),
    // never inside the hold timer itself - the timer just arms a flag and
    // adds visual feedback. This matters because rejectUpgrade() rebuilds
    // #upgrade-picks (replacing every card's DOM node); doing that mid-hold
    // (before the input gesture's own up/end event has fired) would let a
    // stray mouseup/touchend land on a brand-new element built for a
    // different upgrade at the same screen position, silently picking it.
    // Deferring the actual mutation to the release handler guarantees the
    // DOM is only ever touched after this gesture's event has already been
    // dispatched to a still-live element.
    attachCardPressHandlers(card, up) {
      let pressTimer = null;
      let longPressFired = false;
      let startX = 0, startY = 0;

      const clearPressTimer = () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      };
      const startPress = (x, y) => {
        startX = x; startY = y;
        longPressFired = false;
        clearPressTimer();
        card.classList.remove('reject-armed');
        if (this.player.rejectUsesRemaining <= 0) return; // no uses left - a hold just behaves like a normal tap on release
        pressTimer = setTimeout(() => {
          longPressFired = true;
          pressTimer = null;
          card.classList.add('reject-armed');
        }, REJECT_LONG_PRESS_MS);
      };
      const movePress = (x, y) => {
        if (pressTimer && Math.hypot(x - startX, y - startY) > REJECT_LONG_PRESS_MOVE_CANCEL_PX) clearPressTimer();
      };
      const endPress = () => {
        clearPressTimer();
        if (longPressFired) this.rejectUpgrade(up);
        else this.pickUpgrade(up);
      };
      const cancelPress = () => {
        clearPressTimer();
        longPressFired = false;
        card.classList.remove('reject-armed');
      };

      card.addEventListener('mousedown', (e) => startPress(e.clientX, e.clientY));
      card.addEventListener('mousemove', (e) => movePress(e.clientX, e.clientY));
      card.addEventListener('mouseup', endPress);
      card.addEventListener('mouseleave', cancelPress);
      card.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.touches[0];
        startPress(t.clientX, t.clientY);
      }, { passive: false });
      card.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const t = e.touches[0];
        if (t) movePress(t.clientX, t.clientY);
      }, { passive: false });
      card.addEventListener('touchend', (e) => {
        e.preventDefault();
        endPress();
      });
      card.addEventListener('touchcancel', cancelPress);
    }

    // Permanently excludes `up.id` from this run's pool (v1.36.93), then
    // replaces just this one slot with a fresh draw from the now-updated
    // pool (excluding whatever's still shown in the other 2 slots, so no
    // duplicate appears). The 4th slot (skip/reroll) is untouched. If the
    // pool has nothing left to offer (an extreme late-run edge case), the
    // slot is simply dropped rather than leaving the rejected card on
    // screen.
    rejectUpgrade(up) {
      if (this.player.rejectUsesRemaining <= 0) return;
      this.player.rejectedUpgradeIds.add(up.id);
      this.player.rejectUsesRemaining--;
      const idx = this.currentPicks.indexOf(up);
      if (idx === -1) { this.updateRejectHint(); return; }
      const shownIds = new Set(this.currentPicks.map(p => p.id));
      const pool = this.buildUpgradePool().filter(cand => !shownIds.has(cand.id));
      if (pool.length > 0) {
        const missStreak = this.player.upgradeMissStreak;
        const replacement = pool[pickWeightedIndex(pool, missStreak)];
        this.currentPicks[idx] = replacement;
        // Just shown this round, same bookkeeping onLevelUp()'s own pity
        // update applies to its picks - without this the replacement would
        // incorrectly still carry whatever miss streak it had before being
        // drawn here.
        missStreak[replacement.id] = 0;
      } else {
        this.currentPicks.splice(idx, 1);
      }
      this.renderPickCards();
    }

    // Category-targeted reroll (v1.36.70): draws 3 fresh cards restricted to
    // `category`, excluding whatever was already shown (excludedIds). Reuses
    // the same weighted draw (pity + bullet-effect discount) as a normal
    // level-up's slots 2-3 - the only difference is the pool is pre-filtered
    // to one category first. If that category doesn't have 3 eligible
    // entries left on its own (a real possibility for the currently-thin
    // utility category), backfills the shortfall from the full pool rather
    // than ever showing fewer than 3 cards - still excluding excludedIds and
    // whatever the category draw already picked.
    rerollCategory(category, excludedIds) {
      const pool = this.buildUpgradePool().filter(up => !excludedIds.has(up.id));
      const missStreak = this.player.upgradeMissStreak;
      const categoryPool = pool.filter(up => up.category === category);
      const picks = [];
      for (let i = 0; i < 3 && categoryPool.length; i++) {
        const idx = pickWeightedIndex(categoryPool, missStreak);
        picks.push(categoryPool.splice(idx, 1)[0]);
      }
      if (picks.length < 3) {
        const pickedIds = new Set(picks.map(up => up.id));
        const backfillPool = pool.filter(up => !pickedIds.has(up.id));
        for (let i = picks.length; i < 3 && backfillPool.length; i++) {
          const idx = pickWeightedIndex(backfillPool, missStreak);
          picks.push(backfillPool.splice(idx, 1)[0]);
        }
      }
      // Deliberately does NOT touch upgradeMissStreak here - pity tracks
      // "eligible but not offered across independent level-ups", and a
      // reroll is a continuation of the same level-up event the pity
      // bookkeeping already accounted for when onLevelUp() first ran, not
      // a second independent one.
      this.renderUpgradeCards(picks, false);
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

      // Type roll (v1.36.62): replaced the old fixed-probability dice
      // (tank/fast/blitz/gunner each at their own hardcoded % once
      // difficulty-unlocked) with a uniform pick among whichever types
      // this wave's spawn pattern currently allows (see
      // Game.rollSpawnPattern) - the pattern itself is what now controls
      // both variety (how many distinct types can appear at once) and,
      // implicitly, relative frequency (fewer active types means each one
      // individually spawns more often).
      let type = forceType || this.currentSpawnPattern[randInt(0, this.currentSpawnPattern.length - 1)];

      // Ranged category cap (v1.36.80, generalized v1.36.81 - see
      // RANGED_MAX_ALIVE/RANGED_ENEMY_TYPES): this spawn attempt simply
      // produces nothing if the roll landed on a ranged type and the
      // combined ranged headcount's already at the cap - the spawn timer
      // that called this still ticks normally either way (spawnEnemy()
      // doesn't own that pacing), so this only ever suppresses ranged
      // spawns specifically, never slows down spawning overall. Exempt
      // forced spawns (forceType) for the same reason MAX_ALIVE_ENEMIES
      // exempts them below - not currently reachable for a ranged type in
      // practice, but kept consistent with that existing exemption's own
      // reasoning.
      if (!forceType && ENEMY_TYPES[type].ranged && this.enemies.filter(e => e.ranged).length >= RANGED_MAX_ALIVE) return;

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
      // until it was already too late to catch up. Since then, several
      // other awareness/survivability tools were added (the threat
      // vignette, weaken/intercept, move-speed and pickup-range
      // upgrades), so both were raised back up 1.5x (0.07->0.105,
      // 0.055->0.0825, v1.36.27) - still well short of the original
      // 0.14/0.11, but re-tightening the curve now that the player side
      // has more to work with. Eased back down 15% (0.105->0.08925,
      // 0.0825->0.070125, v1.36.40) after the overall pace crept up too far
      // again (impact effects, the frenzy rebalance, etc. all landed in the
      // same window). Their ratio to each other (dmg:hp) is kept the same
      // through every one of these adjustments, only the overall pace
      // changes.
      const tierHpMult = 1 + (D - 1) * 0.08925;
      const offenseExtra = Math.max(0, offensePowerMult(p) - 1);
      // Once spawn pacing is pinned at SPAWN_RATE_MAX, further crowd
      // investment can't buy a faster spawn rate anymore - it buys
      // tougher enemies instead (see SPAWN_OVERFLOW_HP_COEFF). Enemies
      // spawned during an active rush get a further flat RUSH_HP_MULT on
      // top, so the burst is a real spike in danger, not just more targets.
      // earlyGameHpMult (v1.36.73) softens only the D1-5 window on top of
      // all of that - see its own definition above for why.
      const hpMult = tierHpMult * earlyGameHpMult(D) * (1 + offenseExtra * 0.25) * (1 + this.spawnRateOverflow * SPAWN_OVERFLOW_HP_COEFF) * (this.rushState === 'active' ? RUSH_HP_MULT : 1);

      const tierDmgMult = 1 + (D - 1) * 0.070125;
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
      const spawnDist = enemyEngagementRadius();
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
        const enemy = new Enemy(type, x, y, hpMult, dmgMult);
        // spawnDist is chosen without any awareness of walls, so this spot
        // can land inside one (or a chunk generated later can place a wall
        // around an already-standing enemy - see generateChunkWalls' own
        // enemy check). Resolving immediately means a spawn that does land
        // in a wall gets shoved out to its edge before it's ever rendered,
        // instead of appearing to spawn embedded in it for a frame.
        this.resolveWallCollision(enemy);
        this.enemies.push(enemy);
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
      if (p.weapon && p.weapon.id === 'rapidfire') { this.fireRapidFire(); return; }

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
      const vulnerable = p.vulnerableLevel > 0;
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
        this.projectiles.push(new Projectile(p.x, p.y, vx, vy, shotDamage, p.pierce, 5, explosionRadius, chainHops, slowDuration, poisons, frenzies, bombifies, weakens, vulnerable));
      }
    }

    // Rapid Fire's attack (see WEAPONS): fires along p.moveDirAngle (the
    // player's current/last movement direction), nudged onto the nearest
    // enemy within a narrow forward strip if one exists there
    // (RAPIDFIRE_AUTOAIM_HALF_WIDTH) - not the wide free-range targeting
    // every other weapon has. Every barrel travels the identical
    // angle/speed; RAPIDFIRE_BARREL_GAP only spaces out each one's spawn
    // position PERPENDICULAR to that direction, so a higher rank forms a
    // wider side-by-side row ("-" -> "=" -> "≡") instead of stacking more
    // hits on one exact line.
    fireRapidFire() {
      const p = this.player;
      p.atkTimer = p.atkCooldown * RAPIDFIRE_COOLDOWN_MULT;

      const explosionRadius = p.explosionLevel > 0 ? explosionRadiusForLevel(p.explosionLevel) : 0;
      const chainHops = p.chainLevel;
      const slowDuration = p.slowLevel > 0 ? slowDurationForLevel(p.slowLevel) : 0;
      const poisons = p.poisonLevel > 0;
      const frenzies = p.frenzyLevel > 0;
      const bombifies = p.bombifyLevel > 0;
      const weakens = p.weakenLevel > 0;
      const vulnerable = p.vulnerableLevel > 0;
      const buffDamageMult = p.specialBuffTimer > 0 && p.special && p.special.buffDamageMult != null
        ? p.special.buffDamageMult : 1;
      const shotDamage = p.damage * buffDamageMult * RAPIDFIRE_DAMAGE_MULT;

      // Forward-strip auto-aim: prefer the nearest enemy that falls inside
      // the rectangle extending from the player out to weapon range, along
      // moveDirAngle, RAPIDFIRE_AUTOAIM_HALF_WIDTH wide on either side.
      // Fixed width regardless of distance (unlike a cone) so it still
      // catches enemies right next to the player. With nothing in the
      // strip, fire straight along moveDirAngle as before.
      const fwdX = Math.cos(p.moveDirAngle), fwdY = Math.sin(p.moveDirAngle);
      const latX = -fwdY, latY = fwdX;
      const rangeLen = weaponRange(p);
      let target = null, targetD2 = Infinity;
      for (const e of this.enemies) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const fwd = dx * fwdX + dy * fwdY;
        if (fwd < 0 || fwd > rangeLen) continue;
        const lat = dx * latX + dy * latY;
        if (Math.abs(lat) > RAPIDFIRE_AUTOAIM_HALF_WIDTH) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < targetD2) { target = e; targetD2 = d2; }
      }
      const ang = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.moveDirAngle;

      const speed = p.projSpeed * RAPIDFIRE_PROJ_SPEED_MULT;
      const vx = Math.cos(ang) * speed;
      const vy = Math.sin(ang) * speed;
      // Perpendicular to the firing direction (rotate by 90deg), used to
      // lay out barrels side by side rather than front-to-back.
      const perpX = -Math.sin(ang);
      const perpY = Math.cos(ang);
      const barrels = p.rapidfireBarrels;
      for (let i = 0; i < barrels; i++) {
        const offset = (i - (barrels - 1) / 2) * RAPIDFIRE_BARREL_GAP;
        const originX = p.x + perpX * offset;
        const originY = p.y + perpY * offset;
        this.projectiles.push(new Projectile(originX, originY, vx, vy, shotDamage, p.pierce, 5, explosionRadius, chainHops, slowDuration, poisons, frenzies, bombifies, weakens, vulnerable));
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
        vulnerable: p.vulnerableLevel > 0,
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
        if (this.segmentHitsWall(p.x, p.y, e.x, e.y)) continue;
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
    // capped at chargeBeamCount * CHARGE_TIME_PER_STAGE (v1.36.85 - rank
    // sets chargeBeamCount via WEAPONS' innate effect, which now doubles
    // as both "max simultaneous beams" and "how many discrete charge
    // stages a hold can climb through", see chargeStageForCharge).
    // atkCooldown (lowered by the atkspeed upgrade like any other weapon)
    // is read as a charge-rate multiplier against ATK_COOLDOWN_BASE rather
    // than as a per-shot cooldown, so investing in attack speed still pays
    // off for this weapon. Firing happens on the falling edge of "held"
    // (release), not on a timer - but only once stage 1
    // (CHARGE_TIME_PER_STAGE) has actually been reached; a release below
    // that threshold just resets chargeTime with no shot at all, the same
    // as any other release, closing the "rapid-tap = free rapid-fire"
    // loophole a zero-minimum would otherwise leave open.
    updateChargeBeam(dt) {
      const p = this.player;
      const holding = isMoveInputHeld();
      if (holding) {
        // Target lock (v1.36.78, generalized to a target SET in v1.36.83):
        // targeting is the nearest p.chargeBeamCount enemies anywhere in
        // range - what's rate-limited is how often that search is allowed
        // to re-run (and thus change who's locked on): only once every
        // CHARGE_TARGET_LOCK_INTERVAL seconds, or immediately if ANY
        // currently-locked target died/left play in the meantime. A
        // multi-second hold no longer re-aims at whatever's nearest every
        // single frame, so it can't flip to completely different enemies
        // the instant before release just because something briefly got
        // closer.
        p.chargeTargetLockTimer -= dt;
        const allStillAlive = p.chargeTargets.length > 0 && p.chargeTargets.every(t => this.enemies.includes(t));
        if (!allStillAlive || p.chargeTargetLockTimer <= 0) {
          const range2 = weaponRange(p) ** 2;
          const nearest = this.enemies
            .map(e => ({ e, d: dist2(e.x, e.y, p.x, p.y) }))
            .filter(o => o.d <= range2)
            .sort((a, b) => a.d - b.d)
            .slice(0, Math.max(1, p.chargeBeamCount))
            .map(o => o.e);
          p.chargeTargets = nearest;
          // Only start the lock once something was actually found - with
          // nothing in range yet, retry every frame instead of sitting out
          // a full second "locked onto nothing" once an enemy does wander
          // into range.
          if (nearest.length > 0) p.chargeTargetLockTimer = CHARGE_TARGET_LOCK_INTERVAL;
        }

        const chargeRate = ATK_COOLDOWN_BASE / p.atkCooldown;
        const chargeTimeMax = p.chargeBeamCount * CHARGE_TIME_PER_STAGE;
        p.chargeTime = Math.min(chargeTimeMax, p.chargeTime + dt * chargeRate);
      }
      if (p.chargeWasHeld && !holding) {
        if (p.chargeTime >= CHARGE_TIME_PER_STAGE) this.fireChargeBeam();
        else p.chargeTime = 0;
        // Fresh lock the next time a hold begins, regardless of whether
        // this release actually fired.
        p.chargeTargets = [];
        p.chargeTargetLockTimer = 0;
      }
      p.chargeWasHeld = holding;
    }

    // Fires the charge beam on release: one instant, infinite-pierce beam
    // per fired target - up to chargeStageForCharge(chargeTime, chargeBeamCount)
    // of the locked targets (Player.chargeTargets, see updateChargeBeam's
    // target-lock comment above), nearest-first (chargeTargets is already
    // sorted that way from the lock search), not re-searched here, so this
    // always fires at exactly what the lock (and the aim preview showing
    // it) said it would. A minimum-charge release only fires 1 beam (the
    // single nearest locked target); holding all the way to full charge
    // fires all chargeBeamCount of them (v1.36.85 - previously v1.36.83
    // always fired every locked target the instant the single minimum
    // threshold was reached). Each beam uses the same rotated-local-frame
    // box test as the wide weapon's sweep (fireWideSweep) but reaching out
    // to the normal long weaponRange() instead of a short melee range, in
    // its own target's direction. Width/damage are fixed (CHARGE_HALF_WIDTH/
    // CHARGE_DAMAGE_MULT) - what a longer hold and higher rank buy is more
    // simultaneous beams, not a wider/harder single one. chargeTime always
    // resets to 0 on release, even if no target was in range to actually
    // hit - committing to a release at the wrong moment genuinely wastes
    // the charge.
    fireChargeBeam() {
      const p = this.player;
      const stage = chargeStageForCharge(p.chargeTime, p.chargeBeamCount);
      p.chargeTime = 0;
      const targets = p.chargeTargets.slice(0, stage);
      if (targets.length === 0) return;

      const range = weaponRange(p);
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
        vulnerable: p.vulnerableLevel > 0,
      };

      let hitAny = false;
      for (const target of targets) {
        const aimAngle = Math.atan2(target.y - p.y, target.x - p.x);
        const cosA = Math.cos(-aimAngle), sinA = Math.sin(-aimAngle);
        let beamHitAny = false;
        for (const e of this.enemies) {
          const dx = e.x - p.x, dy = e.y - p.y;
          const localX = dx * cosA - dy * sinA;
          const localY = dx * sinA + dy * cosA;
          if (localX < -e.radius || localX > range + e.radius) continue;
          if (Math.abs(localY) > CHARGE_HALF_WIDTH + e.radius) continue;
          // No segmentHitsWall check here, deliberately - this is the one
          // "infinite pierce" weapon walls don't stop (see Wall/segmentHitsWall
          // above); every other attack (traveling projectiles, the wide sweep)
          // does check.
          beamHitAny = true;
          this.resolveProjectileHit(virtualProj, e);
        }
        if (beamHitAny) {
          hitAny = true;
          this.beamEffects.push(new BeamEffect(p.x, p.y, aimAngle, range, CHARGE_HALF_WIDTH, 1));
        }
      }
      if (!hitAny) return;
      this.shakeTime = Math.max(this.shakeTime, 0.1 + Math.min(1, targets.length / p.chargeBeamCount) * 0.2);
    }

    // Applies every status effect a projectile carries (slow/poison/
    // frenzy/bombify/weaken/vulnerable) to one target enemy. Shared between
    // the primary hit and each chain hop (see update()) so the two paths
    // can't silently drift apart as new status effects get added - chain
    // used to only forward slow (and, via a separate check, explosion),
    // leaving poison/frenzy/bombify/weaken/vulnerable unable to ever spread
    // through it.
    applyOnHitStatuses(proj, target) {
      const p = this.player;
      if (proj.slowDuration > 0) target.slowTimer = Math.max(target.slowTimer, proj.slowDuration);
      if (proj.poisons) {
        if (target.poisonTimer <= 0) { target.poisonTimer = POISON_DURATION; target.poisonStacks = 1; }
        else target.poisonStacks = Math.min(poisonMaxStacksForLevel(p.poisonLevel), target.poisonStacks + 1);
      }
      if (proj.frenzies) target.frenzyTimer = frenzyDurationForLevel(p.frenzyLevel); // no stacking (v1.36.87) - just (re)starts at the current rank's full duration
      if (proj.bombifies) target.bombifyTimer = BOMBIFY_DURATION; // no stacking - just (re)starts at full duration
      if (proj.weakens) target.weakenTimer = WEAKEN_DURATION; // no stacking - just (re)starts at full duration
      if (proj.vulnerable) target.vulnerableTimer = VULNERABLE_DURATION; // no stacking (v1.36.88) - just (re)starts at full duration
    }

    // Adds an impact-effect zone. At most one of a given type can exist at
    // once - if one is already active, this hit's zone is simply skipped
    // (v1.36.37: changed from replacing the existing zone) so the effect
    // reads as a placed trap staying put once set, not a beam that keeps
    // relocating to wherever was hit most recently.
    spawnImpactEffect(type, x, y, radius, life, dmgPerSec) {
      if (this.impactEffects.some(fx => fx.type === type)) return;
      this.impactEffects.push(new ImpactEffect(type, x, y, radius, life, dmgPerSec));
    }

    // Single choke point for every source of damage dealt TO an enemy
    // (direct hits, explosion splash, chain, poison DoT, killzone ticks,
    // bombify detonation splash, frenzy friendly-fire, Tank's reflect
    // passive) so vulnerable's rank-based multiplier (v1.36.87, split out
    // of frenzy; reworked to a flat rank lookup in v1.36.88 - see
    // vulnerableDmgMultForLevel) applies uniformly regardless of what's
    // dealing the damage, rather than needing a copy of the multiplier at
    // every call site. Reads the player's CURRENT vulnerableLevel at the
    // moment of the hit (same as weakenDmgMultForLevel does for weaken,
    // below) rather than a level baked in when the status was first
    // applied - a mid-fight rank-up immediately strengthens the multiplier
    // on every already-vulnerable enemy, not just future hits.
    damageEnemy(enemy, amount) {
      const mult = enemy.vulnerableTimer > 0 ? vulnerableDmgMultForLevel(this.player.vulnerableLevel) : 1;
      enemy.hp -= amount * mult;
    }

    // Applies a single hit's damage, on-hit statuses, explosion splash, and
    // chain propagation. Shared between a normal projectile's collision
    // (see update()) and the wide weapon's instant sweep (fireWideSweep),
    // which hits every enemy in its cone the same way but has no
    // travel/pierce lifecycle of its own. `proj` only needs to duck-type
    // the fields read here (damage/explosionRadius/chainHops/statuses) - it
    // doesn't have to be a real Projectile instance.
    resolveProjectileHit(proj, e) {
      this.damageEnemy(e, proj.damage);
      e.hitFlash = 0.12;
      this.applyOnHitStatuses(proj, e);

      // Impact effects (v1.36.35): spawned here, at the primary hit only -
      // deliberately NOT inside applyOnHitStatuses (shared with chain hops
      // above), so a chained hop never leaves its own zone behind.
      const p = this.player;
      if (p.magnetstormLevel > 0) this.spawnImpactEffect('magnetstorm', e.x, e.y, magnetStormRadiusForLevel(p.magnetstormLevel), MAGNETSTORM_DURATION);
      if (p.killzoneLevel > 0) this.spawnImpactEffect('killzone', e.x, e.y, killZoneRadiusForLevel(p.killzoneLevel), KILLZONE_DURATION, proj.damage * killZoneDmgPctForLevel(p.killzoneLevel));
      if (p.poisoncloudLevel > 0) this.spawnImpactEffect('poisoncloud', e.x, e.y, poisonCloudRadiusForLevel(p.poisoncloudLevel), POISONCLOUD_DURATION);

      if (proj.explosionRadius > 0 && Math.random() < EXPLOSION_TRIGGER_CHANCE) {
        for (const other of this.enemies) {
          if (other === e) continue;
          if (dist(other.x, other.y, e.x, e.y) <= proj.explosionRadius) {
            this.damageEnemy(other, proj.damage * EXPLOSION_DAMAGE_PCT);
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
          this.damageEnemy(nearest, proj.damage * CHAIN_DAMAGE_PCT);
          nearest.hitFlash = 0.12;
          this.applyOnHitStatuses(proj, nearest);
          this.chainZaps.push(new ChainZap(fromX, fromY, nearest.x, nearest.y));

          // Chain's role is spreading damage/status to more targets, not
          // diminishing whatever it spreads - so if explosion is also
          // equipped, each chained hit gets its own independent
          // EXPLOSION_TRIGGER_CHANCE roll to detonate too, using the
          // player's full attack power (proj.damage) rather than chain's
          // own reduced damage.
          if (proj.explosionRadius > 0 && Math.random() < EXPLOSION_TRIGGER_CHANCE) {
            for (const other of this.enemies) {
              if (other === nearest || chained.has(other)) continue;
              if (dist(other.x, other.y, nearest.x, nearest.y) <= proj.explosionRadius) {
                this.damageEnemy(other, proj.damage * EXPLOSION_DAMAGE_PCT);
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

    // Rolls walls for any chunk within WALL_GEN_RADIUS_CHUNKS of the
    // player's CURRENT chunk that hasn't been generated yet. Cheap even when
    // called every frame (see update()) - once the surrounding block is
    // generated, every check here is just a generatedChunks.has() lookup
    // that immediately no-ops, so the actual roll only ever runs once per
    // chunk for the entire run.
    generateNearbyChunks() {
      const p = this.player;
      const ccx = Math.floor(p.x / WALL_CHUNK_SIZE);
      const ccy = Math.floor(p.y / WALL_CHUNK_SIZE);
      for (let dx = -WALL_GEN_RADIUS_CHUNKS; dx <= WALL_GEN_RADIUS_CHUNKS; dx++) {
        for (let dy = -WALL_GEN_RADIUS_CHUNKS; dy <= WALL_GEN_RADIUS_CHUNKS; dy++) {
          const cx = ccx + dx, cy = ccy + dy;
          const key = cx + ',' + cy;
          if (this.generatedChunks.has(key)) continue;
          this.generatedChunks.add(key);
          this.generateChunkWalls(cx, cy, key);
        }
      }
    }

    // Rolls 0 walls (WALL_CHANCE_PER_CHUNK miss) or WALL_COUNT_MIN..MAX walls
    // for one chunk, each sized WALL_SIZE_MIN..MAX and placed fully inside
    // the chunk's own bounds (so a 3x3-chunk neighbor lookup, see
    // wallsNear(), always finds every wall that could plausibly overlap a
    // given point without needing to search further out). A roll that would
    // land on the player's current position, or on any enemy CURRENTLY
    // standing in this chunk, is simply dropped rather than relocated - see
    // WALL_PLAYER_CLEARANCE above. The enemy check matters because chunks
    // generate as the player explores (not all at once at game start) - an
    // enemy can already be standing somewhere before its chunk is ever
    // rolled, and without this check a wall could later spawn directly
    // through/around it, reading as "an enemy stuck inside a wall" even
    // though it was really the wall that arrived second.
    generateChunkWalls(cx, cy, key) {
      const list = [];
      if (Math.random() < WALL_CHANCE_PER_CHUNK) {
        const originX = cx * WALL_CHUNK_SIZE, originY = cy * WALL_CHUNK_SIZE;
        const count = randInt(WALL_COUNT_MIN, WALL_COUNT_MAX);
        const p = this.player;
        for (let i = 0; i < count; i++) {
          const w = rand(WALL_SIZE_MIN, WALL_SIZE_MAX);
          const h = rand(WALL_SIZE_MIN, WALL_SIZE_MAX);
          const x = originX + rand(0, WALL_CHUNK_SIZE - w);
          const y = originY + rand(0, WALL_CHUNK_SIZE - h);
          const closestPX = clamp(p.x, x, x + w);
          const closestPY = clamp(p.y, y, y + h);
          if (dist2(p.x, p.y, closestPX, closestPY) < WALL_PLAYER_CLEARANCE * WALL_PLAYER_CLEARANCE) continue;
          let blockedByEnemy = false;
          for (const e of this.enemies) {
            const closestEX = clamp(e.x, x, x + w);
            const closestEY = clamp(e.y, y, y + h);
            if (dist2(e.x, e.y, closestEX, closestEY) < e.radius * e.radius) { blockedByEnemy = true; break; }
          }
          if (blockedByEnemy) continue;
          // Also skip a roll that would overlap a wall already placed
          // earlier in this same chunk (WALL_COUNT_MAX can roll more than
          // one) - two overlapping rects otherwise combine into a shape an
          // entity's single-pass push-out (resolveWallCollision) isn't
          // guaranteed to fully escape from (pushed clear of one, straight
          // into the other).
          let overlapsOwnWall = false;
          for (const existing of list) {
            if (x < existing.x + existing.w && x + w > existing.x && y < existing.y + existing.h && y + h > existing.y) {
              overlapsOwnWall = true;
              break;
            }
          }
          if (overlapsOwnWall) continue;
          list.push(new Wall(x, y, w, h));
        }
      }
      this.wallChunks.set(key, list);
    }

    // Gathers every wall in the 3x3 block of chunks centered on (x,y) - since
    // every wall is generated fully inside its own chunk's bounds, this is
    // guaranteed to include every wall that could overlap anything within
    // WALL_CHUNK_SIZE of (x,y), which comfortably covers the small
    // circle/segment checks this is used for (collision radii and per-frame
    // travel distances are both far smaller than one chunk).
    wallsNear(x, y) {
      const ccx = Math.floor(x / WALL_CHUNK_SIZE);
      const ccy = Math.floor(y / WALL_CHUNK_SIZE);
      const result = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = this.wallChunks.get((ccx + dx) + ',' + (ccy + dy));
          if (arr) for (const w of arr) result.push(w);
        }
      }
      return result;
    }

    // Circle-vs-rectangles push-out: after an entity (player or enemy) has
    // already moved, shove it back out of any wall it ended up overlapping.
    // Handles the entity's center landing fully inside a wall (e.g. an enemy
    // spawned there before ever being repelled) by pushing out along
    // whichever axis has the smaller penetration depth, rather than dividing
    // by a zero distance.
    //
    // Runs WALL_COLLISION_PASSES times rather than once: two walls (even
    // from two different neighboring chunks, which never check each other
    // at generation time) can end up close enough to form a corner where
    // resolving one wall's overlap pushes the entity straight into the
    // other's. A single pass over the wall list can't self-correct that if
    // the other wall was already checked earlier in the same pass; a
    // handful of repeated passes converges on a position clear of both.
    resolveWallCollision(entity) {
      const r = entity.radius;
      for (let pass = 0; pass < WALL_COLLISION_PASSES; pass++) {
        for (const w of this.wallsNear(entity.x, entity.y)) {
          const closestX = clamp(entity.x, w.x, w.x + w.w);
          const closestY = clamp(entity.y, w.y, w.y + w.h);
          const dx = entity.x - closestX, dy = entity.y - closestY;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0) {
            if (d2 >= r * r) continue;
            const d = Math.sqrt(d2);
            const overlap = r - d;
            entity.x += (dx / d) * overlap;
            entity.y += (dy / d) * overlap;
          } else {
            // Center is inside the rect - push out toward whichever edge is
            // nearest instead (the closestX/closestY math above degenerates
            // to the entity's own position with zero distance in this case).
            // penX/penY (distance from center to the NEAREST same-axis edge)
            // decide which axis to escape along - but the actual new
            // position has to place the entity a full (halfW/halfH + r)
            // from the rect's center, not (penX/penY + r), or it only moves
            // to a different point still inside the rect (an earlier bug
            // here did exactly that, producing a 2-cycle that could land
            // back on the original position after an even number of passes).
            const halfW = w.w / 2, halfH = w.h / 2;
            const rectCx = w.x + halfW, rectCy = w.y + halfH;
            const ox = entity.x - rectCx, oy = entity.y - rectCy;
            const penX = halfW - Math.abs(ox), penY = halfH - Math.abs(oy);
            if (penX < penY) entity.x = rectCx + (ox < 0 ? -(halfW + r) : (halfW + r));
            else entity.y = rectCy + (oy < 0 ? -(halfH + r) : (halfH + r));
          }
        }
      }
    }

    // Does any wall lie on the straight segment between these two points?
    // Shared by: traveling-projectile wall collision (previous frame's
    // position -> this frame's), the wide sweep's per-enemy line-of-sight
    // check, and enemy movement's "can I walk straight at the player, or do
    // I need to detour" check. Deliberately NOT used by the charge beam -
    // that weapon's whole identity is genuinely infinite pierce, so it skips
    // this check entirely rather than stopping at the first wall in its path.
    segmentHitsWall(x1, y1, x2, y2) {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      const minCol = Math.floor(minX / WALL_CHUNK_SIZE), maxCol = Math.floor(maxX / WALL_CHUNK_SIZE);
      const minRow = Math.floor(minY / WALL_CHUNK_SIZE), maxRow = Math.floor(maxY / WALL_CHUNK_SIZE);
      for (let cx = minCol; cx <= maxCol; cx++) {
        for (let cy = minRow; cy <= maxRow; cy++) {
          const arr = this.wallChunks.get(cx + ',' + cy);
          if (!arr) continue;
          for (const w of arr) {
            if (segmentIntersectsRect(x1, y1, x2, y2, w.x, w.y, w.w, w.h)) return true;
          }
        }
      }
      return false;
    }

    // Builds a coarse walkable grid (FLOW_FIELD_CELL px per cell) centered
    // on the player, then floods outward from the player's cell with a
    // plain 4-directional BFS - since every step costs exactly 1, a FIFO
    // queue alone already guarantees each cell's recorded distance is its
    // true shortest number of steps (no Dijkstra/priority-queue needed, and
    // no diagonal-corner-cutting edge case to worry about either). Only
    // built lazily, the first time some enemy's straight line to the player
    // is actually blocked (see the enemy movement loop in update()) - most
    // chunks never have a wall at all, so most runs may never need this.
    // Cached for FLOW_FIELD_REFRESH_INTERVAL seconds so many blocked enemies
    // in the same frame (or the next several frames) share one build.
    buildFlowField() {
      const p = this.player;
      const cellSize = FLOW_FIELD_CELL;
      const halfSize = enemyEngagementRadius() + 400;
      const cols = Math.ceil((halfSize * 2) / cellSize);
      const rows = cols;
      const originCol = Math.floor((p.x - halfSize) / cellSize);
      const originRow = Math.floor((p.y - halfSize) / cellSize);

      const blocked = new Uint8Array(cols * rows);
      const minWorldX = originCol * cellSize, minWorldY = originRow * cellSize;
      const maxWorldX = minWorldX + cols * cellSize, maxWorldY = minWorldY + rows * cellSize;
      const minCol = Math.floor(minWorldX / WALL_CHUNK_SIZE), maxColChunk = Math.floor(maxWorldX / WALL_CHUNK_SIZE);
      const minRow = Math.floor(minWorldY / WALL_CHUNK_SIZE), maxRowChunk = Math.floor(maxWorldY / WALL_CHUNK_SIZE);
      for (let ccx = minCol; ccx <= maxColChunk; ccx++) {
        for (let ccy = minRow; ccy <= maxRowChunk; ccy++) {
          const arr = this.wallChunks.get(ccx + ',' + ccy);
          if (!arr) continue;
          for (const w of arr) {
            const c0 = Math.max(0, Math.floor((w.x - minWorldX) / cellSize));
            const c1 = Math.min(cols - 1, Math.floor((w.x + w.w - minWorldX) / cellSize));
            const r0 = Math.max(0, Math.floor((w.y - minWorldY) / cellSize));
            const r1 = Math.min(rows - 1, Math.floor((w.y + w.h - minWorldY) / cellSize));
            for (let cy = r0; cy <= r1; cy++) {
              for (let cx = c0; cx <= c1; cx++) blocked[cy * cols + cx] = 1;
            }
          }
        }
      }

      const dist = new Float64Array(cols * rows).fill(Infinity);
      let startCol = Math.floor(p.x / cellSize) - originCol;
      let startRow = Math.floor(p.y / cellSize) - originRow;
      startCol = clamp(startCol, 0, cols - 1);
      startRow = clamp(startRow, 0, rows - 1);
      const startIdx = startRow * cols + startCol;
      blocked[startIdx] = 0; // the player's own cell is always walkable
      dist[startIdx] = 0;
      const queue = [startIdx];
      let qHead = 0;
      while (qHead < queue.length) {
        const idx = queue[qHead++];
        const cx = idx % cols, cy = Math.floor(idx / cols);
        const d0 = dist[idx];
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [ddx, ddy] of neighbors) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nidx = ny * cols + nx;
          if (blocked[nidx] || dist[nidx] <= d0 + 1) continue;
          dist[nidx] = d0 + 1;
          queue.push(nidx);
        }
      }

      this.flowFieldCache = { originCol, originRow, cols, rows, cellSize, dist, computedAt: this.time };
    }

    // Returns the angle an enemy at (x,y) should move in to make progress
    // around obstacles toward the player, using the cached flow field
    // (rebuilding it first if it's missing or stale). Returns null if (x,y)
    // falls outside the field's coverage, or no neighboring cell has a
    // recorded (reachable) distance at all - callers should fall back to a
    // straight line at the player in that case.
    flowFieldDirectionAt(x, y) {
      if (!this.flowFieldCache || this.time - this.flowFieldCache.computedAt >= FLOW_FIELD_REFRESH_INTERVAL) {
        this.buildFlowField();
      }
      const ff = this.flowFieldCache;
      const col = Math.floor(x / ff.cellSize) - ff.originCol;
      const row = Math.floor(y / ff.cellSize) - ff.originRow;
      if (col < 0 || row < 0 || col >= ff.cols || row >= ff.rows) return null;
      // Deliberately NOT gated on this cell's own distance being finite: an
      // enemy resting right against a wall (exactly where resolveWallCollision
      // leaves it after a collision) very plausibly stands in a cell the
      // wall's rectangle partially overlaps, which the coarse per-cell
      // blocked check marks fully impassable even though the enemy's actual
      // circular position is fine. Bailing out on that would immediately
      // fall back to the straight-line-at-the-player direction every single
      // frame - straight back into the same wall - which is exactly the
      // "stuck in place at the wall" symptom this is fixing. Looking at the
      // neighbors' own recorded distances directly, regardless of what this
      // cell's own value says, sidesteps that entirely.
      let bestDist = Infinity, bestDx = 0, bestDy = 0, found = false;
      const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [ddx, ddy] of neighbors) {
        const nx = col + ddx, ny = row + ddy;
        if (nx < 0 || ny < 0 || nx >= ff.cols || ny >= ff.rows) continue;
        const nd = ff.dist[ny * ff.cols + nx];
        if (isFinite(nd) && nd < bestDist) { bestDist = nd; bestDx = ddx; bestDy = ddy; found = true; }
      }
      if (!found) return null;
      return Math.atan2(bestDy, bestDx);
    }

    // Gunner's movement (v1.36.60, see ENEMY_TYPES.gunner): approaches the
    // player exactly like a normal enemy (straight line, or the flow field
    // once a wall blocks that line) until within GUNNER_STOP_DIST_FRAC of
    // the engagement radius, then holds position entirely and fires
    // instead. Resumes approaching only once the player has drifted back
    // out past the (larger) GUNNER_RESUME_DIST_FRAC - seeing that gap is
    // what keeps it from flickering between the two right at one boundary.
    updateGunnerMovement(e, p, d, dt, effSpeed) {
      const stopDist = enemyEngagementRadius() * GUNNER_STOP_DIST_FRAC;
      const resumeDist = enemyEngagementRadius() * GUNNER_RESUME_DIST_FRAC;
      if (e.rangedHolding && d > resumeDist) e.rangedHolding = false;
      else if (!e.rangedHolding && d <= stopDist) e.rangedHolding = true;

      if (e.rangedHolding) {
        e.rangedCooldown -= dt;
        if (e.rangedCooldown <= 0) {
          e.rangedCooldown += GUNNER_ATK_INTERVAL;
          const ang = Math.atan2(p.y - e.y, p.x - e.x);
          this.enemyProjectiles.push(new EnemyProjectile(
            e.x, e.y, Math.cos(ang) * GUNNER_PROJ_SPEED, Math.sin(ang) * GUNNER_PROJ_SPEED,
            e.rangedAtkDamage, GUNNER_PROJ_RADIUS
          ));
        }
        return; // holds position - no movement while in range
      }

      let dirX = (p.x - e.x) / d, dirY = (p.y - e.y) / d;
      if (this.segmentHitsWall(e.x, e.y, p.x, p.y)) {
        const ang = this.flowFieldDirectionAt(e.x, e.y);
        if (ang != null) { dirX = Math.cos(ang); dirY = Math.sin(ang); }
      }
      e.x += dirX * effSpeed * dt;
      e.y += dirY * effSpeed * dt;
    }

    // Blitz's movement (v1.36.60, see ENEMY_TYPES.blitz): a 3-state machine.
    // 'approach' behaves exactly like a normal enemy until within
    // BLITZ_STOP_DIST_FRAC of the engagement radius, then transitions to
    // 'pause' (a stationary telegraph window). Once that expires, it locks
    // in the direction toward the player's position at that exact instant
    // (not a homing direction - it will not correct course mid-charge) and
    // enters 'charging': a fast straight-line dash with elevated contact
    // damage (via a temporarily boosted e.dmg, consumed by the existing
    // generic contact-damage check in update() unmodified) that continues
    // for a full screen-diameter's worth of distance regardless of whether
    // it actually connects with the player, then reverts to 'approach' and
    // repeats. A wall in the charge's path isn't dodged (charging skips the
    // wall-avoidance/flow-field logic entirely, unlike 'approach') - it
    // just runs into it like anything else, resolveWallCollision (called
    // unconditionally after this in update()) stops it there, and the
    // charge's own distance budget still winds down to 0 and ends the
    // charge on schedule even if it's stuck against that wall the whole time.
    updateBlitzMovement(e, p, d, dt, effSpeed) {
      if (e.blitzState === 'approach') {
        const stopDist = enemyEngagementRadius() * BLITZ_STOP_DIST_FRAC;
        if (d <= stopDist) {
          e.blitzState = 'pause';
          e.blitzTimer = BLITZ_PAUSE_DURATION;
          return;
        }
        let dirX = (p.x - e.x) / d, dirY = (p.y - e.y) / d;
        if (this.segmentHitsWall(e.x, e.y, p.x, p.y)) {
          const ang = this.flowFieldDirectionAt(e.x, e.y);
          if (ang != null) { dirX = Math.cos(ang); dirY = Math.sin(ang); }
        }
        e.x += dirX * effSpeed * dt;
        e.y += dirY * effSpeed * dt;
      } else if (e.blitzState === 'pause') {
        e.blitzTimer -= dt;
        if (e.blitzTimer <= 0) {
          const ang = Math.atan2(p.y - e.y, p.x - e.x);
          e.blitzDirX = Math.cos(ang);
          e.blitzDirY = Math.sin(ang);
          e.blitzChargeDistanceRemaining = enemyEngagementRadius() * 2;
          e.dmg = Math.round(e.baseDmg * BLITZ_CHARGE_DAMAGE_MULT);
          e.blitzState = 'charging';
        }
      } else { // 'charging'
        const chargeSpeed = effSpeed * BLITZ_CHARGE_SPEED_MULT;
        const step = chargeSpeed * dt;
        e.x += e.blitzDirX * step;
        e.y += e.blitzDirY * step;
        e.blitzChargeDistanceRemaining -= step;
        if (e.blitzChargeDistanceRemaining <= 0) {
          e.dmg = e.baseDmg;
          e.blitzState = 'approach';
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
        // this.wave was just incremented above, so this reads as "the wave
        // we're now entering" - RUSH_MIN_WAVE (v1.36.75) blocks a rush from
        // ever starting before then, on top of the existing cooldown/kill-
        // rate gates.
        if (this.rushState === 'idle' && this.rushWindowCooldown <= 0 && killRate > RUSH_KILL_RATE_THRESHOLD && this.wave >= RUSH_MIN_WAVE) {
          this.rushState = 'warning';
          this.rushTimer = RUSH_WARNING_DURATION;
          this.rushWindowCooldown = RUSH_WINDOW_COOLDOWN;
        }
        this.spawnedAtCheckpoint = this.totalSpawned;
        this.killsThisWave = 0;
        // Whatever's still alive right now carries into the new wave as
        // its starting backlog, read by this same block next checkpoint.
        this.aliveAtWaveStart = this.enemies.length;
        // Re-rolled after difficulty is finalized above, so the new
        // wave's pattern is drawn from whichever types are unlocked at
        // the difficulty this wave will actually run at (see v1.36.62).
        this.rollSpawnPattern();
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
        p.moveDirAngle = Math.atan2(my, mx);
      }
      this.resolveWallCollision(p);
      this.generateNearbyChunks();

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

      // Drones (v1.36.63 as a single "aux weapon", independently-owned per
      // type since v1.36.82): each type acts on whatever wanders inside the
      // tiny aura radius, regardless of whether any shot has actually hit
      // it, capped to the nearest N enemies (N = droneTargetCount(owned
      // count)) so a full swarm doesn't get affected for free - only the
      // immediate threats pressing right up against the player do. Unlike
      // the old single-slot aux weapon, all three types can be owned and
      // firing at once, each on its own independent cooldown - three
      // near-identical blocks rather than one shared block dispatching on
      // "which one is held", since there's no longer a single "which one"
      // to dispatch on.
      //
      // Originally applied every single frame (effectively an unbreakable
      // field, far stronger than intended) - now gated behind
      // DRONE_ATK_INTERVAL like a normal weapon's cooldown, so each type
      // only actually fires roughly once a second.
      //
      // Each type's cooldown is only consumed once a real target is found
      // (v1.36.66) - mirroring fireWeapon()'s own guard (p.atkTimer is left
      // untouched whenever `sorted.length === 0`, so a weapon with nothing
      // to shoot never burns its own cooldown). Without this, a ready-but-
      // empty aura (e.g. the main weapon kills the one enemy that had just
      // wandered into range, the instant before a drone's own cooldown
      // expires) would still consume the whole interval on a no-op, pushing
      // the next real proc a further DRONE_ATK_INTERVAL out - exactly why
      // the aura could feel noticeably slower than the intended ~1/sec in
      // practice.
      //
      // Range and cooldown are both per-player runtime values now
      // (v1.36.84, see droneRangeForRank/droneAtkIntervalForRank) rather
      // than the flat DRONE_RADIUS_BASE/DRONE_ATK_INTERVAL constants -
      // computed once here and shared by all three blocks below, since the
      // range/attack-speed upgrades apply identically to every drone type.
      const droneRange2 = droneRangeForRank(p.droneRangeRank) ** 2;
      const droneAtkInterval = droneAtkIntervalForRank(p.droneAtkSpeedRank);
      if (p.jammingDroneCount > 0) {
        p.jammingDroneCooldown -= dt;
        if (p.jammingDroneCooldown <= 0) {
          const nearby = this.enemies
            .filter(e => dist2(e.x, e.y, p.x, p.y) <= droneRange2)
            .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y));
          const targets = nearby.slice(0, droneTargetCount(p.jammingDroneCount));
          if (targets.length > 0) {
            p.jammingDroneCooldown += droneAtkInterval;
            for (const e of targets) {
              // Now a genuinely periodic "shot" (once per
              // DRONE_ATK_INTERVAL) rather than a per-frame refresh, so it
              // flashes every time it actually fires on a target instead of
              // only on the first newly-caught transition.
              this.chainZaps.push(new ChainZap(p.x, p.y, e.x, e.y, JAMMING_DRONE_ZAP_COLOR));
              // Multi-status pivot (v1.36.91): applies every debuff the
              // player currently owns, not just slow - guaranteed to be at
              // least one since the drone itself is gated on owning
              // slow/vulnerable/weaken (see `available` on the DRONES
              // entry above).
              if (p.slowLevel > 0) e.slowTimer = Math.max(e.slowTimer, slowDurationForLevel(p.slowLevel));
              if (p.weakenLevel > 0) e.weakenTimer = WEAKEN_DURATION;
              if (p.vulnerableLevel > 0) e.vulnerableTimer = VULNERABLE_DURATION;
            }
          }
        }
      }
      if (p.impactDroneCount > 0) {
        p.impactDroneCooldown -= dt;
        if (p.impactDroneCooldown <= 0) {
          const nearby = this.enemies
            .filter(e => dist2(e.x, e.y, p.x, p.y) <= droneRange2)
            .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y));
          const targets = nearby.slice(0, droneTargetCount(p.impactDroneCount));
          if (targets.length > 0) {
            p.impactDroneCooldown += droneAtkInterval;
            // A discrete knockback per shot, not a continuous force - see
            // DRONE_ATK_INTERVAL/IMPACT_DRONE_PUSH_DISTANCE above.
            for (const e of targets) {
              const d = dist(e.x, e.y, p.x, p.y) || 1;
              e.x += (e.x - p.x) / d * IMPACT_DRONE_PUSH_DISTANCE;
              e.y += (e.y - p.y) / d * IMPACT_DRONE_PUSH_DISTANCE;
              // Without this, the impact drone could push an enemy straight
              // into (or through) a wall - see the same fix already
              // applied to magnetstorm's pull (v1.36.53) for the identical
              // reasoning.
              this.resolveWallCollision(e);
              this.chainZaps.push(new ChainZap(p.x, p.y, e.x, e.y, IMPACT_DRONE_ZAP_COLOR));
            }
          }
        }
      }
      if (p.attackDroneCount > 0) {
        p.attackDroneCooldown -= dt;
        if (p.attackDroneCooldown <= 0) {
          const nearby = this.enemies
            .filter(e => dist2(e.x, e.y, p.x, p.y) <= droneRange2)
            .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y));
          const targets = nearby.slice(0, droneTargetCount(p.attackDroneCount));
          if (targets.length > 0) {
            p.attackDroneCooldown += droneAtkInterval;
            // Direct damage instead of a status effect/knockback - same
            // formula as the old tank passive's reflect hit
            // (REFLECT_DMG_PCT_OF_ATTACK/OF_MAXHP), just fired proactively
            // on this drone's own interval instead of reactively on taking
            // damage. Routed through damageEnemy() like every other damage
            // source (§6-2's difficulty-scaling multiplier, etc.) rather
            // than decrementing hp directly.
            const dmg = Math.round(p.damage * REFLECT_DMG_PCT_OF_ATTACK + p.maxHp * REFLECT_DMG_PCT_OF_MAXHP);
            for (const e of targets) {
              this.damageEnemy(e, dmg);
              e.hitFlash = 0.12;
              this.chainZaps.push(new ChainZap(p.x, p.y, e.x, e.y, ATTACK_DRONE_ZAP_COLOR));
              // Explosion synergy (v1.36.86): the only bullet effect the
              // attack drone ever triggers, added specifically so the
              // drone has a real answer to high-difficulty HP bloat beyond
              // its own flat per-hit damage - deliberately not extended to
              // any other bullet effect (chain/poison/etc.), matching the
              // request's intent ("simple firepower helper" out of the box,
              // "genuinely offensive tool" once explosion is invested in).
              // Uses the exact same trigger chance/splash-damage-percent/
              // radius/particle look as a real projectile's explosion
              // (resolveProjectileHit above), just rolled here directly
              // since the drone's hit never goes through that method (it
              // deliberately skips every other bullet effect).
              if (p.explosionLevel > 0 && Math.random() < EXPLOSION_TRIGGER_CHANCE) {
                const explosionRadius = explosionRadiusForLevel(p.explosionLevel);
                for (const other of this.enemies) {
                  if (other === e) continue;
                  if (dist(other.x, other.y, e.x, e.y) <= explosionRadius) {
                    this.damageEnemy(other, dmg * EXPLOSION_DAMAGE_PCT);
                    other.hitFlash = 0.12;
                    for (let i = 0; i < 8; i++) this.particles.push(new Particle(e.x, e.y, '#ff4500', 2.5));
                  }
                }
              }
            }
          }
        }
      }

      // enemies
      const rushSpeedMult = this.rushState === 'active' ? RUSH_SPEED_MULT : 1;
      // A special's timed buff can include a temporary damage-taken cut
      // (e.g. tank's recovery dash) - declared on the special itself
      // (buffDamageTakenMult) rather than hardcoded here, same pattern as
      // speed()'s buffSpeedMult above. Computed once per frame (player-wide,
      // not per-enemy) and folded into effDmg below so both the actual
      // takeDamage() call and the threat-vignette's one-shot check agree on
      // the same effective incoming damage.
      const buffDamageTakenMult = p.specialBuffTimer > 0 && p.special && p.special.buffDamageTakenMult != null
        ? p.special.buffDamageTakenMult : 1;
      let threatNearby = false;
      for (const e of this.enemies) {
        const d = dist(e.x, e.y, p.x, p.y) || 1;
        const effSpeed = (e.slowTimer > 0 ? e.speed * SLOW_MULT : e.speed) * rushSpeedMult;
        // Gunner/blitz (v1.36.60) each have their own movement state machine
        // (hold-and-fire / approach-pause-charge) - everything else still
        // gets the plain straight-line-or-flow-field-with-wander movement
        // below. Either way, resolveWallCollision and all the per-frame
        // status-effect ticking/contact-damage logic further down apply
        // uniformly regardless of which branch moved this enemy.
        if (e.ranged) {
          this.updateGunnerMovement(e, p, d, dt, effSpeed);
        } else if (e.charger) {
          this.updateBlitzMovement(e, p, d, dt, effSpeed);
        } else {
          // A clear straight line to the player is by far the common case
          // (most chunks have no wall at all), so that stays the default -
          // the flow field only gets consulted for the enemies actually
          // blocked by one, and falls back to the straight line too if the
          // enemy is outside the field's coverage or the field can't find a
          // way through.
          let dirX = (p.x - e.x) / d, dirY = (p.y - e.y) / d;
          if (this.segmentHitsWall(e.x, e.y, p.x, p.y)) {
            const ang = this.flowFieldDirectionAt(e.x, e.y);
            if (ang != null) { dirX = Math.cos(ang); dirY = Math.sin(ang); }
          }
          if (e.wanders) {
            const wobble = ENEMY_WANDER_AMPLITUDE * Math.sin(this.time * e.wanderFreq + e.wanderPhase);
            const baseAngle = Math.atan2(dirY, dirX) + wobble;
            dirX = Math.cos(baseAngle); dirY = Math.sin(baseAngle);
          }
          e.x += dirX * effSpeed * dt;
          e.y += dirY * effSpeed * dt;
        }
        this.resolveWallCollision(e);
        if (e.hitFlash > 0) e.hitFlash -= dt;
        if (e.contactCd > 0) e.contactCd -= dt;
        if (e.slowTimer > 0) e.slowTimer -= dt;
        if (e.poisonTimer > 0) {
          // Tick damage is a percent of the enemy's OWN maxHp at a flat
          // rate (POISON_DMG_PCT) per stack - rank only affects how many
          // stacks can pile up (see poisonMaxStacksForLevel, applied where
          // stacks are added on hit), not this per-tick rate itself.
          this.damageEnemy(e, e.maxHp * POISON_DMG_PCT * e.poisonStacks * dt);
          e.poisonTimer -= dt;
          if (e.poisonTimer <= 0) e.poisonStacks = 0;
        }
        if (e.frenzyTimer > 0) e.frenzyTimer -= dt;
        if (e.bombifyTimer > 0) e.bombifyTimer -= dt; // no effect while alive - see the detonation-resolution block below
        if (e.weakenTimer > 0) e.weakenTimer -= dt;
        if (e.vulnerableTimer > 0) e.vulnerableTimer -= dt;

        // Weakened enemies hit softer (frenzy no longer touches dealt
        // damage at all as of v1.36.87 - it's purely the friendly-fire
        // behavior below now). Slow itself doesn't touch damage either
        // (that's weaken's job, split apart in v1.36.8). Computed once
        // here so both the contact-damage check and the threat-vignette
        // check below agree on the same effective damage value.
        const weakenDmgMult = e.weakenTimer > 0 ? weakenDmgMultForLevel(p.weakenLevel) : 1;
        const effDmg = e.dmg * weakenDmgMult * buffDamageTakenMult;

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

      // Frenzy friendly fire: a frenzied enemy also deals its contact
      // damage to whichever OTHER enemy it physically touches, not just
      // the player - this is 狂乱's entire design as of v1.36.87 (no more
      // attached damage buff/debuff, see the frenzy comment above). Shares
      // contactCd with the player-contact check above, so a frenzied enemy
      // can only land one hit (on the player or a neighbor, whichever it
      // touches) per cooldown window. Only iterates frenzied enemies as the
      // outer loop (cheap - normally a small subset of the swarm) rather
      // than checking every pair. The victim (`other`) goes through
      // damageEnemy() below, so if it's vulnerable (脆弱, a separate bullet
      // effect as of v1.36.87), its own stacks make it take extra damage
      // from this hit too.
      for (const e of this.enemies) {
        if (e.frenzyTimer <= 0 || e.contactCd > 0) continue;
        const weakenDmgMult = e.weakenTimer > 0 ? weakenDmgMultForLevel(p.weakenLevel) : 1;
        for (const other of this.enemies) {
          if (other === e) continue;
          const rr = e.radius + other.radius;
          if (dist2(e.x, e.y, other.x, other.y) < rr * rr) {
            this.damageEnemy(other, e.dmg * weakenDmgMult);
            other.hitFlash = 0.12;
            e.contactCd = 0.5;
            break;
          }
        }
      }

      // projectiles - every entry in this.projectiles is a real traveling
      // shot (standard/rapid fire; wide/charge never add one), so all of
      // them are stopped by walls uniformly, no per-weapon exception needed
      // here (that exception is charge beam's, and it isn't a Projectile).
      for (const proj of this.projectiles) {
        const prevX = proj.x, prevY = proj.y;
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        proj.life -= dt;
        if (proj.life > 0 && this.segmentHitsWall(prevX, prevY, proj.x, proj.y)) proj.life = 0;
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

      // enemy-fired projectiles (gunner) - same wall-collision treatment as
      // the player's own shots (segmentHitsWall, destroyed on hit), but
      // only ever needs to check collision against the single player, no
      // pierce/hitSet lifecycle.
      for (const eproj of this.enemyProjectiles) {
        const prevX = eproj.x, prevY = eproj.y;
        eproj.x += eproj.vx * dt;
        eproj.y += eproj.vy * dt;
        eproj.life -= dt;
        if (eproj.life > 0 && this.segmentHitsWall(prevX, prevY, eproj.x, eproj.y)) eproj.life = 0;
      }
      for (const eproj of this.enemyProjectiles) {
        if (eproj.life <= 0) continue;
        if (dist2(eproj.x, eproj.y, p.x, p.y) < (eproj.radius + p.radius) * (eproj.radius + p.radius)) {
          p.takeDamage(eproj.damage);
          eproj.life = 0;
        }
      }

      // Bombify detonation: any bombified enemy that ends this frame at
      // hp<=0 (from a projectile, poison, frenzy friendly fire, or an
      // earlier detonation this same frame) explodes for damage (the
      // player's own DPS - see bombifyDamage) to every other enemy within
      // BOMBIFY_RADIUS. Resolved in a loop rather than a single pass so a
      // detonation that drops another bombified enemy to 0 chains into
      // that enemy's own detonation too, regardless of array order - it
      // keeps re-scanning until nothing new qualifies. `detonated` guards
      // against processing the same enemy twice as the outer loop re-scans.
      const detonated = new Set();
      let moreToDetonate = true;
      while (moreToDetonate) {
        moreToDetonate = false;
        for (const e of this.enemies) {
          if (e.hp > 0 || e.bombifyTimer <= 0 || detonated.has(e)) continue;
          detonated.add(e);
          const bombDmg = bombifyDamage(p);
          for (const other of this.enemies) {
            if (other === e) continue;
            if (dist2(other.x, other.y, e.x, e.y) <= BOMBIFY_RADIUS * BOMBIFY_RADIUS) {
              this.damageEnemy(other, bombDmg);
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
      this.enemyProjectiles = this.enemyProjectiles.filter(pr => pr.life > 0);

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

      // heart pickups: rare spawn roll + direct-touch collection (no
      // magnetism, no lifespan - unlike gems, a heart just waits until the
      // player actually reaches it or the run ends).
      this.heartSpawnTimer -= dt;
      if (this.heartSpawnTimer <= 0) {
        this.heartSpawnTimer += HEART_SPAWN_CHECK_INTERVAL;
        if (this.hearts.length < HEART_MAX_COUNT && Math.random() < HEART_SPAWN_CHANCE) {
          const angle = rand(0, TAU);
          const spawnDist = rand(HEART_SPAWN_MIN_DIST, HEART_SPAWN_MAX_DIST);
          const heart = new Heart(p.x + Math.cos(angle) * spawnDist, p.y + Math.sin(angle) * spawnDist);
          // Unlike enemies, a heart never moves again after spawning (no
          // per-frame movement loop of its own) - if one landed inside a
          // wall it would stay embedded there permanently, and deep enough
          // in it could even become unreachable (the player can't walk
          // through the wall to touch it). Resolving once right at spawn
          // avoids that outright, reusing the exact same push-out already
          // used for enemies.
          this.resolveWallCollision(heart);
          this.hearts.push(heart);
        }
      }
      this.hearts = this.hearts.filter(h => {
        if (dist(h.x, h.y, p.x, p.y) < p.radius + h.radius) {
          p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.heartHealFrac);
          for (let i = 0; i < 8; i++) this.particles.push(new Particle(h.x, h.y, '#ff4d6d', 2.5));
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

      // wide weapon sweep flashes
      for (const sw of this.sweepEffects) sw.life -= dt;
      this.sweepEffects = this.sweepEffects.filter(sw => sw.life > 0);

      // charge beam flashes
      for (const b of this.beamEffects) b.life -= dt;
      this.beamEffects = this.beamEffects.filter(b => b.life > 0);

      // impact effects: per-type behavior while alive, then drop expired
      // ones. magnetstorm's pull is continuous (every frame, whoever's
      // currently inside). killzone/poisoncloud instead
      // share a periodic-tick model: an enemy that stays inside gets
      // hit again every IMPACT_EFFECT_TICK_INTERVAL seconds, not just once
      // on entry - fx.tickTimers tracks each affected enemy's own countdown
      // to its next tick, independently of when other enemies entered.
      // Leaving the zone drops that enemy's entry entirely, so re-entering
      // later starts a fresh countdown rather than resuming a stale one.
      for (const fx of this.impactEffects) {
        fx.life -= dt;
        if (fx.life <= 0) continue;
        if (fx.type === 'magnetstorm') {
          for (const e of this.enemies) {
            const d = dist(e.x, e.y, fx.x, fx.y) || 1;
            if (d > fx.radius) continue;
            const pull = Math.min(MAGNETSTORM_PULL_SPEED * dt, d); // clamp so it can't overshoot past center
            e.x += (fx.x - e.x) / d * pull;
            e.y += (fx.y - e.y) / d * pull;
            // Without this, a wall sitting between an enemy and the zone
            // center left the enemy settling into a stable, slightly-
            // embedded position against the wall's face every frame - this
            // pull runs after the main enemy movement loop's own
            // resolveWallCollision (see above), so it's the last thing to
            // move this enemy's position before it's ever rendered.
            this.resolveWallCollision(e);
          }
        } else {
          const inside = new Set();
          for (const e of this.enemies) {
            if (dist2(e.x, e.y, fx.x, fx.y) > fx.radius * fx.radius) continue;
            inside.add(e);
            let t = fx.tickTimers.has(e) ? fx.tickTimers.get(e) - dt : IMPACT_EFFECT_TICK_INTERVAL - dt;
            if (t <= 0) {
              t += IMPACT_EFFECT_TICK_INTERVAL;
              if (fx.type === 'killzone') {
                this.damageEnemy(e, fx.dmgPerSec * IMPACT_EFFECT_TICK_INTERVAL);
              } else if (fx.type === 'poisoncloud') {
                if (e.poisonTimer <= 0) { e.poisonTimer = POISON_DURATION; e.poisonStacks = 1; }
                else e.poisonStacks = Math.min(poisonMaxStacksForLevel(p.poisonLevel), e.poisonStacks + 1);
              }
            }
            fx.tickTimers.set(e, t);
          }
          for (const e of fx.tickTimers.keys()) {
            if (!inside.has(e)) fx.tickTimers.delete(e);
          }
        }
      }
      this.impactEffects = this.impactEffects.filter(fx => fx.life > 0);

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

      this.updateHeartCompass();
    }

    // Points a single needle toward the nearest heart, but only while it's
    // actually off-screen - once a heart is visible on screen the player
    // can just look at it directly, so the compass would be redundant (and
    // distracting) noise at that point.
    updateHeartCompass() {
      const p = this.player;
      if (this.hearts.length === 0) {
        heartCompassEl.classList.add('hidden');
        return;
      }
      let nearest = null;
      let nearestDist = Infinity;
      for (const h of this.hearts) {
        const d = dist(h.x, h.y, p.x, p.y);
        if (d < nearestDist) { nearestDist = d; nearest = h; }
      }
      const scale = viewScale(p);
      const dx = nearest.x - p.x;
      const dy = nearest.y - p.y;
      const screenX = W / 2 + dx * scale;
      const screenY = H / 2 + dy * scale;
      const onScreen = screenX >= -nearest.radius && screenX <= W + nearest.radius
        && screenY >= -nearest.radius && screenY <= H + nearest.radius;
      if (onScreen) {
        heartCompassEl.classList.add('hidden');
        return;
      }
      heartCompassEl.classList.remove('hidden');
      // atan2(dx, -dy) rather than the usual atan2(dy, dx): 0 degrees
      // should mean "straight up" (the needle glyph's own resting
      // orientation), and CSS rotate() is clockwise-positive, so this maps
      // right->90deg, down->180deg, left->270deg as expected.
      const angleDeg = Math.atan2(dx, -dy) * 180 / Math.PI;
      heartCompassNeedleEl.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
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

      // walls (v1.36.50) - drawn right after the grid, before anything that
      // moves, so they read as part of the terrain. Only walls in chunks
      // overlapping the current viewport are gathered (reusing the
      // left/right/top/bottom bounds computed above for the grid sweep),
      // rather than iterating every wall generated so far this run.
      ctx.save();
      ctx.fillStyle = '#4a4a5a';
      ctx.strokeStyle = '#6a6a7a';
      ctx.lineWidth = 2 / scale;
      const wMinCol = Math.floor(left / WALL_CHUNK_SIZE), wMaxCol = Math.floor(right / WALL_CHUNK_SIZE);
      const wMinRow = Math.floor(top / WALL_CHUNK_SIZE), wMaxRow = Math.floor(bottom / WALL_CHUNK_SIZE);
      for (let ccx = wMinCol; ccx <= wMaxCol; ccx++) {
        for (let ccy = wMinRow; ccy <= wMaxRow; ccy++) {
          const arr = this.wallChunks.get(ccx + ',' + ccy);
          if (!arr) continue;
          for (const wall of arr) {
            ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
            ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
          }
        }
      }
      ctx.restore();

      // impact effect zones - drawn as a ground-level circle matching the
      // effect's actual radius exactly (per spec), so what's on screen is
      // never misleading about what's actually inside it. A soft fill plus
      // a brighter ring, fading out only in the last IMPACT_EFFECT_FADE_OUT
      // seconds so a long-lived zone (poison cloud/frenzy fountain, 10s)
      // doesn't spend most of its life looking half-gone under a naive
      // life/maxLife fade.
      for (const fx of this.impactEffects) {
        const alpha = clamp(fx.life / IMPACT_EFFECT_FADE_OUT, 0, 1);
        const color = IMPACT_EFFECT_COLORS[fx.type];
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.radius, 0, TAU);
        ctx.globalAlpha = alpha * 0.15;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // gems
      for (const g of this.gems) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#7fffd4';
        ctx.fillRect(-g.radius, -g.radius, g.radius * 2, g.radius * 2);
        ctx.restore();
      }

      // hearts - two overlapping circle "lobes" plus a triangle point,
      // filled as one path (simple approximation of a heart silhouette
      // that fits this game's plain-shape art style).
      for (const h of this.hearts) {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.fillStyle = '#ff4d6d';
        const s = h.radius * 0.6;
        ctx.beginPath();
        ctx.arc(-s * 0.5, -s * 0.3, s * 0.5, 0, TAU);
        ctx.arc(s * 0.5, -s * 0.3, s * 0.5, 0, TAU);
        ctx.moveTo(-s, -s * 0.1);
        ctx.lineTo(0, s * 0.9);
        ctx.lineTo(s, -s * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // enemies
      for (const e of this.enemies) {
        ctx.beginPath();
        ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
        ctx.arc(e.x, e.y, e.radius, 0, TAU);
        ctx.fill();

        // Status-effect dots, drawn in a row above the enemy instead of
        // recoloring its body (see STATUS_DOT_COLORS) - only 'slow' existed
        // at first, but the list naturally grows as more statuses are added.
        const activeStatusDots = [];
        if (e.slowTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.slow);
        // Poison stacks: one dot per stack, so the stack count reads at a
        // glance rather than needing a number readout.
        for (let i = 0; i < e.poisonStacks; i++) activeStatusDots.push(STATUS_DOT_COLORS.poison);
        // Frenzy no longer stacks (v1.36.87), and vulnerable never did
        // (v1.36.88 reworked it to mirror weaken) - just a single dot each,
        // like bombify/weaken below.
        if (e.frenzyTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.frenzy);
        if (e.bombifyTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.bombify);
        if (e.weakenTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.weaken);
        if (e.vulnerableTimer > 0) activeStatusDots.push(STATUS_DOT_COLORS.vulnerable);
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
        ctx.strokeStyle = zap.color;
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

      // enemy-fired projectiles (gunner) - reuses the gunner's own body
      // color directly (rather than a second hardcoded copy of it) so an
      // incoming shot always reads as coming from that enemy type and the
      // two can never silently drift apart if the color changes again.
      for (const eproj of this.enemyProjectiles) {
        ctx.beginPath();
        ctx.fillStyle = ENEMY_TYPES.gunner.color;
        ctx.arc(eproj.x, eproj.y, eproj.radius, 0, TAU);
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

      // Drone slot dots (v1.36.82, changed to show the full slot pool in
      // v1.36.84): one dot per available drone SLOT (droneSlotCap(p.droneSlotRank),
      // not just per owned drone) in a row above the player, shown from
      // the very start of a run so the player can see at a glance how many
      // drones they can hold in total. Filled slots are colored per type
      // (DRONES' own `color`, the same one used for that drone's ChainZap
      // flash, iterated in DRONES' own order so which color fills first is
      // stable); any remaining unfilled slots are shown as neutral gray
      // dots (DRONE_SLOT_EMPTY_COLOR) rather than simply not being drawn -
      // same "one dot per stack" convention as the enemy status-effect
      // dots above (STATUS_DOT_COLORS), so both owned drones AND
      // remaining capacity read at a glance without opening the pause
      // screen.
      const slotCap = droneSlotCap(p.droneSlotRank);
      const droneDots = [];
      for (const drone of DRONES) {
        const count = drone.getLevel(p);
        for (let i = 0; i < count; i++) droneDots.push(drone.color);
      }
      while (droneDots.length < slotCap) droneDots.push(DRONE_SLOT_EMPTY_COLOR);
      {
        const dotRadius = 3;
        const dotSpacing = 9;
        const dotY = p.y - p.radius - 8;
        const rowStartX = p.x - (droneDots.length - 1) * dotSpacing / 2;
        for (let i = 0; i < droneDots.length; i++) {
          ctx.beginPath();
          ctx.fillStyle = droneDots[i];
          ctx.arc(rowStartX + i * dotSpacing, dotY, dotRadius, 0, TAU);
          ctx.fill();
        }
      }

      // charge beam charging indicator - a ring around the player that
      // grows and brightens with p.chargeTime, so the player has live
      // feedback on how much they'd lose by releasing right now. Dim gray
      // below stage 1 (CHARGE_TIME_PER_STAGE - releasing now would fire
      // nothing), switching to the normal cyan progression once a release
      // would actually land at least one beam. The ring itself still grows
      // smoothly (continuous chargeFrac) as ambient "how close to the next
      // stage" feedback, even though the beam COUNT a release would
      // actually produce only changes in the discrete per-stage steps the
      // aim preview below shows.
      if (p.weapon && p.weapon.id === 'charge' && p.chargeTime > 0) {
        const chargeTimeMax = p.chargeBeamCount * CHARGE_TIME_PER_STAGE;
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

        // Aim preview: one dashed rectangle per target a release would
        // actually fire at right now - the current stage's slice of
        // Player.chargeTargets (chargeStageForCharge, nearest-first, same
        // slice fireChargeBeam itself takes), each the exact fixed hitbox
        // (direction + CHARGE_HALF_WIDTH). Reads the same locked
        // references fireChargeBeam itself fires at, so the preview is
        // never out of sync with where/how many a real release would
        // produce - both because the lock only actually changes once
        // every CHARGE_TARGET_LOCK_INTERVAL seconds, and because the
        // number of rectangles shown grows in step with the stage ring
        // above. Solves "which directions (and how many) will it fire"
        // being otherwise invisible until the shot has already committed.
        const range = weaponRange(p);
        const stage = chargeStageForCharge(p.chargeTime, p.chargeBeamCount);
        for (const target of p.chargeTargets.slice(0, stage)) {
          const aimAngle = Math.atan2(target.y - p.y, target.x - p.x);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(aimAngle);
          ctx.globalAlpha = canFire ? 0.5 : 0.3;
          ctx.strokeStyle = canFire ? '#8ef0ff' : '#888888';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(0, -CHARGE_HALF_WIDTH);
          ctx.lineTo(range, -CHARGE_HALF_WIDTH);
          ctx.lineTo(range, CHARGE_HALF_WIDTH);
          ctx.lineTo(0, CHARGE_HALF_WIDTH);
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
    if (p.explosionLevel > 0) bulletLines.push(`爆発 ランク${p.explosionLevel}`);
    if (p.chainLevel > 0) bulletLines.push(`連鎖 ランク${p.chainLevel}`);
    if (p.slowLevel > 0) bulletLines.push(`低速 ランク${p.slowLevel}`);
    if (p.pierce > 0) bulletLines.push(`貫通 ランク${p.pierce}`);
    if (p.poisonLevel > 0) bulletLines.push(`猛毒 ランク${p.poisonLevel}`);
    if (p.frenzyLevel > 0) bulletLines.push(`狂乱 ランク${p.frenzyLevel}`);
    if (p.bombifyLevel > 0) bulletLines.push(`爆弾化 ランク${p.bombifyLevel}`);
    if (p.weakenLevel > 0) bulletLines.push(`衰弱 ランク${p.weakenLevel}`);
    if (p.vulnerableLevel > 0) bulletLines.push(`脆弱 ランク${p.vulnerableLevel}`);
    if (p.magnetstormLevel > 0) bulletLines.push(`磁気嵐 ランク${p.magnetstormLevel}`);
    if (p.killzoneLevel > 0) bulletLines.push(`キルゾーン ランク${p.killzoneLevel}`);
    if (p.poisoncloudLevel > 0) bulletLines.push(`ポイズンクラウド ランク${p.poisoncloudLevel}`);
    const droneLines = DRONES.filter(d => d.getLevel(p) > 0).map(d => `${d.name} x${d.getLevel(p)}`);
    pauseStatsEl.innerHTML = `
      <p>HP: ${Math.ceil(p.hp)} / ${p.maxHp}</p>
      <p>レベル: ${p.level}</p>
      <p>ダメージ: ${p.damage} / 攻撃間隔: ${p.atkCooldown.toFixed(2)}秒</p>
      <p>同時発射数: ${p.projCount} / 射程: ${Math.round(p.rangeMult * 100)}%</p>
      <p>移動速度: ${Math.round(p.speed)}</p>
      <p>HP自然回復: ${p.regen}/秒 / 回収範囲: ${Math.round(p.pickupRadius)}</p>
      ${droneLines.length ? `<p>ドローン: ${droneLines.join(' / ')}</p>` : ''}
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
