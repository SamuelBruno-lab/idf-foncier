#!/usr/bin/env python3
"""
Génère le PDF du pitch DATAMERRY × COLLABIMO à partir du markdown source.
Style éditorial pro : cover page + sommaire + corps stylé.

Usage : python generate_pitch_pdf.py
Output : DATAMERRY-x-COLLABIMO-pitch.pdf
"""

import os
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    Table,
    TableStyle,
    Image,
    KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

# ─────────────────────────────────────────────────────────────────────────────
# Couleurs corporate DATAMERRY
# ─────────────────────────────────────────────────────────────────────────────
DM_PRIMARY = colors.HexColor("#1f3a8a")      # bleu foncé corporate
DM_ACCENT = colors.HexColor("#064e3b")        # vert Collabimo (cible)
DM_NEUTRAL = colors.HexColor("#0f172a")       # texte principal
DM_MUTED = colors.HexColor("#64748b")         # secondaire
DM_BG_LIGHT = colors.HexColor("#f1f5f9")      # fond léger

# ─────────────────────────────────────────────────────────────────────────────
# Styles
# ─────────────────────────────────────────────────────────────────────────────
def build_styles():
    base = getSampleStyleSheet()
    styles = {}

    styles["Title"] = ParagraphStyle(
        "Title",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=26,
        leading=32,
        textColor=DM_PRIMARY,
        spaceBefore=0,
        spaceAfter=12,
    )
    styles["Subtitle"] = ParagraphStyle(
        "Subtitle",
        parent=base["Heading2"],
        fontName="Helvetica",
        fontSize=14,
        leading=18,
        textColor=DM_MUTED,
        spaceAfter=24,
    )
    styles["H1"] = ParagraphStyle(
        "H1",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=DM_PRIMARY,
        spaceBefore=24,
        spaceAfter=12,
        borderPadding=4,
    )
    styles["H2"] = ParagraphStyle(
        "H2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=DM_PRIMARY,
        spaceBefore=16,
        spaceAfter=8,
    )
    styles["H3"] = ParagraphStyle(
        "H3",
        parent=base["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=DM_ACCENT,
        spaceBefore=12,
        spaceAfter=6,
    )
    styles["Body"] = ParagraphStyle(
        "Body",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=DM_NEUTRAL,
        alignment=TA_JUSTIFY,
        spaceAfter=8,
    )
    styles["Quote"] = ParagraphStyle(
        "Quote",
        parent=base["BodyText"],
        fontName="Helvetica-Oblique",
        fontSize=10,
        leading=14,
        textColor=DM_NEUTRAL,
        leftIndent=20,
        rightIndent=20,
        spaceBefore=6,
        spaceAfter=10,
        borderColor=DM_PRIMARY,
        borderWidth=0,
        borderPadding=0,
    )
    styles["Bullet"] = ParagraphStyle(
        "Bullet",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=DM_NEUTRAL,
        leftIndent=20,
        bulletIndent=10,
        spaceAfter=4,
    )
    styles["Footer"] = ParagraphStyle(
        "Footer",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        textColor=DM_MUTED,
        alignment=TA_CENTER,
    )
    styles["Cover_Title"] = ParagraphStyle(
        "Cover_Title",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=36,
        leading=44,
        textColor=DM_PRIMARY,
        alignment=TA_CENTER,
        spaceBefore=0,
        spaceAfter=20,
    )
    styles["Cover_Sub"] = ParagraphStyle(
        "Cover_Sub",
        parent=base["Heading2"],
        fontName="Helvetica",
        fontSize=18,
        leading=24,
        textColor=DM_ACCENT,
        alignment=TA_CENTER,
        spaceAfter=40,
    )
    styles["Cover_Meta"] = ParagraphStyle(
        "Cover_Meta",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=11,
        leading=16,
        textColor=DM_MUTED,
        alignment=TA_CENTER,
        spaceAfter=6,
    )
    return styles


# ─────────────────────────────────────────────────────────────────────────────
# Parseur markdown light (couvre les éléments du pitch)
# ─────────────────────────────────────────────────────────────────────────────

INLINE_BOLD = re.compile(r"\*\*([^*]+)\*\*")
INLINE_ITALIC = re.compile(r"\*([^*]+)\*")
INLINE_CODE = re.compile(r"`([^`]+)`")
INLINE_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def format_inline(text: str) -> str:
    """Convertit le markdown inline en HTML reportlab."""
    # On encode d'abord les caractères spéciaux HTML
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Liens
    text = INLINE_LINK.sub(r'<link href="\2" color="#1f3a8a"><u>\1</u></link>', text)
    # Bold
    text = INLINE_BOLD.sub(r"<b>\1</b>", text)
    # Italic
    text = INLINE_ITALIC.sub(r"<i>\1</i>", text)
    # Code inline
    text = INLINE_CODE.sub(
        r'<font face="Courier" color="#064e3b">\1</font>', text
    )
    return text


def parse_table(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    """Parse un bloc tableau markdown, renvoie (rows, ligne suivante)."""
    rows = []
    i = start
    while i < len(lines) and lines[i].strip().startswith("|"):
        line = lines[i].strip()
        # Ignore le séparateur "|---|---|"
        if re.match(r"^\|[\s\-:|]+\|$", line):
            i += 1
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        rows.append(cells)
        i += 1
    return rows, i


def build_table(rows: list[list[str]], styles: dict) -> Table:
    """Construit un Table reportlab stylé à partir des cellules markdown."""
    if not rows:
        return None
    cell_style = ParagraphStyle(
        "Cell",
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=DM_NEUTRAL,
    )
    header_style = ParagraphStyle(
        "CellHead",
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=colors.white,
    )

    # Convertit chaque cellule en Paragraph pour gérer le wrap + inline md
    formatted = []
    for r_idx, row in enumerate(rows):
        styled_row = []
        for cell in row:
            txt = format_inline(cell)
            style = header_style if r_idx == 0 else cell_style
            styled_row.append(Paragraph(txt, style))
        formatted.append(styled_row)

    # Largeurs colonnes proportionnelles
    n_cols = len(rows[0])
    col_widths = [(16 * cm) / n_cols] * n_cols

    table = Table(formatted, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DM_PRIMARY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, DM_BG_LIGHT]),
                ("BOX", (0, 0), (-1, -1), 0.5, DM_MUTED),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def parse_markdown_to_flowables(md_text: str, styles: dict) -> list:
    """Convertit le markdown du pitch en flowables reportlab."""
    flowables: list = []
    lines = md_text.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Saut de ligne vide
        if not stripped:
            i += 1
            continue

        # Heading 1 (#)
        if stripped.startswith("# "):
            flowables.append(Paragraph(format_inline(stripped[2:]), styles["H1"]))
            i += 1
            continue

        # Heading 2 (##)
        if stripped.startswith("## "):
            flowables.append(Paragraph(format_inline(stripped[3:]), styles["H2"]))
            i += 1
            continue

        # Heading 3 (###)
        if stripped.startswith("### "):
            flowables.append(Paragraph(format_inline(stripped[4:]), styles["H3"]))
            i += 1
            continue

        # Heading 4 (####) — traité comme H3 stylé
        if stripped.startswith("#### "):
            flowables.append(Paragraph(format_inline(stripped[5:]), styles["H3"]))
            i += 1
            continue

        # Séparateur horizontal (---)
        if stripped == "---":
            # Saut visuel
            flowables.append(Spacer(1, 0.4 * cm))
            i += 1
            continue

        # Tableau
        if stripped.startswith("|") and stripped.endswith("|"):
            rows, next_i = parse_table(lines, i)
            tbl = build_table(rows, styles)
            if tbl is not None:
                flowables.append(KeepTogether([tbl, Spacer(1, 0.3 * cm)]))
            i = next_i
            continue

        # Citation (>)
        if stripped.startswith(">"):
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            quote_text = " ".join(quote_lines).strip()
            if quote_text:
                flowables.append(Paragraph(format_inline(quote_text), styles["Quote"]))
            continue

        # Bullet (- ou *)
        if stripped.startswith("- ") or stripped.startswith("* "):
            bullet_text = stripped[2:]
            flowables.append(
                Paragraph(
                    f'• {format_inline(bullet_text)}',
                    styles["Bullet"],
                )
            )
            i += 1
            continue

        # Liste numérotée (1.)
        if re.match(r"^\d+\.\s", stripped):
            num_text = re.sub(r"^\d+\.\s", "", stripped)
            num_prefix = stripped.split(".", 1)[0]
            flowables.append(
                Paragraph(
                    f'{num_prefix}. {format_inline(num_text)}',
                    styles["Bullet"],
                )
            )
            i += 1
            continue

        # Sinon : paragraphe normal
        flowables.append(Paragraph(format_inline(stripped), styles["Body"]))
        i += 1

    return flowables


# ─────────────────────────────────────────────────────────────────────────────
# Cover page
# ─────────────────────────────────────────────────────────────────────────────


def build_cover(styles: dict) -> list:
    cover = []
    cover.append(Spacer(1, 5 * cm))
    cover.append(Paragraph("DATAMERRY × COLLABIMO", styles["Cover_Title"]))
    cover.append(Paragraph("Partenariat data pour Le Cercle", styles["Cover_Sub"]))
    cover.append(Spacer(1, 3 * cm))
    cover.append(
        Paragraph(
            "Document de cadrage stratégique", styles["Cover_Meta"]
        )
    )
    cover.append(Paragraph("Mai 2026", styles["Cover_Meta"]))
    cover.append(Spacer(1, 6 * cm))
    cover.append(
        Paragraph(
            "<b>Préparé par</b> Samuel BRUNO — Eurealimmo SARL",
            styles["Cover_Meta"],
        )
    )
    cover.append(
        Paragraph(
            "<b>Pour</b> Diara CAMARA — Collabimo",
            styles["Cover_Meta"],
        )
    )
    cover.append(Spacer(1, 0.6 * cm))
    cover.append(
        Paragraph(
            '<link href="https://datamerry.com" color="#1f3a8a">datamerry.com</link>',
            styles["Cover_Meta"],
        )
    )
    cover.append(PageBreak())
    return cover


# ─────────────────────────────────────────────────────────────────────────────
# Headers / footers
# ─────────────────────────────────────────────────────────────────────────────


def add_page_chrome(canvas, doc):
    """En-tête + pied de page (sauf cover page)."""
    if doc.page == 1:
        # Cover page = pas de chrome
        return
    canvas.saveState()

    # Header gauche : DATAMERRY × COLLABIMO
    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(DM_PRIMARY)
    canvas.drawString(2 * cm, A4[1] - 1.2 * cm, "DATAMERRY × COLLABIMO")

    # Header droite : « Pitch partenariat »
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(DM_MUTED)
    canvas.drawRightString(
        A4[0] - 2 * cm, A4[1] - 1.2 * cm, "Pitch partenariat — Mai 2026"
    )

    # Ligne sous header
    canvas.setStrokeColor(DM_PRIMARY)
    canvas.setLineWidth(0.5)
    canvas.line(2 * cm, A4[1] - 1.4 * cm, A4[0] - 2 * cm, A4[1] - 1.4 * cm)

    # Footer : pagination
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(DM_MUTED)
    canvas.drawCentredString(A4[0] / 2, 1.2 * cm, f"— {doc.page} —")

    # Footer gauche : url
    canvas.drawString(2 * cm, 1.2 * cm, "datamerry.com")
    # Footer droite : confidentiel
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, "Confidentiel")

    canvas.restoreState()


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────


