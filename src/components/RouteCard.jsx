import { useEffect, useRef, useState } from 'react';

const nf = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Vignette : la géométrie réelle du tracé, normalisée. Deux trajets ne
// produisent jamais la même forme, ça sert d'identifiant visuel dans la liste.
function shape(coords, w = 84, h = 52, pad = 6) {
  if (!coords?.length) return null;
  const k = Math.cos((coords[0][0] * Math.PI) / 180);
  const pts = coords.map(([lat, lon]) => [lon * k, lat]);
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((w - 2 * pad) / (x1 - x0 || 1e-9), (h - 2 * pad) / (y1 - y0 || 1e-9));
  const ox = (w - (x1 - x0) * s) / 2;
  const oy = (h - (y1 - y0) * s) / 2;
  const P = pts.map(p => [(p[0] - x0) * s + ox, h - ((p[1] - y0) * s + oy)]);
  return {
    d: P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
    a: P[0],
    b: P.at(-1),
    w,
    h,
  };
}

// Valeur de service du choix de moto : ne peut pas être un nom saisi.
const AUTRE = 'autre:';

export default function RouteCard({ route, coords, links, hidden, motos = [], selection = null, onToggle, onFocus, onHover, onRename, onSetVehicle, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editingMoto, setEditingMoto] = useState(false);
  const [draft, setDraft] = useState(route.name);
  const g = shape(coords);
  const li = useRef(null);

  // Sur près de mille tracés, retrouver la fiche du trait qu'on vient de
  // cliquer sur la carte à la main n'est pas tenable : on l'amène à l'écran.
  useEffect(() => {
    if (selection === null) return;
    li.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selection]);

  // La moto de ce tracé peut ne plus figurer dans l'index (dernier trajet à
  // l'avoir portée) : on l'ajoute au choix pour ne pas la perdre en éditant.
  const choix = motos.some(m => m.nom === route.vehicle) || !route.vehicle
    ? motos.map(m => m.nom)
    : [route.vehicle, ...motos.map(m => m.nom)];

  const changeMoto = valeur => {
    setEditingMoto(false);
    if (valeur === AUTRE) {
      const saisie = prompt('Nom de la moto ?', route.vehicle || '');
      if (saisie?.trim() && saisie.trim() !== route.vehicle) onSetVehicle(route.id, saisie.trim());
      return;
    }
    if ((valeur || null) !== (route.vehicle || null)) onSetVehicle(route.id, valeur);
  };

  const submit = () => {
    setEditing(false);
    if (draft.trim() && draft !== route.name) onRename(route.id, draft);
    else setDraft(route.name);
  };

  return (
    <li
      ref={li}
      className={`leg${hidden ? ' is-off' : ' is-on'}${selection !== null ? ' is-picked' : ''}`}
      style={{ '--c': route.color }}
      onMouseEnter={() => onHover(route.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="leg__top">
        {editing ? (
          <input
            className="leg__edit"
            value={draft}
            autoFocus
            onChange={e => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={e => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') { setDraft(route.name); setEditing(false); }
            }}
          />
        ) : (
          <button className="leg__name" onClick={() => setEditing(true)} title="Renommer">
            {route.name}
          </button>
        )}
        <span className="leg__km">{nf(route.km)} km</span>
      </div>

      {editingMoto ? (
        <select
          className="leg__moto-edit"
          autoFocus
          value={route.vehicle || ''}
          onChange={e => changeMoto(e.target.value)}
          onBlur={() => setEditingMoto(false)}
        >
          <option value="">— sans moto —</option>
          {choix.map(nom => <option key={nom} value={nom}>{nom}</option>)}
          <option value={AUTRE}>Autre…</option>
        </select>
      ) : (
        <button
          className={`leg__moto${route.vehicle ? '' : ' is-empty'}`}
          onClick={() => setEditingMoto(true)}
          title="Changer de moto"
        >
          {route.vehicle || 'Sans moto'}
        </button>
      )}

      <div className="leg__body">
        {g && (
          <svg className="thumb" viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden="true">
            <path d={g.d} />
            <circle cx={g.a[0]} cy={g.a[1]} r="2.6" />
            <circle cx={g.b[0]} cy={g.b[1]} r="2.6" />
          </svg>
        )}
        <div className="stats">
          <div className="stat"><span>Virages marqués</span><b>{route.turns}</b></div>
          <div className="stat"><span>Sinuosité</span><b>{nf(route.degPerKm)} °/km</b></div>
          {route.elevationGain != null && (
            <div className="stat"><span>Dénivelé +</span><b>{route.elevationGain} m</b></div>
          )}
          {route.startedAt && (
            <div className="stat">
              <span>Roulé le</span>
              <b>{new Date(route.startedAt).toLocaleDateString('fr-FR')}</b>
            </div>
          )}
          <div className="gauge" style={{ '--v': Math.min(1, route.degPerKm / 130) }}><i /></div>
        </div>
      </div>

      {links?.length > 0 && (
        <p className="link">
          Arrivée à {nf(links[0].km)} km du départ de « {links[0].name} »
        </p>
      )}

      <div className="leg__acts">
        <label className="leg__show">
          <input type="checkbox" checked={!hidden} onChange={() => onToggle(route.id)} />
          Affiché
        </label>
        <button onClick={() => onFocus(route.id)}>Cadrer</button>
        <a href={`/api/gpx/${route.id}`} download>GPX</a>
        <button
          className="danger"
          onClick={() => { if (confirm(`Supprimer « ${route.name} » ?`)) onDelete(route.id); }}
        >
          Supprimer
        </button>
      </div>
    </li>
  );
}
