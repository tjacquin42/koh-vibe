# Koh-Vibe

*[English version](README.md)*

[![Place de marché](https://img.shields.io/visual-studio-marketplace/v/tjacquin42.koh-vibe?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=tjacquin42.koh-vibe)
[![Installations](https://img.shields.io/visual-studio-marketplace/i/tjacquin42.koh-vibe)](https://marketplace.visualstudio.com/items?itemName=tjacquin42.koh-vibe)
[![Licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

Toutes vos sessions Claude Code dans une seule vue : celles de tous les projets, de toutes
les fenêtres et de tous les éditeurs de la machine — avec leur statut, ce qu'elles sont en
train de faire, et votre consommation.

> **macOS uniquement.** Les carillons passent par `afplay`, le jeton de consommation est lu
> dans le trousseau du système, et les ponts de hooks sont des scripts zsh. Rien ici ne
> prétend marcher ailleurs.

## Ce qu'il faut avoir

- **macOS**, pour les raisons ci-dessus.
- **[Claude Code](https://claude.com/claude-code)**, utilisé depuis cette machine. Koh-Vibe
  observe les sessions que vous lancez ; il n'en démarre une que si vous le lui demandez.
- **VSCode 1.94** ou plus récent, ou un fork qui le suit — Cursor et Antigravity sont ceux
  avec lesquels il sert tous les jours.
- **Les hooks de Claude Code**, posés en un clic depuis la vue. Rien ne s'affiche dans la
  liste tant qu'ils ne le sont pas — voir [Poser les hooks](#poser-les-hooks).

## Installation

Cherchez **Koh-Vibe** dans la vue Extensions, ou lancez :

```
ext install tjacquin42.koh-vibe
```

Rechargez ensuite la fenêtre, ouvrez la vue Koh-Vibe dans la barre d'activité, et posez les
hooks.

Les forks de VSCode — Cursor, Windsurf, VSCodium — n'atteignent pas la place de marché de
Microsoft. Pour ceux-là, construisez le paquet vous-même ; c'est une commande,
[plus bas](#depuis-les-sources).

### Poser les hooks

Rien ne s'affiche tant que Claude Code ne dépose pas ses événements. Ouvrez la vue Koh-Vibe
et cliquez sur *Hooks non installés*, ou lancez **Koh-Vibe: Installer les hooks** depuis la
palette.

Le script ajoute huit hooks à `~/.claude/settings.json`, **sauvegarde le fichier avant d'y
toucher**, et refuse d'écrire si son empreinte a changé entre-temps. Les hooks et la
statusline que vous aviez déjà sont préservés : Koh-Vibe s'enchaîne au bout, il ne remplace
rien. **Koh-Vibe: Désinstaller les hooks** défait exactement cela.

### Depuis les sources

Depuis le terminal intégré de l'éditeur où vous la voulez :

```bash
git clone https://github.com/tjacquin42/koh-vibe.git
cd koh-vibe
pnpm install
sh install.sh
```

`install.sh` compile, empaquette sous un numéro de version jetable et installe dans l'éditeur
auquel son terminal appartient — VSCode, Cursor ou Antigravity, celui qui le lance. Rechargez
ensuite la fenêtre (*Developer: Reload Window*). Le numéro vient de l'horloge pour que chaque
installation tombe dans un dossier neuf : celui de `package.json` ne bouge qu'à la livraison,
et réinstaller sous le même numéro laisse l'éditeur servir ce qu'il avait déjà.

## Ce que ça affiche

- **Les sessions vivantes**, triées par ce qui réclame votre attention : celles qui vous
  attendent d'abord, puis celles qui travaillent, puis celles qui viennent de finir.
- **Une pastille de statut** par session — même glyphe, cinq couleurs — et, à côté, le projet,
  la branche et l'outil en cours d'exécution. La ligne porte le nom de l'onglet : le titre que
  vous lui avez donné, sinon celui que Claude a engendré, sinon le dernier prompt.
- **Les conversations terminées** restent dans la liste, grisées et dans leur dossier, tant
  que *Sessions persistantes* est coché dans les réglages (il l'est par défaut). Décoché,
  fermer un onglet retire la ligne. *Fermé récemment*, une vue à part, retient dans les deux
  cas les dix conversations terminées le plus récemment.
- **Sessions temporaires** est le dossier où une conversation atterrit tant qu'on ne l'a pas
  glissée dans un dossier. Laissée là 24 heures sans activité, elle quitte la liste — un
  réglage désactive ce comportement.
- **Fermer une conversation** avec l'icône corbeille qui apparaît au survol d'une ligne
  vivante. Elle ferme son onglet Claude Code et retire la ligne — la conversation passe dans
  *Fermé récemment* — en un clic, quoi que dise *Sessions persistantes* : ce réglage concerne
  les onglets que vous fermez vous-même. Un onglet restauré est fermé sur place, sans être
  ouvert. Quand aucun onglet n'est trouvé — une conversation dans un terminal, dans
  l'application de bureau Claude, ou dans un projet qu'aucune fenêtre n'a ouvert — la ligne
  est simplement retirée de la liste. Sur une ligne grisée, l'icône la retire pour de bon. Une
  conversation qui se termine avant son premier message — Claude Code en démarre une pour chaque
  panneau qu'il ouvre — ne laisse ni ligne ni historique : il n'y a rien où revenir.
- **Votre consommation** sur cinq heures et sept jours — et par modèle, quand votre offre en
  compte un à part — avec l'échéance de remise à zéro.
- **Un clic** sur une session ouvre ou reprend sa fenêtre, où qu'elle soit — y compris une
  session fermée.

## S'en servir

**Ranger.** Créez des dossiers, glissez-y des sessions, donnez-leur une couleur. L'ordre à
l'intérieur d'un dossier se fixe à la main et ne bouge plus : une session ouverte plus tard
se pose à la fin sans bousculer ce qui a été placé. Les dossiers eux-mêmes se glissent de la
même façon — déposez-en un sur un autre pour le placer devant, ou sur *Sessions temporaires* pour
l'envoyer à la fin.

**Nouvelle session.** Le bouton **+** du titre de la vue ouvre un nouvel onglet Claude Code —
une conversation neuve dans le dossier de la fenêtre. Survolez un dossier : le même **+**
apparaît à droite de sa ligne (le clic droit le propose aussi, *Nouvelle session ici*) et
range la conversation dans ce dossier dès qu'elle apparaît, pour qu'elle ne soit pas
temporaire.

**Sonner.** Un carillon quand une session se met à vous attendre, un autre quand elle vient
de finir. Trois niveaux, du plus précis au plus général : le son d'une conversation l'emporte
sur celui de son dossier, qui l'emporte sur le réglage global. « Aucun » est un choix de
silence, pas une absence de choix — il ne remonte donc pas d'un cran.

Les sons de macOS servent de base. Koh-Vibe propose d'y ajouter une bibliothèque de cent sons
d'interface courts ([Kenney](https://kenney.nl/assets/interface-sounds), CC0), téléchargée une
seule fois et rangée chez lui — jamais dans `~/Library/Sounds`, dont la liste sert aussi au
panneau Son du système. La ligne *Bibliothèque de sons* des réglages l'installe et la retire.

Deux de ses sons voyagent dans le paquet, renommés d'après ce qu'ils annoncent : **Attente**,
quand une session se met à vous attendre, et **Fin**, quand elle vient de finir. Une
installation neuve démarre sur ces deux-là : le tableau de bord carillonne donc dès le premier
lancement, bibliothèque ou pas. C'est un défaut, pas une règle : un son déjà choisi, silence
compris, reste en place, et une mise à jour ne le remet jamais.

Dans la liste de choix, les flèches font entendre chaque son ; **→** rejoue le son survolé.

**Retirer.** Clic droit sur une session → *Retirer de la liste*. Rien n'est arrêté : Claude
Code tourne dans son terminal, et une session encore vivante réapparaîtra à son prochain
événement.

**Sessions persistantes.** La première ligne des réglages, une case à cocher, décide de ce que
fermer un onglet fait à sa ligne. Cochée — le défaut — la conversation reste dans la liste,
grisée, dans son dossier, avec une pastille éteinte et l'heure de sa fermeture ; les cinquante
plus récentes sont gardées, et *Retirer de la liste* en enlève une pour de bon. Décochée,
fermer l'onglet retire la ligne ; les lignes déjà grisées restent dans les deux cas. Le survol
de la ligne donne la même explication.

**Sessions temporaires.** La seconde case. Une conversation rangée dans aucun dossier est
temporaire : après 24 heures sans activité, elle quitte la liste — masquée, pas oubliée : toute
activité la ramène, et la ranger dans un dossier la garde pour de bon. Décochée, les
conversations temporaires restent jusqu'à ce que vous les retiriez.

**Rouvrir.** Un clic sur une conversation terminée — ligne grisée, ou entrée de *Fermé
récemment* — la ramène : dans l'onglet d'éditeur où elle tournait, ou dans un terminal neuf
posé sur son dossier, selon d'où elle venait. L'onglet d'éditeur seulement si Claude Code
retrouvera la conversation depuis cette fenêtre — son transcript sous le projet de la fenêtre,
et non masqué de sa liste de sessions ; sinon un terminal la reprend, ce qui marche de partout.
Un onglet restauré que personne n'a encore ouvert est simplement ramené devant, jamais ouvert
une seconde fois.
Pendant qu'elle revient, la ligne tourne à la place de sa pastille — quelques secondes passent
entre le clic et l'apparition de la conversation, sans que rien d'autre ne bouge — et ne prend
pas de second clic, qui ouvrirait un second onglet. Le spinner s'efface quand la conversation
est de nouveau ouverte, ou après trente secondes sans elle.

## Réglages et commandes

Les réglages de Koh-Vibe vivent dans sa propre vue **Réglages**, en bas du panneau, et non
dans ceux de l'éditeur : deux cases à cocher — *Sessions persistantes* et *Sessions
temporaires* — le carillon global de chaque événement, le volume, et la bibliothèque de sons.
Les dossiers et les conversations redéfinissent les carillons depuis leur propre clic droit.

Depuis la palette de commandes, sous **Koh-Vibe** :

| Commande | Ce qu'elle fait |
|---|---|
| *Installer les hooks* / *Désinstaller les hooks* | ajoute les hooks de Koh-Vibe à `~/.claude/settings.json`, ou les retire |
| *Rafraîchir* | relit le registre de Claude Code et ramène toute conversation vivante que la liste a perdue |
| *Nouvelle session* | ouvre un onglet Claude Code, rangé dans le dossier de la fenêtre |
| *Nouveau dossier* | crée un dossier |
| *Son d'un événement* · *Volume des carillons* | les carillons globaux |
| *Installer la bibliothèque de sons* / *Retirer la bibliothèque de sons* | les cent sons Kenney |
| *Rafraîchir la consommation* | force un relevé, sinon mis en cache cinq minutes |

Le reste — rouvrir, fermer, renommer, colorer, sons par dossier et par conversation — est sur
le clic droit de la ligne concernée.

## Vos données, et ce qui quitte la machine

**Rien n'est envoyé nulle part, et il n'y a aucune télémétrie.** Le seul appel réseau que fait
Koh-Vibe va chez Anthropic, pour vos chiffres de consommation, au plus une fois toutes les
cinq minutes. Le jeton OAuth dont il a besoin est lu dans le trousseau du système — jamais
journalisé, jamais écrit sur le disque. Aucun prompt, aucun transcript, aucun chemin ne quitte
la machine.

Tout le reste tient dans `~/.koh-vibe/` :

| | |
|---|---|
| `bin/` | le pont et l'enrobage de statusline, copiés à l'installation des hooks |
| `events/` | le spool : un fichier par événement, consommé puis effacé |
| `events/rejected/` | ce qui n'a pas pu être lu, gardé plutôt que jeté |
| `sessions/` | l'état réduit, un fichier par session |
| `requests/` | les demandes de mise au premier plan, de réouverture et de fermeture, d'une fenêtre à l'autre |
| `backups/` | les copies de `settings.json` prises avant chaque pose de hooks |
| `groups.json` | les dossiers, leurs couleurs, l'ordre choisi et les sons |
| `closed.json` | les dix conversations fermées le plus récemment |
| `settings.json` | les sons globaux, le volume, et les deux réglages de la liste |
| `usage.json` | le dernier relevé de consommation, mis en cache |
| `status.json` | le dernier instantané de la statusline |
| `sounds/` | la bibliothèque, si vous l'avez installée |

Ces fichiers sont **partagés entre toutes les fenêtres et tous les éditeurs** de la machine :
un dossier créé d'un côté apparaît de l'autre, et un son choisi une fois vaut partout.
Désinstaller l'extension ne les efface pas ; supprimer le dossier suffit à repartir de zéro.

## Comment ça marche

Les hooks de Claude Code appellent un **pont shell** qui n'interprète rien : il recopie ce
qu'il reçoit dans le spool, n'écrit jamais sur la sortie standard, et sort toujours en
succès. Un pont qui analyserait le JSON pourrait échouer, et un hook qui échoue perturbe la
session qu'il observe — le seul comportement acceptable est de ne rien casser, quitte à
perdre un événement.

Chaque fenêtre surveille le spool de son côté, réduit les événements en état, et l'affiche.
Aucun verrou : les fichiers partagés sont fusionnés à trois voies (l'état lu, le nôtre, et
le plus frais relu juste avant d'écrire), pour que deux fenêtres qui rangent en même temps ne
s'effacent pas l'une l'autre.

Une conversation quitte la liste quand elle se termine, quand vous la fermez, ou quand vous
la retirez — jamais parce qu'elle s'est tue : un onglet laissé ouvert une journée reste une
conversation. **Rafraîchir** lit le registre des processus de Claude Code
(`~/.claude/sessions/`) et ramène toute conversation vivante que la liste a perdue, dans le
dossier où elle était rangée. La même passe tourne à l'ouverture de la fenêtre, et quelques
secondes après qu'une conversation a disparu alors que son processus vit encore — la même
conversation ouverte dans deux éditeurs, dont l'un se ferme — avec une icône qui tourne à la
place du bouton pendant ce temps. Les onglets restaurés par l'éditeur mais jamais rouverts
sont listés comme n'importe quelle session inactive — l'onglet est ouvert, c'est ce qui
compte. L'éditeur ne résout que l'onglet actif, donc aucun processus Claude Code ne tourne
derrière les autres tant qu'ils ne sont pas affichés : un clic ramène l'onglet devant, et
Claude Code le reprend. *Retirer de la liste* masque une conversation jusqu'à sa prochaine
activité.

## Nouveautés

La **1.2.0** garde toutes les conversations : les terminées restent grisées dans leur dossier,
en rouvrir une ramène cette conversation-là et non une vierge, celles rangées nulle part sont
*temporaires* jusqu'à ce que vous les rangiez, la corbeille ferme l'onglet et la ligne d'un
clic, et un **+** démarre une session depuis le tableau de bord. Plus rien n'est oublié pour
s'être tu.

Chaque version, et ce qu'elle a changé, est dans le [changelog](CHANGELOG.md).

## Contribuer

Les contributions extérieures sont bienvenues — le flux, les commandes et ce que la revue
regarde sont dans [CONTRIBUTING.fr.md](CONTRIBUTING.fr.md). Le versionnement est décrit dans
[CLAUDE.md](CLAUDE.md) : une PR mergée sur `main` vaut une version, et la livraison la pose
toute seule.

## Crédits

*Koh* : « île » en thaï. Inspiré de
[open-vibe-island](https://github.com/Octane0411/open-vibe-island), qui fait la même chose
dans l'encoche du Mac. Aucun code n'en est repris.

Koh-Vibe est un projet indépendant. Il n'est ni affilié à Anthropic, ni approuvé ou
sponsorisé par Anthropic.

## Licence

[MIT](LICENSE).
