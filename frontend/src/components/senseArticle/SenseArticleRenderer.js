import React, { useMemo, useRef } from 'react';
import { AST_NODE_TYPES } from '../../utils/senseArticleSyntax';
import { getRelocationStatusLabel } from './senseArticleUi';
import SenseArticleRichRenderer from './SenseArticleRichRenderer';
import FormulaPreviewView from './editor/FormulaPreviewView';
import './SenseArticle.css';

const EMPTY_MAP = new Map();
const EMPTY_ARRAY = [];
const isDevEnvironment = process.env.NODE_ENV !== 'production';

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

const InlineNodesBase = ({ nodes = EMPTY_ARRAY, searchQuery = '', referenceMap = EMPTY_MAP, onReferenceClick, onReferenceHover }) => (
  <>
    {(Array.isArray(nodes) ? nodes : EMPTY_ARRAY).map((node, index) => {
      if (!node) return null;
      if (node.type === AST_NODE_TYPES.TEXT) return <React.Fragment key={`text-${index}`}>{renderHighlightedText(node.value || '', searchQuery)}</React.Fragment>;
      if (node.type === AST_NODE_TYPES.EMPHASIS) return <em key={`em-${index}`}><InlineNodes nodes={node.children || EMPTY_ARRAY} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></em>;
      if (node.type === AST_NODE_TYPES.STRONG) return <strong key={`strong-${index}`}><InlineNodes nodes={node.children || EMPTY_ARRAY} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></strong>;
      if (node.type === AST_NODE_TYPES.CODE_INLINE) return <code key={`code-${index}`}>{node.value || ''}</code>;
      if (node.type === AST_NODE_TYPES.FORMULA_INLINE) {
        return <FormulaPreviewView key={`formula-${index}`} source={node.value || ''} displayMode="inline" className="sense-inline-formula" />;
      }
      if (node.type === AST_NODE_TYPES.SYMBOL) return <span key={`symbol-${index}`}>{node.value || ''}</span>;
      if (node.type === AST_NODE_TYPES.SENSE_REFERENCE) {
        const meta = referenceMap.get(node.referenceId) || node;
        const label = node.displayText || meta.targetTitle || `${node.targetNodeId}:${node.targetSenseId}`;
        const targetLabel = meta.targetNodeName && meta.targetTitle
          ? `${meta.targetNodeName} / ${meta.targetTitle}`
          : meta.targetTitle || meta.targetSenseId || '目标释义';
        return (
          <button
            key={`ref-${index}`}
            type="button"
            className={`sense-inline-reference ${meta.isValid === false ? 'invalid' : ''}`}
            title={meta.isValid === false ? '引用目标未解析' : `点击跳转到 ${targetLabel} 阅读页`}
            aria-label={meta.isValid === false ? `${label}（引用目标未解析）` : `${label}（点击跳转到 ${targetLabel} 阅读页）`}
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

const InlineNodes = React.memo(InlineNodesBase, (prev, next) => (
  prev.nodes === next.nodes
  && prev.searchQuery === next.searchQuery
  && prev.referenceMap === next.referenceMap
  && prev.onReferenceClick === next.onReferenceClick
  && prev.onReferenceHover === next.onReferenceHover
));

const renderAnnotationChips = (annotations = EMPTY_ARRAY) => {
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

const BlockViewBase = ({ block, searchQuery, referenceMap, onReferenceClick, onReferenceHover, onHeadingEdit, blockAnnotations, activeBlockId, activeHeadingId }) => {
  const commonProps = getCommonProps({ block, blockAnnotations, activeBlockId, activeHeadingId });

  if (block.type === AST_NODE_TYPES.HEADING) {
    const HeadingTag = `h${Math.min(3, Math.max(1, Number(block.level) || 1))}`;
    return (
      <section {...commonProps} id={block.headingId || block.id} data-article-heading-block="true">
        <div className="sense-heading-row">
          <HeadingTag className="sense-heading-text"><InlineNodes nodes={block.children || EMPTY_ARRAY} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></HeadingTag>
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
      <section {...commonProps}>
        <p><InlineNodes nodes={block.children || EMPTY_ARRAY} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} /></p>
        {renderAnnotationChips(blockAnnotations)}
      </section>
    );
  }

  if (block.type === AST_NODE_TYPES.LIST) {
    const ListTag = block.ordered ? 'ol' : 'ul';
    return (
      <section {...commonProps}>
        <ListTag>
          {(block.items || EMPTY_ARRAY).map((item) => (
            <li key={item.id} data-article-block={item.id} data-article-heading={block.headingId || ''} data-article-block-hash={item.blockHash || ''}>
              <InlineNodes nodes={item.children || EMPTY_ARRAY} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} />
            </li>
          ))}
        </ListTag>
        {renderAnnotationChips(blockAnnotations)}
      </section>
    );
  }

  if (block.type === AST_NODE_TYPES.BLOCKQUOTE) {
    return (
      <blockquote {...commonProps}>
        {(block.lines || EMPTY_ARRAY).map((line) => (
          <p key={line.id} data-article-block={line.id} data-article-heading={block.headingId || ''} data-article-block-hash={line.blockHash || ''}>
            <InlineNodes nodes={line.children || EMPTY_ARRAY} searchQuery={searchQuery} referenceMap={referenceMap} onReferenceClick={onReferenceClick} onReferenceHover={onReferenceHover} />
          </p>
        ))}
        {renderAnnotationChips(blockAnnotations)}
      </blockquote>
    );
  }

  if (block.type === AST_NODE_TYPES.FORMULA_BLOCK) {
    return <FormulaPreviewView as="div" {...commonProps} source={block.value || ''} displayMode="block" className={`${commonProps.className} sense-formula-block`} />;
  }

  if (block.type === AST_NODE_TYPES.CODE_BLOCK) {
    return <pre {...commonProps} className={`${commonProps.className} sense-code-block`}><code>{block.value || ''}</code></pre>;
  }

  return null;
};

const BlockView = React.memo(BlockViewBase, (prev, next) => (
  prev.block === next.block
  && prev.searchQuery === next.searchQuery
  && prev.referenceMap === next.referenceMap
  && prev.onReferenceClick === next.onReferenceClick
  && prev.onReferenceHover === next.onReferenceHover
  && prev.onHeadingEdit === next.onHeadingEdit
  && prev.blockAnnotations === next.blockAnnotations
  && prev.activeBlockId === next.activeBlockId
  && prev.activeHeadingId === next.activeHeadingId
));

const SenseArticleRendererComponent = ({
  revision,
  searchQuery = '',
  annotations = EMPTY_ARRAY,
  onReferenceClick,
  onReferenceHover,
  onHeadingEdit,
  activeBlockId = '',
  activeHeadingId = ''
}) => {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const blocks = useMemo(() => (Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : EMPTY_ARRAY), [revision]);
  const referenceMap = useMemo(() => new Map((Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : EMPTY_ARRAY).map((item) => [item.referenceId, item])), [revision]);
  const annotationsByKey = useMemo(() => {
    const byBlock = new Map();
    const byHeading = new Map();

    (Array.isArray(annotations) ? annotations : EMPTY_ARRAY).forEach((annotation) => {
      const blockId = annotation?.relocation?.anchor?.blockId || annotation?.anchor?.blockId;
      const headingId = annotation?.relocation?.anchor?.headingId || annotation?.anchor?.headingId;
      if (blockId) byBlock.set(blockId, [...(byBlock.get(blockId) || EMPTY_ARRAY), annotation]);
      if (headingId) byHeading.set(headingId, [...(byHeading.get(headingId) || EMPTY_ARRAY), annotation]);
    });

    return { byBlock, byHeading };
  }, [annotations]);

  if (isDevEnvironment) {
    console.debug('[sense-article] preview render', {
      count: renderCountRef.current,
      blocks: blocks.length,
      searchQuery,
      revisionId: revision?._id || ''
    });
  }

  return (
    <div className="sense-article-renderer">
      {blocks.map((block) => {
        const blockAnnotations = annotationsByKey.byBlock.get(block.id)
          || annotationsByKey.byHeading.get(block.headingId || '')
          || EMPTY_ARRAY;
        return (
          <BlockView
            key={block.id}
            block={block}
            searchQuery={searchQuery}
            referenceMap={referenceMap}
            onReferenceClick={onReferenceClick}
            onReferenceHover={onReferenceHover}
            onHeadingEdit={onHeadingEdit}
            blockAnnotations={blockAnnotations}
            activeBlockId={activeBlockId}
            activeHeadingId={activeHeadingId}
          />
        );
      })}
    </div>
  );
};

const LegacySenseArticleRenderer = React.memo(SenseArticleRendererComponent, (prev, next) => (
  prev.revision === next.revision
  && prev.searchQuery === next.searchQuery
  && prev.annotations === next.annotations
  && prev.onReferenceClick === next.onReferenceClick
  && prev.onReferenceHover === next.onReferenceHover
  && prev.onHeadingEdit === next.onHeadingEdit
  && prev.activeBlockId === next.activeBlockId
  && prev.activeHeadingId === next.activeHeadingId
));

const SenseArticleRenderer = (props) => {
  if (props?.revision?.contentFormat === 'rich_html') {
    return <SenseArticleRichRenderer {...props} />;
  }
  return <LegacySenseArticleRenderer {...props} />;
};

export default SenseArticleRenderer;
