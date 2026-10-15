# Carnet de route

Carte des trajets moto, à partir de fichiers GPX — pensée pour les exports de
[Liberty Rider](https://liberty-rider.com), mais n'importe quel GPX fait
l'affaire.

Tous les tracés sur une même carte, avec pour chacun la distance, la
**sinuosité** (°/km) et le nombre de virages marqués ; tri, filtre par moto,
renommage, détection des trajets qui s'enchaînent.

Tout tourne **en local** : les GPX restent sur ta machine, rien n'est envoyé
nulle part en dehors des tuiles de carte.

## Démarrer

Prérequis : **Node 22+**.

```bash
npm install
npm run dev
```

Le navigateur s'ouvre sur `http://localhost:5173`. Dépose tes fichiers GPX dans
le panneau de gauche : ils sont copiés dans `data/gpx/` et l'index se construit
au fil de l'import.

> L'API n'a aucune authentification : elle est faite pour tourner sur ta
> machine. Ne l'expose pas sur un réseau.

### Importer en masse

Copier les fichiers dans `data/gpx/` puis :

```bash
npm run reindex
```

Le script reconstruit l'index à partir du dossier, en conservant les noms et les
motos déjà attribués.

Pour ajouter les fichiers d'un autre dossier sans écraser l'existant ni faire
revenir les tracés supprimés depuis l'app :

```bash
npm run import -- <dossier>
npm run reindex
```

### Titres et motos

Un GPX exporté par Liberty Rider ne porte ni titre lisible ni moto, seulement
l'UUID du trajet (dans `<metadata><name>`). Si tu disposes d'un CSV avec les
colonnes `ride_id`, `nom` et `vehicule`, le carnet peut s'en servir :

```bash
npm run motos -- trajets.csv     # écrit data/motos.json
npm run reindex -- --motos
```

Sans ce fichier, chaque tracé prend le nom de son GPX ; titre et moto se
changent à la main depuis la liste.

## Tes données restent chez toi

Tout ce qui est personnel est gitignoré : `data/` (GPX, index, table des motos)
et `gpx-perso/` (dossier de travail pour tes exports). Rien de tout ça ne doit
être commité.

## Stockage

Trois artefacts, trois rôles distincts.

| Chemin             | Contenu                                          | Rôle |
| ------------------ | ------------------------------------------------ | ---- |
| `data/gpx/<id>.gpx`| Le fichier d'origine, jamais modifié             | Source de vérité, ta sauvegarde |
| `data/index.json`  | Métadonnées calculées (distance, bbox, sinuosité)| Lu au démarrage, alimente la liste |
| `data/tracks.json` | Géométries simplifiées, `id → [[lat, lon], …]`   | Alimente la carte |

Le GPX reste un fichier parce que c'est un blob immuable qu'on ne requête
jamais « à l'intérieur » : le découper en lignes de base coûterait un schéma
sans rien apporter. À l'inverse, reparser 4 500 points à chaque affichage
serait absurde — d'où l'index, calculé une seule fois à l'import.

La simplification (Douglas-Peucker, tolérance ~40 m) divise le nombre de points
par une quinzaine sans différence visible à l'écran. Pour un millier de tracés,
`index.json` pèse ~1 Mo et `tracks.json` ~3 Mo.

Un quatrième fichier, facultatif : `data/motos.json`, table
`sourceId → { nom, moto }` (voir « Titres et motos »). Elle sert au moment de
l'import, puis les valeurs vivent dans l'index.

### Quand passer à SQLite

Pas maintenant. Le basculement se justifie sur deux signaux :

- **on veut filtrer** — « les trajets de plus de 150 km en 2025 dans les
  Alpes ». Écrire ça à la main sur un tableau JSON devient vite pénible ;
- **l'index dépasse quelques milliers d'entrées** — chaque import réécrit
  `index.json` en entier, ce qui reste instantané jusqu'à quelques Mo.

Mesuré sur un millier de tracés : `reindex` complet en ~4 s, liste rendue en
~1 s, filtre appliqué en ~0,2 s.

En dessous, un fichier JSON évite un schéma, des migrations et un driver.
Le jour venu, seul `server/store.js` est à réécrire : l'API et le front ne
connaissent que les quatre fonctions `list / add / rename / remove`.

## Ce que l'app calcule

- **Distance** — Haversine sur les points bruts, avant simplification.
- **Sinuosité** — somme des changements de cap rapportée à la distance,
  en °/km. Échantillonnée pour ne pas confondre le bruit GPS avec des virages.
  C'est la métrique qui distingue un transfert d'autoroute (~60 °/km) d'une
  vraie route à moto (120 °/km et plus).
- **Raccords** — quand l'arrivée d'un tracé tombe à moins de 3 km du départ
  d'un autre, la fiche le signale : pratique pour reconstituer les étapes d'un
  roadtrip.
- **Dénivelé et dates** — seulement si le GPX les contient. Les exports
  Liberty Rider, roadbooks comme trajets roulés, n'ont ni `<ele>` ni `<time>` ;
  d'autres sources (montre, compteur GPS) en ont souvent.

## Architecture

L'API vit dans un plugin du serveur de dev Vite (`vite.config.js`), pas dans
un Express séparé : un process, une commande, cinq dépendances au total.
Le jour où l'app doit tourner ailleurs que sur ta machine, c'est le seul
fichier à reprendre.

```
GET    /api/routes       liste + géométries
POST   /api/routes       import (JSON : filename, gpx, summary)
PATCH  /api/routes/:id   renommer, changer de moto
DELETE /api/routes/:id   retirer (le GPX part dans data/corbeille/)
GET    /api/gpx/:id      re-télécharger l'original
```

Le GPX est parsé dans le navigateur (`src/lib/gpx.js`, sans dépendance) ; le
serveur ne reçoit que du JSON déjà résumé. Le même module sert à
`scripts/reindex.js`, pour que le calcul soit identique quel que soit le chemin
d'import.

## Points restés ouverts

- La suppression déplace le GPX vers `data/corbeille/` plutôt que de
  l'effacer — un fichier que tu ne peux plus réexporter depuis l'app ne doit
  pas disparaître sur un clic malheureux. Rien ne vide cette corbeille pour
  l'instant.
- Aucune déduplication : réimporter deux fois le même GPX crée deux entrées.
  Un hash du contenu à l'import réglerait ça.
- Les tuiles viennent d'OpenStreetMap, Esri et OpenTopoMap. Pour un usage perso
  c'est dans les clous de leur politique d'usage ; au-delà, prévoir un
  fournisseur de tuiles.
