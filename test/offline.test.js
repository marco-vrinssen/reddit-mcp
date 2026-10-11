import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { htmlToText, parseFeed } from '../src/atom.js';
import { createFeedClient } from '../src/http.js';
import { browse, formatItem, getPost, itemOf, search } from '../src/reddit.js';
import { parseRedditUrl } from '../src/urls.js';

// Synthetic Atom feeds shaped like Reddit's, with made-up names, so the offline tests carry no real user content.

function escape(html) {
  return html.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function feed(head, entries) {
  return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">'
    + `${head}${entries.join('')}</feed>`;
}

const selfPost = `<entry><author><name>/u/test_author</name><uri>https://www.reddit.com/user/test_author</uri></author>
<category term="testsub" label="r/testsub"/><content type="html">${escape(
  '<!-- SC_OFF --><div class="md"><p>First line &amp; more, it&#39;s <b>fine</b>.</p> <blockquote><p>quoted</p></blockquote>'
  + '<ul><li>one</li><li>two</li></ul><p>See <a href="https://example.com/page">the page</a> and &lt;tag&gt;.</p></div><!-- SC_ON -->'
  + ' &#32; submitted by &#32; <a href="https://www.reddit.com/user/test_author"> /u/test_author </a> <br/>'
  + ' <span><a href="https://www.reddit.com/r/testsub/comments/abc123/a_test_post/">[link]</a></span> &#32;'
  + ' <span><a href="https://www.reddit.com/r/testsub/comments/abc123/a_test_post/">[comments]</a></span>',
)}</content><id>t3_abc123</id><link href="https://www.reddit.com/r/testsub/comments/abc123/a_test_post/" />
<updated>2026-10-09T07:18:28+00:00</updated><published>2026-10-09T07:18:28+00:00</published><title>A test post &amp; title</title></entry>`;

const imagePost = `<entry><author><name>/u/other_user</name></author><category term="testsub" label="r/testsub"/>
<content type="html">${escape(
  '<table> <tr><td> <a href="https://www.reddit.com/r/testsub/comments/def456/image_post/"> <img src="https://preview.redd.it/x.png" /> </a> </td><td>'
  + ' &#32; submitted by &#32; <a href="https://www.reddit.com/user/other_user"> /u/other_user </a> <br/>'
  + ' <span><a href="https://i.redd.it/x.png">[link]</a></span> &#32;'
  + ' <span><a href="https://www.reddit.com/r/testsub/comments/def456/image_post/">[comments]</a></span> </td></tr></table>',
)}</content><id>t3_def456</id><media:thumbnail url="https://preview.redd.it/x.png?width=640&amp;crop=smart" />
<link href="https://www.reddit.com/r/testsub/comments/def456/image_post/" /><updated>2026-10-01T10:00:00+00:00</updated>
<published>2026-10-01T10:00:00+00:00</published><title>An image post</title></entry>`;

const comment = `<entry><author><name>/u/test_author</name></author><category term="othersub" label="r/othersub" />
<content type="html">${escape('<!-- SC_OFF --><div class="md"><p>A reply.</p></div><!-- SC_ON -->')}</content><id>t1_xyz789</id>
<link href="https://www.reddit.com/r/othersub/comments/ghi012/some_post/xyz789/"/><updated>2026-10-05T12:00:00+00:00</updated>
<title>/u/test_author on Some post</title></entry>`;

const community = `<entry><author><name>/u/founder</name></author><content type="html">${escape(
  '<div> A community for tests. </div> <div> <a href="https://www.reddit.com/r/TestSub/">[link]</a> </div>',
)}</content><id>t5_aa11</id><link href="https://www.reddit.com/r/TestSub/" /><updated>2016-04-23T01:15:34+00:00</updated><title>Test Sub</title></entry>`;

const listingFeed = feed('<category term="testsub" label="r/testsub"/><title>top scoring links : testsub</title>', [selfPost, imagePost]);
const userFeed = feed('<subtitle>Test account bio</subtitle><title>overview for test_author</title>', [comment, selfPost]);
const searchFeed = feed('<title>reddit.com: search results - test</title>', [community, selfPost]);
const emptyFeed = feed('<title>reddit.com: search results - nothing</title>', []);

// The offline checks use synthetic feeds and a fake network and clock, so they run anywhere and never touch Reddit.

test('the Atom parser reads every entry field and decodes XML once', () => {
  const { entries } = parseFeed(listingFeed);
  assert.equal(entries.length, 2);
  const [post] = entries;
  assert.equal(post.id, 't3_abc123');
  assert.equal(post.title, 'A test post & title');
  assert.equal(post.author, 'test_author');
  assert.equal(post.community, 'testsub');
  assert.equal(post.published, '2026-10-09T07:18:28+00:00');
  assert.match(post.html, /^<!-- SC_OFF --><div class="md">/);
  assert.throws(() => parseFeed('<html>blocked</html>'), /sent no Atom feed/);
});

test('HTML becomes plain text with quotes, lists and links, and literal tags survive', () => {
  const text = htmlToText('<p>A &amp; B, it&#39;s</p><blockquote><p>quoted</p></blockquote><ul><li>one</li></ul>'
    + '<p><a href="https://example.com/x">site</a> <a href="/r/test">r/test</a> &lt;b&gt;</p>');
  assert.equal(text, "A & B, it's\n\n> quoted\n\n- one\n\nsite (https://example.com/x) r/test <b>");
});

test('entries become posts, comments and communities with clean URLs', () => {
  const [selfPost, imagePost] = parseFeed(listingFeed).entries.map(itemOf);
  assert.equal(selfPost.url, 'https://www.reddit.com/r/testsub/comments/abc123/');
  assert.equal(selfPost.link, undefined);
  assert.match(selfPost.body, /^First line & more, it's fine\.\n\n> quoted\n\n- one\n- two\n\nSee the page \(https:\/\/example\.com\/page\) and <tag>\.$/);
  assert.equal(imagePost.link, 'https://i.redd.it/x.png');
  assert.equal(imagePost.body, '');

  const [comment] = parseFeed(userFeed).entries.map(itemOf);
  assert.equal(comment.url, 'https://www.reddit.com/r/othersub/comments/ghi012/comment/xyz789/');
  assert.equal(comment.postTitle, 'Some post');
  assert.equal(comment.created, '2026-10-05T12:00Z');

  const [community] = parseFeed(searchFeed).entries.map(itemOf);
  assert.equal(formatItem(community), 'community r/TestSub | Test Sub | created 2016-04-23\nhttps://www.reddit.com/r/TestSub/\nA community for tests.');
});

test('Reddit URLs of every kind parse, and other hosts and media links are refused', () => {
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/r/testsub/top/?t=week'), { kind: 'community', subreddit: 'testsub', sort: 'top', time: 'week' });
  assert.deepEqual(parseRedditUrl('r/testsub'), { kind: 'community', subreddit: 'testsub' });
  assert.deepEqual(parseRedditUrl('https://old.reddit.com/r/testsub/comments/abc123/a_slug/def456/'),
    { kind: 'post', subreddit: 'testsub', postId: 'abc123', commentId: 'def456' });
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/r/testsub/comments/abc123/comment/def456/'),
    { kind: 'post', subreddit: 'testsub', postId: 'abc123', commentId: 'def456' });
  assert.deepEqual(parseRedditUrl('https://redd.it/abc123'), { kind: 'post', postId: 'abc123' });
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/user/test_author/submitted/'), { kind: 'user', user: 'test_author', show: 'posts' });
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/u/test_author'), { kind: 'user', user: 'test_author', show: 'all' });
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/r/testsub/search/?q=two+words&restrict_sr=1&sort=new'),
    { kind: 'search', query: 'two words', subreddit: 'testsub', sort: 'new' });
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/search/?q=test&type=sr'), { kind: 'search', query: 'test', type: 'communities' });

  assert.throws(() => parseRedditUrl('https://example.com/r/testsub'), /Not a Reddit URL/);
  assert.throws(() => parseRedditUrl('https://reddit.com.example.com/r/testsub'), /Not a Reddit URL/);
  assert.throws(() => parseRedditUrl('https://i.redd.it/x.png'), /Not a Reddit URL/);
  assert.throws(() => parseRedditUrl('https://www.reddit.com/r/testsub/s/AbCdEf'), /Share links/);
  assert.throws(() => parseRedditUrl('https://www.reddit.com/search/?q=test&type=user'), /cannot list "user" results/);
  assert.throws(() => parseRedditUrl('https://www.reddit.com/r/no spaces/'), /not a valid Reddit community name/);
});

