import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import ImportForm from './components/ImportForm.jsx';
import RouteCard from './components/RouteCard.jsx';
import { findLinks, PALETTE } from './lib/gpx.js';

const nf = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Valeurs du sélecteur. Le nom de la moto est préfixé pour qu'aucun nom réel
// ne puisse se confondre avec les deux entrées de service.
const TOUTES = 'toutes';
const SANS_MOTO = 'sans';
const valeurMoto = nom => `moto:${nom}`;

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [tracks, setTracks] = useState({});
  const [hidden, setHidden] = useState(new Set());
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  // { id, tick } plutôt qu'un simple id : recliquer le même tracé doit
  // ramener la liste dessus, or l'id seul ne changerait pas.
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('date');
  const [moto, setMoto] = useState(TOUTES);
  const [map, setMap] = useState(null);
  const [folded, setFolded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/routes')
      .then(r => r.json())
      .then(({ routes, tracks }) => { setRoutes(routes); setTracks(tracks); })
      .finally(() => setLoading(false));
  }, []);

  // Premier cadrage sur l'ensemble des tracés, une seule fois : la carte ne
  // doit pas sauter à chaque import ou changement de filtre.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || loading || !map) return;
    framed.current = true;
    map.fitAll();
  }, [loading, map]);

  // La couleur suit l'ordre d'import, pas l'ordre d'affichage : trier la liste
  // ne doit pas repeindre la carte sous les yeux de l'utilisateur.
  const colored = useMemo(
    () => routes.map((r, i) => ({ ...r, color: PALETTE[i % PALETTE.length] })),
    [routes]
  );

  // Les motos présentes dans l'index, la plus roulée en tête. Sert au filtre et
  // à la liste de choix des cartes : pas besoin d'une route d'API pour ça.
  const motos = useMemo(() => {
    const parNom = new Map();
    for (const r of colored) {
      if (!r.vehicle) continue;
      const e = parNom.get(r.vehicle) || { nom: r.vehicle, n: 0, km: 0 };
      e.n++;
      e.km += r.km;
      parNom.set(r.vehicle, e);
    }
    return [...parNom.values()].sort((a, b) => b.km - a.km);
  }, [colored]);

  const sansMoto = useMemo(() => colored.filter(r => !r.vehicle).length, [colored]);

  const match = r => {
    if (moto === TOUTES) return true;
    if (moto === SANS_MOTO) return !r.vehicle;
    return !!r.vehicle && valeurMoto(r.vehicle) === moto;
  };
  const visible = useMemo(() => colored.filter(match), [colored, moto]);

  // Les raccords se cherchent parmi les tracés retenus : filtrer sur une moto
  // et se voir proposer l'enchaînement avec un trajet masqué n'aurait pas de sens.
  const links = useMemo(() => findLinks(visible), [visible]);

  const sorted = useMemo(() => {
    const copy = [...visible];
    if (sort === 'km') copy.sort((a, b) => b.km - a.km);
    else if (sort === 'sinuosite') copy.sort((a, b) => b.degPerKm - a.degPerKm);
    else copy.sort((a, b) => (b.startedAt || b.importedAt).localeCompare(a.startedAt || a.importedAt));
    return copy;
  }, [visible, sort]);

  const total = visible.reduce((s, r) => s + r.km, 0);

  // La carte ne connaît qu'un jeu de tracés cachés : le filtre moto s'y ajoute
  // sans que MapView ait à savoir qu'un filtre existe.
  const hiddenOnMap = useMemo(() => {
    const next = new Set(hidden);
    for (const r of colored) if (!match(r)) next.add(r.id);
    return next;
  }, [hidden, colored, moto]);

  const toggle = id => setHidden(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const onImported = ({ route, coords }) => {
    setRoutes(prev => [...prev, route]);
    setTracks(prev => ({ ...prev, [route.id]: coords }));
  };

  const patch = async (id, body) => {
    const res = await fetch(`/api/routes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const updated = await res.json();
      setRoutes(prev => prev.map(r => (r.id === id ? { ...r, ...updated } : r)));
    }
  };

  const selectFromMap = id => setSelected(prev => ({ id, tick: (prev?.tick ?? 0) + 1 }));

  const onRename = (id, name) => patch(id, { name });
  const onSetVehicle = (id, vehicle) => patch(id, { vehicle });

  const onDelete = async id => {
    const res = await fetch(`/api/routes/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    setRoutes(prev => prev.filter(r => r.id !== id));
    setTracks(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  // S'il reste au moins un tracé visible, tout masquer ; sinon, tout réafficher.
  // Ne porte que sur la sélection courante, pour ne pas agir hors du filtre.
  const anyVisible = visible.some(r => !hidden.has(r.id));
  const toggleAll = () => setHidden(prev => {
    const next = new Set(prev);
    for (const r of visible) anyVisible ? next.add(r.id) : next.delete(r.id);
    return next;
  });

  const filtre = moto !== TOUTES;

  return (
    <div className={`app${folded ? ' is-folded' : ''}`}>
      <aside className="panel">
        <div className="panel__head">
          <div className="panel__bar">
            <p className="eyebrow">Carnet de route</p>
            <button className="fold" aria-expanded={!folded} onClick={() => setFolded(f => !f)}>
              {folded ? 'Déplier' : 'Replier'}
            </button>
          </div>
          <h1>{routes.length ? 'Tout ce\nque j\'ai roulé' : 'Rien\nencore'}</h1>
          <div className="totals">
            <div><b>{nf(total)}</b><span>kilomètres</span></div>
            <div><b>{visible.length}</b><span>tracés</span></div>
          </div>
          {filtre && (
            <p className="totals__note">
              sur {nf(colored.reduce((s, r) => s + r.km, 0))} km et {colored.length} tracés au total
            </p>
          )}
        </div>

        <ImportForm onImported={onImported} />

        {(motos.length > 0 || sansMoto > 0) && routes.length > 1 && (
          <div className="moto">
            <label htmlFor="moto-filtre">Moto</label>
            <select id="moto-filtre" value={moto} onChange={e => setMoto(e.target.value)}>
              <option value={TOUTES}>Toutes ({colored.length})</option>
              {motos.map(m => (
                <option key={m.nom} value={valeurMoto(m.nom)}>{m.nom} ({m.n})</option>
              ))}
              {sansMoto > 0 && <option value={SANS_MOTO}>Sans moto ({sansMoto})</option>}
            </select>
          </div>
        )}

        {visible.length > 1 && (
          <div className="sort">
            {[['date', 'Date'], ['km', 'Distance'], ['sinuosite', 'Sinuosité']].map(([k, label]) => (
              <button key={k} className={sort === k ? 'is-on' : ''} onClick={() => setSort(k)}>
                {label}
              </button>
            ))}
          </div>
        )}

        {visible.length > 1 && (
          <div className="bulk">
            <button onClick={toggleAll}>{anyVisible ? 'Tout masquer' : 'Tout afficher'}</button>
          </div>
        )}

        {loading ? (
          <p className="empty">Lecture de l'index…</p>
        ) : routes.length === 0 ? (
          <p className="empty">
            Dépose tes fichiers GPX ci-dessus. Ils sont copiés dans <code>data/gpx/</code>,
            et seules les métadonnées calculées vivent dans l'index.
          </p>
        ) : visible.length === 0 ? (
          <p className="empty">Aucun trajet pour cette moto.</p>
        ) : (
          <ul className="legs">
            {sorted.map(route => (
              <RouteCard
                key={route.id}
                route={route}
                coords={tracks[route.id]}
                links={links[route.id]}
                hidden={hidden.has(route.id)}
                selection={selected?.id === route.id ? selected.tick : null}
                motos={motos}
                onToggle={toggle}
                onFocus={setFocused}
                onHover={setHovered}
                onRename={onRename}
                onSetVehicle={onSetVehicle}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </aside>

      <div className="map-wrap">
        <MapView
          routes={colored}
          tracks={tracks}
          hidden={hiddenOnMap}
          hovered={hovered}
          focused={focused}
          onSelect={selectFromMap}
          onReady={setMap}
        />
        {visible.length > 0 && (
          <button className="fit" onClick={() => map?.fitAll()}>Tout cadrer</button>
        )}
      </div>
    </div>
  );
}
