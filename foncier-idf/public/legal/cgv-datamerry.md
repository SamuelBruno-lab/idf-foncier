# Conditions Générales de Vente et d'Utilisation — DATAMERRY API

**Dernière mise à jour : 25 mai 2026**

## 1. Préambule et identification de l'Éditeur

Le Service **DATAMERRY®** (ci-après « le Service ») est édité et exploité par :

**EUREALIMMO SARL** (société à responsabilité limitée à associé unique)
Capital social : 100 €
Siège social : 60 rue François 1er, 75008 Paris, France
RCS Paris : *[N° à compléter dès KBIS]*
N° TVA intracommunautaire : *[à compléter]*
Représentée par Samuel BRUNO, en qualité de Gérant
Email : contact@datamerry.com

Marque « DATAMERRY® » exploitée par EUREALIMMO SARL.

> **Note transitoire** : DATAMERRY SAS est en cours d'immatriculation. Dès son immatriculation effective, le Service sera repris par cette nouvelle entité par voie de cession de fonds de commerce numérique. Le Client en sera informé par email au moins 30 jours avant la bascule, sans qu'aucune action ne soit requise de sa part.

## 2. Définitions

- **Service** : l'API DATAMERRY accessible via les endpoints documentés sur datamerry.com, le widget JavaScript embarquable, l'export PDF brandé et tout autre composant exploité sous la marque DATAMERRY.
- **Client** : toute personne morale (cabinet immobilier, agence, mandataire titulaire de carte T, promoteur, expert immobilier, plateforme tech B2B) souscrivant un abonnement au Service.
- **Clé API** : identifiant secret personnel et confidentiel délivré au Client lui permettant d'accéder au Service.
- **Données** : ensemble des informations, estimations, indicateurs et rapports délivrés par le Service.
- **Période d'engagement** : durée minimale d'un cycle de facturation (mensuelle, sans engagement annuel).

## 3. Objet du contrat

Les présentes CGV régissent la fourniture au Client d'un accès au Service DATAMERRY, comprenant :
- Estimations d'évaluation immobilière fondées sur les données DVF (Demandes Valeurs Foncières), OLAP (Observatoires Locaux des Loyers), ANIL (Carte des loyers), INSEE et OpenStreetMap
- Indicateurs de rendement locatif et plafonds fiscaux
- Rapports propriété agrégés (JSON / HTML widget / PDF brandé)
- Widget embarquable sur le site Internet du Client

**Le Service est une prestation de service numérique B2B**, fournie aux professionnels de l'immobilier dans le cadre de leur activité commerciale. Il **ne constitue pas** :
- Un avis d'expert immobilier au sens des articles L.541-1 et suivants du Code de commerce
- Un conseil en investissement immobilier au sens du Code monétaire et financier
- Une expertise judiciaire ou amiable
- Une consultation juridique ou fiscale individualisée

## 4. Caractère indicatif des données

Les estimations, rendements, plafonds fiscaux et indicateurs fournis par le Service sont calculés **à titre purement indicatif et automatisé**, à partir de sources publiques (DVF, OLAP, ANIL, INSEE, OpenStreetMap, etc.) dont l'exactitude, l'exhaustivité et la mise à jour sont sous la responsabilité des producteurs publics, pas de l'Éditeur.

Le Client reconnaît que :
- Les estimations ne se substituent **en aucun cas** à une expertise professionnelle individualisée
- Les transactions DVF présentent un délai d'intégration de 4 à 6 mois et ne couvrent pas l'Alsace-Moselle (Livre Foncier)
- Les indicateurs sont calculés par algorithmes statistiques (notamment HDBSCAN, regroupements géographiques, percentiles) dont la précision dépend du volume de données disponibles dans la zone concernée
- Le Client conserve l'entière responsabilité de l'usage qu'il fait des Données dans ses missions d'agent immobilier, de promoteur ou d'investisseur

## 5. Souscription et accès au Service

### 5.1 Création de compte

