# 🚀 DATAMERRY — Checklist déploiement & deal Diara

**À faire dans cet ordre. ~45 min total.**

---

## ⏱️ Étape 1 — Vérifier le build Vercel (1 min)

Va sur **[vercel.com/brunos-projects-9a949383/idf-foncier/deployments](https://vercel.com/brunos-projects-9a949383)** et regarde le statut du commit **`e3e82ba`** (le dernier).

- ✅ **Ready** → continue à l'étape 2
- ❌ **Error** → envoie-moi le log, je corrige

---

## ⏱️ Étape 2 — Fixer le warning Supabase Vercel (2 min)

1. Clique sur le warning **`SUPABASE_SERVICE_ROLE_KEY`** "Needs Attention" sur Vercel
2. Lis ce que Vercel dit (souvent format invalide ou key déconnectée)
3. Va sur **[Supabase Dashboard](https://supabase.com/dashboard)** → ton projet → ⚙️ Settings → API
4. Copie la valeur **`service_role`** (la clé secrète, pas la `anon`)
5. Vercel : Edit la variable → colle (sans espaces avant/après) → Save
6. Vérifie aussi `NEXT_PUBLIC_SUPABASE_URL` :
   - Doit être : `https://xxxxx.supabase.co`
   - **PAS** `https://xxxxx.supabase.co/rest/v1/` ni avec slash final

---

## ⏱️ Étape 3 — Récupérer ta Postgres URI Supabase (1 min)

1. Supabase Dashboard → ton projet → ⚙️ Settings → **Database**
2. Section "Connection string" → onglet **URI** → mode **Session**
3. Tu obtiens quelque chose du genre :
   ```
   postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```
4. Remplace `[YOUR-PASSWORD]` par ton vrai mot de passe DB Supabase
   (celui que tu as choisi à la création du projet — Settings → Database → "Reset database password" si oublié)

Garde cette URI sous la main pour l'étape 4.

---

## ⏱️ Étape 4 — Lancer le setup automatique (3 min)

```powershell
cd C:\Users\PC\workspace\idf-foncier\foncier-idf

# Installer psycopg si pas déjà fait
python -m pip install "psycopg[binary]"

# Lancer le script qui fait TOUT en automatique
python scripts/setup-datamerry.py
```

Le script va :
- ✅ Demander ta Postgres URI (entrée masquée)
- ✅ Appliquer `sql/22_api_keys.sql` + `23_property_report_cache.sql` + `24_widget_keys.sql`
- ✅ Vérifier que tout est créé
- ✅ Émettre **1 clé serveur** (`dmk_live_…`) et **1 clé widget** (`wdmk_live_…`) pour Collabimmo
- ✅ Afficher les snippets HTML prêts à envoyer
- ✅ Sauvegarder un backup local `.collabimmo-keys-backup.txt` (ne PAS committer)

**Copie les clés et les snippets affichés.** Ils ne sont plus jamais affichables après.

---

## ⏱️ Étape 5 — Ajouter le backup au gitignore (10 sec)

```powershell
cd C:\Users\PC\workspace\idf-foncier
"foncier-idf/.collabimmo-keys-backup.txt" >> .gitignore
git add .gitignore
git -c user.email=SamuelBruno-lab@users.noreply.github.com -c user.name="Samuel BRUNO" commit -m "chore: gitignore le backup local des clés Collabimmo"
git push
```

---

## ⏱️ Étape 6 — Compléter l'avenant pilote (5 min)

Ouvre `foncier-idf/public/legal/avenant-pilote-collabimmo.docx` dans Word et complète :
- `[N° KBIS à compléter]` → ton RCS Eurealimmo
- `[Forme juridique à compléter]` + `[Capital]` + `[Siège social]` + `[RCS]` pour Collabimmo → demande à Diara
- `[Fonction]` Diara → Gérante / Présidente selon sa forme juridique

Garde le `.docx` pour signature par DocuSign / Yousign / impression.

---

## ⏱️ Étape 7 — Message WhatsApp à envoyer à Diara (1 min)

Copie-colle ce qui suit (en remplaçant `dmk_live_xxx` et `wdmk_live_xxx` par tes vraies clés affichées par le script) :

```
Hello Diara 👋

Comme promis, voilà tout ce qu'il te faut pour intégrer DATAMERRY chez Collabimmo. Toutes ces conditions sont formalisées dans l'avenant pilote en pièce jointe (PDF) — premier mois offert, tarif gelé 39€ TTC/mo à vie sur le périmètre v1.

🔹 1. CHATBOT IA conversationnel (le plus impressionnant à montrer en démo)
   https://datamerry.com/chatbot?key=wdmk_live_xxx&cabinet=Collabimmo&color=%23c2410c

   Tu poses des questions en langage naturel ("Estime le 10 rue de la Paix 75002, 60m², TMI 41%, meilleur dispositif?") et l'IA répond avec estim + rendement + 8 stratégies + recommandation.

🔹 2. WIDGET RAPPORT à intégrer sur ton site Collabimmo (4 lignes HTML)
   <script src="https://datamerry.com/widget.js" async></script>
   <div data-datamerry-report
        data-key="wdmk_live_xxx"
        data-address="10 rue de Rivoli 75001"
        data-surface="62"
        data-color="#c2410c"></div>

🔹 3. CHATBOT EMBED sur ton site (4 lignes HTML — équivalent du lien #1 mais intégré)
   <script src="https://datamerry.com/chatbot.js" async></script>
   <div data-datamerry-chatbot
        data-key="wdmk_live_xxx"
        data-cabinet="Collabimmo"
        data-color="#c2410c"></div>

🔹 4. CLÉ SERVEUR (si ton dev veut faire des appels API custom / scripts / PDF brandés)
   dmk_live_xxx
   curl -H "X-API-Key: dmk_live_xxx" https://datamerry.com/api/property-report?address=...

🔹 5. RAPPORT PDF brandé Collabimmo (URL directe — clique pour télécharger)
   https://datamerry.com/api/property-report/pdf?address=10+rue+de+rivoli+75001&surface=62&color=%23c2410c&cabinet_name=Collabimmo

⚠️ Pour les widgets, ta clé wdmk_live_xxx ne fonctionne QUE depuis les domaines collabimmo.fr (anti-fraude). Pour tester en local, dis-moi ton domaine de dev je l'ajoute.

Quand tu auras 10 min, on cale un appel pour :
- Compléter ensemble l'avenant (KBIS / forme juridique Collabimmo)
- Tester le widget en live sur ton site
- Te parler de mon idée d'offre "combo carte T" 😉 (je suis titulaire depuis 2024 chez Eurealimmo, j'ai un truc à te proposer)

Samuel
```

Joindre le `.docx` avenant en pièce jointe.

---

## ⏱️ Étape 8 — Toi en personne (à faire dans la semaine)

### Lundi matin
- 📞 **Appel assureur** RC pro édition logiciel 26€/mo → souscription Eurealimmo (15 min)
- 💳 **Stripe** : créer compte Eurealimmo + KYC (30 min). Statement descriptor : "DATAMERRY"

### Mardi
- 🏢 **Domiciliation DATAMERRY SAS** : Sedomicilier 75008 (~30€/mo) si tu débloques le budget. Sinon, on continue Eurealimmo.

### Mercredi (quand tu as les Prix IDs Stripe)
- Me ping les 3 Prix IDs Stripe créés (`price_xxx_subscription`, `price_xxx_metered`, `price_xxx_pilot`)
- Je code #12 Stripe billing (1.5j) → ouverture commerciale self-serve sur datamerry.com/api

---

## 🔥 Si tu hésites devant un blocage, ping-moi :

- Build Vercel error → log → fix
- Erreur SQL setup → message → fix
- Diara pose une question technique → tu me forward

**Tu peux signer Diara dès demain matin.** Le tech est 100% prêt.
