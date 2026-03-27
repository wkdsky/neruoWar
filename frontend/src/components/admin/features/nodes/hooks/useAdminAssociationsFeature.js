import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniPreviewRenderer from '../../../../modals/MiniPreviewRenderer';
import {
    ASSOC_RELATION_TYPES,
    ASSOC_STEPS,
    parseAssociationKeyword,
    resolveAssociationBackStep,
    resolveAssociationNextStep
} from '../../../../shared/associationFlowShared';
import {
    REL_SYMBOL_SUBSET,
    REL_SYMBOL_SUPERSET,
    buildSenseKey,
    createLocalId,
    matchKeywordByDomainAndSense
} from '../../../adminAssociationHelpers';
import { API_BASE } from '../../../../../runtimeConfig';
import useAdminAssociationDeleteDecisionFlow from './useAdminAssociationDeleteDecisionFlow';

const normalizeAssociationDraftList = (draftList = []) => (
    (Array.isArray(draftList) ? draftList : []).filter(Boolean)
);

const useAdminAssociationsFeature = ({
    allNodes,
    adminDomainPage,
    adminDomainSearchKeyword,
    fetchAllNodes,
    fetchSenseRelationContext,
    normalizeNodeSenses,
    normalizeAssociationCandidate,
    resolveAssociationDisplayType,
    resolveNodeSenseId,
    formatNodeSenseDisplay,
    resolveAssociationNodeId,
    resolveAssociationSenseId,
    toBridgeDecisionPayload,
    resolveDecisionCurrentDisplay,
    resolveDecisionPairSideDisplay,
    formatUiRelationExpression,
    nodeByIdMap
}) => {
    const [showEditAssociationModal, setShowEditAssociationModal] = useState(false);
    const [editingAssociationNode, setEditingAssociationNode] = useState(null);
    const [editAssociations, setEditAssociations] = useState([]);
    const [assocSearchKeyword, setAssocSearchKeyword] = useState('');
    const [assocSearchAppliedKeyword, setAssocSearchAppliedKeyword] = useState('');
    const [assocSearchResults, setAssocSearchResults] = useState([]);
    const [assocSearchLoading, setAssocSearchLoading] = useState(false);
    const [isEditAssociationListExpanded, setIsEditAssociationListExpanded] = useState(true);
    const [assocCurrentStep, setAssocCurrentStep] = useState(null);
    const [assocSelectedNodeA, setAssocSelectedNodeA] = useState(null);
    const [assocSelectedRelationType, setAssocSelectedRelationType] = useState(null);
    const [assocSelectedNodeB, setAssocSelectedNodeB] = useState(null);
    const [assocInsertDirection, setAssocInsertDirection] = useState(null);
    const [editingAssociationSenseId, setEditingAssociationSenseId] = useState('');
    const [assocSelectedSourceSenseId, setAssocSelectedSourceSenseId] = useState('');
    const [assocSelectedNodeASenseId, setAssocSelectedNodeASenseId] = useState('');
    const [assocSelectedNodeBSenseId, setAssocSelectedNodeBSenseId] = useState('');
    const [assocNodeBCandidates, setAssocNodeBCandidates] = useState({ parents: [], children: [] });
    const [assocNodeBSearchKeyword, setAssocNodeBSearchKeyword] = useState('');
    const [assocNodeBSearchAppliedKeyword, setAssocNodeBSearchAppliedKeyword] = useState('');
    const [assocEditingIndex, setAssocEditingIndex] = useState(null);
    const [assocApplyLoading, setAssocApplyLoading] = useState(false);
    const [assocBridgeDecisions, setAssocBridgeDecisions] = useState({});
    const assocEditRequestIdRef = useRef(0);
    const assocNodeBSearchRequestIdRef = useRef(0);
    const assocNodeBCandidateRequestIdRef = useRef(0);
    const assocPreviewCanvasRef = useRef(null);
    const assocPreviewRendererRef = useRef(null);

    const toAssociationSenseKey = useCallback((nodeLike, fallbackSenseId = '') => {
        const nodeId = resolveAssociationNodeId(nodeLike);
        const senseId = resolveAssociationSenseId(nodeLike, fallbackSenseId);
        return buildSenseKey(nodeId, senseId);
    }, [resolveAssociationNodeId, resolveAssociationSenseId]);

    const assocAllowedEditingSenseKeySet = useMemo(() => {
        const set = new Set();
        if (assocEditingIndex === null) return set;
        const current = Array.isArray(editAssociations) ? editAssociations[assocEditingIndex] : null;
        if (!current) return set;
        const append = (nodeLike, senseId = '') => {
            const key = toAssociationSenseKey(nodeLike, senseId);
            if (key) set.add(key);
        };
        append(current?.nodeA, current?.nodeASenseId || current?.targetSenseId || '');
        append(current?.nodeB, current?.nodeBSenseId || '');
        (Array.isArray(current?.actualAssociations) ? current.actualAssociations : []).forEach((actual) => {
            append(actual?.targetNode && typeof actual.targetNode === 'object'
                ? actual.targetNode
                : { _id: actual?.targetNode }, actual?.targetSenseId || '');
        });
        return set;
    }, [assocEditingIndex, editAssociations, toAssociationSenseKey]);

    const assocBlockedSenseKeySet = useMemo(() => {
        const set = new Set();
        const append = (nodeLike, senseId = '') => {
            const key = toAssociationSenseKey(nodeLike, senseId);
            if (key) set.add(key);
        };

        (Array.isArray(editAssociations) ? editAssociations : []).forEach((assoc, index) => {
            if (assocEditingIndex !== null && index === assocEditingIndex) return;
            append(assoc?.nodeA, assoc?.nodeASenseId || assoc?.targetSenseId || '');
            append(assoc?.nodeB, assoc?.nodeBSenseId || '');
            (Array.isArray(assoc?.actualAssociations) ? assoc.actualAssociations : []).forEach((actual) => {
                append(actual?.targetNode && typeof actual.targetNode === 'object'
                    ? actual.targetNode
                    : { _id: actual?.targetNode }, actual?.targetSenseId || '');
            });
        });

        if (set.size === 0 && Array.isArray(editingAssociationNode?.associations)) {
            const sourceSenseId = resolveAssociationSenseId(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId || '');
            editingAssociationNode.associations.forEach((assoc) => {
                const assocSourceSenseId = String(assoc?.sourceSenseId || '').trim();
                if (sourceSenseId && assocSourceSenseId && assocSourceSenseId !== sourceSenseId) return;
                append(assoc?.targetNode && typeof assoc.targetNode === 'object'
                    ? assoc.targetNode
                    : { _id: assoc?.targetNode }, assoc?.targetSenseId || '');
            });
        }
        return set;
    }, [
        assocEditingIndex,
        assocSelectedSourceSenseId,
        editAssociations,
        editingAssociationNode,
        editingAssociationSenseId,
        resolveAssociationSenseId,
        toAssociationSenseKey
    ]);

    const isAssociationCandidateSelectable = useCallback((nodeLike, fallbackSenseId = '', options = {}) => {
        const excludedSenseKeySet = options?.excludedSenseKeySet instanceof Set ? options.excludedSenseKeySet : new Set();
        const excludedNodeIdSet = options?.excludedNodeIdSet instanceof Set ? options.excludedNodeIdSet : new Set();
        const candidateNodeId = resolveAssociationNodeId(nodeLike);
        if (!candidateNodeId) return false;
        if (candidateNodeId === String(editingAssociationNode?._id || '')) return false;
        if (excludedNodeIdSet.has(candidateNodeId)) return false;
        const candidateKey = toAssociationSenseKey(nodeLike, fallbackSenseId);
        if (!candidateKey) return false;
        if (excludedSenseKeySet.has(candidateKey)) return false;
        if (assocBlockedSenseKeySet.has(candidateKey) && !assocAllowedEditingSenseKeySet.has(candidateKey)) return false;
        return true;
    }, [
        assocAllowedEditingSenseKeySet,
        assocBlockedSenseKeySet,
        editingAssociationNode,
        resolveAssociationNodeId,
        toAssociationSenseKey
    ]);

    const loadAssocNodeBCandidatesBySense = useCallback(async (nodeA = assocSelectedNodeA, sourceSenseId = assocSelectedNodeASenseId) => {
        const nodeId = String(nodeA?._id || nodeA?.nodeId || '').trim();
        const normalizedSenseId = String(sourceSenseId || '').trim();
        if (!nodeId || !normalizedSenseId) {
            setAssocNodeBCandidates({ parents: [], children: [] });
            return;
        }
        const requestId = ++assocNodeBCandidateRequestIdRef.current;
        const context = await fetchSenseRelationContext({ _id: nodeId, nodeId, senseId: normalizedSenseId });
        if (requestId !== assocNodeBCandidateRequestIdRef.current) return;
        const selectedNodeAKey = toAssociationSenseKey(nodeA, normalizedSenseId);
        const excludedSenseKeySet = new Set([selectedNodeAKey].filter(Boolean));
        const normalizeCandidates = (list = []) => {
            const seen = new Set();
            return (Array.isArray(list) ? list : [])
                .map((item) => normalizeAssociationCandidate(item))
                .filter(Boolean)
                .filter((item) => {
                    if (seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                })
                .filter((item) => isAssociationCandidateSelectable(item, item?.senseId || '', { excludedSenseKeySet }));
        };
        setAssocNodeBCandidates({
            parents: normalizeCandidates(context?.parentTargets || []),
            children: normalizeCandidates(context?.childTargets || [])
        });
    }, [
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        fetchSenseRelationContext,
        toAssociationSenseKey,
        normalizeAssociationCandidate,
        isAssociationCandidateSelectable
    ]);

    const {
        showAssocDeleteDecisionModal,
        assocDeleteDecisionContext,
        assocDeleteDecisionAction,
        assocDeleteSearchKeyword,
        assocDeleteSearchAppliedKeyword,
        assocDeleteSearchResults,
        assocDeleteSearchLoading,
        assocDeleteSelectedTarget,
        assocDeleteApplying,
        shouldShowAssocDeleteSearch,
        assocDeleteReplacementDisplay,
        setAssocDeleteDecisionAction,
        setAssocDeleteSearchKeyword,
        setAssocDeleteSelectedTarget,
        clearAssocDeleteSearch,
        resetAssocDeleteDecisionFlow,
        closeAssocDeleteDecisionModal,
        searchAssocDeleteTargets,
        stageAssociationRemovalByDecision,
        confirmAssocDeleteDecision,
        openAssocDeleteDecisionModal
    } = useAdminAssociationDeleteDecisionFlow({
        editingAssociationNode,
        editingAssociationSenseId,
        editAssociations,
        setEditAssociations,
        assocBridgeDecisions,
        setAssocBridgeDecisions,
        normalizeAssociationCandidate,
        toAssociationSenseKey,
        resolveNodeSenseId,
        resolveAssociationSenseId,
        formatNodeSenseDisplay,
        resolveDecisionCurrentDisplay,
        resolveDecisionPairSideDisplay
    });

    const toBackendRelationType = useCallback((uiRelationType) => (
        uiRelationType === ASSOC_RELATION_TYPES.EXTENDS
            ? ASSOC_RELATION_TYPES.CONTAINS
            : ASSOC_RELATION_TYPES.EXTENDS
    ), []);

    const resetAssociationEditor = useCallback(() => {
        assocNodeBCandidateRequestIdRef.current += 1;
        setAssocCurrentStep(null);
        setAssocSelectedNodeA(null);
        setAssocSelectedRelationType(null);
        setAssocSelectedNodeB(null);
        setAssocInsertDirection(null);
        setAssocSelectedSourceSenseId('');
        setAssocSelectedNodeASenseId('');
        setAssocSelectedNodeBSenseId('');
        setAssocNodeBCandidates({ parents: [], children: [] });
        setAssocNodeBSearchKeyword('');
        setAssocEditingIndex(null);
        setAssocSearchKeyword('');
        setAssocSearchAppliedKeyword('');
        setAssocSearchResults([]);
        setAssocSearchLoading(false);
        setAssocNodeBSearchAppliedKeyword('');

        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.destroy();
            assocPreviewRendererRef.current = null;
        }
    }, []);

    const closeEditAssociationModal = useCallback(() => {
        setShowEditAssociationModal(false);
        setEditingAssociationNode(null);
        setEditingAssociationSenseId('');
        setEditAssociations([]);
        setAssocApplyLoading(false);
        setAssocBridgeDecisions({});
        resetAssocDeleteDecisionFlow();
        resetAssociationEditor();
    }, [resetAssocDeleteDecisionFlow, resetAssociationEditor]);

    useEffect(() => {
        if (assocCurrentStep === ASSOC_STEPS.PREVIEW && assocPreviewCanvasRef.current) {
            const canvas = assocPreviewCanvasRef.current;
            const shouldRecreateRenderer = (
                !assocPreviewRendererRef.current
                || assocPreviewRendererRef.current.canvas !== canvas
            );
            if (shouldRecreateRenderer) {
                if (assocPreviewRendererRef.current) {
                    assocPreviewRendererRef.current.destroy();
                }
                assocPreviewRendererRef.current = new MiniPreviewRenderer(canvas);
            }

            assocPreviewRendererRef.current.setPreviewScene({
                nodeA: assocSelectedNodeA,
                nodeB: assocSelectedNodeB,
                relationType: assocSelectedRelationType,
                newNodeName: editingAssociationNode?.name || '当前节点',
                insertDirection: assocInsertDirection,
                nodeALabel: formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId),
                nodeBLabel: formatNodeSenseDisplay(assocSelectedNodeB, assocSelectedNodeBSenseId),
                newNodeLabel: formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId),
                showPendingTag: false
            });
        }

        return () => {
            if (assocCurrentStep !== ASSOC_STEPS.PREVIEW && assocPreviewRendererRef.current) {
                assocPreviewRendererRef.current.destroy();
                assocPreviewRendererRef.current = null;
            }
        };
    }, [
        assocCurrentStep,
        assocSelectedNodeA,
        assocSelectedNodeB,
        assocSelectedRelationType,
        assocInsertDirection,
        assocSelectedNodeASenseId,
        assocSelectedNodeBSenseId,
        assocSelectedSourceSenseId,
        assocEditingIndex,
        formatNodeSenseDisplay,
        editingAssociationNode
    ]);

    useEffect(() => () => {
        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.destroy();
            assocPreviewRendererRef.current = null;
        }
    }, []);

    const fetchNodeDetailForAssociation = useCallback(async (nodeId) => {
        try {
            const response = await fetch(`${API_BASE}/nodes/public/node-detail/${nodeId}`);
            if (response.ok) {
                const data = await response.json();
                return data.node;
            }
        } catch (error) {
            console.error('获取节点详情失败:', error);
        }
        return null;
    }, []);

    const buildSimpleAssociation = useCallback(({
        currentNode,
        sourceSenseId,
        targetNode,
        targetNodeId,
        targetNodeName,
        targetSenseId,
        backendRelationType,
        isNewDraft = false
    }) => {
        const uiRelationType = backendRelationType === ASSOC_RELATION_TYPES.CONTAINS
            ? ASSOC_RELATION_TYPES.EXTENDS
            : ASSOC_RELATION_TYPES.CONTAINS;
        const sourceDisplay = formatNodeSenseDisplay(currentNode, sourceSenseId);
        const targetDisplay = formatNodeSenseDisplay(
            targetNode || { _id: targetNodeId, name: targetNodeName },
            targetSenseId
        );
        return {
            type: uiRelationType,
            nodeA: targetNode || { _id: targetNodeId, name: targetNodeName },
            nodeB: null,
            direction: null,
            sourceSenseId,
            nodeASenseId: targetSenseId,
            targetSenseId,
            actualAssociations: [{
                targetNode: targetNodeId,
                relationType: backendRelationType,
                nodeName: targetNodeName,
                sourceSenseId,
                targetSenseId
            }],
            displayText: formatUiRelationExpression(sourceDisplay, uiRelationType, targetDisplay),
            pendingRemoval: false,
            pendingDecisionLines: [],
            isNewDraft: !!isNewDraft
        };
    }, [formatNodeSenseDisplay, formatUiRelationExpression]);

    const openEditAssociationModal = useCallback((node, sourceSense = null) => {
        setEditingAssociationNode(node);
        setShowEditAssociationModal(true);
        setIsEditAssociationListExpanded(true);
        setAssocApplyLoading(false);
        setAssocBridgeDecisions({});
        resetAssocDeleteDecisionFlow();
        resetAssociationEditor();
        const selectedSenseId = resolveNodeSenseId(node, sourceSense?.senseId || '');
        setEditingAssociationSenseId(selectedSenseId);
        setAssocSelectedSourceSenseId(selectedSenseId);

        const rebuiltAssociations = [];

        if (Array.isArray(node.associations) && node.associations.length > 0) {
            const sourceAssociations = [];
            node.associations.forEach((assoc) => {
                const targetNodeId = String(assoc?.targetNode?._id || assoc?.targetNode || '').trim();
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                if (sourceSenseId && sourceSenseId !== selectedSenseId) return;
                const targetNodeName = String(assoc?.targetNode?.name || '').trim();
                const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
                const normalizedTargetSenseId = targetSenseId || resolveNodeSenseId(assoc?.targetNode);
                const backendRelationType = assoc?.relationType;
                const isSimpleRelation = (
                    backendRelationType === ASSOC_RELATION_TYPES.CONTAINS
                    || backendRelationType === ASSOC_RELATION_TYPES.EXTENDS
                );
                if (!targetNodeId || !targetNodeName || !isSimpleRelation) return;
                sourceAssociations.push({
                    targetNode: assoc?.targetNode,
                    targetNodeId,
                    targetNodeName,
                    targetSenseId: normalizedTargetSenseId,
                    sourceSenseId: sourceSenseId || selectedSenseId,
                    backendRelationType
                });
            });

            sourceAssociations.forEach((item) => {
                rebuiltAssociations.push(buildSimpleAssociation({
                    currentNode: node,
                    sourceSenseId: item.sourceSenseId,
                    targetNode: item.targetNode,
                    targetNodeId: item.targetNodeId,
                    targetNodeName: item.targetNodeName,
                    targetSenseId: item.targetSenseId,
                    backendRelationType: item.backendRelationType
                }));
            });
        }

        if (rebuiltAssociations.length === 0 && (!Array.isArray(node.associations) || node.associations.length === 0)) {
            const nodeMap = {};
            allNodes.forEach((item) => {
                nodeMap[item.name] = item;
            });

            (node.relatedParentDomains || []).forEach((nodeName) => {
                const targetNode = nodeMap[nodeName];
                if (targetNode) {
                    rebuiltAssociations.push(buildSimpleAssociation({
                        currentNode: node,
                        sourceSenseId: selectedSenseId,
                        targetNode,
                        targetNodeId: targetNode._id,
                        targetNodeName: targetNode.name,
                        targetSenseId: resolveNodeSenseId(targetNode),
                        backendRelationType: ASSOC_RELATION_TYPES.EXTENDS
                    }));
                }
            });

            (node.relatedChildDomains || []).forEach((nodeName) => {
                const targetNode = nodeMap[nodeName];
                if (targetNode) {
                    rebuiltAssociations.push(buildSimpleAssociation({
                        currentNode: node,
                        sourceSenseId: selectedSenseId,
                        targetNode,
                        targetNodeId: targetNode._id,
                        targetNodeName: targetNode.name,
                        targetSenseId: resolveNodeSenseId(targetNode),
                        backendRelationType: ASSOC_RELATION_TYPES.CONTAINS
                    }));
                }
            });
        }

        setEditAssociations(normalizeAssociationDraftList(rebuiltAssociations));
    }, [
        allNodes,
        buildSimpleAssociation,
        resetAssocDeleteDecisionFlow,
        resetAssociationEditor,
        resolveNodeSenseId
    ]);

    const searchAssociationNodes = useCallback(async (keyword) => {
        const normalizedKeyword = (keyword || '').trim();
        const keywordMeta = parseAssociationKeyword(normalizedKeyword);
        const effectiveKeyword = keywordMeta.textKeyword;
        setAssocSearchAppliedKeyword(normalizedKeyword);
        if (!effectiveKeyword) {
            setAssocSearchResults([]);
            return;
        }

        setAssocSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const filtered = (Array.isArray(data) ? data : [])
                    .map((item) => normalizeAssociationCandidate(item))
                    .filter(Boolean)
                    .filter((item) => matchKeywordByDomainAndSense(item, effectiveKeyword))
                    .filter((item) => isAssociationCandidateSelectable(item, item?.senseId || ''));
                setAssocSearchResults(filtered);
            } else {
                setAssocSearchResults([]);
            }
        } catch (error) {
            console.error('搜索节点失败:', error);
            setAssocSearchResults([]);
        } finally {
            setAssocSearchLoading(false);
        }
    }, [isAssociationCandidateSelectable, normalizeAssociationCandidate]);

    const clearAssocNodeASearch = useCallback(() => {
        setAssocSearchKeyword('');
        setAssocSearchAppliedKeyword('');
        setAssocSearchResults([]);
        setAssocSearchLoading(false);
    }, []);

    const submitAssocNodeBSearch = useCallback(async (rawKeyword = assocNodeBSearchKeyword) => {
        const normalizedKeyword = String(rawKeyword || '').trim();
        const keywordMeta = parseAssociationKeyword(normalizedKeyword);
        const normalizedModeKeyword = keywordMeta.mode === 'include'
            ? '#include'
            : (keywordMeta.mode === 'expand' ? '#expand' : '');
        setAssocNodeBSearchKeyword(normalizedModeKeyword);
        setAssocNodeBSearchAppliedKeyword(normalizedModeKeyword);

        if (assocCurrentStep !== ASSOC_STEPS.SELECT_NODE_B) return;
        if (!keywordMeta.mode) return;
    }, [assocCurrentStep, assocNodeBSearchKeyword]);

    const clearAssocNodeBSearch = useCallback(() => {
        assocNodeBSearchRequestIdRef.current += 1;
        setAssocNodeBSearchKeyword('');
        setAssocNodeBSearchAppliedKeyword('');
    }, []);

    const startAddEditAssociation = useCallback(() => {
        resetAssociationEditor();
        setAssocSelectedSourceSenseId(resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId));
        setAssocCurrentStep(ASSOC_STEPS.SELECT_NODE_A);
    }, [editingAssociationNode, editingAssociationSenseId, resetAssociationEditor, resolveNodeSenseId]);

    const selectAssocNodeA = useCallback(async (node) => {
        const normalizedCandidate = normalizeAssociationCandidate(node);
        if (!normalizedCandidate || !isAssociationCandidateSelectable(normalizedCandidate, normalizedCandidate.senseId || '')) {
            alert('该释义不可选，请更换目标释义');
            return;
        }
        const targetNodeId = normalizedCandidate.nodeId;
        const nodeDetail = await fetchNodeDetailForAssociation(targetNodeId);
        if (nodeDetail) {
            setAssocSelectedNodeA(nodeDetail);
            const defaultSourceSenseId = resolveNodeSenseId(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId);
            const defaultTargetSenseId = resolveAssociationSenseId(nodeDetail, normalizedCandidate.senseId || assocSelectedNodeASenseId);
            setAssocSelectedSourceSenseId(defaultSourceSenseId);
            setAssocSelectedNodeASenseId(defaultTargetSenseId);
            loadAssocNodeBCandidatesBySense(nodeDetail, defaultTargetSenseId);
            setAssocCurrentStep(ASSOC_STEPS.SELECT_RELATION);
        } else {
            alert('获取节点详情失败');
        }
    }, [
        assocSelectedSourceSenseId,
        assocSelectedNodeASenseId,
        editingAssociationNode,
        editingAssociationSenseId,
        fetchNodeDetailForAssociation,
        isAssociationCandidateSelectable,
        loadAssocNodeBCandidatesBySense,
        normalizeAssociationCandidate,
        resolveAssociationSenseId,
        resolveNodeSenseId
    ]);

    const selectAssocRelationType = useCallback((type) => {
        const insertRelationAvailable = (
            (Array.isArray(assocNodeBCandidates.parents) && assocNodeBCandidates.parents.length > 0)
            || (Array.isArray(assocNodeBCandidates.children) && assocNodeBCandidates.children.length > 0)
        );
        if (type === ASSOC_RELATION_TYPES.INSERT && !insertRelationAvailable) {
            return;
        }
        setAssocSelectedRelationType(type);

        const nextStep = resolveAssociationNextStep(type);
        if (nextStep === ASSOC_STEPS.SELECT_NODE_B) {
            loadAssocNodeBCandidatesBySense(assocSelectedNodeA, assocSelectedNodeASenseId);
            clearAssocNodeBSearch();
            setAssocCurrentStep(nextStep);
        } else {
            setAssocCurrentStep(nextStep);
        }
    }, [
        assocNodeBCandidates.children,
        assocNodeBCandidates.parents,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        clearAssocNodeBSearch,
        loadAssocNodeBCandidatesBySense
    ]);

    useEffect(() => {
        if (assocCurrentStep !== ASSOC_STEPS.SELECT_NODE_B || assocSelectedRelationType !== ASSOC_RELATION_TYPES.INSERT) return;
        loadAssocNodeBCandidatesBySense(assocSelectedNodeA, assocSelectedNodeASenseId);
    }, [
        assocCurrentStep,
        assocSelectedRelationType,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        loadAssocNodeBCandidatesBySense
    ]);

    const selectAssocNodeB = useCallback(async (node, fromParents) => {
        const normalizedCandidate = normalizeAssociationCandidate(node);
        const selectedNodeAKey = toAssociationSenseKey(assocSelectedNodeA, assocSelectedNodeASenseId);
        const excludedSenseKeySet = new Set([selectedNodeAKey].filter(Boolean));
        if (!normalizedCandidate || !isAssociationCandidateSelectable(normalizedCandidate, normalizedCandidate.senseId || '', { excludedSenseKeySet })) {
            alert('该释义不可选，请更换第二个目标释义');
            return;
        }
        const targetNodeId = normalizedCandidate.nodeId;
        const nodeDetail = await fetchNodeDetailForAssociation(targetNodeId);
        const selectedNode = nodeDetail || normalizedCandidate;
        setAssocSelectedNodeB(selectedNode);
        setAssocSelectedNodeBSenseId(resolveAssociationSenseId(selectedNode, normalizedCandidate.senseId || ''));
        setAssocInsertDirection(fromParents ? 'bToA' : 'aToB');
        setAssocCurrentStep(ASSOC_STEPS.PREVIEW);
    }, [
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        fetchNodeDetailForAssociation,
        isAssociationCandidateSelectable,
        normalizeAssociationCandidate,
        resolveAssociationSenseId,
        toAssociationSenseKey
    ]);

    const hasExactSenseAssociation = useCallback((sourceNode, targetNodeId, relationType, sourceSenseId, targetSenseId) => {
        if (!sourceNode || !targetNodeId || !relationType || !sourceSenseId || !targetSenseId) return false;
        const assocList = Array.isArray(sourceNode?.associations) ? sourceNode.associations : [];
        return assocList.some((assoc) => {
            const assocTargetNodeId = assoc?.targetNode?._id || assoc?.targetNode;
            const assocRelationType = assoc?.relationType;
            const assocSourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
            const assocTargetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
            return (
                String(assocTargetNodeId || '') === String(targetNodeId)
                && assocRelationType === relationType
                && assocSourceSenseId === String(sourceSenseId)
                && assocTargetSenseId === String(targetSenseId)
            );
        });
    }, []);

    const hasLooseSenseAssociation = useCallback((sourceNode, targetNodeId, relationType, sourceSenseId, targetSenseId) => {
        if (!sourceNode || !targetNodeId || !relationType) return false;
        const assocList = Array.isArray(sourceNode?.associations) ? sourceNode.associations : [];
        const expectedSourceSenseId = String(sourceSenseId || '').trim();
        const expectedTargetSenseId = String(targetSenseId || '').trim();
        return assocList.some((assoc) => {
            const assocTargetNodeId = assoc?.targetNode?._id || assoc?.targetNode;
            const assocRelationType = assoc?.relationType;
            const assocSourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
            const assocTargetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
            if (String(assocTargetNodeId || '') !== String(targetNodeId)) return false;
            if (assocRelationType !== relationType) return false;
            const sourceMatch = !assocSourceSenseId || !expectedSourceSenseId || assocSourceSenseId === expectedSourceSenseId;
            const targetMatch = !assocTargetSenseId || !expectedTargetSenseId || assocTargetSenseId === expectedTargetSenseId;
            return sourceMatch && targetMatch;
        });
    }, []);

    const resolveExistingPairInsertDirection = useCallback((nodeA, nodeASenseId, nodeB, nodeBSenseId) => {
        const aNodeId = String(nodeA?._id || '');
        const bNodeId = String(nodeB?._id || '');
        if (!aNodeId || !bNodeId) return '';
        const normalizedNodeASenseId = String(nodeASenseId || '').trim();
        const normalizedNodeBSenseId = String(nodeBSenseId || '').trim();
        const canUseLooseMatch = !normalizedNodeASenseId || !normalizedNodeBSenseId;
        const hasAContainsB = (
            hasExactSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeASenseId, normalizedNodeBSenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeASenseId, normalizedNodeBSenseId))
        );
        const hasBExtendsA = (
            hasExactSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeBSenseId, normalizedNodeASenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeBSenseId, normalizedNodeASenseId))
        );
        if (hasAContainsB || hasBExtendsA) {
            return 'aToB';
        }
        const hasBContainsA = (
            hasExactSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeBSenseId, normalizedNodeASenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeBSenseId, normalizedNodeASenseId))
        );
        const hasAExtendsB = (
            hasExactSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeASenseId, normalizedNodeBSenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeASenseId, normalizedNodeBSenseId))
        );
        if (hasBContainsA || hasAExtendsB) {
            return 'bToA';
        }
        return '';
    }, [hasExactSenseAssociation, hasLooseSenseAssociation]);

    const buildInsertNarrative = useCallback((sourceNode, sourceSenseId, nodeA, nodeASenseId, nodeB, nodeBSenseId, preferredDirection = '') => {
        const sourceDisplay = formatNodeSenseDisplay(sourceNode, sourceSenseId);
        const fixedDirection = resolveExistingPairInsertDirection(nodeA, nodeASenseId, nodeB, nodeBSenseId);
        const effectiveDirection = fixedDirection || (preferredDirection === 'bToA' ? 'bToA' : 'aToB');
        const leftDisplay = formatNodeSenseDisplay(nodeA, nodeASenseId);
        const rightDisplay = formatNodeSenseDisplay(nodeB, nodeBSenseId);
        const relationSymbol = effectiveDirection === 'aToB' ? REL_SYMBOL_SUPERSET : REL_SYMBOL_SUBSET;
        const chainPreview = `${leftDisplay} ${relationSymbol} ${sourceDisplay} ${relationSymbol} ${rightDisplay}`;
        const hasOriginalRelation = !!fixedDirection;
        if (hasOriginalRelation) {
            return `${sourceDisplay} 将插入到 ${leftDisplay} 和 ${rightDisplay} 之间，原有链路将改为：${chainPreview}`;
        }
        return `${sourceDisplay} 将插入到 ${leftDisplay} 和 ${rightDisplay} 之间，将新建链路：${chainPreview}`;
    }, [formatNodeSenseDisplay, resolveExistingPairInsertDirection]);

    const recheckAssocInsertDirectionLock = useCallback((nextNodeASenseId = '', nextNodeBSenseId = '') => {
        if (assocSelectedRelationType !== ASSOC_RELATION_TYPES.INSERT) {
            return;
        }
        if (!assocSelectedNodeA?._id || !assocSelectedNodeB?._id) {
            return;
        }
        const safeNodeASenseId = String(nextNodeASenseId || '').trim();
        const safeNodeBSenseId = String(nextNodeBSenseId || '').trim();
        if (!safeNodeASenseId || !safeNodeBSenseId) {
            return;
        }
        const fixedDirection = resolveExistingPairInsertDirection(
            assocSelectedNodeA,
            safeNodeASenseId,
            assocSelectedNodeB,
            safeNodeBSenseId
        );
        if (fixedDirection) {
            setAssocInsertDirection(fixedDirection);
            return;
        }
        setAssocInsertDirection((prev) => prev || 'aToB');
    }, [
        assocSelectedRelationType,
        assocSelectedNodeA,
        assocSelectedNodeB,
        resolveExistingPairInsertDirection
    ]);

    const handleAssocNodeASenseChange = useCallback((senseId = '') => {
        const nextSenseId = String(senseId || '').trim();
        setAssocSelectedNodeASenseId(nextSenseId);
        if (assocSelectedNodeA?._id) {
            loadAssocNodeBCandidatesBySense(assocSelectedNodeA, nextSenseId);
        }
        recheckAssocInsertDirectionLock(nextSenseId, assocSelectedNodeBSenseId);
    }, [
        assocSelectedNodeA,
        assocSelectedNodeBSenseId,
        loadAssocNodeBCandidatesBySense,
        recheckAssocInsertDirectionLock
    ]);

    useEffect(() => {
        recheckAssocInsertDirectionLock(assocSelectedNodeASenseId, assocSelectedNodeBSenseId);
    }, [
        assocSelectedNodeASenseId,
        assocSelectedNodeBSenseId,
        recheckAssocInsertDirectionLock
    ]);

    const confirmEditAssociation = useCallback(() => {
        const editingDraft = assocEditingIndex !== null ? (Array.isArray(editAssociations) ? editAssociations[assocEditingIndex] : null) : null;
        const shouldMarkAsNewDraft = assocEditingIndex === null ? true : !!editingDraft?.isNewDraft;
        const effectiveSourceSenseId = resolveNodeSenseId(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId);
        const sourceDisplay = formatNodeSenseDisplay(editingAssociationNode, effectiveSourceSenseId);
        const resolveDraftRelationMode = (draft = {}) => {
            const insertGroupId = String(draft?.insertGroupId || '').trim();
            const insertSide = String(draft?.insertSide || '').trim();
            if (insertGroupId && (insertSide === 'left' || insertSide === 'right')) {
                return `insert:${insertSide}`;
            }
            return 'direct';
        };
        const buildSimpleDraft = ({
            targetNode,
            targetSenseId,
            backendRelationType,
            insertGroupId = '',
            insertSide = ''
        }) => {
            const safeTargetNode = targetNode || null;
            const safeTargetNodeId = String(safeTargetNode?._id || safeTargetNode?.nodeId || '').trim();
            const safeTargetSenseId = String(targetSenseId || '').trim();
            if (!safeTargetNodeId || !safeTargetSenseId) return null;
            const uiRelationType = backendRelationType === ASSOC_RELATION_TYPES.CONTAINS
                ? ASSOC_RELATION_TYPES.EXTENDS
                : ASSOC_RELATION_TYPES.CONTAINS;
            const targetDisplay = formatNodeSenseDisplay(safeTargetNode, safeTargetSenseId);
            return {
                type: uiRelationType,
                nodeA: safeTargetNode,
                nodeB: null,
                direction: null,
                sourceSenseId: effectiveSourceSenseId,
                nodeASenseId: safeTargetSenseId,
                actualAssociations: [{
                    targetNode: safeTargetNodeId,
                    relationType: backendRelationType,
                    nodeName: safeTargetNode?.name || '',
                    sourceSenseId: effectiveSourceSenseId,
                    targetSenseId: safeTargetSenseId
                }],
                displayText: formatUiRelationExpression(sourceDisplay, uiRelationType, targetDisplay),
                isNewDraft: shouldMarkAsNewDraft,
                insertGroupId: String(insertGroupId || '').trim(),
                insertSide: (insertSide === 'left' || insertSide === 'right') ? insertSide : ''
            };
        };

        let associationDataList = [];

        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
            if (!assocSelectedNodeA?._id || !assocSelectedNodeB?._id) {
                alert('请先选择插入的两个目标释义');
                return;
            }
            if (!effectiveSourceSenseId || !assocSelectedNodeASenseId || !assocSelectedNodeBSenseId) {
                alert('请先选择当前释义与目标释义');
                return;
            }
            const effectiveInsertDirection = assocInsertDirection === 'bToA' ? 'bToA' : 'aToB';
            const upperNode = effectiveInsertDirection === 'aToB' ? assocSelectedNodeA : assocSelectedNodeB;
            const upperSenseId = effectiveInsertDirection === 'aToB' ? assocSelectedNodeASenseId : assocSelectedNodeBSenseId;
            const lowerNode = effectiveInsertDirection === 'aToB' ? assocSelectedNodeB : assocSelectedNodeA;
            const lowerSenseId = effectiveInsertDirection === 'aToB' ? assocSelectedNodeBSenseId : assocSelectedNodeASenseId;
            const insertGroupId = createLocalId('insert');
            const upperRelation = buildSimpleDraft({
                targetNode: upperNode,
                targetSenseId: upperSenseId,
                backendRelationType: ASSOC_RELATION_TYPES.EXTENDS,
                insertGroupId,
                insertSide: 'left'
            });
            const lowerRelation = buildSimpleDraft({
                targetNode: lowerNode,
                targetSenseId: lowerSenseId,
                backendRelationType: ASSOC_RELATION_TYPES.CONTAINS,
                insertGroupId,
                insertSide: 'right'
            });
            associationDataList = [upperRelation, lowerRelation].filter(Boolean);
        } else {
            if (!assocSelectedNodeA?._id || !effectiveSourceSenseId || !assocSelectedNodeASenseId) {
                alert('请先选择当前释义与目标释义');
                return;
            }
            const backendRelationType = toBackendRelationType(assocSelectedRelationType);
            const singleAssociation = buildSimpleDraft({
                targetNode: assocSelectedNodeA,
                targetSenseId: assocSelectedNodeASenseId,
                backendRelationType
            });
            associationDataList = singleAssociation ? [singleAssociation] : [];
        }

        if (associationDataList.length < 1) {
            alert('未生成有效关联关系，请检查目标释义');
            return;
        }

        let duplicateReason = null;
        const nextActualKeySet = new Set();
        const dedupedAssociationDataList = associationDataList.filter((item) => {
            const key = (Array.isArray(item?.actualAssociations) ? item.actualAssociations : [])
                .map((actual) => [
                    String(actual?.targetNode || '').trim(),
                    String(actual?.relationType || '').trim(),
                    String(actual?.sourceSenseId || '').trim(),
                    String(actual?.targetSenseId || '').trim(),
                    resolveDraftRelationMode(item)
                ].join('|'))
                .filter(Boolean)[0] || '';
            if (!key) return false;
            if (nextActualKeySet.has(key)) return false;
            nextActualKeySet.add(key);
            return true;
        });
        if (dedupedAssociationDataList.length < 1) {
            alert('该关联关系已存在');
            return;
        }

        const isDuplicate = editAssociations.some((assoc, index) => {
            if (assocEditingIndex !== null && index === assocEditingIndex) {
                return false;
            }
            if (assoc?.pendingRemoval) {
                return false;
            }
            const existingActualList = Array.isArray(assoc?.actualAssociations) ? assoc.actualAssociations : [];
            const found = existingActualList.some((existingActual) => (
                dedupedAssociationDataList.some((nextAssoc) => (
                    (Array.isArray(nextAssoc?.actualAssociations) ? nextAssoc.actualAssociations : []).some((nextActual) => (
                        String(existingActual?.targetNode || '').trim() === String(nextActual?.targetNode || '').trim()
                        && String(existingActual?.relationType || '').trim() === String(nextActual?.relationType || '').trim()
                        && String(existingActual?.sourceSenseId || '').trim() === String(nextActual?.sourceSenseId || '').trim()
                        && String(existingActual?.targetSenseId || '').trim() === String(nextActual?.targetSenseId || '').trim()
                        && resolveDraftRelationMode(assoc) === resolveDraftRelationMode(nextAssoc)
                    ))
                ))
            ));
            if (!found) return false;
            duplicateReason = `该释义关系已存在：${assoc.displayText}`;
            return true;
        });

        if (isDuplicate) {
            alert(duplicateReason || '该关联关系已存在');
            return;
        }

        const readyAssociations = dedupedAssociationDataList.map((item) => ({
            ...item,
            pendingRemoval: false,
            pendingDecisionLines: [],
            pendingReassignPlan: null
        }));

        if (assocEditingIndex !== null) {
            setEditAssociations((prev) => {
                const next = [...prev];
                next.splice(assocEditingIndex, 1, ...readyAssociations);
                return normalizeAssociationDraftList(next);
            });
        } else {
            setEditAssociations((prev) => normalizeAssociationDraftList([...prev, ...readyAssociations]));
        }

        resetAssociationEditor();
    }, [
        assocEditingIndex,
        assocInsertDirection,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        assocSelectedNodeB,
        assocSelectedNodeBSenseId,
        assocSelectedRelationType,
        assocSelectedSourceSenseId,
        editAssociations,
        editingAssociationNode,
        editingAssociationSenseId,
        formatNodeSenseDisplay,
        formatUiRelationExpression,
        resetAssociationEditor,
        resolveNodeSenseId,
        toBackendRelationType
    ]);

    const editExistingAssociation = useCallback(async (index) => {
        const requestId = ++assocEditRequestIdRef.current;
        const assoc = editAssociations[index];
        let nextNodeA = assoc.nodeA;
        let nextNodeB = assoc.nodeB;

        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.destroy();
            assocPreviewRendererRef.current = null;
        }

        if (nextNodeA?._id && (!nextNodeA.parentNodesInfo || !nextNodeA.childNodesInfo)) {
            const nodeDetail = await fetchNodeDetailForAssociation(nextNodeA._id);
            if (requestId !== assocEditRequestIdRef.current) return;
            if (nodeDetail) {
                nextNodeA = nodeDetail;
            }
        }
        if (nextNodeB?._id && (!nextNodeB.parentNodesInfo || !nextNodeB.childNodesInfo)) {
            const nodeDetail = await fetchNodeDetailForAssociation(nextNodeB._id);
            if (requestId !== assocEditRequestIdRef.current) return;
            if (nodeDetail) {
                nextNodeB = nodeDetail;
            }
        }
        if (requestId !== assocEditRequestIdRef.current) return;

        setAssocEditingIndex(index);
        setAssocSelectedNodeA(nextNodeA);
        setAssocSelectedNodeASenseId(assoc.nodeASenseId || resolveNodeSenseId(nextNodeA));
        setAssocSelectedRelationType(assoc.type);
        setAssocSelectedNodeB(nextNodeB);
        setAssocSelectedNodeBSenseId(assoc.nodeBSenseId || resolveNodeSenseId(nextNodeB));
        setAssocSelectedSourceSenseId(assoc.sourceSenseId || resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId));
        setAssocInsertDirection(assoc.direction);
        setAssocCurrentStep(ASSOC_STEPS.PREVIEW);
    }, [
        editAssociations,
        editingAssociationNode,
        editingAssociationSenseId,
        fetchNodeDetailForAssociation,
        resolveNodeSenseId
    ]);

    const goBackAssocStep = useCallback(() => {
        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.stopAnimation();
        }

        const previousStep = resolveAssociationBackStep(assocCurrentStep, assocSelectedRelationType);
        if (!previousStep) {
            resetAssociationEditor();
            return;
        }

        setAssocCurrentStep(previousStep);
    }, [assocCurrentStep, assocSelectedRelationType, resetAssociationEditor]);

    const assocNodeASenseOptions = useMemo(() => {
        if (!assocSelectedNodeA) return [];
        const excludedSenseKeySet = new Set();
        if (
            assocCurrentStep === ASSOC_STEPS.PREVIEW
            && assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT
        ) {
            const selectedNodeBSenseKey = toAssociationSenseKey(assocSelectedNodeB, assocSelectedNodeBSenseId);
            if (selectedNodeBSenseKey) excludedSenseKeySet.add(selectedNodeBSenseKey);
        }
        return normalizeNodeSenses(assocSelectedNodeA)
            .filter((sense) => isAssociationCandidateSelectable(
                assocSelectedNodeA,
                sense.senseId,
                { excludedSenseKeySet }
            ))
            .map((sense) => ({ senseId: sense.senseId, title: sense.title }));
    }, [
        assocSelectedNodeA,
        assocCurrentStep,
        assocSelectedRelationType,
        assocSelectedNodeB,
        assocSelectedNodeBSenseId,
        toAssociationSenseKey,
        normalizeNodeSenses,
        isAssociationCandidateSelectable
    ]);

    const assocNodeBView = useMemo(() => {
        const keywordMeta = parseAssociationKeyword(assocNodeBSearchAppliedKeyword);
        const keywordMode = keywordMeta.mode;
        const hasSubmittedSearch = keywordMode === 'include' || keywordMode === 'expand';
        const selectedNodeAKey = toAssociationSenseKey(assocSelectedNodeA, assocSelectedNodeASenseId);
        const excludedSenseKeySet = new Set([selectedNodeAKey].filter(Boolean));
        const normalizeCandidateList = (list = []) => {
            const seen = new Set();
            return (Array.isArray(list) ? list : [])
                .map((item) => normalizeAssociationCandidate(item))
                .filter(Boolean)
                .filter((item) => {
                    if (seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                });
        };
        const isNodeBCandidateSelectable = (nodeLike = {}) => isAssociationCandidateSelectable(
            nodeLike,
            nodeLike?.senseId || nodeLike?.activeSenseId || '',
            { excludedSenseKeySet }
        );
        const normalizedParents = normalizeCandidateList(assocNodeBCandidates.parents);
        const normalizedChildren = normalizeCandidateList(assocNodeBCandidates.children);

        const filteredNodeBCandidates = hasSubmittedSearch
            ? {
                parents: normalizedParents.filter((item) => isNodeBCandidateSelectable(item)),
                children: normalizedChildren.filter((item) => isNodeBCandidateSelectable(item))
            }
            : { parents: [], children: [] };
        const visibleParentsRaw = hasSubmittedSearch && keywordMode !== 'expand' ? filteredNodeBCandidates.parents : [];
        const visibleChildrenRaw = hasSubmittedSearch && keywordMode !== 'include' ? filteredNodeBCandidates.children : [];

        const nodeADisplay = formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId);
        const visibleParents = visibleParentsRaw.map((node) => ({
            ...node,
            hint: `插入到 ${node.displayName || node.name} 和 ${nodeADisplay} 之间`
        }));
        const visibleChildren = visibleChildrenRaw.map((node) => ({
            ...node,
            hint: `插入到 ${nodeADisplay} 和 ${node.displayName || node.name} 之间`
        }));

        return {
            hasSubmittedSearch,
            keywordMode,
            parents: visibleParents,
            children: visibleChildren,
            extra: []
        };
    }, [
        assocNodeBSearchAppliedKeyword,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        assocNodeBCandidates.parents,
        assocNodeBCandidates.children,
        toAssociationSenseKey,
        normalizeAssociationCandidate,
        isAssociationCandidateSelectable,
        formatNodeSenseDisplay
    ]);

    const assocInsertRelationAvailable = useMemo(() => (
        (Array.isArray(assocNodeBCandidates.parents) && assocNodeBCandidates.parents.length > 0)
        || (Array.isArray(assocNodeBCandidates.children) && assocNodeBCandidates.children.length > 0)
    ), [assocNodeBCandidates.parents, assocNodeBCandidates.children]);

    const assocInsertRelationUnavailableReason = useMemo(() => {
        if (!assocSelectedNodeA?._id || !assocSelectedNodeASenseId) return '';
        if (assocInsertRelationAvailable) return '';
        return '当前目标释义在释义层没有可用的 #include / #expand 链路，无法创建插入关系。';
    }, [assocInsertRelationAvailable, assocSelectedNodeA, assocSelectedNodeASenseId]);

    const assocPreviewInfoText = useMemo(() => {
        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.EXTENDS) {
            return formatUiRelationExpression(
                formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId),
                ASSOC_RELATION_TYPES.EXTENDS,
                formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId)
            );
        }
        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.CONTAINS) {
            return formatUiRelationExpression(
                formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId),
                ASSOC_RELATION_TYPES.CONTAINS,
                formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId)
            );
        }
        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
            return buildInsertNarrative(
                editingAssociationNode,
                assocSelectedSourceSenseId,
                assocSelectedNodeA,
                assocSelectedNodeASenseId,
                assocSelectedNodeB,
                assocSelectedNodeBSenseId,
                assocInsertDirection
            );
        }
        return '';
    }, [
        assocSelectedRelationType,
        editingAssociationNode,
        assocSelectedSourceSenseId,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        assocSelectedNodeB,
        assocSelectedNodeBSenseId,
        assocInsertDirection,
        formatUiRelationExpression,
        formatNodeSenseDisplay,
        buildInsertNarrative
    ]);

    const buildAssociationPayloadForMutation = useCallback((associationDraftList = editAssociations) => {
        const effectiveEditingSenseId = resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId);
        const untouchedAssociations = (Array.isArray(editingAssociationNode?.associations) ? editingAssociationNode.associations : [])
            .filter((assoc) => {
                const rawSourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                const normalizedSourceSenseId = rawSourceSenseId || effectiveEditingSenseId;
                if (!effectiveEditingSenseId) return false;
                return normalizedSourceSenseId !== effectiveEditingSenseId;
            })
            .map((assoc) => ({
                targetNode: assoc?.targetNode?._id || assoc?.targetNode || '',
                relationType: assoc?.relationType || '',
                sourceSenseId: (typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '') || effectiveEditingSenseId,
                targetSenseId: (() => {
                    const rawTargetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
                    if (rawTargetSenseId) return rawTargetSenseId;
                    const targetNodeRaw = assoc?.targetNode;
                    const targetNode = (targetNodeRaw && typeof targetNodeRaw === 'object')
                        ? targetNodeRaw
                        : nodeByIdMap.get(String(targetNodeRaw || ''));
                    return resolveNodeSenseId(targetNode);
                })(),
                insertSide: '',
                insertGroupId: ''
            }))
            .filter((assoc) => (
                !!assoc.targetNode
                && !!assoc.relationType
                && !!assoc.sourceSenseId
                && !!assoc.targetSenseId
                && (
                    assoc.relationType === ASSOC_RELATION_TYPES.CONTAINS
                    || assoc.relationType === ASSOC_RELATION_TYPES.EXTENDS
                )
            ));

        const safeDraftList = Array.isArray(associationDraftList) ? associationDraftList : [];
        const activeDraftList = safeDraftList.filter((assoc) => !assoc?.pendingRemoval);
        const toNormalizedDirectAssociation = (actual = {}, fallbackSourceSenseId = '') => {
            const targetNodeId = String(actual?.targetNode?._id || actual?.targetNode || '').trim();
            const relationType = actual?.relationType;
            const sourceSenseId = String(actual?.sourceSenseId || fallbackSourceSenseId || '').trim();
            const targetSenseId = String(actual?.targetSenseId || '').trim();
            const isAllowedRelationType = (
                relationType === ASSOC_RELATION_TYPES.CONTAINS
                || relationType === ASSOC_RELATION_TYPES.EXTENDS
            );
            if (!targetNodeId || !sourceSenseId || !targetSenseId || !isAllowedRelationType) return null;
            return {
                targetNode: targetNodeId,
                relationType,
                sourceSenseId,
                targetSenseId,
                insertSide: '',
                insertGroupId: ''
            };
        };

        const extractSingleDirectAssociationFromDraft = (assoc = {}) => {
            const fallbackSourceSenseId = String(assoc?.sourceSenseId || effectiveEditingSenseId || '').trim();
            const sourceActualList = Array.isArray(assoc?.actualAssociations) ? assoc.actualAssociations : [];
            for (const actual of sourceActualList) {
                const normalized = toNormalizedDirectAssociation(actual, fallbackSourceSenseId);
                if (normalized) return normalized;
            }
            return null;
        };

        const insertGroupMap = new Map();
        activeDraftList.forEach((assoc, index) => {
            const insertGroupId = String(assoc?.insertGroupId || '').trim();
            const insertSide = String(assoc?.insertSide || '').trim();
            if (!insertGroupId || (insertSide !== 'left' && insertSide !== 'right')) return;
            const sourceSenseId = String(assoc?.sourceSenseId || effectiveEditingSenseId || '').trim();
            if (!sourceSenseId) return;
            const normalizedDirect = extractSingleDirectAssociationFromDraft(assoc);
            if (!normalizedDirect) return;

            const groupKey = `${sourceSenseId}|${insertGroupId}`;
            const group = insertGroupMap.get(groupKey) || {
                sourceSenseId,
                insertGroupId,
                left: null,
                leftIndex: -1,
                right: null,
                rightIndex: -1
            };
            if (insertSide === 'left' && !group.left) {
                group.left = normalizedDirect;
                group.leftIndex = index;
            }
            if (insertSide === 'right' && !group.right) {
                group.right = normalizedDirect;
                group.rightIndex = index;
            }
            insertGroupMap.set(groupKey, group);
        });

        const consumedInsertDraftIndexSet = new Set();
        const editedAssociations = [];

        insertGroupMap.forEach((group) => {
            if (!group?.left || !group?.right) return;
            consumedInsertDraftIndexSet.add(group.leftIndex);
            consumedInsertDraftIndexSet.add(group.rightIndex);
            editedAssociations.push({
                targetNode: group.left.targetNode,
                relationType: ASSOC_RELATION_TYPES.INSERT,
                sourceSenseId: group.sourceSenseId,
                targetSenseId: group.left.targetSenseId,
                insertSide: 'left',
                insertGroupId: group.insertGroupId
            });
            editedAssociations.push({
                targetNode: group.right.targetNode,
                relationType: ASSOC_RELATION_TYPES.INSERT,
                sourceSenseId: group.sourceSenseId,
                targetSenseId: group.right.targetSenseId,
                insertSide: 'right',
                insertGroupId: group.insertGroupId
            });
        });

        activeDraftList.forEach((assoc, index) => {
            if (consumedInsertDraftIndexSet.has(index)) return;

            const fallbackSourceSenseId = String(assoc?.sourceSenseId || effectiveEditingSenseId || '').trim();
            const fallbackActualAssociations = (assoc.type === ASSOC_RELATION_TYPES.INSERT)
                ? (() => {
                    const direction = assoc.direction === 'bToA' ? 'bToA' : 'aToB';
                    const upperNode = direction === 'aToB' ? assoc.nodeA : assoc.nodeB;
                    const lowerNode = direction === 'aToB' ? assoc.nodeB : assoc.nodeA;
                    const upperNodeId = String(upperNode?._id || '').trim();
                    const lowerNodeId = String(lowerNode?._id || '').trim();
                    const sourceSenseId = String(assoc.sourceSenseId || effectiveEditingSenseId || '').trim();
                    const upperSenseId = direction === 'aToB'
                        ? (assoc.nodeASenseId || resolveNodeSenseId(upperNode))
                        : (assoc.nodeBSenseId || resolveNodeSenseId(upperNode));
                    const lowerSenseId = direction === 'aToB'
                        ? (assoc.nodeBSenseId || resolveNodeSenseId(lowerNode))
                        : (assoc.nodeASenseId || resolveNodeSenseId(lowerNode));
                    if (!upperNodeId || !lowerNodeId || !sourceSenseId || !upperSenseId || !lowerSenseId) return [];
                    return [
                        {
                            targetNode: upperNodeId,
                            relationType: ASSOC_RELATION_TYPES.EXTENDS,
                            sourceSenseId,
                            targetSenseId: upperSenseId
                        },
                        {
                            targetNode: lowerNodeId,
                            relationType: ASSOC_RELATION_TYPES.CONTAINS,
                            sourceSenseId,
                            targetSenseId: lowerSenseId
                        }
                    ];
                })()
                : [];
            const sourceActualAssociations = Array.isArray(assoc?.actualAssociations) && assoc.actualAssociations.length > 0
                ? assoc.actualAssociations
                : fallbackActualAssociations;
            sourceActualAssociations.forEach((actual) => {
                const normalized = toNormalizedDirectAssociation(actual, fallbackSourceSenseId);
                if (normalized) editedAssociations.push(normalized);
            });
        });

        return [...untouchedAssociations, ...editedAssociations];
    }, [editAssociations, editingAssociationNode, editingAssociationSenseId, nodeByIdMap, resolveNodeSenseId]);

    const previewAssociationEdit = useCallback(async (
        decisionMap = assocBridgeDecisions,
        associationDraftList = editAssociations,
        options = {}
    ) => {
        if (!editingAssociationNode?._id) return null;
        const { silent = false } = options || {};
        const token = localStorage.getItem('token');
        const associationsPayload = buildAssociationPayloadForMutation(associationDraftList);
        try {
            const response = await fetch(`${API_BASE}/nodes/${editingAssociationNode._id}/associations/preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    associations: associationsPayload,
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(decisionMap)
                })
            });
            const data = await response.json();
            if (response.ok) {
                return data;
            }
            if (!silent) {
                alert(data.error || '预览失败');
            }
            return null;
        } catch (error) {
            console.error('预览关联变更失败:', error);
            if (!silent) {
                alert('预览失败');
            }
            return null;
        }
    }, [
        assocBridgeDecisions,
        editAssociations,
        editingAssociationNode,
        buildAssociationPayloadForMutation,
        toBridgeDecisionPayload
    ]);

    const removeEditAssociation = useCallback(async (index) => {
        const removedAssociation = Array.isArray(editAssociations) ? editAssociations[index] : null;
        if (!removedAssociation) return;
        const effectiveAssociationType = resolveAssociationDisplayType(removedAssociation);
        if (removedAssociation?.pendingRemoval) {
            const revertedAssociations = editAssociations.map((assoc, i) => (
                i === index
                    ? { ...assoc, pendingRemoval: false, pendingDecisionLines: [], pendingReassignPlan: null }
                    : assoc
            ));
            setEditAssociations(revertedAssociations);
            return;
        }
        if (removedAssociation?.isNewDraft) {
            const retainedMembers = Array.isArray(removedAssociation?.mergedDraftMembers)
                ? removedAssociation.mergedDraftMembers
                    .filter((member) => !member?.isNewDraft)
                    .map((member) => ({
                        ...member,
                        pendingRemoval: false,
                        pendingDecisionLines: [],
                        pendingReassignPlan: null
                    }))
                : [];
            const remainingAssociations = editAssociations.filter((_, i) => i !== index);
            const nextDrafts = retainedMembers.length > 0
                ? [...remainingAssociations, ...retainedMembers]
                : remainingAssociations;
            setEditAssociations(normalizeAssociationDraftList(nextDrafts));
            return;
        }

        if (effectiveAssociationType === ASSOC_RELATION_TYPES.CONTAINS) {
            const stagedProbe = editAssociations.map((assoc, i) => (
                i === index
                    ? { ...assoc, pendingRemoval: true, pendingDecisionLines: [] }
                    : assoc
            ));
            const previewData = await previewAssociationEdit(assocBridgeDecisions, stagedProbe, { silent: true });
            const bridgeItems = Array.isArray(previewData?.bridgeDecisionItems) ? previewData.bridgeDecisionItems : [];
            await stageAssociationRemovalByDecision({
                index,
                decisionAction: 'disconnect',
                bridgeItems,
                replacementTarget: null,
                effectiveAssociationType
            });
            return;
        }

        openAssocDeleteDecisionModal({
            index,
            association: removedAssociation,
            bridgeItems: [],
            effectiveAssociationType,
            mode: 'upper'
        });
    }, [
        assocBridgeDecisions,
        editAssociations,
        openAssocDeleteDecisionModal,
        previewAssociationEdit,
        resolveAssociationDisplayType,
        stageAssociationRemovalByDecision
    ]);

    const applyUpperReassignPlan = useCallback(async (plan, token) => {
        const lowerNodeId = String(plan?.lowerNodeId || '').trim();
        const lowerSenseId = String(plan?.lowerSenseId || '').trim();
        const newUpperNodeId = String(plan?.newUpperNodeId || '').trim();
        const newUpperSenseId = String(plan?.newUpperSenseId || '').trim();
        if (!lowerNodeId || !lowerSenseId || !newUpperNodeId || !newUpperSenseId) {
            return;
        }
        const lowerNodeDetail = await fetchNodeDetailForAssociation(lowerNodeId);
        if (!lowerNodeDetail?._id) {
            throw new Error('获取下级释义节点详情失败');
        }
        const normalizedAssociations = (Array.isArray(lowerNodeDetail?.associations) ? lowerNodeDetail.associations : [])
            .map((assoc) => ({
                targetNode: assoc?.targetNode?._id || assoc?.targetNode || '',
                relationType: assoc?.relationType || '',
                sourceSenseId: String(assoc?.sourceSenseId || '').trim(),
                targetSenseId: String(assoc?.targetSenseId || '').trim(),
                insertSide: String(assoc?.insertSide || '').trim(),
                insertGroupId: String(assoc?.insertGroupId || '').trim()
            }))
            .filter((assoc) => (
                !!assoc.targetNode
                && !!assoc.relationType
                && !!assoc.sourceSenseId
                && !!assoc.targetSenseId
            ));
        const hasReassignAssociation = normalizedAssociations.some((assoc) => (
            String(assoc.targetNode || '') === newUpperNodeId
            && assoc.relationType === ASSOC_RELATION_TYPES.EXTENDS
            && String(assoc.sourceSenseId || '') === lowerSenseId
            && String(assoc.targetSenseId || '') === newUpperSenseId
        ));
        if (hasReassignAssociation) {
            return;
        }
        const nextAssociations = [
            ...normalizedAssociations,
            {
                targetNode: newUpperNodeId,
                relationType: ASSOC_RELATION_TYPES.EXTENDS,
                sourceSenseId: lowerSenseId,
                targetSenseId: newUpperSenseId
            }
        ];
        const response = await fetch(`${API_BASE}/nodes/${lowerNodeId}/associations`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                associations: nextAssociations,
                onRemovalStrategy: 'disconnect',
                bridgeDecisions: []
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data?.error || '改接上级失败');
        }
    }, [fetchNodeDetailForAssociation]);

    const saveAssociationEdit = useCallback(async () => {
        if (!editingAssociationNode?._id) return;
        let previewSnapshot = await previewAssociationEdit(assocBridgeDecisions, editAssociations, { silent: true });
        if (!previewSnapshot) {
            alert('无法计算关联变更，请稍后重试');
            return;
        }
        const bridgeDecisionItems = Array.isArray(previewSnapshot?.bridgeDecisionItems)
            ? previewSnapshot.bridgeDecisionItems
            : [];
        const autoFilledBridgeDecisions = { ...assocBridgeDecisions };
        let hasAutoFilledDecision = false;
        bridgeDecisionItems.forEach((item) => {
            const pairKey = String(item?.pairKey || '').trim();
            if (!pairKey) return;
            if (!autoFilledBridgeDecisions[pairKey]) {
                autoFilledBridgeDecisions[pairKey] = 'disconnect';
                hasAutoFilledDecision = true;
            }
        });
        if (hasAutoFilledDecision) {
            setAssocBridgeDecisions(autoFilledBridgeDecisions);
            previewSnapshot = await previewAssociationEdit(autoFilledBridgeDecisions, editAssociations, { silent: true });
            if (!previewSnapshot) {
                alert('无法计算关联变更，请稍后重试');
                return;
            }
        }
        if ((previewSnapshot?.unresolvedBridgeDecisionCount || 0) > 0) {
            alert('关联改动中存在未确认的承接关系，已自动按“断开”处理后仍无法保存，请重试。');
            return;
        }

        const token = localStorage.getItem('token');
        const associationsPayload = buildAssociationPayloadForMutation();
        const pendingReassignPlanMap = new Map();
        (Array.isArray(editAssociations) ? editAssociations : [])
            .filter((assoc) => !!assoc?.pendingRemoval && !!assoc?.pendingReassignPlan)
            .map((assoc) => assoc.pendingReassignPlan)
            .filter(Boolean)
            .forEach((plan) => {
                const key = [
                    String(plan?.lowerNodeId || '').trim(),
                    String(plan?.lowerSenseId || '').trim(),
                    String(plan?.newUpperNodeId || '').trim(),
                    String(plan?.newUpperSenseId || '').trim()
                ].join('|');
                if (!key || pendingReassignPlanMap.has(key)) return;
                pendingReassignPlanMap.set(key, plan);
            });
        const pendingReassignPlans = Array.from(pendingReassignPlanMap.values());
        setAssocApplyLoading(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/${editingAssociationNode._id}/associations`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    associations: associationsPayload,
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(autoFilledBridgeDecisions)
                })
            });
            const data = await response.json();
            if (response.ok) {
                const reassignErrors = [];
                for (const plan of pendingReassignPlans) {
                    try {
                        await applyUpperReassignPlan(plan, token);
                    } catch (error) {
                        reassignErrors.push(error?.message || '未知错误');
                    }
                }
                if (reassignErrors.length > 0) {
                    alert(`${data.message}\n但以下改接未完成：\n${reassignErrors.join('\n')}`);
                } else {
                    alert(data.message);
                }
                closeEditAssociationModal();
                fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
            } else {
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存关联失败:', error);
            alert('保存失败');
        } finally {
            setAssocApplyLoading(false);
        }
    }, [
        adminDomainPage,
        adminDomainSearchKeyword,
        applyUpperReassignPlan,
        assocBridgeDecisions,
        buildAssociationPayloadForMutation,
        closeEditAssociationModal,
        editAssociations,
        editingAssociationNode,
        fetchAllNodes,
        previewAssociationEdit,
        toBridgeDecisionPayload
    ]);

    return {
        showEditAssociationModal,
        editingAssociationNode,
        editingAssociationSenseId,
        editAssociations,
        isEditAssociationListExpanded,
        assocCurrentStep,
        assocSelectedRelationType,
        assocSelectedSourceSenseId,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        assocSelectedNodeB,
        assocSelectedNodeBSenseId,
        assocInsertDirection,
        assocNodeASenseOptions,
        assocInsertRelationAvailable,
        assocInsertRelationUnavailableReason,
        assocSearchKeyword,
        assocSearchAppliedKeyword,
        assocSearchLoading,
        assocSearchResults,
        assocNodeBView,
        assocNodeBSearchAppliedKeyword,
        assocNodeBSearchKeyword,
        assocPreviewCanvasRef,
        assocPreviewInfoText,
        assocApplyLoading,
        setIsEditAssociationListExpanded,
        setAssocSearchKeyword,
        searchAssociationNodes,
        clearAssocNodeASearch,
        selectAssocNodeA,
        handleAssocNodeASenseChange,
        selectAssocRelationType,
        submitAssocNodeBSearch,
        selectAssocNodeB,
        confirmEditAssociation,
        goBackAssocStep,
        resetAssociationEditor,
        startAddEditAssociation,
        editExistingAssociation,
        removeEditAssociation,
        saveAssociationEdit,
        closeEditAssociationModal,
        openEditAssociationModal,
        showAssocDeleteDecisionModal,
        assocDeleteDecisionContext,
        assocDeleteDecisionAction,
        assocDeleteApplying,
        assocDeleteSelectedTarget,
        assocDeleteReplacementDisplay,
        shouldShowAssocDeleteSearch,
        assocDeleteSearchKeyword,
        assocDeleteSearchAppliedKeyword,
        assocDeleteSearchResults,
        assocDeleteSearchLoading,
        setAssocDeleteDecisionAction,
        setAssocDeleteSearchKeyword,
        setAssocDeleteSelectedTarget,
        searchAssocDeleteTargets,
        confirmAssocDeleteDecision,
        clearAssocDeleteSearch,
        closeAssocDeleteDecisionModal
    };
};

export default useAdminAssociationsFeature;
