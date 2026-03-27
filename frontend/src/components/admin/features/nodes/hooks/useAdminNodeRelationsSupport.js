import { useCallback, useMemo, useRef } from 'react';
import {
    buildSenseKey,
    createNormalizedSenseSearchTarget as normalizeSenseSearchTarget,
    normalizeNodeSenses as baseNormalizeNodeSenses,
    formatBackendRelationExpression as baseFormatBackendRelationExpression,
    formatUiRelationExpression as baseFormatUiRelationExpression,
    resolveAssociationDisplayType as baseResolveAssociationDisplayType,
    getSenseTitleById as baseGetSenseTitleById,
    resolveNodeSenseId as baseResolveNodeSenseId,
    formatNodeSenseDisplay as baseFormatNodeSenseDisplay,
    resolveAssociationNodeId as baseResolveAssociationNodeId,
    resolveAssociationSenseId as baseResolveAssociationSenseId,
    toBridgeDecisionPayload as baseToBridgeDecisionPayload,
    resolveDeleteBridgePairMode as baseResolveDeleteBridgePairMode,
    formatRelationArrowText as baseFormatRelationArrowText
} from '../../../adminAssociationHelpers';
import { ASSOC_RELATION_TYPES } from '../../../../shared/associationFlowShared';
import { API_BASE } from '../../../../../runtimeConfig';

