import { AST_NODE_TYPES, parseSenseArticleSource } from '../../../utils/senseArticleSyntax';

const escapeHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderInlineNode = (node = {}) => {
  if (!node || typeof node !== 'object') return '';
  if (node.type === AST_NODE_TYPES.TEXT) return escapeHtml(node.value || '');
  if (node.type === AST_NODE_TYPES.STRONG) return `<strong>${(node.children || []).map(renderInlineNode).join('')}</strong>`;
  if (node.type === AST_NODE_TYPES.EMPHASIS) return `<em>${(node.children || []).map(renderInlineNode).join('')}</em>`;
  if (node.type === AST_NODE_TYPES.CODE_INLINE) return `<code>${escapeHtml(node.value || '')}</code>`;
  if (node.type === AST_NODE_TYPES.FORMULA_INLINE) return `<span class="sense-formula-placeholder" data-formula-placeholder="true">${escapeHtml(node.value || '')}</span>`;
  if (node.type === AST_NODE_TYPES.SYMBOL) return escapeHtml(node.value || '');
  if (node.type === AST_NODE_TYPES.SENSE_REFERENCE) {
    return `<a class="sense-internal-reference" href="#sense-ref-${escapeHtml(node.targetNodeId || '')}-${escapeHtml(node.targetSenseId || '')}" data-reference-kind="internal-sense" data-node-id="${escapeHtml(node.targetNodeId || '')}" data-sense-id="${escapeHtml(node.targetSenseId || '')}" data-display-text="${escapeHtml(node.displayText || '')}">${escapeHtml(node.displayText || `${node.targetNodeId}:${node.targetSenseId}`)}</a>`;
  }
  if (Array.isArray(node.children)) return node.children.map(renderInlineNode).join('');
  return escapeHtml(node.value || '');
};

const renderBlock = (block = {}) => {
  if (block.type === AST_NODE_TYPES.HEADING) {
    const level = Math.max(1, Math.min(4, Number(block.level) || 1));
    return `<h${level}>${(block.children || []).map(renderInlineNode).join('')}</h${level}>`;
  }
  if (block.type === AST_NODE_TYPES.PARAGRAPH) {
    return `<p>${(block.children || []).map(renderInlineNode).join('')}</p>`;
  }
  if (block.type === AST_NODE_TYPES.LIST) {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag}>${(block.items || []).map((item) => `<li>${(item.children || []).map(renderInlineNode).join('')}</li>`).join('')}</${tag}>`;
  }
  if (block.type === AST_NODE_TYPES.BLOCKQUOTE) {
    return `<blockquote>${(block.lines || []).map((line) => `<p>${(line.children || []).map(renderInlineNode).join('')}</p>`).join('')}</blockquote>`;
  }
  if (block.type === AST_NODE_TYPES.CODE_BLOCK || block.type === AST_NODE_TYPES.FORMULA_BLOCK) {
    return `<pre><code>${escapeHtml(block.value || '')}</code></pre>`;
  }
  return '';
};

export const legacyMarkupToRichHtmlWithDiagnostics = (source = '') => {
  const parsed = parseSenseArticleSource(source);
  return {
    html: (parsed?.ast?.blocks || []).map(renderBlock).filter(Boolean).join('') || '<p></p>',
    parseErrors: Array.isArray(parsed?.parseErrors) ? parsed.parseErrors : []
  };
};

const legacyMarkupToRichHtml = (source = '') => legacyMarkupToRichHtmlWithDiagnostics(source).html;

export default legacyMarkupToRichHtml;