// A fake network and clock: every wait moves the clock forward instead of sleeping.
function fakeReddit(answer) {
  const state = { clock: 0, waits: [], calls: [], open: 0, maxOpen: 0 };
  const client = createFeedClient({
    now: () => state.clock,
    wait: async (ms) => {
      state.waits.push(ms);
      state.clock += ms;
    },
    fetch: async (url, init) => {
      state.open += 1;
      state.maxOpen = Math.max(state.maxOpen, state.open);
      state.calls.push({ url: String(url), at: state.clock, agent: init.headers['user-agent'], redirect: init.redirect });
      await new Promise((done) => setImmediate(done));
      state.open -= 1;
      const [status, headers = {}, body = listingFeed] = answer(String(url), state.calls.length);
      return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
    },
  });
  return { client, state };
}

const spent = { 'x-ratelimit-remaining': '0.0', 'x-ratelimit-used': '1', 'x-ratelimit-reset': '30' };

test('the queue sends one request at a time and waits out the reset Reddit announces', async () => {
  const { client, state } = fakeReddit(() => [200, spent]);
  const pages = await Promise.all([client('/r/testsub/new.rss'), client('/r/testsub/hot.rss'), client('/r/testsub/top.rss')]);
  assert.equal(pages.length, 3);
  assert.equal(state.maxOpen, 1);
  assert.deepEqual(state.calls.map((call) => call.at), [0, 31_000, 62_000]);
  assert.match(state.calls[0].agent, /^reddit-mcp\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/marco-vrinssen\/reddit-mcp\)$/);
  assert.equal(state.calls[0].redirect, 'manual');
});

