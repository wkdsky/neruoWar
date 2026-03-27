import { useCallback, useMemo, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';
import { toBridgeDecisionPayload } from '../../../adminAssociationHelpers';

const useAdminDeleteSenseFlow = ({
    adminDomainPage,
    adminDomainSearchKeyword,
    allNodesLength,
    fetchAllNodes
}) => {
    const [showDeleteSenseModal, setShowDeleteSenseModal] = useState(false);
    const [deletingSenseContext, setDeletingSenseContext] = useState(null);
    const [deleteSensePreviewData, setDeleteSensePreviewData] = useState(null);
    const [deleteSensePreviewLoading, setDeleteSensePreviewLoading] = useState(false);
    const [deleteSenseBridgeDecisions, setDeleteSenseBridgeDecisions] = useState({});
    const [showDeleteSenseDecisionModal, setShowDeleteSenseDecisionModal] = useState(false);
    const [deleteSenseDecisionPair, setDeleteSenseDecisionPair] = useState(null);
    const [deleteSenseDecisionApplying, setDeleteSenseDecisionApplying] = useState(false);
    const [isDeletingSense, setIsDeletingSense] = useState(false);

    const fetchDeleteSensePreview = useCallback(async (node, sense, decisions = {}) => {
        if (!node?._id || !sense?.senseId) return;
        const token = localStorage.getItem('token');
        setDeleteSensePreviewLoading(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/${node._id}/admin/senses/${encodeURIComponent(sense.senseId)}/delete-preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(decisions)
                })
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data?.error || '删除释义预览失败');
                return;
            }
            setDeleteSensePreviewData(data);
        } catch (error) {
            console.error('删除释义预览失败:', error);
            alert('删除释义预览失败');
        } finally {
            setDeleteSensePreviewLoading(false);
        }
    }, []);

    const deleteSensePreviewSummary = deleteSensePreviewData?.summary || null;
    const deleteSenseBeforeRelations = Array.isArray(deleteSensePreviewSummary?.beforeRelations)
        ? deleteSensePreviewSummary.beforeRelations
        : [];
    const deleteSenseAfterRelations = Array.isArray(deleteSensePreviewSummary?.reconnectLines)
        ? deleteSensePreviewSummary.reconnectLines
            .map((item) => item?.line)
            .filter(Boolean)
        : [];
    const deleteSenseWillDeleteNode = !!deleteSensePreviewData?.willDeleteNode;
    const deleteSenseLostBridgePairs = useMemo(() => (
        Array.isArray(deleteSensePreviewSummary?.lostBridgePairs)
            ? deleteSensePreviewSummary.lostBridgePairs
            : []
    ), [deleteSensePreviewSummary]);
    const deleteSensePendingBridgePairs = useMemo(() => (
        deleteSenseLostBridgePairs.filter((pair) => {
            const pairKey = String(pair?.pairKey || '').trim();
            if (!pairKey) return false;
            return !deleteSenseBridgeDecisions[pairKey];
        })
    ), [deleteSenseBridgeDecisions, deleteSenseLostBridgePairs]);
    const deleteSenseConfirmedBridgePairs = useMemo(() => (
        deleteSenseLostBridgePairs
            .map((pair) => {
                const pairKey = String(pair?.pairKey || '').trim();
                if (!pairKey) return null;
                const action = deleteSenseBridgeDecisions[pairKey] || '';
                if (action !== 'reconnect' && action !== 'disconnect') return null;
                return { ...pair, pairKey, action };
            })
            .filter(Boolean)
    ), [deleteSenseBridgeDecisions, deleteSenseLostBridgePairs]);

    const openDeleteSenseModal = useCallback((node, sense) => {
        setDeletingSenseContext({ node, sense });
        setDeleteSenseBridgeDecisions({});
        setShowDeleteSenseDecisionModal(false);
        setDeleteSenseDecisionPair(null);
        setDeleteSenseDecisionApplying(false);
        setDeleteSensePreviewData(null);
        setShowDeleteSenseModal(true);
        fetchDeleteSensePreview(node, sense, {});
    }, [fetchDeleteSensePreview]);

    const closeDeleteSenseModal = useCallback(() => {
        if (isDeletingSense || deleteSenseDecisionApplying) return;
        setShowDeleteSenseModal(false);
        setDeletingSenseContext(null);
        setDeleteSenseBridgeDecisions({});
        setShowDeleteSenseDecisionModal(false);
        setDeleteSenseDecisionPair(null);
        setDeleteSenseDecisionApplying(false);
        setDeleteSensePreviewData(null);
        setDeleteSensePreviewLoading(false);
    }, [deleteSenseDecisionApplying, isDeletingSense]);

    const closeDeleteSenseDecisionModal = useCallback(() => {
        if (deleteSenseDecisionApplying) return;
        setShowDeleteSenseDecisionModal(false);
        setDeleteSenseDecisionPair(null);
    }, [deleteSenseDecisionApplying]);

    const openDeleteSenseDecisionModal = useCallback((pair = null) => {
        const pairKey = String(pair?.pairKey || '').trim();
        if (!pairKey) return;
        setDeleteSenseDecisionPair(pair);
        setShowDeleteSenseDecisionModal(true);
    }, []);

    const applyDeleteSensePairDecision = useCallback(async (action) => {
        const node = deletingSenseContext?.node || null;
        const sense = deletingSenseContext?.sense || null;
        if (!node?._id || !sense?.senseId) return;
        const pairKey = String(deleteSenseDecisionPair?.pairKey || '').trim();
        if (!pairKey) {
            alert('当前未选择待处理关系');
            return;
        }
        if (action !== 'reconnect' && action !== 'disconnect') {
            alert('请选择有效的处理方式');
            return;
        }
        setDeleteSenseDecisionApplying(true);
        const nextDecisions = {
            ...deleteSenseBridgeDecisions,
            [pairKey]: action
        };
        setDeleteSenseBridgeDecisions(nextDecisions);
        try {
            await fetchDeleteSensePreview(node, sense, nextDecisions);
            setShowDeleteSenseDecisionModal(false);
            setDeleteSenseDecisionPair(null);
        } finally {
            setDeleteSenseDecisionApplying(false);
        }
    }, [
        deleteSenseBridgeDecisions,
        deleteSenseDecisionPair,
        deletingSenseContext,
        fetchDeleteSensePreview
    ]);

    const rollbackDeleteSensePairDecision = useCallback(async (pairKey) => {
        const safePairKey = String(pairKey || '').trim();
        if (!safePairKey) return;
        const node = deletingSenseContext?.node || null;
        const sense = deletingSenseContext?.sense || null;
        if (!node?._id || !sense?.senseId) return;
        const nextDecisions = { ...deleteSenseBridgeDecisions };
        delete nextDecisions[safePairKey];
        setDeleteSenseBridgeDecisions(nextDecisions);
        await fetchDeleteSensePreview(node, sense, nextDecisions);
    }, [deleteSenseBridgeDecisions, deletingSenseContext, fetchDeleteSensePreview]);

    const deleteSense = useCallback(async () => {
        const node = deletingSenseContext?.node;
        const sense = deletingSenseContext?.sense;
        if (!node?._id || !sense?.senseId) return;
        if (deleteSensePendingBridgePairs.length > 0) {
            alert('请先在左侧逐条完成关联关系处理，全部移到右侧后才能删除');
            return;
        }
        if ((deleteSensePreviewData?.unresolvedBridgeDecisionCount || 0) > 0) {
            alert('请先逐条确认删除后的上下级承接关系（保留承接或断开）');
            return;
        }
        const token = localStorage.getItem('token');
        setIsDeletingSense(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/${node._id}/admin/senses/${encodeURIComponent(sense.senseId)}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(deleteSenseBridgeDecisions)
                })
            });
            const data = await response.json();
            if (!response.ok) {
                if (data?.bridgeDecisionItems) {
                    setDeleteSensePreviewData((prev) => ({
                        ...(prev || {}),
                        ...data
                    }));
                }
                alert(data?.error || '删除释义失败');
                return;
            }
            alert(data?.message || '释义已删除');
            setShowDeleteSenseModal(false);
            setDeletingSenseContext(null);
            setDeleteSenseBridgeDecisions({});
            setShowDeleteSenseDecisionModal(false);
            setDeleteSenseDecisionPair(null);
            setDeleteSenseDecisionApplying(false);
            setDeleteSensePreviewData(null);
            setDeleteSensePreviewLoading(false);
            const targetPage = data?.deletedNodeWithSense && adminDomainPage > 1 && allNodesLength <= 1
                ? adminDomainPage - 1
                : adminDomainPage;
            await fetchAllNodes(targetPage, adminDomainSearchKeyword);
        } catch (error) {
            console.error('删除释义失败:', error);
            alert('删除释义失败');
        } finally {
            setIsDeletingSense(false);
        }
    }, [
        adminDomainPage,
        adminDomainSearchKeyword,
        allNodesLength,
        deleteSenseBridgeDecisions,
        deleteSensePendingBridgePairs.length,
        deleteSensePreviewData,
        deletingSenseContext,
        fetchAllNodes
    ]);

    return {
        showDeleteSenseModal,
        deletingSenseContext,
        deleteSensePreviewData,
        deleteSensePreviewLoading,
        showDeleteSenseDecisionModal,
        deleteSenseDecisionPair,
        deleteSenseDecisionApplying,
        isDeletingSense,
        deleteSenseBeforeRelations,
        deleteSenseAfterRelations,
        deleteSenseWillDeleteNode,
        deleteSenseLostBridgePairs,
        deleteSensePendingBridgePairs,
        deleteSenseConfirmedBridgePairs,
        openDeleteSenseModal,
        closeDeleteSenseModal,
        closeDeleteSenseDecisionModal,
        openDeleteSenseDecisionModal,
        applyDeleteSensePairDecision,
        rollbackDeleteSensePairDecision,
        deleteSense
    };
};

export default useAdminDeleteSenseFlow;
