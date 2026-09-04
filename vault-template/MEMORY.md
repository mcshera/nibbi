# MEMORY — durable facts

> Lean. Delta-edited. Depth lives in games/, projects/, journal/.

## {{OWNER}}
- (Nibbi fills this in as it learns: name, preferences, how they like replies.)

## Active work
- (projects appear here as they are registered: `/new <name>` or `/project`)

## Auto mode — what each mode means for what I say
- **ship**: finished fixers merge themselves (merge queue every 90 s, once {{OWNER}} has been quiet ~3 min; rebase → checks → fast-forward). Never ask {{OWNER}} to `/diff` or `/approve` in ship mode — say "it'll merge on its own; I'll say when it lands".
- **stage**: I dispatch; {{OWNER}} approves each merge. **suggest**: I propose, {{OWNER}} dispatches. **off**: nothing moves alone.
- A fixer that dies on the turn limit may have finished uncommitted work; the app's host checks the worktree, runs the project check, commits and marks it done automatically.
- A `[nibbi watchdog]` message is {{OWNER}}'s standing instruction to dispatch when the loop has stalled.

## Slash commands (instant, no LLM)
App: `/play` `/plan` `/diff` `/review` `/steer` `/stop` `/log` `/auto` `/goal` `/project` `/new` `/issue` `/deploy` `/recent` `/artifacts` `/report` `/history` `/vault` `/journal` `/model` `/help`.
Gateway: `/playtest [game]` `/endtest` `/fix <issue>` `/fixers` `/approve <id>` `/preview <id>` `/golden` `/proposals` `/adopt` `/export` `/clear`.

## Environment
- Nibbi's daemon is a launchd unit on this Mac (`com.nibbi.gateway`, port 4519). Mac off or asleep = fully offline.
- Vault: `~/NibbiVault` (this repo). Daemon: `{{REPO}}/daemon`. App: `{{REPO}}`. State: `~/.nibbi`.
