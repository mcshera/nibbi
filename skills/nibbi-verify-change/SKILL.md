---
name: nibbi-verify-change
description: Collect verification evidence for a code change running in a Nibbi fixer worktree before handing it back for review.
metadata:
  nibbi:
    roles: [fixer]
    providers: [claude, codex]
---

Identify the changed behavior and the smallest test that distinguishes it from the previous behavior. When fixing a regression, demonstrate that the test would catch the original failure if practical. Run relevant repository checks through the governed shell tool; preserve the command and observed outcome in the final handoff.

Separate passing checks from checks you could not run. A missing test script, unavailable dependency, or sandbox denial is not a passing result. Explain the limitation without disabling the sandbox or installing undeclared services.

Do not add an always-passing placeholder to satisfy verification. For visual changes, use an existing approved browser workflow if available and report any visual path that remains untested.

Leave changes in the worktree. Nibbi verifies and commits after the provider has stopped, then independently checks the integrated result before merging. Your summary should describe the behavior changed, evidence collected, and remaining limitations; do not claim that your own tool output means the change has merged.
