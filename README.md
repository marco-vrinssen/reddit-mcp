# Reddit MCP

Lets Claude search Reddit, read community and user feeds, and read posts with their comments. It is a local, read-only MCP server that reads Reddit's public RSS feeds, so it needs no account, API key or browser.

Unofficial and not affiliated with Reddit.

## Tools

| Tool | What it does |
|---|---|
| `search` | Searches posts across Reddit or in one community, or finds communities by topic. Takes a query or a Reddit search URL |
| `browse` | Reads a community feed, sorted hot, new, top, rising or controversial, or a user's newest posts and comments. Takes a URL, a subreddit or a user |
| `get_post` | Reads one post with its full text and up to 500 comments. Takes a post or comment URL, a redd.it link or a post ID |

Every result starts with the feed URL it came from and lists each item with its type, ID, community, author, date, URL and a trimmed body. All tools take `since` to keep only items from a date on. `search` and `browse` return up to 100 items per call and an `after` cursor for the next page.

## Install

Requires Node 22 or later and git.

### Claude Code

```sh
claude mcp add --scope user reddit -- npx -y github:marco-vrinssen/reddit-mcp#semver:^1
```

### Claude desktop app

In Settings, Developer, Edit Config, add the server and restart the app:

```json
{
  "mcpServers": {
    "reddit": { "command": "npx", "args": ["-y", "github:marco-vrinssen/reddit-mcp#semver:^1"] }
  }
}
```

`#semver:^1` always runs the newest 1.x release. Then ask something like "what did r/classicwow talk about this week".

## Rate limits

Reddit allows about one anonymous request per minute per IP address. Measured on 2026-10-11, every feed answered with `x-ratelimit-remaining: 0` and a reset at the next full minute, and a second request in the same minute got a 429.

So the server:

- Sends one request at a time and waits out the reset Reddit announces before the next one.
- Fails at once with the time to retry when a wait would be longer than a minute.
- Waits out a 429 once, for at most a minute, then fails with a plain message.
- Caches every answer for 10 minutes, and parallel identical calls share one request.

Each tool call is one request, so a series of calls takes about a minute each. One call with a larger `limit` is faster than several pages.

## Limits of RSS

The feeds carry titles, bodies, authors, communities, dates, links and IDs. They do not carry:

- Scores, upvotes, comment counts or NSFW flags.
- Community member counts, or user karma and account age.
- Comment nesting or parent IDs. Comments come as a flat list in thread order, and a comment URL returns that comment with its replies.

Searching comments or users is not possible: Reddit ignores `type=comment` and returns nothing for `type=user`. User feeds come newest first only, because a sort made them return nothing. There is no NSFW switch, the feeds return what Reddit shows logged-out visitors.

An OAuth mode with Reddit's Data API would add scores, comment counts, nesting and a higher rate limit. Reddit closed self-service API keys in November 2025 and approves access case by case, so it is left out until it can be tested.

## Terms

- Reddit's robots.txt disallows all crawlers and points to its Public Content Policy. This server does not crawl. It fetches one feed per tool call, only when a user asks, and names itself with the User-Agent `reddit-mcp/<version> (+https://github.com/marco-vrinssen/reddit-mcp)`.
- It reads only the RSS feeds on www.reddit.com: no JSON API without OAuth, no HTML pages, no proxies and no browser disguise.
- Use it on demand and non-commercially. Don't use it to collect Reddit content in bulk, train models or resell data. Reddit's User Agreement and Public Content Policy apply, and the content belongs to its authors.

Reddit is a trademark of Reddit, Inc. This project is not affiliated with Reddit.

## Develop

```sh
npm install
npm test
REDDIT_LIVE=1 npm test
```

The offline tests use synthetic feeds and a fake network and clock. The two live tests call Reddit once each and take about a minute because of the rate limit. Try the server in the MCP Inspector with `npx @modelcontextprotocol/inspector node src/index.js`.
