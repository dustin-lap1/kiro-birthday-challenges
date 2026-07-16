# Day 4: Build One App With One Sentence

**Challenge:** turn one sentence into a working app using **Kiro Specs**. No planning docs, no architecture diagrams — just one declarative sentence, let Kiro generate the full requirements, design, and tasks, then follow that spec to build and deploy a working app. The starting point must be *genuinely* one sentence, the spec must be Kiro-generated (not hand-written), and the first commit must contain that Kiro-generated spec unmodified.

**This build:** *Kiroman.* A cute, Kiro-branded twist on Pac-Man: you enter an alias, then run from **Kiro** through a maze, racing to reach as many levels as you can. A **global top-three leaderboard** (highest level reached, across all players) sits up top and refreshes on every page load, there's a friendly "Welcome to Kiroman!" banner, and you can pause any time with the spacebar on web or a tap on mobile. It's playable on both web and mobile, and it's deployed to AWS on a fully serverless stack — the same S3 + CloudFront + API Gateway + Lambda + DynamoDB pattern every Lap 1 Labs project uses.

## The one sentence

This is the entire starting point — one declarative sentence, one main idea. It lives verbatim in [`SPEC-INPUT.md`](SPEC-INPUT.md) and is what was fed into Kiro's spec mode:

```
Build Kiroman, a cute, Kiro-branded twist on Pac-Man where a player enters an alias and runs from Kiro through a maze while competing on a global top-three leaderboard of highest levels reached that refreshes on every page load, playable on both web and mobile with a spacebar-or-tap pause, and deployed to AWS as a serverless app.
```

From that single sentence, Kiro generated the full spec — requirements, design, and an ordered task list — into `.kiro/specs/kiroman/` in the app repo. I didn't write the spec by hand; I wrote the sentence and let Kiro do the rest, then followed the tasks to build and ship.

## How it works

```
  One sentence            Kiro Spec mode                 Follow the tasks              Deployed app
  ───────────      ──▶    ─────────────────      ──▶     ─────────────────      ──▶    ─────────────
  SPEC-INPUT.md           requirements.md                build the maze,               kiroman on
  (single idea)           design.md                      leaderboard, alias            S3 + CloudFront
                          tasks.md                       gate, pause, deploy           (API GW+Lambda+DDB)
```

1. **One sentence in.** `SPEC-INPUT.md` holds the single declarative sentence.
2. **Kiro generates the spec.** Spec mode expands the sentence into `requirements.md`, `design.md`, and `tasks.md` under `.kiro/specs/kiroman/`. The first commit preserves that generated spec unmodified.
3. **Follow the tasks.** Kiro works the task list: the maze + Kiroman movement, the "run from Kiro" chase, the alias gate, the pause control, the mobile/web layout, the leaderboard, and the serverless backend.
4. **Deploy serverless.** The frontend ships to S3 + CloudFront; the leaderboard is an API Gateway HTTP API in front of a Node.js Lambda backed by a DynamoDB table, so scores are global and read fresh on every page load.

## The end-to-end process (surrounding the spec)

The challenge is one-sentence-in, working-app-out — but a working app needs a home, an account, and a deploy path. Rather than encode all of that into the sentence, the app was stood up using the Lap 1 Labs bootstrap process for minting new projects consistently on AWS, which we call **LaunchPad**, then the Kiro-generated spec drove the actual build. The full journey:

