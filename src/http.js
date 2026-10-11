import pkg from '../package.json' with { type: 'json' };

export const HOST = 'https://www.reddit.com';

// Reddit asks clients to name themselves and a contact, so it can reach the owner instead of blocking blindly.
const USER_AGENT = `reddit-mcp/${pkg.version} (+https://github.com/marco-vrinssen/reddit-mcp)`;

// The anonymous budget is about one feed per 30 to 60 seconds per IP, so a longer wait fails with a retry time instead.
const MAX_WAIT_MS = 60_000;
const MIN_GAP_MS = 1000;
const MAX_REDIRECTS = 3;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_SIZE = 200;

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function failure(url, status) {
  if (status === 404) return new Error(`Reddit found nothing at ${url}. Check the subreddit, user or post ID.`);
  if (status === 403) {
    return new Error(`Reddit refused ${url} (403). The community or user may be private, quarantined, suspended or banned, `
      + 'or Reddit blocked anonymous access from this network.');
  }
  return new Error(`Reddit answered ${status} for ${url}. Try again in a minute.`);
}

// fetch, sleep and now are parameters, so tests can replace the network and the clock.
export function createFeedClient({ fetch = globalThis.fetch, wait = sleep, now = Date.now } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let readyAt = 0;

  // Reddit's headers say what is left of the budget and when it resets, so the next request waits exactly that long.
  function noteBudget(headers) {
    const remaining = Number(headers.get('x-ratelimit-remaining') ?? NaN);
    const reset = Number(headers.get('x-ratelimit-reset') ?? NaN);
    const pause = Number.isFinite(remaining) && remaining < 1 && Number.isFinite(reset) ? (reset + 1) * 1000 : MIN_GAP_MS;
    readyAt = now() + pause;
  }

  async function waitTurn() {
    const delay = readyAt - now();
    if (delay > MAX_WAIT_MS) {
      throw new Error(`Reddit's anonymous rate limit is used up for about ${Math.ceil(delay / 1000)} s. `
        + 'Try again after that; answers from the last 10 minutes come from the cache.');
    }
    if (delay > 0) await wait(delay);
  }

  async function send(url, redirects = 0, retried = false) {
    await waitTurn();
    let response;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/atom+xml' },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      readyAt = now() + MIN_GAP_MS;
      throw new Error(`Reddit did not answer (${error.name === 'TimeoutError' ? 'timeout' : error.message}). Try again.`);
    }
    noteBudget(response.headers);

    if (response.status === 429) {
      await response.body?.cancel();
      if (retried) {
        throw new Error('Reddit is still rate limiting anonymous requests from this IP. Wait a minute, then try again with fewer calls.');
      }
      const reset = Number(response.headers.get('x-ratelimit-reset') ?? response.headers.get('retry-after') ?? NaN);
      readyAt = now() + Math.min(Number.isFinite(reset) ? reset + 1 : 30, MAX_WAIT_MS / 1000) * 1000;
      return send(url, redirects, true);
    }

    // Redirects are followed by hand, so no request ever leaves www.reddit.com.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const target = new URL(response.headers.get('location') ?? '', url);
      if (target.origin !== HOST || redirects >= MAX_REDIRECTS) {
        throw new Error(`Reddit redirected ${url} to ${target}, which this server does not follow.`);
      }
      return send(target, redirects + 1, retried);
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw failure(url, response.status);
    }
    return response.text();
  }

  // One request at a time keeps the client inside Reddit's budget, even when a model calls tools in parallel.
  function enqueue(url) {
    const turn = queue.then(() => send(url));
    queue = turn.catch(() => {});
    return turn;
  }

  // The promise is stored, so parallel identical calls share one request, and a failed one is dropped for a retry.
  return function getFeed(path) {
    const url = new URL(path, HOST);
    if (url.origin !== HOST) throw new Error(`This server only reads ${HOST}, not ${url.origin}.`);
    const key = url.href;
    const hit = cache.get(key);
    if (hit && now() - hit.time < CACHE_MS) return hit.value;
    const value = enqueue(url);
    cache.delete(key);
    cache.set(key, { time: now(), value });
    value.catch(() => cache.get(key)?.value === value && cache.delete(key));
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return value;
  };
}
