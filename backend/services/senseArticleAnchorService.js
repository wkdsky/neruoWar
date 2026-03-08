const { ANCHOR_RELOCATION_STATUSES } = require('../constants/senseArticle');
const { shortHash } = require('../utils/hash');
const { buildBlockPlainText } = require('./senseArticleParser');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const buildSearchIndex = (revision = null) => {
  const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
  const rows = [];
  let cursor = 0;
  blocks.forEach((block) => {
    const plainText = buildBlockPlainText(block);
    const start = cursor;
    const end = start + plainText.length;
    rows.push({
      blockId: block?.id || '',
      blockHash: block?.blockHash || '',
      headingId: block?.headingId || block?.headingId === '' ? block.headingId : '',
      plainText,
      start,
      end
    });
    cursor = end + 2;
  });
  return rows;
};

const normalizeAnchor = (anchor = {}, fallbackRevisionId = null) => {
  const selectionText = typeof anchor?.selectionText === 'string' ? anchor.selectionText.trim() : '';
  const textQuote = typeof anchor?.textQuote === 'string' ? anchor.textQuote.trim() : '';
  return {
    revisionId: anchor?.revisionId || fallbackRevisionId || null,
    headingId: typeof anchor?.headingId === 'string' ? anchor.headingId.trim() : '',
    blockId: typeof anchor?.blockId === 'string' ? anchor.blockId.trim() : '',
    blockHash: typeof anchor?.blockHash === 'string' ? anchor.blockHash.trim() : '',
    textQuote,
    selectionText,
    selectedTextHash: typeof anchor?.selectedTextHash === 'string' && anchor.selectedTextHash.trim()
      ? anchor.selectedTextHash.trim()
      : shortHash(selectionText || textQuote || '', 16),
    prefixText: typeof anchor?.prefixText === 'string' ? anchor.prefixText.trim() : (typeof anchor?.beforeText === 'string' ? anchor.beforeText.trim() : ''),
    suffixText: typeof anchor?.suffixText === 'string' ? anchor.suffixText.trim() : (typeof anchor?.afterText === 'string' ? anchor.afterText.trim() : ''),
    textPositionStart: Number.isFinite(Number(anchor?.textPositionStart)) ? Number(anchor.textPositionStart) : null,
    textPositionEnd: Number.isFinite(Number(anchor?.textPositionEnd)) ? Number(anchor.textPositionEnd) : null
  };
};

const buildRichAnchor = ({
  revision = null,
  anchor = {},
  block = null,
  selectionText = '',
  textPositionStart = null,
  textPositionEnd = null
}) => {
  const normalized = normalizeAnchor(anchor, revision?._id || null);
  const quote = selectionText || normalized.selectionText || normalized.textQuote || '';
  return {
    ...normalized,
    revisionId: revision?._id || normalized.revisionId || null,
    headingId: block?.headingId || normalized.headingId || '',
    blockId: block?.blockId || normalized.blockId || '',
    blockHash: block?.blockHash || normalized.blockHash || '',
    textQuote: quote || normalized.textQuote || '',
    selectionText: quote || normalized.selectionText || '',
    selectedTextHash: shortHash(quote || normalized.selectionText || normalized.textQuote || '', 16),
    textPositionStart: Number.isFinite(textPositionStart) ? textPositionStart : normalized.textPositionStart,
    textPositionEnd: Number.isFinite(textPositionEnd) ? textPositionEnd : normalized.textPositionEnd
  };
};

const createAnchorFromSelection = ({
  revision = null,
  blockId = '',
  headingId = '',
  selectionText = '',
  textPositionStart = null,
  textPositionEnd = null,
  prefixText = '',
  suffixText = ''
}) => {
  const searchIndex = buildSearchIndex(revision);
  const block = searchIndex.find((item) => item.blockId === blockId) || searchIndex.find((item) => item.headingId === headingId) || null;
  return buildRichAnchor({
    revision,
    anchor: {
      blockId,
      headingId,
      selectionText,
      textQuote: selectionText,
      prefixText,
      suffixText,
      textPositionStart,
      textPositionEnd,
      blockHash: block?.blockHash || ''
    },
    block,
    selectionText,
    textPositionStart,
    textPositionEnd
  });
};

const quoteMatchesContext = ({ fullText = '', textQuote = '', prefixText = '', suffixText = '', position = -1 }) => {
  if (position < 0 || !textQuote) return false;
  const before = prefixText ? fullText.slice(Math.max(0, position - prefixText.length), position) : '';
  const after = suffixText ? fullText.slice(position + textQuote.length, position + textQuote.length + suffixText.length) : '';
  const prefixOk = !prefixText || before.endsWith(prefixText);
  const suffixOk = !suffixText || after.startsWith(suffixText);
  return prefixOk && suffixOk;
};

