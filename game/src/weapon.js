// Weapons: one catalogue, one view model. The numbers live here; main.js owns the
// ray and the damage. First-shot accuracy, recoil that climbs then recovers, and
// spread that punishes moving are all in spread() and the recoil pattern below.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// id: [price, damage, headshot x, fire gap s, auto, mag, reserve, reload s,
//      spread still, spread moving, recoil pitch, falloff per metre]
export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', price: 0, damage: 26, headMult: 2, gap: 0.16, auto: false, mag: 12, reserve: 48, reload: 1.4, spreadStill: 0.004, spreadMove: 0.03, recoil: 0.011, falloff: 0.004 },
  shotgun: { name: 'M870 Breacher', price: 700, damage: 13, headMult: 2, gap: 0.85, auto: false, mag: 6, reserve: 24, reload: 2.4, spreadStill: 0.02, spreadMove: 0.05, recoil: 0.03, falloff: 0.012, pellets: 7 },
  smg: { name: 'VK-9 Rattler', price: 1200, damage: 22, headMult: 2, gap: 0.075, auto: true, mag: 32, reserve: 96, reload: 1.7, spreadStill: 0.006, spreadMove: 0.034, recoil: 0.008, falloff: 0.008 },
  rifle: { name: 'AR-77 Ember', price: 2000, damage: 34, headMult: 2, gap: 0.096, auto: true, mag: 30, reserve: 90, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.009, falloff: 0.005 },
  sniper: { name: 'LW-50 Longshot', price: 3500, damage: 95, headMult: 2, gap: 1.15, auto: false, mag: 5, reserve: 15, reload: 2.8, spreadStill: 0.0008, spreadMove: 0.06, recoil: 0.05, falloff: 0.001 },
};

export const BUY_ITEMS = [
  { key: '1', id: 'rifle', label: 'AR-77 Ember rifle' },
  { key: '2', id: 'smg', label: 'VK-9 Rattler SMG' },
  { key: '3', id: 'sniper', label: 'LW-50 Longshot sniper' },
  { key: '4', id: 'shotgun', label: 'M870 Breacher shotgun' },
  { key: '5', id: 'pistol', label: 'P9 Sidearm (owned)' },
  { key: '6', id: 'armour', label: 'Kevlar armour' },
  { key: '7', id: 'smoke', label: 'Smoke grenade' },
];

export const PRICES = { armour: 400, smoke: 250 };

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  model.position.set(0.32, -0.3, -0.9);
  model.scale.setScalar(0.5);
  model.rotation.y = 0.08;
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.32, -0.28, -1.35);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.32, -0.26, -1.0);
  camera.add(flashLight);

  let currentId = 'pistol';
  let spec = WEAPONS.pistol;
  const state = { mag: spec.mag, reserve: spec.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, shotsFired: 0 };

  function buildModel(id) {
    while (model.children.length) model.remove(model.children[0]);
    const long = id === 'rifle' || id === 'sniper';
    const wide = id === 'shotgun';
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(wide ? 0.11 : 0.09, 0.1, long ? 0.5 : 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, long ? 0.5 : 0.3), grip);
    barrel.position.set(0, 0.025, long ? -0.46 : -0.3);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), grip);
    stock.position.set(0, -0.02, 0.26);
    model.add(receiver, barrel, stock);
    if (id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), accent);
      scope.position.set(0, 0.09, -0.05);
      model.add(scope);
    }
    if (id === 'shotgun') {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.2), accent);
      pump.position.set(0, -0.02, -0.28);
      model.add(pump);
    }
    if (id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), accent);
      mag.position.set(0, -0.12, 0.02);
      model.add(mag);
    }
  }
  buildModel('pistol');

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.9 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (spec.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const take = Math.min(spec.mag - state.mag, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    get id() { return currentId; },
    get spec() { return spec; },
    equip(id) {
      if (!WEAPONS[id]) return false;
      currentId = id;
      spec = WEAPONS[id];
      state.mag = spec.mag;
      state.reserve = spec.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.shotsFired = 0;
      buildModel(id);
      return true;
    },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = spec.gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.shotsFired += 1;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === spec.mag || state.reserve === 0) return;
      state.reloadLeft = spec.reload;
    },
    // Spread: still + moving + a recoil bloom that grows with consecutive shots
    // and recovers when the trigger is released. Stopping to aim pays.
    spread(speed, walking) {
      const move = Math.min(1, speed / 5.2);
      const bloom = Math.min(1, state.shotsFired / 8) * 0.012;
      const base = spec.spreadStill + move * spec.spreadMove + bloom;
      return walking ? base * 0.55 : base;
    },
    recover() {
      state.shotsFired = 0;
    },
    // Deterministic recoil pattern: pitch climbs, yaw wanders left/right by shot index.
    recoilFor(index) {
      const pitch = spec.recoil * (1 + Math.min(4, index) * 0.12);
      const yaw = spec.recoil * 0.45 * Math.sin(index * 2.4);
      return { pitch, yaw };
    },
  };
}
