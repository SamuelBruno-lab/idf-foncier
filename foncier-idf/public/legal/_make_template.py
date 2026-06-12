# -*- coding: utf-8 -*-
"""Transforme le contrat V2 de Diara en MODELE FONDATEUR reutilisable.
- Retire entierement Article 8 (prime de cession) et Article 8 bis (preemption)
- Remplace les elements propres a Diara par des placeholders [ ]
- Neutralise le preambule (HSBC, test mai 2026) et la sous-marque COLLABIMO
"""
import io, sys

SRC = r"C:\Users\PC\workspace\idf-foncier\foncier-idf\public\legal\_unpacked_v2\word\document.xml"

with io.open(SRC, "r", encoding="utf-8") as f:
    xml = f.read()

def rep(old, new, n=1):
    global xml
    c = xml.count(old)
    assert c == n, "ATTENDU %d, TROUVE %d pour: %s" % (n, c, old[:80])
    xml = xml.replace(old, new)

def cut(start_marker, end_marker):
    """Supprime du debut de start_marker jusqu'au debut de end_marker (exclu)."""
    global xml
    i = xml.index(start_marker)
    j = xml.index(end_marker)
    assert i < j, "marqueurs inverses"
    xml = xml[:i] + xml[j:]

# ---------------------------------------------------------------------------
# 1) Champs d'identite / en-tete / signature
# ---------------------------------------------------------------------------
rep("<w:t>En date du 02/06/2026</w:t>",
    "<w:t>En date du [DATE]</w:t>")
rep("<w:t>Le Mandataire — Diara CAMARA</w:t>",
    "<w:t>Le Mandataire — [PRÉNOM NOM du Fondateur]</w:t>")
rep("<w:t>CAMARA</w:t>", "<w:t>[NOM]</w:t>")
rep("<w:t>Diara</w:t>", "<w:t>[PRÉNOM]</w:t>")
rep("<w:t>diara.camara@collabimo.com</w:t>",
    "<w:t>[adresse électronique du Fondateur]</w:t>")
rep("<w:t>COLLABIMO (sous-marque préservée)</w:t>",
    "<w:t>[Marque/sous-marque éventuelle du Fondateur — facultatif]</w:t>")
rep("<w:t>Ci-après dénommée « le Mandataire » ou « Diara CAMARA »,</w:t>",
    "<w:t>Ci-après dénommé(e) « le Mandataire » ou « [PRÉNOM NOM] »,</w:t>")
rep("<w:t>Mme Diara CAMARA</w:t>", "<w:t>[PRÉNOM NOM]</w:t>")
rep("<w:t>FAIT A PARIS, le 01 Juin 2026</w:t>",
    "<w:t>FAIT À PARIS, le [DATE]</w:t>")

# ---------------------------------------------------------------------------
# 2) Preambule : parcours (HSBC) -> neutre
# ---------------------------------------------------------------------------
rep(
"<w:t>Le Mandataire, ex-banquière privée chez HSBC France, est une professionnelle de la transaction immobilière haut de gamme dont la clientèle cible comprend des personnes physiques ou morales détenant un patrimoine immobilier significatif (HNWI au sens de l'article 7.4 du présent contrat). Elle exercé actuellement son activité d'agent commercial sous l'attestation rattachée a la carte T d'une société tierce et entend, dans le cadre du présent contrat, basculer son rattachement auprès du Mandant pour bénéficier de ses conditions tarifaires, de sa plateforme technologique propriétaire et de la possibilité de co-fonder l'identité haut de gamme du nouveau réseau émergent.</w:t>",
"<w:t>Le Mandataire est un(e) professionnel(le) de la transaction immobilière dont la clientèle cible comprend des personnes physiques ou morales détenant un patrimoine immobilier significatif (HNWI au sens de l'article 7.4 du présent contrat). [Le cas échéant, préciser ici le parcours et la spécialité du Mandataire.] Le Mandataire entend, dans le cadre du présent contrat, rattacher son activité d'agent commercial auprès du Mandant pour bénéficier de ses conditions tarifaires, de sa plateforme technologique propriétaire et de la possibilité de co-fonder l'identité du nouveau réseau émergent.</w:t>")

# ---------------------------------------------------------------------------
# 3) Preambule : sous-marque COLLABIMO -> generique
# ---------------------------------------------------------------------------
rep(
"<w:t>Le Mandataire conserve, sous sa propre responsabilité et a ses propres frais, l'exploitation commerciale de la marque COLLABIMO en qualité de fondatrice et représentante légale, sans que cette circonstance constitué un conflit d'intérêts avec son activité d'agent commercial rattaché au Mandant, dès lors qu'elle s'engagé par le présent contrat a une exclusivité d'activité d'agent commercial immobilier sur le territoire français (article 7.1).</w:t>",
"<w:t>Le Mandataire conserve, le cas échéant, sous sa propre responsabilité et à ses propres frais, l'exploitation commerciale de sa propre marque ou sous-marque [MARQUE/SOUS-MARQUE éventuelle], sans que cette circonstance constitue un conflit d'intérêts avec son activité d'agent commercial rattaché au Mandant, dès lors qu'il/elle s'engage par le présent contrat à une exclusivité d'activité d'agent commercial immobilier sur le territoire français (article 2.3).</w:t>")

