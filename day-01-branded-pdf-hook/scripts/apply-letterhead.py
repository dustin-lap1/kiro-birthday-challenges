"""
Apply a branded letterhead to a PDF (or every PDF in a folder).

This is the engine behind the "Branded PDF on Export" Kiro hook. When a PDF is
exported into the watched folder, the hook runs this script, which produces a
branded twin of the file named "<name>-branded.pdf" with:

  - A dark navy header bar containing the company logo, a CONFIDENTIAL marker,
    and the page number.
  - A dark navy footer bar with contact info and a clickable website link.

Design notes
------------
- Idempotent + loop-safe: files already ending in "-branded" are skipped, so the
  hook does not re-trigger itself when it writes the branded output.
- "Create or update": a branded file is (re)generated only when it is missing or
  older than its source PDF, so re-running is cheap and safe.
- Accepts either a single .pdf path or a directory (branded in bulk).

Usage:
    python apply-letterhead.py <file.pdf | directory> [logo.png]

Examples:
    python apply-letterhead.py ../docs/sample-one-pager.pdf
    python apply-letterhead.py ../docs
"""

import sys
from pathlib import Path
from io import BytesIO

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

# Default logo lives alongside the challenge, in ../assets/logo.png
DEFAULT_LOGO_PATH = Path(__file__).parent.parent / "assets" / "logo.png"

# Page dimensions for US Letter at 144 DPI (2x for crisp raster overlays).
PAGE_WIDTH = 1224   # 8.5in * 144dpi
PAGE_HEIGHT = 1584  # 11in  * 144dpi

# Palette
DARK_NAVY = (15, 23, 42)     # #0f172a
TEAL = (6, 182, 212)         # #06b6d4
LIGHT_GRAY = (241, 245, 249) # #f1f5f9
WHITE = (255, 255, 255)

BRANDED_SUFFIX = "-branded"


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


def create_letterhead_page(page_number, total_pages, logo_img):
    """Build a single letterhead background page and the footer link rect."""
    page = Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), WHITE)
    draw = ImageDraw.Draw(page)

    # --- Header bar with logo ---
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

    # CONFIDENTIAL (left) + page number (accompanies footer, but marker here)
    font_marker = get_font(18, bold=True)
    marker_y = (header_height - 18) // 2
    draw.text((72, marker_y), COMPANY_MARKER, fill=TEAL, font=font_marker)

    # --- Footer bar with contact info ---
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

    # Right-aligned page number in the footer.
    page_text = f"Page {page_number} of {total_pages}"
    pg_bbox = draw.textbbox((0, 0), page_text, font=font_footer)
    pg_width = pg_bbox[2] - pg_bbox[0]
    draw.text((PAGE_WIDTH - pg_width - 72, text_y), page_text, fill=LIGHT_GRAY, font=font_footer)

    # Convert the link box from 144dpi image space to 72dpi PDF points
    # (PDF origin is bottom-left, y grows upward).
    link_rect = (
        link_bbox[0] / 2.0,
        (PAGE_HEIGHT - link_bbox[3]) / 2.0,
        link_bbox[2] / 2.0,
        (PAGE_HEIGHT - link_bbox[1]) / 2.0,
    )
    return page, link_rect


def brand_pdf(input_pdf_path, logo_img):
    """Create/refresh the branded twin of a single PDF. Returns output path or None."""
    input_pdf_path = Path(input_pdf_path)

    # Loop-safety: never brand an already-branded file.
    if BRANDED_SUFFIX in input_pdf_path.stem:
        print(f"  skip (already branded): {input_pdf_path.name}")
        return None

    output_path = input_pdf_path.with_stem(input_pdf_path.stem + BRANDED_SUFFIX)

    # Create-or-update: only regenerate when missing or stale.
    if output_path.exists() and output_path.stat().st_mtime >= input_pdf_path.stat().st_mtime:
        print(f"  up to date: {output_path.name}")
        return output_path

    reader = PdfReader(str(input_pdf_path))
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

    print(f"  branded -> {output_path.name} ({total_pages} page(s))")
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
        pdfs = sorted(
            p for p in target.rglob("*.pdf") if BRANDED_SUFFIX not in p.stem
        )
        if not pdfs:
            print(f"No unbranded PDFs found in {target}")
            return
        print(f"Scanning {target} — {len(pdfs)} candidate PDF(s):")
        for pdf in pdfs:
            brand_pdf(pdf, logo_img)
    else:
        print(f"Input: {target}")
        brand_pdf(target, logo_img)

    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    target_arg = sys.argv[1]
    logo_arg = sys.argv[2] if len(sys.argv) > 2 else str(DEFAULT_LOGO_PATH)
    main(target_arg, logo_arg)
