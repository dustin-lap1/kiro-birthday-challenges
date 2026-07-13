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

---

## Submission details (copy/paste)

**Challenge day:** Day 1: Build a hook

**Project name:**
```
Branded PDF on Export
```

**Public GitHub repo link:**
```
https://github.com/dustin-lap1/kiro-birthday-challenges
```

**Demo video link:**
```
<paste your video link here>
```

**Short description (2–3 sentences):**
```
Branded PDF on Export is a Kiro hook that automatically drops company letterhead onto any PDF the moment it's exported into a watched folder. The instant a plain PDF appears, the hook generates a branded twin with the company logo, a CONFIDENTIAL marker, a contact footer, and a clickable website link — so off-brand documents never go out the door. The automation is idempotent and loop-safe, so it quietly keeps every exported document on-brand with zero manual steps.
```

**How Kiro was used (150–300 words):**
```
I built this entirely inside Kiro. I started from an existing manual "brand a PDF" script I'd used on another project and asked Kiro to repurpose it into a reusable, automatic workflow for a fresh public repo. Kiro created the GitHub repository, cloned it into my workspace, and scaffolded a clean per-challenge folder structure.

The core of the build is Kiro's agent hooks. Kiro authored two file-triggered hooks in the .kiro folder: one on fileCreated and one on fileEdited, both watching the docs folder for PDFs. When an export lands, the hook runs a Python branding engine that overlays a navy letterhead — logo, CONFIDENTIAL marker, contact footer, and a clickable link — producing a "-branded" twin of the file.

A real risk with file-watching hooks is an infinite loop: the hook writes a PDF, which triggers the hook again. Kiro solved this by making the script skip any file already named "-branded" and only rebuild when the source is newer than its branded copy, so the output is idempotent and loop-safe.

Kiro also wrote a small helper that simulates exporting a document to PDF, a sample one-pager, a requirements file, and this documentation. Throughout, Kiro ran the full pipeline in the terminal to verify it end to end — exporting a plain PDF, branding it, and confirming re-runs were correctly skipped — before committing and pushing. What would have been an afternoon of glue code became a working, documented, automated hook in one session.
```

**Social post (X or LinkedIn):**
```
Day 1 of Kiro Birthday Week: I built a Kiro hook that auto-brands my PDFs. The moment I export a doc to PDF, the hook drops my company letterhead — logo, footer, the works — onto a branded copy. Idempotent and loop-safe, zero manual steps.

Repo: https://github.com/dustin-lap1/kiro-birthday-challenges

#BuildWithKiro #TeamKiro @kirodotdev
```

---

## Demo video script (~1–2 minutes)

Read the lines aloud; the cues in brackets are what to show on screen.

> **[0:00 — On camera or Kiro open, Agent Hooks panel visible]**
> "Every team knows this pain: you export a document to PDF, and you forget to
> put it on company letterhead. So off-brand docs go out the door. For Day 1 of
> Kiro Birthday Week, I built a Kiro hook that fixes that automatically."
>
> **[0:15 — Show the two hooks in the Agent Hooks panel]**
> "I've got two hooks here: 'Branded PDF on Export' and 'Branded PDF on Update.'
> They watch my docs folder for any PDF — one fires when a PDF is created, the
> other when it's re-exported."
>
> **[0:30 — Open sample-one-pager.md, then run the export command]**
> "Here's a plain one-pager. I'll export it to PDF, just like any export tool
> would. Watch the docs folder."
>
> **[0:45 — The hook fires; a -branded.pdf appears]**
> "The moment the PDF lands, the hook runs. And there it is — a branded twin
> shows up automatically. No button, no reminder."
>
> **[1:00 — Open sample-one-pager-branded.pdf]**
> "Same document, now on letterhead: my logo up top, a CONFIDENTIAL marker, and
> a footer with contact info and a clickable website link."
>
> **[1:15 — Point at the script or say it]**
> "The neat part is it's loop-safe. The hook writes a PDF, which could trigger
> the hook again forever — but the script skips anything already branded and only
> rebuilds when the source is newer. So it just quietly keeps every export
> on-brand."
>
> **[1:30 — Close]**
> "One hook, something genuinely useful, built with Kiro. That's Day 1."
