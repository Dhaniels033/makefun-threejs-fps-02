// Economy: money between rounds, one ledger per side. The player starts on $800;
// kills, round wins/losses and plants all pay, and the buy menu spends it.
// Bots run the same numbers in simulation (see bots.js).
export const ECONOMY = {
  start: 800,
  kill: 300,
  win: 325,
  loss: 150,
  plant: 300,
};

export function createEconomy() {
  let money = ECONOMY.start;
  return {
    get money() { return money; },
    set money(v) { money = Math.max(0, Math.floor(v)); },
    earn(amount) { money += amount; },
    spend(amount) {
      if (money < amount) return false;
      money -= amount;
      return true;
    },
    reset() { money = ECONOMY.start; },
  };
}
