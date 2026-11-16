// Emberline hand-in: assemble the entry in the output folder and
// describe it with the kit dossier library. Node 22, standard library
// only. Nothing here touches the network, the clock, or any randomness,
// so two runs over the same repository produce the same bytes.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

// Everything we copy lives next to this file, wherever the command
// was launched from, so the paths below are anchored to it.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// The grader hands us /output; a local run may point somewhere else
// through the environment instead.
const outDir =
  process.env.MAKEFUN_OUTPUT_DIR !== undefined &&
  process.env.MAKEFUN_OUTPUT_DIR !== ""
    ? resolve(process.env.MAKEFUN_OUTPUT_DIR)
    : "/output";

function startClean(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { force: true, recursive: true });
  }
  mkdirSync(dir, { recursive: true });
}

function copyFolder(name: string): void {
  cpSync(join(repoRoot, name), join(outDir, name), { recursive: true });
}

// The caps the competition's gate publishes for this dossier.
const dossierLimits = {
  game_max_bytes: 50331648,
  game_max_files: 993,
  screenshots: {
    max: 4,
    max_bytes: 262144,
  },
  text_max_bytes: 163840,
};

startClean(outDir);
copyFolder("game");
copyFolder("screenshots");

const dossier = buildDossier(outDir, dossierLimits);
writeFileSync(join(outDir, "dossier.json"), dossier);

console.log(`Wrote ${join(outDir, "dossier.json")} (${dossier.length} bytes)`);
