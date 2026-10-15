import { useRef, useState } from 'react';
import { summarize } from '../lib/gpx.js';

export default function ImportForm({ onImported }) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState([]);

  async function handle(files) {
    const list = [...files].filter(f => /\.gpx$/i.test(f.name));
    if (!list.length) {
      setErrors(['Aucun fichier .gpx dans la sélection.']);
      return;
    }
    setErrors([]);
    const failed = [];

    for (const [i, file] of list.entries()) {
      setBusy(`${file.name} — ${i + 1}/${list.length}`);
      try {
        const gpx = await file.text();
        // Le parsing se fait ici : le serveur n'a pas à connaître le GPX,
        // et sur un import de 200 fichiers ça évite de le bloquer.
        const summary = summarize(gpx, file.name);
        const res = await fetch('/api/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, gpx, summary }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        onImported(await res.json());
      } catch (err) {
        failed.push(`${file.name} : ${err.message}`);
      }
    }

    setBusy(null);
    setErrors(failed);
    if (input.current) input.current.value = '';
  }

  return (
    <div className="import">
      <div
        className={`drop${drag ? ' is-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files); }}
      >
        <input
          ref={input}
          type="file"
          id="gpx-input"
          accept=".gpx"
          multiple
          onChange={e => handle(e.target.files)}
        />
        <label htmlFor="gpx-input">
          {busy ? `Import de ${busy}` : 'Déposer des GPX ici, ou choisir des fichiers'}
        </label>
      </div>
      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}
