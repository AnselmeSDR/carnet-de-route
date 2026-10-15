# Contexte projet

App de visualisation de trajets moto à partir de fichiers GPX exportés de
Liberty Rider. Mono-utilisateur, tourne en local. Pas de déploiement prévu.

**Le dépôt est public.** Les données (`data/`, `gpx-perso/`) sont gitignorées
et ne doivent jamais y entrer, pas plus qu'un lieu, un nom de trajet, un modèle
de moto ou un chiffre tiré de l'archive personnelle. Ce qui est propre à
l'instance locale (témoins de non-régression, état de l'archive) vit dans
`CLAUDE.local.md`, non versionné.

## Décisions d'architecture, et pourquoi

**Le GPX reste un fichier, jamais une ligne de base.** C'est un blob immuable
qu'on ne requête jamais « à l'intérieur ». `data/gpx/<uuid>.gpx` est la source
de vérité et la sauvegarde — ces fichiers ne sont jamais modifiés en place.

**Index JSON, pas SQLite.** Reparser 4 500 points à chaque affichage serait
absurde, d'où `data/index.json` (métadonnées) et `data/tracks.json`
(géométries simplifiées), calculés une fois à l'import. SQLite n'est pas
justifié à ce volume : il le deviendra quand il faudra filtrer (« >150 km, en
2025, dans les Alpes ») ou au-delà de quelques milliers de tracés.
`server/store.js` expose `list / add / rename / remove` — c'est le seul
fichier à réécrire le jour de la bascule. Ne pas laisser fuiter le détail du
stockage dans l'API ou le front.

**API dans un plugin Vite, pas un Express séparé.** Un process, une commande,
cinq dépendances. `vite.config.js` est le seul fichier à reprendre si l'app
doit un jour tourner ailleurs que sur la machine locale.

**Le parsing GPX se fait côté navigateur, pas serveur.** Le serveur reçoit du
JSON déjà résumé et ne fait qu'écrire. Conséquence : pas de multipart, pas de
`multer`. `src/lib/gpx.js` est isomorphe (aucune dépendance, ni DOM ni Node)
pour que `scripts/reindex.js` réutilise exactement le même code — le calcul
doit rester identique quel que soit le chemin d'import.

## Pièges déjà rencontrés

**`%` n'est pas un modulo en JavaScript.** Il garde le signe de l'opérande
gauche : `-350 % 360` vaut `-350`, pas `10`. Ça a faussé le calcul de
sinuosité (182 °/km au lieu de 110) jusqu'à ce que les résultats soient
comparés à une implémentation Python de référence. Le helper `mod()` dans
`src/lib/gpx.js` est là pour ça — ne pas le contourner.

**Toute modification du calcul doit être vérifiée par `npm run reindex`**, qui
recalcule tout : c'est le test de non-régression du pauvre. Les tracés témoins
et le total attendu sont dans `CLAUDE.local.md`.

Les distances sont vérifiables de l'extérieur : Liberty Rider annonce ses
propres chiffres dans `gpx-perso/trajets.csv`, et l'écart attendu est de
**-0,2 %** environ (le tracé du serveur est échantillonné à ~40 m, donc coupe
légèrement les courbes). Un écart qui s'écarterait nettement de ce seuil
signale une régression du calcul, pas une donnée douteuse — mais il varie d'une
période à l'autre sans que le calcul change : les tracés témoins font foi.

## État actuel

Fonctionne : import par glisser-déposer (multi-fichiers), carte Leaflet,
renommage en ligne, cadrage, suppression vers `data/corbeille/` (bouton
« Supprimer » avec `confirm()`), re-téléchargement du GPX d'origine, tri par
date / distance / sinuosité, détection des raccords entre tracés (arrivée de
l'un à moins de 3 km du départ d'un autre).

