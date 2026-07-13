"""
Simulate "exporting a document to PDF".

This stands in for whatever tool you normally use to export a doc to PDF
(Word, Google Docs, a Markdown previewer, etc.). It renders a Markdown file to
a plain, UN-branded PDF and drops it in the same folder.

Dropping that PDF into the watched docs folder is what fires the
"Branded PDF on Export" Kiro hook, which then produces the branded twin.

Usage:
    python export-to-pdf.py ../docs/sample-one-pager.md
"""

import sys
from pathlib import Path

import markdown
from xhtml2pdf import pisa


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


def export(md_path):
    md_path = Path(md_path)
    if not md_path.exists():
        print(f"Error: file not found: {md_path}")
        sys.exit(1)

    out_path = md_path.with_suffix(".pdf")
    html_body = markdown.markdown(
        md_path.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code"],
    )
    full_html = HTML_TEMPLATE.format(content=html_body)

    print(f"Exporting {md_path.name} -> {out_path.name}")
    with open(str(out_path), "wb") as f:
        status = pisa.CreatePDF(full_html, dest=f)

    if status.err:
        print(f"Error exporting PDF: {status.err}")
        sys.exit(1)
    print(f"Exported plain PDF: {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python export-to-pdf.py <input.md>")
        sys.exit(1)
    export(sys.argv[1])
