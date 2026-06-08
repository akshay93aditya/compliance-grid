import { describe, expect, it } from 'vitest';
import { normalizeHtml } from './html-handler';

describe('normalizeHtml', () => {
  it('extracts the title from <title>', () => {
    const html = `<html><head><title>Karnataka Factories Rules, 1969</title></head><body><h1>Rules</h1></body></html>`;
    const result = normalizeHtml(html);
    expect(result.title).toBe('Karnataka Factories Rules, 1969');
  });

  it('falls back to the first h1 when title is missing', () => {
    const html = `<html><body><h1>Rules</h1></body></html>`;
    expect(normalizeHtml(html).title).toBe('Rules');
  });

  it('groups paragraphs under their preceding heading', () => {
    const html = `
      <html><body>
        <h2>Section 5: Health</h2>
        <p>Every factory shall maintain cleanliness.</p>
        <p>Drainage shall be provided.</p>
        <h2>Section 6: Safety</h2>
        <p>Fencing of machinery is required.</p>
      </body></html>
    `;
    const result = normalizeHtml(html);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.heading).toContain('Health');
    expect(result.sections[0]!.text).toContain('cleanliness');
    expect(result.sections[0]!.text).toContain('Drainage');
    expect(result.sections[1]!.heading).toContain('Safety');
    expect(result.sections[1]!.text).toContain('Fencing');
  });

  it('strips boilerplate (script, style, nav, footer)', () => {
    const html = `
      <html><body>
        <nav>HOME | ABOUT</nav>
        <script>alert('xss');</script>
        <style>body { color: red; }</style>
        <main><h2>Real Content</h2><p>The body text.</p></main>
        <footer>(c) 2026</footer>
      </body></html>
    `;
    const result = normalizeHtml(html);
    expect(result.text).not.toContain('HOME');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('(c) 2026');
    expect(result.text).toContain('The body text');
  });

  it('records heading level', () => {
    const html = `<body><h1>A</h1><p>x</p><h2>B</h2><p>y</p><h3>C</h3><p>z</p></body>`;
    const result = normalizeHtml(html);
    expect(result.sections.map((s) => s.level)).toEqual([1, 2, 3]);
  });

  it('generates a slug id from heading text', () => {
    const html = `<body><h2>Section 5(a): Health & Safety</h2><p>x</p></body>`;
    const result = normalizeHtml(html);
    expect(result.sections[0]!.id).toBe('section-5-a-health-safety');
  });

  it('prefers <main> over <body> when both exist', () => {
    const html = `
      <body>
        <h2>Body heading</h2>
        <main><h2>Main heading</h2></main>
      </body>
    `;
    const result = normalizeHtml(html);
    expect(result.sections.map((s) => s.heading)).toEqual(['Main heading']);
  });

  it('returns empty sections for content without headings', () => {
    const html = `<body><p>just a paragraph</p></body>`;
    const result = normalizeHtml(html);
    expect(result.sections).toEqual([]);
    expect(result.text).toContain('just a paragraph');
  });

  it('collapses whitespace in extracted text', () => {
    const html = `<body><h2>X</h2><p>line\n\n one\n\tline\ttwo</p></body>`;
    const result = normalizeHtml(html);
    expect(result.sections[0]!.text).toBe('line one line two');
  });
});
