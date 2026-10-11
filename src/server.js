import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import pkg from '../package.json' with { type: 'json' };
import {
  COMMENT_SORTS, COMMUNITY_SORTS, MAX_COMMENTS, MAX_LIMIT, SEARCH_SORTS, SEARCH_TYPES, TIMES, USER_SHOWS, browse, getPost, search,
} from './reddit.js';

const hints = { readOnlyHint: true, openWorldHint: true };

// Every tool says what RSS lacks, so the model never fills the gaps with invented numbers.
const limits = 'Reddit\'s RSS feeds carry no scores, vote or comment counts and no NSFW flags. '
  + 'Anonymous access allows about one request per minute, so a call can wait up to a minute; identical calls within 10 minutes come from a cache.';

const shared = {
  since: z.iso.date().optional().describe('Keep only items created on or after this date, like 2026-10-01'),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(25).describe('Items per page'),
  after: z.string().regex(/^t[1-6]_[a-z0-9]{1,13}$/i).optional().describe('Cursor from "More: call again with after=..." to read the next page'),
  time: z.enum(TIMES).optional().describe('Time window: for search with any sort, for a community with top or controversial'),
};

const url = z.string().min(3).max(2000);
const subreddit = z.string().regex(/^(\/?r\/)?[A-Za-z0-9_]{2,21}(\+[A-Za-z0-9_]{2,21}){0,9}$/);

function text(value) {
  return { content: [{ type: 'text', text: value }] };
}

export function createServer() {
  const server = new McpServer({ name: 'reddit-mcp', version: pkg.version });

  server.registerTool('search', {
    title: 'Search Reddit',
    description: 'Search Reddit posts across Reddit or in one community, or find communities by topic. '
      + 'Pass a query, or a Reddit search URL. Each result has its type, ID, community, author, ISO date, URL, external link and a trimmed body. '
      + `Comments and users cannot be searched over RSS. ${limits}`,
    inputSchema: z.object({
      query: z.string().min(1).max(512).optional().describe('Search words'),
      url: url.optional().describe('A Reddit search URL instead of query, like https://www.reddit.com/r/classicwow/search/?q=paladin'),
      subreddit: subreddit.optional().describe('Search only this community, like classicwow'),
      type: z.enum(SEARCH_TYPES).optional().describe('posts (default) or communities'),
      sort: z.enum(SEARCH_SORTS).optional().describe('Default relevance'),
      ...shared,
    }),
    annotations: hints,
  }, async (input) => text(await search(input)));

  server.registerTool('browse', {
    title: 'Browse a Reddit feed',
    description: 'Read the posts of a community, hot, new, top, rising or controversial, or the newest posts and comments of a user. '
      + 'Pass a community or user URL, a subreddit (also all, popular or names joined with +) or a user. '
      + `A user feed starts with the profile description; karma and account age are not in RSS. ${limits}`,
    inputSchema: z.object({
      url: url.optional().describe('Community or user URL, like https://www.reddit.com/r/classicwow/top/?t=week or https://www.reddit.com/user/name'),
      subreddit: subreddit.optional().describe('Community name, like classicwow'),
      user: z.string().regex(/^(\/?u\/)?[A-Za-z0-9_-]{3,20}$/).optional().describe('Username, like spez'),
      show: z.enum(USER_SHOWS).optional().describe('For a user: all (default), posts or comments'),
      sort: z.enum(COMMUNITY_SORTS).optional().describe('Community order, default hot. User feeds are newest first only'),
      ...shared,
    }),
    annotations: hints,
  }, async (input) => text(await browse(input)));

  server.registerTool('get_post', {
    title: 'Read a Reddit post',
    description: 'Read one Reddit post with its full text and its comments. Pass a post or comment URL, a redd.it link or a post ID. '
      + 'Comments come as a flat list in thread order: RSS gives no nesting, parent IDs or total count. '
      + `A comment URL returns that comment and its replies. ${limits}`,
    inputSchema: z.object({
      url: url.optional().describe('Post or comment URL, like https://www.reddit.com/r/classicwow/comments/1x1eu2f/'),
      id: z.string().regex(/^(t3_)?[a-z0-9]{1,12}$/i).optional().describe('Post ID, like 1x1eu2f'),
      sort: z.enum(COMMENT_SORTS).optional().describe('Comment order, default best'),
      comments: z.number().int().min(0).max(MAX_COMMENTS).default(100).describe('Most comments to return, 0 for the post only'),
      since: shared.since.describe('Keep only comments created on or after this date, like 2026-10-01'),
    }),
    annotations: hints,
  }, async (input) => text(await getPost(input)));

  return server;
}
