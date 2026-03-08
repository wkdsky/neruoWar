import React from 'react';
import { AST_NODE_TYPES } from '../../utils/senseArticleSyntax';
import { getRelocationStatusLabel } from './senseArticleUi';
import './SenseArticle.css';

const highlightText = (text = '', query = '') => {
  const source = String(text || '');
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [source];
  const lower = source.toLowerCase();
  const parts = [];
  let cursor = 0;
  while (cursor < source.length) {
    const index = lower.indexOf(needle, cursor);
    if (index < 0) {
      parts.push(source.slice(cursor));
      break;
    }
    if (index > cursor) parts.push(source.slice(cursor, index));
    parts.push({ highlight: source.slice(index, index + needle.length) });
    cursor = index + needle.length;
  }
  return parts;
};

const renderHighlightedText = (text = '', query = '') => highlightText(text, query).map((part, index) => (
  typeof part === 'string'
    ? <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
    : <mark key={`mark-${index}`} className="sense-inline-highlight">{part.highlight}</mark>
));

const InlineNodes = ({ nodes = [], searchQuery = '', referenceMap = new Map(), onReferenceClick, onReferenceHover }) => (
  <>
    {(Array.isArray(nodes) ? nodes : []).map((node, index) => {
      if (!node) return null;
      if (node.type === AST_NODE_TYPES.TEXT) return <React.Fragment key={`text-${index}`}>{renderHighlightedText(node.value || '', searchQuery)}</React.Fragment>;
      if (node.type === AST_NODE_TYPES.EMPHASIS) return <em key={`em-${index}`}><InlineNodes nodes={node.children || []} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></em>;
      if (node.type === AST_NODE_TYPES.STRONG) return <strong key={`strong-${index}`}><InlineNodes nodes={node.children || []} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></strong>;
      if (node.type === AST_NODE_TYPES.CODE_INLINE) return <code key={`code-${index}`}>{node.value || ''}</code>;
      if (node.type === AST_NODE_TYPES.FORMULA_INLINE) return <span key={`formula-${index}`} className="sense-inline-formula">{node.value || ''}</span>;
      if (node.type === AST_NODE_TYPES.SYMBOL) return <span key={`symbol-${index}`}>{node.value || ''}</span>;
      if (node.type === AST_NODE_TYPES.SENSE_REFERENCE) {
        const meta = referenceMap.get(node.referenceId) || node;
        const label = node.displayText || meta.targetTitle || `${node.targetNodeId}:${node.targetSenseId}`;
        return (
          <button
            key={`ref-${index}`}
            type="button"
            className={`sense-inline-reference ${meta.isValid === false ? 'invalid' : ''}`}
            title={meta.targetTitle ? `${meta.targetNodeName || ''} / ${meta.targetTitle}` : '引用目标未解析'}
            onMouseEnter={(event) => onReferenceHover && onReferenceHover(meta, event.currentTarget)}
            onMouseLeave={() => onReferenceHover && onReferenceHover(null, null)}
            onClick={() => onReferenceClick && onReferenceClick(meta)}
          >
            {label}
          </button>
        );
      }
      return <span key={`fallback-${index}`}>{node.value || ''}</span>;
    })}
  </>
);

const renderAnnotationChips = (annotations = []) => {
  if (!annotations.length) return null;
  return (
    <div className="sense-annotation-chip-list">
      {annotations.map((annotation) => {
        const relocationStatus = annotation?.relocation?.status || '';
        return (
          <span
            key={annotation._id}
            className={`sense-annotation-chip ${relocationStatus ? `relocation-${relocationStatus}` : ''}`}
            style={{ backgroundColor: annotation.highlightColor || '#fde68a' }}
            title={relocationStatus ? getRelocationStatusLabel(relocationStatus) : '私有标注'}
          >
            {annotation.note || annotation.anchor?.selectionText || annotation.anchor?.headingId || '私有标注'}
          </span>
        );
      })}
    </div>
  );
};

const getCommonProps = ({ block, blockAnnotations, activeBlockId, activeHeadingId }) => ({
  'data-article-block': block.id,
  'data-article-heading': block.headingId || '',
  'data-article-block-hash': block.blockHash || '',
  className: [
    'sense-article-block',
    blockAnnotations.length ? 'annotated' : '',
    activeBlockId && activeBlockId === block.id ? 'active-block' : '',
    activeHeadingId && activeHeadingId === (block.headingId || '') ? 'active-heading-context' : ''
  ].filter(Boolean).join(' ')
});

