#!/usr/bin/env node
// Copie les GPX récupérés vers data/gpx/, sans ressusciter les supprimés.
//
//   npm run import [-- <dossier-source>]
//
// Un `cp` global ne convient pas : les tracés écartés depuis l'app vivent dans
// data/corbeille/ et reviendraient à chaque mise à jour du carnet. Ici, un
// fichier présent à la corbeille est laissé de côté, et ce qui est déjà indexé
// n'est pas réécrit — la source de vérité reste le fichier déjà en place.

import fs from 'node:fs/promises';
import path from 'node:path';
import { GPX_DIR } from '../server/store.js';

const SOURCE = process.argv[2] || 'gpx-perso/gpx-complets';
const CORBEILLE = path.join(path.dirname(GPX_DIR), 'corbeille');

/** Tous les .gpx d'une arborescence, quelle que soit sa profondeur. */
async function gpxSous(racine) {
  const trouves = [];
  const entrees = await fs.readdir(racine, { withFileTypes: true }).catch(() => null);
  if (!entrees) return trouves;
  for (const e of entrees) {
    const complet = path.join(racine, e.name);
    if (e.isDirectory()) trouves.push(...(await gpxSous(complet)));
    else if (/\.gpx$/i.test(e.name)) trouves.push(complet);
  }
  return trouves;
}

const sources = await gpxSous(SOURCE);
if (!sources.length) {
  console.error(`Aucun .gpx sous ${SOURCE}`);
  console.error('Passe le dossier des GPX en argument : npm run import -- <dossier>');
  process.exit(1);
}

await fs.mkdir(GPX_DIR, { recursive: true });
const corbeille = new Set(
  (await fs.readdir(CORBEILLE).catch(() => [])).filter(f => /\.gpx$/i.test(f))
);

let copies = 0, deja = 0, ecartes = 0;
for (const src of sources) {
  const nom = path.basename(src);
  if (corbeille.has(nom)) { ecartes++; continue; }
  const dst = path.join(GPX_DIR, nom);
  if (await fs.access(dst).then(() => true).catch(() => false)) { deja++; continue; }
  await fs.copyFile(src, dst);
  copies++;
}

console.log(`${copies} nouveaux tracés copiés vers ${GPX_DIR}`);
console.log(`  ${deja} déjà en place`);
if (ecartes) console.log(`  ${ecartes} laissés de côté (à la corbeille du carnet)`);
console.log(copies ? '\nEnsuite : npm run motos && npm run reindex' : '\nRien de neuf, le carnet est à jour.');
