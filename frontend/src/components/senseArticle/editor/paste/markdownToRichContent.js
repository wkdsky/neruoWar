const escapeHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const inlineMarkdownToHtml = (source = '') => {
  let html = escapeHtml(source);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return html;
};

export const looksLikeMarkdown = (text = '') => {
  const source = String(text || '');
  return /(^|\n)\s*(#{1,4}\s+|[-*+]\s+|\d+\.\s+|>\s+|```|---+\s*$|\|.+\|)/m.test(source);
};

export const markdownToRichHtml = (text = '') => {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  let index = 0;

  const consumeParagraph = () => {
    const parts = [];
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) break;
      if (/^\s*(#{1,4}\s+|[-*+]\s+|\d+\.\s+|>\s+|```|---+$|\|.+\|)/.test(line)) break;
      parts.push(line.trim());
      index += 1;
    }
    if (parts.length > 0) chunks.push(`<p>${inlineMarkdownToHtml(parts.join(' '))}</p>`);
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      chunks.push(`<h${headingMatch[1].length}>${inlineMarkdownToHtml(headingMatch[2].trim())}</h${headingMatch[1].length}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      chunks.push('<hr />');
      index += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      index += 1;
      const codeLines = [];
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      chunks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      chunks.push(`<blockquote>${quoteLines.map((item) => `<p>${inlineMarkdownToHtml(item.trim())}</p>`).join('')}</blockquote>`);
      continue;
    }

    if (/^\|.+\|$/.test(line.trim())) {
      const tableLines = [];
      while (index < lines.length && /^\|.+\|$/.test(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      const rows = tableLines
        .filter((item, rowIndex) => !(rowIndex === 1 && /^\|?(\s*:?-+:?\s*\|)+\s*$/.test(item)))
        .map((item) => item.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
      if (rows.length > 0) {
        const [header, ...body] = rows;
        chunks.push(
          `<table class="sense-rich-table table-style-default" data-table-style="default"><thead><tr>${header.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        );
      }
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^[-*+]\s+(.*)$/);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      chunks.push(`<ul>${items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join('')}</ul>`);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\d+\.\s+(.*)$/);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      chunks.push(`<ol>${items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join('')}</ol>`);
      continue;
    }

    consumeParagraph();
  }

  return chunks.join('') || '<p></p>';
};
