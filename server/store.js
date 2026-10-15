import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Trois artefacts, trois rôles :
//   data/gpx/<id>.gpx  — le fichier d'origine, jamais modifié. Source de vérité.
//   data/index.json    — métadonnées calculées. Lu à chaque démarrage, petit.
//   data/tracks.json   — géométries simplifiées, id -> [[lat,lon], ...].
//                        Séparé de l'index pour que la liste reste légère.
//   data/motos.json    — sourceId -> { nom, moto }. Table de correspondance
//                        seule : les valeurs retenues vivent dans l'index.
const ROOT = path.resolve(process.cwd(), 'data');
const GPX_DIR = path.join(ROOT, 'gpx');
const INDEX = path.join(ROOT, 'index.json');
const TRACKS = path.join(ROOT, 'tracks.json');
const MOTOS = path.join(ROOT, 'motos.json');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Écriture atomique : on écrit à côté puis on renomme. Sans ça, une coupure
// pendant la réécriture de l'index laisse un JSON tronqué et l'app ne
// redémarre plus.
async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

// Le GPX ne dit ni la moto ni un titre lisible : Liberty Rider garde les deux
// dans le cache de son app et n'écrit dans le fichier que l'UUID du trajet, en
// <metadata><name>, que parseGpx() expose comme sourceId. Table absente = rien
// n'est deviné, ça n'échoue pas.
export async function readMotos() {
  const { parSource } = await readJson(MOTOS, { parSource: {} });
  const table = {};
  for (const [source, valeur] of Object.entries(parSource || {})) {
    // v1 rangeait la moto seule, en chaîne ; v2 range { nom, moto }.
    table[source] = typeof valeur === 'string' ? { moto: valeur } : valeur;
  }
  return table;
}

export async function init() {
  await fs.mkdir(GPX_DIR, { recursive: true });
}

export async function list() {
  const index = await readJson(INDEX, { version: 1, routes: [] });
  const tracks = await readJson(TRACKS, {});
  return { routes: index.routes, tracks };
}

export async function add({ name, filename, gpx, summary, vehicle }) {
  await init();
  const id = randomUUID();
  const { coords, ...meta } = summary;

  await fs.writeFile(path.join(GPX_DIR, `${id}.gpx`), gpx);

  const connu = (await readMotos())[meta.sourceId] || {};
  const index = await readJson(INDEX, { version: 1, routes: [] });
  const record = {
    id,
    name: name?.trim() || connu.nom || filename.replace(/\.gpx$/i, ''),
    filename,
    importedAt: new Date().toISOString(),
    ...meta,
    vehicle: vehicle?.trim() || connu.moto || null,
  };
  index.routes.push(record);
  await writeJson(INDEX, index);

  const tracks = await readJson(TRACKS, {});
  tracks[id] = coords;
  await writeJson(TRACKS, tracks);

  return { route: record, coords };
}

// Le PATCH porte le nom, la moto, ou les deux. Une moto vide efface
// l'assignation ; c'est le seul moyen de contredire la table de correspondance.
export async function update(id, { name, vehicle }) {
  const index = await readJson(INDEX, { version: 1, routes: [] });
  const route = index.routes.find(r => r.id === id);
  if (!route) return null;
  if (typeof name === 'string' && name.trim()) route.name = name.trim();
  if (vehicle !== undefined) route.vehicle = vehicle?.trim() || null;
  await writeJson(INDEX, index);
  return route;
}

export async function remove(id) {
  const index = await readJson(INDEX, { version: 1, routes: [] });
  const before = index.routes.length;
  index.routes = index.routes.filter(r => r.id !== id);
  if (index.routes.length === before) return false;
  await writeJson(INDEX, index);

  const tracks = await readJson(TRACKS, {});
  delete tracks[id];
  await writeJson(TRACKS, tracks);

  // Le GPX d'origine part à la corbeille plutôt qu'à la poubelle : un clic
  // malheureux ne doit pas détruire un fichier qu'on ne peut plus réexporter.
  const trash = path.join(ROOT, 'corbeille');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(path.join(GPX_DIR, `${id}.gpx`), path.join(trash, `${id}.gpx`))
    .catch(() => {});
  return true;
}

export async function readGpx(id) {
  return fs.readFile(path.join(GPX_DIR, `${id}.gpx`), 'utf8');
}

export { GPX_DIR, INDEX, TRACKS, MOTOS, readJson, writeJson };
