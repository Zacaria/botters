# Botters — reprendre le travail

Dernière mise à jour : 8 novembre 2026. Cette note est un point de départ, pas une preuve de l'état courant : vérifier Git, les travaux actifs et le déploiement avant chaque intervention.

## Point de départ

- Dépôt canonique : `/home/hermes/repos/botters`, remote `Zacaria/botters`, branche principale `master`.
- PR #32 fusionnée dans `master` au commit `de49b0e` : trajet manuel d'essaim, outil MCP associé, couverture de non-régression et protection des mutations liées à une partie. La CI de la PR a réussi sur son dernier commit. Le fonctionnement de cette version en production n'a pas été vérifié dans cette conversation.
- Le trajet se dessine après sélection avec **Maj + glisser**, puis s'envoie au relâchement de la souris. Pas d'Entrée ni de points numérotés. Il ne dispose pas encore d'alternative clavier seul ou tactile. Contrat et limites : [prototype de trajet](specs/route-prototype-fr.md).
- La revue visuelle Sol a validé le prototype local à la souris ; elle ne prouve ni plaisir de jeu ni équilibrage PvP. Les tests ne démontrent pas la valeur stratégique de l'agent.
- Les clients historiques qui omettent l'identité de partie restent compatibles, mais une commande périmée peut encore viser la partie courante. Ne pas présenter cette compatibilité comme une protection complète : [contrat d'identité](contributions/match-mutation-identity.md).

## Intention produit

Botters est un jeu de stratégie spatiale en temps réel **avec son agent**. Le joueur choisit sa doctrine et intervient quand il le souhaite ; l'agent organise et adapte les moyens sans transformer le joueur en spectateur. L'initiation solo peut enseigner les bases sans rendre l'agent périphérique. L'initiative, la diversion et le tempo sont des résultats possibles des règles, pas des jauges ou des boutons à imposer.

Le [brouillon de vision stratégique](specs/strategic-initiative-fr.md) conserve les décisions et pistes discutées, y compris trois structures alternatives. **Ces structures ne sont pas des fonctionnalités sélectionnées.** Le trajet intégré constitue un prototype précis, pas l'approbation de toutes les pistes du document.

## Pistes de reprise — à cadrer dans la nouvelle conversation

1. **Premier contact :** réduire le texte initial et les réglages visibles pendant la mise en place, sans dissimuler les permissions importantes. Un audit antérieur a relevé un tutoriel optionnel peu découvrable, non proposé en ligne ; vérifier les parcours actuels et les contraintes d'agent avant de modifier l'interface.
2. **Trajet et jouabilité :** observer si reconnaissance, contournement et contre-jeu créent des décisions intéressantes. La lisibilité de la destination, le contraste de l'aide et les accès clavier/tactile sont des limites de la revue locale ; choisir une intervention selon le besoin réel, sans ajouter de confirmation ni de numérotation imposée.
3. **Autres mécaniques :** reprendre les pistes stratégiques comme des hypothèses à comparer, pas comme un backlog déjà approuvé. Distinguer règles proposées, comportements espérés, contre-jeu observé et validation par joueurs. Une victoire isolée ou un adversaire scripté ne démontre pas l'apport d'un agent réel.

Cet ordre aide à reprendre le contexte ; il n'impose pas un choix de feature. La demande de la nouvelle conversation fait foi.

## Avant de modifier

1. Vérifier `git status --short --branch`, actualiser l'état distant et lire les travaux actifs avant de choisir une branche. Utiliser le dépôt canonique existant ; créer un worktree lié sous `/srv/hermes-ssd/workspaces/botters/<sujet>` pour un nouveau travail isolé. Ne pas écraser de travail sale ou actif.
2. Lire la spec du parcours concerné et la [carte des fonctionnalités et tests](feature-regression-coverage.md). Mettre à jour cette carte avec chaque nouvelle fonctionnalité ou limite.
3. Ajouter des tests du comportement réel : simulation et intégration, puis navigateur de bout en bout lorsque l'interaction le nécessite. Vérifier aussi l'état serveur obtenu, pas seulement les clics.
4. Exécuter les vérifications adaptées. `npm test` comprend des tests Node **et** navigateur : son total n'est pas un total de seuls tests unitaires. `npm run test:browser` et `npm run test:auth:browser` sont des suites distinctes ; `npm run check` et `npm run build` complètent les contrôles. `npm run test:online` crée une vraie partie sur le serveur configuré : ne pas viser la production sans autorisation.
5. Préserver les gates de sécurité, d'identité, de revue et de CI. Un résultat local ou une PR fusionnée ne prouve pas le déploiement ni le parcours de production ; les vérifier séparément si la demande les inclut.

## Travaux et preuves séparés

Les PR #19 et #20 sur les apparences et groupes d'essaims, ainsi que la PR #4 sur un autre sujet d'authentification, étaient ouvertes lors du relevé du 8 novembre ; leur présence ne signifie pas qu'elles sont approuvées ou compatibles avec le trajet. Des travaux de migration/authentification existent aussi dans d'autres worktrees. Vérifier leur état et leurs propriétaires en direct avant toute composition ; ne pas les intégrer ou les relancer sur la foi de cette note.
