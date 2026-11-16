// Feedback effects: tracers, impact particles, smoke, screen shake. All pooled —
// no new objects are made per frame in the hot loop; step() reuses the same
// buffers and hides dead items instead of deleting them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 240;

export function createEffects(scene) {
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true, opacity: 0.9, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const lives = new Float32Array(MAX_PARTICLES);
  let particleCursor = 0;

  const smokes = [];
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  const smokeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.32, depthWrite: false });
  for (let i = 0; i < 2; i += 1) {
    const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0, center: new THREE.Vector3() });
  }

  let shake = 0;
  const shakeOffset = new THREE.Vector3();

  return {
    tracer(from, to) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const attr = t.line.geometry.getAttribute('position');
      attr.setXYZ(0, from.x, from.y, from.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      t.line.visible = true;
      t.line.material.opacity = 0.9;
      t.life = 0.09;
    },
    burst(point, count, rng) {
      for (let n = 0; n < count; n += 1) {
        const i = particleCursor;
        particleCursor = (particleCursor + 1) % MAX_PARTICLES;
        pPos[i * 3] = point.x;
        pPos[i * 3 + 1] = point.y;
        pPos[i * 3 + 2] = point.z;
        velocities[i * 3] = (rng.next() * 2 - 1) * 2.4;
        velocities[i * 3 + 1] = rng.next() * 2.6;
        velocities[i * 3 + 2] = (rng.next() * 2 - 1) * 2.4;
        lives[i] = 0.45 + rng.next() * 0.3;
      }
      pGeo.getAttribute('position').needsUpdate = true;
    },
    addSmoke(center, radius, seconds) {
      const free = smokes.find((s) => s.life <= 0) || smokes[0];
      free.center.copy(center);
      free.mesh.position.copy(center);
      free.mesh.scale.setScalar(radius);
      free.mesh.visible = true;
      free.life = seconds;
    },
    // Bots cannot see through smoke: true when the segment passes inside a live cloud.
    smokeBlocks(a, b) {
      for (const s of smokes) {
        if (s.life <= 0) continue;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const lenSq = abx * abx + aby * aby + abz * abz || 1;
        let t = ((s.center.x - a.x) * abx + (s.center.y - a.y) * aby + (s.center.z - a.z) * abz) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const dx = a.x + abx * t - s.center.x;
        const dy = a.y + aby * t - s.center.y;
        const dz = a.z + abz * t - s.center.z;
        const r = s.mesh.scale.x;
        if (dx * dx + dy * dy + dz * dz < r * r) return true;
      }
      return false;
    },
    addShake(amount) { shake = Math.min(0.06, shake + amount); },
    shakeOffset() { return shakeOffset; },
    step(dt, rng) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
        else t.line.material.opacity = t.life / 0.09 * 0.9;
      }
      let anyAlive = false;
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        if (lives[i] <= 0) continue;
        lives[i] -= dt;
        if (lives[i] <= 0) { pPos[i * 3 + 1] = -50; continue; }
        anyAlive = true;
        velocities[i * 3 + 1] -= 6 * dt;
        pPos[i * 3] += velocities[i * 3] * dt;
        pPos[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        pPos[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        if (pPos[i * 3 + 1] < 0.02) pPos[i * 3 + 1] = 0.02;
      }
      if (anyAlive) pGeo.getAttribute('position').needsUpdate = true;
      for (const s of smokes) {
        if (s.life <= 0) continue;
        s.life -= dt;
        if (s.life <= 0) s.mesh.visible = false;
        else s.mesh.material.opacity = 0.32 * Math.min(1, s.life / 2);
      }
      if (shake > 0) {
        shake = Math.max(0, shake - dt * 0.25);
        shakeOffset.set((rng.next() * 2 - 1) * shake, (rng.next() * 2 - 1) * shake, 0);
      } else shakeOffset.set(0, 0, 0);
    },
  };
}