L'accès au Service nécessite la création d'un compte par le Client via Stripe Checkout, avec validation d'un moyen de paiement et acceptation des présentes CGV.

### 5.2 Délivrance de la Clé API

À l'issue de la souscription, une Clé API au format `dmk_live_xxxxxxxx` (et éventuellement une Clé widget `wdmk_live_xxxxxxxx`) est délivrée par email au Client. La Clé API est strictement personnelle et confidentielle.

### 5.3 Confidentialité de la Clé API

Le Client s'engage à :
- Ne **jamais** diffuser sa Clé API serveur (`dmk_live_…`) publiquement
- La stocker dans un coffre-fort logiciel ou variable d'environnement serveur, **pas** dans du code client (navigateur)
- Demander immédiatement à l'Éditeur la révocation en cas de fuite suspectée (à contact@datamerry.com)

Toute requête effectuée avec la Clé API est réputée provenir du Client et lui est imputable, sauf preuve formelle de compromission.

## 6. Prix et facturation

### 6.1 Tarif standard

- **39 € TTC / mois** par compte Client, incluant 50 000 requêtes API mensuelles
- **1 € TTC / 1 000 requêtes** supplémentaires au-delà du forfait inclus, facturées en metered billing Stripe
- **Premier mois offert** sur le forfait de base pour toute nouvelle souscription (offre promotionnelle révisable)

### 6.2 Tarifs spécifiques

Des tarifs spécifiques (« pilot », « enterprise ») peuvent être consentis sur devis individuel. Ils font alors l'objet d'une convention écrite annexée aux présentes.

### 6.3 Facturation et paiement

- Facturation mensuelle via Stripe (carte bancaire, SEPA)
- Émission automatique d'une facture PDF par mois, envoyée par email
- En cas d'échec de paiement : suspension du Service à J+7 après notification, résiliation à J+30

### 6.4 Renouvellement et résiliation

L'abonnement est **mensuel sans engagement de durée**. Il se renouvelle tacitement chaque mois. Le Client peut résilier à tout moment via le Stripe Customer Portal accessible depuis son email de facturation. La résiliation prend effet à la fin du mois en cours, sans frais ni pénalité.

## 7. Propriété intellectuelle

### 7.1 Marque et logiciel

La marque DATAMERRY®, le code source, l'algorithmie (notamment le pipeline HDBSCAN adaptatif, la ventilation des mutations mixtes, les scores d'accessibilité et de qualité de vie), les bases de données dérivées sont la propriété exclusive de l'Éditeur, protégés par les articles L.111-1 et suivants du Code de la propriété intellectuelle.

### 7.2 Licence concédée au Client

L'Éditeur concède au Client un **droit personnel, non exclusif, non cessible et révocable** d'utilisation du Service dans le cadre de son activité professionnelle, pendant la durée de l'abonnement. Cette licence n'emporte aucun transfert de propriété.

### 7.3 Restrictions

Le Client s'interdit de :
- Revendre, redistribuer ou sous-licencier les Données à un tiers sans accord écrit préalable
- Faire de l'extraction massive systématique des Données (scraping, mirror)
- Réutiliser les Données pour entraîner un modèle d'apprentissage automatique concurrent du Service
- Utiliser le Service à des fins illicites, déloyales ou contraires aux conditions des sources de données (DVF, OLAP, ANIL, INSEE, OSM)

### 7.4 Affichage de la marque

Le Client peut afficher la mention « propulsé par DATAMERRY » ou « powered by DATAMERRY » sur ses supports digitaux affichant les Données. Toute autre exploitation de la marque DATAMERRY® requiert un accord écrit.

## 8. Responsabilité

### 8.1 Obligation de moyen

L'Éditeur est tenu d'une **obligation de moyen** dans la fourniture du Service, à l'exclusion de toute obligation de résultat. Le Service est fourni « en l'état », sur la base des données publiques disponibles.

### 8.2 Limitation de responsabilité

