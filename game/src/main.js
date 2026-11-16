// Emberline — boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. main.js owns the wiring: the player shoots (hitscan
// against bots and the world), bots shoot back through the context in bots.js,
// the match in rounds.js owns phases and the score, and the HUD/audio/effects
// modules only ever receive numbers. Seeded RNG (makeRng) drives every roll, so
// ?shot=start|play|buy|round-end&seed=N renders the same frame every time, and
// ?seed=N replays the same match. No Date/Math.random in gameplay paths.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeRng } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, BUY_ITEMS, PRICES } from './weapon.js';
import { createBots } from './bots.js';
import { createMatch, MATCH } from './rounds.js';
import { createEconomy, ECONOMY } from './economy.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = makeRng(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Dusk sky: lighter than the UI canvas so the backdrop never reads black.
scene.background = new THREE.Color('#2b313b');
scene.fog = new THREE.Fog(new THREE.Color('#2b313b'), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const weapon = createWeapon(camera);
const hud = createHud();
const audio = createAudio();
const effects = createEffects(scene);
const economy = createEconomy();
const player = createPlayer(world.colliders);
const bots = createBots(scene, world, rng);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();

// --- player state (one place; bots keep their own in bots.js) ---
const you = {
  hp: 100, armour: 0, alive: true, smokes: 0, carriesCharge: true,
  pos: player.state.position,
};
let roundSite = 'A';
let plantProgress = 0;
let buyOpen = false;
let frozen = false;
let started = false;
let overlayOpen = false;
let triggerUsed = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let grenade = null;
let match = null;

const shootables = world.shootables.concat(bots.hitMeshes);

// The planted charge: a small blinking box, hidden until a plant lands.
const chargeMesh = new THREE.Group();
const chargeBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.4 }),
);
chargeMesh.add(chargeBody);
const chargeLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
chargeLight.position.y = 0.4;
chargeMesh.add(chargeLight);
chargeMesh.visible = false;
scene.add(chargeMesh);

function siteOf(point) {
  for (const key of ['A', 'B']) {
    const s = world.sites[key];
    if (Math.hypot(point.x - s.center.x, point.z - s.center.z) < s.radius) return key;
  }
  return null;
}

function canSee(from, to) {
  if (effects.smokeBlocks(from, to)) return false;
  const dist = from.distanceTo(to);
  direction.copy(to).sub(from).normalize();
  raycaster.set(from, direction);
  raycaster.far = dist - 0.25;
  return raycaster.intersectObjects(world.shootables, false).length === 0;
}

function addKillFeed(killer, victim, headshot, killerTeam) {
  hud.killfeed(killer, victim, headshot, killerTeam);
}

function applyDamageToPlayer(amount, part, attacker) {
  if (!you.alive) return;
  let dmg = amount;
  if (you.armour > 0) {
    const absorbed = Math.min(you.armour, Math.round(dmg * 0.5));
    you.armour -= absorbed;
    dmg -= absorbed;
  }
  you.hp -= dmg;
  hud.damageFlash();
  effects.addShake(0.012);
  if (!shot) audio.hurt();
  hud.setHealth(you.hp, you.armour);
  if (you.hp <= 0) {
    you.hp = 0;
    you.alive = false;
    you.carriesCharge = false;
    hud.toast('You are down — your team fights on', 4000);
    // The charge passes to the first living teammate bot.
    const carrier = bots.list.find((b) => b.team === 'attack' && b.alive);
    if (carrier) { carrier.isCarrier = true; carrier.site = roundSite; }
  }
}

function onBotDeath(bot, killer) {
  addKillFeed(killer === 'player' ? 'You' : killer.name, bot.name, false, killer === 'player' ? 'attack' : killer.team);
  if (killer === 'player') {
    economy.earn(ECONOMY.kill);
    hud.setMoney(economy.money);
    hud.toast(`+$${ECONOMY.kill} — ${bot.name} down`, 1600);
  }
  if (bot.isCarrier && !match.state.charge.planted) {
    const next = bots.list.find((b) => b.team === 'attack' && b.alive);
    if (next) { next.isCarrier = true; next.site = roundSite; }
  }
}

// One stable object for the player as a bot target: bots compare it by identity
// to time their reaction, so it must not be rebuilt every tick.
const playerFoe = {
  kind: 'player',
  pos: you.pos,
  eye: 1.5,
  get alive() { return you.alive; },
  get speed() { return player.groundSpeed(); },
  get crouching() { return player.crouching; },
};
playerFoe.obj = playerFoe;

