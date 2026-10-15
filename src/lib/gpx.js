// Parsing GPX sans dépendance, utilisable côté navigateur ET côté Node
// (le script de réindexation s'en sert aussi). Le GPX est un XML très plat :
// une extraction par expression régulière est suffisante et évite d'embarquer
// un parseur DOM dans Node.

const PT = /<(trkpt|rtept|wpt)\b[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/\1>)/g;
const CHILD = tag => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);

export function parseGpx(text) {
  const trk = [];
  const rte = [];
  const wpt = [];
  let m;
  PT.lastIndex = 0;
  while ((m = PT.exec(text)) !== null) {
    const [, kind, lat, lon, , inner = ''] = m;
    const pt = { lat: +lat, lon: +lon };
    const ele = inner.match(CHILD('ele'));
    const time = inner.match(CHILD('time'));
    const name = inner.match(CHILD('name'));
    if (ele) pt.ele = +ele[1];
    if (time) pt.time = time[1].trim();
    if (name) pt.name = name[1].trim();
    (kind === 'trkpt' ? trk : kind === 'rtept' ? rte : wpt).push(pt);
  }
  // Liberty Rider met un UUID en <name>. On le garde comme identifiant d'origine
  // mais il ne sert pas de titre lisible.
  const meta = text.match(/<metadata>[\s\S]*?<name>([\s\S]*?)<\/name>/);
  return { sourceId: meta ? meta[1].trim() : null, track: trk, route: rte, waypoints: wpt };
}

const R = 6371.0088;
const rad = d => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a, b) {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// Douglas-Peucker en degrés. tol ≈ 0.0004 ≈ 40 m : invisible à l'écran,
// divise le nombre de points par ~15.
export function simplify(pts, tol = 0.0004) {
  if (pts.length < 3) return pts;
  const perp = (p, a, b) => {
    const dx = b.lon - a.lon;
    const dy = b.lat - a.lat;
    if (dx === 0 && dy === 0) return Math.hypot(p.lon - a.lon, p.lat - a.lat);
    let t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.lon - (a.lon + t * dx), p.lat - (a.lat + t * dy));
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let dMax = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perp(pts[k], pts[i], pts[j]);
      if (d > dMax) { dMax = d; idx = k; }
    }
    if (dMax > tol && idx > 0) {
      keep[idx] = true;
      stack.push([i, idx], [idx, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// `%` en JavaScript est un reste, pas un modulo : il garde le signe de
// l'opérande gauche (-350 % 360 vaut -350, et non 10). Sans ce correctif,
// tout écart de cap inférieur à -180° est compté à l'envers et la sinuosité
// part au plafond.
const mod = (n, d) => ((n % d) + d) % d;

// Sinuosité : somme des changements de cap rapportée à la distance.
// Échantillonné pour ne pas compter le bruit GPS comme des virages.
function sinuosity(pts, km) {
  const step = Math.max(1, Math.floor(pts.length / 1200));
  const s = pts.filter((_, i) => i % step === 0);
  let total = 0;
  let turns = 0;
  for (let i = 0; i < s.length - 2; i++) {
    const b1 = bearing(s[i], s[i + 1]);
    const b2 = bearing(s[i + 1], s[i + 2]);
    const d = Math.abs(mod(b2 - b1 + 180, 360) - 180);
    total += d;
    if (d > 25) turns++;
  }
  return { turns, degPerKm: km ? +(total / km).toFixed(1) : 0 };
}

/** Transforme le texte d'un GPX en métadonnées + géométrie allégée. */
export function summarize(text, filename) {
  const { sourceId, track, route, waypoints } = parseGpx(text);
  const pts = track.length ? track : route;
  if (pts.length < 2) throw new Error(`${filename} : aucun tracé exploitable`);

  let km = 0;
  for (let i = 0; i < pts.length - 1; i++) km += haversine(pts[i], pts[i + 1]);

  let gain = 0;
  const withEle = pts.filter(p => p.ele !== undefined);
  for (let i = 0; i < withEle.length - 1; i++) {
    const d = withEle[i + 1].ele - withEle[i].ele;
    if (d > 0) gain += d;
  }

  const times = pts.filter(p => p.time).map(p => p.time);
  const lats = pts.map(p => p.lat);
  const lons = pts.map(p => p.lon);
  const { turns, degPerKm } = sinuosity(pts, km);

  return {
    sourceId,
    km: +km.toFixed(1),
    points: pts.length,
    waypoints: (route.length ? route : waypoints).length,
    turns,
    degPerKm,
    elevationGain: withEle.length ? Math.round(gain) : null,
    startedAt: times.length ? times[0] : null,
    endedAt: times.length ? times[times.length - 1] : null,
    recorded: times.length > 0, // trajet roulé vs itinéraire planifié
    start: [+pts[0].lat.toFixed(5), +pts[0].lon.toFixed(5)],
    end: [+pts.at(-1).lat.toFixed(5), +pts.at(-1).lon.toFixed(5)],
    bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
    coords: simplify(pts).map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5)]),
    stops: (route.length ? route : waypoints).map(p => [
      +p.lat.toFixed(5),
      +p.lon.toFixed(5),
    ]),
  };
}

/** Deux tracés se raccordent si la fin de l'un touche le départ de l'autre. */
export function findLinks(routes, maxKm = 3) {
  const at = ([lat, lon]) => ({ lat, lon });
  const links = {};
  for (const a of routes) {
    links[a.id] = [];
    for (const b of routes) {
      if (a.id === b.id) continue;
      const d = haversine(at(a.end), at(b.start));
      if (d < maxKm) links[a.id].push({ id: b.id, name: b.name, km: +d.toFixed(1) });
    }
  }
  return links;
}

export const PALETTE = [
  '#E8532B', '#1F6FB2', '#12876F', '#8A46A8',
  '#C9A227', '#D2456F', '#3F8FA8', '#7A8C3B',
];
