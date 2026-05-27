# DATAMERRY × COLLABIMO

**Partenariat data pour Le Cercle**

Document de cadrage pour discussion structurante — visio Diara CAMARA / Samuel BRUNO
Mai 2026

---

## 1. Le constat — Collabimo construit un MLS-like français

Diara, depuis mars 2025 tu construis avec Collabimo bien plus qu'un site immo : tu poses les fondations d'un **réseau collaboratif d'agents, mandataires et chasseurs partageant leurs opportunités**. Le programme **Le Cercle** — bientôt en ligne — est explicitement positionné comme :

> *« Agents et mandataires peuvent partager leurs mandats pour collaborer avec leurs confrères, tandis que les chasseurs ont accès aux opportunités correspondant à leurs recherches. »*

C'est le modèle **Multiple Listing Service** (MLS) américain, structure qui pèse 80 % des transactions immo aux US — adapté à la France et à un public pro qualifié (1 an d'expérience minimum à l'entrée).

**3 lectures clés** de cette architecture :

| Lecture | Conséquence |
|---|---|
| Le Cercle est une **infrastructure**, pas un site | Il lui faut des **briques tech robustes** (data, signature, paiement, juridique…) |
| Le critère « 1 an d'expérience » filtre les pros sérieux | Les briques doivent être **professionnelles**, pas grand public |
| Ton bandeau partenaires (IAD, Olean, Budgetlyss, Neos) montre une stratégie de **modules** | Tu acceptes les briques externes officielles si elles servent ta valeur |

**→ DATAMERRY se positionne pile dans le slot manquant : la couche data / intelligence marché.**

---

## 2. DATAMERRY — la data layer naturelle du Cercle

### Ce que DATAMERRY apporte aux 3 segments du Cercle

| Segment Cercle | Besoin data | Apport DATAMERRY |
|---|---|---|
| **Agents** (carte T) | Estimer rapidement un mandat sans déranger un expert | Page white-label `datamerry.com/cabinets/{slug}/estimer` — 11 questions chatbot, estimation DVF micro-marché HDBSCAN, PDF rapport 2 pages brandé cabinet livré par email |
| **Mandataires** | Capter des leads vendeurs depuis leur réseau personnel | Form lead intégré + dashboard CRM kanban 5 étapes (Reçu → Mandat signé → Vendu) |
| **Chasseurs** | Sourcer des opportunités sous-valorisées dans leur secteur | Module DVF cluster — bientôt : alertes zones avec décote vs moyenne |

### Ce qui différencie DATAMERRY techniquement

