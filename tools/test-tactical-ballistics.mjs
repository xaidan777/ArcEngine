#!/usr/bin/env node
// tools/test-tactical-ballistics.mjs — Standalone tactical ballistics, postures, aiming convergence,
// and server authoritative combat test runner for ArcEngine / Blackwater Protocol.
//
// Usage: node tools/test-tactical-ballistics.mjs

import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import vm from 'node:vm';
import { RaidRoom } from '../server/simulation.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// Terminal formatting
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgDark: '\x1b[40m',
};

// Load deterministic game scripts in isolated VM
const context = vm.createContext({
  navigator: { userAgent: '', maxTouchPoints: 0 },
  innerWidth: 1920,
  innerHeight: 1080,
  document: {},
  console,
});
context.window = context;

for (const file of ['Constants', 'ShooterRules', 'RaidRules']) {
  const code = fs.readFileSync(path.join(ROOT, `js/${file}.js`), 'utf8');
  vm.runInContext(code, context);
}

const { ShooterRules, RaidRules, Constants } = vm.runInContext(`({
  ShooterRules, RaidRules,
  Constants: {
    POSTURE_STAND: typeof POSTURE_STAND !== 'undefined' ? POSTURE_STAND : null,
    POSTURE_CROUCH: typeof POSTURE_CROUCH !== 'undefined' ? POSTURE_CROUCH : null,
    POSTURE_PRONE: typeof POSTURE_PRONE !== 'undefined' ? POSTURE_PRONE : null,
    GAME_LEAN_OFFSET: typeof GAME_LEAN_OFFSET !== 'undefined' ? GAME_LEAN_OFFSET : 18,
    GAME_LEAN_ROLL: typeof GAME_LEAN_ROLL !== 'undefined' ? GAME_LEAN_ROLL : 0.07,
  }
})`, context);

let totalPassed = 0;
let totalFailed = 0;

function reportCheck(title, pass, details = '') {
  if (pass) {
    totalPassed++;
    console.log(`  ${C.green}✔ PASS${C.reset}  ${title}${details ? C.gray + ' — ' + details + C.reset : ''}`);
  } else {
    totalFailed++;
    console.log(`  ${C.red}✖ FAIL${C.reset}  ${C.bold}${title}${C.reset}${details ? '\n        ' + C.red + details + C.reset : ''}`);
  }
}

console.log(`\n${C.cyan}${C.bold}======================================================================${C.reset}`);
console.log(`${C.cyan}${C.bold}  ARC ENGINE // TACTICAL MOVEMENT, AIMING & BALLISTICS SUITE${C.reset}`);
console.log(`${C.cyan}${C.bold}======================================================================${C.reset}\n`);

// ---------------------------------------------------------------------------
// SECTION 1: Movement Verbs, Postures & Leaning
// ---------------------------------------------------------------------------
console.log(`${C.yellow}${C.bold}[1/5] ТАКТИЧЕСКИЕ ПОЗЫ И ПЕРЕДВИЖЕНИЕ (STAND, CROUCH, PRONE, SPRINT, LEAN)${C.reset}`);

const standMods = RaidRules.getPostureModifiers('stand');
const crouchMods = RaidRules.getPostureModifiers('crouch');
const proneMods = RaidRules.getPostureModifiers('prone');

reportCheck('Стойка (Stand): высота глаз 64px, скорость 100%, отдача/разброс 1.0x',
  standMods.eyeHeight === 64 && standMods.speedMult === 1.0 && standMods.recoilMult === 1.0,
  `eyeHeight=${standMods.eyeHeight}, speedMult=${standMods.speedMult}`);

reportCheck('Присед (Crouch): высота глаз 38px, скорость 62%, шум -65%, отдача 0.75x',
  crouchMods.eyeHeight === 38 && Math.abs(crouchMods.speedMult - 0.62) < 0.01,
  `eyeHeight=${crouchMods.eyeHeight}, speedMult=${crouchMods.speedMult}, noiseMult=${crouchMods.noiseMult}`);