function botContext() {
  return {
    player: playerFoe,
    canSee,
    charge: match.state.charge,
    time: elapsed,
    damage(enemy, amount, part, attacker) {
      if (enemy.kind === 'player') { applyDamageToPlayer(amount, part, attacker); return; }
      const bot = enemy.obj;
      if (!bot.alive) return;
      if (bots.damage(bot, amount, part, attacker)) onBotDeath(bot, attacker);
    },
    botShoot(bot, from, to) {
      effects.tracer(from, to);
      if (!shot) audio.enemyShot();
    },
    onPlant(site, bot) {
      if (match.plant(site, bot.group.position.clone())) {
        chargeMesh.position.copy(bot.group.position);
        chargeMesh.visible = true;
        if (bot === 'player') { economy.earn(ECONOMY.plant); hud.setMoney(economy.money); }
      }
    },
    onDefuse(bot) {
      match.defuse();
      chargeMesh.visible = false;
    },
    onBotDeath,
  };
}

function newMatchEvents() {
  return {
    onRoundStart(round) {
      roundSite = round % 2 === 1 ? 'A' : 'B';
      bots.reset(round, roundSite);
      for (const b of bots.list) b.isCarrier = false; // the player carries the charge
      you.hp = 100;
      you.alive = true;
      you.carriesCharge = true;
      player.state.position.copy(world.spawns.attack[4]);
      player.state.yaw = 0;
      player.state.pitch = 0;
      player.state.velocity.set(0, 0, 0);
      weapon.equip(weapon.id);
      chargeMesh.visible = false;
      plantProgress = 0;
      grenade = null;
      hud.setScore(match.state.scoreAttack, match.state.scoreDefend, round);
      hud.setHealth(you.hp, you.armour);
      hud.setMoney(economy.money);
      hud.setAlive(5, 5);
      hud.bombStatus(`CHARGE READY — plant at ${roundSite} site`, 0);
      hud.toast(`Round ${round} — push ${roundSite} site`, 3000);
      openBuy();
    },
    onPlayStart() { closeBuy(); },
    onRoundEnd(winner, reason, a, b) {
      const playerWon = winner === 'attack';
      economy.earn(playerWon ? ECONOMY.win : ECONOMY.loss);
      for (const bot of bots.list) bot.money += playerWon === (bot.team === 'attack') ? ECONOMY.win : ECONOMY.loss;
      hud.setMoney(economy.money);
      hud.setScore(a, b, match.state.round);
      chargeMesh.visible = false;
      if (!shot) {
        if (playerWon) audio.roundWin(); else audio.roundLose();
        showOverlay('roundEnd', { playerWon, reason, a, b });
        if (document.pointerLockElement) document.exitPointerLock();
      }
    },
    onMatchEnd(winner, a, b) {
      if (!shot) {
        showOverlay('matchEnd', { playerWon: winner === 'attack', a, b });
        if (document.pointerLockElement) document.exitPointerLock();
      }
    },
    onPlant(site) {
      hud.toast(`Charge planted at ${site} site — defend it!`, 3500);
      if (!shot) audio.plantDone();
    },
    onExplode(site) {
      const pos = match.state.charge.pos || world.sites[site].center;
      effects.burst(pos.clone().setY(1), 40, rng);
      effects.addShake(0.05);
      chargeMesh.visible = false;
    },
  };
}

match = createMatch(newMatchEvents());

function showOverlay(mode, data) {
  overlayOpen = true;
  hud.showOverlay(mode, data);
}
function hideOverlay() {
  overlayOpen = false;
  hud.hideOverlay();
}