- **1,2 M de transactions DVF officielles** (notaires) crossées avec OAT 10 ans
- **Clustering HDBSCAN micro-marché** France entière (~3 700 zones IDF, micro-marchés ~200-400 m de rayon)
- **Évolution prix m² par cluster** sur 8 ans (médiane + p25/p75 + variations cumulées)
- **Itinéraire porte-à-porte Navitia IDF Mobilités** : *« à 15 min de Paris (Gare de l'Est) via Métro 5 ou RER E »*
- **Taux de réussite Bac par lycée** vs moyenne académique DEPP (seul outil immo qui le fait)
- **Points d'intérêt notables** (Mérimée + Wikidata) cités dans le rapport
- **Conformité Charte Expertise 6e éd. 2025** (AVM méthodologique, méthode comparable + DCF + capitalisation)
- **CRM cabinet intégré** : kanban pipeline + magic link auth + registre des mandats (carte T)

### Aujourd'hui, état du pilote Collabimo

- ✅ Code production déployé : `https://www.datamerry.com/cabinets/collabimo/estimer`
- ✅ Branding Collabimo (vert `#064e3b`, logo, footer DATAMERRY®)
- ✅ Lead capture avec PDF rapport envoyé sur `Diara.camara@collabimo.com`
- ✅ Dashboard cabinet sur `/cabinets/collabimo/admin/login` (magic link, kanban 5 étapes)
- ✅ Diara a testé, partagé à 3 collègues spontanément — **product-market fit confirmé**

---

## 3. Trois modèles de partenariat — au choix

Présentés par ordre **d'impact stratégique** pour Collabimo (du plus structurant au plus standard).

### 🥇 Modèle A — **Data Partner officiel du Cercle**

**Positionnement** : DATAMERRY devient la brique data native du Cercle, intégrée à l'inscription de tout agent membre.

**Mécanique** :
- Tout agent qui rejoint Le Cercle se voit créer **automatiquement** une page white-label DATAMERRY personnelle (`datamerry.com/cabinets/{slug}`)
- **Diara facture aux agents Cercle son tarif d'adhésion** (à elle de définir : ex. 49 €/mo/agent membre)
- **Collabimo paye une licence DATAMERRY mensuelle fixe** : **199 €/mo HT** (illimité agents Cercle)
- DATAMERRY se rémunère en plus via **0,3 % de commission sur les mandats signés** captés via l'estimation (auditable côté Cercle)

**Pour Diara** :
- Marge sur les adhésions Cercle (49-29 = 20 €/mois/agent)
- Brique data « premium-built » sans la coder
- DATAMERRY supporte les coûts variables, Diara garde le focus sur sa core competency

**Pour DATAMERRY** :
- MRR récurrent prédictible (199 € fixe)
- Scale via Le Cercle (à 100 agents → toujours 199 € flat mais commissions de mandats activent)
- Position **infrastructure** = défensible long terme

---

### 🥈 Modèle B — **Channel Partner + Revenue Share**

**Positionnement** : DATAMERRY garde son modèle B2C standard, Collabimo est rémunérée sur ce qu'elle amène.

**Mécanique** :
- Tarif standard DATAMERRY pour tout cabinet : **29 €/mois + 1 €/lead** (1 mois early adopter offert)
- **Collabimo touche 25 % du revenu DATAMERRY** sur tout cabinet recruté via son réseau, **pendant 24 mois**
- Au-delà de 24 mois, le cabinet bascule en client direct DATAMERRY (pas de commission)
- Tableau de bord affilié à fournir à Diara (à coder en V2)

**Pour Diara** :
- Aucun engagement budgétaire (rien à payer à DATAMERRY)
- Commission passive : à 5 cabinets actifs × 50 € MRR moyen × 25 % = **62,5 €/mo, 1 500 € sur 24 mois**
- Effet d'alignement : chaque cabinet recruté est un revenu

**Pour DATAMERRY** :
- Risque budgétaire transféré : on ne paye que ce qui rapporte
- Croissance organique via Le Cercle
- Moins défensif que A (à terme un autre fournisseur data peut remplacer DATAMERRY)

---

### 🥉 Modèle C — **Volume preferred + co-branding**

**Positionnement** : démarrage simple sans engagement structurel.

**Mécanique** :
- Tarif standard : **29 €/mois + 1 €/lead** (1 mois early adopter offert)
- À partir de **5 cabinets actifs sur Collabimo** : **-25 %** sur le forfait mensuel pour ces cabinets (22 € au lieu de 29 €)
- Co-branding : *« Estimation propulsée par DATAMERRY »* visible sur Collabimo.com + lien retour, et DATAMERRY ajoute le logo Collabimo dans son footer
- Aucun engagement contractuel, résiliation libre

**Pour Diara** :
- Test sans risque
- Ses agents bénéficient d'un tarif préférentiel quand le réseau grossit

**Pour DATAMERRY** :
- Modèle simple, démarrage rapide
- Mais aucune protection long terme

---

## 4. Recommandation et roadmap commune 12 mois

### Notre recommandation

Combiner **A et B** :
- **Modèle A** dès que Le Cercle ouvre officiellement (intégration native + 199 €/mo licence)
- **Modèle B** pour les cabinets indépendants en dehors du Cercle, avec Diara channel partner

**Avantage du combo** : Le Cercle devient un canal de distribution premium pour DATAMERRY, et DATAMERRY devient une infrastructure défensive pour Le Cercle. Win-win mutuel.

### Roadmap 12 mois si on signe le Modèle A + B

| Mois | DATAMERRY | Collabimo |
|---|---|---|
| **M0 (juin 2026)** | Onboarding 3 cabinets ambassadeurs (frère de Diara + 2 collègues) en mode B early adopter | Communication interne du partenariat aux 6 002 followers LinkedIn |
| **M1-2** | Stripe billing automatique, dashboard affilié Diara | Pré-inscription Le Cercle ouverte au public |
| **M3** | Logo DATAMERRY dans bandeau partenaires Collabimo + page « Nos professionnels » | Lancement Le Cercle (modèle A activé) |
| **M4-6** | API d'inscription automatique cabinet via webhook Cercle | Onboarding des 100 premiers agents Cercle |
| **M7-12** | Module DCF / CAPM cluster pour chasseurs (sourcing d'opportunités sous-valorisées) | Scale à 500+ agents |

### Cibles 12 mois

- 100 cabinets actifs sur DATAMERRY via Collabimo
- 5 000 leads captés annuels via le réseau Cercle
- 50 mandats signés issus d'estimations DATAMERRY (commission 0,3 %)

---

## 5. Sujets connexes pour le call

### Logo Collabimo HD
Si tu as le SVG, ça nous permet d'intégrer ton logo officiel sur le cabinet header en place du texte « COLLABIMO » actuel.

### URL CTA officielle
J'ai noté que la home Collabimo pousse vers **« Prendre rendez-vous »** plutôt que vers `/vendre`. Tu confirmes quelle URL pointer comme CTA principal sur les pages d'estimation DATAMERRY ?

### Carte T Eurealimmo
Sujet secondaire (tu as déjà Olean Group). Si à un moment des agents Cercle veulent une délégation carte T moins chère que les 73 €/mo + 10 % d'Olean, on en reparle calmement — mais ce n'est pas le focus d'aujourd'hui.

---

## Annexe — Chiffres marché de référence

- **Apimo CRM immo** : 49 €/mo flat (ne fait pas de la data, juste du CRM)
- **Immo Data Pro** : 25 €/mo flat (commune-level, pas micro-marché)
- **Yanport** : tarif négocié custom (~150-300 €/mo selon volume)
- **Olean Group** : 73 €/mo + 10 % honoraires (délégation carte T uniquement)
- **DATAMERRY proposé Collabimo** : 199 €/mo licence + 0,3 % commissions, **OU** 29 €/mo + 1 €/lead par cabinet

---

**Préparé par** Samuel BRUNO — CEO DATAMERRY (Eurealimmo SARL, carte T n° CPI…)
**Pour** Diara CAMARA — CEO Collabimo, programme HEC Stand Up
**Date** Mai 2026
**Contact** [samuel@datamerry.com](mailto:samuel@datamerry.com) · datamerry.com
