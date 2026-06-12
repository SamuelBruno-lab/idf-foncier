# -*- coding: utf-8 -*-
"""Convertit le modele fondateur valide en TEMPLATE docxtemplater.
Remplace les placeholders [ ] par des tags {nom_de_champ}.
Laisse litterales les mentions de guidage ([a completer], [RESERVE], etc.)."""
import io

SRC = r"C:\Users\PC\workspace\idf-foncier\foncier-idf\public\legal\_tpl\word\document.xml"
xml = io.open(SRC, "r", encoding="utf-8").read()

def rep(old, new, n):
    global xml
    c = xml.count(old)
    assert c == n, "ATTENDU %d, TROUVE %d : %r" % (n, c, old)
    xml = xml.replace(old, new)

# Ordre : variantes les plus longues d'abord
rep("[PRÉNOM NOM du Fondateur]", "{prenom} {nom}", 1)
rep("[PRÉNOM NOM]", "{prenom} {nom}", 3)
rep("[PRÉNOM]", "{prenom}", 1)
rep("[NOM]", "{nom}", 1)
rep("[N° FONDATEUR]", "{numero_fondateur}", 2)
rep("[DATE]", "{date_contrat}", 2)
rep("[adresse électronique du Fondateur]", "{email}", 1)
rep("[Marque/sous-marque éventuelle du Fondateur — facultatif]", "{marque}", 1)
rep("[MARQUE/SOUS-MARQUE éventuelle]", "{marque}", 1)
rep("[MARQUE/SOUS-MARQUE]", "{marque}", 2)
rep("[Le cas échéant, préciser ici le parcours et la spécialité du Mandataire.]", "{parcours}", 1)

# Verif : 7 tags distincts presents, 0 placeholder de donnees restant
import re
tags = sorted(set(re.findall(r"\{[a-z_]+\}", xml)))
assert tags == ["{date_contrat}", "{email}", "{marque}", "{nom}",
                "{numero_fondateur}", "{parcours}", "{prenom}"], tags
io.open(SRC, "w", encoding="utf-8").write(xml)
print("OK tags:", tags)