1. **Copy the bootstrap.** Reuse the LaunchPad tooling in `C:\Dev\bootstrap` (`New-Project.ps1`, `config.ps1`, and the Terraform/frontend templates) so Kiroman gets the same infrastructure and deploy scripts as every other project, for consistency.
2. **Create the GitHub repo.** A new **public** repo, `dustin-lap1/kiroman`.
3. **Clone locally.** Into the workspace at `C:\Dev\kiroman`.
4. **Reuse the AccountRef AWS account.** To save steps, Kiroman deploys into the existing sandbox account tied to `C:\Dev\accountref` (account `468895763486`, region `us-east-1`) instead of minting a brand-new account — so bootstrap runs with `-SkipAwsAccount`. Kiroman still gets its own dedicated `kiroman-terraform` IAM user/profile inside that account for clean isolation.
5. **Scaffold Terraform + infra.** Bootstrap the Terraform remote state (S3 + DynamoDB lock) and the main stack (S3 site bucket + CloudFront), applied plan-first (reviewed, not auto-approved) since the account is shared, then deploy the "Welcome to Kiroman!" scaffold to AWS.
6. **Build the app from the spec.** With baseline infra live, follow the Kiro-generated spec to build the game and the leaderboard backend, using Kiro branding, colors, and logo — cute, fun, and interactive — optimized for both mobile and web.
7. **Deploy.** Ship the finished game to AWS on the serverless stack via `deploy.ps1` (build → S3 sync → CloudFront invalidation).

> **Note on the AWS account:** Kiroman intentionally shares the AccountRef account to skip account creation. This is a convenience for a birthday-week game, not the pattern for a production service — LaunchPad's default is a dedicated account per project.

## The prompt, in full (what my idea actually looked like)

The challenge wants one sentence, but here's the fuller idea I had in my head before I distilled it — captured so you can see how a messy, multi-part vision became a single starting sentence:

> Create a game called "Kiroman" that's just like Pac-Man, only the player is running from Kiro (using the Kiro logo/image). Copy the bootstrap I use for minting new projects so it has all the same infrastructure and deploy scripts; create a new public GitHub repo called "kiroman" in my account and clone it to `C:\Dev\kiroman`; scaffold Terraform and deploy to AWS, reusing the AccountRef account instead of creating a new one to save steps. Once baseline infra is up, build the app and deploy it serverless like my other apps. Use Kiro branding, colors, and logo — make it really cute, fun, and interactive, and optimized for both mobile and web so it plays great everywhere. Put a clear "Welcome to Kiroman!" message at the top and a global leaderboard showing the top 3 levels reached across all users, refreshed on page load so it's always fresh. To start, a user enters their alias; they can pause with the spacebar on web (or a tap on mobile).

That whole paragraph is the vision. The **one sentence** in `SPEC-INPUT.md` is the genuine, single-sentence starting point I actually fed to Kiro's spec mode.

## Files

| Path | Purpose |
|------|---------|
| `README.md` | This writeup (challenge, the one sentence, how Kiro built it, submission) |
| `SPEC-INPUT.md` | The single declarative sentence fed into Kiro spec mode |

> The Kiro-generated spec itself (`requirements.md`, `design.md`, `tasks.md`) lives in the **Kiroman app repo** at `.kiro/specs/kiroman/` (`github.com/dustin-lap1/kiroman`), committed unmodified in the first commit as the challenge requires.

## The most interesting caveat: the foundation that came before the prompt

Perhaps the most interesting caveat to this challenge is what already existed in my Kiro workspace *before* I wrote the prompt: **deployment guidance**. Having steering documents in a multi-root workspace is enormously valuable — particularly guidance on how to mint new GitHub repos and how to manage and deploy infrastructure in cloud accounts. Once that guidance is in place, it becomes an instrumental foundation layer for every subsequent project. It also lets Kiro take a single-shot prompt for a new idea and turn it into a working app quickly, without stopping to ask a lot of questions (which consumes both time and credits/tokens). Once you have a repeatable system in place, launching your next idea is much easier, and the architectural patterns stay consistent whether it's your 10th project or your 100th. Building Kiroman took about **2 hours** — without those foundations it would likely have taken many more.

---

## Submission details (copy/paste)

**Challenge day:** Day 4: Build one app with one sentence

**Project name:**
```
Kiroman
```

**Public GitHub repo link:**
```
https://github.com/dustin-lap1/kiroman
```