const relocateAnchor = ({ anchor = {}, currentRevision = null }) => {
  const normalizedAnchor = normalizeAnchor(anchor, currentRevision?._id || null);
  const snapshot = String(currentRevision?.plainTextSnapshot || '');
  const searchIndex = buildSearchIndex(currentRevision);
  const headings = Array.isArray(currentRevision?.headingIndex) ? currentRevision.headingIndex : [];

  if (!currentRevision) {
    return {
      status: 'broken',
      anchor: normalizedAnchor,
      supportedStatuses: ANCHOR_RELOCATION_STATUSES
    };
  }

  if (normalizedAnchor.revisionId && String(normalizedAnchor.revisionId) === String(currentRevision._id)) {
    return {
      status: 'exact',
      anchor: normalizedAnchor,
      supportedStatuses: ANCHOR_RELOCATION_STATUSES
    };
  }

  const matchedByBlock = searchIndex.find((row) => (
    (normalizedAnchor.blockId && row.blockId === normalizedAnchor.blockId)
    || (normalizedAnchor.blockHash && row.blockHash === normalizedAnchor.blockHash)
  ));
  if (matchedByBlock) {
    return {
      status: 'relocated',
      anchor: buildRichAnchor({
        revision: currentRevision,
        anchor: normalizedAnchor,
        block: matchedByBlock,
        selectionText: normalizedAnchor.selectionText || normalizedAnchor.textQuote,
        textPositionStart: matchedByBlock.start,
        textPositionEnd: matchedByBlock.end
      }),
      supportedStatuses: ANCHOR_RELOCATION_STATUSES
    };
  }

  const quote = normalizedAnchor.selectionText || normalizedAnchor.textQuote;
  if (normalizedAnchor.headingId && quote) {
    const headingRows = searchIndex.filter((row) => row.headingId === normalizedAnchor.headingId);
    const matchedRow = headingRows.find((row) => row.plainText.includes(quote));
    if (matchedRow) {
      const localIndex = matchedRow.plainText.indexOf(quote);
      return {
        status: 'relocated',
        anchor: buildRichAnchor({
          revision: currentRevision,
          anchor: normalizedAnchor,
          block: matchedRow,
          selectionText: quote,
          textPositionStart: matchedRow.start + localIndex,
          textPositionEnd: matchedRow.start + localIndex + quote.length
        }),
        supportedStatuses: ANCHOR_RELOCATION_STATUSES
      };
    }
  }

  if (quote) {
    const quoteMatches = [];
    let searchFrom = 0;
    while (searchFrom < snapshot.length) {
      const position = snapshot.indexOf(quote, searchFrom);
      if (position < 0) break;
      quoteMatches.push(position);
      searchFrom = position + Math.max(1, quote.length);
    }

    const contextualMatch = quoteMatches.find((position) => quoteMatchesContext({
      fullText: snapshot,
      textQuote: quote,
      prefixText: normalizedAnchor.prefixText,
      suffixText: normalizedAnchor.suffixText,
      position
    }));

    if (Number.isFinite(contextualMatch)) {
      const row = searchIndex.find((item) => contextualMatch >= item.start && contextualMatch <= item.end) || null;
      return {
        status: 'relocated',
        anchor: buildRichAnchor({
          revision: currentRevision,
          anchor: normalizedAnchor,
          block: row,
          selectionText: quote,
          textPositionStart: contextualMatch,
          textPositionEnd: contextualMatch + quote.length
        }),
        supportedStatuses: ANCHOR_RELOCATION_STATUSES
      };
    }

    if (quoteMatches.length === 1) {
      const position = quoteMatches[0];
      const row = searchIndex.find((item) => position >= item.start && position <= item.end) || null;
      return {
        status: 'uncertain',
        anchor: buildRichAnchor({
          revision: currentRevision,
          anchor: normalizedAnchor,
          block: row,
          selectionText: quote,
          textPositionStart: position,
          textPositionEnd: position + quote.length
        }),
        supportedStatuses: ANCHOR_RELOCATION_STATUSES
      };
    }
  }

  if (Number.isFinite(normalizedAnchor.textPositionStart) && Number.isFinite(normalizedAnchor.textPositionEnd) && snapshot.length > 0) {
    return {
      status: 'uncertain',
      anchor: {
        ...normalizedAnchor,
        revisionId: currentRevision._id,
        textPositionStart: clamp(normalizedAnchor.textPositionStart, 0, snapshot.length),
        textPositionEnd: clamp(normalizedAnchor.textPositionEnd, 0, snapshot.length)
      },
      supportedStatuses: ANCHOR_RELOCATION_STATUSES
    };
  }

  const matchedHeading = normalizedAnchor.headingId ? headings.find((item) => item.headingId === normalizedAnchor.headingId) : null;
  if (matchedHeading) {
    return {
      status: 'uncertain',
      anchor: {
        ...normalizedAnchor,
        revisionId: currentRevision._id,
        headingId: matchedHeading.headingId
      },
      supportedStatuses: ANCHOR_RELOCATION_STATUSES
    };
  }

  return {
    status: 'broken',
    anchor: {
      ...normalizedAnchor,
      revisionId: currentRevision._id
    },
    supportedStatuses: ANCHOR_RELOCATION_STATUSES
  };
};

module.exports = {
  buildRichAnchor,
  createAnchorFromSelection,
  normalizeAnchor,
  relocateAnchor
};