def main():
    here = Path(__file__).parent
    md_path = here / "DATAMERRY-x-COLLABIMO-pitch.md"
    pdf_path = here / "DATAMERRY-x-COLLABIMO-pitch.pdf"

    if not md_path.exists():
        print(f"❌ Markdown source introuvable : {md_path}")
        return

    md_text = md_path.read_text(encoding="utf-8")

    # On retire le H1 « DATAMERRY × COLLABIMO » et le bloc cover du markdown
    # (on les a déjà sur la cover page PDF). Trouve le premier "---"
    md_lines = md_text.split("\n")
    if md_lines and md_lines[0].startswith("# DATAMERRY"):
        # On saute les 7 premières lignes (titre + subtitle + meta + ligne ---)
        for cut in range(len(md_lines)):
            if md_lines[cut].strip() == "---":
                md_lines = md_lines[cut + 1 :]
                break
    md_text_corpus = "\n".join(md_lines)

    styles = build_styles()

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        title="DATAMERRY × COLLABIMO — Pitch partenariat",
        author="Samuel BRUNO",
        subject="Partenariat data pour Le Cercle",
        creator="DATAMERRY",
    )

    flowables = build_cover(styles) + parse_markdown_to_flowables(md_text_corpus, styles)

    doc.build(flowables, onFirstPage=add_page_chrome, onLaterPages=add_page_chrome)

    # Print compatible Windows cp1252 (pas d'emoji)
    print(f"[OK] PDF genere : {pdf_path}")
    print(f"     {os.path.getsize(pdf_path) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