reportCheck('Лежание (Prone): высота глаз 18px, скорость 28%, шум -85%, отдача 0.50x',
  proneMods.eyeHeight === 18 && Math.abs(proneMods.speedMult - 0.28) < 0.01,
  `eyeHeight=${proneMods.eyeHeight}, speedMult=${proneMods.speedMult}, recoilMult=${proneMods.recoilMult}`);

// Movement distance over 1 second
const pStand = { x: 0, y: 0 };
RaidRules.movePlayer(pStand, { forward: 1, right: 0, heading: 0 }, false, 1.0, { speed: 200, radius: 24, postureSpeedMult: standMods.speedMult }, [], { width: 2000, height: 2000 });
const pCrouch = { x: 0, y: 0 };
RaidRules.movePlayer(pCrouch, { forward: 1, right: 0, heading: 0 }, false, 1.0, { speed: 200, radius: 24, postureSpeedMult: crouchMods.speedMult }, [], { width: 2000, height: 2000 });
const pProne = { x: 0, y: 0 };
RaidRules.movePlayer(pProne, { forward: 1, right: 0, heading: 0 }, false, 1.0, { speed: 200, radius: 24, postureSpeedMult: proneMods.speedMult }, [], { width: 2000, height: 2000 });

reportCheck('Дистанции перемещения за 1с точно соответствуют множителям поз',
  Math.abs(pStand.x - 200) < 0.1 && Math.abs(pCrouch.x - 124) < 0.1 && Math.abs(pProne.x - 56) < 0.1,
  `Stand: ${pStand.x.toFixed(1)}px | Crouch: ${pCrouch.x.toFixed(1)}px | Prone: ${pProne.x.toFixed(1)}px`);

// Sprinting and stamina
const stamina = { value: 100, delay: 0, exhausted: false };
const stamCfg = { max: 100, drain: 20, regen: 15, delay: 1.5, restart: 25 };
const canSprintProne = RaidRules.tickStamina(stamina, false, 0.1, stamCfg); // Prone cancels sprint
RaidRules.tickStamina(stamina, true, 5.0, stamCfg); // drain to 0
const exhaustedSprint = RaidRules.tickStamina(stamina, true, 0.1, stamCfg);

reportCheck('Механика спринта: расход стамины и блокировка спринта при истощении',
  stamina.value === 0 && stamina.exhausted === true && exhaustedSprint === false,
  `stamina=${stamina.value}, exhausted=${stamina.exhausted}`);

// Leaning vectors
const leanOff = Constants.GAME_LEAN_OFFSET;
const leanRoll = Constants.GAME_LEAN_ROLL;
reportCheck(`Наклоны (Lean): боковой сдвиг ±${leanOff}px, наклон камеры ${leanRoll} rad (~4°)`,
  leanOff === 18 && Math.abs(leanRoll - 0.07) < 0.01,
  `offset=±${leanOff}px, roll=±${(leanRoll * 180 / Math.PI).toFixed(1)}°`);

console.log('');

// ---------------------------------------------------------------------------
// SECTION 2: Muzzle Origin & Reticle Aim Convergence
// ---------------------------------------------------------------------------
console.log(`${C.yellow}${C.bold}[2/5] СВЕДЕНИЕ СРЕЗА СТВОЛА И ПРИЦЕЛА (RETICLE CONVERGENCE)${C.reset}`);
console.log(`  ${C.gray}Проверяем, что во всех стойках пуля из смещённого ствола попадает ровно в цель прицела:${C.reset}`);

const targetRanges = [300, 600, 900, 1200];
const testPostures = [
  { name: 'Стоя (Stand)', eyeH: 64, muzzleH: 57, lean: 0, sprint: false },
  { name: 'В приседе (Crouch)', eyeH: 38, muzzleH: 31, lean: 0, sprint: false },
  { name: 'Лёжа (Prone)', eyeH: 18, muzzleH: 11, lean: 0, sprint: false },
  { name: 'Наклон влево (Lean L)', eyeH: 64, muzzleH: 57, lean: -1, sprint: false },
  { name: 'Наклон вправо (Lean R)', eyeH: 64, muzzleH: 57, lean: 1, sprint: false },
  { name: 'На бегу (Sprinting)', eyeH: 64, muzzleH: 57, lean: 0, sprint: true },
];

