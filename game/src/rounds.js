// The match: rounds, phases, the charge and the score. First to 5, win by 2,
// max 9 rounds; 100 s a round, 35 s fuse. A round is won by elimination, by the
// charge detonating, by a defuse, or by the defenders surviving the clock.
// main.js drives the timer; this module owns the rules and the transitions.
export const MATCH = {
  winScore: 5,
  maxRounds: 9,
  roundSeconds: 100,
  freezeSeconds: 5,
  roundEndSeconds: 5,
  fuseSeconds: 35,
};

export function createMatch(events) {
  const state = {
    phase: 'title', // title | freeze | play | roundEnd | matchEnd
    round: 0,
    scoreAttack: 0,
    scoreDefend: 0,
    timer: 0,
    charge: { planted: false, site: null, pos: null, fuse: 0 },
    lastReason: '',
    winner: null,
  };

  function matchOver() {
    const lead = Math.abs(state.scoreAttack - state.scoreDefend);
    if ((state.scoreAttack >= MATCH.winScore || state.scoreDefend >= MATCH.winScore) && lead >= 2) return true;
    return state.round >= MATCH.maxRounds;
  }

  function startMatch() {
    state.scoreAttack = 0;
    state.scoreDefend = 0;
    state.round = 0;
    state.winner = null;
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'freeze';
    state.timer = MATCH.freezeSeconds;
    state.charge = { planted: false, site: null, pos: null, fuse: 0 };
    state.lastReason = '';
    events.onRoundStart(state.round);
  }

  function endRound(winner, reason) {
    if (state.phase !== 'play' && state.phase !== 'freeze') return;
    if (winner === 'attack') state.scoreAttack += 1;
    else state.scoreDefend += 1;
    state.lastReason = reason;
    state.phase = 'roundEnd';
    state.timer = MATCH.roundEndSeconds;
    events.onRoundEnd(winner, reason, state.scoreAttack, state.scoreDefend);
  }

  function step(dt, aliveAttack, aliveDefend) {
    if (state.phase === 'freeze') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'play';
        state.timer = MATCH.roundSeconds;
        events.onPlayStart();
      }
      return;
    }
    if (state.phase === 'play') {
      if (state.charge.planted) {
        state.charge.fuse -= dt;
        if (state.charge.fuse <= 0) {
          events.onExplode(state.charge.site);
          endRound('attack', 'Charge detonated');
          return;
        }
      } else {
        state.timer -= dt;
        if (state.timer <= 0) {
          endRound('defend', 'Time expired — site held');
          return;
        }
      }
      if (aliveAttack === 0 && aliveDefend > 0) { endRound('defend', 'Team eliminated'); return; }
      if (aliveDefend === 0 && aliveAttack > 0) { endRound('attack', 'Team eliminated'); return; }
      if (aliveAttack === 0 && aliveDefend === 0) { endRound('defend', 'Team eliminated'); }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) {
        if (matchOver()) {
          state.phase = 'matchEnd';
          state.winner = state.scoreAttack > state.scoreDefend ? 'attack' : 'defend';
          events.onMatchEnd(state.winner, state.scoreAttack, state.scoreDefend);
        } else {
          startRound();
        }
      }
    }
  }

  return {
    state, startMatch, startRound, endRound, step, matchOver,
    plant(site, pos) {
      if (state.phase !== 'play' || state.charge.planted) return false;
      state.charge = { planted: true, site, pos, fuse: MATCH.fuseSeconds };
      events.onPlant(site);
      return true;
    },
    defuse() {
      if (!state.charge.planted) return false;
      state.charge = { planted: false, site: null, pos: null, fuse: 0 };
      endRound('defend', 'Charge defused');
      return true;
    },
  };
}
