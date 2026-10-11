// Turns any Reddit link a user pastes into the parts the tools need, so only www.reddit.com feeds are ever built from it.

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}(\+[A-Za-z0-9_]{2,21}){0,9}$/;
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
export const POST_ID = /^(t3_)?[a-z0-9]{1,12}$/i;

const LISTING_SORTS = new Set(['hot', 'new', 'top', 'rising', 'controversial']);
const USER_SECTIONS = { overview: 'all', submitted: 'posts', posts: 'posts', comments: 'comments' };
const SEARCH_TYPES = { link: 'posts', posts: 'posts', sr: 'communities', communities: 'communities' };

function checked(name, pattern, kind) {
  if (!pattern.test(name)) throw new Error(`"${name}" is not a valid Reddit ${kind} name.`);
  return name;
}

function hostOf(url) {
  const host = url.hostname.toLowerCase();
  if (host === 'redd.it') return 'short';
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'reddit';
  throw new Error(`Not a Reddit URL: ${url.href}. Pass a link on reddit.com or redd.it.`);
}

function searchOf(params, subreddit) {
  const query = params.get('q')?.trim();
  if (!query) throw new Error('This Reddit search URL has no q= query.');
  const type = params.get('type');
  if (type && !SEARCH_TYPES[type]) throw new Error(`Reddit's RSS search cannot list "${type}" results. Use posts or communities.`);
  return {
    kind: 'search',
    query,
    ...(subreddit && params.get('restrict_sr') !== '0' && { subreddit }),
    ...(type && { type: SEARCH_TYPES[type] }),
    ...(params.get('sort') && { sort: params.get('sort') }),
    ...(params.get('t') && { time: params.get('t') }),
  };
}

// Paths like /r/x/comments/id/slug/commentId, /comments/id, /gallery/id and redd.it/id all name one post.
export function parseRedditUrl(input) {
  const text = input.trim();
  const url = new URL(/^[a-z]+:\/\//i.test(text) || text.startsWith('//') ? text : `https://www.reddit.com/${text.replace(/^\/+/, '')}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (hostOf(url) === 'short') {
    if (parts.length === 1 && POST_ID.test(parts[0])) return { kind: 'post', postId: parts[0].toLowerCase() };
    throw new Error(`Not a redd.it post link: ${url.href}.`);
  }

  const [first, name, section, ...rest] = parts;
  const lower = first?.toLowerCase();

  if ((lower === 'comments' || lower === 'gallery') && name) return { kind: 'post', postId: checked(name.toLowerCase(), POST_ID, 'post ID') };
  if (lower === 'search') return searchOf(url.searchParams);
  if (lower === 'subreddits' && name === 'search') return { ...searchOf(url.searchParams), type: 'communities' };

  if (lower === 'r' && name) {
    const subreddit = checked(name, SUBREDDIT, 'community');
    const area = section?.toLowerCase();
    if (area === 'comments' && rest[0]) {
      const postId = checked(rest[0].toLowerCase(), POST_ID, 'post ID');

      // Old links put the comment ID after the slug, new ones after "comment", so it sits in the same place.
      const commentId = rest[2];
      return { kind: 'post', subreddit, postId, ...(commentId && POST_ID.test(commentId) && { commentId: commentId.toLowerCase() }) };
    }
    if (area === 's') throw new Error('Share links (/s/...) only resolve in a browser. Open it there and pass the full post URL.');
    if (area === 'search') return searchOf(url.searchParams, subreddit);
    if (!area || LISTING_SORTS.has(area)) {
      return {
        kind: 'community',
        subreddit,
        ...(area && { sort: area }),
        ...(url.searchParams.get('t') && { time: url.searchParams.get('t') }),
      };
    }
    throw new Error(`Reddit has no RSS feed for ${url.pathname}. Pass a community, post, user or search URL.`);
  }

  if ((lower === 'user' || lower === 'u') && name) {
    const user = checked(name, USERNAME, 'user');
    const show = section ? USER_SECTIONS[section.toLowerCase()] : 'all';
    if (!show) throw new Error(`Reddit has no RSS feed for ${url.pathname}. Pass a user URL, or its /submitted or /comments page.`);
    return { kind: 'user', user, show };
  }

  throw new Error(`Not a community, post, user or search URL: ${url.href}.`);
}
