# Botters — intention stratégique et pistes de mécaniques

**Statut : brouillon de conception, avant sélection de mécaniques et implémentation.** Cette vision explore une évolution possible : elle ne décrit pas les règles actuellement livrées, ne remplace pas les contrats PvP ni n'autorise une implémentation ou une publication.

**Mise à jour du 8 novembre 2026 :** le trajet manuel a depuis été intégré séparément dans `master` (PR #32). Son contrat réel est dans [route-prototype-fr.md](route-prototype-fr.md). Cette intégration ne sélectionne aucune des structures proposées ci-dessous et ne valide ni l'équilibrage ni l'intérêt stratégique de ces pistes. Les passages historiques parlant de possibilités ou d'absence de prototype sont conservés comme tels.

## Intention partagée

Botters est un jeu d'invasion spatiale joué avec son agent. Le joueur prépare un plan de jeu visant les conditions qui lui permettront de gagner ; l'adversaire poursuit le sien. Les plans se heurtent et évoluent en partie. Une « condition de victoire » désigne ici une situation stratégique recherchée, pas nécessairement une règle de victoire distincte.

Le joueur définit la doctrine et garde des décisions stratégiques et interventions ponctuelles. L'agent observe et organise les forces, propose et adapte les moyens ; son avantage doit être significatif sans rendre le joueur spectateur. Le tutoriel peut enseigner sans agent, mais ne doit pas remplacer l'expérience principale. Les mécanismes et la frontière exacte des décisions restent ouverts.

## Principes de conception

**Émergence :** initiative, pression, diversion, tempo et reprise sont des notions d'analyse et des comportements espérés, pas des boutons, jauges, bonus, états ou scripts à imposer au joueur. Les règles et contraintes doivent permettre leurs interactions et laisser place à des stratégies imprévues. Cette intention ne garantit ni émergence ni équilibre : ces propriétés restent à vérifier par le jeu.

- **Initiative et tempo :** créer une menace crédible ou obtenir une position qui oblige l'adversaire à arbitrer ; convertir une avance en attaque, production, territoire ou information, sans supposer qu'une option soit toujours meilleure.
- **Contre-jeu :** une avance bien exploitée peut gagner, mais une force dispersée, une ligne exposée ou un investissement contestable doivent pouvoir créer des occasions de reprendre le tempo. Aucun mécanisme automatique de rattrapage n'est imposé.
- **Information partielle :** au début, chaque camp ignore le plan adverse. Les observations arrivent progressivement, peuvent devenir obsolètes et autorisent plusieurs interprétations. L'agent et le joueur disposent des informations de leur camp ; l'agent ne connaît pas l'état caché.
- **Plans asymétriques :** mobilité, production et autres orientations sont des exemples à explorer. Préparation avant partie et adaptation en cours de partie sont désirables ; le support précis et le degré d'engagement restent à concevoir.
- **Reconnaissance et itinéraires :** reconnaissance et raid doivent permettre de guider les forces par un chemin. L'intention seule et les points de passage sont des possibilités ; trajet impératif ou adaptable, interface et limites restent ouverts. La reconnaissance engage temps et ressources, et ne doit pas devenir une formalité systématique.
- **Diversion :** une menace apparente peut orienter la réaction ennemie, mais mobilise et expose réellement des ressources. L'adversaire peut répondre, ignorer ou attaquer la force de diversion ; aucun résultat n'est garanti.
- **Lisibilité :** distinguer l'observation de l'hypothèse de l'agent, rendre ses intentions compréhensibles et permettre au joueur de garder une influence réelle, sans multiplier les alertes ni les réglages obligatoires.

## Scène de référence : initiative contestée

```text
  TON CAMP             CENTRE                  ADVERSAIRE
  ▣──✦ ✦──────────────●──────────────◆ ◆──────────▣
     mobilité / raids                     production / défense
```

Le camp mobile cherche à retarder la production adverse. Le camp productif veut tenir puis exploiter ses renforts. Un site avancé lui rapprocherait les renforts, mais mobiliserait des ressources et deviendrait une cible. Une reconnaissance pourrait découvrir une route latérale sans garantir qu'elle reste sûre. L'adversaire peut défendre, attaquer ailleurs ou exploiter une surextension. Ce scénario est une illustration, pas une preuve d'équilibre ni un ensemble de règles accepté.

## Pistes à comparer — non sélectionnées

1. **Production et logistique :** positions avancées, temps de renfort et vulnérabilité des investissements. Question : comment éviter qu'un site optimal soit toujours évident ou qu'une avance s'auto-entretienne ?
2. **Routes et terrain transformable :** obstacles, passages ou trous de ver, éventuellement utilisables par les deux camps. Question : quelles informations, coûts et réponses rendent l'ouverture d'un passage décisive ou risquée ?
3. **Flux et gravité :** effets visiblement orientés qui modifient les trajectoires ou vitesses. Question : quel choix stratégique lisible créent-ils ; une physique réaliste est-elle même nécessaire ?
4. **Unités, économie et spécialisation :** forces différenciées et choix avant ou pendant la partie. Question : comment créer des plans différents sans réduire le jeu à un contre automatique ?

Ces pistes ne sont ni exhaustives ni obligatoires ; elles doivent être comparées avec des structures réellement différentes, sans imposer des factions, des monnaies, des périodes de jeu ou des valeurs numériques.

## Trois structures candidates à discuter

Ces modèles sont des hypothèses distinctes, pas trois fonctionnalités à additionner. Chacun préserve une partie en temps réel ; aucun chiffre, système de tour ou compteur n'est accepté par défaut.

### A. Percée et ravitaillement

Une invasion avance et s'appuie sur des sites qui alimentent son front. Le joueur choisit un axe et des investissements ; l'agent organise forces, reconnaissance et soutien. L'adversaire peut défendre directement ou menacer les lignes arrière. Une percée peut gagner du terrain, mais ses forces avancées deviennent plus longues à soutenir.

```text
base ▣ ─── soutien ─── ▣ site avancé ─── ✦ invasion ─── ◆ défense
                          ↑
                     raid adverse ?
```

**Risque :** plus de territoire produit plus de ressources, et une logistique punitive peut rendre toute attaque frustrante. **À examiner :** une force en retard peut-elle réellement contester le soutien, et l'attaquant dispose-t-il de plusieurs réponses ? Des convois explicites ne sont qu'une variante, non un prérequis.

### B. Engagements et réserve

Les camps choisissent comment répartir leurs forces entre plusieurs objectifs et peuvent conserver une réserve. Les mouvements et affectations ennemis sont partiellement cachés jusqu'à observation ; les forces engagées loin d'un front ne peuvent pas y intervenir immédiatement. L'agent coordonne les forces disponibles selon l'intention du joueur, qui peut engager la réserve ou changer de priorité.

```text
          nord :   ✦ attaque  ───────── ?
base ▣ ── centre : ✦ réserve          ? ── ▣ ennemi
          sud  :   ✦ défense ───────── ?
```

**Risque :** si les indices sont trop pauvres, le choix devient une devinette ; si une répartition domine toujours, les plans se ressemblent. **À examiner :** la reconnaissance peut-elle orienter une décision sans révéler automatiquement l'intention adverse ? Ce modèle ne requiert ni phases de planification ni budget artificiel.

### C. Pression et fenêtres d'opportunité

Les incursions menacent les routes et la production. Le défenseur choisit quand intercepter, protéger ses ressources ou contre-attaquer ; l'attaquant doit conserver assez de forces pour exploiter une ouverture et éviter de s'épuiser. Ici, la pression est d'abord une situation sur la carte, pas nécessairement une jauge.

```text
       ✦ incursion  ──►  ▣ site contesté
base ▣ ── ✦ réserve             ◆ défense ── ▣ ennemi
```

**Risque :** le camp en tête peut imposer une pression perpétuelle, tandis que le défenseur n'aurait rien à faire qu'attendre. **À examiner :** le coût d'entretien ou l'exposition des forces crée-t-il des occasions de contre-attaque visibles et réellement accessibles ?

## Repères externes vérifiés

- Blizzard décrit une expansion visant à soutenir l'économie dans son [glossaire StarCraft II](https://news.blizzard.com/en-us/article/273068/in-the-vernacular-learning-the-language-of-starcraft-part-2), et le placement avancé d'une production pour raccourcir les trajets dans [Death by Proxy](https://news.blizzard.com/en-gb/article/9991309/death-by-proxy). **Transposition envisagée :** les ressources peuvent être converties en moyens d'action, en position ou en pression ; ce n'est pas une règle nouvelle établie de Botters.
- Blizzard présente la reconnaissance comme l'observation des positions, unités, structures et expansions, notamment à l'aide d'un ouvrier : [guide de reconnaissance](https://news.blizzard.com/en-us/article/4488316/game-guide-scouting). **Transposition envisagée :** obtenir de l'information peut mobiliser une force qui aurait servi ailleurs ; l'information ne doit pas révéler à coup sûr l'intention.
- Riot explique, dans un article de 2022, rechercher un retour difficile mais réalisable, gagné par des actions et contestable par l'équipe en tête : [comeback mechanics](https://www.leagueoflegends.com/en-gb/news/dev/quick-gameplay-thoughts-2-25-comeback-mechanics/). **Transposition envisagée :** distinguer les occasions de punir une exposition des bonus explicites accordés au camp en retard ; aucun des deux n'est choisi à ce stade.

Ces textes sont des références de conception historiques, pas des preuves de l'équilibrage actuel ni de l'intérêt de ces modèles pour Botters. Les avis précédemment recueillis étaient des critiques d'agents simulés, pas ceux de studios indépendants réels.

## Recherche et validation

Comparer les principes de jeux existants sur sources vérifiables, en séparant leurs règles attestées de leur adaptation hypothétique à Botters. Produire des mises en situation dessinées où chaque camp possède des informations, des options et des contreparties, puis confronter les propositions à des critiques indépendantes clairement identifiées comme simulées ou réelles.

Pour chaque candidat, séparer clairement : (1) règles élémentaires proposées et informations visibles, (2) conséquences potentielles et comportements attendus, (3) tactiques imprévues observées et risques à examiner. Une scène n'est pas un parcours à coder : les joueurs et agents peuvent agir autrement. Observer aussi les stratégies dominantes, exploitations et résultats peu lisibles, sans présumer que toute émergence est souhaitable.

Avant toute conclusion sur la valeur de l'agent, comparer un agent réel à de bonnes stratégies fixes ou programmées dans des conditions comparables, en distinguant stratégie initiale et adaptation. Un test heuristique ou une victoire unique ne suffit pas. Tester séparément la compréhension, l'influence et le plaisir du joueur humain ; ne pas supposer qu'un avantage chiffré suffit.

**État des preuves :** les essais précédents ne démontrent pas que l'adaptation d'un agent améliore le résultat. Une première recherche documentaire et trois modèles conceptuels sont réunis ci-dessus, sans sélection ni validation par playtest. Aucun prototype ni changement de règles n'est autorisé par ce document.
