"""
Brief Q&A complet pour le call avec Diara, intégrant toutes les
nouveautés depuis la v1 :
  - Article 11 bis (propriété data Collabimo vs Eurealimmo)
  - Article 11 ter (lead routing, contrôle exclusif Diara)
  - Article 12 (PI = DATAMERRY SAS)
  - Article 16.1 (techno-neutre Bitcoin/Solana)
  - Article 16.6 ter (société en formation + subsidiarité 4 mois)
  - Article 8.3 (prime cession SANS PLAFOND)
  - Articles 13 bis/ter/quater (Pack PROTECTION)
  - DPA RGPD séparé
  - MVP lead routing déployé

Format : 3 pages A4 PDF, Q&A + arguments + plan signature.
"""

from datetime import date
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent
OUTPUT = HERE / "brief-call-diara-v2.pdf"

# Couleurs marque
DM_DARK = HexColor("#064E3B")
DM_GREEN = HexColor("#10B981")
GOLD = HexColor("#C8A25D")
SOLANA = HexColor("#9945FF")
GREY = HexColor("#64748B")
LIGHT_GREY = HexColor("#F1F5F9")
BLACK = HexColor("#0F172A")
HIGHLIGHT = HexColor("#FEF3C7")
RED = HexColor("#DC2626")

W, H = A4


def safe_text(text):
    """ASCII-safe replacement for problematic chars in built-in fonts."""
    # Smart quotes, ellipsis, em-dash, etc.
    replacements = {
        "→": "->",  # right arrow
        "←": "<-",  # left arrow
        "✓": "OK",  # check mark
        "✗": "X",   # X mark
        "•": "*",   # bullet
        "…": "...", # ellipsis
        "—": "--",  # em-dash
        "–": "-",   # en-dash
        "“": '"',   # left double quote
        "”": '"',   # right double quote
        "‘": "'",   # left single quote
        "’": "'",   # right single quote
        " ": " ",   # non-breaking space
        "€": "EUR", # euro sign (Helvetica handles it but safety)
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def draw_section_title(c, x, y, text, color=DM_DARK, size=11):
    c.setFillColor(color)
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, safe_text(text))


def draw_text_wrap(c, x, y, text, width_mm, font="Helvetica", size=9, color=BLACK, line_height=4):
    c.setFillColor(color)
    c.setFont(font, size)
    # Simple word wrap
    words = safe_text(text).split()
    line = ""
    lines = []
    max_chars = int(width_mm * 2.5)  # heuristic
    for word in words:
        if len(line) + len(word) + 1 > max_chars:
            lines.append(line)
            line = word
        else:
            line = (line + " " + word) if line else word
    if line:
        lines.append(line)
    for ln in lines:
        c.drawString(x, y, ln)
        y -= line_height * mm
    return y


def draw_qa(c, x, y, question, answer, q_color=DM_DARK, a_color=BLACK, width_mm=170):
    """Affiche Q + R avec wrap."""
    c.setFillColor(q_color)
    c.setFont("Helvetica-Bold", 9.5)
    # Question peut tenir sur 2 lignes
    q_lines_max = 80
    if len(question) > q_lines_max:
        # Split en deux
        mid = question[:q_lines_max].rfind(" ")
        l1 = question[:mid]
        l2 = question[mid+1:]
        c.drawString(x, y, safe_text("Q. " + l1))
        y -= 4 * mm
        c.drawString(x, y, safe_text("   " + l2))
        y -= 4 * mm
    else:
        c.drawString(x, y, safe_text("Q. " + question))
        y -= 4 * mm
    # Réponse
    y -= 0.5 * mm
    y = draw_text_wrap(c, x + 5*mm, y, "R. " + answer,
                       width_mm=width_mm, font="Helvetica", size=8.5,
                       color=a_color, line_height=3.8)
    y -= 1.5 * mm
    return y


