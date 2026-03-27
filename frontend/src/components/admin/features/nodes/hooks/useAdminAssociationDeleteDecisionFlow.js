import { useCallback, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';
import { ASSOC_RELATION_TYPES, parseAssociationKeyword } from '../../../../shared/associationFlowShared';
import { matchKeywordByDomainAndSense } from '../../../adminAssociationHelpers';

const useAdminAssociationDeleteDecisionFlow = ({
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
}) => {
    const [showAssocDeleteDecisionModal, setShowAssocDeleteDecisionModal] = useState(false);
    const [assocDeleteDecisionContext, setAssocDeleteDecisionContext] = useState(null);
    const [assocDeleteDecisionAction, setAssocDeleteDecisionAction] = useState('disconnect');
    const [assocDeleteSearchKeyword, setAssocDeleteSearchKeyword] = useState('');
    const [assocDeleteSearchAppliedKeyword, setAssocDeleteSearchAppliedKeyword] = useState('');
    const [assocDeleteSearchResults, setAssocDeleteSearchResults] = useState([]);
    const [assocDeleteSearchLoading, setAssocDeleteSearchLoading] = useState(false);
    const [assocDeleteSelectedTarget, setAssocDeleteSelectedTarget] = useState(null);
    const [assocDeleteApplying, setAssocDeleteApplying] = useState(false);
    const assocDeleteSearchRequestIdRef = useRef(0);

    const clearAssocDeleteSearch = useCallback(() => {
        assocDeleteSearchRequestIdRef.current += 1;
        setAssocDeleteSearchKeyword('');
        setAssocDeleteSearchAppliedKeyword('');
        setAssocDeleteSearchResults([]);
        setAssocDeleteSearchLoading(false);
        setAssocDeleteSelectedTarget(null);
    }, []);

    const resetAssocDeleteDecisionFlow = useCallback(() => {
        setShowAssocDeleteDecisionModal(false);
        setAssocDeleteDecisionContext(null);
        setAssocDeleteDecisionAction('disconnect');
        clearAssocDeleteSearch();
        setAssocDeleteApplying(false);
    }, [clearAssocDeleteSearch]);

    const closeAssocDeleteDecisionModal = useCallback(() => {
        if (assocDeleteApplying) return;
        resetAssocDeleteDecisionFlow();
    }, [assocDeleteApplying, resetAssocDeleteDecisionFlow]);

    const searchAssocDeleteTargets = useCallback(async (keyword = assocDeleteSearchKeyword) => {
        const deleteMode = assocDeleteDecisionContext?.mode || '';
        if (deleteMode !== 'upper') {
            setAssocDeleteSearchAppliedKeyword(String(keyword || '').trim());
            setAssocDeleteSearchResults([]);
            setAssocDeleteSearchLoading(false);
            return;
        }
        const normalizedKeyword = String(keyword || '').trim();
        const keywordMeta = parseAssociationKeyword(normalizedKeyword);
        const effectiveKeyword = keywordMeta.textKeyword;
        setAssocDeleteSearchAppliedKeyword(normalizedKeyword);
        if (!effectiveKeyword) {
            setAssocDeleteSearchResults([]);
            return;
        }
        const requestId = ++assocDeleteSearchRequestIdRef.current;
        setAssocDeleteSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (requestId !== assocDeleteSearchRequestIdRef.current) return;
            if (!response.ok) {
                setAssocDeleteSearchResults([]);
                return;
            }
            const data = await response.json();
            const deletingAssoc = assocDeleteDecisionContext?.association || null;
            const deletingTargetNodeId = String(
                deletingAssoc?.nodeA?._id
                || deletingAssoc?.nodeA?.nodeId
                || deletingAssoc?.nodeA
                || ''
            ).trim();
            const deletingTargetKey = toAssociationSenseKey(
                deletingAssoc?.nodeA,
                deletingAssoc?.nodeASenseId || deletingAssoc?.targetSenseId || ''
            );
            const editingNodeId = String(editingAssociationNode?._id || '').trim();
            const results = (Array.isArray(data) ? data : [])
                .map((item) => normalizeAssociationCandidate(item))
                .filter(Boolean)
                .filter((item) => matchKeywordByDomainAndSense(item, effectiveKeyword))
                .filter((item) => String(item?.nodeId || '') !== editingNodeId)
                .filter((item) => String(item?.nodeId || '') !== deletingTargetNodeId)
                .filter((item) => item?.searchKey !== deletingTargetKey);
            setAssocDeleteSearchResults(results);
        } catch (error) {
            if (requestId !== assocDeleteSearchRequestIdRef.current) return;
            console.error('删除决策弹窗搜索失败:', error);
            setAssocDeleteSearchResults([]);
        } finally {
            if (requestId === assocDeleteSearchRequestIdRef.current) {
                setAssocDeleteSearchLoading(false);
            }
        }
    }, [
        assocDeleteDecisionContext,
        assocDeleteSearchKeyword,
        editingAssociationNode,
        normalizeAssociationCandidate,
        toAssociationSenseKey
    ]);

    const stageAssociationRemovalByDecision = useCallback(async ({
        index,
        decisionAction = 'disconnect',
        bridgeItems = [],
        replacementTarget = null,
        effectiveAssociationType = ''
    }) => {
        const removedAssociation = Array.isArray(editAssociations) ? editAssociations[index] : null;
        if (!removedAssociation) return;
        const resolvedAssociationType = String(effectiveAssociationType || removedAssociation?.type || '').trim();

        const normalizedAction = decisionAction === 'reconnect' ? 'reconnect' : 'disconnect';
        const nextBridgeDecisions = { ...assocBridgeDecisions };
        const pendingDecisionLines = [];
        let pendingReassignPlan = null;
        const effectiveSourceSenseId = removedAssociation?.sourceSenseId
            || resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId);
        const sourceDisplay = formatNodeSenseDisplay(editingAssociationNode, effectiveSourceSenseId);
        const targetDisplay = formatNodeSenseDisplay(
            removedAssociation?.nodeA,
            removedAssociation?.nodeASenseId || removedAssociation?.targetSenseId || ''
        );
        const isUpperRelationDeletion = resolvedAssociationType === ASSOC_RELATION_TYPES.EXTENDS;

        (Array.isArray(bridgeItems) ? bridgeItems : []).forEach((item) => {
            const pairKey = item?.pairKey || '';
            if (!pairKey) return;
            nextBridgeDecisions[pairKey] = normalizedAction;
            const bridgeSourceDisplay = resolveDecisionCurrentDisplay(
                editingAssociationNode,
                item?.sourceSenseId || '',
                editingAssociationNode?.name || '当前标题'
            );
            const upperDisplay = resolveDecisionPairSideDisplay(item, 'upper');
            const lowerDisplay = resolveDecisionPairSideDisplay(item, 'lower');
            if (normalizedAction === 'reconnect') {
                pendingDecisionLines.push(`恢复：${upperDisplay} → ${bridgeSourceDisplay} → ${lowerDisplay}`);
            }
        });

        if (pendingDecisionLines.length < 1) {
            pendingDecisionLines.push(
                normalizedAction === 'reconnect'
                    ? `恢复：${sourceDisplay} 与 ${targetDisplay} 的原有链路`
                    : `拆分：${sourceDisplay} 与 ${targetDisplay} 将解除关系`
            );
        }

        const nextAssociations = editAssociations.map((assoc, i) => (
            i === index
                ? { ...assoc, pendingRemoval: true, pendingDecisionLines: [], pendingReassignPlan: null }
                : assoc
        ));

        if (isUpperRelationDeletion && decisionAction === 'reassign_upper' && replacementTarget?.nodeId && replacementTarget?.senseId) {
            const replacementNodeId = String(replacementTarget.nodeId || replacementTarget._id || '').trim();
            const replacementSenseId = resolveAssociationSenseId(replacementTarget, replacementTarget.senseId || '');
            const replacementNodeName = replacementTarget?.name || replacementTarget?.domainName || replacementTarget?.displayName || '';
            if (replacementNodeId && replacementSenseId && replacementNodeName) {
                const lowerNodeId = String(
                    removedAssociation?.nodeA?._id
                    || removedAssociation?.nodeA?.nodeId
                    || removedAssociation?.nodeA
                    || ''
                ).trim();
                const lowerSenseId = String(
                    removedAssociation?.nodeASenseId
                    || removedAssociation?.targetSenseId
                    || ''
                ).trim();
                if (lowerNodeId && lowerSenseId) {
                    pendingReassignPlan = {
                        lowerNodeId,
                        lowerSenseId,
                        newUpperNodeId: replacementNodeId,
                        newUpperSenseId: replacementSenseId
                    };
                    pendingDecisionLines.push(`改接：${targetDisplay} 将改为 ${formatNodeSenseDisplay(replacementTarget, replacementSenseId)} 的下级`);
                }
            }
        }

        if (resolvedAssociationType === ASSOC_RELATION_TYPES.CONTAINS) {
            pendingDecisionLines.push(`${sourceDisplay} 作为下级，可直接删除该关联`);
        }
        if (isUpperRelationDeletion && decisionAction === 'reassign_upper' && !pendingReassignPlan) {
            pendingDecisionLines.push('未选择可用上级，暂不改接');
        }
        if (isUpperRelationDeletion && decisionAction !== 'reassign_upper' && pendingDecisionLines.length < 2) {
            pendingDecisionLines.push(`${targetDisplay} 与 ${sourceDisplay} 解绑后将保持独立`);
        }

        const stagedWithDecisionLines = nextAssociations.map((assoc, i) => (
            i === index
                ? { ...assoc, pendingRemoval: true, pendingDecisionLines, pendingReassignPlan }
                : assoc
        ));
        setAssocBridgeDecisions(nextBridgeDecisions);
        setEditAssociations(stagedWithDecisionLines);
    }, [
        assocBridgeDecisions,
        editAssociations,
        editingAssociationNode,
        editingAssociationSenseId,
        formatNodeSenseDisplay,
        resolveAssociationSenseId,
        resolveDecisionCurrentDisplay,
        resolveDecisionPairSideDisplay,
        resolveNodeSenseId,
        setAssocBridgeDecisions,
        setEditAssociations
    ]);

    const confirmAssocDeleteDecision = useCallback(async () => {
        const context = assocDeleteDecisionContext || null;
        if (!context) return;
        const decisionMode = context?.mode || 'upper';
        if (decisionMode === 'upper' && assocDeleteDecisionAction === 'reassign_upper' && !assocDeleteSelectedTarget) {
            alert('请先选择新的上级释义');
            return;
        }
        setAssocDeleteApplying(true);
        try {
            await stageAssociationRemovalByDecision({
                index: context.index,
                decisionAction: assocDeleteDecisionAction,
                bridgeItems: context.bridgeItems || [],
                replacementTarget: (
                    decisionMode === 'upper' && assocDeleteDecisionAction === 'reassign_upper'
                        ? (assocDeleteSelectedTarget || null)
                        : null
                ),
                effectiveAssociationType: context.effectiveAssociationType || ''
            });
            resetAssocDeleteDecisionFlow();
        } finally {
            setAssocDeleteApplying(false);
        }
    }, [
        assocDeleteDecisionAction,
        assocDeleteDecisionContext,
        assocDeleteSelectedTarget,
        resetAssocDeleteDecisionFlow,
        stageAssociationRemovalByDecision
    ]);

    const openAssocDeleteDecisionModal = useCallback((context = null) => {
        if (!context) return;
        setAssocDeleteDecisionContext(context);
        setAssocDeleteDecisionAction('disconnect');
        clearAssocDeleteSearch();
        setShowAssocDeleteDecisionModal(true);
    }, [clearAssocDeleteSearch]);

    const shouldShowAssocDeleteSearch = assocDeleteDecisionAction === 'reassign_upper';
    const assocDeleteReplacementDisplay = useMemo(() => (
        assocDeleteSelectedTarget
            ? formatNodeSenseDisplay(assocDeleteSelectedTarget, assocDeleteSelectedTarget?.senseId || '')
            : '新上级释义'
    ), [assocDeleteSelectedTarget, formatNodeSenseDisplay]);

    return {
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
    };
};

export default useAdminAssociationDeleteDecisionFlow;
