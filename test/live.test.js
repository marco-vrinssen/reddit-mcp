import assert from 'node:assert/strict';
import { test } from 'node:test';

import { browse, getPost } from '../src/reddit.js';

// The live checks call Reddit once each, so they catch feed changes; anonymous access allows one request a minute.
const skip = process.env.REDDIT_LIVE ? false : 'set REDDIT_LIVE=1 to call Reddit';
let postUrl;

test('a community feed lists posts with author, date and URL', { skip }, async () => {
  const text = await browse({ subreddit: 'AskReddit', sort: 'new', limit: 3 });
  assert.match(text, /^Source: https:\/\/www\.reddit\.com\/r\/AskReddit\/new\.rss\?limit=3\n3 items\./);
  assert.match(text, /\npost t3_[a-z0-9]+ \| r\/AskReddit \| (u\/\S+|deleted author) \| \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z\n/);
  postUrl = text.match(/https:\/\/www\.reddit\.com\/r\/AskReddit\/comments\/[a-z0-9]+\//)[0];
});

test('a post reads with its comments', { skip }, async (t) => {
  if (!postUrl) return t.skip('the community feed test found no post');
  const text = await getPost({ url: postUrl, comments: 5 });
  assert.match(text, /\npost t3_[a-z0-9]+ \| r\/AskReddit \|/);
  assert.match(text, /\n\d+ comments?, flat in thread order\./);
});
