/**
 * A tiny, safe renderer for the dev log's text fields. Light markdown only:
 * "- " bullets, **bold**, `code` and blank-line paragraphs. All input is
 * HTML-escaped first, so the result is safe for dangerouslySetInnerHTML.
 */
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Bold and code on already-escaped text. Code is split out first so ** inside it stays literal. */
const inline = (escaped: string) =>
  escaped
    .split(/(`[^`\n]+`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? `<code>${part.slice(1, -1)}</code>`
        : part.replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>'),
    )
    .join('');

const BULLET = /^\s{0,3}[-*] +(.*)$/;

export function renderRich(text: string): string {
  const lines = escapeHtml(text.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let items: string[] | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (items) out.push(`<ul>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    items = null;
  };

  for (const line of lines) {
    const bullet = BULLET.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (bullet) {
      flushPara();
      (items ??= []).push(bullet[1]);
    } else if (items && /^\s+/.test(line)) {
      // An indented line continues the bullet above.
      items[items.length - 1] += ' ' + line.trim();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join('');
}

/** The first line of a text field with the markup removed (for timeline cards). */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.replace(BULLET, '$1').replace(/\*\*/g, '').replace(/`/g, '').trim();
}
