#!/usr/bin/env node
// Reconstruit index.json et tracks.json à partir des fichiers présents dans
// data/gpx/. Utile pour un import en masse : tu copies 300 GPX dans le dossier
// et tu lances `npm run reindex` plutôt que de passer par le formulaire.
// Les noms et les motos déjà donnés dans l'index sont conservés.
//
// --motos : réapplique data/motos.json à tous les tracés, y compris ceux dont
// la moto avait été effacée à la main. Utile quand la table de correspondance
// arrive après l'import. Les titres, eux, sont toujours repris de la table
// quand le tracé n'a pas de nom choisi.

import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize } from '../src/lib/gpx.js';
import { GPX_DIR, INDEX, TRACKS, readJson, writeJson, readMotos } from '../server/store.js';

const forceMotos = process.argv.includes('--motos');

const previous = await readJson(INDEX, { version: 1, routes: [] });
const names = new Map(previous.routes.map(r => [r.id, r.name]));
const dates = new Map(previous.routes.map(r => [r.id, r.importedAt]));
// `has` plutôt que la valeur : une moto effacée à la main vaut null et doit le
// rester, alors qu'un tracé indexé avant l'arrivée de la table n'a pas le champ.
const motosChoisies = new Map(
  previous.routes.filter(r => 'vehicle' in r).map(r => [r.id, r.vehicle])
);
const motos = await readMotos();

await fs.mkdir(GPX_DIR, { recursive: true });
const files = (await fs.readdir(GPX_DIR)).filter(f => /\.gpx$/i.test(f));

const routes = [];
const tracks = {};
let skipped = 0;

for (const file of files) {
  const id = path.basename(file, path.extname(file));
  try {
    const gpx = await fs.readFile(path.join(GPX_DIR, file), 'utf8');
    const { coords, ...meta } = summarize(gpx, file);
    const connu = motos[meta.sourceId] || {};
    // Un nom égal à l'id est le repli automatique, pas un choix de l'utilisateur :
    // il ne doit pas empêcher la table de fournir enfin un titre lisible.
    const nomChoisi = names.get(id) === id ? null : names.get(id);
    routes.push({
      id,
      name: nomChoisi || connu.nom || id,
      filename: file,
      importedAt: dates.get(id) || new Date().toISOString(),
      ...meta,
      vehicle: !forceMotos && motosChoisies.has(id) ? motosChoisies.get(id) : connu.moto || null,
    });
    tracks[id] = coords;
  } catch (err) {
    console.error(`  ✗ ${file} — ${err.message}`);
    skipped++;
  }
}

routes.sort((a, b) => (a.startedAt || a.importedAt).localeCompare(b.startedAt || b.importedAt));
await writeJson(INDEX, { version: 1, routes });
await writeJson(TRACKS, tracks);

const km = routes.reduce((s, r) => s + r.km, 0);
const parMoto = new Map();
for (const r of routes) parMoto.set(r.vehicle, (parMoto.get(r.vehicle) || 0) + 1);
console.log(`${routes.length} tracés indexés — ${km.toFixed(1)} km${skipped ? ` (${skipped} ignorés)` : ''}`);
for (const [moto, n] of [...parMoto].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(moto ?? 'sans moto').padEnd(46)} ${n}`);
}
