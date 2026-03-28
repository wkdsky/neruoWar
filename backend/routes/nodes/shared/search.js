module.exports = ({
  Node,
  NodeSense,
  getIdString,
  isValidObjectId,
  normalizeNodeSenseList,
  hydrateNodeSensesForNodes,
  isNodeSenseCollectionReadEnabled
}) => {
  const buildNodeSenseDisplayName = (nodeName = '', senseTitle = '') => {
    const safeName = typeof nodeName === 'string' ? nodeName.trim() : '';
    const safeTitle = typeof senseTitle === 'string' ? senseTitle.trim() : '';
    return safeTitle ? `${safeName}-${safeTitle}` : safeName;
  };

  const normalizeRecentVisitMode = (value) => (
    value === 'sense' ? 'sense' : 'title'
  );

  const allocateNextSenseId = (senseList = []) => {
    const used = new Set((Array.isArray(senseList) ? senseList : []).map((item) => String(item?.senseId || '').trim()).filter(Boolean));
    let maxNumeric = 0;
    used.forEach((id) => {
      const matched = /^sense_(\d+)$/.exec(id);
      if (!matched) return;
      const value = Number.parseInt(matched[1], 10);
      if (Number.isInteger(value) && value > maxNumeric) maxNumeric = value;
    });

    let next = maxNumeric + 1;
    while (used.has(`sense_${next}`)) {
      next += 1;
    }
    return `sense_${next}`;
  };

  const buildNodeSenseSearchEntries = (node = {}, keywords = []) => {
    const normalizedKeywords = (Array.isArray(keywords) ? keywords : [])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
    const senses = normalizeNodeSenseList(node);
    const baseName = typeof node?.name === 'string' ? node.name : '';
    const nodeId = getIdString(node?._id);
    return senses
      .map((sense) => {
        const displayName = buildNodeSenseDisplayName(baseName, sense.title);
        const searchText = `${baseName} ${sense.title}`.toLowerCase();
        let matchCount = 0;
        normalizedKeywords.forEach((keyword) => {
          if (searchText.includes(keyword)) matchCount += 1;
        });
        return {
          _id: nodeId,
          nodeId,
          searchKey: `${nodeId}:${sense.senseId}`,
          name: displayName,
          displayName,
          domainName: baseName,
          description: sense.content || node?.description || '',
          senseId: sense.senseId,
          senseTitle: sense.title,
          senseContent: sense.content || '',
          knowledgePoint: node?.knowledgePoint,
          contentScore: node?.contentScore,
          matchCount
        };
      })
      .filter((item) => normalizedKeywords.length === 0 || item.matchCount > 0);
  };

  const splitSearchKeywords = (value = '') => (
    String(value || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  );

  const getSearchTextLength = (value = '') => Array.from(String(value || '').trim()).length;

  const compareSearchCoverageScore = (left = {}, right = {}) => (
    Number(right?.ratio || 0) - Number(left?.ratio || 0)
    || Number(right?.exactMatch || 0) - Number(left?.exactMatch || 0)
    || Number(right?.matchedKeywordCount || 0) - Number(left?.matchedKeywordCount || 0)
    || Number(right?.prefixMatch || 0) - Number(left?.prefixMatch || 0)
    || Number(right?.fieldPriority || 0) - Number(left?.fieldPriority || 0)
    || Number(left?.textLength || Number.MAX_SAFE_INTEGER) - Number(right?.textLength || Number.MAX_SAFE_INTEGER)
    || Number(left?.candidateIndex || 0) - Number(right?.candidateIndex || 0)
  );

  const computeTextSearchCoverageScore = ({
    text = '',
    keywords = [],
    fullKeyword = '',
    fieldPriority = 0,
    candidateIndex = 0
  } = {}) => {
    const normalizedText = String(text || '').trim().toLowerCase();
    const textLength = getSearchTextLength(normalizedText);
    if (!normalizedText || textLength < 1) {
      return {
        ratio: 0,
        exactMatch: 0,
        prefixMatch: 0,
        matchedKeywordCount: 0,
        matchedCharLength: 0,
        fieldPriority,
        textLength,
        candidateIndex
      };
    }

    const uniqueKeywords = Array.from(new Set(
      (Array.isArray(keywords) ? keywords : [])
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    ));

    let matchedKeywordCount = 0;
    let matchedCharLength = 0;
    uniqueKeywords.forEach((keyword) => {
      if (!normalizedText.includes(keyword)) return;
      matchedKeywordCount += 1;
      matchedCharLength += getSearchTextLength(keyword);
    });

    const normalizedFullKeyword = String(fullKeyword || '').trim().toLowerCase();
    return {
      ratio: matchedCharLength > 0 ? Math.min(1, matchedCharLength / textLength) : 0,
      exactMatch: normalizedFullKeyword && normalizedText === normalizedFullKeyword ? 1 : 0,
      prefixMatch: normalizedFullKeyword && normalizedText.startsWith(normalizedFullKeyword) ? 1 : 0,
      matchedKeywordCount,
      matchedCharLength,
      fieldPriority,
      textLength,
      candidateIndex
    };
  };

  const computeAdminNodeSearchCoverageScore = (node = {}, keyword = '') => {
    const keywords = splitSearchKeywords(keyword);
    if (keywords.length < 1) {
      return {
        ratio: 0,
        exactMatch: 0,
        prefixMatch: 0,
        matchedKeywordCount: 0,
        matchedCharLength: 0,
        fieldPriority: 0,
        textLength: Number.MAX_SAFE_INTEGER,
        candidateIndex: Number.MAX_SAFE_INTEGER
      };
    }

    const senses = normalizeNodeSenseList(node);
    const candidateTexts = [
      { text: node?.name || '', fieldPriority: 4 },
      ...senses.map((sense) => ({ text: sense?.title || '', fieldPriority: 3 })),
      { text: node?.description || '', fieldPriority: 2 },
      ...senses.map((sense) => ({ text: sense?.content || '', fieldPriority: 1 }))
    ];

    let bestScore = null;
    candidateTexts.forEach((candidate, index) => {
      const score = computeTextSearchCoverageScore({
        text: candidate.text,
        keywords,
        fullKeyword: keyword,
        fieldPriority: candidate.fieldPriority,
        candidateIndex: index
      });
      if (score.matchedKeywordCount < 1) return;
      if (!bestScore || compareSearchCoverageScore(score, bestScore) < 0) {
        bestScore = score;
      }
    });

    return bestScore || {
      ratio: 0,
      exactMatch: 0,
      prefixMatch: 0,
      matchedKeywordCount: 0,
      matchedCharLength: 0,
      fieldPriority: 0,
      textLength: Number.MAX_SAFE_INTEGER,
      candidateIndex: Number.MAX_SAFE_INTEGER
    };
  };

  const computePublicSearchEntryCoverageScore = (entry = {}, keyword = '') => {
    const keywords = splitSearchKeywords(keyword);
    if (keywords.length < 1) {
      return {
        ratio: 0,
        exactMatch: 0,
        prefixMatch: 0,
        matchedKeywordCount: 0,
        matchedCharLength: 0,
        fieldPriority: 0,
        textLength: Number.MAX_SAFE_INTEGER,
        candidateIndex: Number.MAX_SAFE_INTEGER
      };
    }

    const candidateTexts = [
      { text: entry?.domainName || entry?.name || '', fieldPriority: 4 },
      { text: entry?.senseTitle || '', fieldPriority: 3 },
      { text: entry?.displayName || entry?.name || '', fieldPriority: 3 },
      { text: entry?.description || '', fieldPriority: 2 },
      { text: entry?.senseContent || '', fieldPriority: 1 }
    ];

    let bestScore = null;
    candidateTexts.forEach((candidate, index) => {
      const score = computeTextSearchCoverageScore({
        text: candidate.text,
        keywords,
        fullKeyword: keyword,
        fieldPriority: candidate.fieldPriority,
        candidateIndex: index
      });
      if (score.matchedKeywordCount < 1) return;
      if (!bestScore || compareSearchCoverageScore(score, bestScore) < 0) {
        bestScore = score;
      }
    });

    return bestScore || {
      ratio: 0,
      exactMatch: 0,
      prefixMatch: 0,
      matchedKeywordCount: 0,
      matchedCharLength: 0,
      fieldPriority: 0,
      textLength: Number.MAX_SAFE_INTEGER,
      candidateIndex: Number.MAX_SAFE_INTEGER
    };
  };

  const buildNodeTitleCard = (node = {}) => {
    const source = node && typeof node.toObject === 'function' ? node.toObject() : node;
    const senses = normalizeNodeSenseList(source);
    const activeSense = senses[0] || null;
    return {
      ...source,
      synonymSenses: senses,
      activeSenseId: activeSense?.senseId || '',
      activeSenseTitle: activeSense?.title || '',
      activeSenseContent: activeSense?.content || '',
      displayName: typeof source?.name === 'string' ? source.name : ''
    };
  };

  const toSafeInteger = (value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const encodeNameCursor = ({ name = '', id = '' } = {}) => {
    const payload = JSON.stringify({ name: String(name || ''), id: String(id || '') });
    return Buffer.from(payload).toString('base64');
  };

  const decodeNameCursor = (cursor = '') => {
    if (typeof cursor !== 'string' || !cursor.trim()) {
      return { name: '', id: '' };
    }
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      const name = typeof parsed?.name === 'string' ? parsed.name : '';
      const id = typeof parsed?.id === 'string' ? parsed.id : '';
      return { name, id };
    } catch (error) {
      return { name: '', id: '' };
    }
  };

  const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const loadNodeSearchCandidates = async ({
    normalizedKeyword = '',
    limit = 800
  }) => {
    const safeKeyword = typeof normalizedKeyword === 'string' ? normalizedKeyword.trim() : '';
    if (!safeKeyword) return [];
    const safeLimit = Math.max(100, Math.min(3000, parseInt(limit, 10) || 800));
    const selectFields = '_id name description synonymSenses knowledgePoint contentScore';

    const merged = new Map();
    const pushDocs = (docs = []) => {
      for (const item of (Array.isArray(docs) ? docs : [])) {
        const itemId = getIdString(item?._id);
        if (!itemId || merged.has(itemId)) continue;
        merged.set(itemId, item);
        if (merged.size >= safeLimit) break;
      }
    };

    let textDocs = [];
    try {
      textDocs = await Node.find({
        status: 'approved',
        $text: { $search: safeKeyword }
      })
        .select(`${selectFields} score`)
        .sort({ score: { $meta: 'textScore' } })
        .limit(safeLimit)
        .lean();
    } catch (error) {
      textDocs = [];
    }
    pushDocs(textDocs);

    if (merged.size < safeLimit) {
      const keywordRegex = new RegExp(escapeRegex(safeKeyword), 'i');
      let regexDocs = await Node.find({
        status: 'approved',
        $or: [
          { name: keywordRegex },
          { 'synonymSenses.title': keywordRegex }
        ]
      })
        .select(selectFields)
        .limit(safeLimit - merged.size)
        .lean();

      if (isNodeSenseCollectionReadEnabled() && regexDocs.length < (safeLimit - merged.size)) {
        const extraNeed = safeLimit - merged.size - regexDocs.length;
        const senseRows = await NodeSense.find({
          status: 'active',
          $or: [
            { title: keywordRegex },
            { content: keywordRegex }
          ]
        })
          .select('nodeId')
          .limit(Math.max(extraNeed * 2, 200))
          .lean();

        const senseNodeIds = Array.from(new Set(
          senseRows
            .map((item) => getIdString(item?.nodeId))
            .filter((id) => isValidObjectId(id))
        ));
        if (senseNodeIds.length > 0) {
          const extraDocs = await Node.find({
            status: 'approved',
            _id: { $in: senseNodeIds.slice(0, extraNeed * 2) }
          })
            .select(selectFields)
            .limit(extraNeed)
            .lean();
          regexDocs = regexDocs.concat(extraDocs);
        }
      }
      pushDocs(regexDocs);
    }

    const rows = Array.from(merged.values());
    await hydrateNodeSensesForNodes(rows);
    return rows;
  };

  return {
    buildNodeSenseDisplayName,
    normalizeRecentVisitMode,
    allocateNextSenseId,
    buildNodeSenseSearchEntries,
    compareSearchCoverageScore,
    computeAdminNodeSearchCoverageScore,
    computePublicSearchEntryCoverageScore,
    buildNodeTitleCard,
    toSafeInteger,
    encodeNameCursor,
    decodeNameCursor,
    escapeRegex,
    loadNodeSearchCandidates
  };
};