function openBuy() {
  if (match.state.phase !== 'freeze' || !started) return;
  buyOpen = true;
  refreshBuy();
}
function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
}
function refreshBuy() {
  const items = BUY_ITEMS.map((item) => {
    const price = item.id === 'armour' ? PRICES.armour : item.id === 'smoke' ? PRICES.smoke : WEAPONS[item.id].price;
    const owned = item.id === 'pistol' || item.id === weapon.id;
    return { ...item, price, disabled: economy.money < price && !owned };
  });
  hud.showBuy(items, economy.money);
}
function buyItem(id) {
  if (!buyOpen || match.state.phase !== 'freeze') return;
  if (id === 'armour') {
    if (you.armour >= 100) { if (!shot) audio.denied(); return; }
    if (!economy.spend(PRICES.armour)) { if (!shot) audio.denied(); return; }
    you.armour = 100;
  } else if (id === 'smoke') {
    if (you.smokes >= 2) { if (!shot) audio.denied(); return; }
    if (!economy.spend(PRICES.smoke)) { if (!shot) audio.denied(); return; }
    you.smokes += 1;
  } else {
    const w = WEAPONS[id];
    if (id !== 'pistol' && id !== weapon.id) {
      if (!economy.spend(w.price)) { if (!shot) audio.denied(); return; }
    }
    weapon.equip(id);
  }
  if (!shot) audio.buy();
  hud.setMoney(economy.money);
  hud.setHealth(you.hp, you.armour);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.spec.name);
  refreshBuy();
}
hud.onBuy(buyItem);

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'title') {
    economy.reset();
    you.armour = 0;
    you.smokes = 0;
    weapon.equip('pistol');
    match.startMatch();
    started = true;
    hideOverlay();
    input.requestLock();
  } else if (match.state.phase === 'matchEnd') {
    economy.reset();
    you.armour = 0;
    you.smokes = 0;
    weapon.equip('pistol');
    match.startMatch();
    started = true;
    hideOverlay();
    input.requestLock();
  } else {
    hideOverlay();
    input.requestLock();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hideOverlay();
  } else if (!overlayOpen && started && match.state.phase !== 'title') {
    showOverlay('paused');
  }
}

function syncCamera() {
  const body = player.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.position.x += effects.shakeOffset().x;
  camera.position.y += effects.shakeOffset().y;
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function playerShoot() {
  if (!weapon.takeRound()) {
    if (!shot) audio.dryFire();
    return false;
  }
  const spec = weapon.spec;
  const spread = weapon.spread(player.groundSpeed(), player.walking(input.state.keys));
  const pellets = spec.pellets || 1;
  let hitAny = false;
  camera.getWorldDirection(direction);
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  muzzle.y -= 0.12;
  for (let p = 0; p < pellets; p += 1) {
    const dir = direction.clone();
    dir.x += (rng.next() * 2 - 1) * spread;
    dir.y += (rng.next() * 2 - 1) * spread;
    dir.z += (rng.next() * 2 - 1) * spread;
    dir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, dir);
    raycaster.far = 90;
    const hit = raycaster.intersectObjects(shootables, false)[0];
    const end = hit ? hit.point : camera.position.clone().addScaledVector(dir, 60);
    effects.tracer(muzzle, end);
    if (!hit) continue;
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      if (!bot.alive) continue;
      if (bot.team === 'attack') {
        // No friendly fire: a teammate stops the bullet but takes no damage.
        effects.burst(hit.point, 4, rng);
        continue;
      }
      const part = hit.object.userData.part;
      const dist = hit.distance;
      const dmg = Math.round(spec.damage * (part === 'head' ? spec.headMult : 1) * Math.max(0.6, 1 - dist * spec.falloff));
      const killed = bots.damage(bot, dmg, part, 'player');
      hud.hitMarker(killed, shot ? 4000 : 90);
      effects.burst(hit.point, killed ? 14 : 6, rng);
      if (!shot) { if (killed) audio.kill(); else audio.hit(); }
      if (killed) onBotDeath(bot, 'player');
      hitAny = true;
    } else {
      effects.burst(hit.point, 4, rng);
    }
  }
  weapon.pullTrigger();
  const recoil = weapon.recoilFor(weapon.state.shotsFired);
  player.recoil(recoil.pitch, recoil.yaw);
  effects.addShake(0.004);
  if (!shot) audio.shot(weapon.id);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, spec.name);
  return hitAny;
}

