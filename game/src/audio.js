// Synthesised WebAudio effects: no audio files, no network. Every sound is an
// oscillator or a filtered noise burst built at runtime. Created lazily on the
// first user gesture (browsers block audio before that); shot captures never
// create it, so headless runs stay silent and error-free.
export function createAudio() {
  let ctx = null;
  let muted = false;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const len = Math.floor(ctx.sampleRate * 0.25);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (i / len - 0.5) * 2 * (1 - i / len);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function tone(freq, dur, type, gain, slideTo) {
    const c = ensure();
    if (!c || muted) return;
    try {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), c.currentTime + dur);
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(g).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur + 0.02);
    } catch { /* audio is decoration; never break the game */ }
  }

  function noise(dur, gain, filterFreq) {
    const c = ensure();
    if (!c || muted || !noiseBuf) return;
    try {
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      src.connect(filter).connect(g).connect(c.destination);
      src.start();
      src.stop(c.currentTime + dur + 0.02);
    } catch { /* see above */ }
  }

  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    shot(kind) {
      if (kind === 'sniper') { noise(0.22, 0.5, 900); tone(70, 0.18, 'sine', 0.5, 40); }
      else if (kind === 'shotgun') { noise(0.18, 0.55, 1400); tone(90, 0.14, 'sine', 0.45, 45); }
      else if (kind === 'pistol') { noise(0.09, 0.35, 2600); tone(160, 0.07, 'square', 0.12, 90); }
      else { noise(0.11, 0.42, 2000); tone(120, 0.09, 'square', 0.16, 60); }
    },
    enemyShot() { noise(0.1, 0.16, 1600); },
    hit() { tone(1400, 0.05, 'sine', 0.25); },
    kill() { tone(880, 0.09, 'sine', 0.3); setTimeout(() => tone(1320, 0.12, 'sine', 0.25), 70); },
    hurt() { tone(180, 0.16, 'sawtooth', 0.25, 90); },
    reload() { tone(500, 0.05, 'square', 0.12); setTimeout(() => tone(700, 0.05, 'square', 0.12), 160); },
    dryFire() { tone(900, 0.03, 'square', 0.1); },
    beep() { tone(1200, 0.08, 'sine', 0.3); },
    plantDone() { tone(660, 0.12, 'sine', 0.3); setTimeout(() => tone(990, 0.18, 'sine', 0.3), 120); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'sine', 0.28), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'sine', 0.25), i * 130)); },
    buy() { tone(990, 0.06, 'sine', 0.22); },
    denied() { tone(220, 0.12, 'square', 0.18, 160); },
  };
}