const useAdminNodeRelationsSupport = ({ allNodes }) => {
    const relationContextCacheRef = useRef(new Map());

    const normalizeNodeSenses = useCallback((node) => baseNormalizeNodeSenses(node), []);

    const formatBackendRelationExpression = useCallback((sourceDisplay, relationType, targetDisplay) => (
        baseFormatBackendRelationExpression(sourceDisplay, relationType, targetDisplay)
    ), []);

    const formatUiRelationExpression = useCallback((sourceDisplay, uiRelationType, targetDisplay) => (
        baseFormatUiRelationExpression(sourceDisplay, uiRelationType, targetDisplay)
    ), []);

    const resolveAssociationDisplayType = useCallback((association) => (
        baseResolveAssociationDisplayType(association)
    ), []);

    const getSenseTitleById = useCallback((node, senseId) => (
        baseGetSenseTitleById(node, senseId)
    ), []);

    const resolveNodeSenseId = useCallback((nodeLike, fallbackSenseId = '') => (
        baseResolveNodeSenseId(nodeLike, fallbackSenseId)
    ), []);

    const formatNodeSenseDisplay = useCallback((nodeLike, senseId = '') => (
        baseFormatNodeSenseDisplay(nodeLike, senseId)
    ), []);

    const resolveAssociationNodeId = useCallback((nodeLike) => (
        baseResolveAssociationNodeId(nodeLike)
    ), []);

    const resolveAssociationSenseId = useCallback((nodeLike, fallbackSenseId = '') => (
        baseResolveAssociationSenseId(nodeLike, fallbackSenseId)
    ), []);

    const toBridgeDecisionPayload = useCallback((decisionMap = {}) => (
        baseToBridgeDecisionPayload(decisionMap)
    ), []);

    const resolveDeleteBridgePairMode = useCallback((pair, beforeRelations = []) => (
        baseResolveDeleteBridgePairMode(pair, beforeRelations)
    ), []);

    const formatRelationArrowText = useCallback((relationType) => (
        baseFormatRelationArrowText(relationType)
    ), []);

    const normalizeAssociationCandidate = useCallback((target) => {
        const normalizedTarget = normalizeSenseSearchTarget(target);
        const nodeId = String(normalizedTarget.nodeId || target?._id || target?.nodeId || '').trim();
        const senseId = resolveAssociationSenseId(
            { ...target, ...normalizedTarget, _id: nodeId, nodeId },
            normalizedTarget.senseId || target?.senseId || target?.activeSenseId || ''
        );
        const searchKey = buildSenseKey(nodeId, senseId);
        if (!searchKey) return null;
        const domainName = normalizedTarget.domainName || target?.name || '';
        const senseTitle = normalizedTarget.senseTitle || target?.activeSenseTitle || '';
        const displayName = normalizedTarget.displayName || `${domainName}${senseTitle ? `-${senseTitle}` : ''}` || searchKey;
        return {
            ...target,
            ...normalizedTarget,
            _id: nodeId,
            nodeId,
            name: domainName || target?.name || '',
            domainName: domainName || target?.name || '',
            senseId,
            activeSenseId: senseId,
            searchKey,
            displayName
        };
    }, [resolveAssociationSenseId]);

    const fetchSenseRelationContext = useCallback(async (target) => {
        const nodeId = target?.nodeId || target?._id || '';
        const senseId = typeof target?.senseId === 'string' ? target.senseId.trim() : '';
        if (!nodeId || !senseId) {
            return {
                parentTargets: [],
                childTargets: [],
                parentKeySet: new Set(),
                childKeySet: new Set()
            };
        }
        const cacheKey = `${nodeId}:${senseId}`;
        if (relationContextCacheRef.current.has(cacheKey)) {
            return relationContextCacheRef.current.get(cacheKey);
        }

        const toEmpty = () => ({
            parentTargets: [],
            childTargets: [],
            parentKeySet: new Set(),
            childKeySet: new Set()
        });

        try {
            const response = await fetch(`${API_BASE}/nodes/public/node-detail/${nodeId}?senseId=${encodeURIComponent(senseId)}`);
            if (!response.ok) {
                const empty = toEmpty();
                relationContextCacheRef.current.set(cacheKey, empty);
                return empty;
            }
            const data = await response.json();
            const detailNode = data?.node || {};
            const activeSenseId = String(detailNode?.activeSenseId || senseId || '').trim();
            const sourceSenses = normalizeNodeSenses(detailNode);
            const canUseLooseSourceMatch = sourceSenses.length === 1;
            const getTargetNodeId = (targetNode) => {
                if (!targetNode) return '';
                if (typeof targetNode === 'string') return String(targetNode || '').trim();
                return String(targetNode?._id || targetNode?.nodeId || '').trim();
            };
            const normalizeNodeList = (list = []) => (
                (Array.isArray(list) ? list : [])
                    .map((item) => normalizeSenseSearchTarget({
                        _id: item?._id,
                        nodeId: item?._id,
                        senseId: item?.activeSenseId,
                        displayName: item?.displayName || `${item?.name || ''}${item?.activeSenseTitle ? `-${item.activeSenseTitle}` : ''}`,
                        name: item?.name || '',
                        domainName: item?.name || '',
                        senseTitle: item?.activeSenseTitle || '',
                        senseContent: item?.activeSenseContent || '',
                        description: item?.activeSenseContent || item?.description || ''
                    }))
                    .filter((item) => item.nodeId && item.senseId && item.searchKey)
            );

            const parentTargetsRaw = normalizeNodeList(detailNode?.parentNodesInfo || data?.parentNodes || []);
            const childTargetsRaw = normalizeNodeList(detailNode?.childNodesInfo || data?.childNodes || []);
            const parentTargetMap = new Map(parentTargetsRaw.map((item) => [item.searchKey, item]));
            const childTargetMap = new Map(childTargetsRaw.map((item) => [item.searchKey, item]));
            const parentKeySet = new Set();
            const childKeySet = new Set();
            const relationAssociations = (Array.isArray(detailNode?.associations) ? detailNode.associations : [])
                .filter((assoc) => (
                    assoc?.relationType === ASSOC_RELATION_TYPES.EXTENDS
                    || assoc?.relationType === ASSOC_RELATION_TYPES.CONTAINS
                ))
                .filter((assoc) => {
                    const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                    if (sourceSenseId) return sourceSenseId === activeSenseId;
                    return canUseLooseSourceMatch;
                });

            relationAssociations.forEach((assoc) => {
                const relationType = assoc?.relationType;
                const targetNodeId = getTargetNodeId(assoc?.targetNode);
                const targetSenseId = String(assoc?.targetSenseId || '').trim();
                if (!targetNodeId || !targetSenseId) return;
                const relationKey = `${targetNodeId}:${targetSenseId}`;
                const targetNode = (assoc?.targetNode && typeof assoc.targetNode === 'object') ? assoc.targetNode : null;
                if (targetNode) {
                    const normalizedTarget = normalizeSenseSearchTarget({
                        _id: targetNode?._id || targetNodeId,
                        nodeId: targetNode?._id || targetNodeId,
                        senseId: targetSenseId,
                        displayName: targetNode?.displayName || `${targetNode?.name || ''}${targetSenseId ? `-${targetSenseId}` : ''}`,
                        name: targetNode?.name || '',
                        domainName: targetNode?.name || '',
                        senseTitle: targetNode?.activeSenseTitle || '',
                        senseContent: targetNode?.activeSenseContent || '',
                        description: targetNode?.activeSenseContent || targetNode?.description || ''
                    });
                    if (normalizedTarget?.searchKey) {
                        parentTargetMap.set(normalizedTarget.searchKey, normalizedTarget);
                        childTargetMap.set(normalizedTarget.searchKey, normalizedTarget);
                    }
                }
                if (relationType === ASSOC_RELATION_TYPES.EXTENDS) {
                    parentKeySet.add(relationKey);
                } else if (relationType === ASSOC_RELATION_TYPES.CONTAINS) {
                    childKeySet.add(relationKey);
                }
            });

            const parentTargets = Array.from(parentKeySet)
                .map((key) => parentTargetMap.get(key))
                .filter(Boolean);
            const childTargets = Array.from(childKeySet)
                .map((key) => childTargetMap.get(key))
                .filter(Boolean);
            const contextData = {
                parentTargets,
                childTargets,
                parentKeySet,
                childKeySet
            };
            relationContextCacheRef.current.set(cacheKey, contextData);
            return contextData;
        } catch (error) {
            console.error('获取释义关系上下文失败:', error);
            const empty = toEmpty();
            relationContextCacheRef.current.set(cacheKey, empty);
            return empty;
        }
    }, [normalizeNodeSenses]);

    const nodeByIdMap = useMemo(() => {
        const map = new Map();
        allNodes.forEach((item) => {
            if (!item?._id) return;
            map.set(String(item._id), item);
        });
        return map;
    }, [allNodes]);

    const resolveDecisionRefDisplay = useCallback((ref = null) => {
        const explicitDisplayName = String(ref?.displayName || '').trim();
        if (explicitDisplayName) return explicitDisplayName;

        const refNodeId = String(ref?.nodeId || ref?._id || '').trim();
        const refSenseId = String(ref?.senseId || '').trim();
        const mappedNode = refNodeId ? nodeByIdMap.get(refNodeId) : null;
        if (mappedNode) {
            const mappedNodeName = String(mappedNode?.name || '').trim() || '未知标题';
            const mappedSenseId = refSenseId || resolveNodeSenseId(mappedNode, '');
            const mappedSenseTitle = getSenseTitleById(mappedNode, mappedSenseId);
            if (mappedSenseTitle) return `${mappedNodeName}-${mappedSenseTitle}`;
            if (mappedSenseId) return `${mappedNodeName}-${mappedSenseId}`;
            return `${mappedNodeName}-未知释义`;
        }

        const nodeName = String(ref?.nodeName || ref?.name || '').trim() || '未知标题';
        const senseTitle = String(ref?.senseTitle || '').trim();
        if (senseTitle) return `${nodeName}-${senseTitle}`;
        return `${nodeName}-${refSenseId || '未知释义'}`;
    }, [getSenseTitleById, nodeByIdMap, resolveNodeSenseId]);

    const resolveDecisionCurrentDisplay = useCallback((sourceNode, sourceSenseId = '', fallbackNodeName = '当前标题') => {
        const nodeName = String(sourceNode?.name || fallbackNodeName || '当前标题').trim() || '当前标题';
        const normalizedSenseId = String(sourceSenseId || '').trim();
        if (sourceNode) {
            const effectiveSenseId = normalizedSenseId || resolveNodeSenseId(sourceNode, '');
            const senseTitle = getSenseTitleById(sourceNode, effectiveSenseId);
            if (senseTitle) return `${nodeName}-${senseTitle}`;
            if (effectiveSenseId) return `${nodeName}-${effectiveSenseId}`;
        }
        return `${nodeName}-${normalizedSenseId || '未知释义'}`;
    }, [getSenseTitleById, resolveNodeSenseId]);

    const resolveDecisionPairSideDisplay = useCallback((pair = {}, side = 'upper') => {
        const normalizedSide = side === 'lower' ? 'lower' : 'upper';
        const embeddedRef = pair?.[normalizedSide];
        if (embeddedRef && typeof embeddedRef === 'object') {
            return resolveDecisionRefDisplay(embeddedRef);
        }
        const nodeId = String(pair?.[`${normalizedSide}NodeId`] || '').trim();
        const senseId = String(pair?.[`${normalizedSide}SenseId`] || '').trim();
        return resolveDecisionRefDisplay({ nodeId, senseId });
    }, [resolveDecisionRefDisplay]);

    const incomingAssociationMap = useMemo(() => {
        const map = new Map();
        allNodes.forEach((sourceNode) => {
            const sourceSenses = normalizeNodeSenses(sourceNode);
            const sourceSenseById = new Map(sourceSenses.map((sense) => [sense.senseId, sense]));
            const sourceAssociations = Array.isArray(sourceNode?.associations) ? sourceNode.associations : [];
            sourceAssociations.forEach((assoc) => {
                const targetId = assoc?.targetNode?._id || assoc?.targetNode;
                if (!targetId) return;
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
                const sourceSenseTitle = sourceSenseById.get(sourceSenseId)?.title || sourceSenseId || '';
                const sourceDisplayName = sourceSenseTitle ? `${sourceNode.name}-${sourceSenseTitle}` : sourceNode.name;
                const item = {
                    sourceNodeId: sourceNode._id,
                    sourceNodeName: sourceNode.name,
                    sourceSenseId,
                    sourceSenseTitle,
                    sourceDisplayName,
                    relationType: assoc?.relationType || ''
                };

                const primaryKey = `${targetId}:${targetSenseId}`;
                const fallbackKey = `${targetId}:`;
                if (!map.has(primaryKey)) map.set(primaryKey, []);
                map.get(primaryKey).push(item);
                if (targetSenseId && !map.has(fallbackKey)) {
                    map.set(fallbackKey, []);
                }
            });
        });
        return map;
    }, [allNodes, normalizeNodeSenses]);

    const resolveAssociationTargetDisplay = useCallback((assoc) => {
        const targetNodeRaw = assoc?.targetNode;
        const targetNode = (targetNodeRaw && typeof targetNodeRaw === 'object')
            ? targetNodeRaw
            : nodeByIdMap.get(String(targetNodeRaw || ''));
        if (!targetNode) return '未知释义';
        const targetNodeName = targetNode?.name || '未知节点';
        const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
        const targetSenseTitle = getSenseTitleById(targetNode, targetSenseId);
        return targetSenseTitle ? `${targetNodeName}-${targetSenseTitle}` : targetNodeName;
    }, [getSenseTitleById, nodeByIdMap]);

    const getNodeSenseAssociationSummary = useCallback((node, senseId) => {
        const localSenseId = typeof senseId === 'string' ? senseId.trim() : '';
        const currentDisplay = formatNodeSenseDisplay(node, localSenseId);
        const allAssociations = Array.isArray(node?.associations) ? node.associations : [];
        const outgoing = allAssociations
            .filter((assoc) => {
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                return sourceSenseId === localSenseId;
            })
            .map((assoc, index) => ({
                id: `out_${index}_${assoc?.targetNode?._id || assoc?.targetNode || 'unknown'}`,
                direction: 'outgoing',
                relationType: assoc?.relationType || '',
                displayText: formatBackendRelationExpression(
                    currentDisplay,
                    assoc?.relationType || '',
                    resolveAssociationTargetDisplay(assoc)
                )
            }));

        const incomingKey = `${node?._id}:${localSenseId}`;
        const incomingFallbackKey = `${node?._id}:`;
        const incoming = [
            ...(incomingAssociationMap.get(incomingKey) || []),
            ...(incomingAssociationMap.get(incomingFallbackKey) || [])
        ].map((item, index) => ({
            id: `in_${index}_${item.sourceNodeId || 'unknown'}_${item.sourceSenseId || 'sense'}`,
            direction: 'incoming',
            relationType: item.relationType,
            displayText: formatBackendRelationExpression(
                item.sourceDisplayName,
                item.relationType,
                currentDisplay
            )
        }));

        return {
            outgoing,
            incoming,
            all: [...outgoing, ...incoming]
        };
    }, [formatBackendRelationExpression, formatNodeSenseDisplay, incomingAssociationMap, resolveAssociationTargetDisplay]);

    const getEditableSenseAssociationCount = useCallback((node, senseId) => {
        const normalizedSenseId = String(senseId || '').trim();
        if (!node || !normalizedSenseId) return 0;

        const sourceAssociations = (Array.isArray(node?.associations) ? node.associations : [])
            .filter((assoc) => {
                const targetNodeId = String(assoc?.targetNode?._id || assoc?.targetNode || '').trim();
                const targetNodeName = String(assoc?.targetNode?.name || '').trim();
                const targetSenseId = String(assoc?.targetSenseId || '').trim();
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                const relationType = assoc?.relationType;
                const isSimpleRelation = (
                    relationType === ASSOC_RELATION_TYPES.CONTAINS
                    || relationType === ASSOC_RELATION_TYPES.EXTENDS
                );
                return (
                    sourceSenseId === normalizedSenseId
                    && !!targetNodeId
                    && !!targetNodeName
                    && !!targetSenseId
                    && isSimpleRelation
                );
            });

        if (sourceAssociations.length > 0) {
            return sourceAssociations.length;
        }

        const rawAssociations = Array.isArray(node?.associations) ? node.associations : [];
        if (rawAssociations.length > 0) return 0;

        const nodeNameMap = new Map((Array.isArray(allNodes) ? allNodes : [])
            .map((item) => [String(item?.name || '').trim(), item]));
        const fallbackParentCount = (Array.isArray(node?.relatedParentDomains) ? node.relatedParentDomains : [])
            .filter((name) => nodeNameMap.has(String(name || '').trim()))
            .length;
        const fallbackChildCount = (Array.isArray(node?.relatedChildDomains) ? node.relatedChildDomains : [])
            .filter((name) => nodeNameMap.has(String(name || '').trim()))
            .length;
        return fallbackParentCount + fallbackChildCount;
    }, [allNodes]);

    const buildNodeDeletePreview = useCallback((node) => {
        if (!node?._id) {
            return {
                senses: [],
                totalBeforeCount: 0,
                totalAfterCount: 0
            };
        }
        const senses = normalizeNodeSenses(node).map((sense) => {
            const summary = getNodeSenseAssociationSummary(node, sense.senseId);
            return {
                ...sense,
                beforeRelations: summary.all
            };
        });
        const totalBeforeCount = senses.reduce((sum, sense) => sum + (sense.beforeRelations?.length || 0), 0);
        return {
            senses,
            totalBeforeCount,
            totalAfterCount: 0
        };
    }, [getNodeSenseAssociationSummary, normalizeNodeSenses]);

    const hierarchicalNodeList = useMemo(() => (
        allNodes.map((node) => {
            const senses = normalizeNodeSenses(node).map((sense) => {
                const summary = getNodeSenseAssociationSummary(node, sense.senseId);
                return {
                    ...sense,
                    associationSummary: summary
                };
            });
            return {
                ...node,
                senses
            };
        })
    ), [allNodes, getNodeSenseAssociationSummary, normalizeNodeSenses]);

    return {
        normalizeNodeSenses,
        formatBackendRelationExpression,
        formatUiRelationExpression,
        resolveAssociationDisplayType,
        getSenseTitleById,
        resolveNodeSenseId,
        formatNodeSenseDisplay,
        resolveAssociationNodeId,
        resolveAssociationSenseId,
        toBridgeDecisionPayload,
        resolveDeleteBridgePairMode,
        formatRelationArrowText,
        normalizeAssociationCandidate,
        fetchSenseRelationContext,
        nodeByIdMap,
        resolveDecisionCurrentDisplay,
        resolveDecisionPairSideDisplay,
        resolveAssociationTargetDisplay,
        getNodeSenseAssociationSummary,
        getEditableSenseAssociationCount,
        buildNodeDeletePreview,
        hierarchicalNodeList
    };
};

export default useAdminNodeRelationsSupport;
