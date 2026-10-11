# reddit-mcp

## Rules

- Read-only MCP server over Reddit's public RSS (Atom) feeds on `www.reddit.com`. Never call the JSON API without OAuth (it answers 403 logged out), never fetch HTML pages or old.reddit.com, never fake a browser or use proxies. `src/http.js` refuses every other origin, also behind a redirect.
- Identify with the User-Agent in `src/http.js`, which names this repo.
- The anonymous budget, measured on 2026-10-11, is one request per clock minute per IP. `x-ratelimit-reset` counts down to the next minute, and a second request in the same minute gets a 429 with an empty body. Keep the single queue, the 10-minute cache and the one 429 retry.
- RSS has no scores, comment counts, NSFW flags, member counts, karma, account age or comment nesting. Tool descriptions say so, and the server never invents these values.
- Feeds that work (probed 2026-10-11): community listings with sort, `t`, `limit` up to 100 and `after`; `/search.rss` with `type=link` or `type=sr` and `restrict_sr=1`; `/subreddits/search.rss`; post comments at `/comments/<id>/.rss` with or without `/r/<sub>`, with `sort` and `limit` (`limit=500` returned 309 comments on one post); a comment thread at `/r/<sub>/comments/<id>/_/<commentId>/.rss`; user `/.rss`, `/submitted.rss` and `/comments.rss`.
- Feeds that don't: `type=comment` is ignored and returns mixed results, `type=user` returns nothing, and user feeds with `sort=top&t=all` return nothing.
- No OAuth mode until Reddit approves API access. It closed self-service app creation in November 2025.
- Tool output is plain text, and every result names its source feed URL.
- Probe new feeds one request a minute and wait out `x-ratelimit-reset` between them.

## Checks

- `npm test` after every change to `src/`. It runs offline, with synthetic feeds and a fake clock.
- `REDDIT_LIVE=1 npm test` before a release. It calls Reddit twice and takes about a minute.
- `npx @modelcontextprotocol/inspector node src/index.js` tries the tools by hand.

## Release

1. Bump `version` in `package.json` and `package-lock.json` to the same value.
2. Run both checks.
3. Push to `main`, tag `vX.Y.Z` and create a GitHub release.
4. MCP users run `github:marco-vrinssen/reddit-mcp#semver:^1`, which follows the newest 1.x tag. A breaking tool change needs a major version and the README updated to the new range.
