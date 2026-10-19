# Carte visible sur viewport étroit

## Contrat avant correction

Réparation neutre, sans feature Hermes/Superpowers. Siège exclusif lié par
`../BINDING.json`. Composition locale normale de 39ffbf62 avec main 1566ed3e :
merge ort sans conflit. Les deux blobs préférences hors index sont inchangés ;
index a reçu uniquement les ajouts result-sharing lors du merge.

Cause héritée : aside fixe à 400px et fit soustrait toujours 400 à innerWidth.
À 390px, facteur négatif, dimensions CSS invalides et panneau couvrant la carte.
Conserver le bureau ; sous 740px empiler une zone carte et un panneau défilant.
Réutiliser fit, k, ox et oy (dessin et conversion des coordonnées client), en
mesurant le panneau réel. Pas de largeur négative ni carte derrière le panneau.

## RED puis GREEN sur la même recette

`e2e/narrow-map-layout.spec.js` lance son propre serveur loopback éphémère et
Brave, sans backend distant ni trame simulée. Six parcours : 390×844 et 1440×900,
opening:null, JSON tronqué, stratégie désactivée p=123.5 avec hold. Captures avant
assertions et après reload ; vérification visuelle distincte nécessaire. Vrais
clics client calculés depuis la taille intrinsèque du canvas et le cadre serveur,
sélection HUD puis ordre confirmé dans /state. Règles/édition accessibles et
panneau défilant ; continuité token, géométrie planètes, ticks, zéro POST de
remplacement. Aucun matchId inventé (API offline ne l'expose pas).

Driver/config externes, hash SHA256 enregistrés AVANT chaque phase dans
`../evidence/{red,green}` ; toutes sorties, y compris échecs, conservées.
Vérifier check/build/npm test sous Node22.23.3/npm10.9.9 et verrou fixtures,
préférences ciblées et result-sharing offline (clipboard réel + PLAY AGAIN).
Aucune modification guide/trailer/assets/install/auth/provider/serveur ; aucune
installation/chmod des dépendances partagées. Pas de publication. Ce périmètre ne
prouve ni téléphone physique ni support touch complet. Juge indépendant requis
sur le candidat signé exact ; aucune auto-acceptation finale.

## Résultats exécutés

- Merge local signé b84edee6, sans conflit ; préférences composées, non réécrites.
- RED final : 3 échecs 390px (canvas 1200px débordant), 3 succès bureau.
  GREEN : mêmes SHA256 test/config/driver, 6/6 succès (14,4s).
- Tentatives conservées : `red` sans tests (grep ancré erroné), `red-real`
  6 échecs dont 3 causés par quantification des coordonnées client du navigateur.
  Seul le driver de test a alors été corrigé pour inverser les pixels entiers
  réellement envoyés ; `red-final` précède toute correction de production.
- Clics réels avant/après reload : sélection dans HUD, manual=true et destination
  exacte confirmées par état moteur. Token/carte/ticks conservés, aucun POST
  session/play de remplacement ; null, JSON tronqué, p=123.5 désactivé conservés.
- Vision : RED390 panneau sans carte ; GREEN390 après reload carte dessinée,
  sélection et ordre, panneau séparé ; GREEN1440 carte/panneau inchangés.
  Limite visuelle constatée : longues lignes HUD tronquées à390px ; pas de
  prétention de lisibilité exhaustive HUD ni d'arrivée à destination prouvée.
- check/build : succès ; npm test sous verrou : 128 succès, zéro échec/skip.
- Result-sharing ciblé offline natif SSE : 1/1 succès (clipboard réel, résultat
  réel et PLAY AGAIN effaçant le précédent), sans rejouer trailer/backend réel.

Preuves complètes dans le wrapper (logs, traces des échecs, captures, hashes).
Les captures ne prouvent pas seules l'ordre : le test le confirme côté moteur.