**Demo video link:**
```
<add your 30-60s demo video link here>
```

**Short description (2-3 sentences):**
```
Kiroman is a cute, Kiro-branded twist on Pac-Man where you enter an alias and run from Kiro through a maze, chasing the highest level you can reach while a global top-three leaderboard refreshes on every page load. It plays on both web and mobile (spacebar or tap to pause) and is deployed to AWS on a fully serverless stack (S3 + CloudFront + API Gateway + Lambda + DynamoDB). The entire app started from a single declarative sentence that Kiro's spec mode expanded into the requirements, design, and task list I then followed to build and ship it.
```

**How Kiro was used (150-300 words):**
```
This build is the purest form of spec-driven development: one sentence in, a working app out. I wrote a single declarative sentence describing Kiroman - a cute, Kiro-branded Pac-Man where you flee from Kiro, enter an alias to start, compete on a global top-three leaderboard that refreshes on page load, pause with spacebar or a tap, play on web and mobile, and deploy serverless - and handed it to Kiro's spec mode. Kiro expanded that sentence into a full spec: requirements, a design, and an ordered task list under .kiro/specs/kiroman/, committed unmodified as the first commit.

To give the app a home, I reused my LaunchPad bootstrap: Kiro copied the same infrastructure and deploy tooling my other projects use, created a public GitHub repo, cloned it locally, and scaffolded Terraform. To save steps for a birthday-week game, I pointed it at my existing AccountRef AWS account instead of minting a new one, so it ran the bootstrap with the skip-account flag and stood up the Terraform state, S3 site bucket, and CloudFront distribution.

From there Kiro worked the generated task list: the maze and Kiroman movement, the chase logic, the alias gate, the pause control, the responsive mobile/web layout with Kiro branding and colors, and a serverless leaderboard (API Gateway HTTP API to a Node.js Lambda backed by DynamoDB) so scores are global and read fresh on load. Kiro built it, deployed it to S3 + CloudFront, and verified it end to end. What started as one sentence became a deployed, playable game - with the Kiro-generated spec as the source of truth the whole way.
```

**Social post (X or LinkedIn):**
```
Day 4 of Kiro Birthday Week: one sentence in, a working app out. I described "Kiroman" - a cute, Kiro-branded Pac-Man where you run from Kiro and climb a global leaderboard - in a single sentence, let Kiro Specs generate the requirements, design, and tasks, then followed them to build and ship it serverless on AWS. Play on web or mobile.

Repo: https://github.com/dustin-lap1/kiroman

#BuildWithKiro #TeamKiro @kirodotdev
```

---

## Demo video script (~30-60 seconds)

Read the lines aloud; the cues in brackets are what to show on screen.

> **[0:00 — Kiro open, SPEC-INPUT.md visible]**
> "For Day 4, the rule is one sentence in, a working app out. Here's my sentence: Kiroman, a cute Kiro-branded twist on Pac-Man where you run from Kiro and climb a global leaderboard, deployed serverless on AWS."
>
> **[0:12 — Show .kiro/specs/kiroman with requirements.md, design.md, tasks.md]**
> "I fed that one sentence into Kiro's spec mode, and Kiro generated the whole spec — requirements, design, and tasks — no hand-writing. That generated spec is my first commit, unmodified."
>
> **[0:26 — Cut to the deployed game, "Welcome to Kiroman!" banner + leaderboard]**
> "Then I followed the tasks to build it. Here's the deployed app: the welcome banner, the global top-three leaderboard up top, and the alias gate to start."
>
> **[0:40 — Enter an alias, play, run from Kiro, hit spacebar to pause]**
> "You enter an alias, then run from Kiro through the maze. Spacebar pauses on web, a tap on mobile — and it plays great on both."
>
> **[0:52 — Show the leaderboard updating on reload]**
> "Reach a new high level and it lands on the global leaderboard, fresh on every page load. One sentence, one Kiro-generated spec, one deployed game. That's Day 4."
