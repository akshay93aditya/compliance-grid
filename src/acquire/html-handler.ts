import * as cheerio from 'cheerio';

export interface HtmlSection {
  id: string;
  heading: string;
  level: number;
  text: string;
}

export interface NormalizedHtml {
  title: string;
  text: string;
  sections: HtmlSection[];
}

const BOILERPLATE_SELECTOR = [
  'script',
  'style',
  'noscript',
  'iframe',
  'nav',
  'header',
  'footer',
  'aside',
  '.nav',
  '.navbar',
  '.menu',
  '.footer',
  '.header',
  '#nav',
  '#navbar',
  '#footer',
  '#header',
].join(',');

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'section'
  );
}

// Normalize an HTML document: strip boilerplate (scripts, nav, footer),
// extract title and main content, and produce a flat list of sections keyed
// by heading. Heading hierarchy is preserved via the level field; section
// text contains the paragraphs/list-items that follow the heading until the
// next heading.
export function normalizeHtml(html: string): NormalizedHtml {
  const $ = cheerio.load(html);
  $(BOILERPLATE_SELECTOR).remove();

  const title = ($('title').text().trim() || $('h1').first().text().trim() || '').slice(
    0,
    500
  );

  // Try <main>, then <article>, then <body>. cheerio.load wraps in <html><body>
  // by default, so $('body') is the last fallback worth trying; we don't fall
  // through to $.root() because its type does not match the others.
  let main = $('main').first();
  if (main.length === 0) main = $('article').first();
  if (main.length === 0) main = $('body').first();

  const sections: HtmlSection[] = [];
  let current: HtmlSection | null = null;

  main.find('h1, h2, h3, h4, h5, h6, p, li').each((_, el) => {
    const $el = $(el);
    const tagName = ($el.prop('tagName') ?? '').toLowerCase();
    if (/^h[1-6]$/.test(tagName)) {
      const heading = $el.text().replace(/\s+/g, ' ').trim();
      if (!heading) return;
      const level = Number.parseInt(tagName.charAt(1), 10);
      current = { id: slugify(heading), heading, level, text: '' };
      sections.push(current);
    } else if (current) {
      const txt = $el.text().replace(/\s+/g, ' ').trim();
      if (txt) current.text += (current.text ? '\n' : '') + txt;
    }
  });

  const text = main.text().replace(/\s+/g, ' ').trim();

  return { title, text, sections };
}
