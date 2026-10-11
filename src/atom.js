// Reddit's RSS feeds are Atom XML whose entry content is escaped HTML, so text is decoded twice: once as XML, once as HTML.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

function tagText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!match) return '';
  return decodeEntities(match[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')).trim();
}

function attrOf(xml, tag, name) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*?\\s${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : '';
}

// Every Reddit feed is one page of entries with the same fields, whatever kind of thing they describe.
export function parseFeed(xml) {
  if (!/<feed\b/.test(xml)) throw new Error('Reddit sent no Atom feed. Its RSS format may have changed, so this server needs an update.');
  const head = xml.split(/<entry>/)[0];
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => ({
    id: tagText(entry, 'id'),
    title: tagText(entry, 'title'),
    author: tagText(entry, 'name').replace(/^\/?u\//, ''),
    community: attrOf(entry, 'category', 'term'),
    link: attrOf(entry, 'link', 'href'),
    published: tagText(entry, 'published') || tagText(entry, 'updated'),
    html: tagText(entry, 'content'),
  }));
  return { title: tagText(head, 'title'), subtitle: tagText(head, 'subtitle'), entries };
}

function tidy(text) {
  return text.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Tags are removed before entities are decoded, so a literal "<b>" written in a post survives as text.
function stripTags(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, inner) => `\n${tidy(stripTags(inner)).replace(/^/gm, '> ')}\n`)
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, inner) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      return /^https?:/.test(href) && !label.includes(href) ? `${label} (${href})` : label;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(p|div|tr|table|ul|ol|pre|h\d)\b[^>]*>/gi, '\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
}

export function htmlToText(html) {
  return tidy(decodeEntities(stripTags(html)));
}

export function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()} [truncated]`;
}
