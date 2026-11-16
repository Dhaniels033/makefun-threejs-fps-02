// Bots: 4 teammates + 5 enemies. Each bot walks a waypoint graph (BFS paths),
// holds, pushes, strafes while engaging, retreats at low HP, buys a weapon every
// round from the same economy as the player, and plants / defuses the charge.
// Seeing is a raycast against the world (main.js supplies canSee, which also
// honours smoke); shooting is a seeded roll with accuracy that falls off with
// distance, so a bot is dangerous up close and beatable at range.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapon.js';

const ATTACK_NAMES = ['Ash', 'Cinder', 'Flint', 'Soot'];
const DEFEND_NAMES = ['Bram', 'Kestrel', 'Onyx', 'Pike', 'Rook'];
const BOT_SPEED = 3.4;
const BOT_RADIUS = 0.34;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.6;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;

function bfsPath(nodes, from, to) {
  if (from === to) return [to];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of nodes[cur].links) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let n = to;
        while (n !== from) { n = prev[n]; path.unshift(n); }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

export function createBots(scene, world, rng) {
  const nodes = world.waypoints;
  const bodyMatAtt = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.7 });
  const bodyMatDef = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 12, 10);
  const legGeo = new THREE.BoxGeometry(0.16, 0.55, 0.18);

  const list = [];
  const hitMeshes = [];

  function makeBot(index, team, name) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, team === 'attack' ? bodyMatAtt : bodyMatDef);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.53;
    const legL = new THREE.Mesh(legGeo, legMat);
    legL.position.set(-0.13, 0.28, 0);
    const legR = new THREE.Mesh(legGeo, legMat);
    legR.position.set(0.13, 0.28, 0);
    group.add(torso, head, legL, legR);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    scene.add(group);
    const bot = {
      id: index, name, team, group, torso, head,
      hp: 100, armour: 0, alive: true, money: 800,
      weaponId: 'pistol', spec: WEAPONS.pistol,
      state: 'push', yaw: 0, speed: BOT_SPEED,
      path: [], pathIndex: 0, holdNode: 0, holdTime: 0,
      target: null, enemy: null, enemyDist: Infinity, scanTimer: 0,
      reaction: 0, burstLeft: 0, burstGap: 0, shotGap: 0,
      strafeDir: 1, strafeTime: 0, progress: 0, fall: 0,
      site: null, isCarrier: false, visibleTime: 0,
    };
    torso.userData.bot = bot; torso.userData.part = 'torso';
    head.userData.bot = bot; head.userData.part = 'head';
    hitMeshes.push(torso, head);
    list.push(bot);
    return bot;
  }

  ATTACK_NAMES.forEach((n, i) => makeBot(i, 'attack', n));
  DEFEND_NAMES.forEach((n, i) => makeBot(4 + i, 'defend', n));

  const probe = new THREE.Box3();
  function overlaps(x, y, z, height) {
    probe.min.set(x - BOT_RADIUS, y + 0.04, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, y + height - 0.04, z + BOT_RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function setPath(bot, targetNode) {
    const from = nearestNode(bot.group.position.x, bot.group.position.z);
    bot.path = bfsPath(nodes, from, targetNode);
    bot.pathIndex = 0;
  }

  function moveToward(bot, tx, tz, dt, strafe) {
    const p = bot.group.position;
    let dx = tx - p.x;
    let dz = tz - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    dx /= len; dz /= len;
    if (strafe) {
      const px = -dz * bot.strafeDir;
      const pz = dx * bot.strafeDir;
      dx = dx * 0.55 + px * 0.45;
      dz = dz * 0.55 + pz * 0.45;
      const l2 = Math.hypot(dx, dz) || 1;
      dx /= l2; dz /= l2;
    }
    bot.yaw = Math.atan2(-dx, -dz);
    bot.group.rotation.y = bot.yaw;
    const stepLen = bot.speed * dt;
    const nx = p.x + dx * stepLen;
    if (!overlaps(nx, 0, p.z, 1.72)) p.x = nx;
    const nz = p.z + dz * stepLen;
    if (!overlaps(p.x, 0, nz, 1.72)) p.z = nz;
    return Math.hypot(tx - p.x, tz - p.z) < 0.4;
  }

  function pickWeapon(bot) {
    const m = bot.money;
    const roll = rng.next();
    let id = 'pistol';
    if (m >= 3500 && roll < 0.2) id = 'sniper';
    else if (m >= 2000) id = 'rifle';
    else if (m >= 1200) id = 'smg';
    else if (m >= 700) id = 'shotgun';
    bot.weaponId = id;
    bot.spec = WEAPONS[id];
    bot.money -= WEAPONS[id].price;
    if (bot.money >= 400 && rng.chance(0.5)) { bot.armour = 50; bot.money -= 400; }
    else bot.armour = 0;
  }

  function reset(round, carrierSite) {
    const attackSpawns = world.spawns.attack;
    const defendSpawns = world.spawns.defend;
    for (const bot of list) {
      const spawn = bot.team === 'attack'
        ? attackSpawns[bot.id % attackSpawns.length]
        : defendSpawns[(bot.id - 4) % defendSpawns.length];
      bot.group.position.copy(spawn);
      bot.group.rotation.set(0, bot.team === 'attack' ? Math.PI : 0, 0);
      bot.yaw = bot.team === 'attack' ? Math.PI : 0;
      bot.hp = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.state = 'push';
      bot.target = null;
      bot.reaction = 0;
      bot.burstLeft = 0;
      bot.progress = 0;
      bot.visibleTime = 0;
      bot.strafeDir = rng.chance(0.5) ? 1 : -1;
      pickWeapon(bot);
      if (bot.team === 'attack') {
        bot.site = carrierSite;
        bot.isCarrier = bot.id === 0;
        setPath(bot, carrierSite === 'A' ? 18 : 20);
      } else {
        bot.site = null;
        bot.isCarrier = false;
        // Defenders split: two hold A, two hold B, one holds mid-top.
        const hold = [23, 24, 16, 23, 24][bot.id - 4];
        bot.holdNode = hold;
        setPath(bot, hold);
      }
    }
  }

  // ctx: { player, canSee, damage, onPlant, onDefuse, onBotDeath, charge,
  //        phase, time, round }
  function step(dt, ctx) {
    for (const bot of list) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.4);
          bot.group.rotation.x = -bot.fall * 1.45;
        }
        continue;
      }
      const p = bot.group.position;
      // --- pick the nearest visible enemy, re-scanned 6x a second (raycasts are
      // the most expensive thing a bot does, so the scan is throttled) ---
      bot.scanTimer -= dt;
      let enemy = bot.enemy;
      let enemyDist = bot.enemyDist;
      if (bot.scanTimer <= 0) {
        bot.scanTimer = 0.15;
        enemy = null;
        enemyDist = Infinity;
        const foes = [];
      if (ctx.player.alive && bot.team === 'defend') foes.push({ kind: 'player', obj: ctx.player, pos: ctx.player.pos, eye: 1.5 });
      for (const other of list) {
        if (other.team !== bot.team && other.alive) {
          foes.push({ kind: 'bot', obj: other, pos: other.group.position, eye: 1.4 });
        }
      }
      for (const foe of foes) {
        const d = Math.hypot(foe.pos.x - p.x, foe.pos.z - p.z);
        // Bots only engage inside 30 m; beyond that they keep pushing and close
        // the distance instead of trading pot-shots across the map.
        if (d > 30 || d >= enemyDist) continue;
        const from = new THREE.Vector3(p.x, p.y + 1.45, p.z);
        const to = new THREE.Vector3(foe.pos.x, foe.pos.y + foe.eye, foe.pos.z);
        if (ctx.canSee(from, to)) { enemy = foe; enemyDist = d; }
      }
        bot.enemy = enemy;
        bot.enemyDist = enemyDist;
      }
      if (enemy) {
        // Foe records are rebuilt every scan, so compare the underlying object.
        if (bot.target !== enemy.obj) { bot.target = enemy.obj; bot.reaction = rng.range(REACTION_MIN, REACTION_MAX); bot.visibleTime = 0; }
        bot.visibleTime += dt;
      } else {
        bot.target = null;
        bot.reaction = 0;
      }

      // --- objective states override movement when the way is clear ---
      if (ctx.charge.planted && bot.team === 'defend' && !enemy) {
        const c = ctx.charge.pos;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < 2.6) {
          bot.state = 'defuse';
          bot.progress += dt;
          bot.group.rotation.y = Math.atan2(-(c.x - p.x), -(c.z - p.z));
          if (bot.progress >= DEFUSE_SECONDS) { bot.progress = 0; ctx.onDefuse(bot); }
          continue;
        }
        if (bot.state !== 'defuse') { setPath(bot, nearestNode(c.x, c.z)); bot.state = 'push'; }
      } else if (!ctx.charge.planted && bot.isCarrier && bot.team === 'attack' && !enemy) {
        const site = world.sites[bot.site];
        const d = Math.hypot(site.center.x - p.x, site.center.z - p.z);
        if (d < site.radius * 0.7) {
          bot.state = 'plant';
          bot.progress += dt;
          if (bot.progress >= PLANT_SECONDS) { bot.progress = 0; ctx.onPlant(bot.site, bot); }
          continue;
        }
      }
      if (bot.state === 'plant' || bot.state === 'defuse') bot.state = 'push';

      // --- retreat at low HP ---
      if (bot.hp < 30 && bot.state !== 'retreat' && !enemy) {
        bot.state = 'retreat';
        const home = bot.team === 'attack' ? 0 : 19;
        setPath(bot, home);
      }
      if (bot.state === 'retreat' && bot.hp > 55) bot.state = 'push';

      // --- engage: strafe and fire in bursts after the reaction delay ---
      if (enemy) {
        bot.state = 'engage';
        bot.strafeTime -= dt;
        if (bot.strafeTime <= 0) { bot.strafeDir *= rng.chance(0.6) ? -1 : 1; bot.strafeTime = rng.range(0.5, 1.4); }
        const epos = enemy.pos;
        const dx = epos.x - p.x;
        const dz = epos.z - p.z;
        bot.yaw = Math.atan2(-dx, -dz);
        bot.group.rotation.y = bot.yaw;
        moveToward(bot, epos.x, epos.z, dt, true);
        if (bot.visibleTime >= bot.reaction) {
          bot.shotGap -= dt;
          if (bot.burstLeft <= 0 && bot.shotGap <= 0) {
            bot.burstLeft = bot.spec.auto ? rng.int(3, 6) : 1;
            bot.burstGap = 0;
          }
          if (bot.burstLeft > 0) {
            bot.burstGap -= dt;
            if (bot.burstGap <= 0) {
              bot.burstGap = bot.spec.gap;
              bot.burstLeft -= 1;
              bot.shotGap = bot.burstLeft <= 0 ? rng.range(0.5, 1.1) : 0;
              // Hit chance falls off with distance; a moving, crouched target is harder.
              const moving = enemy.kind === 'player' ? ctx.player.speed : 2.5;
              let chance = 0.55 - enemyDist * 0.006 - Math.min(0.12, moving * 0.02);
              if (enemy.kind === 'player' && ctx.player.crouching) chance -= 0.08;
              chance = Math.max(0.18, Math.min(0.55, chance));
              const from = new THREE.Vector3(p.x, p.y + 1.45, p.z);
              const to = new THREE.Vector3(epos.x, epos.y + (enemy.kind === 'player' ? 1.3 : 1.2), epos.z);
              ctx.botShoot(bot, from, to);
              if (rng.chance(chance)) {
                const head = rng.chance(0.12);
                const dmg = Math.round(bot.spec.damage * (head ? 2 : 1) * Math.max(0.6, 1 - enemyDist * bot.spec.falloff));
                ctx.damage(enemy, dmg, head ? 'head' : 'torso', bot);
              }
            }
          }
        }
        continue;
      }

      // --- move along the path; hold at the end, scanning ---
      if (bot.state === 'engage') bot.state = 'push';
      if (bot.path.length && bot.pathIndex < bot.path.length) {
        const node = nodes[bot.path[bot.pathIndex]];
        if (moveToward(bot, node.x, node.z, dt, false)) bot.pathIndex += 1;
        if (bot.pathIndex >= bot.path.length) {
          bot.state = 'hold';
          bot.holdTime = rng.range(3, 7);
        }
      } else {
        bot.state = 'hold';
        bot.holdTime -= dt;
        bot.group.rotation.y += Math.sin(ctx.time * 0.5 + bot.id) * 0.002;
        if (bot.holdTime <= 0 && bot.team === 'attack') {
          // Attackers who finished their push rotate to the other site.
          const next = bot.site === 'A' ? 20 : 18;
          bot.site = bot.site === 'A' ? 'B' : 'A';
          setPath(bot, next);
          bot.state = 'push';
        } else if (bot.holdTime <= 0) {
          bot.holdTime = rng.range(3, 7);
          bot.group.rotation.y = rng.range(0, Math.PI * 2);
        }
      }
    }
  }

  function damage(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    let dmg = amount;
    if (bot.armour > 0) {
      const absorbed = Math.min(bot.armour, Math.round(dmg * 0.5));
      bot.armour -= absorbed;
      dmg -= absorbed;
    }
    bot.hp -= dmg;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.fall = 0;
      return true;
    }
    return false;
  }

  return {
    list, hitMeshes, reset, step, damage, nearestNode,
    aliveCount(team) { return list.filter((b) => b.team === team && b.alive).length; },
  };
}
