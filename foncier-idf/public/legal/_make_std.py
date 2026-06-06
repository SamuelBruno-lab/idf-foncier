# -*- coding: utf-8 -*-
"""Derive le TEMPLATE STANDARD depuis le MODELE fondateur.
Retire : franchise 6.3, verrouillage 6.4, bonus fidelite 9.3, referral fondateur.
Ajuste : 95->92%, 5->8%, 59->79 EUR, duree 36 mois -> indeterminee, designations.
Ajoute : Article 7 standard (10%/12 mois/1 niveau). Puis convertit en tags {..}."""
import io, re

SRC = r"C:\Users\PC\workspace\idf-foncier\foncier-idf\public\legal\_std\word\document.xml"
xml = io.open(SRC, "r", encoding="utf-8").read()

def rep(old, new, n=1):
    global xml
    c = xml.count(old)
    assert c == n, "ATTENDU %d, TROUVE %d : %r" % (n, c, old[:70])
    xml = xml.replace(old, new)

def cut(start_id, end_id):
    global xml
    i = xml.find('<w:p ')
    # localise le <w:p ...paraId=start_id...>
    si = xml.find(start_id); sj = xml.find(end_id)
    assert si != -1 and sj != -1, "paraId introuvable %s %s" % (start_id, end_id)
    ps = xml.rfind('<w:p ', 0, si)
    pe = xml.rfind('<w:p ', 0, sj)
    assert ps < pe, "bornes inversees"
    xml = xml[:ps] + xml[pe:]

# --- 1) Suppressions de blocs (avant les remplacements de texte) ---
cut('717E531F', '0CF3644D')   # 6.3 Franchise + 6.4 Verrouillage
# Bloc Article 7 fondateur (0CF3644D -> 0A8B0001) : on l'enleve puis on insere le standard
cut('0CF3644D', '0A8B0001')
cut('54025E3D', '0F59FCDC')   # 9.3 Bonus de fidelite -> jusqu'a ARTICLE 10

