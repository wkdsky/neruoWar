import React, { useMemo } from 'react';
import { getRelocationStatusLabel } from './senseArticleUi';
import { buildFallbackRichBlocks } from './editor/extractRichHtmlOutline';

const EMPTY_ARRAY = [];

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

const renderHighlightedText = (text = '', query = '', keyPrefix = 'text') => highlightText(text, query).map((part, index) => (
  typeof part === 'string'
    ? <React.Fragment key={`${keyPrefix}-${index}`}>{part}</React.Fragment>
    : <mark key={`${keyPrefix}-mark-${index}`} className="sense-inline-highlight">{part.highlight}</mark>
));

const styleStringToObject = (styleText = '') => String(styleText || '')
  .split(';')
  .map((item) => item.trim())
  .filter(Boolean)
  .reduce((result, item) => {
    const colonIndex = item.indexOf(':');
    if (colonIndex <= 0) return result;
    const property = item.slice(0, colonIndex).trim();
    const value = item.slice(colonIndex + 1).trim();
    if (!property || !value) return result;
    const camelKey = property.replace(/-([a-z])/g, (_all, char) => char.toUpperCase());
    result[camelKey] = value;
    return result;
  }, {});

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

const renderDomNode = ({ node, searchQuery, referenceMap, onReferenceClick, onReferenceHover, keyPrefix }) => {
  if (!node) return null;
  if (node.nodeType === 3) {
    return renderHighlightedText(node.textContent || '', searchQuery, keyPrefix);
  }
  if (node.nodeType !== 1) return null;

  const tagName = String(node.tagName || '').toLowerCase();
  const childNodes = Array.from(node.childNodes || []);
  const children = childNodes.flatMap((child, index) => renderDomNode({
    node: child,
    searchQuery,
    referenceMap,
    onReferenceClick,
    onReferenceHover,
    keyPrefix: `${keyPrefix}-${tagName}-${index}`
  }));
  const className = node.getAttribute('class') || undefined;
  const style = styleStringToObject(node.getAttribute('style') || '');
  const tableCellProps = {
    colSpan: node.getAttribute('colspan') ? Number(node.getAttribute('colspan')) : undefined,
    rowSpan: node.getAttribute('rowspan') ? Number(node.getAttribute('rowspan')) : undefined,
    'data-align': node.getAttribute('data-align') || undefined,
    'data-vertical-align': node.getAttribute('data-vertical-align') || undefined,
    'data-background-color': node.getAttribute('data-background-color') || undefined,
    'data-text-color': node.getAttribute('data-text-color') || undefined,
    'data-border-edges': node.getAttribute('data-border-edges') || undefined,
    'data-border-width': node.getAttribute('data-border-width') || undefined,
    'data-border-color': node.getAttribute('data-border-color') || undefined,
    'data-diagonal': node.getAttribute('data-diagonal') || undefined,
    'data-colwidth': node.getAttribute('data-colwidth') || undefined
  };

  if (tagName === 'a' && node.getAttribute('data-reference-kind') === 'internal-sense') {
    const referenceId = node.getAttribute('data-reference-id') || '';
    const meta = referenceMap.get(referenceId) || {
      referenceId,
      targetNodeId: node.getAttribute('data-node-id') || '',
      targetSenseId: node.getAttribute('data-sense-id') || '',
      displayText: node.getAttribute('data-display-text') || node.textContent || ''
    };
    return (
      <button
        key={keyPrefix}
        type="button"
        className={`sense-inline-reference ${meta.isValid === false ? 'invalid' : ''}`}
        onClick={() => onReferenceClick && onReferenceClick(meta)}
        onMouseEnter={(event) => onReferenceHover && onReferenceHover(meta, event.currentTarget)}
        onMouseLeave={() => onReferenceHover && onReferenceHover(null, null)}
      >
        {children}
      </button>
    );
  }

  if (tagName === 'a') {
    return (
      <a key={keyPrefix} href={node.getAttribute('href') || '#'} target={node.getAttribute('target') || undefined} rel={node.getAttribute('rel') || undefined} className={className}>
        {children}
      </a>
    );
  }
  if (tagName === 'img') {
    return (
      <img
        key={keyPrefix}
        src={node.getAttribute('src') || ''}
        alt={node.getAttribute('alt') || ''}
        className={className}
        style={style}
        width={node.getAttribute('width') || undefined}
        onError={(event) => event.currentTarget.classList.add('is-broken')}
      />
    );
  }
  if (tagName === 'audio') {
    return <audio key={keyPrefix} src={node.getAttribute('src') || ''} controls className={className} />;
  }
  if (tagName === 'video') {
    return <video key={keyPrefix} src={node.getAttribute('src') || ''} poster={node.getAttribute('poster') || undefined} controls className={className} width={node.getAttribute('width') || undefined} />;
  }
  if (tagName === 'source') {
    return <source key={keyPrefix} src={node.getAttribute('src') || ''} type={node.getAttribute('type') || undefined} />;
  }
  if (tagName === 'col') {
    return <col key={keyPrefix} className={className} style={Object.keys(style).length ? style : undefined} span={node.getAttribute('span') || undefined} />;
  }
  if (tagName === 'colgroup') {
    return (
      <colgroup key={keyPrefix} className={className} style={Object.keys(style).length ? style : undefined} span={node.getAttribute('span') || undefined}>
        {children}
      </colgroup>
    );
  }
  if (tagName === 'table') {
    return (
      <div key={`${keyPrefix}-wrap`} className="sense-rich-table-wrap">
        <table
          key={keyPrefix}
          className={className}
          style={Object.keys(style).length ? style : undefined}
          data-table-style={node.getAttribute('data-table-style') || undefined}
          data-table-width-mode={node.getAttribute('data-table-width-mode') || undefined}
          data-table-width-value={node.getAttribute('data-table-width-value') || undefined}
          data-table-border-preset={node.getAttribute('data-table-border-preset') || undefined}
          data-column-widths={node.getAttribute('data-column-widths') || undefined}
        >
          {children}
        </table>
      </div>
    );
  }
  if (tagName === 'td' || tagName === 'th') {
    return React.createElement(tagName, {
      key: keyPrefix,
      className,
      style: Object.keys(style).length ? style : undefined,
      ...tableCellProps
    }, children);
  }
  if (tagName === 'input') {
    return <input key={keyPrefix} type="checkbox" checked={node.hasAttribute('checked')} disabled />;
  }
  if (tagName === 'br') return <br key={keyPrefix} />;
  if (tagName === 'hr') return <hr key={keyPrefix} />;

  return React.createElement(tagName, {
    key: keyPrefix,
    className,
    style: Object.keys(style).length ? style : undefined
  }, children);
};

