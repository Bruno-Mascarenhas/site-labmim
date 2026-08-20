#!/usr/bin/env python3
"""Generate the distributable contribution guide from repository facts.

The PDF is intentionally generated from code because the original editable
source was not versioned. Keep the content aligned with CONTRIBUTING.md,
src/sites/README.md and the producer contract in the sibling repository.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


PAGE_W, PAGE_H = A4
MARGIN = 42

NAVY = HexColor("#101A2E")
NAVY_2 = HexColor("#182642")
INK = HexColor("#172238")
MUTED = HexColor("#58667A")
PAPER = HexColor("#F6F8FB")
LINE = HexColor("#D8E0EA")
PURPLE = HexColor("#7254D8")
BLUE = HexColor("#2C73D2")
TEAL = HexColor("#198F86")
GREEN = HexColor("#2B9A66")
ORANGE = HexColor("#D97832")
RED = HexColor("#C44747")
PALE_PURPLE = HexColor("#F0ECFF")
PALE_BLUE = HexColor("#EAF3FF")
PALE_GREEN = HexColor("#EAF8F1")
PALE_ORANGE = HexColor("#FFF1E7")
PALE_RED = HexColor("#FDECEC")
CODE_BG = HexColor("#0E1625")


def register_fonts() -> None:
    root = Path("/usr/share/fonts/truetype/dejavu")
    pdfmetrics.registerFont(TTFont("GuideSans", root / "DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("GuideSans-Bold", root / "DejaVuSans-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("GuideMono", root / "DejaVuSansMono.ttf"))
    pdfmetrics.registerFont(TTFont("GuideMono-Bold", root / "DejaVuSansMono-Bold.ttf"))


BODY = ParagraphStyle(
    "body",
    fontName="GuideSans",
    fontSize=9.4,
    leading=13.4,
    textColor=INK,
    alignment=TA_LEFT,
    spaceAfter=0,
)
SMALL = ParagraphStyle(
    "small",
    parent=BODY,
    fontSize=8.1,
    leading=11.4,
    textColor=MUTED,
)
BOX_TITLE = ParagraphStyle(
    "box-title",
    parent=BODY,
    fontName="GuideSans-Bold",
    fontSize=10.2,
    leading=13,
)
COVER_KICKER = ParagraphStyle(
    "cover-kicker",
    parent=BODY,
    fontName="GuideSans-Bold",
    fontSize=8.5,
    leading=11,
    textColor=HexColor("#B8C5D8"),
)
COVER_TITLE = ParagraphStyle(
    "cover-title",
    parent=BODY,
    fontName="GuideSans-Bold",
    fontSize=27,
    leading=32,
    textColor=white,
)


def paragraph(
    c: Canvas,
    text: str,
    x: float,
    top: float,
    width: float,
    style: ParagraphStyle = BODY,
) -> float:
    p = Paragraph(text, style)
    _, height = p.wrap(width, PAGE_H)
    p.drawOn(c, x, top - height)
    return top - height


def bullet_list(
    c: Canvas,
    items: list[str],
    x: float,
    top: float,
    width: float,
    *,
    color=PURPLE,
    style: ParagraphStyle = BODY,
    gap: float = 5,
) -> float:
    y = top
    for item in items:
        c.setFillColor(color)
        c.circle(x + 3.5, y - 6.5, 2.2, stroke=0, fill=1)
        y = paragraph(c, item, x + 13, y, width - 13, style) - gap
    return y


def rounded_box(
    c: Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
    *,
    fill=PAPER,
    stroke=LINE,
    radius: float = 9,
) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, width, height, radius, stroke=1, fill=1)


def info_box(
    c: Canvas,
    x: float,
    top: float,
    width: float,
    height: float,
    title: str,
    body: str,
    *,
    accent=PURPLE,
    fill=PAPER,
) -> None:
    y = top - height
    rounded_box(c, x, y, width, height, fill=fill)
    c.setFillColor(accent)
    c.roundRect(x, y, 5, height, 2.5, stroke=0, fill=1)
    paragraph(c, title, x + 15, top - 13, width - 26, BOX_TITLE)
    paragraph(c, body, x + 15, top - 34, width - 26, SMALL)


def code_block(
    c: Canvas,
    lines: list[str],
    x: float,
    top: float,
    width: float,
    *,
    font_size: float = 8.1,
    padding: float = 12,
) -> float:
    leading = font_size + 4
    height = padding * 2 + len(lines) * leading - 2
    rounded_box(c, x, top - height, width, height, fill=CODE_BG, stroke=CODE_BG, radius=8)
    c.setFont("GuideMono", font_size)
    c.setFillColor(HexColor("#E8EEF7"))
    y = top - padding - font_size
    for line in lines:
        c.drawString(x + padding, y, line)
        y -= leading
    return top - height


def page_header(c: Canvas, section: str, title: str, page: int) -> float:
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 58, PAGE_W, 58, stroke=0, fill=1)
    c.setFillColor(PURPLE)
    c.roundRect(MARGIN, PAGE_H - 37, 84, 16, 8, stroke=0, fill=1)
    c.setFont("GuideSans-Bold", 6.7)
    c.setFillColor(white)
    c.drawCentredString(MARGIN + 42, PAGE_H - 31.2, section.upper())
    c.setFont("GuideSans", 7.5)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 31.2, f"{page} / 13")
    c.setFont("GuideSans-Bold", 17)
    c.setFillColor(INK)
    c.drawString(MARGIN, PAGE_H - 88, title)
    return PAGE_H - 108


def page_footer(c: Canvas, page: int) -> None:
    c.setStrokeColor(LINE)
    c.line(MARGIN, 34, PAGE_W - MARGIN, 34)
    c.setFont("GuideSans", 6.8)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 22, "Guia de contribuicao - site-labmim")
    c.drawCentredString(PAGE_W / 2, 22, "Revisado em 18/08/2026")
    c.drawRightString(PAGE_W - MARGIN, 22, str(page))


def draw_arrow(c: Canvas, x1: float, y1: float, x2: float, y2: float, *, color=PURPLE) -> None:
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.5)
    c.line(x1, y1, x2, y2)
    direction = 1 if x2 >= x1 else -1
    c.line(x2, y2, x2 - 6 * direction, y2 + 3.5)
    c.line(x2, y2, x2 - 6 * direction, y2 - 3.5)


def cover(c: Canvas) -> None:
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(NAVY_2)
    c.circle(PAGE_W - 55, PAGE_H - 48, 92, stroke=0, fill=1)
    c.setFillColor(PURPLE)
    c.circle(PAGE_W - 30, PAGE_H - 32, 56, stroke=0, fill=1)
    c.setFillColor(HexColor("#14213A"))
    c.roundRect(0, 0, PAGE_W, 126, 0, stroke=0, fill=1)

    paragraph(c, "ONBOARDING DE CONTRIBUICAO", MARGIN, PAGE_H - 90, 245, COVER_KICKER)
    paragraph(c, "Como contribuir no<br/>site-labmim", MARGIN, PAGE_H - 128, 410, COVER_TITLE)
    paragraph(
        c,
        "Fluxo de trabalho, arquitetura do consumidor e contrato com o produtor <b>micrometeorology</b>.",
        MARGIN,
        PAGE_H - 215,
        420,
        ParagraphStyle("cover-sub", parent=BODY, fontSize=11.2, leading=16, textColor=HexColor("#DCE5F2")),
    )

    diagram_y = 365
    left_x, box_w, box_h = MARGIN, 205, 108
    rounded_box(c, left_x, diagram_y, box_w, box_h, fill=HexColor("#1C2B49"), stroke=HexColor("#3A4C6E"))
    rounded_box(c, PAGE_W - MARGIN - box_w, diagram_y, box_w, box_h, fill=HexColor("#143B3B"), stroke=TEAL)
    c.setFont("GuideSans-Bold", 11)
    c.setFillColor(white)
    c.drawString(left_x + 16, diagram_y + 78, "CONSUMIDOR")
    c.drawString(PAGE_W - MARGIN - box_w + 16, diagram_y + 78, "PRODUTOR")
    c.setFont("GuideMono-Bold", 9.4)
    c.setFillColor(HexColor("#CFC6FF"))
    c.drawString(left_x + 16, diagram_y + 53, "site-labmim")
    c.setFillColor(HexColor("#AEF0DE"))
    c.drawString(PAGE_W - MARGIN - box_w + 16, diagram_y + 53, "src/micrometeorology")
    c.setFont("GuideSans", 7.8)
    c.setFillColor(HexColor("#C8D3E4"))
    c.drawString(left_x + 16, diagram_y + 30, "Build Node 24 -> site estatico")
    c.drawString(PAGE_W - MARGIN - box_w + 16, diagram_y + 30, "Python 3.14 -> artefatos de dados")
    draw_arrow(c, left_x + box_w + 14, diagram_y + box_h / 2, PAGE_W - MARGIN - box_w - 14, diagram_y + box_h / 2, color=TEAL)
    c.setFont("GuideSans-Bold", 7)
    c.setFillColor(TEAL)
    c.drawCentredString(PAGE_W / 2, diagram_y + box_h / 2 + 12, "CONTRATOS VERSIONADOS")

    c.setFont("GuideSans", 8)
    c.setFillColor(HexColor("#AEBBD0"))
    c.drawString(MARGIN, 92, "Destinado a novos membros e revisores do projeto")
    c.drawString(MARGIN, 72, "github.com/Bruno-Mascarenhas/site-labmim")
    c.drawString(MARGIN, 52, "Revisao: 18/08/2026")


def flow_page(c: Canvas) -> None:
    top = page_header(c, "visao geral", "O fluxo completo cabe em oito passos", 2)
    steps = [
        ("1", "Abrir issue", "Contexto, resultado esperado e aceite verificavel.", PURPLE),
        ("2", "Criar branch", "Partir da main atualizada; nunca trabalhar nela.", BLUE),
        ("3", "Editar a fonte", "Escolher o modulo correto e preservar as fronteiras.", TEAL),
        ("4", "Gerar e validar", "Build, linters, formatacao e teste visual local.", GREEN),
        ("5", "Commit e push", "Mudancas pequenas, relacionadas e com intencao clara.", ORANGE),
        ("6", "Abrir PR", "Explicar impacto, validacao e ligar a issue com Closes.", PURPLE),
        ("7", "Responder a revisao", "Corrigir na mesma branch e atualizar o mesmo PR.", BLUE),
        ("8", "Squash merge", "CI verde, aprovacao de outra pessoa e branch removida.", GREEN),
    ]
    col_w = (PAGE_W - 2 * MARGIN - 18) / 2
    card_h = 112
    for i, (number, title, body, color) in enumerate(steps):
        col = i % 2
        row = i // 2
        x = MARGIN + col * (col_w + 18)
        card_top = top - row * (card_h + 14)
        rounded_box(c, x, card_top - card_h, col_w, card_h, fill=white)
        c.setFillColor(color)
        c.circle(x + 29, card_top - 31, 16, stroke=0, fill=1)
        c.setFont("GuideSans-Bold", 11)
        c.setFillColor(white)
        c.drawCentredString(x + 29, card_top - 35, number)
        paragraph(c, title, x + 55, card_top - 19, col_w - 70, BOX_TITLE)
        paragraph(c, body, x + 55, card_top - 49, col_w - 70, SMALL)
    info_box(
        c,
        MARGIN,
        104,
        PAGE_W - 2 * MARGIN,
        48,
        "Regra central",
        "A <b>main</b> representa uma versao revisada e publicavel. Toda mudanca entra por pull request e recebe revisao independente.",
        accent=GREEN,
        fill=PALE_GREEN,
    )
    page_footer(c, 2)


def environment_page(c: Canvas) -> None:
    top = page_header(c, "ambiente", "Prepare o consumidor e entenda o que e fonte", 3)
    paragraph(c, "1. Instale a versao fixada do Node e as dependencias reproduziveis.", MARGIN, top, 500, BOX_TITLE)
    y = code_block(
        c,
        [
            "git clone https://github.com/Bruno-Mascarenhas/site-labmim.git",
            "cd site-labmim",
            "nvm install && nvm use",
            "npm ci",
        ],
        MARGIN,
        top - 28,
        PAGE_W - 2 * MARGIN,
    )
    paragraph(c, "2. O build separa fontes editaveis, saidas geradas e dados operacionais.", MARGIN, y - 28, 500, BOX_TITLE)
    col_w = (PAGE_W - 2 * MARGIN - 20) / 2
    box_top = y - 55
    info_box(
        c,
        MARGIN,
        box_top,
        col_w,
        176,
        "Edite aqui",
        "<b>src/sites/</b> - identidade e conteudo por publicacao<br/><b>src/template/</b> - estrutura compartilhada<br/><b>src/territories/</b> - geografia<br/><b>src/datasets/</b> - contrato de dados<br/><b>site/assets/js e css</b> - runtime compartilhado",
        accent=BLUE,
        fill=PALE_BLUE,
    )
    info_box(
        c,
        MARGIN + col_w + 20,
        box_top,
        col_w,
        176,
        "Nao edite manualmente",
        "<b>site/*.html</b>, sitemap, robots e .htaccess<br/><b>site/assets/css/site-theme.css</b><br/><b>site/assets/img/</b><br/><b>site/JSON, GeoJSON, Monitoramento, Climatologia e Ceu</b><br/><b>site/assets/graphs/</b>",
        accent=RED,
        fill=PALE_RED,
    )
    info_box(
        c,
        MARGIN,
        132,
        PAGE_W - 2 * MARGIN,
        64,
        "Por que isso importa",
        "O proximo build sobrescreve a saida. Os dados operacionais pertencem ao pipeline Python e chegam somente no deploy; formatar ou versionar esses arquivos quebra o contrato entre repositorios.",
        accent=ORANGE,
        fill=PALE_ORANGE,
    )
    page_footer(c, 3)


def issue_branch_page(c: Canvas) -> None:
    top = page_header(c, "issue e branch", "Comece com um problema definido e uma branch curta", 4)
    col_w = (PAGE_W - 2 * MARGIN - 22) / 2
    paragraph(c, "Issue", MARGIN, top, col_w, BOX_TITLE)
    y1 = bullet_list(
        c,
        [
            "Explique <b>o que acontece hoje</b>.",
            "Descreva o <b>resultado esperado</b>.",
            "Transforme o aceite em itens verificaveis.",
            "Registre arquivos, telas e contratos possivelmente afetados.",
        ],
        MARGIN,
        top - 30,
        col_w,
        color=PURPLE,
    )
    code_block(
        c,
        [
            "## Contexto",
            "## Resultado esperado",
            "## Criterios de aceite",
            "- [ ] comportamento verificavel",
            "- [ ] evidencia visual, se aplicavel",
        ],
        MARGIN,
        y1 - 12,
        col_w,
        font_size=7.8,
    )
    x2 = MARGIN + col_w + 22
    paragraph(c, "Branch", x2, top, col_w, BOX_TITLE)
    y2 = bullet_list(
        c,
        [
            "Atualize a <b>main</b> com fast-forward.",
            "Inclua o numero da issue e uma descricao curta.",
            "Use <b>feat</b>, <b>fix</b>, <b>docs</b> ou <b>chore</b>.",
            "Mantenha um unico objetivo por branch e PR.",
        ],
        x2,
        top - 30,
        col_w,
        color=BLUE,
    )
    code_block(
        c,
        [
            "git switch main",
            "git pull --ff-only origin main",
            "git switch -c feat/42-descricao-curta",
        ],
        x2,
        y2 - 12,
        col_w,
        font_size=7.8,
    )
    info_box(
        c,
        MARGIN,
        150,
        PAGE_W - 2 * MARGIN,
        78,
        "Nao use a main como area de trabalho",
        "A branch principal e a linha estavel. Se a mudanca precisar de dois repositorios, crie branches e PRs coordenados em cada um; nao misture os historicos Git.",
        accent=RED,
        fill=PALE_RED,
    )
    page_footer(c, 4)


def location_page(c: Canvas) -> None:
    top = page_header(c, "implementacao", "Decida pelo alcance antes de escolher o arquivo", 5)
    paragraph(c, "No consumidor site-labmim", MARGIN, top, 500, BOX_TITLE)
    rows = [
        ("Marca, origem, logos, redirects", "src/sites/<id>/identity.js", PURPLE),
        ("Paginas, SEO, navegacao", "src/sites/<id>/pages.js", BLUE),
        ("Conteudo exclusivo", "src/sites/<id>/pages/ ou fragments/", PURPLE),
        ("Conteudo comum", "src/template/pages/", TEAL),
        ("Layout, navbar, footer", "src/template/layouts/ e partials/", TEAL),
        ("Estado, contorno, viewport", "src/territories/", GREEN),
        ("Paths, timeline, dominios WRF", "src/datasets/", ORANGE),
        ("Mapa, graficos, fetch e cache", "site/assets/js/", BLUE),
    ]
    row_top = top - 33
    row_h = 47
    for i, (what, where, color) in enumerate(rows):
        y = row_top - i * row_h
        rounded_box(c, MARGIN, y - 37, PAGE_W - 2 * MARGIN, 37, fill=white, radius=6)
        c.setFillColor(color)
        c.rect(MARGIN, y - 37, 5, 37, stroke=0, fill=1)
        c.setFont("GuideSans-Bold", 8.4)
        c.setFillColor(INK)
        c.drawString(MARGIN + 16, y - 15, what)
        c.setFont("GuideMono", 7.4)
        c.setFillColor(MUTED)
        c.drawString(MARGIN + 250, y - 15, where)
    info_box(
        c,
        MARGIN,
        178,
        PAGE_W - 2 * MARGIN,
        84,
        "Pergunta de revisao",
        "A diferenca e editorial ou uma capacidade reutilizavel? Evite <font name='GuideMono'>if (site === 'ufba')</font> no template, renderer, CSS comum ou runtime. Declaracoes de publicacao devem permanecer declarativas.",
        accent=ORANGE,
        fill=PALE_ORANGE,
    )
    page_footer(c, 5)


def validation_page(c: Canvas) -> None:
    top = page_header(c, "validacao", "Rode o mesmo conjunto que protege a main", 6)
    y = code_block(
        c,
        [
            "npm run build -- --site=ufba      # desenvolvimento focado",
            "npm run build:check               # todas as publicacoes + drift",
            "npm run lint:all                  # JS, CSS, temas, HTML e links",
            "npm run format:check              # fonte formatada",
            "make ci                           # conjunto completo do GitHub Actions",
            "make serve                        # http://localhost:8000",
        ],
        MARGIN,
        top,
        PAGE_W - 2 * MARGIN,
    )
    paragraph(c, "O que o CI cobre", MARGIN, y - 28, 500, BOX_TITLE)
    checks = [
        ("Build", "descoberta, schema, referencias e saida canonica", PURPLE),
        ("Todas as publicacoes", "build:all e bundles em dist/<id>/", BLUE),
        ("Qualidade", "ESLint, Stylelint, temas, icones e PurgeCSS", TEAL),
        ("Documento gerado", "Prettier, html-validate e links internos", GREEN),
        ("Seguranca", "npm audit com limite high", ORANGE),
        ("Revisao humana", "light/dark, mobile, interacoes e console", RED),
    ]
    col_w = (PAGE_W - 2 * MARGIN - 16) / 2
    for i, (title, body, color) in enumerate(checks):
        col = i % 2
        row = i // 2
        info_box(
            c,
            MARGIN + col * (col_w + 16),
            y - 55 - row * 92,
            col_w,
            78,
            title,
            body,
            accent=color,
            fill=white,
        )
    info_box(
        c,
        MARGIN,
        118,
        PAGE_W - 2 * MARGIN,
        58,
        "Teste manual minimo",
        "Abra uma pagina institucional e uma WebGIS de cada publicacao afetada. Verifique tema claro/escuro, largura mobile, dominios, linha do tempo, overlays, modais e console sem erros.",
        accent=BLUE,
        fill=PALE_BLUE,
    )
    page_footer(c, 6)


def commit_page(c: Canvas) -> None:
    top = page_header(c, "commits e push", "O historico deve explicar a intencao", 7)
    y = code_block(
        c,
        [
            "git status",
            "git add src/sites/ufba site",
            "git commit -m \"feat(site): adiciona pagina de projetos\"",
            "git push -u origin feat/42-pagina-projetos",
        ],
        MARGIN,
        top,
        PAGE_W - 2 * MARGIN,
    )
    paragraph(c, "Formato recomendado", MARGIN, y - 28, 500, BOX_TITLE)
    info_box(
        c,
        MARGIN,
        y - 52,
        PAGE_W - 2 * MARGIN,
        64,
        "tipo(escopo): descricao curta no imperativo",
        "Exemplos: <font name='GuideMono'>fix(webgis): corrige escala de precipitacao</font> e <font name='GuideMono'>docs(onboarding): atualiza contrato do produtor</font>.",
        accent=PURPLE,
        fill=PALE_PURPLE,
    )
    col_w = (PAGE_W - 2 * MARGIN - 20) / 2
    info_box(
        c,
        MARGIN,
        y - 136,
        col_w,
        196,
        "Inclua",
        "- a fonte editada<br/>- a saida <font name='GuideMono'>site/</font> regenerada<br/>- assets derivados pelo build<br/>- um commit por intencao coerente<br/>- somente arquivos relacionados a issue",
        accent=GREEN,
        fill=PALE_GREEN,
    )
    info_box(
        c,
        MARGIN + col_w + 20,
        y - 136,
        col_w,
        196,
        "Evite",
        "- mensagens como 'updates' ou 'fix'<br/>- misturar refactor, conteudo e dependencias<br/>- versionar JSON/GeoJSON operacionais<br/>- reformatar arquivos de dados<br/>- reescrever a main ou forcar push nela",
        accent=RED,
        fill=PALE_RED,
    )
    info_box(
        c,
        MARGIN,
        104,
        PAGE_W - 2 * MARGIN,
        48,
        "Saida gerada faz parte do PR",
        "O <font name='GuideMono'>build:check</font> falha quando <font name='GuideMono'>src/</font> e <font name='GuideMono'>site/</font> divergem.",
        accent=ORANGE,
        fill=PALE_ORANGE,
    )
    page_footer(c, 7)


def pr_page(c: Canvas) -> None:
    top = page_header(c, "pull request", "O PR deve permitir que outra pessoa valide", 8)
    col_w = (PAGE_W - 2 * MARGIN - 18) / 2
    items = [
        ("Base", "Confirme que o destino e a main.", PURPLE),
        ("Issue", "Use Closes #42 para ligar e encerrar no merge.", BLUE),
        ("Mudanca", "Explique o que muda e por que agora.", TEAL),
        ("Impacto", "Liste publicacoes, rotas e contratos afetados.", ORANGE),
        ("Validacao", "Forneca comandos, URL local e passos manuais.", GREEN),
        ("Evidencia", "Inclua capturas quando houver alteracao visual.", PURPLE),
    ]
    for i, (title, body, color) in enumerate(items):
        col = i % 2
        row = i // 2
        info_box(
            c,
            MARGIN + col * (col_w + 18),
            top - row * 94,
            col_w,
            80,
            title,
            body,
            accent=color,
            fill=white,
        )
    paragraph(c, "Modelo compacto", MARGIN, top - 306, 500, BOX_TITLE)
    code_block(
        c,
        [
            "Closes #42",
            "## O que muda",
            "## Por que",
            "## Como validar",
            "- [ ] make ci",
            "- [ ] teste visual local",
            "## Riscos e impacto no deploy",
        ],
        MARGIN,
        top - 334,
        PAGE_W - 2 * MARGIN,
        font_size=7.8,
    )
    info_box(
        c,
        MARGIN,
        112,
        PAGE_W - 2 * MARGIN,
        52,
        "PR coordenado em dois repositorios",
        "Ligue os dois PRs na descricao, declare a ordem de deploy e mantenha o contrato compativel com a versao anterior.",
        accent=ORANGE,
        fill=PALE_ORANGE,
    )
    page_footer(c, 8)


def review_page(c: Canvas) -> None:
    top = page_header(c, "revisao e merge", "A revisao fecha o ciclo na mesma branch", 9)
    paragraph(c, "Quem revisa", MARGIN, top, 500, BOX_TITLE)
    y = bullet_list(
        c,
        [
            "Confirma se o escopo corresponde a issue e se o modulo escolhido e o correto.",
            "Le o diff por arquivo e comenta no trecho especifico.",
            "Verifica CI, saida gerada, impactos cruzados e evidencias visuais.",
            "Aprova somente quando nao restam bloqueios.",
        ],
        MARGIN,
        top - 30,
        PAGE_W - 2 * MARGIN,
        color=BLUE,
    )
    paragraph(c, "Quem recebe comentarios", MARGIN, y - 10, 500, BOX_TITLE)
    y = bullet_list(
        c,
        [
            "Faz o ajuste na <b>mesma branch</b>.",
            "Roda novamente os checks proporcionais ao risco; antes do merge, roda o conjunto completo.",
            "Faz push; o pull request e atualizado automaticamente.",
            "Responde as threads e marca como resolvidas depois do ajuste.",
        ],
        MARGIN,
        y - 40,
        PAGE_W - 2 * MARGIN,
        color=GREEN,
    )
    info_box(
        c,
        MARGIN,
        y - 8,
        PAGE_W - 2 * MARGIN,
        106,
        "Condicao para merge",
        "Issue ligada, escopo revisado, CI verde, teste visual concluido e aprovacao de outra pessoa. O repositorio usa <b>squash merge</b>; a branch e removida automaticamente depois.",
        accent=GREEN,
        fill=PALE_GREEN,
    )
    info_box(
        c,
        MARGIN,
        126,
        PAGE_W - 2 * MARGIN,
        60,
        "Quando pedir nova revisao",
        "Mudancas substantivas depois de uma aprovacao devem ser destacadas. Nao esconda alteracoes novas em commits de correcao sem atualizar a descricao do PR.",
        accent=ORANGE,
        fill=PALE_ORANGE,
    )
    page_footer(c, 9)


def contract_page(c: Canvas) -> None:
    top = page_header(c, "dois repositorios", "O produtor escreve; o consumidor publica e interpreta", 10)
    box_w = 198
    box_h = 142
    left_x = MARGIN
    right_x = PAGE_W - MARGIN - box_w
    rounded_box(c, left_x, top - box_h, box_w, box_h, fill=PALE_GREEN, stroke=TEAL)
    rounded_box(c, right_x, top - box_h, box_w, box_h, fill=PALE_PURPLE, stroke=PURPLE)
    paragraph(c, "PRODUTOR", left_x + 14, top - 16, box_w - 28, BOX_TITLE)
    paragraph(c, "<font name='GuideMono'>src/micrometeorology</font>", left_x + 14, top - 41, box_w - 28, SMALL)
    bullet_list(
        c,
        ["wrf/", "sensors/", "stats/", "cli/ e common/types.py"],
        left_x + 14,
        top - 70,
        box_w - 28,
        color=TEAL,
        style=SMALL,
        gap=2,
    )
    paragraph(c, "CONSUMIDOR", right_x + 14, top - 16, box_w - 28, BOX_TITLE)
    paragraph(c, "<font name='GuideMono'>site-labmim</font>", right_x + 14, top - 41, box_w - 28, SMALL)
    bullet_list(
        c,
        ["src/datasets/", "site/assets/js/", "src/template/", "build e deploy estaticos"],
        right_x + 14,
        top - 70,
        box_w - 28,
        color=PURPLE,
        style=SMALL,
        gap=2,
    )
    draw_arrow(c, left_x + box_w + 16, top - 70, right_x - 16, top - 70, color=ORANGE)
    c.setFont("GuideSans-Bold", 7)
    c.setFillColor(ORANGE)
    c.drawCentredString(PAGE_W / 2, top - 57, "ARTEFATOS E SCHEMAS")

    paragraph(c, "Contratos ativos", MARGIN, top - 178, 500, BOX_TITLE)
    contracts = [
        ("WebGIS", "manifest v2, grade compacta, valores, series.bin, summary.json", BLUE),
        ("Overlays", "WIND_VECTORS e ISOBARS, anunciados por features", TEAL),
        ("Estacao", "labmim-monitoring-v1 e labmim-climatology-v1", GREEN),
        ("Ceu", "frame, mascara, Kt x Kd e acumulada do indice de claridade", ORANGE),
    ]
    for i, (title, body, color) in enumerate(contracts):
        info_box(c, MARGIN, top - 205 - i * 72, PAGE_W - 2 * MARGIN, 60, title, body, accent=color, fill=white)

    info_box(
        c,
        MARGIN,
        130,
        PAGE_W - 2 * MARGIN,
        70,
        "Regra de compatibilidade",
        "Mudancas de formato devem ser aditivas. Em producao, publique primeiro o consumidor compativel e depois o produtor. O inverso pode deixar o site pedindo arquivos ou campos que ainda nao sabe ler.",
        accent=RED,
        fill=PALE_RED,
    )
    page_footer(c, 10)


def artifacts_page(c: Canvas) -> None:
    top = page_header(c, "pipeline de dados", "Conheca os artefatos antes de alterar um contrato", 11)
    table_x = MARGIN
    col1, col2 = 236, PAGE_W - 2 * MARGIN - 236
    rows = [
        ("JSON/manifest.json", "timeline, versao, disponibilidade e features"),
        ("GeoJSON/{D}.grid.json", "grade compacta preferida"),
        ("JSON/{D}_{VAR}_{NNN}.json", "campo por passo; cores do mapa"),
        ("JSON/{D}_ISOBARS_{NNN}.json", "overlay de pressao ao nivel do mar"),
        ("JSON/{D}_{VAR}.series.bin", "serie de celula por HTTP Range"),
        ("JSON/{D}_{VAR}.summary.json", "media, minimo e maximo do dominio"),
        ("Monitoramento/", "janela de 7 dias em bruto, horario e WRF"),
        ("Climatologia/ e Ceu/", "distribuicoes, camera e produtos solares"),
    ]
    c.setFillColor(NAVY_2)
    c.rect(table_x, top - 31, col1 + col2, 31, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("GuideSans-Bold", 8)
    c.drawString(table_x + 10, top - 20, "Artefato do produtor")
    c.drawString(table_x + col1 + 10, top - 20, "Uso no consumidor")
    row_y = top - 31
    for i, (artifact, use) in enumerate(rows):
        fill = white if i % 2 == 0 else PAPER
        c.setFillColor(fill)
        c.setStrokeColor(LINE)
        c.rect(table_x, row_y - 43, col1 + col2, 43, stroke=1, fill=1)
        c.setFont("GuideMono", 7.1)
        c.setFillColor(INK)
        c.drawString(table_x + 10, row_y - 26, artifact)
        c.setFont("GuideSans", 7.7)
        c.setFillColor(MUTED)
        for j, line in enumerate(simpleSplit(use, "GuideSans", 7.7, col2 - 20)):
            c.drawString(table_x + col1 + 10, row_y - 19 - j * 10, line)
        row_y -= 43

    info_box(
        c,
        MARGIN,
        row_y - 18,
        PAGE_W - 2 * MARGIN,
        92,
        "CLIs do produtor relacionadas ao site",
        "<font name='GuideMono'>labmim-wrf-geojson</font> publica o WebGIS; <font name='GuideMono'>labmim-monitoring</font>, <font name='GuideMono'>labmim-climatology</font>, <font name='GuideMono'>labmim-sky</font> e <font name='GuideMono'>labmim-site-graphs</font> publicam produtos de estacao; <font name='GuideMono'>labmim-wrf-series</font> mantem a serie operacional usada como camada WRF.",
        accent=TEAL,
        fill=PALE_GREEN,
    )
    info_box(
        c,
        MARGIN,
        108,
        PAGE_W - 2 * MARGIN,
        50,
        "Deploy seguro",
        "Site completo com .htaccess -> verificacao em producao -> pipeline atualizado -> nova rodada de dados.",
        accent=ORANGE,
        fill=PALE_ORANGE,
    )
    page_footer(c, 11)


def mistakes_page(c: Canvas) -> None:
    top = page_header(c, "evite", "Erros que costumam bloquear a revisao", 12)
    mistakes = [
        ("Editar site/*.html", "A mudanca some no proximo build.", RED),
        ("Testar um unico site", "CSS ou template comum pode quebrar a outra publicacao.", RED),
        ("Copiar pagina compartilhada", "O conteudo passa a divergir silenciosamente.", ORANGE),
        ("Hardcode de ID, estado ou path", "O runtime deixa de ser multi-publicacao.", ORANGE),
        ("sourceId diferente do manifest", "O cliente recebe 404 e usa cache negativo.", PURPLE),
        ("Tratar overlay como campo", "ISOBARS e WIND_VECTORS nao geram series.bin.", PURPLE),
        ("Comitar dados operacionais", "Arquivos grandes e privados entram no historico.", BLUE),
        ("Mudar produtor primeiro", "O consumidor antigo pode nao entender o novo contrato.", BLUE),
        ("Ignorar light/dark e mobile", "Regressoes visuais passam pelos linters.", TEAL),
        ("Abrir outra branch no review", "A conversa e o historico do PR se fragmentam.", TEAL),
    ]
    col_w = (PAGE_W - 2 * MARGIN - 18) / 2
    for i, (title, body, color) in enumerate(mistakes):
        col = i % 2
        row = i // 2
        info_box(
            c,
            MARGIN + col * (col_w + 18),
            top - row * 91,
            col_w,
            78,
            title,
            body,
            accent=color,
            fill=white,
        )
    info_box(
        c,
        MARGIN,
        104,
        PAGE_W - 2 * MARGIN,
        48,
        "Prevencao",
        "Fronteiras declarativas, contratos versionados, build:check, make ci e inspecao das publicacoes afetadas.",
        accent=GREEN,
        fill=PALE_GREEN,
    )
    page_footer(c, 12)


def checklist_page(c: Canvas) -> None:
    top = page_header(c, "cola rapida", "Do inicio ao merge", 13)
    y = code_block(
        c,
        [
            "git switch main",
            "git pull --ff-only origin main",
            "git switch -c feat/42-descricao-curta",
            "npm run build -- --site=ufba",
            "make ci",
            "make serve",
            "git add <fontes> site",
            "git commit -m \"feat(site): descricao\"",
            "git push -u origin feat/42-descricao-curta",
        ],
        MARGIN,
        top,
        PAGE_W - 2 * MARGIN,
        font_size=7.7,
    )
    paragraph(c, "Antes de pedir revisao", MARGIN, y - 24, 500, BOX_TITLE)
    checks = [
        "A issue descreve objetivo e aceite.",
        "A branch partiu da main atualizada.",
        "A alteracao esta no modulo correto.",
        "src/ e site/ foram gerados juntos.",
        "make ci passou localmente.",
        "As publicacoes afetadas foram inspecionadas.",
        "O PR explica impacto e como validar.",
        "PRs coordenados declaram ordem de deploy.",
    ]
    col_w = (PAGE_W - 2 * MARGIN - 18) / 2
    for i, item in enumerate(checks):
        col = i % 2
        row = i // 2
        x = MARGIN + col * (col_w + 18)
        y_item = y - 55 - row * 48
        c.setStrokeColor(PURPLE)
        c.setLineWidth(1.1)
        c.roundRect(x, y_item - 18, 14, 14, 2, stroke=1, fill=0)
        paragraph(c, item, x + 24, y_item - 1, col_w - 24, SMALL)
    info_box(
        c,
        MARGIN,
        188,
        PAGE_W - 2 * MARGIN,
        84,
        "Referencias vivas",
        "<font name='GuideMono'>CONTRIBUTING.md</font> - processo<br/><font name='GuideMono'>src/sites/README.md</font> - receitas do consumidor<br/><font name='GuideMono'>Architecture.md</font> - arquitetura completa<br/><font name='GuideMono'>micrometeorology/docs/micrometeorology.md</font> - contrato do produtor",
        accent=BLUE,
        fill=PALE_BLUE,
    )
    c.setFont("GuideSans-Bold", 9)
    c.setFillColor(NAVY)
    c.drawCentredString(PAGE_W / 2, 73, "A main deve continuar revisada, reproduzivel e publicavel.")
    page_footer(c, 13)


def build(output: Path) -> None:
    register_fonts()
    output.parent.mkdir(parents=True, exist_ok=True)
    c = Canvas(str(output), pagesize=A4, pageCompression=1)
    c.setTitle("Como contribuir no site-labmim")
    c.setSubject("Fluxo de contribuicao e contrato entre site-labmim e micrometeorology")
    c.setAuthor("LabMiM - documentacao derivada dos repositorios do projeto")
    pages = [
        cover,
        flow_page,
        environment_page,
        issue_branch_page,
        location_page,
        validation_page,
        commit_page,
        pr_page,
        review_page,
        contract_page,
        artifacts_page,
        mistakes_page,
        checklist_page,
    ]
    for index, draw in enumerate(pages):
        draw(c)
        if index != len(pages) - 1:
            c.showPage()
    c.save()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/guia-contribuicao-site.pdf"),
    )
    args = parser.parse_args()
    build(args.output.resolve())


if __name__ == "__main__":
    main()