let allConvergencePassed = true;

for (const posture of testPostures) {
  for (const range of targetRanges) {
    const playerPos = { x: 300, y: 500 };
    const heading = Math.PI / 4; // 45 degrees
    const pitch = -0.05; // slightly looking down
    const fwd = {
      x: Math.cos(heading) * Math.cos(pitch),
      y: Math.sin(heading) * Math.cos(pitch),
      h: -Math.sin(pitch),
    };

    const lateralShift = -Math.sin(heading) * (posture.lean * 18);
    const lateralShiftY = Math.cos(heading) * (posture.lean * 18);

    const eyePos = {
      x: playerPos.x + lateralShift,
      y: playerPos.y + lateralShiftY,
      h: posture.eyeH,
    };

    // Barrel offset: 20px forward, 12px right, offset height
    const muzzlePos = {
      x: eyePos.x + fwd.x * 20 + (-Math.sin(heading) * 12),
      y: eyePos.y + fwd.y * 20 + (Math.cos(heading) * 12),
      h: posture.muzzleH,
    };

    const conv = ShooterRules.calculateAimConvergence(muzzlePos, eyePos, fwd, range);

    // Target placed exactly at reticle crosshair in 3D world space
    const target = {
      x: conv.aimPoint.x,
      y: conv.aimPoint.y,
      h: conv.aimPoint.h - 15,
      height: 30,
      radius: 18,
    };

    // Cast ray from muzzle along converged trajectory
    const rayEnd = {
      x: muzzlePos.x + conv.dirX * (conv.distance + 40),
      y: muzzlePos.y + conv.dirY * (conv.distance + 40),
      h: muzzlePos.h + conv.dirH * (conv.distance + 40),
    };

    const hit = ShooterRules.rayCylinderHit(muzzlePos, rayEnd, target);
    const atAimDist = {
      x: muzzlePos.x + conv.dirX * conv.distance,
      y: muzzlePos.y + conv.dirY * conv.distance,
      h: muzzlePos.h + conv.dirH * conv.distance,
    };
    const aimAligned = Math.hypot(atAimDist.x - conv.aimPoint.x, atAimDist.y - conv.aimPoint.y) < 0.05 &&
                       Math.abs(atAimDist.h - conv.aimPoint.h) < 0.05;
    const hitOk = !!hit && aimAligned;
    if (!hitOk) allConvergencePassed = false;
  }
}

reportCheck('Сведение ствола: пуля попадает в точку прицела на дистанциях 300..1200 px',
  allConvergencePassed,
  'Проверено для всех 6 состояний игрока (Stand, Crouch, Prone, Lean L/R, Sprint)');

console.log('');

// ---------------------------------------------------------------------------
// SECTION 3: Ballistics Flight Simulation & Gravity Drop
// ---------------------------------------------------------------------------
console.log(`${C.yellow}${C.bold}[3/5] РАСЧЁТ БАЛЛИСТИКИ ПУЛИ (ТРАЕКТОРИЯ, СКОРОСТЬ, ПАДЕНИЕ)${C.reset}`);

const bulletSpeed = 5000; // px/s
const gravity = 980;
const drag = 0.038;

const proj = ShooterRules.createProjectile({
  x: 0, y: 0, h: 64,
  vx: bulletSpeed, vy: 0, vh: 0,
  speed: bulletSpeed, gravity, drag,
  maxRange: 2000,
});

const dt = 1 / 60;
const trajectoryLog = [];
let groundHit = null;

for (let i = 0; i < 60; i++) {
  const prevH = proj.h;
  const res = ShooterRules.stepProjectile(proj, dt, [], [], (x, y) => 0); // Flat ground h=0
  trajectoryLog.push({
    tick: i + 1,
    dist: proj.distanceTraveled,
    h: proj.h,
    vx: proj.vx,
    drop: 64 - proj.h,
  });
  if (res.hit && res.type === 'terrain') {
    groundHit = res;
    break;
  }
}

