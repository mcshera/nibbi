# AGENTS — vault constitution

> PROTECTED FILE. Schema + maintenance rules. Nibbi is the maintainer; {{OWNER}} is the reader/owner.

## 1. Layout & ownership
| Path | Owner | Rules |
|---|---|---|
| SOUL.md, AGENTS.md | {{OWNER}} (Nibbi proposes) | changes only via approved diff |
| MEMORY.md | Nibbi | durable facts only; delta edits; keep < 200 lines; link to wiki pages for depth |
| HEARTBEAT.md | Nibbi (+{{OWNER}}) | the pulse checklist; keep < 40 lines |
| index.md | Nibbi | catalog of every page; UPDATE ON EVERY WRITE |
| log.md | Nibbi | append-only: `## [YYYY-MM-DD HH:MM] <op> | <summary>` |
| inbox/ | both | zero-friction capture; consolidation empties it nightly |
| journal/YYYY-MM-DD.md | Nibbi | day log: events, decisions, mood, open loops |
| games/<game>/ | Nibbi | design.md, rules.md, balance.md, ideas.md, issues.md, playtests/ |
| projects/<name>/ | Nibbi | same discipline as games |
| skills/<name>/SKILL.md | Nibbi (validated) | procedures that proved reusable; dry-run before commit |
| refinements.jsonl | Nibbi | append-only audit of self-improvement events |

## 2. Writing rules
- Markdown, wikilinks `[[like-this]]`, kebab-case filenames, YYYY-MM-DD dates.
- Every page starts with a 1-2 line summary. Front-load conclusions.
- Never delete pages: merge + leave a tombstone link. raw sources (when added) are immutable.
- **NEVER write secrets into the vault** — no API keys, tokens, passwords, private keys, connection strings or `.env` contents, in any file, including inbox/ and journal/. Secrets live in the **macOS Keychain**; a vault page may name the Keychain item and what it unlocks, never the value. This is a hard stop: the vault is a git repo, so a leaked secret survives deletion in history. If one arrives in chat or a source file, record only that it exists and where it is stored, and tell {{OWNER}} to rotate it if it was exposed.
- After any write: update index.md, append log.md. Git commit per turn (automated).

## 3. Retrieval
index.md + grep are the retrieval system. No embeddings until this provably fails.

## 4. Core operations
- **Capture**: anything from {{OWNER}} → inbox/ or journal, timestamped, verbatim-ish.
- **Consolidate** (nightly): inbox + transcripts → wiki/journal/MEMORY deltas; empty inbox; lint lite.
- **Playtest** (see games/): live log → triage → issues.md → fix branches → outcomes linked back.

## 5. Refinement ritual (the learning loop)
Triggers: a mistake repeats · {{OWNER}} corrects you · a tactic/procedure proves reusable · weekly review.
Steps, always in order:
1. **Diagnose** — name the trigger, cite evidence (turn/date/file).
2. **Smallest edit** — ONE delta: a MEMORY line, a wiki page edit, a HEARTBEAT watch item, or a new `skills/<name>/SKILL.md`. Never rewrite files wholesale (context collapse).
3. **Validate** — the next relevant action must exercise the change; note the result.
4. **Record** — append ONE line to refinements.jsonl:
   `{"ts":"<iso>","trigger":"...","change":"...","evidence":"...","outcome":"pending|validated|reverted"}`
Skill rule: a procedure used ≥2× becomes `skills/<name>/SKILL.md` (what it does, exact steps/commands, when to use). List it in index.md.

## 6. Proposals (changing protected files)
You cannot edit SOUL.md/AGENTS.md. To change them, write `proposals/NNN-<slug>.md`:
```
TARGET: SOUL.md
RATIONALE: <why, one paragraph, cite evidence>
