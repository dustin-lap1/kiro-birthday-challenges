# Day 1 — Build a Hook That Automates Something Meaningful

**Challenge:** build a Kiro hook that automates something meaningful and produces
visible output in response to a change.

**This build:** *Branded PDF in Sync.* Every team ships documents — pitches,
one-pagers, briefs — and every time, someone has to remember to drop them onto
company letterhead. That manual step gets skipped, and off-brand PDFs go out the
door. This hook removes the step entirely.

Any time you create or update a Markdown file in the watched `docs/` folder, a
Kiro hook fires and automatically (re)generates a matching **branded PDF** — same
name, letterhead applied — so the polished document is always in sync with the
source. No commands, no forgetting.

## How it works

```
  You create/edit a .md and save        Kiro hook fires                  Branded output (in sync)
  ─────────────────────────      ──▶      ─────────────────────      ──▶     ─────────────────────
  docs/sample-one-pager.md              fileCreated / fileEdited            docs/sample-one-pager.pdf
  (the source of truth)                 runs md-to-branded-pdf.py           (logo + letterhead + footer)
```

1. You create or edit a `.md` file in `day-01-branded-pdf-hook/docs/` and save.
2. The hook `Branded PDF in Sync (on create)` (`fileCreated`) or
   `Branded PDF in Sync (on update)` (`fileEdited`) triggers.
3. It runs `md-to-branded-pdf.py` against the `docs/` folder.
4. The matching branded PDF (`<name>.pdf`) is created or refreshed.

### Why it does not loop

The hooks watch `*.md` and the script writes `*.pdf`, so generating the PDF can
never re-trigger the hook. On top of that, the script only rebuilds a PDF when its
Markdown source is newer, so re-runs are cheap no-ops.

## Files

| Path | Purpose |
|------|---------|
| `../.kiro/hooks/brand-md-on-create.kiro.hook` | Hook: on `.md` **created** in `docs/`, build its branded PDF |
| `../.kiro/hooks/brand-md-on-update.kiro.hook` | Hook: on `.md` **edited** in `docs/`, refresh its branded PDF |
| `scripts/md-to-branded-pdf.py` | One-step engine: Markdown → branded PDF (letterhead overlay) |
| `assets/logo.png` | Company logo used on the letterhead |
| `docs/sample-one-pager.md` | Demo source document |
| `docs/sample-one-pager.pdf` | Branded PDF, generated and kept in sync by the hook |

## Try it

From the repo root:

```powershell
# 1. Install dependencies (once)
pip install -r day-01-branded-pdf-hook/requirements.txt
```

With the hooks enabled in Kiro, just **edit `docs/sample-one-pager.md` and save**
(or create a new `.md` in that folder) — the branded PDF appears/updates
automatically. To run the sync by hand (what the hook runs under the hood):

```powershell
python day-01-branded-pdf-hook/scripts/md-to-branded-pdf.py day-01-branded-pdf-hook/docs
```

## Make it your own

Open `scripts/md-to-branded-pdf.py` and edit the branding config block near the
top (`COMPANY_MARKER`, `CONTACT_PREFIX`, `CONTACT_LINK_TEXT`, `CONTACT_LINK_URL`)
and drop your own `assets/logo.png`.

---

## Submission details (copy/paste)

**Challenge day:** Day 1: Build a hook

**Project name:**
```
Branded PDF in Sync
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
Branded PDF in Sync is a Kiro hook that keeps a company-branded PDF perfectly in sync with its Markdown source. The moment you create or update a doc in the watched folder and save, the hook regenerates a matching PDF with the company logo, a CONFIDENTIAL marker, a contact footer, and a clickable website link — so off-brand documents never go out the door. It is loop-safe by design: the hook watches Markdown and writes PDF, so it never re-triggers itself.
```

**How Kiro was used (150–300 words):**
```
I built this entirely inside Kiro. I started from an existing manual "brand a PDF" script I'd used on another project and asked Kiro to repurpose it into an automatic, reusable workflow in a fresh public repo. Kiro created the GitHub repository, cloned it into my workspace, and scaffolded a clean per-challenge folder structure.

The heart of the build is Kiro's agent hooks. My goal was simple: whenever I create or update a Markdown doc, a branded PDF should stay in sync automatically — no commands. Kiro authored two file-triggered hooks in the .kiro folder, one on fileCreated and one on fileEdited, both watching the docs folder for Markdown. When a doc is saved, the hook runs a single Python engine that converts the Markdown to PDF and overlays a navy letterhead: logo, CONFIDENTIAL marker, contact footer, and a clickable link.

We iterated on the design together. My first version watched PDFs, which risked an infinite loop. Kiro reframed it so the source of truth is the Markdown and the PDF is a generated artifact — the hook watches .md and writes .pdf, so it can never re-trigger itself, and it only rebuilds when the source is newer.

Kiro also wrote the sample doc, requirements file, and documentation, and ran the full pipeline in the terminal to verify it end to end before committing and pushing. What would have been an afternoon of glue code became a working, documented, loop-safe hook in one focused session.
```

**Social post (X or LinkedIn):**
```
Day 1 of Kiro Birthday Week: I built a Kiro hook that keeps my docs on-brand automatically. Edit a Markdown file, hit save, and a company-letterhead PDF regenerates in sync — logo, footer, the works. Loop-safe, zero manual steps.

Repo: https://github.com/dustin-lap1/kiro-birthday-challenges

#BuildWithKiro #TeamKiro @kirodotdev
```

---

## Demo video script (~1–2 minutes)

Read the lines aloud; the cues in brackets are what to show on screen.

> **[0:00 — On camera or Kiro open, Agent Hooks panel visible]**
> "Every team knows this pain: you write a document, export it, and forget to put
> it on company letterhead — so off-brand docs go out the door. For Day 1 of Kiro
> Birthday Week, I built a Kiro hook that keeps my docs on-brand automatically."
>
> **[0:15 — Show the two hooks in the Agent Hooks panel]**
> "I've got two hooks watching my docs folder: one fires when I create a Markdown
> file, the other when I edit one. My Markdown is the source of truth — the
> branded PDF just stays in sync."
>
> **[0:30 — Open sample-one-pager.md side by side with the branded PDF]**
> "Here's a one-pager in Markdown, and its branded PDF next to it. Watch what
> happens when I change the doc."
>
> **[0:45 — Edit a line in the Markdown and hit Save]**
> "I'll tweak a headline and save."
>
> **[0:55 — The hook fires; the PDF regenerates]**
> "The moment I save, the hook runs and the PDF regenerates itself — no button,
> no command."
>
> **[1:05 — Show the refreshed branded PDF]**
> "Same document, on letterhead: my logo up top, a CONFIDENTIAL marker, and a
> footer with contact info and a clickable website link."
>
> **[1:20 — Optionally create a brand-new .md in docs/ and save]**
> "And if I create a brand-new doc, its branded PDF appears automatically too."
>
> **[1:35 — Say it]**
> "The clever part is it's loop-safe: the hook watches Markdown and writes PDF, so
> it can never trigger itself, and it only rebuilds when the source actually
> changed."
>
> **[1:50 — Close]**
> "One hook, something genuinely useful, built with Kiro. That's Day 1."
