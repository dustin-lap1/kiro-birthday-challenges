"""
Convert Markdown to a fully branded PDF — in one step.

This is the engine behind the "Branded PDF in Sync" Kiro hooks. Whenever a
Markdown file in the watched docs folder is created or updated, the hook runs
this script, which (re)generates a matching branded PDF next to it:

    docs/sample-one-pager.md  ->  docs/sample-one-pager.pdf   (branded)

The branded PDF carries the company letterhead:
  - A dark navy header bar with the company logo and a CONFIDENTIAL marker.
  - A dark navy footer bar with contact info and a clickable website link.
  - Page numbers.

Design notes
------------
- Source of truth is the Markdown; the PDF is a generated artifact kept in sync.
- Loop-safe by construction: the hook watches *.md and this script writes *.pdf,
  so it can never re-trigger itself.
- "Create or update": a PDF is only (re)built when it is missing or older than
  its Markdown source, so re-running is cheap.
- Accepts either a single .md path or a directory (all Markdown files synced).

Usage:
    python md-to-branded-pdf.py <file.md | directory>
    python md-to-branded-pdf.py <file.md | directory> [logo.png]
"""

import sys
from pathlib import Path
from io import BytesIO

import markdown
from xhtml2pdf import pisa
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Link


# ---------------------------------------------------------------------------
# Branding configuration — edit these to match your company.
# ---------------------------------------------------------------------------
COMPANY_MARKER = "CONFIDENTIAL"
CONTACT_PREFIX = "dustin@lap1labs.com    (650) 420-9988    "
CONTACT_LINK_TEXT = "lap1labs.com"
CONTACT_LINK_URL = "https://www.lap1labs.com"

DEFAULT_LOGO_PATH = Path(__file__).parent.parent / "assets" / "logo.png"

# US Letter at 144 DPI (2x) for crisp raster overlays.
PAGE_WIDTH = 1224
PAGE_HEIGHT = 1584

DARK_NAVY = (15, 23, 42)
TEAL = (6, 182, 212)
LIGHT_GRAY = (241, 245, 249)
WHITE = (255, 255, 255)


HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
    @page {{ size: letter; margin: 3cm 1.6cm 2.4cm 1.6cm; }}
    body {{ font-family: Helvetica, Arial, sans-serif; color: #1a1a2e; font-size: 10.5pt; line-height: 1.6; }}
    h1 {{ font-size: 20pt; color: #0f172a; border-bottom: 3px solid #0f172a; padding-bottom: 6px; }}
    h2 {{ font-size: 14pt; color: #0f172a; border-bottom: 1px solid #0f172a; padding-bottom: 4px; margin-top: 18px; }}
    h3 {{ font-size: 12pt; color: #0f172a; }}
    table {{ border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; }}
    th {{ background: #0f172a; color: #fff; padding: 6px 8px; text-align: left; }}
    td {{ padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }}
    a {{ color: #0891b2; text-decoration: none; }}
    strong {{ color: #0f172a; }}
    ul, ol {{ padding-left: 20px; }}
</style>
</head>
<body>
{content}
</body>
</html>"""


def get_font(size, bold=False):
    """Load Segoe UI, fall back to Arial, then Pillow's default."""
    candidates = (
        ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
        if bold else
        ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]
    )
    for font_path in candidates:
        try:
            return ImageFont.truetype(font_path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def render_markdown_to_pdf_bytes(md_path):
    """Markdown -> plain (unbranded) PDF, returned as bytes."""
    html_body = markdown.markdown(
        md_path.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code"],
    )
    full_html = HTML_TEMPLATE.format(content=html_body)
    buf = BytesIO()
    status = pisa.CreatePDF(full_html, dest=buf)
    if status.err:
        raise RuntimeError(f"Failed to render {md_path.name} to PDF")
    buf.seek(0)
    return buf


def create_letterhead_page(page_number, total_pages, logo_img):
    """Build a letterhead background page and the footer link rectangle."""
    page = Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), WHITE)
    draw = ImageDraw.Draw(page)

    # Header bar with logo (right) + CONFIDENTIAL marker (left)
    header_height = 120
    draw.rectangle([(0, 0), (PAGE_WIDTH, header_height)], fill=DARK_NAVY)

    logo_h = 96
    logo_aspect = logo_img.width / logo_img.height
    logo_w = int(logo_h * logo_aspect)
    if logo_w > 400:
        logo_w = 400
        logo_h = int(logo_w / logo_aspect)
    logo_resized = logo_img.resize((logo_w, logo_h), Image.LANCZOS)
    logo_x = PAGE_WIDTH - logo_w - 72
    logo_y = (header_height - logo_h) // 2
    page.paste(logo_resized, (logo_x, logo_y),
               logo_resized if logo_resized.mode == "RGBA" else None)

    font_marker = get_font(18, bold=True)
    marker_y = (header_height - 18) // 2
    draw.text((72, marker_y), COMPANY_MARKER, fill=TEAL, font=font_marker)

    # Footer bar with contact info + page number
    bar_height = 52
    bar_y = PAGE_HEIGHT - bar_height
    draw.rectangle([(0, bar_y), (PAGE_WIDTH, PAGE_HEIGHT)], fill=DARK_NAVY)

    font_footer = get_font(18)
    text_y = bar_y + (bar_height - 18) // 2

    draw.text((72, text_y), CONTACT_PREFIX, fill=LIGHT_GRAY, font=font_footer)
    prefix_bbox = draw.textbbox((72, text_y), CONTACT_PREFIX, font=font_footer)
    link_x_start = prefix_bbox[2]

    draw.text((link_x_start, text_y), CONTACT_LINK_TEXT, fill=TEAL, font=font_footer)
    link_bbox = draw.textbbox((link_x_start, text_y), CONTACT_LINK_TEXT, font=font_footer)

    page_text = f"Page {page_number} of {total_pages}"
    pg_bbox = draw.textbbox((0, 0), page_text, font=font_footer)
    pg_width = pg_bbox[2] - pg_bbox[0]
    draw.text((PAGE_WIDTH - pg_width - 72, text_y), page_text, fill=LIGHT_GRAY, font=font_footer)

    link_rect = (
        link_bbox[0] / 2.0,
        (PAGE_HEIGHT - link_bbox[3]) / 2.0,
        link_bbox[2] / 2.0,
        (PAGE_HEIGHT - link_bbox[1]) / 2.0,
    )
    return page, link_rect


def sync_markdown(md_path, logo_img):
    """(Re)generate the branded PDF for one Markdown file. Returns output path or None."""
    md_path = Path(md_path)
    output_path = md_path.with_suffix(".pdf")

    # Create-or-update: only rebuild when missing or stale.
    if output_path.exists() and output_path.stat().st_mtime >= md_path.stat().st_mtime:
        print(f"  up to date: {output_path.name}")
        return output_path

    plain_pdf = render_markdown_to_pdf_bytes(md_path)

    reader = PdfReader(plain_pdf)
    writer = PdfWriter()
    total_pages = len(reader.pages)

    for i, page in enumerate(reader.pages):
        letterhead_img, link_rect = create_letterhead_page(i + 1, total_pages, logo_img)
        buf = BytesIO()
        letterhead_img.save(buf, format="PDF", resolution=144)
        buf.seek(0)
        letterhead_page = PdfReader(buf).pages[0]
        letterhead_page.merge_page(page)  # letterhead behind, content in front
        writer.add_page(letterhead_page)

        x1, y1, x2, y2 = link_rect
        writer.add_annotation(
            page_number=i,
            annotation=Link(rect=(x1, y1, x2, y2), url=CONTACT_LINK_URL, border=[0, 0, 0]),
        )

    with open(str(output_path), "wb") as f:
        writer.write(f)

    print(f"  synced -> {output_path.name} ({total_pages} page(s))")
    return output_path


def load_logo(logo_path):
    logo_path = Path(logo_path)
    if not logo_path.exists():
        print(f"Error: logo not found: {logo_path}")
        sys.exit(1)
    logo_img = Image.open(str(logo_path))
    if logo_img.mode not in ("RGB", "RGBA"):
        logo_img = logo_img.convert("RGBA")
    return logo_img


def main(target, logo_path):
    target = Path(target)
    if not target.exists():
        print(f"Error: path not found: {target}")
        sys.exit(1)

    logo_img = load_logo(logo_path)
    print(f"Logo: {logo_path}")

    if target.is_dir():
        md_files = sorted(target.rglob("*.md"))
        if not md_files:
            print(f"No Markdown files found in {target}")
            return
        print(f"Syncing {target} — {len(md_files)} Markdown file(s):")
        for md in md_files:
            sync_markdown(md, logo_img)
    else:
        print(f"Input: {target}")
        sync_markdown(target, logo_img)

    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    target_arg = sys.argv[1]
    logo_arg = sys.argv[2] if len(sys.argv) > 2 else str(DEFAULT_LOGO_PATH)
    main(target_arg, logo_arg)
