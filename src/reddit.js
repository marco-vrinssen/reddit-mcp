import { decodeEntities, htmlToText, parseFeed, truncate } from './atom.js';
import { HOST, createFeedClient } from './http.js';
import { POST_ID, parseRedditUrl } from './urls.js';

export const TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'];
export const SEARCH_SORTS = ['relevance', 'hot', 'top', 'new', 'comments'];
export const COMMUNITY_SORTS = ['hot', 'new', 'top', 'rising', 'controversial'];
export const COMMENT_SORTS = ['best', 'top', 'new', 'controversial', 'old', 'qa'];
export const SEARCH_TYPES = ['posts', 'communities'];
export const USER_SHOWS = ['all', 'posts', 'comments'];

export const MAX_LIMIT = 100;
export const MAX_COMMENTS = 500;

const LISTING_BODY = 500;
const POST_BODY = 10_000;
const COMMENT_BODY = 1500;

// Reddit names every thing by a prefixed ID: t1 is a comment, t3 a post, t5 a community.
const KINDS = { t1: 'comment', t3: 'post', t5: 'community' };
const USER_PATHS = { posts: 'submitted', comments: 'comments' };

const defaultFeed = createFeedClient();

function lines(...parts) {
  return parts.filter(Boolean).join('\n');
}

function dateOf(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${date.toISOString().slice(0, 16)}Z`;
}

// Posts and comments keep their own text between Reddit's SC_OFF and SC_ON markers; the rest is the "submitted by" footer.
function bodyOf(html) {
  const match = html.match(/<!-- SC_OFF -->([\s\S]*?)<!-- SC_ON -->/);
  return match ? htmlToText(match[1]) : '';
}

function anchorOf(html, label) {
  const match = html.match(new RegExp(`<a href="([^"]*)">\\[${label}\\]</a>`));
  return match ? decodeEntities(match[1]) : '';
}

function pathOf(link) {
  const match = new URL(link, HOST).pathname.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i);
  return match ? { community: match[1], postId: match[2], commentId: match[3] } : {};
}

export function itemOf(entry) {
  const kind = KINDS[entry.id.slice(0, 2)];
  const created = dateOf(entry.published);
  if (kind === 'community') {
    return {
      kind,
      name: new URL(entry.link, HOST).pathname.split('/')[2],
      title: entry.title,
      url: entry.link,
      created,
      description: htmlToText(entry.html.replace(/<a [^>]*>\[link\]<\/a>/g, '')),
    };
  }

  // Links carry the community and IDs more reliably than the category, which is "u/name" on profile posts.
  const { community = entry.community, postId, commentId } = pathOf(entry.link);
  const base = postId ? `${HOST}/r/${community}/comments/${postId}/` : entry.link;
  const shared = { id: entry.id, author: entry.author, community, created, body: bodyOf(entry.html) };
  if (kind === 'comment') {
    return { kind, ...shared, url: commentId ? `${base}comment/${commentId}/` : entry.link, postTitle: entry.title.replace(/^\/?u\/\S+ on /, '') };
  }
  const link = anchorOf(entry.html, 'link');
  return { kind: 'post', ...shared, title: entry.title, url: base, ...(link && pathOf(link).postId !== postId && { link }) };
}

export function formatItem(item, bodyMax = LISTING_BODY, { inPost = false } = {}) {
  const body = item.body ?? item.description;
  const text = body && truncate(body, bodyMax);
  if (item.kind === 'community') {
    return lines([`community r/${item.name}`, item.title, item.created && `created ${item.created.slice(0, 10)}`].filter(Boolean).join(' | '), item.url, text);
  }
  const header = [
    `${item.kind} ${item.id}`,
    !inPost && item.community && `r/${item.community}`,
    item.author ? `u/${item.author}` : 'deleted author',
    item.created,
  ].filter(Boolean).join(' | ');
  if (item.kind === 'comment') return lines(header, !inPost && item.postTitle && `on: ${item.postTitle}`, item.url, text);
  return lines(header, item.title, item.url, item.link && `link: ${item.link}`, text);
}

// An ISO date keeps only items created on or after it, like the actor's postDateLimit and commentDateLimit.
function sinceFilter(items, since) {
  if (!since) return { kept: items, note: '' };
  const start = new Date(since).getTime();
  const kept = items.filter((item) => !item.created || new Date(item.created).getTime() >= start);
  const left = items.length - kept.length;
  return { kept, note: left ? `Left out ${left} older than ${since}.` : '' };
}

function only(value, allowed, name) {
  if (value === undefined || allowed.includes(value)) return value;
  throw new Error(`Unknown ${name} "${value}". Use one of: ${allowed.join(', ')}.`);
}

// Values the caller passes win over those read from a URL, so a URL can be narrowed further.
function merged(input, kinds) {
  const defined = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && key !== 'url'));
  if (!input.url) return defined;
  const target = parseRedditUrl(input.url);
  if (!kinds.includes(target.kind)) {
    const tool = { post: 'get_post', search: 'search', community: 'browse', user: 'browse' }[target.kind];
    throw new Error(`${input.url} is a ${target.kind} URL. Use the ${tool} tool for it.`);
  }
  const { kind, ...parts } = target;
  return { ...parts, ...defined };
}

