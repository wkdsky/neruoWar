const { getIdString } = require('../utils/objectId');

const normalizeLines = (text = '') => String(text || '').split(/\r?\n/);

const buildLineDiff = (fromText = '', toText = '') => {
  const left = normalizeLines(fromText);
  const right = normalizeLines(toText);
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        rows[i][j] = rows[i + 1][j + 1] + 1;
      } else {
        rows[i][j] = Math.max(rows[i + 1][j], rows[i][j + 1]);
      }
    }
  }

  const changes = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      changes.push({ type: 'equal', text: left[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (rows[i + 1][j] >= rows[i][j + 1]) {
      changes.push({ type: 'removed', text: left[i] });
      i += 1;
    } else {
      changes.push({ type: 'added', text: right[j] });
      j += 1;
    }
  }

  while (i < left.length) {
    changes.push({ type: 'removed', text: left[i] });
    i += 1;
  }
  while (j < right.length) {
    changes.push({ type: 'added', text: right[j] });
    j += 1;
  }

  return {
    changes,
    stats: {
      added: changes.filter((item) => item.type === 'added').length,
      removed: changes.filter((item) => item.type === 'removed').length,
      changed: changes.filter((item) => item.type !== 'equal').length
    }
  };
};

const normalizeTerms = (text = '') => Array.from(new Set(
  String(text || '')
    .toLowerCase()
    .split(/[^\w\u4e00-\u9fa5]+/)
    .map((item) => item.trim())
    .filter(Boolean)
));

const computeSimilarity = (leftText = '', rightText = '') => {
  const leftTerms = normalizeTerms(leftText);
  const rightTerms = normalizeTerms(rightText);
  if (leftTerms.length === 0 || rightTerms.length === 0) return 0;
  const rightSet = new Set(rightTerms);
  const intersect = leftTerms.filter((item) => rightSet.has(item)).length;
  return intersect / Math.max(leftTerms.length, rightTerms.length, 1);
};

const buildBlockSource = ({ revision = null, block = null }) => {
  if (!revision || !block) return '';
  const lines = normalizeLines(revision.editorSource || '');
  const lineStart = Number.isFinite(Number(block.lineStart)) ? Number(block.lineStart) : null;
  const lineEnd = Number.isFinite(Number(block.lineEnd)) ? Number(block.lineEnd) : null;
  if (lineStart === null || lineEnd === null) return String(block.plainText || block.value || '');
  return lines.slice(lineStart, lineEnd + 1).join('\n');
};

const buildRevisionSections = (revision = null) => {
  const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
  const headings = Array.isArray(revision?.headingIndex) ? revision.headingIndex : [];
  const headingMap = new Map(headings.map((item) => [item.headingId, item]));
  const sections = [];
  let current = {
    sectionKey: 'root',
    headingId: '',
    headingTitle: '前言',
    level: 0,
    order: 0,
    blocks: [],
    references: [],
    formulas: []
  };

  const pushCurrent = () => {
    const source = current.blocks.map((block) => buildBlockSource({ revision, block })).filter(Boolean).join('\n').trim();
    const plainText = current.blocks.map((block) => block.plainText || '').filter(Boolean).join('\n').trim();
    sections.push({
      ...current,
      source,
      plainText,
      referenceCount: current.references.length,
      formulaCount: current.formulas.length
    });
  };

  blocks.forEach((block) => {
    if (block?.type === 'heading') {
      if (current.blocks.length > 0 || sections.length === 0) pushCurrent();
      const headingMeta = headingMap.get(block.headingId) || {};
      current = {
        sectionKey: block.headingId || `section_${sections.length}`,
        headingId: block.headingId || '',
        headingTitle: headingMeta.title || block.plainText || '未命名小节',
        level: headingMeta.level || block.level || 1,
        order: sections.length,
        blocks: [block],
        references: [],
        formulas: []
      };
      return;
    }
    current.blocks.push(block);
  });
  if (current.blocks.length > 0 || sections.length === 0) pushCurrent();

  const references = Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : [];
  const formulas = Array.isArray(revision?.formulaRefs) ? revision.formulaRefs : [];
  sections.forEach((section) => {
    section.references = references.filter((item) => (item.headingId || '') === section.headingId);
    section.formulas = formulas.filter((item) => (item.headingId || '') === section.headingId);
  });

  return sections;
};

const summarizeReferences = (references = []) => {
  const rows = new Map();
  (Array.isArray(references) ? references : []).forEach((item) => {
    const key = `${getIdString(item.targetNodeId)}:${String(item.targetSenseId || '').trim()}`;
    const row = rows.get(key) || {
      key,
      targetNodeId: getIdString(item.targetNodeId),
      targetSenseId: String(item.targetSenseId || '').trim(),
      displayTexts: new Set(),
      count: 0,
      referenceIds: []
    };
    row.count += 1;
    row.referenceIds.push(item.referenceId || '');
    if (item.displayText) row.displayTexts.add(item.displayText);
    rows.set(key, row);
  });
  return Array.from(rows.values()).map((item) => ({
    ...item,
    displayTexts: Array.from(item.displayTexts)
  }));
};

const diffReferences = ({ fromReferences = [], toReferences = [] }) => {
  const fromRows = summarizeReferences(fromReferences);
  const toRows = summarizeReferences(toReferences);
  const fromMap = new Map(fromRows.map((item) => [item.key, item]));
  const toMap = new Map(toRows.map((item) => [item.key, item]));
  const added = [];
  const removed = [];
  const modified = [];

  toRows.forEach((item) => {
    const previous = fromMap.get(item.key);
    if (!previous) {
      added.push(item);
      return;
    }
    const leftLabels = previous.displayTexts.join('|');
    const rightLabels = item.displayTexts.join('|');
    if (leftLabels !== rightLabels || previous.count !== item.count) {
      modified.push({ from: previous, to: item });
    }
  });
  fromRows.forEach((item) => {
    if (!toMap.has(item.key)) removed.push(item);
  });

  return {
    added,
    removed,
    modified,
    totalChanged: added.length + removed.length + modified.length
  };
};

const diffFormulas = ({ fromFormulas = [], toFormulas = [] }) => {
  const fromValues = new Set((Array.isArray(fromFormulas) ? fromFormulas : []).map((item) => String(item.formula || '').trim()).filter(Boolean));
  const toValues = new Set((Array.isArray(toFormulas) ? toFormulas : []).map((item) => String(item.formula || '').trim()).filter(Boolean));
  const added = Array.from(toValues).filter((item) => !fromValues.has(item));
  const removed = Array.from(fromValues).filter((item) => !toValues.has(item));
  return {
    added,
    removed,
    changed: added.length > 0 || removed.length > 0
  };
};

const buildSectionChange = ({ fromSection = null, toSection = null }) => {
  const lineDiff = buildLineDiff(fromSection?.source || '', toSection?.source || '');
  const referenceChanges = diffReferences({ fromReferences: fromSection?.references || [], toReferences: toSection?.references || [] });
  const formulaChanges = diffFormulas({ fromFormulas: fromSection?.formulas || [], toFormulas: toSection?.formulas || [] });
  const changeTypes = [];

  if (!fromSection && toSection) {
    changeTypes.push('heading_added', 'section_added');
  } else if (fromSection && !toSection) {
    changeTypes.push('heading_removed', 'section_removed');
  } else {
    if ((fromSection?.headingTitle || '') !== (toSection?.headingTitle || '')) changeTypes.push('heading_renamed');
    if (lineDiff.stats.changed > 0) changeTypes.push('section_modified');
    if (referenceChanges.totalChanged > 0) changeTypes.push('references_changed');
    if (formulaChanges.changed) changeTypes.push('formulas_changed');
  }

  return {
    sectionKey: fromSection?.sectionKey || toSection?.sectionKey || `section_${Math.random().toString(36).slice(2, 8)}`,
    headingId: toSection?.headingId || fromSection?.headingId || '',
    headingTitle: toSection?.headingTitle || fromSection?.headingTitle || '前言',
    level: toSection?.level || fromSection?.level || 0,
    from: fromSection ? {
      headingId: fromSection.headingId,
      headingTitle: fromSection.headingTitle,
      source: fromSection.source,
      plainText: fromSection.plainText,
      referenceCount: fromSection.referenceCount,
      formulaCount: fromSection.formulaCount
    } : null,
    to: toSection ? {
      headingId: toSection.headingId,
      headingTitle: toSection.headingTitle,
      source: toSection.source,
      plainText: toSection.plainText,
      referenceCount: toSection.referenceCount,
      formulaCount: toSection.formulaCount
    } : null,
    hasChanges: changeTypes.length > 0,
    changeTypes,
    lineDiff,
    referenceChanges,
    formulaChanges,
    preview: {
      fromSnippet: String(fromSection?.plainText || '').slice(0, 160),
      toSnippet: String(toSection?.plainText || '').slice(0, 160)
    }
  };
};

const pairUnmatchedSections = ({ fromSections = [], toSections = [] }) => {
  const matchedTo = new Set();
  return fromSections.map((fromSection, index) => {
    let matchedIndex = -1;
    let bestScore = 0;
    toSections.forEach((toSection, toIndex) => {
      if (matchedTo.has(toIndex)) return;
      const score = computeSimilarity(fromSection.plainText || fromSection.headingTitle, toSection.plainText || toSection.headingTitle);
      const orderPenalty = Math.abs((fromSection.order || index) - (toSection.order || toIndex)) * 0.05;
      const finalScore = score - orderPenalty;
      if (finalScore > bestScore) {
        bestScore = finalScore;
        matchedIndex = toIndex;
      }
    });
    if (matchedIndex >= 0 && bestScore >= 0.25) {
      matchedTo.add(matchedIndex);
      return [fromSection, toSections[matchedIndex]];
    }
    return [fromSection, null];
  }).concat(
    toSections.map((toSection, toIndex) => (matchedTo.has(toIndex) ? null : [null, toSection])).filter(Boolean)
  );
};

const buildStructuredDiff = ({ fromRevision = null, toRevision = null }) => {
  const fromSections = buildRevisionSections(fromRevision);
  const toSections = buildRevisionSections(toRevision);
  const fromMap = new Map(fromSections.map((item) => [item.sectionKey, item]));
  const toMap = new Map(toSections.map((item) => [item.sectionKey, item]));
  const exactPairs = [];
  const unmatchedFrom = [];
  const unmatchedTo = [];

  fromSections.forEach((section) => {
    if (toMap.has(section.sectionKey)) {
      exactPairs.push([section, toMap.get(section.sectionKey)]);
      toMap.delete(section.sectionKey);
    } else {
      unmatchedFrom.push(section);
    }
    fromMap.delete(section.sectionKey);
  });
  unmatchedTo.push(...Array.from(toMap.values()));

  const comparedSections = exactPairs
    .concat(pairUnmatchedSections({ fromSections: unmatchedFrom, toSections: unmatchedTo }))
    .map(([fromSection, toSection]) => buildSectionChange({ fromSection, toSection }))
    .sort((left, right) => (left.to?.headingId || left.from?.headingId || left.sectionKey).localeCompare(right.to?.headingId || right.from?.headingId || right.sectionKey, 'zh-CN'));

  const summary = comparedSections.reduce((acc, section) => {
    if (!section.hasChanges) return acc;
    if (section.changeTypes.includes('section_added')) acc.sectionAdded += 1;
    if (section.changeTypes.includes('section_removed')) acc.sectionRemoved += 1;
    if (section.changeTypes.includes('section_modified')) acc.sectionModified += 1;
    if (section.changeTypes.includes('heading_added')) acc.headingAdded += 1;
    if (section.changeTypes.includes('heading_removed')) acc.headingRemoved += 1;
    if (section.changeTypes.includes('heading_renamed')) acc.headingRenamed += 1;
    acc.referenceAdded += section.referenceChanges.added.length;
    acc.referenceRemoved += section.referenceChanges.removed.length;
    acc.referenceModified += section.referenceChanges.modified.length;
    if (section.formulaChanges.changed) acc.formulaChangedSections += 1;
    return acc;
  }, {
    sectionAdded: 0,
    sectionRemoved: 0,
    sectionModified: 0,
    headingAdded: 0,
    headingRemoved: 0,
    headingRenamed: 0,
    referenceAdded: 0,
    referenceRemoved: 0,
    referenceModified: 0,
    formulaChangedSections: 0
  });

  const lineDiff = buildLineDiff(fromRevision?.editorSource || '', toRevision?.editorSource || '');
  return {
    schemaVersion: 1,
    fromRevisionId: getIdString(fromRevision?._id),
    toRevisionId: getIdString(toRevision?._id),
    summary,
    sections: comparedSections,
    lineDiff,
    changes: lineDiff.changes,
    stats: lineDiff.stats
  };
};

module.exports = {
  buildLineDiff,
  buildStructuredDiff,
  buildRevisionSections,
  diffFormulas,
  diffReferences
};