**Cliquer un tracé sur la carte** amène sa fiche au centre de la liste et la
teinte de sa couleur (`.leg.is-picked`) — indispensable passé quelques dizaines
de trajets. L'état est `{ id, tick }` et non un simple id : recliquer le même
tracé doit ramener la liste dessus, ce qu'un id inchangé ne déclencherait pas.
Le gestionnaire est posé sur le trait, sur son halo (qui déborde de 1 px) et sur
les points d'étape (des `divIcon` qui recouvrent le tracé et avaleraient le clic
sans cela). Comme les calques Leaflet ne sont créés qu'une fois, `onSelect`
passe par une ref, sinon le clic resterait branché sur le callback du premier
rendu.

Chaque tracé affiche sa **moto** sous son titre, sous forme d'étiquette à la
couleur du tracé ; un clic la change (liste des motos connues, « Autre… » pour
une saisie libre, « sans moto » pour effacer). Un sélecteur **Moto** en haut du
panneau filtre la liste et la carte, et recalcule les totaux.

Contrôles de visibilité : chaque tracé a une **checkbox « Affiché »** (l'ancien
bouton « Masquer » texte), plus un bouton global **« Tout afficher / Tout
masquer »** sous la barre de tri. Les deux partagent le même état `hidden`
(un `Set` d'ids dans `App`).

**Le panneau se replie** (bouton « Replier / Déplier » dans l'en-tête, état
`folded` dans `App`, classe `.app.is-folded`). Replié, il ne reste que l'en-tête
— titre, kilomètres, tracés, note du filtre — posé en vignette sur la carte, qui
prend toute la largeur ; sous 860 px, l'en-tête reste en bandeau sous la carte.
Tout est en CSS : le reste du panneau est masqué et non démonté, pour ne pas
redessiner un millier de fiches à chaque dépliage. La largeur de la vignette
(`--folded-w`) sert aussi à décaler les contrôles Leaflet du coin haut-gauche,
qu'elle recouvrirait sinon — changer l'une sans l'autre les superpose.

Contrôles de carte (dans `MapView`, contrôles Leaflet custom stylés comme le
reste, pas la barre Leaflet par défaut) : sélecteur de fond **Plan (OSM) /
Satellite (Esri) / Relief (OpenTopoMap)**, et un toggle **« Étapes »** qui
affiche/masque les points d'étape via une classe `stops-hidden` sur le
conteneur — indépendant du masquage par tracé, sans toucher aux calques.

La carte s'ouvre sur la France entière puis **se cadre sur le gros des tracés**
dès que l'index est chargé (une seule fois, dans `App`, via `fitMain`) : sur
chaque axe, les 5 % de tracés les plus excentrés (`FAR`) sont ignorés, pour
qu'un voyage lointain ne réduise pas la région habituelle à un point. « Tout
cadrer » (`fitAll`) montre tout. Pas de centre codé en dur sur une région : il
trahirait où roule l'auteur.

Le compteur global « roulés » a été retiré de l'en-tête : inutile tant que la
source ne contient que des roadbooks planifiés (`recorded` reste calculé et
sert encore par tracé, cf. « Roulé le… »).

À ~1 000 tracés, `reindex` tourne en ~4 s, la liste se rend en ~1 s et le
filtre répond en ~0,2 s : la bascule vers SQLite n'est pas encore nécessaire.
Les GPX à un seul point (démarrages annulés) sont rejetés par `summarize()` ;
c'est normal et ne coûte aucun kilomètre.

**Piège Leaflet corrigé :** le fondu d'apparition des tuiles
(`fadeAnimation`) peut rester figé à mi-opacité quand le `requestAnimationFrame`
est throttlé (onglet arrière-plan, navigateur headless), laissant la carte
assombrie hors d'un carré central. D'où `fadeAnimation: false` à l'init, plus
un `ResizeObserver` qui appelle `invalidateSize()` quand le conteneur change de
taille (police web, sidebar, responsive) — sans ça les tuiles ne se chargent
que pour la taille initiale.

## Points ouverts

- Aucune déduplication : réimporter le même GPX crée un doublon. Un hash du
  contenu à l'import réglerait ça.
- `data/corbeille/` n'est jamais vidée.
- Tuiles OpenStreetMap : correct pour un usage perso, à revoir au-delà.
- Le dénivelé et les dates ne s'affichent que si le GPX les contient. Les
  roadbooks Liberty Rider n'ont ni `<ele>` ni `<time>` — et **les trajets
  roulés non plus** : l'export serveur ne renvoie que `lat`/`lon` (vérifié sur
  une archive complète). L'hypothèse « les trajets roulés devraient en avoir »
  est donc fausse. Durée, distance et altitude max ne peuvent venir que des
  métadonnées du cache, jamais du GPX.