test('identical calls share one request and the cache lasts 10 minutes', async () => {
  const { client, state } = fakeReddit(() => [200, { 'x-ratelimit-remaining': '5' }]);
  await Promise.all([client('/r/testsub/new.rss'), client('/r/testsub/new.rss')]);
  await client('https://www.reddit.com/r/testsub/new.rss');
  assert.equal(state.calls.length, 1);
  state.clock += 10 * 60 * 1000 + 1;
  await client('/r/testsub/new.rss');
  assert.equal(state.calls.length, 2);
});

test('a 429 is waited out once, a second one fails with cause and fix, and the failure is not cached', async () => {
  const once = fakeReddit((url, call) => (call === 1 ? [429, { ...spent, 'x-ratelimit-reset': '25' }, ''] : [200, spent]));
  assert.match(await once.client('/r/testsub/new.rss'), /<feed/);
  assert.deepEqual(once.state.waits, [26_000]);

  const twice = fakeReddit((url, call) => (call <= 2 ? [429, { ...spent, 'x-ratelimit-reset': '500' }, ''] : [200, spent]));
  await assert.rejects(twice.client('/r/testsub/new.rss'), /still rate limiting anonymous requests.*Wait a minute/);
  assert.deepEqual(twice.state.waits, [60_000]);

  // The failed call is not cached, so once Reddit's announced reset has passed the next call fetches again.
  twice.state.clock += 501_000;
  assert.match(await twice.client('/r/testsub/new.rss'), /<feed/);
});

test('a wait longer than a minute fails fast with the time to retry', async () => {
  const { client, state } = fakeReddit(() => [200, { ...spent, 'x-ratelimit-reset': '120' }]);
  await client('/r/testsub/new.rss');
  await assert.rejects(client('/r/testsub/hot.rss'), /used up for about 121 s/);
  assert.equal(state.calls.length, 1);
});

test('requests never leave www.reddit.com, not even through a redirect', async () => {
  const { client, state } = fakeReddit((url) => (url.includes('/old/') ? [301, { location: '/r/testsub/new.rss' }]
    : url.includes('/away/') ? [302, { location: 'https://example.com/feed' }] : [200, spent]));
  assert.match(await client('/r/old/new.rss'), /<feed/);
  assert.deepEqual(state.calls.map((call) => new URL(call.url).pathname), ['/r/old/new.rss', '/r/testsub/new.rss']);
  await assert.rejects(client('/r/away/new.rss'), /redirected .* to https:\/\/example\.com\/feed/);
  assert.throws(() => client('https://example.com/r/testsub/new.rss'), /only reads https:\/\/www\.reddit\.com/);
  assert.equal(state.calls.length, 3);
});

test('a 404 and a 403 name the likely cause', async () => {
  const { client } = fakeReddit((url) => [url.includes('gone') ? 404 : 403, {}, '']);
  await assert.rejects(client('/r/gone/new.rss'), /found nothing at .*Check the subreddit/);
  await assert.rejects(client('/r/closed/new.rss'), /refused .*private, quarantined/);
});

