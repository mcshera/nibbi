---
name: nibbi-fixer-brief
description: Prepare a self-contained brief when delegating a code change through Nibbi to a registered project's fixer.
metadata:
  nibbi:
    roles: [lead]
    providers: [claude, codex]
---

Give the fixer the decision context it cannot infer from the repository: desired behavior, relevant prior decisions, constraints, and an observable acceptance condition. Include file locations only when known; distinguish guesses from inspected evidence.

For roadmap work, carry the exact checkbox text or its `nibbi-task` ID. Do not redispatch a task that already has active or staged work. A dependency is ready only after its prerequisite has merged, not when its agent reports completion.

Use `dispatch_fixer` with a fresh `requestId` for a new task. Reuse that ID only when checking the same request after a transport failure. If dispatch reports an interrupted or in-progress command, inspect the run list before taking further action.

Dispatch stages work for review. It does not authorize a merge, deployment, wider repository access, or activation of another skill.
