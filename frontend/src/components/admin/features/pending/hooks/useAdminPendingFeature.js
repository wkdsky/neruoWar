import { useCallback, useMemo, useState } from 'react';
import {
    ASSOC_RELATION_TYPES
} from '../../../../shared/associationFlowShared';
import {
    REL_SYMBOL_SUBSET,
    REL_SYMBOL_SUPERSET
} from '../../../adminAssociationHelpers';
import { API_BASE } from '../../../../../runtimeConfig';

const useAdminPendingFeature = ({
    onPendingMasterApplyHandled,
    normalizeNodeSenses,
    formatBackendRelationExpression,
    formatNodeSenseDisplay,
    nodeByIdMap,
    resolveAssociationTargetDisplay
}) => {
    const [pendingNodes, setPendingNodes] = useState([]);
    const [pendingNodeActionId, setPendingNodeActionId] = useState('');
    const [pendingNodeActionGroupName, setPendingNodeActionGroupName] = useState('');
    const [pendingNodeSelectedSenseByNodeId, setPendingNodeSelectedSenseByNodeId] = useState({});
    const [pendingMasterApplications, setPendingMasterApplications] = useState([]);
    const [masterApplyActionId, setMasterApplyActionId] = useState('');

    const groupedPendingNodes = useMemo(() => {
        const groups = {};
        pendingNodes.forEach((node) => {
            const name = node.name;
            if (!groups[name]) {
                groups[name] = [];
            }
            groups[name].push(node);
        });
        return Object.entries(groups)
            .map(([name, nodes]) => ({ name, nodes, hasConflict: nodes.length > 1 }))
            .sort((a, b) => {
                if (a.hasConflict && !b.hasConflict) return -1;
                if (!a.hasConflict && b.hasConflict) return 1;
                return new Date(b.nodes[0].createdAt) - new Date(a.nodes[0].createdAt);
            });
    }, [pendingNodes]);

    const groupedPendingMasterApplications = useMemo(() => {
        const groups = {};
        pendingMasterApplications.forEach((application) => {
            const nodeId = application.nodeId || `unknown_${application._id}`;
            if (!groups[nodeId]) {
                groups[nodeId] = {
                    nodeId,
                    nodeName: application.nodeName || '知识域',
                    applications: [],
                    hasConflict: false
                };
            }
            groups[nodeId].applications.push(application);
        });

        return Object.values(groups)
            .map((group) => ({
                ...group,
                hasConflict: group.applications.length > 1
            }))
            .sort((a, b) => {
                const aTime = new Date(a.applications[0]?.createdAt || 0).getTime();
                const bTime = new Date(b.applications[0]?.createdAt || 0).getTime();
                return bTime - aTime;
            });
    }, [pendingMasterApplications]);

    const pendingApprovalCount = pendingNodes.length + pendingMasterApplications.length;

    const fetchPendingNodes = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/nodes/pending`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setPendingNodes(data);
            }
        } catch (error) {
            console.error('获取待审批节点失败:', error);
        }
    }, []);

    const fetchPendingMasterApplications = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/notifications`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            const nextPendingApplications = (data.notifications || []).filter((notification) => (
                notification.type === 'domain_master_apply' &&
                notification.status === 'pending'
            ));
            setPendingMasterApplications(nextPendingApplications);
        } catch (error) {
            console.error('获取待审批域主申请失败:', error);
        }
    }, []);

    const refreshPendingApprovals = useCallback(() => {
        fetchPendingNodes();
        fetchPendingMasterApplications();
    }, [fetchPendingMasterApplications, fetchPendingNodes]);

    const approveNode = useCallback(async (nodeId, nodeName) => {
        if (pendingNodeActionId) return;
        const token = localStorage.getItem('token');
        setPendingNodeActionId(nodeId);
        setPendingNodeActionGroupName(nodeName || '');
        try {
            const response = await fetch(`${API_BASE}/nodes/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ nodeId })
            });
            if (response.ok) {
                const data = await response.json();
                let message = '知识域申请审批通过';
                if (data.autoRejectedCount > 0) {
                    message += `，已自动拒绝 ${data.autoRejectedCount} 个同名申请`;
                }
                alert(message);
                fetchPendingNodes();
            } else {
                const data = await response.json();
                if ((data?.error || '').includes('已存在同名的审核通过知识域')) {
                    alert('该同名申请已被其他审批结果处理，列表已刷新');
                    fetchPendingNodes();
                } else {
                    alert(data.error || '审批失败');
                }
            }
        } catch (error) {
            console.error('审批节点失败:', error);
            alert('审批失败');
        } finally {
            setPendingNodeActionId('');
            setPendingNodeActionGroupName('');
        }
    }, [fetchPendingNodes, pendingNodeActionId]);

    const rejectNode = useCallback(async (nodeId) => {
        if (pendingNodeActionId) return;
        const token = localStorage.getItem('token');
        setPendingNodeActionId(nodeId);
        try {
            const response = await fetch(`${API_BASE}/nodes/reject`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ nodeId })
            });
            if (response.ok) {
                alert('知识域申请已拒绝');
                setPendingNodes((prev) => prev.filter((node) => node._id !== nodeId));
            } else {
                const data = await response.json();
                alert(data.error || '拒绝失败');
            }
        } catch (error) {
            console.error('拒绝节点失败:', error);
            alert('拒绝失败');
        } finally {
            setPendingNodeActionId('');
            setPendingNodeActionGroupName('');
        }
    }, [pendingNodeActionId]);

    const reviewMasterApplication = useCallback(async (notificationId, action) => {
        const token = localStorage.getItem('token');
        if (!token || !notificationId) return;
        setMasterApplyActionId(`${notificationId}:${action}`);
        try {
            const response = await fetch(`${API_BASE}/notifications/${notificationId}/respond`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ action })
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message || '域主申请处理完成');
                await fetchPendingMasterApplications();
                if (typeof onPendingMasterApplyHandled === 'function') {
                    await onPendingMasterApplyHandled();
                }
            } else {
                alert(data.error || '处理域主申请失败');
            }
        } catch (error) {
            console.error('处理域主申请失败:', error);
            alert('处理域主申请失败');
        } finally {
            setMasterApplyActionId('');
        }
    }, [fetchPendingMasterApplications, onPendingMasterApplyHandled]);

    const getPendingRelationBadgeMeta = useCallback((relationType = '', insertSide = '') => {
        if (relationType === ASSOC_RELATION_TYPES.CONTAINS) {
            return { className: 'parent', label: `包含 ${REL_SYMBOL_SUPERSET}` };
        }
        if (relationType === ASSOC_RELATION_TYPES.EXTENDS) {
            return { className: 'child', label: `扩展 ${REL_SYMBOL_SUBSET}` };
        }
        if (relationType === ASSOC_RELATION_TYPES.INSERT) {
            const normalizedInsertSide = String(insertSide || '').trim();
            const suffix = normalizedInsertSide === 'left'
                ? '（左）'
                : (normalizedInsertSide === 'right' ? '（右）' : '');
            return { className: 'insert', label: `插入${suffix}` };
        }
        return { className: 'insert', label: '关联' };
    }, []);

    const getPendingSenseAssociations = useCallback((node, senseId) => {
        const normalizedSenseId = String(senseId || '').trim();
        if (!node || !normalizedSenseId) return [];

        const sourceSenses = normalizeNodeSenses(node);
        const canUseLooseSourceMatch = sourceSenses.length === 1;
        const sourceDisplay = formatNodeSenseDisplay(node, normalizedSenseId);
        const allAssociations = Array.isArray(node?.associations) ? node.associations : [];
        const normalizedAssociations = allAssociations
            .filter((assoc) => {
                const assocSourceSenseId = String(assoc?.sourceSenseId || '').trim();
                if (assocSourceSenseId) return assocSourceSenseId === normalizedSenseId;
                return canUseLooseSourceMatch;
            })
            .map((assoc, index) => {
                const relationType = String(assoc?.relationType || '').trim();
                const sourceSenseId = String(assoc?.sourceSenseId || '').trim() || normalizedSenseId;
                const targetNodeRaw = assoc?.targetNode;
                const targetNodeId = String(targetNodeRaw?._id || targetNodeRaw || '').trim();
                const targetSenseId = String(assoc?.targetSenseId || '').trim();
                const insertSide = String(assoc?.insertSide || '').trim();
                const insertGroupId = String(assoc?.insertGroupId || '').trim();
                const targetNode = (targetNodeRaw && typeof targetNodeRaw === 'object')
                    ? targetNodeRaw
                    : nodeByIdMap.get(targetNodeId);
                const targetKey = `${targetNodeId}:${targetSenseId}`;
                const targetDisplay = resolveAssociationTargetDisplay(assoc);
                return {
                    index,
                    assoc,
                    relationType,
                    sourceSenseId,
                    targetNodeId,
                    targetSenseId,
                    insertSide,
                    insertGroupId,
                    targetNode,
                    targetKey,
                    targetDisplay
                };
            })
            .filter((item) => (
                !!item.targetNodeId
                && !!item.targetSenseId
                && (
                    item.relationType === ASSOC_RELATION_TYPES.CONTAINS
                    || item.relationType === ASSOC_RELATION_TYPES.EXTENDS
                    || item.relationType === ASSOC_RELATION_TYPES.INSERT
                )
            ));

        const displaySlots = Array(normalizedAssociations.length).fill(null);
        const markDisplaySlot = (slotIndex, payload) => {
            if (slotIndex < 0 || slotIndex >= displaySlots.length) return;
            displaySlots[slotIndex] = payload;
        };
        const consumedIndexSet = new Set();

        const insertGroups = new Map();
        normalizedAssociations.forEach((item) => {
            if (item.relationType !== ASSOC_RELATION_TYPES.INSERT) return;
            if (!item.insertGroupId) return;
            const groupKey = `${item.sourceSenseId}|${item.insertGroupId}`;
            const group = insertGroups.get(groupKey) || { left: null, right: null };
            if (item.insertSide === 'left' && !group.left) group.left = item;
            if (item.insertSide === 'right' && !group.right) group.right = item;
            insertGroups.set(groupKey, group);
        });

        insertGroups.forEach((group, groupKey) => {
            if (!group.left || !group.right) return;
            if (group.left.targetKey === group.right.targetKey) return;
            consumedIndexSet.add(group.left.index);
            consumedIndexSet.add(group.right.index);
            const anchorIndex = Math.min(group.left.index, group.right.index);
            const relationMeta = getPendingRelationBadgeMeta(ASSOC_RELATION_TYPES.INSERT, '');
            const upperDisplay = formatNodeSenseDisplay(group.left.targetNode, group.left.targetSenseId);
            const lowerDisplay = formatNodeSenseDisplay(group.right.targetNode, group.right.targetSenseId);
            markDisplaySlot(anchorIndex, {
                id: `pending_assoc_${node?._id || 'node'}_${normalizedSenseId}_insert_group_${groupKey}`,
                relationType: ASSOC_RELATION_TYPES.INSERT,
                relationClassName: relationMeta.className,
                relationLabel: relationMeta.label,
                displayText: `${upperDisplay} ${REL_SYMBOL_SUPERSET} ${sourceDisplay} ${REL_SYMBOL_SUPERSET} ${lowerDisplay}`
            });
        });

        normalizedAssociations
            .filter((item) => !consumedIndexSet.has(item.index))
            .filter((item) => (
                item.relationType === ASSOC_RELATION_TYPES.CONTAINS
                || item.relationType === ASSOC_RELATION_TYPES.EXTENDS
            ))
            .forEach((candidate) => {
                consumedIndexSet.add(candidate.index);
                const relationMeta = getPendingRelationBadgeMeta(candidate.relationType, '');
                markDisplaySlot(candidate.index, {
                    id: `pending_assoc_${node?._id || 'node'}_${normalizedSenseId}_single_${candidate.index}`,
                    relationType: candidate.relationType,
                    relationClassName: relationMeta.className,
                    relationLabel: relationMeta.label,
                    displayText: formatBackendRelationExpression(sourceDisplay, candidate.relationType, candidate.targetDisplay)
                });
            });

        normalizedAssociations.forEach((item) => {
            if (consumedIndexSet.has(item.index)) return;
            const relationMeta = getPendingRelationBadgeMeta(item.relationType, item.insertSide || '');
            markDisplaySlot(item.index, {
                id: `pending_assoc_${node?._id || 'node'}_${normalizedSenseId}_fallback_${item.index}`,
                relationType: item.relationType,
                relationClassName: relationMeta.className,
                relationLabel: relationMeta.label,
                displayText: formatBackendRelationExpression(sourceDisplay, item.relationType, item.targetDisplay)
            });
        });

        return displaySlots.filter(Boolean);
    }, [
        formatBackendRelationExpression,
        formatNodeSenseDisplay,
        getPendingRelationBadgeMeta,
        nodeByIdMap,
        normalizeNodeSenses,
        resolveAssociationTargetDisplay
    ]);

    const selectPendingNodeSense = useCallback((nodeId, senseId) => {
        const safeNodeId = String(nodeId || '').trim();
        const safeSenseId = String(senseId || '').trim();
        if (!safeNodeId || !safeSenseId) return;
        setPendingNodeSelectedSenseByNodeId((prev) => ({
            ...prev,
            [safeNodeId]: safeSenseId
        }));
    }, []);

    return {
        pendingApprovalCount,
        pendingNodes,
        pendingMasterApplications,
        groupedPendingNodes,
        groupedPendingMasterApplications,
        pendingNodeActionId,
        pendingNodeActionGroupName,
        pendingNodeSelectedSenseByNodeId,
        masterApplyActionId,
        fetchPendingNodes,
        fetchPendingMasterApplications,
        refreshPendingApprovals,
        approveNode,
        rejectNode,
        reviewMasterApplication,
        getPendingSenseAssociations,
        selectPendingNodeSense
    };
};

export default useAdminPendingFeature;