# ---------------------------------------------------------------------------
# 4) Preambule : designation n°1 + refs articles (suppr. 7.8 et 8bis)
# ---------------------------------------------------------------------------
rep(
"<w:t>Suite à une phase de test de la solution DATAMERRY® réalisée par le Mandataire en mai 2026 ayant donne lieu à un retour formel positif date du 27 mai 2026, et compte tenu de la qualité stratégique du profil du Mandataire pour le lancement commercial du réseau « EUREALIMMO RESEAU », les Parties se sont rapprochées et conviennent par les présentes que le Mandataire est désigné « Associée Fondatrice Mandataire n° 1 » du Mandant, statut bénéficiant des conditions privilégiées exposées aux articles 6.3,  7.8 et 8bis ci-après.</w:t>",
"<w:t>Compte tenu de la qualité stratégique du profil du Mandataire pour le lancement commercial du réseau « EUREALIMMO RESEAU », les Parties se sont rapprochées et conviennent par les présentes que le Mandataire est désigné « Associé(e) Fondateur(trice) Mandataire n° [N° FONDATEUR] » du Mandant, statut bénéficiant des conditions privilégiées exposées aux articles 6.3 et 7 ci-après (franchise d'abonnement et commission de parrainage majorée).</w:t>")

# ---------------------------------------------------------------------------
# 5) Art. 5.3 co-branding nominatif -> generique
# ---------------------------------------------------------------------------
rep(
"<w:t>Le Mandant s'engage à faire figurer, sur chaque rapport vendeur automatiquement génère par DATAMERRY® à la demande du Mandataire, la mention « Diara CAMARA × EUREALIMMO RESEAU » en page de garde et le logo COLLABIMO en pied de page, sous réserve des règlements d'usage raisonnable de l'image et de la marque. Le Mandant s'engage également à citer nommément le Mandataire en qualité d&#x2019;associée Fondatrice n° 1 dans toute communication presse, conférence ou publication relative au lancement d'EUREALIMMO RESEAU au cours des douze (12) premiers mois du contrat.</w:t>",
"<w:t>Le Mandant s'engage à faire figurer, sur chaque rapport vendeur automatiquement génère par DATAMERRY® à la demande du Mandataire, la mention « [PRÉNOM NOM] × EUREALIMMO RESEAU » en page de garde et, le cas échéant, le logo de la marque ou sous-marque du Mandataire [MARQUE/SOUS-MARQUE] en pied de page, sous réserve des règlements d'usage raisonnable de l'image et de la marque. Le Mandant s'engage également à citer nommément le Mandataire en qualité d&#x2019;Associé(e) Fondateur(trice) n° [N° FONDATEUR] dans toute communication presse, conférence ou publication relative au lancement d'EUREALIMMO RESEAU au cours des douze (12) premiers mois du contrat.</w:t>")

# --- Art. 2.3 : activites autorisees (sous-marque COLLABIMO) -> generique
rep(
"<w:t>Demeurent expressément autorisées : (i) l'exploitation de la marque commerciale COLLABIMO en tant que sous-marque du Mandataire, sans activité de transaction immobilière autonome ; (ii) toute activité de conseil financier ou patrimonial non concurrente ; (iii) toute activité d'enseignement, conférence ou publication sur l'immobilier.</w:t>",
"<w:t>Demeurent expressément autorisées : (i) l'exploitation de la marque ou sous-marque éventuelle du Mandataire [MARQUE/SOUS-MARQUE], en tant que sous-marque, sans activité de transaction immobilière autonome ; (ii) toute activité de conseil financier ou patrimonial non concurrente ; (iii) toute activité d'enseignement, conférence ou publication sur l'immobilier.</w:t>")

# ---------------------------------------------------------------------------
# 6) Genericisation des designations "Associee Fondatrice" (genre neutre)
# ---------------------------------------------------------------------------
rep("<w:t>6.3 — Franchise de six mois (Associée Fondatrice)</w:t>",
    "<w:t>6.3 — Franchise de six mois (Associé(e) Fondateur(trice))</w:t>")
rep("d&#x2019;Associée Fondatrice, le Mandataire peut présenter",
    "d&#x2019;Associé(e) Fondateur(trice), le Mandataire peut présenter")
rep("<w:t>7.2 — Bareme de l'Associée Fondatrice (statut unique)</w:t>",
    "<w:t>7.2 — Barème de l'Associé(e) Fondateur(trice) (statut unique)</w:t>")
rep("Le Mandataire (Associée Fondatrice) ne perçoit",
    "Le Mandataire (Associé(e) Fondateur(trice)) ne perçoit")

# ---------------------------------------------------------------------------
# 7) SUPPRESSION des blocs Article 8 + Article 8 bis (2557 -> 3501)
#    et de la ref croisee 13 ter.2 (v) (4420 -> 4437)
# ---------------------------------------------------------------------------
assert xml.count('w14:paraId="55CFF98D"') == 1
assert xml.count('w14:paraId="59C0BCD8"') == 1
cut('<w:p w14:paraId="55CFF98D"', '<w:p w14:paraId="59C0BCD8"')

assert xml.count('w14:paraId="0EE0E4C0"') == 1
assert xml.count('w14:paraId="64B46068"') == 1
cut('<w:p w14:paraId="0EE0E4C0"', '<w:p w14:paraId="64B46068"')

# Verifs finales : plus aucune trace nominative ou de clause exclusive
for forbidden in ("Diara", "CAMARA", "COLLABIMO", "HSBC", "ARTICLE 8",
                  "8 bis", "8bis", "prime de cession", "préemption"):
    assert forbidden not in xml, "RESTE: %s" % forbidden

with io.open(SRC, "w", encoding="utf-8") as f:
    f.write(xml)

print("OK - transformations appliquees, document.xml ecrit")
