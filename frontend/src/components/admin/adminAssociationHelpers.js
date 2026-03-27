import { ASSOC_RELATION_TYPES } from '../shared/associationFlowShared';

export const REL_SYMBOL_SUPERSET = '⊇';
export const REL_SYMBOL_SUBSET = '⊆';

export const createLocalId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const buildSenseKey = (nodeId = '', senseId = '') => {
    const safeNodeId = String(nodeId || '').trim();
    const safeSenseId = String(senseId || '').trim();
    if (!safeNodeId || !safeSenseId) return '';
    return `${safeNodeId}:${safeSenseId}`;
};

export const createNormalizedSenseSearchTarget = (item = {}) => ({
    nodeId: item?.nodeId || item?._id || '',
    senseId: typeof item?.senseId === 'string' ? item.senseId : '',
    displayName: item?.displayName || item?.name || '',
    domainName: item?.domainName || item?.name || '',
    senseTitle: item?.senseTitle || item?.activeSenseTitle || '',
    description: item?.senseContent || item?.description || '',
    searchKey: item?.searchKey || buildSenseKey(item?.nodeId || item?._id || '', item?.senseId || ''),
    relationToAnchor: item?.relationToAnchor || ''
});

export const matchKeywordByDomainAndSense = (item = {}, textKeyword = '') => {
    const normalized = String(textKeyword || '').trim().toLowerCase();
    if (!normalized) return true;
    const keywords = normalized.split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return true;
    const haystack = `${item?.displayName || ''} ${item?.domainName || ''} ${item?.senseTitle || ''}`.toLowerCase();
    return keywords.every((keyword) => haystack.includes(keyword));
};

export const normalizeNodeSenses = (node) => {
    const source = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
    const deduped = [];
    const seen = new Set();
    source.forEach((item, index) => {
        const senseId = (typeof item?.senseId === 'string' && item.senseId.trim()) ? item.senseId.trim() : `sense_${index + 1}`;
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const content = typeof item?.content === 'string' ? item.content.trim() : '';
        if (!senseId || !title || seen.has(senseId)) return;
        seen.add(senseId);
        deduped.push({ senseId, title, content });
    });
    if (deduped.length > 0) return deduped;
    return [{
        senseId: 'sense_1',
        title: '基础释义',
        content: typeof node?.description === 'string' ? node.description : ''
    }];
};

export const getBackendRelationSymbol = (relationType) => {
    if (relationType === ASSOC_RELATION_TYPES.CONTAINS) return REL_SYMBOL_SUPERSET;
    if (relationType === ASSOC_RELATION_TYPES.EXTENDS) return REL_SYMBOL_SUBSET;
    return '↔';
};

export const getUiRelationSymbol = (uiRelationType) => {
    if (uiRelationType === ASSOC_RELATION_TYPES.EXTENDS) return REL_SYMBOL_SUPERSET;
    if (uiRelationType === ASSOC_RELATION_TYPES.CONTAINS) return REL_SYMBOL_SUBSET;
    return '↔';
};

export const formatBackendRelationExpression = (sourceDisplay, relationType, targetDisplay) => (
    `${sourceDisplay} ${getBackendRelationSymbol(relationType)} ${targetDisplay}`
);

export const formatUiRelationExpression = (sourceDisplay, uiRelationType, targetDisplay) => (
    `${sourceDisplay} ${getUiRelationSymbol(uiRelationType)} ${targetDisplay}`
);

export const resolveAssociationDisplayType = (association) => association?.type || '';

export const getSenseTitleById = (node, senseId) => {
    const key = typeof senseId === 'string' ? senseId.trim() : '';
    if (!key) return '';
    const matched = normalizeNodeSenses(node).find((sense) => sense.senseId === key);
    return matched?.title || key;
};

export const resolveNodeSenseId = (nodeLike, fallbackSenseId = '') => {
    const preferred = typeof fallbackSenseId === 'string' ? fallbackSenseId.trim() : '';
    const sourceList = normalizeNodeSenses(nodeLike);
    if (preferred && sourceList.some((item) => item.senseId === preferred)) {
        return preferred;
    }
    const directSenseId = (typeof nodeLike?.senseId === 'string' ? nodeLike.senseId.trim() : '')
        || (typeof nodeLike?.activeSenseId === 'string' ? nodeLike.activeSenseId.trim() : '');
    if (directSenseId && sourceList.some((item) => item.senseId === directSenseId)) {
        return directSenseId;
    }
    return sourceList[0]?.senseId || '';
};

export const formatNodeSenseDisplay = (nodeLike, senseId = '') => {
    const nodeName = nodeLike?.name || '未知节点';
    const senseTitle = getSenseTitleById(nodeLike, senseId);
    return senseTitle ? `${nodeName}-${senseTitle}` : nodeName;
};

export const resolveAssociationNodeId = (nodeLike) => (
    String(nodeLike?._id || nodeLike?.nodeId || '').trim()
);

export const resolveAssociationSenseId = (nodeLike, fallbackSenseId = '') => {
    const fallback = String(fallbackSenseId || '').trim();
    if (fallback) return fallback;
    const directSenseId = String(nodeLike?.senseId || nodeLike?.activeSenseId || '').trim();
    if (directSenseId) return directSenseId;
    return resolveNodeSenseId(nodeLike, '');
};

export const toBridgeDecisionPayload = (decisionMap = {}) => (
    Object.entries(decisionMap || {})
        .map(([pairKey, action]) => ({ pairKey, action }))
        .filter((item) => item.pairKey && (item.action === 'reconnect' || item.action === 'disconnect'))
);

export const resolveDeleteBridgePairMode = (pair, beforeRelations = []) => {
    const sourceSenseId = String(pair?.sourceSenseId || '').trim();
    const upperNodeId = String(pair?.upper?.nodeId || '').trim();
    const upperSenseId = String(pair?.upper?.senseId || '').trim();
    const lowerNodeId = String(pair?.lower?.nodeId || '').trim();
    const lowerSenseId = String(pair?.lower?.senseId || '').trim();
    const relationList = Array.isArray(beforeRelations) ? beforeRelations : [];
    const hasUpper = relationList.some((line) => (
        String(line?.source?.senseId || '').trim() === sourceSenseId
        && String(line?.target?.nodeId || '').trim() === upperNodeId
        && String(line?.target?.senseId || '').trim() === upperSenseId
        && line?.relationType === ASSOC_RELATION_TYPES.EXTENDS
    ));
    const hasLower = relationList.some((line) => (
        String(line?.source?.senseId || '').trim() === sourceSenseId
        && String(line?.target?.nodeId || '').trim() === lowerNodeId
        && String(line?.target?.senseId || '').trim() === lowerSenseId
        && line?.relationType === ASSOC_RELATION_TYPES.CONTAINS
    ));
    if (hasUpper && hasLower) return ASSOC_RELATION_TYPES.INSERT;
    if (hasUpper) return ASSOC_RELATION_TYPES.EXTENDS;
    if (hasLower) return ASSOC_RELATION_TYPES.CONTAINS;
    return ASSOC_RELATION_TYPES.INSERT;
};

export const formatRelationArrowText = (relationType) => (
    relationType === ASSOC_RELATION_TYPES.CONTAINS
        ? REL_SYMBOL_SUPERSET
        : (relationType === ASSOC_RELATION_TYPES.EXTENDS ? REL_SYMBOL_SUBSET : '↔')
);
