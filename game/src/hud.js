// The DOM HUD: top bar (score, timer, alive counts), health / armour / money,
// ammo, kill feed, charge status, plant progress, the buy menu and every screen
// (title, pause, round end, victory, defeat). It never touches the simulation;
// main.js pushes numbers in and reads callbacks out.
const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'A round-based tactical FPS. Five attackers, five defenders, two sites. Plant the charge or wipe the other team — first to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const hpValue = $('hp-value');
  const armourValue = $('armour-value');
  const moneyValue = $('money-value');
  const scoreA = $('score-a');
  const scoreB = $('score-b');
  const roundLabel = $('round-label');
  const timerValue = $('timer-value');
  const aliveA = $('alive-a');
  const aliveB = $('alive-b');
  const feed = $('killfeed');
  const bomb = $('bomb');
  const bombText = $('bomb-text');
  const bombBar = $('bomb-bar');
  const plant = $('plant');
  const plantLabel = $('plant-label');
  const plantBar = $('plant-bar');
  const buy = $('buy');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const toastEl = $('toast');
  const vignette = $('vignette');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const muteEl = $('mute');
  const phaseEl = $('phase-label');
  let hitTimer = 0;
  let toastTimer = 0;
  let last = {};
  let buyHandler = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setHealth(hp, armour) {
      setText(hpValue, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(armourValue, 'arm', String(Math.max(0, Math.ceil(armour))));
      $('health').classList.toggle('low', hp <= 30);
    },
    setMoney(value) { setText(moneyValue, 'money', `$${value}`); },
    setScore(a, b, round) {
      setText(scoreA, 'sa', String(a));
      setText(scoreB, 'sb', String(b));
      setText(roundLabel, 'round', `ROUND ${Math.max(1, round)} / 9`);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerValue, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      setText(phaseEl, 'phase', phase === 'freeze' ? 'BUY PHASE' : phase === 'play' ? 'ROUND LIVE' : phase === 'roundEnd' ? 'ROUND OVER' : phase);
      $('timer').classList.toggle('danger', phase === 'play' && seconds <= 15);
    },
    setAlive(a, b) {
      setText(aliveA, 'aa', '●'.repeat(a) + '○'.repeat(Math.max(0, 5 - a)));
      setText(aliveB, 'ab', '●'.repeat(b) + '○'.repeat(Math.max(0, 5 - b)));
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = document.createElement('span');
      k.className = killerTeam === 'attack' ? 'att' : 'def';
      k.textContent = killer;
      const v = document.createElement('span');
      v.textContent = ` ${headshot ? '◉ ' : '✕ '}${victim}`;
      row.append(k, v);
      feed.prepend(row);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 6000);
    },
    bombStatus(text, frac) {
      if (!text) { bomb.hidden = true; return; }
      bomb.hidden = false;
      setText(bombText, 'bomb', text);
      bombBar.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
    },
    plantProgress(frac, label) {
      if (frac == null) { plant.hidden = true; return; }
      plant.hidden = false;
      setText(plantLabel, 'plant', label);
      plantBar.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
    },
    toast(text, ms = 2600) {
      toastEl.textContent = text;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.add('flash');
      clearTimeout(vignette._t);
      vignette._t = setTimeout(() => vignette.classList.remove('flash'), 160);
    },
    setCrosshair(spreadPx) {
      crosshair.style.setProperty('--gap', `${spreadPx}px`);
    },
    setMuted(m) { muteEl.hidden = !m; },
    showBuy(items, money) {
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.disabled;
        row.innerHTML = `<kbd>${item.key}</kbd><span class="buy-name">${item.label}</span><span class="buy-price">${item.price === 0 ? 'OWNED' : '$' + item.price}</span>`;
        row.addEventListener('click', () => { if (buyHandler) buyHandler(item.id); });
        buyList.appendChild(row);
      }
      buy.hidden = false;
    },
    hideBuy() { buy.hidden = true; },
    onBuy(handler) { buyHandler = handler; },
    showOverlay(mode, data = {}) {
      if (mode === 'roundEnd') {
        title.textContent = data.playerWon ? 'ROUND WON' : 'ROUND LOST';
        copy.textContent = `${data.reason}. Ember ${data.a} — ${data.b} Warden.`;
        play.textContent = 'Next round';
      } else if (mode === 'matchEnd') {
        title.textContent = data.playerWon ? 'VICTORY — EMBERLINE TAKEN' : 'DEFEAT — WARDENS HOLD';
        copy.textContent = `Final score: Ember ${data.a} — ${data.b} Warden.`;
        play.textContent = 'Play again';
      } else {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
