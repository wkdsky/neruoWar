import { useCallback, useMemo, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';
import { toBridgeDecisionPayload } from '../../../adminAssociationHelpers';

const useAdminDeleteNodeFlow = ({
    adminDomainPage,
    adminDomainSearchKeyword,
    allNodesLength,
    fetchAllNodes,
    buildNodeDeletePreview
}) => {
    const [showDeleteNodeConfirmModal, setShowDeleteNodeConfirmModal] = useState(false);
    const [deletingNodeTarget, setDeletingNodeTarget] = useState(null);
    const [isDeletingNode, setIsDeletingNode] = useState(false);
    const [deletePreviewData, setDeletePreviewData] = useState(null);
    const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
    const [deleteBridgeDecisions, setDeleteBridgeDecisions] = useState({});

    const fetchDeleteNodePreview = useCallback(async (node, decisions = {}) => {
        if (!node?._id) return { ok: false };
        const token = localStorage.getItem('token');
        setDeletePreviewLoading(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/${node._id}/delete-preview`, {
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
            if (response.ok) {
                setDeletePreviewData(data);
                return { ok: true, data };
            }
            alert(data.error || '删除预览失败');
            return { ok: false, data };
        } catch (error) {
            console.error('删除预览失败:', error);
            alert('删除预览失败');
            return { ok: false, error };
        } finally {
            setDeletePreviewLoading(false);
        }
    }, []);

    const openDeleteNodeConfirmModal = useCallback(async (node) => {
        const nextNode = node || null;
        if (!nextNode?._id) return;
        setDeletingNodeTarget(nextNode);
        setDeleteBridgeDecisions({});
        setDeletePreviewData(null);
        const previewResult = await fetchDeleteNodePreview(nextNode, {});
        if (previewResult?.ok) {
            setShowDeleteNodeConfirmModal(true);
        } else {
            setShowDeleteNodeConfirmModal(false);
            setDeletingNodeTarget(null);
            setDeleteBridgeDecisions({});
            setDeletePreviewData(null);
        }
    }, [fetchDeleteNodePreview]);

    const closeDeleteNodeConfirmModal = useCallback(() => {
        if (isDeletingNode) return;
        setShowDeleteNodeConfirmModal(false);
        setDeletingNodeTarget(null);
        setDeletePreviewData(null);
        setDeleteBridgeDecisions({});
        setDeletePreviewLoading(false);
    }, [isDeletingNode]);

    const deleteNode = useCallback(async () => {
        if (!deletingNodeTarget?._id) return;
        if ((deletePreviewData?.unresolvedBridgeDecisionCount || 0) > 0) {
            alert('请先逐条确认删除后的上下级承接关系（保留承接或断开）');
            return;
        }
        const token = localStorage.getItem('token');
        setIsDeletingNode(true);
        let isSuccess = false;
        try {
            const response = await fetch(`${API_BASE}/nodes/${deletingNodeTarget._id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(deleteBridgeDecisions)
                })
            });
            const data = await response.json();
            if (response.ok) {
                alert('节点已删除');
                isSuccess = true;
                const targetPage = adminDomainPage > 1 && allNodesLength <= 1
                    ? adminDomainPage - 1
                    : adminDomainPage;
                await fetchAllNodes(targetPage, adminDomainSearchKeyword);
            } else {
                if (data?.bridgeDecisionItems) {
                    setDeletePreviewData((prev) => ({
                        ...(prev || {}),
                        ...data
                    }));
                }
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除节点失败:', error);
            alert('删除失败');
        } finally {
            setIsDeletingNode(false);
            if (isSuccess) {
                setShowDeleteNodeConfirmModal(false);
                setDeletingNodeTarget(null);
                setDeletePreviewData(null);
                setDeleteBridgeDecisions({});
            }
        }
    }, [
        adminDomainPage,
        adminDomainSearchKeyword,
        allNodesLength,
        deleteBridgeDecisions,
        deletePreviewData,
        deletingNodeTarget,
        fetchAllNodes
    ]);

    const deletingNodePreview = useMemo(
        () => buildNodeDeletePreview(deletingNodeTarget),
        [buildNodeDeletePreview, deletingNodeTarget]
    );
    const deletePreviewSummary = deletePreviewData?.summary || null;
    const deleteBeforeRelations = Array.isArray(deletePreviewSummary?.beforeRelations)
        ? deletePreviewSummary.beforeRelations
        : [];
    const deleteAfterRelations = Array.isArray(deletePreviewSummary?.reconnectLines)
        ? deletePreviewSummary.reconnectLines
            .map((item) => item?.line)
            .filter(Boolean)
        : [];
    const deleteLostBridgePairs = Array.isArray(deletePreviewSummary?.lostBridgePairs)
        ? deletePreviewSummary.lostBridgePairs
        : [];

    const handleDeleteNodeBridgeDecision = useCallback((pairKey, action) => {
        const safePairKey = String(pairKey || '').trim();
        if (!safePairKey || (action !== 'reconnect' && action !== 'disconnect')) return;
        if (!deletingNodeTarget?._id) return;
        const nextDecisions = { ...deleteBridgeDecisions, [safePairKey]: action };
        setDeleteBridgeDecisions(nextDecisions);
        fetchDeleteNodePreview(deletingNodeTarget, nextDecisions);
    }, [deleteBridgeDecisions, deletingNodeTarget, fetchDeleteNodePreview]);

    return {
        showDeleteNodeConfirmModal,
        deletingNodeTarget,
        isDeletingNode,
        deletePreviewData,
        deletePreviewLoading,
        deleteBridgeDecisions,
        deletingNodePreview,
        deletePreviewSummary,
        deleteBeforeRelations,
        deleteAfterRelations,
        deleteLostBridgePairs,
        openDeleteNodeConfirmModal,
        closeDeleteNodeConfirmModal,
        deleteNode,
        handleDeleteNodeBridgeDecision
    };
};

export default useAdminDeleteNodeFlow;