function throwSmoke() {
  if (you.smokes <= 0 || match.state.phase !== 'play') return;
  you.smokes -= 1;
  camera.getWorldDirection(direction);
  grenade = {
    pos: camera.position.clone(),
    vel: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 3.5, 0)),
  };
  hud.toast(`Smoke out — ${you.smokes} left`, 1500);
}

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;
  if (phase === 'play' || phase === 'freeze' || phase === 'roundEnd') {
    // Player movement is frozen during the buy phase; look still works.
    if (phase !== 'freeze' && you.alive) player.step(dt, input.state.keys);
    weapon.step(dt);
    effects.step(dt, rng);
    if (phase === 'play' && you.alive) {
      // Plant: hold E inside a site while carrying the charge.
      const inSite = siteOf(you.pos);
      if (you.carriesCharge && !match.state.charge.planted && inSite && input.state.keys.has('KeyE')) {
        plantProgress += dt;
        hud.plantProgress(plantProgress / 3, `PLANTING AT ${inSite} SITE — hold E`);
        if (plantProgress >= 3) {
          plantProgress = 0;
          hud.plantProgress(null);
          const pos = you.pos.clone();
          if (match.plant(inSite, pos)) {
            chargeMesh.position.copy(pos);
            chargeMesh.visible = true;
            economy.earn(ECONOMY.plant);
            hud.setMoney(economy.money);
          }
        }
      } else {
        if (plantProgress > 0) hud.plantProgress(null);
        plantProgress = 0;
      }
    }
    if (grenade) {
      grenade.vel.y -= 12 * dt;
      grenade.pos.addScaledVector(grenade.vel, dt);
      if (grenade.pos.y <= 0.15) {
        effects.addSmoke(grenade.pos.clone().setY(1), 3, 12);
        effects.burst(grenade.pos, 10, rng);
        grenade = null;
      }
    }
    if (phase === 'play' || phase === 'freeze') {
      bots.step(dt, botContext());
    }
    match.step(dt, (you.alive ? 1 : 0) + bots.aliveCount('attack'), bots.aliveCount('defend'));
    // Charge blink + HUD charge status.
    if (match.state.charge.planted) {
      const fuse = match.state.charge.fuse;
      chargeLight.intensity = 6 + Math.sin(elapsed * 10) * 5;
      chargeBody.material.emissiveIntensity = 0.4 + Math.sin(elapsed * 10) * 0.3;
      hud.bombStatus(`CHARGE PLANTED — ${match.state.charge.site} SITE · ${Math.ceil(fuse)}s`, fuse / MATCH.fuseSeconds);
    } else if (phase === 'play') {
      hud.bombStatus(you.carriesCharge ? `YOU CARRY THE CHARGE — plant at ${roundSite} site` : 'CHARGE WITH A TEAMMATE — cover them', 0);
    }
    hud.setAlive((you.alive ? 1 : 0) + bots.aliveCount('attack'), bots.aliveCount('defend'));
    hud.setTimer(phase === 'play' && match.state.charge.planted ? match.state.charge.fuse : match.state.timer, phase);
  }
  if (!input.state.firing) { weapon.recover(); triggerUsed = false; }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const pressed = input.takePressed();
    if (pressed.has('KeyM')) hud.setMuted(audio.toggleMute());
    if (pressed.has('KeyP') && document.pointerLockElement) document.exitPointerLock();
    if (pressed.has('KeyB')) {
      if (buyOpen) closeBuy();
      else openBuy();
    }
    if (buyOpen) {
      for (const item of BUY_ITEMS) if (pressed.has(`Digit${item.key}`)) buyItem(item.id);
    }
    if (pressed.has('KeyG')) throwSmoke();
    const phase = match.state.phase;
    if (input.state.firing && you.alive && phase === 'play' && weapon.ready()) {
      if (weapon.spec.auto || !triggerUsed) {
        playerShoot();
        triggerUsed = true;
      }
    }
    if (input.state.keys.has('KeyR')) weapon.reload();
    if (pressed.has('KeyR') && !shot) audio.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    const spreadPx = 4 + weapon.spread(player.groundSpeed(), player.walking(input.state.keys)) * 900;
    hud.setCrosshair(spreadPx);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hideOverlay();
  started = true;
  const body = player.state;
  if (name === 'start') {
    // Stand south of the mid wall, looking north-west across mid toward the A
    // connector: lit wall faces fill the frame edges around the title panel.
    body.position.set(2, 0, 12);
    settle(4);
    aimAt(new THREE.Vector3(-8, 1.5, -10));
    showOverlay('start');
    hud.setScore(0, 0, 1);
    hud.setTimer(MATCH.freezeSeconds, 'freeze');
  } else if (name === 'buy') {
    economy.reset();
    economy.earn(1200); // a second-round wallet, so the menu shows real choices
    match.startMatch();
    body.position.set(0, 0, 18.5);
    settle(4);
    aimAt(new THREE.Vector3(0, 1.5, 0));
    openBuy();
    hud.setTimer(MATCH.freezeSeconds, 'freeze');
  } else if (name === 'play') {
    match.startMatch();
    match.state.phase = 'play';
    match.state.timer = MATCH.roundSeconds;
    closeBuy();
    // Stand south of the mid wall, east of the pillar, looking north through
    // the gap: the wall, the mid doors and a defender in the gap all read.
    body.position.set(1.6, 0, 9);
    body.yaw = 0;
    settle(150); // bots walk out, take positions, spot each other
    // Aim at the nearest living defender and fire a burst so tracers read.
    let best = null;
    let bestD = Infinity;
    for (const b of bots.list) {
      if (b.team !== 'defend' || !b.alive) continue;
      const d = Math.hypot(b.group.position.x - body.position.x, b.group.position.z - body.position.z);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      aimAt(new THREE.Vector3(best.group.position.x, 1.3, best.group.position.z));
      weapon.equip('rifle');
      for (let i = 0; i < 3; i += 1) { playerShoot(); settle(6); }
      settle(6);
    }
    hud.setTimer(match.state.timer, 'play');
  } else if (name === 'round-end') {
    match.startMatch();
    match.state.phase = 'play';
    match.state.timer = MATCH.roundSeconds;
    closeBuy();
    body.position.set(-4, 0, 2);
    settle(120);
    match.state.scoreAttack = 2;
    match.state.scoreDefend = 1;
    match.endRound('attack', 'Team eliminated');
    settle(10);
    hud.setScore(2, 1, 1);
    showOverlay('roundEnd', { playerWon: true, reason: 'Team eliminated', a: 2, b: 1 });
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.spec.name);
  hud.setHealth(you.hp, you.armour);
  hud.setMoney(economy.money);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug handle for headless play-tests (CDP): start a match, fire, buy, plant.