def main():
    c = canvas.Canvas(str(OUTPUT), pagesize=A4)

    # ============== PAGE 1 — HEADER + Q&A 1-7 ==============
    # Bandeau
    c.setFillColor(DM_DARK)
    c.rect(0, H - 18 * mm, W, 18 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(20 * mm, H - 11 * mm, "BRIEF CALL DIARA v2 -- Q&A ANTICIPATION")
    c.setFillColor(HexColor("#FFFFFF"))
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, H - 15.5 * mm, "Eurealimmo Reseau x Collabimmo -- Cheat sheet 3 pages")
    c.drawRightString(W - 20 * mm, H - 15.5 * mm,
                       f"v2 -- {date.today().strftime('%d/%m/%Y')}")

    y = H - 24 * mm

    # Intro
    c.setFillColor(BLACK)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(20 * mm, y, "OBJECTIFS DU CALL")
    y -= 4 * mm
    c.setFont("Helvetica", 8.5)
    for line in [
        "1. Valider le contrat final7 (23 pages) + le DPA RGPD (5 pages) en seance.",
        "2. Convenir d'une date de signature (target : cette semaine).",
        "3. Lui presenter les 4 simulateurs (revenus, prime cession, lead routing).",
        "4. Recolter ses feedbacks sur Lead Routing -- on ajuste s'il y a besoin.",
    ]:
        c.drawString(22 * mm, y, safe_text(line))
        y -= 3.5 * mm

    y -= 3 * mm
    draw_section_title(c, 20 * mm, y, "Q&A 1/3 -- LE CONTRAT")
    y -= 5 * mm

    qa_block_1 = [
        ("Pourquoi 36 mois de duree ferme ? J'aimerais pouvoir sortir avant si ca ne marche pas.",
         "Tu peux sortir avec preavis 3 mois apres M12 (art 15.1). Tu peux aussi resilier sans indemnite "
         "pendant la mise en sommeil (art 13 ter) ou si je romps anticipe avant ta 1re vente (art 13 bis -- 300 EUR forfait). "
         "Le 36 mois sert UNIQUEMENT au verrouillage TARIFAIRE (art 6.4) : pendant 36 mois, je NE PEUX PAS te re-tarifer, indexer, "
         "majorer. Tu es protegee contre toute hausse. Ce n'est pas une prison."),

        ("Si tu fermes Eurealimmo a cause d'un probleme de tresorerie, je touche quoi ?",
         "Avant ta 1re vente : 300 EUR forfaitaires (art 13 bis.3). Apres ta 1re vente : indemnite L134-12 (art 13). "
         "Mais 95 % du temps on activera l'art 13 ter -- mise en sommeil 12 mois, contrat suspendu, 0 EUR de cote a cote. "
         "On reprend quand je rebondis. C'est gagnant pour les deux."),

        ("Et si MOI je deviens inactive (vie perso, maternite, projet annexe) ?",
         "Tu as 12 mois pour faire au moins UNE vente OU UN refere qualifie (art 13 quater). "
         "Apres, on peut mettre fin amiablement sans indemnite -- c'est equilibre avec mon art 13 ter. "
         "Force majeure (maternite, maladie longue, accident) suspend le delai automatiquement -- art 1218 Code civil."),

        ("Mes leads Collabimo sont a moi ou a toi ?",
         "100 % a TOI tant qu'il n'y a pas de mandat signe (art 11 bis.1). C'est ton site, ton trafic, "
         "tes prospects -- tu es responsable de traitement RGPD. Si tu pars un jour, tu repars avec tous tes leads en CSV. "
         "Le mandat de vente, lui, est legalement attache a la carte T Eurealimmo (loi Hoguet) -- c'est la regle pour "
         "tous les reseaux (SAFTI, IAD, Capifrance) sans exception."),

        ("Comment je peux etre sure que vous ne revendrez pas mes leads a un autre cabinet ?",
         "L'article 11 ter.6 nous interdit EXPRESSEMENT de transferer / vendre / exploiter tes leads a "
         "un tiers concurrent, pendant la duree du contrat ET pendant 12 mois apres. Le DPA RGPD signe en parallele "
         "renforce cette interdiction avec une sanction de 10x l'abonnement annuel en cas de manquement."),

        ("Le module de routing des leads va pas attribuer mes prospects a d'autres mandataires sans mon accord ?",
         "Non. Article 11 ter.3 : aucun lead ne peut etre attribue a un tiers sans TON arbitrage explicite. "
         "Tu vois la liste des matches proposes par le systeme, et tu choisis : (a) je garde, (b) j'attribue a X, "
         "(c) je matche acheteur/vendeur, (d) je passe. Le systeme propose, tu disposes. Tu controles aussi tous "
         "les parametres (rayons, mode adaptatif) depuis ton interface admin -- art 11 ter.2."),

        ("Vos donnees sont vraiment anonymisees ? Comment je peux le verifier ?",
         "Architecture : base PII (avec ton acces unique) STRICTEMENT separee de base anonymisee (modeles statistiques). "
         "Aucun foreign key, aucun join possible. K-anonymisation k>=5 sur toute statistique publiee. "
         "Localisation 100 % UE (Supabase Frankfurt, Vercel Frankfurt). Audit annuel possible par toi. "
         "Tout est dans le DPA art 4. Et on ancrera mensuellement le hash des logs sur Bitcoin via Open Timestamps "
         "(preuve cryptographique opposable a un juge)."),
    ]

    for q, a in qa_block_1:
        y = draw_qa(c, 20 * mm, y, q, a)

    # Footer page 1
    c.setFillColor(GREY)
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawString(20 * mm, 12 * mm,
                  "Eurealimmo SARL -- SIREN 984 449 470 -- Carte T CPI 7501 2024 000 219")
    c.drawRightString(W - 20 * mm, 12 * mm, "Page 1/3")

    c.showPage()

    # ============== PAGE 2 — Q&A 8-14 ==============
    c.setFillColor(DM_DARK)
    c.rect(0, H - 13 * mm, W, 13 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, H - 8 * mm, "Q&A 2/3 -- MONNAIE, EXIT, BLOCKCHAIN")

    y = H - 20 * mm

    qa_block_2 = [
        ("Concretement Y1, je touche combien si je fais 0 vente ?",
         "Tu cumules referral fees a vie sur les filleuls que tu signes (20 % HNWI, 15 % Standard, paye sur les commissions "
         "qu'ils generent). Pas de minimum garanti -- mais 0 vente + 0 refere = art 13 quater, on stoppe a M12. "
         "Realiste : avec 1-2 ventes HNWI/an + 3-5 fondateurs recrutes, tu fais 80-200 k EUR Y1 (simulateur en ligne)."),

        ("Combien tu prends si je vends ? Et le bonus signature, ca marche comment ?",
         "Eurealimmo retient 5 % HT sur tes commissions encaissees (art 6.1). Sur tes 95 % nets, "
         "tu deduis 59 EUR/mois forfait apres 6 mois de gratuite. Bonus signature : 200 EUR HT en credits DATAMERRY "
         "par filleul Standard signe (utilisable sur ton abonnement). Le tout payable J+7 ouvres post-encaissement notaire (art 6.5)."),

        ("Si vous vendez Eurealimmo dans 3 ans, je touche combien ?",
         "Paliers SANS PLAFOND (art 8.3 -- exclusif Associee Fondatrice n 1) : 5 unites = 5 %, 10 = 6 %, 15 = 7 %, "
         "20 + 3 HNWI mini = 9 % du Produit Net. Une vente HNWI = 1 unite ; 5 Standards = 1 unite. "
         "Exemple : cession 10 M EUR Net + tu as 20 unites + 3 HNWI actifs = 900 k EUR pour toi. Cession 20 M EUR = 1,8 M EUR."),

        ("Et la blockchain Solana dans le contrat, c'est realiste ou marketing ?",
         "Article 16.1 est volontairement TECHNO-NEUTRE. Phase 1 = Open Timestamps Bitcoin (deployable immediatement, "
         "gratuit, standard W3C). Phase 2 = eventuellement Solana si pertinent ROI. Bitcoin est techniquement plus solide "
         "que Solana pour de la notarisation (consensus PoW, 16 ans d'historique). Argument commercial = 'ancrage blockchain' "
         "tout court, on n'engage rien sur le L1 specifique."),

        ("Le module DATAMERRY n'est pas a Eurealimmo, c'est qui le proprio ?",
         "DATAMERRY SAS, societe distincte en cours de constitution (cf art 16.6 ter). Si elle n'est pas immatriculee "
         "sous 4 mois, je reprends la PI personnellement (M. Samuel BRUNO). C'est l'art 12 du contrat. "
         "Effet pour toi : nul -- tu beneficies de la sous-licence via Eurealimmo (cascade art 12 paragraphe 3). "
         "Mais ca veut dire que si demain je vends DATAMERRY SAS comme techno seule (PropTech), ca ne declenche pas "
         "ta prime de cession (exclusion art 8.2 bis). C'est ma protection d'exit."),

        ("Le droit de preemption (article 8 bis) il etait dans la v3, je l'avais retire. Tu peux le remettre ?",
         "Si tu veux je le remets en final8 -- ca te donne ROFO 90 jours + ROFR 60 jours sur tout rachat Eurealimmo. "
         "Tu peux meme te financer avec un fonds tant que tu gardes >=40 % du capital acquereur. C'etait un cadeau massif. "
         "On peut le re-ajouter en 10 min apres le call."),

        ("Si je signe et que dans 3 mois je veux modifier des clauses, c'est possible ?",
         "On peut faire un avenant signe par les 2 parties a tout moment. Toi tu peux aussi demander une mediation "
         "(art 17 du contrat) en cas de desaccord. Et tu as l'art 13 bis (resiliation par convenance) qui te permet "
         "de sortir si vraiment ca ne convient plus -- avec preavis et indemnite forfaitaire 300 EUR avant ta 1re vente."),
    ]

    for q, a in qa_block_2:
        y = draw_qa(c, 20 * mm, y, q, a)

    c.setFillColor(GREY)
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawString(20 * mm, 12 * mm,
                  "Brief call Diara v2 -- confidentiel")
    c.drawRightString(W - 20 * mm, 12 * mm, "Page 2/3")

    c.showPage()

    # ============== PAGE 3 — ARGUMENTS + ROADMAP + PLAN ==============
    c.setFillColor(DM_DARK)
    c.rect(0, H - 13 * mm, W, 13 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, H - 8 * mm, "ARGUMENTS KILLER + ROADMAP DEV + PLAN SIGNATURE")

    y = H - 20 * mm

    # --- 5 arguments killer ---
    draw_section_title(c, 20 * mm, y, "5 ARGUMENTS KILLER A REPETER")
    y -= 5 * mm

    arguments = [
        ("AUCUN AUTRE RESEAU NE DONNE 95 % de retrocession.",
         "Olean 92, SAFTI 80-90, IAD 65-80, Capifrance 65-80. Tu es au top du marche."),
        ("Tu paies 0 EUR pendant 6 mois.",
         "Franchise totale art 6.3, soit 354 EUR HT consentis. Aucun reseau ne fait ca."),
        ("Tu touches A VIE sur tes fondateurs.",
         "20 % HNWI, 15 % Standard -- art 7.2. Olean 6-7 % limite 24 mois."),
        ("Prime de cession SANS PLAFOND.",
         "Sky is the limit -- art 8.3. Exit 10 M = tu touches 500 k a 900 k EUR selon ton palier."),
        ("Tu controles TOUS tes leads.",
         "Article 11 ter -- tu paramines les rayons, tu arbites les attributions, on ne touche jamais sans toi."),
    ]
    for arg, det in arguments:
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(22 * mm, y, safe_text("> " + arg))
        y -= 3.8 * mm
        c.setFillColor(GREY)
        c.setFont("Helvetica", 8)
        c.drawString(26 * mm, y, safe_text(det))
        y -= 4.5 * mm

    # --- Roadmap dev ---
    y -= 3 * mm
    draw_section_title(c, 20 * mm, y, "ROADMAP DEV PHASE 1 (compliance RGPD) -- juillet 2026", color=DM_GREEN)
    y -= 5 * mm

    c.setFillColor(BLACK)
    c.setFont("Helvetica", 8.5)
    for line in [
        "* Page /legal/anonymisation (transparence publique) -- 1h",
        "* Table audit_pii_access Supabase + RLS -- 1h",
        "* Middleware Next.js logs d'acces PII -- 2-3h",
        "* Endpoint export CSV/JSON pour Diara -- 2h",
        "* K-anonymisation des stats (validation HAVING COUNT >= 5) -- 2h",
        "* Notification violation < 72h (cron Resend) -- 2h",
        "TOTAL ~12h sur 2-3 jours. Livre avant fin juillet.",
    ]:
        c.drawString(22 * mm, y, safe_text(line))
        y -= 3.5 * mm

    # --- Roadmap Phase 2 ---
    y -= 2 * mm
    draw_section_title(c, 20 * mm, y, "ROADMAP DEV PHASE 2 (Open Timestamps Bitcoin) -- aout 2026", color=SOLANA)
    y -= 5 * mm

    c.setFillColor(BLACK)
    c.setFont("Helvetica", 8.5)
    for line in [
        "* Script Python cron mensuel : hash logs + submit OpenTimestamps -- 4h",
        "* Storage .ots dans Supabase Storage public -- 1h",
        "* Page /legal/audit-public avec liste verifiable -- 3h",
        "* Cron mensuel 1er du mois 3h00 du matin -- 30 min",
        "TOTAL 1-2 jours. Cout ancrage = 0 EUR (serveurs OpenTimestamps publics).",
    ]:
        c.drawString(22 * mm, y, safe_text(line))
        y -= 3.5 * mm

    # --- Plan signature ---
    y -= 3 * mm
    draw_section_title(c, 20 * mm, y, "PLAN SIGNATURE", color=RED)
    y -= 5 * mm

    plan = [
        "1. Diara lit le pack (1-2 j) -- 5 documents PDF",
        "2. Tu refais 1 call pour eventuels ajustements -- 1h",
        "3. Si OK -> signature electronique via DocuSign / Yousign -- 15 min",
        "4. Tu envoies dossier CCI Paris (50 EUR + photos B3 + RSAC + RCP)",
        "5. Onboarding 10 etapes -- 4-6 semaines",
    ]
    c.setFillColor(BLACK)
    c.setFont("Helvetica", 8.5)
    for line in plan:
        c.drawString(22 * mm, y, safe_text(line))
        y -= 3.5 * mm

    # --- Encart final ---
    y -= 4 * mm
    c.setFillColor(HIGHLIGHT)
    c.rect(20 * mm, y - 18 * mm, W - 40 * mm, 18 * mm, fill=1, stroke=0)
    c.setStrokeColor(GOLD)
    c.rect(20 * mm, y - 18 * mm, W - 40 * mm, 18 * mm, fill=0, stroke=1)

    c.setFillColor(DM_DARK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(22 * mm, y - 4 * mm, "RAPPEL : TU ES EN POSITION DE FORCE")
    c.setFillColor(BLACK)
    c.setFont("Helvetica", 8)
    for i, line in enumerate([
        "Diara a besoin d'une carte T pour pouvoir signer des mandats. Tu en as une.",
        "Diara a besoin de tech pour son routing. Tu as DATAMERRY.",
        "Diara a besoin d'un partenaire credible. BPIFrance ne suffit pas, il faut un titulaire carte T serieux.",
        "Tu es lui-meme l'argument. Pas besoin de te rabaisser sur les conditions.",
    ]):
        c.drawString(22 * mm, y - (8 + 3 * i) * mm, safe_text("* " + line))

    c.setFillColor(GREY)
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawString(20 * mm, 12 * mm,
                  "Brief call Diara v2 -- a relire 1h avant le call")
    c.drawRightString(W - 20 * mm, 12 * mm, "Page 3/3")

    c.save()
    print(f"OK -> {OUTPUT}")


if __name__ == "__main__":
    main()