// The tools take the feed loader as a parameter, so their URLs and text can be checked without a network.
function feedOf(xml, urls = []) {
  return async (url) => {
    urls.push(url);
    return xml;
  };
}

test('search builds the RSS URL, filters by date and offers the next page', async () => {
  const urls = [];
  const text = await search({ query: 'two words', subreddit: 'r/testsub', sort: 'new', time: 'week', limit: 2, since: '2026-10-05' }, feedOf(listingFeed, urls));
  assert.equal(urls[0], 'https://www.reddit.com/r/testsub/search.rss?q=two+words&type=link&restrict_sr=1&sort=new&t=week&limit=2');
  assert.match(text, /^Source: https:\/\/www\.reddit\.com\/r\/testsub\/search\.rss/);
  assert.match(text, /1 item\. Left out 1 older than 2026-10-05\./);
  assert.match(text, /post t3_abc123 \| r\/testsub \| u\/test_author \| 2026-10-09T07:18Z\nA test post & title\n/);
  assert.doesNotMatch(text, /More:/);

  const full = await search({ query: 'test', limit: 2 }, feedOf(listingFeed));
  assert.match(full, /More: call again with after="t3_def456"\./);
  assert.match(await search({ query: 'nothing' }, feedOf(emptyFeed)), /0 items\.\nNothing found\./);
  await assert.rejects(search({ query: 'test', type: 'communities', subreddit: 'testsub' }, feedOf(emptyFeed)), /leave out subreddit/);
});

test('browse reads community and user feeds and points other URLs to the right tool', async () => {
  const urls = [];
  await browse({ url: 'https://www.reddit.com/r/testsub/top/?t=week', limit: 5 }, feedOf(listingFeed, urls));
  const text = await browse({ user: 'u/test_author', show: 'comments', limit: 5 }, feedOf(userFeed, urls));
  assert.deepEqual(urls, ['https://www.reddit.com/r/testsub/top.rss?t=week&limit=5', 'https://www.reddit.com/user/test_author/comments.rss?limit=5']);
  assert.match(text, /user u\/test_author \| https:\/\/www\.reddit\.com\/user\/test_author\/\nprofile: Test account bio/);
  assert.match(text, /comment t1_xyz789 \| r\/othersub \| u\/test_author \| 2026-10-05T12:00Z\non: Some post\n/);
  await assert.rejects(browse({ user: 'test_author', sort: 'top' }, feedOf(userFeed)), /newest first only/);
  await assert.rejects(browse({ url: 'https://redd.it/abc123' }, feedOf(userFeed)), /is a post URL\. Use the get_post tool/);
});

test('get_post reads the post, its comments and a comment thread', async () => {
  const thread = listingFeed.replace('</feed>', `${userFeed.match(/<entry>[\s\S]*?<\/entry>/)[0]}</feed>`);
  const urls = [];
  const text = await getPost({ url: 'https://www.reddit.com/r/testsub/comments/abc123/a_slug/xyz789/', sort: 'best', comments: 50 }, feedOf(thread, urls));
  assert.equal(urls[0], 'https://www.reddit.com/r/testsub/comments/abc123/_/xyz789/.rss?sort=confidence&limit=50');
  assert.match(text, /post t3_abc123 \| r\/testsub[\s\S]*2 comments in the thread of comment xyz789, flat in thread order\./);
  assert.match(text, /\ncomment t1_xyz789 \| u\/test_author \| 2026-10-05T12:00Z\nhttps:/);

  await getPost({ id: 't3_ABC123', comments: 0 }, feedOf(thread, urls));
  assert.equal(urls[1], 'https://www.reddit.com/comments/abc123/.rss?limit=1');
  await assert.rejects(getPost({ id: 'abc123' }, feedOf(userFeed)), /sent no post/);
});

test('the stdio server lists the three tools', async () => {
  const child = spawn(process.execPath, ['src/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      replies.get(message.id)?.(message);
    }
  });
  const call = (id, method, params) => new Promise((done) => {
    replies.set(id, done);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  try {
    const { result: init } = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.serverInfo.name, 'reddit-mcp');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const { result } = await call(2, 'tools/list', {});
    assert.deepEqual(result.tools.map((tool) => tool.name).sort(), ['browse', 'get_post', 'search']);
    for (const tool of result.tools) assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: true });
  } finally {
    child.kill();
  }
});