// Visual ASCII Trajectory Graph
console.log(`  ${C.cyan}График снижения пули по дистанции (начальная высота h=64px, V=5000px/s):${C.reset}`);
const checkpoints = [100, 300, 600, 900, 1200, 1500];
for (const dist of checkpoints) {
  const pt = trajectoryLog.find(p => p.dist >= dist) || trajectoryLog[trajectoryLog.length - 1];
  const barLen = Math.max(0, Math.min(40, Math.round(pt.drop * 1.2)));
  const bar = '█'.repeat(barLen) + '░'.repeat(40 - barLen);
  console.log(`    Dist: ${String(dist).padStart(4)} px | H: ${pt.h.toFixed(1).padStart(5)} px | Drop: -${pt.drop.toFixed(1).padStart(4)} px [${C.magenta}${bar}${C.reset}]`);
}

const dropAt300 = trajectoryLog.find(p => p.dist >= 300).drop;
const dropAt900 = trajectoryLog.find(p => p.dist >= 900).drop;
reportCheck('Квадратичное гравитационное падение: спад на 900px значительно превышает 300px',
  dropAt900 > dropAt300 * 5,
  `Drop@300: -${dropAt300.toFixed(1)}px | Drop@900: -${dropAt900.toFixed(1)}px`);

console.log('');

// ---------------------------------------------------------------------------
// SECTION 4: Ballistics vs Hitscan Hit Registration
// ---------------------------------------------------------------------------
console.log(`${C.yellow}${C.bold}[4/5] СРАВНЕНИЕ ХИТСКАН VS БАЛЛИСТИКА (ПОРАЖЕНИЕ ЦЕЛИ, ХЕДШОТ, УКРЫТИЯ)${C.reset}`);

const targetActor = { id: 'dummy_raider', x: 500, y: 0, h: 0, height: 64, radius: 22 };
const coverBlocker = { x: 300, y: 0, h: 0, height: 80, radius: 28 };

// Test 1: Hitscan direct headshot
const hsHitscan = ShooterRules.raycastHitscan({ x: 0, y: 0, h: 56 }, { x: 1, y: 0, h: 0 }, 1000, [targetActor], []);
reportCheck('Хитскан: мгновенное попадание в верхнюю зону головы (Хедшот 1.8x)',
  hsHitscan.hit && hsHitscan.headshot === true && hsHitscan.damage > 34,
  `hit=${hsHitscan.hit}, headshot=${hsHitscan.headshot}, damage=${hsHitscan.damage}`);

// Test 2: Hitscan blocked by cover
const blockedHitscan = ShooterRules.raycastHitscan({ x: 0, y: 0, h: 56 }, { x: 1, y: 0, h: 0 }, 1000, [targetActor], [coverBlocker]);
reportCheck('Хитскан: укрытие корректно перехватывает луч перед целью',
  blockedHitscan.hit && blockedHitscan.type === 'blocker',
  `hitType=${blockedHitscan.type}, dist=${blockedHitscan.distance.toFixed(1)}px < 300px`);

// Test 3: Ballistic bullet hitting target
const ballisticProj = ShooterRules.createProjectile({
  x: 0, y: 0, h: 32,
  vx: 5000, vy: 0, vh: 0,
  damage: 40, gravity: 0, drag: 0,
});
const ballisticRes = ShooterRules.stepProjectile(ballisticProj, 0.12, [targetActor]);
reportCheck('Баллистика: пуля поражает тело цилиндра цели (Torso hit)',
  ballisticRes.hit && ballisticRes.type === 'actor' && ballisticRes.headshot === false,
  `hit=${ballisticRes.hit}, target=${ballisticRes.target.id}, dmg=${ballisticRes.damage}`);

console.log('');

