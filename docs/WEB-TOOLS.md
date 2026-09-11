# Web access

Nibbi's conversation lead can search the public web and read pages through two governed tools, `web_search` and `web_fetch`. Both are ordinary Nibbi tools: they appear in a turn's capability facts only when they can work, every call is recorded as an event on that turn, and their results are labelled untrusted data.

## What is allowed

- `web_search` uses the Serper API (Google results; 2,500 free queries on signup, no card). It is offered only when a key is stored in your Keychain (`com.nibbi.serper` / `api-key`). Store it from Settings → Providers → Web access → "Store Serper key in Keychain": Terminal opens, you paste the key with hidden input, and `security` writes it. The key never crosses HTTP, the daemon's arguments, or a provider's environment.
- `web_fetch` reads one page with a plain GET. The page's host must be in the allowlist: the vault-wide list in Settings → Providers → Web access, plus the project's own "Web domains" in Project commands. Subdomains of a listed domain are allowed; nothing else is. A denied host is reported to Nibbi as a fact to relay, not an error to work around.
- Search results are not fetchable unless their host is allowlisted.

## What is refused

IP literals, `localhost`, `*.local`, `*.internal`, single-label hosts, private or loopback addresses (checked after DNS resolution, with the connection pinned to the vetted address), redirects that leave the allowlist or downgrade to HTTP, more than three redirects, non-text content, responses beyond the byte cap (truncated with a flag), and anything slower than the timeouts.

## Where it applies

Interactive turns and scheduled turns (morning brief, heartbeat, auto suggest/stage) get the same tools under the same allowlist. Fixer runs, installs, checks and verification never receive web access; their sandbox stays deny-all except declared install domains.

## Evidence

Each call emits `web.searched` or `web.fetched` on the turn's run with the query or URL, host, decision, bytes and elapsed time. They appear in the turn's log. Provider-native web tools (`WebSearch`, `WebFetch`) are denied by policy so the governed path is the only one.
