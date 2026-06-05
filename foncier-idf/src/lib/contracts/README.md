# Génération automatique des contrats de mandat fondateur

Pipeline qui remplit le contrat de mandat « Associé(e) Fondateur(trice) »
Eurealimmo Réseau à partir d'un **template Word validé**, depuis les données de
`public.eurealimmo_mandataires`.

## Pièces

| Élément | Chemin |
|---|---|
| Template (source de vérité) | `public/legal/templates/contrat-mandat-fondateur.template.docx` |
| Lib de génération | `src/lib/contracts/generate-mandat.ts` |
| Helper stockage / onboarding | `src/lib/contracts/store-mandat.ts` |
| Stub e-signature | `src/lib/contracts/esign.ts` |
| Route on-demand | `POST /api/cabinets/{slug}/admin/mandataires/{id}/contrat` |
| Route batch | `POST /api/cabinets/{slug}/admin/mandataires/contrats/batch` |
| Auto-onboarding | branché dans `api/mandataire/{id}/onboarding/step` (étape `contrat_signe` → `in_progress`) |
| Migration SQL | `sql/43_eurealimmo_founder_contracts.sql` |

## Installation

```bash
npm install            # installe docxtemplater + pizzip (ajoutés au package.json)
psql ... -f sql/43_eurealimmo_founder_contracts.sql   # colonnes + bucket Storage
```

## Champs du template (tags docxtemplater `{ }`)

`{prenom}` `{nom}` `{email}` `{numero_fondateur}` `{date_contrat}` `{marque}` `{parcours}`

Mappés depuis la table par `mandataireToTags()` :
- `numero_fondateur` ← `founder_number` (**obligatoire**, 2..60 ; n° 1 = contrat dédié Diara, refusé)
- `marque` ← `company_name` (ou param explicite) ; vide si aucune
- `parcours` ← `description` (ou param explicite) ; vide si non renseigné
- `date_contrat` ← date du jour formatée FR (« 1er juillet 2026 »)

Les champs d'état civil (`[à compléter]` : date/lieu de naissance, nationalité,
adresse) restent **littéraux** dans le contrat, à compléter à la signature
(non présents en base).

## Déclencheurs

1. **On-demand (admin)** — `POST .../mandataires/{id}/contrat`
   body : `{ marque?, parcours?, send_for_signature? }` → renvoie URL signée.
2. **Batch** — `POST .../mandataires/contrats/batch`
   body : `{ only_missing?: true, ids?: string[] }` → exclut la n° 1.
3. **Auto-onboarding** — génération best-effort quand l'étape `contrat_signe`
   passe `in_progress`.

## Sortie & signature

Le `.docx` rempli est stocké dans le bucket privé **`mandats-fondateurs`**
(`{mandataire_id}/{filename}.docx`). Il est ensuite **envoyé tel quel au
prestataire e-signature** (Yousign/DocuSign) qui produit le PDF signé eIDAS —
pas de conversion PDF côté serveur (aligné Art. 16 du contrat).

### e-signature — Yousign

Flux complet implémenté dans `sendYousign()` : créer la request → uploader le
DOCX → ajouter le signataire + champ de signature → activer (envoi email).
Tant que `YOUSIGN_API_KEY` est absente, `isEsignConfigured()` = false et rien
n'est envoyé (la génération DOCX reste inchangée).

```
ESIGN_PROVIDER=yousign
YOUSIGN_API_KEY=...
YOUSIGN_BASE_URL=https://api.yousign.com      # ou https://api-sandbox.yousign.app
YOUSIGN_SIGNATURE_LEVEL=electronic_signature  # SES
YOUSIGN_AUTH_MODE=otp_email                    # ou otp_sms (requiert un téléphone)
# Position du champ de signature dans le PDF rendu par Yousign — À CALIBRER
# une fois sur le rendu réel (page du bloc « Pour le Mandataire ») :
YOUSIGN_SIGN_PAGE=1
YOUSIGN_SIGN_X=320
YOUSIGN_SIGN_Y=680
YOUSIGN_SIGN_WIDTH=180
YOUSIGN_SIGN_HEIGHT=60
```

**Seul point à calibrer** : les coordonnées `YOUSIGN_SIGN_*` du champ de
signature (page + x/y), à régler une fois sur un PDF rendu de test.

### Prod Vercel

`next.config.ts` embarque le template dans les lambdas via
`outputFileTracingIncludes` (sinon `fs.readFileSync` → ENOENT en serverless).

### UI admin

Boutons ajoutés dans `AdminOnboardingTable.tsx` :
« 📄 Générer tous les contrats » (batch) + par ligne « 📄 Contrat » (génère &
ouvre le .docx) et « ✍️ Signature » (génère & envoie en signature).

## Régénérer le template (si le contrat de fond change)

Le template dérive du contrat V2 de Diara. Recette dans `public/legal/` :
1. `_make_template.py` — retire Art. 8 / 8 bis + pose les placeholders `[ ]`
   (produit `contrat-mandat-FONDATEUR-MODELE-eurealimmo.docx`).
2. `_make_tpl.py` — convertit les `[ ]` en tags `{ }`
   (produit `templates/contrat-mandat-fondateur.template.docx`).

(Ces scripts utilisent le skill `docx` : unpack → édition XML → pack.)
