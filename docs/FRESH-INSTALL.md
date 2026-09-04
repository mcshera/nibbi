# Fresh-install test protocol

*Use this on a second Mac (best) or a brand-new macOS user account on this one. The point is to see what a stranger sees.*

## Before you start
- The Mac has: macOS 13+, internet, and you know your Apple ID (for Xcode CLT) and Claude account.
- Nothing Nibbi-related on it: no `~/.nibbi`, `~/NibbiVault`, `~/Nibbi-app`, no `com.nibbi.*` in `launchctl list`.
  (To reset a previous attempt: `bash uninstall.sh --purge && rm -rf ~/NibbiVault ~/NibbiProjects ~/Nibbi-app`.)
- Have a stopwatch. Note every moment you had to *think*.

## The run (write down what happened at each step)
1. **Prereqs** — open Terminal, run `git --version` (accept the Xcode CLT install if asked) and `node -v`.
   Expected: Node ≥ 22. If not, install from nodejs.org. *Time it.*
2. **Get Nibbi** — `git clone https://github.com/mcshera/nibbi.git ~/Nibbi-app && cd ~/Nibbi-app`.
3. **Install** — `bash install.sh`. Expected, in order: ✓ git · ✓ node · Claude Code installed (or found) · state in `~/.nibbi` ·
   vault created at `~/NibbiVault` · daemon dependencies installed · `com.nibbi.gateway running` · `com.nibbi.host running` ·
   `brain reachable through the host` · Nibbi.app installed and opened.
   Red flags: any ✗, `npm ci failed`, "host is up but the brain isn't answering".
4. **First launch** — macOS may say Nibbi.app "cannot be opened" (ad-hoc signature): right-click → Open. Expected: the
   ink blot appears, breathes, blinks; the top-right dot is quiet (connected). If the dot says "brain offline", run
   `~/.nibbi/bin/nibbi-doctor` and read the ✗ line.
5. **Log in to Claude** — in Terminal run `claude`, log in, quit. (Nibbi's brain uses this login; no keys are stored.)
6. **First words** — type `hi`. Expected: a reply in Nibbi's voice within ~10 s, steps folding under it. Then type `/`
   and see the palette; `/help` lists the commands.
7. **First project** — `/new hello web` → expected: repo at `~/NibbiProjects/hello`, vite scaffold, `npm install` log,
   `play it` chip → `/play hello` opens a dev server. `/project` shows the card.
8. **First fixer** — `/fix add a footer with the year to index.html`. Expected: a small coloured Nibbi perches on the
   pill; a bubble "done and staged … Review it?" within a few minutes; `/diff <id>` shows the change; `approve & merge`
   merges it. (`/auto hello ship` would have merged it automatically.)
9. **Voice (optional)** — `bash install.sh --voice`, wait for the models, then `⌥Space`, say "what's new?".
10. **Come back later** — quit the app, wait 20 min, reopen. Expected: "while you were away" if anything happened; the
    conversation is still there (it survives restarts for 12 h).

## What "good" looks like
- Step 3 under 3 minutes on a normal connection; step 6 first reply under 15 s.
- Zero moments where you had to open a file to figure out what to do next.
- `~/.nibbi/bin/nibbi-doctor` all green (voice lines only if you installed voice).

## Reporting
Paste the terminal output of `install.sh` and `nibbi-doctor`, plus your notes, into the Nibbi app on your main Mac:
"here's the fresh-install log from the laptop: …" — Nibbi files it as issues on the `nibbi` project.

## Reset and retry
`bash uninstall.sh --purge && rm -rf ~/NibbiVault ~/NibbiProjects ~/Nibbi-app` — then start from step 2.
