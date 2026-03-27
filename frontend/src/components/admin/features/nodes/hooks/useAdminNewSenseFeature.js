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

const createEmptyNewSenseForm = () => ({
    title: '',
    relationType: ASSOC_RELATION_TYPES.CONTAINS,
    selectedTarget: null,
    insertLeftTarget: null,
    insertRightTarget: null,
    insertDirection: ASSOC_RELATION_TYPES.CONTAINS,
    insertDirectionLocked: false,
    insertDirectionHint: '先选择左右释义，再确认插入关系。',
    relations: []
});

const createEmptyNewSenseAssocFlow = () => ({
    currentStep: null,
    searchKeyword: '',
    searchAppliedKeyword: '',
    searchLoading: false,
    searchResults: [],
    selectedNodeA: null,
    selectedNodeASenseId: '',
    selectedRelationType: '',
    selectedNodeB: null,
    selectedNodeBSenseId: '',
    nodeBCandidates: { parents: [], children: [] },
    nodeBSearchAppliedKeyword: '',
    insertDirection: 'aToB',
    insertDirectionLocked: false
});

const useAdminNewSenseFeature = ({
    allNodes,
    normalizeNodeSenses,
    normalizeAssociationCandidate,
    resolveAssociationSenseId,
    formatNodeSenseDisplay,
    fetchSenseRelationContext,
    fetchAllNodes,
    adminDomainPage,
    adminDomainSearchKeyword
}) => {
    const [showAddSenseModal, setShowAddSenseModal] = useState(false);
    const [addingSenseNode, setAddingSenseNode] = useState(null);
    const [newSenseForm, setNewSenseForm] = useState(createEmptyNewSenseForm);
    const [newSenseAssocFlow, setNewSenseAssocFlow] = useState(createEmptyNewSenseAssocFlow);
    const newSenseAssocPreviewCanvasRef = useRef(null);
    const newSenseAssocPreviewRendererRef = useRef(null);
    const [isSavingNewSense, setIsSavingNewSense] = useState(false);

    const resetNewSenseEditor = useCallback(() => {
        setNewSenseForm(createEmptyNewSenseForm());
        setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
        if (newSenseAssocPreviewRendererRef.current) {
            newSenseAssocPreviewRendererRef.current.destroy();
            newSenseAssocPreviewRendererRef.current = null;
        }
    }, []);

    const openAddSenseModal = useCallback((node) => {
        setAddingSenseNode(node || null);
        resetNewSenseEditor();
        setShowAddSenseModal(true);
    }, [resetNewSenseEditor]);

    const closeAddSenseModal = useCallback(() => {
        if (isSavingNewSense) return;
        setShowAddSenseModal(false);
        setAddingSenseNode(null);
        resetNewSenseEditor();
    }, [isSavingNewSense, resetNewSenseEditor]);

    const getDirectRelationBetweenTargets = useCallback((leftTarget, rightTarget) => {
        if (!leftTarget?.nodeId || !rightTarget?.nodeId || !leftTarget?.senseId || !rightTarget?.senseId) {
            return null;
        }
        const leftNode = allNodes.find((node) => String(node?._id || '') === String(leftTarget.nodeId));
        const rightNode = allNodes.find((node) => String(node?._id || '') === String(rightTarget.nodeId));
        const leftAssociations = Array.isArray(leftNode?.associations) ? leftNode.associations : [];
        const rightAssociations = Array.isArray(rightNode?.associations) ? rightNode.associations : [];
        const hasLeftContainsRight = leftAssociations.some((assoc) => (
            String(assoc?.targetNode?._id || assoc?.targetNode || '') === String(rightTarget.nodeId)
            && (assoc?.relationType || '') === ASSOC_RELATION_TYPES.CONTAINS
            && String(assoc?.sourceSenseId || '').trim() === String(leftTarget.senseId).trim()
            && String(assoc?.targetSenseId || '').trim() === String(rightTarget.senseId).trim()
        ));
        const hasRightContainsLeft = rightAssociations.some((assoc) => (
            String(assoc?.targetNode?._id || assoc?.targetNode || '') === String(leftTarget.nodeId)
            && (assoc?.relationType || '') === ASSOC_RELATION_TYPES.CONTAINS
            && String(assoc?.sourceSenseId || '').trim() === String(rightTarget.senseId).trim()
            && String(assoc?.targetSenseId || '').trim() === String(leftTarget.senseId).trim()
        ));
        if (hasLeftContainsRight) {
            return {
                relationExists: true,
                lockedDirection: ASSOC_RELATION_TYPES.CONTAINS
            };
        }
        if (hasRightContainsLeft) {
            return {
                relationExists: true,
                lockedDirection: ASSOC_RELATION_TYPES.EXTENDS
            };
        }
        return {
            relationExists: false,
            lockedDirection: ASSOC_RELATION_TYPES.CONTAINS
        };
    }, [allNodes]);

    const fetchNodeDetailForNewSenseAssoc = useCallback(async (nodeId = '') => {
        const safeNodeId = String(nodeId || '').trim();
        if (!safeNodeId) return null;
        try {
            const response = await fetch(`${API_BASE}/nodes/public/node-detail/${safeNodeId}`);
            if (!response.ok) return null;
            const data = await response.json();
            return data?.node || null;
        } catch (error) {
            console.error('获取释义目标详情失败:', error);
            return null;
        }
    }, []);

    const buildNewSenseAssocTarget = useCallback((nodeLike, fallbackSenseId = '') => {
        const normalized = normalizeAssociationCandidate(nodeLike);
        if (!normalized) return null;
        const senseId = resolveAssociationSenseId(normalized, fallbackSenseId || normalized.senseId || '');
        const nodeId = String(normalized.nodeId || normalized._id || '').trim();
        const searchKey = buildSenseKey(nodeId, senseId);
        if (!nodeId || !senseId || !searchKey) return null;
        return {
            ...normalized,
            _id: nodeId,
            nodeId,
            senseId,
            activeSenseId: senseId,
            searchKey,
            displayName: normalized.displayName || formatNodeSenseDisplay(normalized, senseId)
        };
    }, [formatNodeSenseDisplay, normalizeAssociationCandidate, resolveAssociationSenseId]);

    const syncNewSenseAssocInsertDirection = useCallback((nodeA, nodeASenseId, nodeB, nodeBSenseId, fallbackDirection = 'aToB') => {
        const targetA = buildNewSenseAssocTarget(nodeA, nodeASenseId);
        const targetB = buildNewSenseAssocTarget(nodeB, nodeBSenseId);
        if (!targetA || !targetB) {
            setNewSenseAssocFlow((prev) => ({ ...prev, insertDirectionLocked: false }));
            return;
        }
        const relationStatus = getDirectRelationBetweenTargets(targetA, targetB);
        if (!relationStatus?.relationExists) {
            setNewSenseAssocFlow((prev) => ({
                ...prev,
                insertDirection: prev.insertDirection || fallbackDirection,
                insertDirectionLocked: false
            }));
            return;
        }
        const nextDirection = relationStatus.lockedDirection === ASSOC_RELATION_TYPES.EXTENDS ? 'bToA' : 'aToB';
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            insertDirection: nextDirection,
            insertDirectionLocked: true
        }));
    }, [buildNewSenseAssocTarget, getDirectRelationBetweenTargets]);

    const loadNewSenseAssocNodeBCandidatesBySense = useCallback(async (
        nodeA = newSenseAssocFlow.selectedNodeA,
        nodeASenseId = newSenseAssocFlow.selectedNodeASenseId
    ) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const targetA = buildNewSenseAssocTarget(nodeA, nodeASenseId);
        if (!targetA?.searchKey) {
            setNewSenseAssocFlow((prev) => ({ ...prev, nodeBCandidates: { parents: [], children: [] } }));
            return;
        }
        const context = await fetchSenseRelationContext(targetA);
        const dedupe = (list = []) => {
            const seen = new Set();
            return (Array.isArray(list) ? list : [])
                .map((item) => buildNewSenseAssocTarget(item))
                .filter(Boolean)
                .filter((item) => String(item.nodeId || '').trim() !== currentNodeId)
                .filter((item) => item.searchKey !== targetA.searchKey)
                .filter((item) => {
                    if (!item.searchKey || seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                });
        };
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            nodeBCandidates: {
                parents: dedupe(context?.parentTargets || []),
                children: dedupe(context?.childTargets || [])
            }
        }));
    }, [
        addingSenseNode,
        buildNewSenseAssocTarget,
        fetchSenseRelationContext,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeASenseId
    ]);

    const startNewSenseRelationEditor = useCallback(() => {
        setNewSenseAssocFlow({
            ...createEmptyNewSenseAssocFlow(),
            currentStep: ASSOC_STEPS.SELECT_NODE_A
        });
    }, []);

    const searchNewSenseAssocNodeA = useCallback(async (rawKeyword = newSenseAssocFlow.searchKeyword) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const keyword = String(rawKeyword || '').trim();
        const keywordMeta = parseAssociationKeyword(keyword);
        const effectiveKeyword = keywordMeta.textKeyword;
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            searchKeyword: keyword,
            searchAppliedKeyword: keyword
        }));
        if (!effectiveKeyword) {
            setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: [], searchLoading: false }));
            return;
        }
        const token = localStorage.getItem('token');
        setNewSenseAssocFlow((prev) => ({ ...prev, searchLoading: true }));
        try {
            const response = await fetch(`${API_BASE}/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: [], searchLoading: false }));
                return;
            }
            const data = await response.json();
            const seen = new Set();
            const results = (Array.isArray(data) ? data : [])
                .map((item) => buildNewSenseAssocTarget(item))
                .filter(Boolean)
                .filter((item) => String(item.nodeId || '').trim() !== currentNodeId)
                .filter((item) => matchKeywordByDomainAndSense(item, effectiveKeyword))
                .filter((item) => {
                    if (!item.searchKey || seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                });
            setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: results, searchLoading: false }));
        } catch (error) {
            console.error('搜索释义失败:', error);
            setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: [], searchLoading: false }));
        }
    }, [addingSenseNode, buildNewSenseAssocTarget, newSenseAssocFlow.searchKeyword]);

    const clearNewSenseAssocNodeASearch = useCallback(() => {
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            searchKeyword: '',
            searchAppliedKeyword: '',
            searchLoading: false,
            searchResults: []
        }));
    }, []);

    const selectNewSenseAssocNodeA = useCallback(async (candidate) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const normalized = buildNewSenseAssocTarget(candidate);
        if (!normalized) {
            alert('无效目标释义');
            return;
        }
        if (String(normalized.nodeId || '').trim() === currentNodeId) {
            alert('同一标题下不同释义不能建立关联关系');
            return;
        }
        const nodeDetail = await fetchNodeDetailForNewSenseAssoc(normalized.nodeId);
        const targetNode = buildNewSenseAssocTarget(nodeDetail || normalized, normalized.senseId) || normalized;
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            currentStep: ASSOC_STEPS.SELECT_RELATION,
            selectedNodeA: targetNode,
            selectedNodeASenseId: targetNode.senseId,
            selectedRelationType: '',
            selectedNodeB: null,
            selectedNodeBSenseId: '',
            nodeBCandidates: { parents: [], children: [] },
            nodeBSearchAppliedKeyword: '',
            insertDirection: 'aToB',
            insertDirectionLocked: false
        }));
        loadNewSenseAssocNodeBCandidatesBySense(targetNode, targetNode.senseId);
    }, [addingSenseNode, buildNewSenseAssocTarget, fetchNodeDetailForNewSenseAssoc, loadNewSenseAssocNodeBCandidatesBySense]);

    const selectNewSenseAssocRelationType = useCallback((relationType = '') => {
        if (!relationType) return;
        const nextStep = resolveAssociationNextStep(relationType);
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            selectedRelationType: relationType,
            currentStep: nextStep,
            selectedNodeB: nextStep === ASSOC_STEPS.SELECT_NODE_B ? null : prev.selectedNodeB,
            selectedNodeBSenseId: nextStep === ASSOC_STEPS.SELECT_NODE_B ? '' : prev.selectedNodeBSenseId,
            nodeBSearchAppliedKeyword: '',
            insertDirection: 'aToB',
            insertDirectionLocked: false
        }));
        if (nextStep === ASSOC_STEPS.SELECT_NODE_B) {
            loadNewSenseAssocNodeBCandidatesBySense(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId);
        }
    }, [loadNewSenseAssocNodeBCandidatesBySense, newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId]);

    const submitNewSenseAssocNodeBSearch = useCallback((rawKeyword = '') => {
        const keyword = String(rawKeyword || '').trim();
        const keywordMeta = parseAssociationKeyword(keyword);
        const normalizedKeyword = keywordMeta.mode === 'include'
            ? '#include'
            : (keywordMeta.mode === 'expand' ? '#expand' : '');
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            nodeBSearchAppliedKeyword: normalizedKeyword
        }));
    }, []);

    const selectNewSenseAssocNodeB = useCallback(async (candidate, fromParents = false) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const nodeAKey = buildSenseKey(newSenseAssocFlow.selectedNodeA?.nodeId || newSenseAssocFlow.selectedNodeA?._id || '', newSenseAssocFlow.selectedNodeASenseId);
        const normalized = buildNewSenseAssocTarget(candidate);
        if (!normalized) {
            alert('无效目标释义');
            return;
        }
        if (normalized.searchKey === nodeAKey) {
            alert('左右两侧不能选择同一个释义');
            return;
        }
        if (String(normalized.nodeId || '').trim() === currentNodeId) {
            alert('同一标题下不同释义不能建立关联关系');
            return;
        }
        const nodeDetail = await fetchNodeDetailForNewSenseAssoc(normalized.nodeId);
        const targetNode = buildNewSenseAssocTarget(nodeDetail || normalized, normalized.senseId) || normalized;
        const preferredDirection = fromParents ? 'bToA' : 'aToB';
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            selectedNodeB: targetNode,
            selectedNodeBSenseId: targetNode.senseId,
            insertDirection: preferredDirection,
            insertDirectionLocked: false,
            currentStep: ASSOC_STEPS.PREVIEW
        }));
        syncNewSenseAssocInsertDirection(
            newSenseAssocFlow.selectedNodeA,
            newSenseAssocFlow.selectedNodeASenseId,
            targetNode,
            targetNode.senseId,
            preferredDirection
        );
    }, [
        addingSenseNode,
        buildNewSenseAssocTarget,
        fetchNodeDetailForNewSenseAssoc,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeASenseId,
        syncNewSenseAssocInsertDirection
    ]);

    const handleNewSenseAssocNodeASenseChange = useCallback((senseId = '') => {
        const nextSenseId = String(senseId || '').trim();
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            selectedNodeASenseId: nextSenseId
        }));
        loadNewSenseAssocNodeBCandidatesBySense(newSenseAssocFlow.selectedNodeA, nextSenseId);
        syncNewSenseAssocInsertDirection(
            newSenseAssocFlow.selectedNodeA,
            nextSenseId,
            newSenseAssocFlow.selectedNodeB,
            newSenseAssocFlow.selectedNodeBSenseId,
            newSenseAssocFlow.insertDirection || 'aToB'
        );
    }, [
        loadNewSenseAssocNodeBCandidatesBySense,
        newSenseAssocFlow.insertDirection,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeB,
        newSenseAssocFlow.selectedNodeBSenseId,
        syncNewSenseAssocInsertDirection
    ]);

    const goBackNewSenseAssocStep = useCallback(() => {
        const previousStep = resolveAssociationBackStep(
            newSenseAssocFlow.currentStep,
            newSenseAssocFlow.selectedRelationType
        );
        if (!previousStep) {
            setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
            return;
        }
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            currentStep: previousStep
        }));
    }, [newSenseAssocFlow.currentStep, newSenseAssocFlow.selectedRelationType]);

    const cancelNewSenseAssocFlow = useCallback(() => {
        setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
    }, []);

    const confirmNewSenseAssocRelation = useCallback(() => {
        const relationType = newSenseAssocFlow.selectedRelationType;
        if (!relationType) {
            alert('请先选择关系类型');
            return;
        }
        if (relationType === ASSOC_RELATION_TYPES.INSERT) {
            const leftTarget = buildNewSenseAssocTarget(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId);
            const rightTarget = buildNewSenseAssocTarget(newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId);
            if (!leftTarget || !rightTarget) {
                alert('请先选择两个目标释义');
                return;
            }
            if (leftTarget.searchKey === rightTarget.searchKey) {
                alert('左右两侧不能选择同一个目标释义');
                return;
            }
            const direction = newSenseAssocFlow.insertDirection === 'bToA'
                ? ASSOC_RELATION_TYPES.EXTENDS
                : ASSOC_RELATION_TYPES.CONTAINS;
            const relationList = Array.isArray(newSenseForm.relations) ? newSenseForm.relations : [];
            const duplicated = relationList.some((item) => (
                item.kind === ASSOC_RELATION_TYPES.INSERT
                && item.direction === direction
                && item.leftTarget?.searchKey === leftTarget.searchKey
                && item.rightTarget?.searchKey === rightTarget.searchKey
            ));
            if (duplicated) {
                alert('该插入关系已存在');
                return;
            }
            setNewSenseForm((prev) => ({
                ...prev,
                relations: [
                    ...(Array.isArray(prev.relations) ? prev.relations : []),
                    {
                        id: createLocalId('rel'),
                        kind: ASSOC_RELATION_TYPES.INSERT,
                        relationType: ASSOC_RELATION_TYPES.INSERT,
                        direction,
                        leftTarget,
                        rightTarget
                    }
                ]
            }));
            setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
            return;
        }

        const target = buildNewSenseAssocTarget(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId);
        if (!target) {
            alert('请先选择目标释义');
            return;
        }
        const relationList = Array.isArray(newSenseForm.relations) ? newSenseForm.relations : [];
        const duplicated = relationList.some((item) => (
            item.kind === 'single'
            && item.relationType === relationType
            && item.target?.searchKey === target.searchKey
        ));
        if (duplicated) {
            alert('该关联关系已存在');
            return;
        }
        const oppositeType = relationType === ASSOC_RELATION_TYPES.CONTAINS
            ? ASSOC_RELATION_TYPES.EXTENDS
            : ASSOC_RELATION_TYPES.CONTAINS;
        const hasOpposite = relationList.some((item) => (
            item.kind === 'single'
            && item.relationType === oppositeType
            && item.target?.searchKey === target.searchKey
        ));
        if (hasOpposite) {
            alert(`同一个释义不能同时使用 ${REL_SYMBOL_SUPERSET} 与 ${REL_SYMBOL_SUBSET} 指向同一目标释义`);
            return;
        }
        setNewSenseForm((prev) => ({
            ...prev,
            relations: [
                ...(Array.isArray(prev.relations) ? prev.relations : []),
                {
                    id: createLocalId('rel'),
                    kind: 'single',
                    relationType,
                    target
                }
            ]
        }));
        setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
    }, [buildNewSenseAssocTarget, newSenseAssocFlow, newSenseForm.relations]);

    const removeRelationFromNewSense = useCallback((relationId) => {
        setNewSenseForm((prev) => ({
            ...prev,
            relations: (Array.isArray(prev.relations) ? prev.relations : []).filter((item) => item.id !== relationId)
        }));
    }, []);

    const saveNewSense = useCallback(async () => {
        if (!addingSenseNode?._id) return;
        const trimmedTitle = String(newSenseForm.title || '').trim();
        if (!trimmedTitle) {
            alert('释义题目不能为空');
            return;
        }
        const duplicated = normalizeNodeSenses(addingSenseNode).some((item) => (
            String(item?.title || '').trim().toLowerCase() === trimmedTitle.toLowerCase()
        ));
        if (duplicated) {
            alert('同一知识域下多个释义题目不能重名');
            return;
        }
        const relationList = Array.isArray(newSenseForm.relations) ? newSenseForm.relations : [];
        const associations = [];
        relationList.forEach((relation) => {
            if (relation.kind === 'single' && relation?.target?.nodeId && relation?.target?.senseId) {
                associations.push({
                    targetNode: relation.target.nodeId,
                    targetSenseId: relation.target.senseId,
                    relationType: relation.relationType
                });
            }
            if (relation.kind === ASSOC_RELATION_TYPES.INSERT && relation?.leftTarget?.nodeId && relation?.rightTarget?.nodeId) {
                const upperTarget = relation.direction === ASSOC_RELATION_TYPES.EXTENDS
                    ? relation.rightTarget
                    : relation.leftTarget;
                const lowerTarget = relation.direction === ASSOC_RELATION_TYPES.EXTENDS
                    ? relation.leftTarget
                    : relation.rightTarget;
                associations.push({
                    targetNode: upperTarget.nodeId,
                    targetSenseId: upperTarget.senseId,
                    relationType: ASSOC_RELATION_TYPES.INSERT,
                    insertSide: 'left',
                    insertGroupId: relation.id
                });
                associations.push({
                    targetNode: lowerTarget.nodeId,
                    targetSenseId: lowerTarget.senseId,
                    relationType: ASSOC_RELATION_TYPES.INSERT,
                    insertSide: 'right',
                    insertGroupId: relation.id
                });
            }
        });
        const token = localStorage.getItem('token');
        setIsSavingNewSense(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/${addingSenseNode._id}/admin/senses`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: trimmedTitle,
                    associations
                })
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data?.error || '新增释义失败');
                return;
            }
            alert(data?.message || '释义已新增');
            setShowAddSenseModal(false);
            setAddingSenseNode(null);
            resetNewSenseEditor();
            fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
        } catch (error) {
            console.error('新增释义失败:', error);
            alert('新增释义失败');
        } finally {
            setIsSavingNewSense(false);
        }
    }, [
        addingSenseNode,
        adminDomainPage,
        adminDomainSearchKeyword,
        fetchAllNodes,
        newSenseForm.relations,
        newSenseForm.title,
        normalizeNodeSenses,
        resetNewSenseEditor
    ]);

    const newSenseAssocSourceDisplay = useMemo(
        () => String(newSenseForm.title || '').trim() || '当前释义',
        [newSenseForm.title]
    );
    const newSenseAssocTargetDisplay = useMemo(
        () => formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId),
        [formatNodeSenseDisplay, newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId]
    );
    const newSenseAssocSecondTargetDisplay = useMemo(
        () => formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId),
        [formatNodeSenseDisplay, newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId]
    );
    const newSenseAssocNodeASenseOptions = useMemo(() => {
        const nodeA = newSenseAssocFlow.selectedNodeA;
        if (!nodeA) return [];
        const list = normalizeNodeSenses(nodeA);
        const hasSelected = list.some((item) => item.senseId === newSenseAssocFlow.selectedNodeASenseId);
        if (hasSelected) return list;
        const selectedSense = String(newSenseAssocFlow.selectedNodeASenseId || '').trim();
        if (!selectedSense) return list;
        return [...list, { senseId: selectedSense, title: selectedSense, content: '' }];
    }, [newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId, normalizeNodeSenses]);
    const newSenseAssocNodeBCandidateView = useMemo(() => {
        const keywordMeta = parseAssociationKeyword(newSenseAssocFlow.nodeBSearchAppliedKeyword);
        const mode = keywordMeta.mode;
        const textKeyword = keywordMeta.textKeyword;
        const filterByKeyword = (list = []) => (Array.isArray(list) ? list : [])
            .filter((item) => matchKeywordByDomainAndSense(item, textKeyword));
        const normalizedParents = filterByKeyword(newSenseAssocFlow.nodeBCandidates?.parents || []);
        const normalizedChildren = filterByKeyword(newSenseAssocFlow.nodeBCandidates?.children || []);
        if (!mode) {
            return { parents: [], children: [] };
        }
        if (mode === 'include') {
            return { parents: normalizedParents, children: [] };
        }
        if (mode === 'expand') {
            return { parents: [], children: normalizedChildren };
        }
        return { parents: normalizedParents, children: normalizedChildren };
    }, [newSenseAssocFlow.nodeBCandidates, newSenseAssocFlow.nodeBSearchAppliedKeyword]);
    const newSenseAssocInsertRelationAvailable = useMemo(() => {
        const candidateParents = Array.isArray(newSenseAssocFlow.nodeBCandidates?.parents)
            ? newSenseAssocFlow.nodeBCandidates.parents.length
            : 0;
        const candidateChildren = Array.isArray(newSenseAssocFlow.nodeBCandidates?.children)
            ? newSenseAssocFlow.nodeBCandidates.children.length
            : 0;
        return candidateParents + candidateChildren > 0;
    }, [newSenseAssocFlow.nodeBCandidates]);
    const newSenseAssocInsertRelationUnavailableReason = useMemo(() => (
        newSenseAssocInsertRelationAvailable
            ? ''
            : '该目标释义当前无可用的插入链路候选'
    ), [newSenseAssocInsertRelationAvailable]);
    const newSenseAssocPreviewInfoText = useMemo(() => {
        if (newSenseAssocFlow.selectedRelationType === ASSOC_RELATION_TYPES.EXTENDS) {
            return `${newSenseAssocSourceDisplay} ${REL_SYMBOL_SUPERSET} ${newSenseAssocTargetDisplay}`;
        }
        if (newSenseAssocFlow.selectedRelationType === ASSOC_RELATION_TYPES.CONTAINS) {
            return `${newSenseAssocSourceDisplay} ${REL_SYMBOL_SUBSET} ${newSenseAssocTargetDisplay}`;
        }
        if (newSenseAssocFlow.selectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
            const relationSymbol = newSenseAssocFlow.insertDirection === 'bToA' ? REL_SYMBOL_SUBSET : REL_SYMBOL_SUPERSET;
            const lockHint = newSenseAssocFlow.insertDirectionLocked ? '（方向已锁定）' : '';
            return `${newSenseAssocTargetDisplay} ${relationSymbol} ${newSenseAssocSourceDisplay} ${relationSymbol} ${newSenseAssocSecondTargetDisplay}${lockHint}`;
        }
        return '';
    }, [
        newSenseAssocFlow.insertDirection,
        newSenseAssocFlow.insertDirectionLocked,
        newSenseAssocFlow.selectedRelationType,
        newSenseAssocSecondTargetDisplay,
        newSenseAssocSourceDisplay,
        newSenseAssocTargetDisplay
    ]);

    useEffect(() => {
        if (newSenseAssocFlow.currentStep === ASSOC_STEPS.PREVIEW && newSenseAssocPreviewCanvasRef.current) {
            const canvas = newSenseAssocPreviewCanvasRef.current;
            const shouldRecreateRenderer = (
                !newSenseAssocPreviewRendererRef.current
                || newSenseAssocPreviewRendererRef.current.canvas !== canvas
            );
            if (shouldRecreateRenderer) {
                if (newSenseAssocPreviewRendererRef.current) {
                    newSenseAssocPreviewRendererRef.current.destroy();
                }
                newSenseAssocPreviewRendererRef.current = new MiniPreviewRenderer(canvas);
            }
            newSenseAssocPreviewRendererRef.current.setPreviewScene({
                nodeA: newSenseAssocFlow.selectedNodeA,
                nodeB: newSenseAssocFlow.selectedNodeB,
                relationType: newSenseAssocFlow.selectedRelationType,
                newNodeName: addingSenseNode?.name || '当前节点',
                insertDirection: newSenseAssocFlow.insertDirection || 'aToB',
                nodeALabel: formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId),
                nodeBLabel: formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId),
                newNodeLabel: newSenseAssocSourceDisplay,
                showPendingTag: false
            });
        }
        return () => {
            if (newSenseAssocFlow.currentStep !== ASSOC_STEPS.PREVIEW && newSenseAssocPreviewRendererRef.current) {
                newSenseAssocPreviewRendererRef.current.destroy();
                newSenseAssocPreviewRendererRef.current = null;
            }
        };
    }, [
        addingSenseNode,
        formatNodeSenseDisplay,
        newSenseAssocFlow.currentStep,
        newSenseAssocFlow.insertDirection,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeASenseId,
        newSenseAssocFlow.selectedNodeB,
        newSenseAssocFlow.selectedNodeBSenseId,
        newSenseAssocFlow.selectedRelationType,
        newSenseAssocSourceDisplay
    ]);

    useEffect(() => () => {
        if (newSenseAssocPreviewRendererRef.current) {
            newSenseAssocPreviewRendererRef.current.destroy();
            newSenseAssocPreviewRendererRef.current = null;
        }
    }, []);

    return {
        showAddSenseModal,
        addingSenseNode,
        isSavingNewSense,
        newSenseForm,
        newSenseAssocFlow,
        newSenseAssocSourceDisplay,
        newSenseAssocTargetDisplay,
        newSenseAssocSecondTargetDisplay,
        newSenseAssocNodeASenseOptions,
        newSenseAssocInsertRelationAvailable,
        newSenseAssocInsertRelationUnavailableReason,
        newSenseAssocNodeBCandidateView,
        newSenseAssocPreviewCanvasRef,
        newSenseAssocPreviewInfoText,
        setNewSenseForm,
        setNewSenseAssocFlow,
        openAddSenseModal,
        closeAddSenseModal,
        removeRelationFromNewSense,
        searchNewSenseAssocNodeA,
        clearNewSenseAssocNodeASearch,
        selectNewSenseAssocNodeA,
        handleNewSenseAssocNodeASenseChange,
        selectNewSenseAssocRelationType,
        submitNewSenseAssocNodeBSearch,
        selectNewSenseAssocNodeB,
        confirmNewSenseAssocRelation,
        goBackNewSenseAssocStep,
        cancelNewSenseAssocFlow,
        startNewSenseRelationEditor,
        saveNewSense
    };
};

export default useAdminNewSenseFeature;