const renderBlock = ({ block, searchQuery, referenceMap, onReferenceClick, onReferenceHover, onHeadingEdit, annotationsByBlock, annotationsByHeading, activeBlockId, activeHeadingId }) => {
  const blockAnnotations = annotationsByBlock.get(block.id) || annotationsByHeading.get(block.headingId || '') || [];
  const commonProps = getCommonProps({ block, blockAnnotations, activeBlockId, activeHeadingId });

  if (block.type === AST_NODE_TYPES.HEADING) {
    const HeadingTag = `h${Math.min(3, Math.max(1, Number(block.level) || 1))}`;
    return (
      <section key={block.id} {...commonProps} id={block.headingId || block.id} data-article-heading-block="true">
        <div className="sense-heading-row">
          <HeadingTag className="sense-heading-text"><InlineNodes nodes={block.children || []} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></HeadingTag>
          {onHeadingEdit ? (
            <button type="button" className="sense-mini-action" onClick={() => onHeadingEdit(block.headingId || '', block.id)}>
              编辑本节
            </button>
          ) : null}
        </div>
        {renderAnnotationChips(blockAnnotations)}
      </section>
    );
  }

  if (block.type === AST_NODE_TYPES.PARAGRAPH) {
    return (
      <section key={block.id} {...commonProps}>
        <p><InlineNodes nodes={block.children || []} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></p>
        {renderAnnotationChips(blockAnnotations)}
      </section>
    );
  }

  if (block.type === AST_NODE_TYPES.LIST) {
    const ListTag = block.ordered ? 'ol' : 'ul';
    return (
      <section key={block.id} {...commonProps}>
        <ListTag>
          {(block.items || []).map((item) => (
            <li key={item.id} data-article-block={item.id} data-article-heading={block.headingId || ''} data-article-block-hash={item.blockHash || ''}>
              <InlineNodes nodes={item.children || []} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} />
            </li>
          ))}
        </ListTag>
        {renderAnnotationChips(blockAnnotations)}
      </section>
    );
  }

  if (block.type === AST_NODE_TYPES.BLOCKQUOTE) {
    return (
      <blockquote key={block.id} {...commonProps}>
        {(block.lines || []).map((line) => (
          <p key={line.id} data-article-block={line.id} data-article-heading={block.headingId || ''} data-article-block-hash={line.blockHash || ''}>
            <InlineNodes nodes={line.children || []} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} />
          </p>
        ))}
        {renderAnnotationChips(blockAnnotations)}
      </blockquote>
    );
  }

  if (block.type === AST_NODE_TYPES.FORMULA_BLOCK) {
    return <pre key={block.id} {...commonProps} className={`${commonProps.className} sense-formula-block`}>{block.value || ''}</pre>;
  }

  if (block.type === AST_NODE_TYPES.CODE_BLOCK) {
    return <pre key={block.id} {...commonProps} className={`${commonProps.className} sense-code-block`}><code>{block.value || ''}</code></pre>;
  }

  return null;
};

const SenseArticleRenderer = ({
  revision,
  searchQuery = '',
  annotations = [],
  onReferenceClick,
  onReferenceHover,
  onHeadingEdit,
  activeBlockId = '',
  activeHeadingId = ''
}) => {
  const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
  const referenceMap = new Map((Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : []).map((item) => [item.referenceId, item]));
  const annotationsByBlock = new Map();
  const annotationsByHeading = new Map();

  (Array.isArray(annotations) ? annotations : []).forEach((annotation) => {
    const blockId = annotation?.relocation?.anchor?.blockId || annotation?.anchor?.blockId;
    const headingId = annotation?.relocation?.anchor?.headingId || annotation?.anchor?.headingId;
    if (blockId) annotationsByBlock.set(blockId, [...(annotationsByBlock.get(blockId) || []), annotation]);
    if (headingId) annotationsByHeading.set(headingId, [...(annotationsByHeading.get(headingId) || []), annotation]);
  });

  return (
    <div className="sense-article-renderer">
      {blocks.map((block) => renderBlock({
        block,
        searchQuery,
        referenceMap,
        onReferenceClick,
        onReferenceHover,
        onHeadingEdit,
        annotationsByBlock,
        annotationsByHeading,
        activeBlockId,
        activeHeadingId
      }))}
    </div>
  );
};

export default SenseArticleRenderer;