// Models often write r/name and u/name, which Reddit's paths spell without the prefix.
function bare(options) {
  const { subreddit, user } = options;
  return {
    ...options,
    ...(subreddit && { subreddit: subreddit.replace(/^\/?r\//i, '') }),
    ...(user && { user: user.replace(/^\/?u\//i, '') }),
  };
}

function feedUrl(path, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')).toString();
  return `${HOST}${path}${query ? `?${query}` : ''}`;
}

function render(url, feed, { limit, since, sort, header = '' }) {
  const { kept, note } = sinceFilter(feed.entries.map(itemOf), since);
  const last = feed.entries.at(-1)?.id;

  // A full page may have more behind it, unless a date cut on a newest-first feed already reached older items.
  const more = feed.entries.length >= limit && last && !(note && sort === 'new');
  return lines(
    `Source: ${url}`,
    header,
    `${kept.length} ${kept.length === 1 ? 'item' : 'items'}.${note ? ` ${note}` : ''}`,
    kept.length ? `\n${kept.map((item) => formatItem(item)).join('\n\n')}` : 'Nothing found.',
    more && `\nMore: call again with after="${last}".`,
  );
}

export async function search(input, getFeed = defaultFeed) {
  const { query, subreddit, type = 'posts', sort, time, since, limit = 25, after } = bare(merged(input, ['search']));
  if (!query) throw new Error('Pass a query or a Reddit search URL.');
  only(type, SEARCH_TYPES, 'type');
  if (type === 'communities' && subreddit) throw new Error('Communities are searched across Reddit, so leave out subreddit.');
  const url = feedUrl(subreddit ? `/r/${subreddit}/search.rss` : '/search.rss', {
    q: query,
    type: type === 'communities' ? 'sr' : 'link',
    restrict_sr: subreddit ? '1' : undefined,
    sort: only(sort, SEARCH_SORTS, 'sort'),
    t: only(time, TIMES, 'time'),
    limit,
    after,
  });
  return render(url, parseFeed(await getFeed(url)), { limit, since, sort });
}

export async function browse(input, getFeed = defaultFeed) {
  const { subreddit, user, show = 'all', sort, time, since, limit = 25, after } = bare(merged(input, ['community', 'user']));
  if (Boolean(subreddit) === Boolean(user)) throw new Error('Pass one of url, subreddit or user.');
  if (subreddit) {
    const order = only(sort, COMMUNITY_SORTS, 'sort') ?? 'hot';
    const url = feedUrl(`/r/${subreddit}/${order}.rss`, { t: ['top', 'controversial'].includes(order) ? only(time, TIMES, 'time') : undefined, limit, after });
    return render(url, parseFeed(await getFeed(url)), { limit, since, sort: order });
  }
  only(show, USER_SHOWS, 'show');

  // Probed on 2026-10-11: sort=top&t=all made a user feed come back empty, while the plain feed had entries.
  if (sort || time) throw new Error('User feeds over RSS are newest first only, so leave out sort and time.');
  const url = feedUrl(show === 'all' ? `/user/${user}/.rss` : `/user/${user}/${USER_PATHS[show]}.rss`, { limit, after });
  const feed = parseFeed(await getFeed(url));
  const header = lines(`user u/${user} | ${HOST}/user/${user}/`, feed.subtitle && `profile: ${feed.subtitle}`);
  return render(url, feed, { limit, since, sort: 'new', header });
}

// Reddit calls the "best" comment order "confidence".
const COMMENT_SORT_PARAMS = { best: 'confidence', top: 'top', new: 'new', controversial: 'controversial', old: 'old', qa: 'qa' };

export async function getPost({ id, ...input }, getFeed = defaultFeed) {
  const { postId = id, subreddit, commentId, sort, comments = 100, since } = merged(input, ['post']);
  if (!postId || !POST_ID.test(postId)) throw new Error('Pass a Reddit post URL or a post ID like 1x1eu2f.');
  const bareId = postId.replace(/^t3_/i, '').toLowerCase();

  // A comment link narrows the thread to that comment and its replies.
  const path = commentId && subreddit ? `/r/${subreddit}/comments/${bareId}/_/${commentId}/.rss`
    : subreddit ? `/r/${subreddit}/comments/${bareId}/.rss` : `/comments/${bareId}/.rss`;

  // The feed always starts with the post, so asking for one comment is the smallest request that still returns it.
  const url = feedUrl(path, { sort: COMMENT_SORT_PARAMS[only(sort, COMMENT_SORTS, 'sort')], limit: Math.max(comments, 1) });
  const [post, ...replies] = parseFeed(await getFeed(url)).entries.map(itemOf);
  if (post?.kind !== 'post') throw new Error(`Reddit sent no post at ${url}. Check the post URL or ID.`);
  if (!comments) return lines(`Source: ${url}`, `\n${formatItem(post, POST_BODY)}`);

  const { kept, note } = sinceFilter(replies, since);
  return lines(
    `Source: ${url}`,
    `\n${formatItem(post, POST_BODY)}`,
    `\n${kept.length} ${kept.length === 1 ? 'comment' : 'comments'}${commentId ? ` in the thread of comment ${commentId}` : ''}, `
      + `flat in thread order.${note ? ` ${note}` : ''}`,
    ...kept.map((reply) => `\n${formatItem(reply, COMMENT_BODY, { inPost: true })}`),
  );
}