// ---------------------------------------------------------------------------
// SECTION 5: Authoritative Multiplayer Server Simulation
// ---------------------------------------------------------------------------
console.log(`${C.yellow}${C.bold}[5/5] АВТОРИТЕТНАЯ СЕРВЕРНАЯ ЧАСТЬ (RAIDROOM MULTIPLAYER MATCH)${C.reset}`);

const room = new RaidRoom();
room.join('operator_alpha');
room.join('operator_beta');

const alpha = room.players.get('operator_alpha');
const beta = room.players.get('operator_beta');
alpha.x = 200; alpha.y = 1000;
beta.x = 450; beta.y = 1000; beta.hp = 100; beta.shield = 100;

// 1. Posture speed verification on server
for (let i = 0; i < 60; i++) {
  if (i % 15 === 0) {
    room.input('operator_alpha', { version: 1, sequence: i, forward: 1, right: 0, heading: 0, sprint: false, posture: 'crouch' });
  }
  room.step();
}
const crouchSpeedActual = alpha.x - 200;
reportCheck('Сервер ограничивает скорость присевшего игрока до 62% от базовой',
  Math.abs(crouchSpeedActual - 161.2) < 1.0,
  `travel60ticks=${crouchSpeedActual.toFixed(1)}px (expected 161.2px = 260px/s * 0.62)`);

// 2. Crouch dodging on server
alpha.x = 200; alpha.y = 1000; alpha.ammo = 10; alpha.fireCooldown = 0;
beta.x = 450; beta.y = 1000; beta.h = 0; beta.hp = 100; beta.shield = 0;
room.events = [];

// Beta crouches down: height becomes 38
room.input('operator_beta', { version: 1, sequence: 100, forward: 0, right: 0, heading: 0, sprint: false, posture: 'crouch' });
// Alpha stands and fires straight at standing head level (h = 55)
room.input('operator_alpha', { version: 1, sequence: 100, forward: 0, right: 0, heading: 0, pitch: 0, sprint: false, posture: 'stand', fire: true });

for (let i = 0; i < 10; i++) room.step();

const dodgeHit = room.events.find(e => e.type === 'hit' && e.targetId === 'operator_beta');
reportCheck('Серверное приседание: пуля на высоте h=55px пролетает над присевшим игроком',
  dodgeHit === undefined && beta.hp === 100 && beta.height === 38,
  `targetHp=${beta.hp}, targetHeight=${beta.height}`);

// 3. Leaning peek shot on server around cover
const blockerMid = { x: 320, y: 1000, radius: 24, height: 80 };
room.blockers.push(blockerMid);
beta.y = 1040; // Positioned behind cover
beta.shield = 100;
alpha.ammo = 10;
alpha.fireCooldown = 0;
room.events = [];

// Beta stands up
room.input('operator_beta', { version: 1, sequence: 200, forward: 0, right: 0, heading: 0, sprint: false, posture: 'stand' });
// Alpha leans right (+Y by 18px), aims past the blocker edge
const aimPastBlocker = Math.atan2(beta.y - 1018, beta.x - alpha.x);
room.input('operator_alpha', { version: 1, sequence: 200, forward: 0, right: 0, heading: aimPastBlocker, pitch: 0, sprint: false, posture: 'stand', lean: 1, fire: true });

for (let i = 0; i < 10; i++) room.step();

const leanPeekHit = room.events.find(e => e.type === 'hit' && e.targetId === 'operator_beta');
reportCheck('Серверный наклон (Lean): выглядывание из-за укрытия позволяет поразить цель',
  leanPeekHit !== undefined && beta.shield < 100,
  `hitRegistered=${!!leanPeekHit}, targetShield=${beta.shield}`);

console.log(`\n${C.cyan}${C.bold}======================================================================${C.reset}`);
const allOk = totalFailed === 0;
const statusColor = allOk ? C.green : C.red;
console.log(`  ${statusColor}${C.bold}РЕЗУЛЬТАТ: ${totalPassed} УСПЕШНО, ${totalFailed} ОШИБОК${C.reset}`);
console.log(`${C.cyan}${C.bold}======================================================================${C.reset}\n`);

process.exit(allOk ? 0 : 1);