## La moto d'un trajet

Le GPX ne porte pas la moto : Liberty Rider ne l'écrit pas dans le fichier,
elle n'existe que dans le cache de l'app. Le pont est l'UUID du trajet, que
l'app met en `<metadata><name>` et que `parseGpx()` expose déjà comme
`sourceId` — c'est pour ça que ce champ existait avant d'avoir un usage.

Trois pièces, dans cet ordre :

1. `scripts/motos.js` lit l'export CSV et écrit `data/motos.json`
   (`sourceId -> { nom, moto }`, version 2 ; la version 1 ne rangeait que la
   moto, en chaîne, et reste lue). Table de correspondance seule, jamais lue
   par l'app. Elle porte aussi le **titre** du trajet : sans elle, un tracé
   s'appellerait « 2026-06-07_1355_depart-arrivee ».
2. À l'import — formulaire ou `reindex` — nom et moto sont résolus depuis cette
   table et **recopiés dans `index.json`**. L'index reste la seule source de
   vérité de l'affichage. Un nom égal à l'id est le repli automatique et non un
   choix : `reindex` le remplace par le titre de la table, alors qu'il respecte
   un nom réellement saisi.
3. `PATCH /api/routes/:id` accepte `{ name, vehicle }`. Une moto vide efface
   l'assignation ; c'est le seul moyen de contredire la table.

`reindex` conserve les motos choisies à la main, en distinguant « champ absent »
(tracé indexé avant la table, à deviner) de « valeur nulle » (effacée
volontairement, à laisser tranquille) — d'où le `has()` sur la Map plutôt qu'un
test de vérité. `npm run reindex -- --motos` force la réapplication de la table,
pour le cas où elle arrive après l'import.

Le filtre vit dans `App.jsx` : il calcule `visible`, et la carte reçoit
`hiddenOnMap` = tracés masqués ∪ tracés hors filtre. `MapView` ignore donc
l'existence du filtre. Les totaux de l'en-tête, les raccords, le tri et
« Tout masquer » portent tous sur la sélection courante, pas sur l'index entier.

**Piège des valeurs de `<select>` :** les entrées de service du filtre sont
`toutes` / `sans`, et les motos sont préfixées `moto:<nom>`. Une première
version utilisait une chaîne commençant par un espace comme sentinelle : c'est
invisible à la relecture et un caractère de contrôle s'y était glissé, rendant
le fichier binaire aux yeux de `grep` et de `file`. Ne pas réintroduire de
sentinelle « discrète » : préfixer.

## Source des données

Les GPX viennent d'exports Liberty Rider, ou de toute autre source.
`scripts/importer.js` (`npm run import`) copie un dossier de GPX vers
`data/gpx/` en sautant `data/corbeille/` — un `cp` global ressusciterait les
tracés écartés depuis l'app. `scripts/motos.js` (`npm run motos`) construit
`data/motos.json` à partir d'un CSV `ride_id, nom, vehicule`. **Aucune
dépendance ajoutée** pour ces scripts, et il ne faut pas en ajouter.

## Conventions

Commentaires et libellés d'interface en français. Le code commente le
*pourquoi*, pas le *quoi*. Palette et typographie définies dans
`src/styles.css` — Barlow Condensed pour les titres, IBM Plex Mono pour les
chiffres. Pas de framework CSS.

`CHANGELOG.md` au format Keep a Changelog : chaque changement notable y ajoute
une entrée courte sous `[Unreleased]`, dans le même commit.
