# Run a bounded Nibbi voice evaluation

This invokes the real Claude provider adapter with the official subscription sign-in. It consumes provider usage. It does not adopt a personality, enable act-tools, or read installed user memories. Review the inputs and explicitly choose to run it.

Requires the repository's installed Node dependencies and an already signed-in, unmodified Claude Code CLI. There is no API-key fallback and no credential copying. `tsx` resolves from the daemon workspace.

From the repository root, prepare a candidate snapshot (new directory, no owner vault files):

```bash
REPO="$(pwd)"
mkdir -p "$REPO/output/personality-review/my-snapshot"
cp "$REPO/vault-template/SOUL.md" "$REPO/output/personality-review/my-snapshot/candidate-SOUL.md"
cp "$REPO/vault-template/AGENTS.md" "$REPO/output/personality-review/my-snapshot/candidate-AGENTS.md"
```

Check the argument contract first. All data/output arguments must be absolute paths:

```bash
cd "$REPO/daemon"
node --import tsx "$REPO/tools/personality-eval.mjs" --help
node --import tsx "$REPO/tools/personality-eval.mjs" --snapshots "$REPO/output/personality-review/my-snapshot" --cases "$REPO/docs/personality/eval-cases.json" --out "$REPO/output/personality-review/my-run" --variants candidate --validate-only
```

After reviewing that validation, run the same command without `--validate-only` to make real provider calls. The output directory must be new and stay under `output/personality-review/`. A run permits at most 32 total turns, two concurrent conversations, 85 seconds per turn, and less than 10 minutes overall. Do not add real account data, personal history, or secrets to fixtures.

`eval-cases.json` contains 12 scenarios / 20 user turns with only `id`, `context`, and `users`. No reference answers or judging rules enter model prompts. Each scenario has a new session; later turns resume its actual generated conversation. The complete SOUL/AGENTS prompt is built from the synthetic vault. Skills and governed tools are empty. Native lead policy still constrains any exposed Read attempt.

The runner records exact fixture prompts, model replies, observed model identity, prompt/source hashes, hashed resume evidence, errors, and cleanup state. It preserves its executed source. Actual credentials, account addresses, and raw session IDs are not recorded. Normal completion cleans up the owned synthetic vault/state and uniquely named CLI project transcript folders; ordinary official CLI credential bookkeeping is not independently inspected.

Use [BLIND-RUBRIC.md](BLIND-RUBRIC.md) to grade the actual replies. A command exit of zero means the conversations completed, not that their personality was good. Keep bad replies as evidence. For a baseline comparison, provide matching `baseline-SOUL.md` / `baseline-AGENTS.md` snapshots and request both variants; the total still must stay below 32 turns, so choose a smaller case subset.

**Next step:** inspect the dry-run configuration and usage scope before starting a live run.
