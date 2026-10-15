import { useEffect, useRef } from 'react';
import L from 'leaflet';

// Vue d'attente avant le chargement de l'index : App cadre ensuite sur les tracés.
const FRANCE = [46.6, 2.5];

// Fonds de carte disponibles. Le premier est le calque par défaut.
const BASEMAPS = [
  ['Plan', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap' }],
  ['Satellite', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: '© Esri, Maxar, Earthstar Geographics' }],
  ['Relief', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' }],
];

export default function MapView({ routes, tracks, hidden, focused, hovered, onSelect, onReady }) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef(new Map());
  // Les calques ne sont créés qu'une fois : sans cette indirection, le clic
  // resterait branché sur le callback du premier rendu.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    // fadeAnimation désactivé : le fondu d'apparition des tuiles peut rester
    // figé à mi-opacité quand le rAF est throttlé, laissant la carte assombrie.
    map.current = L.map(el.current, { zoomControl: false, fadeAnimation: false }).setView(FRANCE, 6);
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);

    // Sélecteur de fond : un calque tuilé par entrée, un seul actif à la fois.
    const bases = BASEMAPS.map(([name, url, opts]) => ({ name, layer: L.tileLayer(url, opts) }));
    bases[0].layer.addTo(map.current);

    const switcher = L.control({ position: 'topleft' });
    switcher.onAdd = () => {
      const box = L.DomUtil.create('div', 'basemap');
      bases.forEach((b, i) => {
        const btn = L.DomUtil.create('button', i === 0 ? 'is-active' : '', box);
        btn.type = 'button';
        btn.textContent = b.name;
        btn.onclick = () => {
          bases.forEach(o => map.current.removeLayer(o.layer));
          b.layer.addTo(map.current);
          box.querySelectorAll('button').forEach(x => x.classList.remove('is-active'));
          btn.classList.add('is-active');
        };
      });
      L.DomEvent.disableClickPropagation(box);
      return box;
    };
    switcher.addTo(map.current);

    // Affiche/masque les points d'étape. Basculé via une classe sur le
    // conteneur plutôt que par ajout/retrait des marqueurs : ça reste
    // indépendant du masquage par tracé, sans toucher aux calques.
    const stopsCtl = L.control({ position: 'topleft' });
    stopsCtl.onAdd = () => {
      const box = L.DomUtil.create('div', 'basemap');
      const btn = L.DomUtil.create('button', 'is-active', box);
      btn.type = 'button';
      btn.textContent = 'Étapes';
      btn.onclick = () => {
        const off = el.current.classList.toggle('stops-hidden');
        btn.classList.toggle('is-active', !off);
      };
      L.DomEvent.disableClickPropagation(box);
      return box;
    };
    stopsCtl.addTo(map.current);

    // Le conteneur peut n'avoir sa taille finale qu'après le premier layout
    // (police web, sidebar, responsive). Sans ça, Leaflet ne charge les tuiles
    // que pour la taille initiale et laisse le reste gris.
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(el.current);

    onReady?.({
      // Ne cadre que ce qui est réellement sur la carte : un tracé masqué ou
      // écarté par le filtre moto ne doit pas élargir la vue à lui tout seul.
      fitAll: () => {
        const b = L.latLngBounds([]);
        layers.current.forEach(l => { if (map.current.hasLayer(l.group)) b.extend(l.bounds); });
        if (b.isValid()) map.current.fitBounds(b, { padding: [40, 40] });
      },
    });
    return () => { ro.disconnect(); map.current.remove(); };
  }, []);

  // Synchronise les calques avec la liste : ajoute les nouveaux, retire les
  // supprimés, laisse les autres en place. Tout redessiner à chaque rendu
  // ferait clignoter la carte et perdrait le cadrage.
  useEffect(() => {
    if (!map.current) return;
    const seen = new Set();

    routes.forEach(r => {
      seen.add(r.id);
      const coords = tracks[r.id];
      if (!coords || layers.current.has(r.id)) return;

      const group = L.layerGroup();
      const halo = L.polyline(coords, { color: '#0B0E12', weight: 4, opacity: 0.35, lineCap: 'round' }).addTo(group);
      const line = L.polyline(coords, {
        color: r.color,
        weight: 2,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);
      line.bindTooltip(`${r.name} · ${r.km.toFixed(1)} km`, { sticky: true, className: 'tip' });

      // Le halo déborde de 1 px de part et d'autre du trait : sans le même
      // gestionnaire, un clic un peu à côté tomberait dans le vide.
      const selectionner = () => onSelectRef.current?.(r.id);
      line.on('click', selectionner);
      halo.on('click', selectionner);

      (r.stops || []).forEach((stop, i) => {
        L.marker(stop, {
          icon: L.divIcon({
            className: '',
            html: `<div class="wp-dot" style="background:${r.color}"></div>`,
            iconSize: [9, 9],
            iconAnchor: [4.5, 4.5],
          }),
        })
          .bindTooltip(`${r.name} — étape ${i + 1}`, { className: 'tip' })
          .on('click', selectionner)
          .addTo(group);
      });

      layers.current.set(r.id, { group, line, bounds: L.latLngBounds(coords) });
    });

    layers.current.forEach((layer, id) => {
      if (seen.has(id)) return;
      map.current.removeLayer(layer.group);
      layers.current.delete(id);
    });
  }, [routes, tracks]);

  useEffect(() => {
    layers.current.forEach((layer, id) => {
      const on = !hidden.has(id);
      const already = map.current.hasLayer(layer.group);
      if (on && !already) layer.group.addTo(map.current);
      if (!on && already) map.current.removeLayer(layer.group);
    });
  }, [hidden, routes, tracks]);

  useEffect(() => {
    layers.current.forEach((layer, id) => {
      layer.line.setStyle({ weight: id === hovered ? 5 : 2 });
    });
  }, [hovered]);

  useEffect(() => {
    const layer = focused && layers.current.get(focused);
    if (layer) map.current.fitBounds(layer.bounds, { padding: [50, 50] });
  }, [focused]);

  return <div className="map" ref={el} />;
}
