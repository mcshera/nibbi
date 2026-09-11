# MCP: external servers in, Nibbi tools out

## External MCP servers (client)

Settings → MCP lets you register MCP servers Nibbi may use: a `stdio` command (with args and an absolute working folder) or a Streamable HTTP URL. Each server has a slug name, an enabled flag, the projects it serves (or `*`), optional allow/deny lists of remote tool names, and limits (timeout, argument bytes, result bytes).

Secrets never sit in the server record. List the environment names (`secretEnv`) or header names (`secretHeaders`) a server needs, then use "Store secret" to type each value into Terminal; `security` writes it to Keychain (`com.nibbi.mcp` / `<server>/<NAME>`). Non-secret environment values may be declared inline; anything that looks like a token, key or password is refused there. Stdio children start with a stripped environment plus the declared values.

A server's tools appear to Nibbi only while the server is enabled, connected and allowed for the active project. Each remote tool becomes a governed tool named `ext_<server>_<tool>`, described as `[External MCP: <server>] …`, and its results carry the untrusted-content caution. Calls are bounded by the server's limits; a transport failure demotes the server to Error so its tools leave the next turn until Check succeeds. Scheduled turns (briefs, heartbeat, auto) never receive external tools; fixer runs never do.

Every call is recorded as an `mcp.called` event with server, tool, byte counts, elapsed time and decision; health changes are `mcp.health` events. `GET /api/mcp` returns servers (env values masked) and health.

## Nibbi as an MCP server

Outside harnesses (Claude Code, Codex, opencode, anything speaking Streamable HTTP) can call Nibbi's governed tools at `POST /mcp` on the local backend (`http://127.0.0.1:4527/mcp` by default). The route is stateless JSON-RPC: every request carries `Authorization: Bearer <token>`, no session cookie, no browser origin. It is served only on the loopback listener unless the backend starts with `NIBBI_MCP_REMOTE=1`, in which case the HTTPS listener serves it too.

### Tokens

Settings → MCP → "Nibbi as a server" creates named tokens (`mcp.tokenCreate`; owner-only, Mac only). A token has a slug name, one or more scopes, a project list (or `*`), and an optional expiry in days. The plaintext (`nib_` + 43 base64url characters) is shown exactly once and never written to disk: the backend stores only its SHA-256 in `mcp-tokens/<hash>` with an 8-character `hashPrefix` for recognition, plus `lastUsedAt` and `useCount`; the command idempotency log keeps the create result with the token replaced by `[shown once]`, and no event carries it. Names are unique among active tokens; a revoked name can be reused.

Revoke (`mcp.tokenRevoke`) is immediate: the record keeps `revokedAt` for the audit trail, the token's lease closes, in-flight calls abort, a request that authenticated before the revoke is refused once its body arrives, and every later request answers 401. An expired token answers 401 the same way. `GET /api/mcp/tokens` returns the owner view (never the hash); `/nibbi/health` reports `mcp: {route, tokens, remote}`.

### Scopes → tools

| scope | tools | notes |
|---|---|---|
| `read` | `read_roadmap`, `read_activity`, `list_fixers`, `read_github_project`, `read_github_build`, `recent_chat`, `search_chat`, `read_file`, `list_files`, `read_progress` | Vault-wide reads. File tools see the vault only, read-only. An explicit `project` argument must still be in the token's project list. |
| `web` | `web_search`, `web_fetch` | Same Serper key and vault-wide allowlist as Nibbi's own turns; registered only when they can work. |
| `dispatch` | `dispatch_fixer` | Queues a Build on an allowed project. Never merges; merging stays with the owner in the app. |
| `steer` | `steer_fixer`, `steer_turn` | Guidance to a live Build or conversation turn on an allowed project; logged as `[STEER]`. |

Every action tool checks `token.projects` before doing anything; a project outside the token fails with `Project <x> is outside the scope of token <name>`. Tokens listing specific projects cannot act on vault-scoped (project-less) turns.

### Limits and refusals

- `POST` only; `GET`/`DELETE` → 405. A request with any `Origin` header → 403 (browsers and phones cannot use `/mcp`).
- Missing, malformed, unknown, revoked or expired token → 401 with an empty body and no event.
- 60 requests per minute per token → 429 with `Retry-After: 60`.
- Bodies over 2 MB → 413.
- One JSON-RPC message per request: a batch array → 400 with JSON-RPC error `-32600`; invalid JSON → 400 with `-32700`. `useCount` counts only requests that reach the tools.

### Audit

Each token's calls run under `runId: mcp-<name>`, so `GET /api/fixer-log?id=mcp-<name>` shows the full trail: `tool.attempted`, `tool.started` (bounded, secret-redacted input) and `tool.finished` (summary, bytes, elapsed) in the same shape as a lead turn, plus `mcp.served {token, tool, argBytes, ok, elapsedMs, userAgent}`. Token lifecycle is recorded as `mcp.token_created` / `mcp.token_revoked`.

### Connecting

Snippets in the MCP tab are rendered with the backend's real port. With the default port:

```sh
# Claude Code
claude mcp add --transport http nibbi http://127.0.0.1:4527/mcp --header "Authorization: Bearer <token>"
```

```toml
# Codex ~/.codex/config.toml (then export NIBBI_MCP_TOKEN=<token> in the shell that starts codex)
[mcp_servers.nibbi]
url = "http://127.0.0.1:4527/mcp"
bearer_token_env_var = "NIBBI_MCP_TOKEN"
```

```json
{"mcp":{"nibbi":{"type":"remote","url":"http://127.0.0.1:4527/mcp","headers":{"Authorization":"Bearer <token>"}}}}
```

Tests: `daemon/test/mcp-server.test.ts` starts the backend in-process and drives `/mcp` with the SDK client.