// It only drives the same public paths a player uses — no cheats beyond the test.
window.__ember = {
  get phase() { return match.state.phase; },
  get round() { return match.state.round; },
  get score() { return [match.state.scoreAttack, match.state.scoreDefend]; },
  get hp() { return you.hp; },
  get money() { return economy.money; },
  get alive() { return { attack: (you.alive ? 1 : 0) + bots.aliveCount('attack'), defend: bots.aliveCount('defend') }; },
  get charge() { return match.state.charge.planted ? match.state.charge.site : null; },
  get botsAlive() { return bots.list.filter((b) => b.alive).length; },
  get botsDebug() {
    return bots.list.map((b) => ({
      name: b.name, team: b.team,
      x: Math.round(b.group.position.x * 10) / 10,
      z: Math.round(b.group.position.z * 10) / 10,
      state: b.state, hp: b.hp, alive: b.alive,
      hasEnemy: !!b.enemy, weapon: b.weaponId,
    }));
  },
  start() {
    if (match.state.phase === 'title') {
      economy.reset();
      match.startMatch();
      started = true;
      hideOverlay();
    }
  },
  skipFreeze() {
    if (match.state.phase === 'freeze') { match.state.phase = 'play'; match.state.timer = MATCH.roundSeconds; closeBuy(); }
  },
  fireAtBot() {
    let best = null;
    let bestD = Infinity;
    for (const b of bots.list) {
      if (b.team !== 'defend' || !b.alive) continue;
      const d = Math.hypot(b.group.position.x - player.state.position.x, b.group.position.z - player.state.position.z);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) return false;
    aimAt(new THREE.Vector3(best.group.position.x, 1.3, best.group.position.z));
    return playerShoot();
  },
  teleport(x, z) { player.state.position.set(x, 0, z); },
  buy(id) { openBuy(); buyItem(id); closeBuy(); },
  plantNow() {
    const site = roundSite;
    const c = world.sites[site].center;
    player.state.position.set(c.x, 0, c.z);
    const pos = player.state.position.clone();
    return match.plant(site, pos);
  },
  endRoundNow(winner) { match.endRound(winner, 'Debug'); },
  stepN(n) { for (let i = 0; i < n; i += 1) step(FIXED_STEP); syncCamera(); },
};

syncCamera();
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.spec.name);
hud.setHealth(you.hp, you.armour);
hud.setMoney(economy.money);
hud.setScore(0, 0, 1);
hud.setAlive(5, 5);
hud.setTimer(MATCH.freezeSeconds, 'freeze');
if (shot) runShot(shot);
else {
  showOverlay('start');
  overlayOpen = true;
  requestAnimationFrame(frame);
}
