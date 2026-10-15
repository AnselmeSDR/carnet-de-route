import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as store from './server/store.js';

// L'API vit dans le serveur Vite plutôt que dans un Express séparé : un seul
// process, une seule commande, aucune dépendance de plus. Pour un usage perso
// c'est suffisant ; le jour où l'app doit tourner ailleurs que sur ta machine,
// ce fichier est le seul à réécrire.
function api() {
  const routes = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    try {
      if (req.method === 'GET' && url.pathname === '/api/routes') {
        return send(200, await store.list());
      }

      if (req.method === 'POST' && url.pathname === '/api/routes') {
        // Le navigateur a déjà parsé et résumé le GPX : le serveur ne fait
        // qu'écrire. Il reçoit du JSON, pas du multipart — pas de multer.
        const body = JSON.parse(await text(req));
        const saved = await store.add(body);
        return send(201, saved);
      }

      const match = url.pathname.match(/^\/api\/routes\/([\w-]+)$/);
      if (match) {
        const id = match[1];
        if (req.method === 'PATCH') {
          const { name, vehicle } = JSON.parse(await text(req));
          const route = await store.update(id, { name, vehicle });
          return route ? send(200, route) : send(404, { error: 'introuvable' });
        }
        if (req.method === 'DELETE') {
          const ok = await store.remove(id);
          return ok ? send(200, { id }) : send(404, { error: 'introuvable' });
        }
      }

      const dl = url.pathname.match(/^\/api\/gpx\/([\w-]+)$/);
      if (dl && req.method === 'GET') {
        const gpx = await store.readGpx(dl[1]);
        res.setHeader('Content-Type', 'application/gpx+xml');
        res.setHeader('Content-Disposition', `attachment; filename="${dl[1]}.gpx"`);
        return res.end(gpx);
      }

      send(404, { error: 'route inconnue' });
    } catch (err) {
      send(500, { error: err.message });
    }
  };

  const mount = server => {
    server.middlewares.use((req, res, next) =>
      req.url.startsWith('/api/') ? routes(req, res) : next()
    );
  };

  return {
    name: 'carnet-api',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

function text(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      // Un GPX de trajet long tourne autour de 500 ko ; 20 Mo laisse de la
      // marge tout en évitant qu'une requête aberrante remplisse la RAM.
      if (data.length > 20e6) reject(new Error('fichier trop volumineux'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [react(), api()],
  server: { port: 5173, open: true },
});
