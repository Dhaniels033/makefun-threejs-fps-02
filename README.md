# Emberline — Tactical Three.js FPS

[![make.fun](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Dhaniels033/makefun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Dhaniels033/makefun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02)

> **Note:** `Dhaniels033/makefun-threejs-fps-02` in the rank/reward badge URLs above is a
> placeholder — this entry has not been pushed to GitHub yet. Replace it with the
> real owner and repository name after the public repo is created.

An entry for [make.fun's threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02):
a complete original round-based tactical FPS in the Counter-Strike style — never a
copy. It plays offline in desktop Chrome, single-player against bots, with no
network requests. three.js 0.187.0 is vendored byte for byte from the kit.

## The game

Two teams of five, short rounds won by eliminating the other team or by the
objective. Between rounds, money buys weapons and gear. Gunfire rewards accuracy
over speed: first-shot accuracy, recoil, movement spread and headshots.

- **Map:** original two-site map ("Emberline") — A site (west), B site (east),
  mid with a wall and doors, flank lanes, crates, pillars and low walls for
  cover, plus floating A/B letters and coloured site pads so each site reads
  at a glance. 52 × 44 m, dusk lighting.
- **Rounds:** first to 5 round wins (win by 2, max 9 rounds); 100-second round
  timer; 5 s freeze/buy phase, then play, then a round-end screen.
- **Economy:** $800 start, +$300 per kill, +$325 round win / +$150 round loss,
  +$300 plant bonus. Buy menu (**B**) in the freeze phase: rifle $2000, SMG
  $1200, sniper $3500, shotgun $700, pistol owned, Kevlar $400, smoke $250 —
  keys 1–7 or click. Bots buy from the same economy every round.
- **Objective:** you carry the charge — hold **E** 3 s to plant at A or B,
  35 s fuse, then defend it; if you fall, a teammate bot takes the charge and
  plants. Defenders hold **E** 5 s to defuse. Plant/defuse progress bar, fuse
  bar and site callouts in the HUD.
- **Bots:** 4 teammates + 5 enemies on a 27-node waypoint graph (BFS paths),
  patrol / push / hold / engage / retreat states, line-of-sight raycasts,
  350–600 ms reaction delay, accuracy that falls off with distance, strafing,
  retreat at low HP, and a smoke grenade (**G**) that blocks their sight.
- **Gunfeel:** 5 weapons with distinct damage, fire rate, magazine and recoil
  patterns; first-shot accuracy, recoil bloom and recovery, movement spread,
  headshots ×2, armour that absorbs half, tracers, hit markers, kill feed,
  impact particles, screen shake and synthesised WebAudio effects (**M** mutes).
- **Screens:** title, buy phase, pause (**P**), round end, match victory /
  defeat — all with start/restart. Seeded RNG (`?seed=`, `?shot=` scenes) so
  matches and screenshots are deterministic; no `Math.random` in gameplay.
- **Verified headless:** zero console errors; a full match plays (buy → round
  → plant → fuse detonation → round end → 5–0 victory); player fire, bot
  combat, economy and the buy menu all confirmed in Chrome for Testing 157.

## Controls

| Input | Action |
|---|---|
| WASD / arrow keys | Move |
| Mouse | Aim |
| Left click | Shoot |
| R | Reload |
| B | Buy menu (between rounds) |
| E (hold) | Plant the charge (in a site) |
| G | Throw smoke grenade |
| Shift | Walk (accurate) |
| P / Esc | Pause |
| M | Mute |

## Play it

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

or serve `game/` with any static server and open `index.html`. No build step,
no dependencies, no network.

## Screenshots

`screenshots/` holds 4 real renders of the game taken in headless Chromium
from the game's own `?shot=` scenes (`shots.json`): title, play, buy phase and
round end — each 1280×720 JPEG, ≤256 KiB, visually inspected.

## Files

- `main.ts` — copies `game/` + `screenshots/` to `/output` and writes
  `/output/dossier.json` via `vendor/makefun-threejs.ts` (Node 22, stdlib only).
- `game/index.html`, `game/src/*.js` — the game.
- `game/vendor/three/` — three.js 0.187.0, byte for byte from the kit.
- `screenshots/` — 3–4 JPEG screenshots (≤256 KiB each, long side ≤1280).
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.
- `LICENSE` — MIT.

## License

MIT — see [LICENSE](LICENSE).
