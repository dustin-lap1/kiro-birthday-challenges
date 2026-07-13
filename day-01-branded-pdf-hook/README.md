# Day 1 — Build a Hook That Automates Something Meaningful

**Challenge:** build a Kiro hook that automates something meaningful and produces
visible output in response to a change.

**This build:** *Branded PDF on Export.* Every team ships documents — pitches,
one-pagers, briefs — and every time, someone has to remember to drop them onto
company letterhead. That manual step gets skipped, and off-brand PDFs go out the
door. This hook removes the step entirely.

When you export a document to PDF into the watched folder, a Kiro hook fires and
automatically produces a fully branded twin with the company logo, a
`CONFIDENTIAL` marker, a contact footer, and a clickable website link — no manual
step, no forgetting.

## How it works

```
  You export a doc to PDF                 Kiro hook fires                 Branded output
  ─────────────────────      ──▶      ─────────────────────      ──▶     ─────────────────────
  docs/sample-one-pager.pdf          fileCreated / fileEdited            docs/sample-one-pager-branded.pdf
  (plain, no branding)               runs apply-letterhead.py            (logo + letterhead + footer)
```

1. A PDF lands in `day-01-branded-pdf-hook/docs/` (from any export tool).
2. The hook `Branded PDF on Export` (`fileCreated`) — or `Branded PDF on Update`
   (`fileEdited`) for re-exports — triggers.
3. It runs `apply-letterhead.py` against the `docs/` folder.
4. A branded twin `*-branded.pdf` is created or refreshed.

### Why it does not loop

The branding script skips any file whose name already contains `-branded`, and it
only rebuilds a twin when the source PDF is newer than the existing branded copy.
So when the hook writes `sample-one-pager-branded.pdf`, re-triggering is a no-op.

## Files

| Path | Purpose |
|------|---------|
| `../.kiro/hooks/brand-pdf-on-export.kiro.hook` | Hook: on PDF **created** in `docs/`, brand it |
| `../.kiro/hooks/brand-pdf-on-update.kiro.hook` | Hook: on PDF **edited** in `docs/`, re-brand it |
| `scripts/apply-letterhead.py` | Branding engine (logo + header/footer overlay) |
| `scripts/export-to-pdf.py` | Stand-in for "export a doc to PDF" (Markdown → plain PDF) |
| `assets/logo.png` | Company logo used on the letterhead |
| `docs/sample-one-pager.md` | Demo source document |

## Try it

From the repo root:

```powershell
# 1. Install dependencies (once)
pip install -r day-01-branded-pdf-hook/requirements.txt

# 2. "Export" the sample doc to a plain PDF — this drops a PDF into docs/,
#    which is what the hook watches for.
python day-01-branded-pdf-hook/scripts/export-to-pdf.py day-01-branded-pdf-hook/docs/sample-one-pager.md
```

With the hook enabled in Kiro, step 2 triggers it automatically and
`docs/sample-one-pager-branded.pdf` appears. To run the branding step by hand
(what the hook runs under the hood):

```powershell
python day-01-branded-pdf-hook/scripts/apply-letterhead.py day-01-branded-pdf-hook/docs
```

## Make it your own

Open `scripts/apply-letterhead.py` and edit the branding config block near the
top (`COMPANY_MARKER`, `CONTACT_PREFIX`, `CONTACT_LINK_TEXT`, `CONTACT_LINK_URL`)
and drop your own `assets/logo.png`.