const RichBlock = ({
  block,
  blockAnnotations,
  searchQuery,
  referenceMap,
  onReferenceClick,
  onReferenceHover,
  onHeadingEdit,
  activeBlockId,
  activeHeadingId
}) => {
  const parsedContent = useMemo(() => {
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${block.html || ''}</body>`, 'text/html');
    return Array.from(doc.body.childNodes || []);
  }, [block.html]);

  const className = [
    'sense-article-block',
    blockAnnotations.length ? 'annotated' : '',
    activeBlockId && activeBlockId === block.id ? 'active-block' : '',
    activeHeadingId && activeHeadingId === (block.headingId || '') ? 'active-heading-context' : ''
  ].filter(Boolean).join(' ');

  const body = parsedContent.flatMap((node, index) => renderDomNode({
    node,
    searchQuery,
    referenceMap,
    onReferenceClick,
    onReferenceHover,
    keyPrefix: `${block.id}-${index}`
  }));

  if (block.type === 'heading') {
    return (
      <section className={className} id={block.headingId || block.id} data-article-block={block.id} data-article-heading={block.headingId || ''} data-article-heading-block="true">
        <div className="sense-heading-row">
          <div className="sense-rich-block-body">{body}</div>
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

  return (
    <section className={className} data-article-block={block.id} data-article-heading={block.headingId || ''}>
      <div className="sense-rich-block-body">{body}</div>
      {renderAnnotationChips(blockAnnotations)}
    </section>
  );
};

const SenseArticleRichRenderer = ({
  revision,
  searchQuery = '',
  annotations = EMPTY_ARRAY,
  onReferenceClick,
  onReferenceHover,
  onHeadingEdit,
  activeBlockId = '',
  activeHeadingId = '',
  preferHtmlSnapshot = false
}) => {
  const blocks = useMemo(() => {
    const explicitBlocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : EMPTY_ARRAY;
    if (!preferHtmlSnapshot && explicitBlocks.length > 0) return explicitBlocks;
    return buildFallbackRichBlocks(revision?.renderSnapshot?.html || revision?.editorSource || '');
  }, [preferHtmlSnapshot, revision]);
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

  return (
    <div className="sense-article-renderer sense-rich-renderer">
      {blocks.map((block) => (
        <RichBlock
          key={block.id}
          block={block}
          blockAnnotations={annotationsByKey.byBlock.get(block.id) || annotationsByKey.byHeading.get(block.headingId || '') || EMPTY_ARRAY}
          searchQuery={searchQuery}
          referenceMap={referenceMap}
          onReferenceClick={onReferenceClick}
          onReferenceHover={onReferenceHover}
          onHeadingEdit={onHeadingEdit}
          activeBlockId={activeBlockId}
          activeHeadingId={activeHeadingId}
        />
      ))}
    </div>
  );
};

export default SenseArticleRichRenderer;
