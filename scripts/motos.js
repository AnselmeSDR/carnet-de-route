#!/usr/bin/env node
// Construit data/motos.json, la table sourceId -> { nom, moto }.
//
// Le GPX exporté par Liberty Rider ne dit pas sur quelle moto le trajet a été
// fait : l'info n'existe que dans le cache de l'app. Le pont entre les deux est
// l'UUID du trajet, que l'app écrit en <metadata><name> du GPX et qu'on
// retrouve en colonne `ride_id` de l'export CSV. Le GPX ne porte pas non plus
// de titre lisible : sans cette table, un trajet s'appellerait
// « 2026-06-07_1355_annecy-chamonix » au lieu de « Annecy - Chamonix ».
//
//   node scripts/motos.js [chemin/vers/trajets.csv]
//
// Puis `npm run reindex -- --motos` pour l'appliquer à un index existant.

import fs from 'node:fs/promises';
import path from 'node:path';
import { MOTOS, writeJson } from '../server/store.js';

const CSV = process.argv[2] || 'gpx-perso/trajets.csv';

// Les libellés sans moto réelle : un trajet peut n'en avoir aucune (avant que
// le compte en déclare une), ou pointer une fiche véhicule restée vide.
const AUCUNE = 'sans-vehicule';
const SANS_FICHE = 'vehicule-non-renseigne';

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
function splitCsvLine(line) {
  const out = [];
  let champ = '';
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '"' && line[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') quote = false;
      else champ += c;
    } else if (c === '"') quote = true;
    else if (c === ',') { out.push(champ); champ = ''; }
    else champ += c;
  }
  out.push(champ);
  return out;
}

/** "ROYAL-ENFIELD INTERCEPTOR 650 GT" -> "Royal-Enfield Interceptor 650 GT" */
function lisible(nom) {
  return nom
    .split(' ')
    .map(mot =>
      // Les sigles courts et tout ce qui contient un chiffre restent tels quels :
      // « R 1250 RS » et « GT » ne doivent pas devenir « R 1250 Rs » et « Gt ».
      mot.length <= 3 || /\d/.test(mot)
        ? mot
        : mot
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join('-')
    )
    .join(' ');
}

const brut = await fs.readFile(path.resolve(CSV), 'utf8').catch(() => {
  console.error(`Introuvable : ${CSV}`);
  console.error("Passe le chemin de l'export CSV en argument.");
  process.exit(1);
});

const [entete, ...lignes] = brut.trim().split(/\r?\n/);
const cols = splitCsvLine(entete);
const iRide = cols.indexOf('ride_id');
const iMoto = cols.indexOf('vehicule');
const iNom = cols.indexOf('nom');
if (iRide < 0 || iMoto < 0) {
  console.error(`Colonnes « ride_id » et « vehicule » attendues, trouvé : ${cols.join(', ')}`);
  process.exit(1);
}

const parSource = {};
const compte = new Map();
let avecNom = 0;

for (const ligne of lignes) {
  if (!ligne.trim()) continue;
  const champs = splitCsvLine(ligne);
  const rideId = champs[iRide]?.trim();
  if (!rideId) continue;

  const brutMoto = champs[iMoto]?.trim();
  const moto = !brutMoto || brutMoto === AUCUNE
    ? null
    : brutMoto === SANS_FICHE ? 'Moto sans fiche' : lisible(brutMoto);

  // « Sans nom » est le libellé de repli de l'export : il ne vaut pas mieux
  // que le nom de fichier, autant laisser l'app retomber dessus.
  const titre = iNom >= 0 ? champs[iNom]?.trim() : '';
  const nom = titre && titre !== 'Sans nom' ? titre : null;

  if (!moto && !nom) continue;
  parSource[rideId] = { ...(nom && { nom }), ...(moto && { moto }) };
  if (nom) avecNom++;
  compte.set(moto, (compte.get(moto) || 0) + 1);
}

await writeJson(MOTOS, { version: 2, parSource });

console.log(`${Object.keys(parSource).length} trajets décrits → ${MOTOS}`);
console.log(`  dont ${avecNom} avec un titre lisible`);
for (const [moto, n] of [...compte].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(moto ?? '(aucune moto)').padEnd(46)} ${n}`);
}