# --- 2) Inserer l'Article 7 standard juste avant ARTICLE 8 [RESERVE] (0A8B0001) ---
def heading(txt):
    return ('<w:p><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/>'
            '<w:rPr><w:lang w:val="fr-FR"/></w:rPr></w:pPr>'
            '<w:r><w:rPr><w:b/><w:color w:val="064E3B"/><w:sz w:val="26"/>'
            '<w:lang w:val="fr-FR"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % txt)

def sub(txt):
    return ('<w:p><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/>'
            '<w:rPr><w:b/><w:lang w:val="fr-FR"/></w:rPr></w:pPr>'
            '<w:r><w:rPr><w:b/><w:color w:val="000000"/><w:lang w:val="fr-FR"/></w:rPr>'
            '<w:t xml:space="preserve">%s</w:t></w:r></w:p>' % txt)

def body(txt):
    return ('<w:p><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/>'
            '<w:jc w:val="both"/><w:rPr><w:lang w:val="fr-FR"/></w:rPr></w:pPr>'
            '<w:r><w:rPr><w:color w:val="000000"/><w:lang w:val="fr-FR"/></w:rPr>'
            '<w:t xml:space="preserve">%s</w:t></w:r></w:p>' % txt)

art7 = (
    heading("ARTICLE 7 — COMMISSION DE PARRAINAGE (REFERRAL FEE)")
    + sub("7.1 — Principe")
    + body("Le Mandataire peut présenter au Mandant d'autres professionnels de l'immobilier "
           "susceptibles de devenir, à leur tour, agents commerciaux rattachés à la carte T du "
           "Mandant. Pour chaque mandataire ainsi référencé et effectivement rattaché par "
           "signature d'un contrat de mandat avec le Mandant, le Mandataire perçoit une commission "
           "de parrainage selon les modalités ci-après.")
    + sub("7.2 — Barème (Niveau 1)")
    + body("Le Mandataire perçoit DIX POUR CENT (10 %) HT des commissions retenues par le Mandant "
           "sur les transactions de chaque mandataire qu'il a directement référencé (Niveau 1), "
           "versés pendant DOUZE (12) mois à compter de la signature du contrat de mandat du référé.")
    + sub("7.3 — Limitation à un seul niveau (anti-MLM)")
    + body("Le parrainage est strictement limité à UN (1) seul niveau (référés directs). Aucune "
           "commission n'est due au titre des référés de second niveau, afin d'exclure toute "
           "structure pyramidale ou de marketing à paliers multiples (MLM).")
    + sub("7.4 — Modalités de versement")
    + body("Les commissions de parrainage sont calculées à chaque encaissement effectif par le "
           "Mandant et versées par virement SEPA dans un délai maximum de SEPT (7) jours ouvrés, "
           "selon les mêmes modalités de bordereau détaillé qu'à l'article 6.5. Aucun versement "
           "n'est dû sur les commissions impayées, litigieuses ou ayant fait l'objet d'un retrait "
           "par le client vendeur.")
)
anchor = xml.rfind('<w:p ', 0, xml.find('0A8B0001'))
assert anchor != -1
xml = xml[:anchor] + art7 + xml[anchor:]

# --- 3) Remplacements de tokens (economie standard) ---
rep("Il est conclu pour une durée ferme initiale de TRENTE-SIX (36) mois calendaires, "
    "expressément verrouillée, pendant laquelle les conditions financières et "
    "organisationnelles définies aux articles 6, 7 et 8 demeurent invariables.",
    "Il est conclu pour une durée indéterminée, chacune des Parties pouvant y mettre fin "
    "à tout moment par lettre recommandée avec accusé de réception, moyennant un préavis "
    "d'UN (1) mois.")

rep("QUATRE-VINGT-QUINZE POUR CENT (95 %)", "QUATRE-VINGT-DOUZE POUR CENT (92 %)")
rep("CINQ POUR CENT (5 %)", "HUIT POUR CENT (8 %)")
rep("CINQUANTE-NEUF EUROS HORS TAXES (59,00 EUR HT/mois)",
    "SOIXANTE-DIX-NEUF EUROS HORS TAXES (79,00 EUR HT/mois)")

rep("présent contrat et au-delà des six (6) mois de franchise de l'article 6.3  , "
    "l'intégralité des modules",
    "présent contrat, l'intégralité des modules")

rep("est désigné « Associé(e) Fondateur(trice) Mandataire n° [N° FONDATEUR] » du "
    "Mandant, statut bénéficiant des conditions privilégiées exposées aux articles 6.3 et 7 "
    "ci-après (franchise d'abonnement et commission de parrainage majorée).",
    "est désigné « Mandataire » du Mandant, statut bénéficiant des conditions exposées "
    "aux articles 6 et 7 ci-après (rémunération réseau et commission de parrainage).")

rep("en qualité d&#x2019;Associé(e) Fondateur(trice) n° [N° FONDATEUR] dans toute communication",
    "en qualité de Mandataire dans toute communication")

# --- 4) Conversion placeholders -> tags docxtemplater ---
rep("[PRÉNOM NOM du Fondateur]", "{prenom} {nom}", 1)
rep("[PRÉNOM NOM]", "{prenom} {nom}", 3)
rep("[PRÉNOM]", "{prenom}", 1)
rep("[NOM]", "{nom}", 1)
rep("[DATE]", "{date_contrat}", 2)
rep("[adresse électronique du Fondateur]", "{email}", 1)
rep("[Marque/sous-marque éventuelle du Fondateur — facultatif]", "{marque}", 1)
rep("[MARQUE/SOUS-MARQUE éventuelle]", "{marque}", 1)
rep("[MARQUE/SOUS-MARQUE]", "{marque}", 2)
rep("[Le cas échéant, préciser ici le parcours et la spécialité du Mandataire.]", "{parcours}", 1)

# --- Verifications finales ---
for forbidden in ("[N° FONDATEUR]", "{numero_fondateur}", "Franchise de six",
                  "Verrouillage tarifaire", "Bonus de fidélité", "boule de neige",
                  "QUATRE-VINGT-QUINZE", "59,00 EUR", "TRENTE-SIX (36) mois"):
    assert forbidden not in xml, "RESTE: %s" % forbidden
tags = sorted(set(re.findall(r"\{[a-z_]+\}", xml)))
assert tags == ["{date_contrat}", "{email}", "{marque}", "{nom}", "{parcours}", "{prenom}"], tags

io.open(SRC, "w", encoding="utf-8").write(xml)
print("OK standard template, tags:", tags)