**La responsabilité de l'Éditeur est, dans toute la mesure permise par la loi, limitée :**
- aux dommages **directs**, certains et prouvés résultant d'un manquement contractuel imputable à l'Éditeur,
- à un montant maximum équivalent **aux sommes effectivement versées par le Client à l'Éditeur au cours des 12 mois précédant le fait générateur du dommage**.

Sont expressément exclus de la responsabilité de l'Éditeur :
- Les dommages indirects (perte de chance, perte de marge commerciale, atteinte à l'image, perte de clientèle)
- Les conséquences d'une décision d'investissement, de vente, de location ou de financement prise par le Client ou ses clients finaux sur la base des Données
- Les fautes ou erreurs imputables aux sources de données publiques (DGFiP/DVF, ANIL, OLAP, INSEE, OSM)
- Les interruptions de service dues à un cas de force majeure, à une défaillance des fournisseurs d'infrastructure (Vercel, Supabase, AWS, etc.) ou à un événement extérieur au contrôle raisonnable de l'Éditeur

### 8.3 Engagement de disponibilité

L'Éditeur s'engage à un **taux de disponibilité de 99% sur base mensuelle** hors maintenances planifiées (annoncées 48h à l'avance). En cas de manquement constaté, le Client peut demander un avoir prorata.

## 9. Données personnelles et RGPD

### 9.1 Statuts

- L'Éditeur est **responsable de traitement** pour les données d'identification du Client (email, raison sociale, IBAN, logs d'usage de l'API).
- L'Éditeur est **sous-traitant** pour toute donnée personnelle que le Client transmettrait à l'API via le paramètre `address` (qui peut, théoriquement, identifier un occupant).

### 9.2 Finalités du traitement

- Fourniture du Service souscrit
- Facturation et recouvrement
- Détection de fraude et abus
- Analytics agrégées internes (volume, latence, taux d'erreur)

### 9.3 Durée de conservation

- Données de compte : durée de l'abonnement + 5 ans (obligations comptables et fiscales)
- Logs d'usage API : 13 mois glissants
- Données de paiement : conservées par Stripe selon ses propres CGV

### 9.4 Droits du Client

Le Client dispose des droits d'accès, de rectification, d'effacement, de portabilité et d'opposition prévus par le RGPD (articles 15 à 22). Demandes à : dpo@datamerry.com.

### 9.5 Sous-traitants

L'Éditeur recourt aux sous-traitants suivants, listés exhaustivement :
- **Supabase** (Postgres, AWS Frankfurt — UE) : hébergement base de données
- **Vercel** (Paris-1 — UE) : hébergement applicatif
- **Stripe Payments Europe Ltd.** (Irlande — UE) : paiements
- **Resend** (UE) : email transactionnel
- **Groq Inc.** / **Cerebras** : reranking LLM (zéro donnée personnelle envoyée — uniquement l'adresse anonyme)
- **Google Maps / Mapillary** : Streetview (URL signée uniquement)

## 10. Conformité aux sources publiques

Le Service exploite uniquement des données publiques mises à disposition sous licences ouvertes : DVF (Etalab Licence Ouverte 2.0), OLAP (open data), ANIL (open data), INSEE (Licence Ouverte 2.0), OpenStreetMap (ODbL). Le Service ne pratique **aucun scraping** de sites tiers (SeLoger, LeBonCoin, etc.).

## 11. Modifications des CGV

L'Éditeur se réserve le droit de modifier les présentes CGV. Toute modification substantielle (tarifs, périmètre du Service) sera notifiée au Client par email **30 jours à l'avance**. Le Client peut, en cas de modification défavorable, résilier sans pénalité avant la prise d'effet.

## 12. Droit applicable et juridiction

Les présentes CGV sont régies par le **droit français**. Tout litige relatif à leur formation, exécution ou interprétation sera soumis à la compétence exclusive des **tribunaux de Paris**, après tentative préalable de règlement amiable.

---

*Document généré le 25 mai 2026. Version v1.0. Approuvé par l'Éditeur.*
