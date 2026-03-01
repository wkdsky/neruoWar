import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import CreateNodeAssociationManager from './CreateNodeAssociationManager';
import MiniPreviewRenderer from './MiniPreviewRenderer';
import {
  ASSOC_STEPS,
  ASSOC_RELATION_TYPES,
  parseAssociationKeyword,
  resolveAssociationNextStep,
  resolveAssociationBackStep
} from '../shared/associationFlowShared';
import './CreateNodeModal.css';
import { API_BASE } from '../../runtimeConfig';

const REL_SYMBOL_SUPERSET = '⊇';
const REL_SYMBOL_SUBSET = '⊆';

const makeLocalId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const createSenseDraft = () => ({
  localId: makeLocalId('sense'),
  title: '',
  content: '',
  relations: []
});

const createRelationManagerState = () => ({
  isOpen: false,
  senseLocalId: '',
  pendingDeleteRelationId: '',
  currentStep: null,
  searchKeyword: '',
  searchAppliedKeyword: '',
  searchResults: [],
  searchLoading: false,
  selectedNodeA: null,
  selectedNodeASenseId: '',
  selectedRelationType: '',
  selectedNodeB: null,
  selectedNodeBSenseId: '',
  nodeBCandidates: { parents: [], children: [] },
  nodeBSearchKeyword: '',
  nodeBSearchAppliedKeyword: '',
  nodeBExtraSearchResults: [],
  nodeBExtraSearchLoading: false,
  insertDirection: 'aToB',
  insertDirectionLocked: false
});

const normalizeSearchResult = (item = {}) => ({
  nodeId: item?.nodeId || item?._id || '',
  senseId: typeof item?.senseId === 'string' ? item.senseId : (typeof item?.activeSenseId === 'string' ? item.activeSenseId : ''),
  displayName: item?.displayName || item?.name || '',
  domainName: item?.domainName || item?.name || '',
  senseTitle: item?.senseTitle || item?.activeSenseTitle || '',
  description: item?.senseContent || item?.activeSenseContent || item?.description || '',
  searchKey: item?.searchKey || `${item?.nodeId || item?._id || ''}:${item?.senseId || item?.activeSenseId || ''}`,
  relationToAnchor: item?.relationToAnchor || ''
});

const matchesKeywordByTitleAndSense = (item = {}, textKeyword = '') => {
  const normalizedKeyword = String(textKeyword || '').trim().toLowerCase();
  if (!normalizedKeyword) return true;
  const keywords = normalizedKeyword.split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return true;
  const searchText = `${item?.displayName || ''} ${item?.domainName || ''} ${item?.senseTitle || ''}`.toLowerCase();
  return keywords.every((keyword) => searchText.includes(keyword));
};

const dedupeBySearchKey = (list = []) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((item) => {
    const key = item?.searchKey || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeNodeSenses = (nodeLike, fallbackSenseId = '') => {
  if (!nodeLike) return [];
  const list = Array.isArray(nodeLike?.synonymSenses) ? nodeLike.synonymSenses : [];
  if (list.length > 0) {
    return list
      .map((sense) => ({
        senseId: String(sense?.senseId || '').trim(),
        title: String(sense?.title || '').trim()
      }))
      .filter((sense) => sense.senseId)
      .map((sense) => ({
        senseId: sense.senseId,
        title: sense.title || `释义 ${sense.senseId}`
      }));
  }
  const normalized = normalizeSearchResult(nodeLike);
  const senseId = String(fallbackSenseId || normalized.senseId || nodeLike?.activeSenseId || '').trim();
  if (!senseId) return [];
  return [{
    senseId,
    title: normalized.senseTitle || `释义 ${senseId}`
  }];
};

const resolveNodeName = (nodeLike = {}) => (
  String(nodeLike?.name || nodeLike?.domainName || nodeLike?.displayName || '').trim()
);

const formatNodeSenseDisplay = (nodeLike, fallbackSenseId = '') => {
  if (!nodeLike) return '-';
  const normalized = normalizeSearchResult(nodeLike);
  const nodeName = resolveNodeName(nodeLike) || normalized.displayName || '-';
  const senses = normalizeNodeSenses(nodeLike, fallbackSenseId);
  const selectedSenseId = String(fallbackSenseId || normalized.senseId || '').trim();
  const sense = senses.find((item) => item.senseId === selectedSenseId) || senses[0] || null;
  const senseTitle = String(sense?.title || normalized.senseTitle || '').trim();
  return senseTitle ? `${nodeName}-${senseTitle}` : nodeName;
};

const toSenseKey = (nodeLike, fallbackSenseId = '') => {
  const normalized = normalizeSearchResult(nodeLike);
  const nodeId = String(normalized.nodeId || '').trim();
  const senseId = String(fallbackSenseId || normalized.senseId || '').trim();
  if (!nodeId || !senseId) return '';
  return `${nodeId}:${senseId}`;
};

const buildRelationDisplayText = (relation, currentLabel = '当前释义') => {
  if (!relation) return '';
  if (relation.kind === ASSOC_RELATION_TYPES.INSERT) {
    const left = relation.leftTarget?.displayName || '未知释义';
    const right = relation.rightTarget?.displayName || '未知释义';
    const symbol = relation.direction === ASSOC_RELATION_TYPES.EXTENDS ? REL_SYMBOL_SUBSET : REL_SYMBOL_SUPERSET;
    return `${left} ${symbol} ${currentLabel} ${symbol} ${right}`;
  }
  const target = relation.target?.displayName || '未知释义';
  const symbol = relation.relationType === ASSOC_RELATION_TYPES.EXTENDS ? REL_SYMBOL_SUPERSET : REL_SYMBOL_SUBSET;
  return `${currentLabel} ${symbol} ${target}`;
};

const CreateNodeModal = ({
  isOpen,
  onClose,
  username,
  isAdmin = false,
  existingNodes,
  onSuccess
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [senses, setSenses] = useState([createSenseDraft()]);
  const [relationManager, setRelationManager] = useState(createRelationManagerState());
  const [submitLightTip, setSubmitLightTip] = useState('');

  const relationContextCacheRef = useRef(new Map());
  const nodeASearchRequestIdRef = useRef(0);
  const nodeBSearchRequestIdRef = useRef(0);
  const nodeBCandidateResolveRequestIdRef = useRef(0);
  const insertDirectionResolveRequestIdRef = useRef(0);
  const previewCanvasRef = useRef(null);
  const previewRendererRef = useRef(null);
  const submitLightTipTimerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setDescription('');
    setSenses([createSenseDraft()]);
    setRelationManager(createRelationManagerState());
    setSubmitLightTip('');
    relationContextCacheRef.current = new Map();
  }, [isOpen]);

  useEffect(() => () => {
    if (previewRendererRef.current) {
      previewRendererRef.current.destroy();
      previewRendererRef.current = null;
    }
    if (submitLightTipTimerRef.current) {
      clearTimeout(submitLightTipTimerRef.current);
      submitLightTipTimerRef.current = null;
    }
  }, []);

  const approvedNameSet = useMemo(() => (
    new Set((Array.isArray(existingNodes) ? existingNodes : [])
      .filter((node) => node?.status === 'approved' && typeof node?.name === 'string')
      .map((node) => node.name.trim())
      .filter(Boolean))
  ), [existingNodes]);

  const hasApprovedNodes = approvedNameSet.size > 0;
  const requiresSenseRelations = hasApprovedNodes && !isAdmin;
  const isTitleDuplicated = useMemo(() => approvedNameSet.has(title.trim()), [approvedNameSet, title]);

  const updateSense = useCallback((localId, updater) => {
    setSenses((prev) => prev.map((item) => (
      item.localId === localId
        ? (typeof updater === 'function' ? updater(item) : { ...item, ...updater })
        : item
    )));
  }, []);

  const findSenseByLocalId = useCallback((localId) => (
    senses.find((item) => item.localId === localId) || null
  ), [senses]);

  const fetchNodeDetailForAssociation = useCallback(async (nodeId) => {
    if (!nodeId) return null;
    try {
      const response = await fetch(`${API_BASE}/nodes/public/node-detail/${nodeId}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data?.node || null;
    } catch (error) {
      console.error('获取节点详情失败:', error);
      return null;
    }
  }, []);

  const fetchSenseRelationContext = useCallback(async (target) => {
    const nodeId = target?.nodeId;
    const senseId = target?.senseId;
    if (!nodeId || !senseId) {
      return {
        parentTargets: [],
        childTargets: [],
        parentKeySet: new Set(),
        childKeySet: new Set()
      };
    }

    const cacheKey = `${nodeId}:${senseId}`;
    const cache = relationContextCacheRef.current;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    try {
      const response = await fetch(`${API_BASE}/nodes/public/node-detail/${nodeId}?senseId=${encodeURIComponent(senseId)}`);
      if (!response.ok) {
        const emptyData = {
          parentTargets: [],
          childTargets: [],
          parentKeySet: new Set(),
          childKeySet: new Set()
        };
        cache.set(cacheKey, emptyData);
        return emptyData;
      }
      const data = await response.json();
      const detailNode = data?.node || {};
      const activeSenseId = detailNode?.activeSenseId || senseId;
      const getTargetNodeId = (targetNode) => {
        if (!targetNode) return '';
        if (typeof targetNode === 'string') return targetNode;
        return targetNode?._id || '';
      };
      const normalizeNodeList = (list) => (
        dedupeBySearchKey((Array.isArray(list) ? list : [])
          .map((item) => normalizeSearchResult({
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
      ));

      const sourceSenses = normalizeNodeSenses(detailNode, activeSenseId);
      const canUseLooseSourceMatch = sourceSenses.length === 1;
      const parentTargetsRaw = normalizeNodeList(detailNode?.parentNodesInfo || data?.parentNodes || []);
      const childTargetsRaw = normalizeNodeList(detailNode?.childNodesInfo || data?.childNodes || []);
      const parentTargetMap = new Map(parentTargetsRaw.map((item) => [item.searchKey, item]));
      const childTargetMap = new Map(childTargetsRaw.map((item) => [item.searchKey, item]));
      const parentKeySet = new Set();
      const childKeySet = new Set();

      (Array.isArray(detailNode?.associations) ? detailNode.associations : []).forEach((assoc) => {
        const relationType = assoc?.relationType;
        if (relationType !== ASSOC_RELATION_TYPES.EXTENDS && relationType !== ASSOC_RELATION_TYPES.CONTAINS) return;
        const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
        if (sourceSenseId) {
          if (sourceSenseId !== activeSenseId) return;
        } else if (!canUseLooseSourceMatch) {
          return;
        }
        const targetNodeId = getTargetNodeId(assoc?.targetNode);
        const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
        if (!targetNodeId || !targetSenseId) return;
        const relationKey = `${targetNodeId}:${targetSenseId}`;
        const targetNode = (assoc?.targetNode && typeof assoc.targetNode === 'object') ? assoc.targetNode : null;
        if (targetNode) {
          const normalizedTarget = normalizeSearchResult({
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

      const relationData = {
        parentTargets,
        childTargets,
        parentKeySet,
        childKeySet
      };
      cache.set(cacheKey, relationData);
      return relationData;
    } catch (error) {
      console.error('获取释义关系上下文失败:', error);
      return {
        parentTargets: [],
        childTargets: [],
        parentKeySet: new Set(),
        childKeySet: new Set()
      };
    }
  }, []);

  const toRelationTarget = useCallback((nodeLike, fallbackSenseId = '') => {
    if (!nodeLike) return null;
    const normalized = normalizeSearchResult(nodeLike);
    const nodeId = String(normalized.nodeId || '').trim();
    const senseId = String(fallbackSenseId || normalized.senseId || '').trim();
    if (!nodeId || !senseId) return null;
    return {
      nodeId,
      senseId,
      searchKey: `${nodeId}:${senseId}`,
      displayName: formatNodeSenseDisplay(nodeLike, senseId),
      domainName: normalized.domainName || resolveNodeName(nodeLike) || '',
      senseTitle: normalized.senseTitle || '',
      description: normalized.description || ''
    };
  }, []);

  const getManagedSenseExcludedKeySet = useCallback((managedSense) => {
    const keySet = new Set();
    (Array.isArray(managedSense?.relations) ? managedSense.relations : []).forEach((relation) => {
      if (relation.kind === 'single' && relation?.target?.searchKey) {
        keySet.add(relation.target.searchKey);
      }
      if (relation.kind === ASSOC_RELATION_TYPES.INSERT) {
        if (relation?.leftTarget?.searchKey) keySet.add(relation.leftTarget.searchKey);
        if (relation?.rightTarget?.searchKey) keySet.add(relation.rightTarget.searchKey);
      }
    });
    return keySet;
  }, []);

  const isRelationManagerCandidateSelectable = useCallback((candidate, excludedSenseKeySet = new Set()) => {
    const normalized = normalizeSearchResult(candidate);
    if (!normalized.nodeId || !normalized.senseId || !normalized.searchKey) return false;
    if (excludedSenseKeySet.has(normalized.searchKey)) return false;
    return true;
  }, []);

  const resetRelationManagerAddFlow = useCallback(() => {
    nodeASearchRequestIdRef.current += 1;
    nodeBSearchRequestIdRef.current += 1;
    nodeBCandidateResolveRequestIdRef.current += 1;
    insertDirectionResolveRequestIdRef.current += 1;
    setRelationManager((prev) => ({
      ...prev,
      currentStep: null,
      searchKeyword: '',
      searchAppliedKeyword: '',
      searchResults: [],
      searchLoading: false,
      selectedNodeA: null,
      selectedNodeASenseId: '',
      selectedRelationType: '',
      selectedNodeB: null,
      selectedNodeBSenseId: '',
      nodeBCandidates: { parents: [], children: [] },
      nodeBSearchKeyword: '',
      nodeBSearchAppliedKeyword: '',
      nodeBExtraSearchResults: [],
      nodeBExtraSearchLoading: false,
      insertDirection: 'aToB',
      insertDirectionLocked: false
    }));
  }, []);

  const openRelationManager = (senseLocalId) => {
    nodeASearchRequestIdRef.current += 1;
    nodeBSearchRequestIdRef.current += 1;
    nodeBCandidateResolveRequestIdRef.current += 1;
    insertDirectionResolveRequestIdRef.current += 1;
    setRelationManager({
      ...createRelationManagerState(),
      isOpen: true,
      senseLocalId
    });
  };

  const closeRelationManager = () => {
    nodeBCandidateResolveRequestIdRef.current += 1;
    if (previewRendererRef.current) {
      previewRendererRef.current.destroy();
      previewRendererRef.current = null;
    }
    setRelationManager(createRelationManagerState());
  };

  const addSense = () => {
    setSenses((prev) => [...prev, createSenseDraft()]);
  };

  const removeSense = (localId) => {
    setSenses((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item.localId !== localId);
    });
    setRelationManager((prev) => (prev.senseLocalId === localId ? createRelationManagerState() : prev));
  };

  const updateSenseField = (localId, field, value) => {
    updateSense(localId, { [field]: value });
  };

  const requestRemoveManagedRelation = (relationId) => {
    setRelationManager((prev) => {
      if (!prev.isOpen) return prev;
      return { ...prev, pendingDeleteRelationId: relationId };
    });
  };

  const cancelRemoveManagedRelation = () => {
    setRelationManager((prev) => ({ ...prev, pendingDeleteRelationId: '' }));
  };

  const removeRelationFromSense = (senseLocalId, relationId) => {
    updateSense(senseLocalId, (sense) => ({
      ...sense,
      relations: (Array.isArray(sense.relations) ? sense.relations : []).filter((item) => item.id !== relationId)
    }));
  };

  const confirmRemoveManagedRelation = () => {
    const senseLocalId = relationManager.senseLocalId;
    const relationId = relationManager.pendingDeleteRelationId;
    if (!senseLocalId || !relationId) return;
    removeRelationFromSense(senseLocalId, relationId);
    setRelationManager((prev) => ({ ...prev, pendingDeleteRelationId: '' }));
  };

  useEffect(() => {
    if (!relationManager.isOpen) return;
    const managedSense = senses.find((item) => item.localId === relationManager.senseLocalId);
    if (!managedSense) {
      setRelationManager(createRelationManagerState());
      return;
    }
    if (!relationManager.pendingDeleteRelationId) return;
    const hasPendingRelation = (Array.isArray(managedSense.relations) ? managedSense.relations : [])
      .some((item) => item.id === relationManager.pendingDeleteRelationId);
    if (!hasPendingRelation) {
      setRelationManager((prev) => ({ ...prev, pendingDeleteRelationId: '' }));
    }
  }, [relationManager.isOpen, relationManager.senseLocalId, relationManager.pendingDeleteRelationId, senses]);

  const startManagedRelationEditor = () => {
    const managedSense = findSenseByLocalId(relationManager.senseLocalId);
    if (!managedSense) return;
    resetRelationManagerAddFlow();
    setRelationManager((prev) => ({
      ...prev,
      currentStep: ASSOC_STEPS.SELECT_NODE_A,
      pendingDeleteRelationId: ''
    }));
  };

  const searchManagedNodeA = useCallback(async (rawKeyword = relationManager.searchKeyword) => {
    if (!relationManager.isOpen || !relationManager.senseLocalId) return;

    const keyword = String(rawKeyword || '').trim();
    const keywordMeta = parseAssociationKeyword(keyword);
    const effectiveKeyword = keywordMeta.textKeyword;
    setRelationManager((prev) => ({
      ...prev,
      searchKeyword: keyword,
      searchAppliedKeyword: keyword
    }));

    if (!effectiveKeyword) {
      nodeASearchRequestIdRef.current += 1;
      setRelationManager((prev) => ({
        ...prev,
        searchLoading: false,
        searchResults: []
      }));
      return;
    }

    const managedSense = findSenseByLocalId(relationManager.senseLocalId);
    const excludedSenseKeySet = getManagedSenseExcludedKeySet(managedSense);

    const requestId = nodeASearchRequestIdRef.current + 1;
    nodeASearchRequestIdRef.current = requestId;
    setRelationManager((prev) => ({ ...prev, searchLoading: true }));

    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`${API_BASE}/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (requestId !== nodeASearchRequestIdRef.current) return;
      if (!response.ok) {
        setRelationManager((prev) => ({
          ...prev,
          searchLoading: false,
          searchResults: []
        }));
        return;
      }

      const data = await response.json();
      const results = dedupeBySearchKey((Array.isArray(data) ? data : [])
        .map((item) => normalizeSearchResult(item))
        .filter((item) => item.nodeId && item.senseId && item.displayName)
        .filter((item) => matchesKeywordByTitleAndSense(item, effectiveKeyword))
        .filter((item) => isRelationManagerCandidateSelectable(item, excludedSenseKeySet)));

      setRelationManager((prev) => ({
        ...prev,
        searchLoading: false,
        searchResults: results
      }));
    } catch (error) {
      if (requestId !== nodeASearchRequestIdRef.current) return;
      console.error('搜索目标释义失败:', error);
      setRelationManager((prev) => ({
        ...prev,
        searchLoading: false,
        searchResults: []
      }));
    }
  }, [
    relationManager.isOpen,
    relationManager.searchKeyword,
    relationManager.senseLocalId,
    findSenseByLocalId,
    getManagedSenseExcludedKeySet,
    isRelationManagerCandidateSelectable
  ]);

  const clearManagedNodeASearch = () => {
    nodeASearchRequestIdRef.current += 1;
    setRelationManager((prev) => ({
      ...prev,
      searchKeyword: '',
      searchAppliedKeyword: '',
      searchLoading: false,
      searchResults: []
    }));
  };

  const selectManagedNodeA = async (candidate) => {
    const managedSense = findSenseByLocalId(relationManager.senseLocalId);
    const excludedSenseKeySet = getManagedSenseExcludedKeySet(managedSense);
    const normalized = normalizeSearchResult(candidate);
    if (!isRelationManagerCandidateSelectable(normalized, excludedSenseKeySet)) {
      window.alert('该释义不可选，请更换目标释义');
      return;
    }

    const nodeDetail = await fetchNodeDetailForAssociation(normalized.nodeId);
    const nextNodeA = nodeDetail || normalized;
    const nextSenseId = String(normalized.senseId || '').trim() || normalizeNodeSenses(nextNodeA)[0]?.senseId || '';
    setRelationManager((prev) => ({
      ...prev,
      currentStep: ASSOC_STEPS.SELECT_RELATION,
      selectedNodeA: nextNodeA,
      selectedNodeASenseId: nextSenseId,
      selectedRelationType: '',
      selectedNodeB: null,
      selectedNodeBSenseId: '',
      nodeBCandidates: { parents: [], children: [] },
      nodeBSearchKeyword: '',
      nodeBSearchAppliedKeyword: '',
      nodeBExtraSearchResults: [],
      nodeBExtraSearchLoading: false,
      insertDirection: 'aToB',
      insertDirectionLocked: false
    }));
    loadManagedNodeBCandidatesBySense(nextNodeA, nextSenseId, relationManager.senseLocalId);
  };

  const selectManagedRelationType = (type) => {
    if (!relationManager.selectedNodeA) return;

    const nextStep = resolveAssociationNextStep(type);
    if (nextStep === ASSOC_STEPS.SELECT_NODE_B) {
      setRelationManager((prev) => ({
        ...prev,
        selectedRelationType: type,
        currentStep: nextStep,
        nodeBSearchKeyword: '',
        nodeBSearchAppliedKeyword: '',
        nodeBExtraSearchResults: [],
        nodeBExtraSearchLoading: false,
        selectedNodeB: null,
        selectedNodeBSenseId: '',
        insertDirection: 'aToB',
        insertDirectionLocked: false
      }));
      loadManagedNodeBCandidatesBySense(
        relationManager.selectedNodeA,
        relationManager.selectedNodeASenseId,
        relationManager.senseLocalId
      );
      return;
    }

    setRelationManager((prev) => ({
      ...prev,
      selectedRelationType: type,
      currentStep: nextStep,
      selectedNodeB: null,
      selectedNodeBSenseId: '',
      insertDirection: 'aToB',
      insertDirectionLocked: false
    }));
  };

  const submitManagedNodeBSearch = useCallback(async (rawKeyword = relationManager.nodeBSearchKeyword) => {
    const keyword = String(rawKeyword || '').trim();
    const keywordMeta = parseAssociationKeyword(keyword);
    const effectiveKeyword = keywordMeta.textKeyword;

    setRelationManager((prev) => ({
      ...prev,
      nodeBSearchKeyword: keyword,
      nodeBSearchAppliedKeyword: keyword
    }));

    if (relationManager.currentStep !== ASSOC_STEPS.SELECT_NODE_B) return;

    if (!keywordMeta.mode && !effectiveKeyword) {
      nodeBSearchRequestIdRef.current += 1;
      setRelationManager((prev) => ({
        ...prev,
        nodeBExtraSearchResults: [],
        nodeBExtraSearchLoading: false
      }));
      return;
    }

    if (keywordMeta.mode || !effectiveKeyword) {
      nodeBSearchRequestIdRef.current += 1;
      setRelationManager((prev) => ({
        ...prev,
        nodeBExtraSearchResults: [],
        nodeBExtraSearchLoading: false
      }));
      return;
    }

    const managedSense = findSenseByLocalId(relationManager.senseLocalId);
    const excludedSenseKeySet = getManagedSenseExcludedKeySet(managedSense);
    const selectedNodeAKey = toSenseKey(relationManager.selectedNodeA, relationManager.selectedNodeASenseId);
    if (selectedNodeAKey) excludedSenseKeySet.add(selectedNodeAKey);

    const requestId = nodeBSearchRequestIdRef.current + 1;
    nodeBSearchRequestIdRef.current = requestId;
    setRelationManager((prev) => ({ ...prev, nodeBExtraSearchLoading: true }));

    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`${API_BASE}/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (requestId !== nodeBSearchRequestIdRef.current) return;
      if (!response.ok) {
        setRelationManager((prev) => ({
          ...prev,
          nodeBExtraSearchLoading: false,
          nodeBExtraSearchResults: []
        }));
        return;
      }

      const data = await response.json();
      const normalized = dedupeBySearchKey((Array.isArray(data) ? data : [])
        .map((item) => normalizeSearchResult(item))
        .filter((item) => item.nodeId && item.senseId && item.searchKey)
        .filter((item) => isRelationManagerCandidateSelectable(item, excludedSenseKeySet))
        .filter((item) => matchesKeywordByTitleAndSense(item, effectiveKeyword)));

      setRelationManager((prev) => ({
        ...prev,
        nodeBExtraSearchLoading: false,
        nodeBExtraSearchResults: normalized
      }));
    } catch (error) {
      if (requestId !== nodeBSearchRequestIdRef.current) return;
      console.error('搜索第二目标释义失败:', error);
      setRelationManager((prev) => ({
        ...prev,
        nodeBExtraSearchLoading: false,
        nodeBExtraSearchResults: []
      }));
    }
  }, [
    relationManager.currentStep,
    relationManager.nodeBSearchKeyword,
    relationManager.selectedNodeA,
    relationManager.selectedNodeASenseId,
    relationManager.senseLocalId,
    findSenseByLocalId,
    getManagedSenseExcludedKeySet,
    isRelationManagerCandidateSelectable
  ]);

  const clearManagedNodeBSearch = () => {
    nodeBSearchRequestIdRef.current += 1;
    setRelationManager((prev) => ({
      ...prev,
      nodeBSearchKeyword: '',
      nodeBSearchAppliedKeyword: '',
      nodeBExtraSearchLoading: false,
      nodeBExtraSearchResults: []
    }));
  };

  const selectManagedNodeB = async (candidate, fromParents) => {
    const managedSense = findSenseByLocalId(relationManager.senseLocalId);
    const excludedSenseKeySet = getManagedSenseExcludedKeySet(managedSense);
    const selectedNodeAKey = toSenseKey(relationManager.selectedNodeA, relationManager.selectedNodeASenseId);
    if (selectedNodeAKey) excludedSenseKeySet.add(selectedNodeAKey);

    const normalized = normalizeSearchResult(candidate);
    if (!isRelationManagerCandidateSelectable(normalized, excludedSenseKeySet)) {
      window.alert('该释义不可选，请更换第二个目标释义');
      return;
    }

    const nodeDetail = await fetchNodeDetailForAssociation(normalized.nodeId);
    const nextNodeB = nodeDetail || normalized;
    const nextSenseId = String(normalized.senseId || '').trim() || normalizeNodeSenses(nextNodeB)[0]?.senseId || '';
    setRelationManager((prev) => ({
      ...prev,
      selectedNodeB: nextNodeB,
      selectedNodeBSenseId: nextSenseId,
      insertDirection: fromParents ? 'bToA' : 'aToB',
      insertDirectionLocked: false,
      currentStep: ASSOC_STEPS.PREVIEW
    }));
  };

  const resolveExistingPairInsertDirection = useCallback(async (nodeA, nodeASenseId, nodeB, nodeBSenseId) => {
    const targetA = toRelationTarget(nodeA, nodeASenseId);
    const targetB = toRelationTarget(nodeB, nodeBSenseId);
    if (!targetA?.searchKey || !targetB?.searchKey) return '';

    const [contextA, contextB] = await Promise.all([
      fetchSenseRelationContext(targetA),
      fetchSenseRelationContext(targetB)
    ]);

    const aContainsB = contextA.childKeySet.has(targetB.searchKey) || contextB.parentKeySet.has(targetA.searchKey);
    if (aContainsB) return 'aToB';

    const bContainsA = contextA.parentKeySet.has(targetB.searchKey) || contextB.childKeySet.has(targetA.searchKey);
    if (bContainsA) return 'bToA';

    return '';
  }, [fetchSenseRelationContext, toRelationTarget]);

  const loadManagedNodeBCandidatesBySense = useCallback(async (
    nodeA = relationManager.selectedNodeA,
    nodeASenseId = relationManager.selectedNodeASenseId,
    senseLocalId = relationManager.senseLocalId
  ) => {
    const targetA = toRelationTarget(nodeA, nodeASenseId);
    if (!targetA?.searchKey) {
      setRelationManager((prev) => ({
        ...prev,
        nodeBCandidates: { parents: [], children: [] }
      }));
      return;
    }
    const requestId = nodeBCandidateResolveRequestIdRef.current + 1;
    nodeBCandidateResolveRequestIdRef.current = requestId;
    const context = await fetchSenseRelationContext(targetA);
    if (requestId !== nodeBCandidateResolveRequestIdRef.current) return;

    const managedSense = findSenseByLocalId(senseLocalId);
    const excludedSenseKeySet = getManagedSenseExcludedKeySet(managedSense);
    if (targetA.searchKey) excludedSenseKeySet.add(targetA.searchKey);
    const normalizeCandidates = (list = []) => dedupeBySearchKey((Array.isArray(list) ? list : [])
      .map((item) => normalizeSearchResult(item))
      .filter((item) => item.nodeId && item.senseId && item.searchKey)
      .filter((item) => isRelationManagerCandidateSelectable(item, excludedSenseKeySet)));

    setRelationManager((prev) => ({
      ...prev,
      nodeBCandidates: {
        parents: normalizeCandidates(context?.parentTargets || []),
        children: normalizeCandidates(context?.childTargets || [])
      }
    }));
  }, [
    relationManager.selectedNodeA,
    relationManager.selectedNodeASenseId,
    relationManager.senseLocalId,
    toRelationTarget,
    fetchSenseRelationContext,
    findSenseByLocalId,
    getManagedSenseExcludedKeySet,
    isRelationManagerCandidateSelectable
  ]);

  const recheckManagedInsertDirectionLock = useCallback(async (nextNodeASenseId = '', nextNodeBSenseId = '') => {
    const isInsertRelation = relationManager.selectedRelationType === ASSOC_RELATION_TYPES.INSERT;
    const hasBothNodes = !!relationManager.selectedNodeA && !!relationManager.selectedNodeB;
    const safeNodeASenseId = String(nextNodeASenseId || '').trim();
    const safeNodeBSenseId = String(nextNodeBSenseId || '').trim();
    if (!isInsertRelation || !hasBothNodes || !safeNodeASenseId || !safeNodeBSenseId) {
      setRelationManager((prev) => ({
        ...prev,
        insertDirectionLocked: false
      }));
      return;
    }

    const requestId = insertDirectionResolveRequestIdRef.current + 1;
    insertDirectionResolveRequestIdRef.current = requestId;
    const fixedDirection = await resolveExistingPairInsertDirection(
      relationManager.selectedNodeA,
      safeNodeASenseId,
      relationManager.selectedNodeB,
      safeNodeBSenseId
    );
    if (requestId !== insertDirectionResolveRequestIdRef.current) return;

    setRelationManager((prev) => {
      if (fixedDirection) {
        return {
          ...prev,
          insertDirection: fixedDirection,
          insertDirectionLocked: true
        };
      }
      return {
        ...prev,
        insertDirection: prev.insertDirection || 'aToB',
        insertDirectionLocked: false
      };
    });
  }, [
    relationManager.selectedRelationType,
    relationManager.selectedNodeA,
    relationManager.selectedNodeB,
    resolveExistingPairInsertDirection
  ]);

  const handleManagedNodeASenseChange = useCallback((senseId = '') => {
    const nextSenseId = String(senseId || '').trim();
    setRelationManager((prev) => ({
      ...prev,
      selectedNodeASenseId: nextSenseId
    }));
    if (relationManager.selectedNodeA) {
      loadManagedNodeBCandidatesBySense(relationManager.selectedNodeA, nextSenseId, relationManager.senseLocalId);
    }
    recheckManagedInsertDirectionLock(nextSenseId, relationManager.selectedNodeBSenseId);
  }, [
    relationManager.selectedNodeA,
    relationManager.selectedNodeBSenseId,
    relationManager.senseLocalId,
    loadManagedNodeBCandidatesBySense,
    recheckManagedInsertDirectionLock
  ]);

  useEffect(() => {
    recheckManagedInsertDirectionLock(
      relationManager.selectedNodeASenseId,
      relationManager.selectedNodeBSenseId
    );
  }, [
    relationManager.selectedNodeASenseId,
    relationManager.selectedNodeBSenseId,
    recheckManagedInsertDirectionLock
  ]);

  useEffect(() => {
    if (
      relationManager.currentStep !== ASSOC_STEPS.SELECT_NODE_B
      || relationManager.selectedRelationType !== ASSOC_RELATION_TYPES.INSERT
    ) {
      return;
    }
    loadManagedNodeBCandidatesBySense(
      relationManager.selectedNodeA,
      relationManager.selectedNodeASenseId,
      relationManager.senseLocalId
    );
  }, [
    relationManager.currentStep,
    relationManager.selectedRelationType,
    relationManager.selectedNodeA,
    relationManager.selectedNodeASenseId,
    relationManager.senseLocalId,
    loadManagedNodeBCandidatesBySense
  ]);

  const goBackManagedRelationStep = () => {
    const currentStep = relationManager.currentStep;
    const previousStep = resolveAssociationBackStep(
      currentStep,
      relationManager.selectedRelationType
    );
    if (!previousStep) {
      resetRelationManagerAddFlow();
      return;
    }

    setRelationManager((prev) => {
      return {
        ...prev,
        currentStep: previousStep
      };
    });
  };

  const cancelManagedRelationFlow = () => {
    resetRelationManagerAddFlow();
  };

  const confirmManagedRelationAdd = () => {
    const managedSense = findSenseByLocalId(relationManager.senseLocalId);
    if (!managedSense) return;

    const relationType = relationManager.selectedRelationType;
    if (!relationType) {
      window.alert('请先选择关系类型');
      return;
    }

    if (relationType === ASSOC_RELATION_TYPES.INSERT) {
      const targetA = toRelationTarget(relationManager.selectedNodeA, relationManager.selectedNodeASenseId);
      const targetB = toRelationTarget(relationManager.selectedNodeB, relationManager.selectedNodeBSenseId);
      if (!targetA || !targetB) {
        window.alert('请先选择两个目标释义');
        return;
      }
      if (targetA.searchKey === targetB.searchKey) {
        window.alert('左右两侧不能选择同一个目标释义');
        return;
      }
      const direction = relationManager.insertDirection === 'bToA'
        ? ASSOC_RELATION_TYPES.EXTENDS
        : ASSOC_RELATION_TYPES.CONTAINS;
      const exists = (Array.isArray(managedSense.relations) ? managedSense.relations : []).some((item) => (
        item.kind === ASSOC_RELATION_TYPES.INSERT
        && item.direction === direction
        && item.leftTarget?.searchKey === targetA.searchKey
        && item.rightTarget?.searchKey === targetB.searchKey
      ));
      if (exists) {
        window.alert('该插入关系已存在');
        return;
      }

      updateSense(managedSense.localId, (sense) => ({
        ...sense,
        relations: [
          ...(Array.isArray(sense.relations) ? sense.relations : []),
          {
            id: makeLocalId('rel'),
            kind: ASSOC_RELATION_TYPES.INSERT,
            relationType: ASSOC_RELATION_TYPES.INSERT,
            direction,
            leftTarget: targetA,
            rightTarget: targetB
          }
        ]
      }));

      resetRelationManagerAddFlow();
      setRelationManager((prev) => ({ ...prev, pendingDeleteRelationId: '' }));
      return;
    }

    const target = toRelationTarget(relationManager.selectedNodeA, relationManager.selectedNodeASenseId);
    if (!target) {
      window.alert('请先选择目标释义');
      return;
    }

    const relationList = Array.isArray(managedSense.relations) ? managedSense.relations : [];
    const duplicated = relationList.some((item) => (
      item.kind === 'single'
      && item.relationType === relationType
      && item.target?.searchKey === target.searchKey
    ));
    if (duplicated) {
      window.alert('该关联关系已存在');
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
      window.alert('同一个释义不能同时包含并拓展同一个目标释义');
      return;
    }

    updateSense(managedSense.localId, (sense) => ({
      ...sense,
      relations: [
        ...(Array.isArray(sense.relations) ? sense.relations : []),
        {
          id: makeLocalId('rel'),
          kind: 'single',
          relationType,
          target
        }
      ]
    }));

    resetRelationManagerAddFlow();
    setRelationManager((prev) => ({ ...prev, pendingDeleteRelationId: '' }));
  };

  const validation = useMemo(() => {
    const normalized = senses.map((sense, index) => {
      const senseTitle = typeof sense?.title === 'string' ? sense.title.trim() : '';
      const senseContent = typeof sense?.content === 'string' ? sense.content.trim() : '';
      return {
        index,
        localId: sense.localId,
        title: senseTitle,
        content: senseContent,
        relations: Array.isArray(sense.relations) ? sense.relations : []
      };
    });

    const duplicateTitleMessageByLocalId = {};
    const titleOwnerMap = new Map();
    normalized.forEach((item) => {
      if (!item.title) return;
      const key = item.title.toLowerCase();
      if (!titleOwnerMap.has(key)) {
        titleOwnerMap.set(key, item);
        return;
      }
      const owner = titleOwnerMap.get(key);
      duplicateTitleMessageByLocalId[item.localId] = `与释义${owner.index + 1}重复`;
      if (!duplicateTitleMessageByLocalId[owner.localId]) {
        duplicateTitleMessageByLocalId[owner.localId] = `与释义${item.index + 1}重复`;
      }
    });

    const fieldErrorsByLocalId = {};
    let hasIncompleteSense = false;
    let hasMissingRelation = false;
    const readySenses = [];

    normalized.forEach((item) => {
      const titleError = !item.title
        ? '释义题目不能为空'
        : (duplicateTitleMessageByLocalId[item.localId] || '');
      const contentError = !item.content ? '释义内容不能为空' : '';
      const relationError = (requiresSenseRelations && item.title && item.content && item.relations.length === 0)
        ? '每个释义至少需要 1 条关联关系'
        : '';

      if (!item.title || !item.content) hasIncompleteSense = true;
      if (requiresSenseRelations && item.title && item.content && item.relations.length === 0) hasMissingRelation = true;

      fieldErrorsByLocalId[item.localId] = {
        title: titleError,
        content: contentError,
        relation: relationError
      };
      if (!titleError && !contentError && !relationError) readySenses.push(item);
    });

    return {
      fieldErrorsByLocalId,
      hasDuplicateSenseTitle: Object.keys(duplicateTitleMessageByLocalId).length > 0,
      hasIncompleteSense,
      hasMissingRelation,
      readySenses
    };
  }, [requiresSenseRelations, senses]);

  const canSubmit = useMemo(() => {
    if (isTitleDuplicated) return false;
    if (!title.trim() || !description.trim()) return false;
    if (senses.length === 0) return false;
    if (validation.hasDuplicateSenseTitle || validation.hasIncompleteSense || validation.hasMissingRelation) return false;
    return validation.readySenses.length === senses.length;
  }, [isTitleDuplicated, title, description, senses.length, validation]);
  const submitBlockedReason = useMemo(() => {
    if (isTitleDuplicated) return '标题已存在，请更换后再提交';
    if (!title.trim()) return '请先填写标题';
    if (!description.trim()) return '请先填写概述';
    if (senses.length === 0) return '请至少添加一个释义';
    if (validation.hasDuplicateSenseTitle) return '释义题目有重复，请先修改';
    if (validation.hasIncompleteSense) return '请先补全释义题目和内容';
    if (validation.hasMissingRelation) return '请先为每个释义设置至少 1 条关联';
    return '请完成所有必填信息后再提交';
  }, [isTitleDuplicated, title, description, senses.length, validation]);

  const showSubmitLightHint = useCallback((message = '') => {
    const nextText = String(message || submitBlockedReason || '请完成所有必填信息后再提交').trim();
    if (!nextText) return;
    setSubmitLightTip(nextText);
    if (submitLightTipTimerRef.current) {
      clearTimeout(submitLightTipTimerRef.current);
    }
    submitLightTipTimerRef.current = setTimeout(() => {
      setSubmitLightTip('');
      submitLightTipTimerRef.current = null;
    }, 1800);
  }, [submitBlockedReason]);

  const submitNodeCreation = async () => {
    if (!canSubmit) {
      window.alert('请完成所有必填信息后再提交');
      return;
    }

    const token = localStorage.getItem('token');
    const x = Math.random() * 700 + 50;
    const y = Math.random() * 400 + 50;

    const synonymSenses = validation.readySenses.map((sense, index) => ({
      senseId: `sense_${index + 1}`,
      title: sense.title,
      content: sense.content
    }));
    const senseIdByLocalId = validation.readySenses.reduce((acc, sense, index) => {
      acc[sense.localId] = `sense_${index + 1}`;
      return acc;
    }, {});

    const associations = [];
    validation.readySenses.forEach((sense) => {
      const sourceSenseId = senseIdByLocalId[sense.localId] || '';
      sense.relations.forEach((relation) => {
        if (relation.kind === 'single' && relation.target?.nodeId && relation.target?.senseId) {
          const backendRelationType = relation.relationType === ASSOC_RELATION_TYPES.EXTENDS
            ? ASSOC_RELATION_TYPES.CONTAINS
            : ASSOC_RELATION_TYPES.EXTENDS;
          associations.push({
            targetNode: relation.target.nodeId,
            relationType: backendRelationType,
            sourceSenseId,
            targetSenseId: relation.target.senseId
          });
        }
        if (relation.kind === ASSOC_RELATION_TYPES.INSERT && relation.leftTarget?.nodeId && relation.rightTarget?.nodeId) {
          const upperTarget = relation.direction === ASSOC_RELATION_TYPES.EXTENDS ? relation.rightTarget : relation.leftTarget;
          const lowerTarget = relation.direction === ASSOC_RELATION_TYPES.EXTENDS ? relation.leftTarget : relation.rightTarget;
          associations.push({
            targetNode: upperTarget.nodeId,
            relationType: ASSOC_RELATION_TYPES.INSERT,
            sourceSenseId,
            targetSenseId: upperTarget.senseId,
            insertSide: 'left',
            insertGroupId: relation.id
          });
          associations.push({
            targetNode: lowerTarget.nodeId,
            relationType: ASSOC_RELATION_TYPES.INSERT,
            sourceSenseId,
            targetSenseId: lowerTarget.senseId,
            insertSide: 'right',
            insertGroupId: relation.id
          });
        }
      });
    });

    const payload = {
      name: title.trim(),
      description: description.trim(),
      position: { x, y },
      synonymSenses,
      associations
    };

    try {
      const response = await fetch(`${API_BASE}/nodes/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        window.alert(data?.error || '创建失败');
        return;
      }

      window.alert(data?.status === 'pending' ? '新知识域申请已提交，等待管理员审批' : '新知识域创建成功');
      onSuccess(data || null);
      onClose();
    } catch (error) {
      console.error('创建知识域失败:', error);
      window.alert('创建失败');
    }
  };

  const handleSubmitAction = () => {
    if (!canSubmit) {
      showSubmitLightHint();
      return;
    }
    setSubmitLightTip('');
    if (submitLightTipTimerRef.current) {
      clearTimeout(submitLightTipTimerRef.current);
      submitLightTipTimerRef.current = null;
    }
    submitNodeCreation();
  };

  const managedSense = relationManager.isOpen
    ? (senses.find((sense) => sense.localId === relationManager.senseLocalId) || null)
    : null;
  const managedSenseIndex = managedSense
    ? senses.findIndex((sense) => sense.localId === managedSense.localId)
    : -1;
  const managedSenseFieldErrors = managedSense
    ? (validation.fieldErrorsByLocalId[managedSense.localId] || { title: '', content: '', relation: '' })
    : { title: '', content: '', relation: '' };
  const sourceDisplay = managedSense?.title?.trim() || `当前释义${managedSenseIndex >= 0 ? managedSenseIndex + 1 : ''}`;
  const targetDisplay = formatNodeSenseDisplay(relationManager.selectedNodeA, relationManager.selectedNodeASenseId);
  const secondTargetDisplay = formatNodeSenseDisplay(relationManager.selectedNodeB, relationManager.selectedNodeBSenseId);

  const managedExcludedSenseKeySet = getManagedSenseExcludedKeySet(managedSense);
  const selectedNodeAKey = toSenseKey(relationManager.selectedNodeA, relationManager.selectedNodeASenseId);

  const managedNodeBView = (() => {
    const keywordMeta = parseAssociationKeyword(relationManager.nodeBSearchAppliedKeyword);
    const keywordText = keywordMeta.textKeyword;
    const keywordMode = keywordMeta.mode;
    const hasSubmittedSearch = !!String(relationManager.nodeBSearchAppliedKeyword || '').trim();

    const excludedSenseKeySet = new Set(managedExcludedSenseKeySet);
    if (selectedNodeAKey) excludedSenseKeySet.add(selectedNodeAKey);

    const normalizeCandidateList = (list = []) => dedupeBySearchKey(
      (Array.isArray(list) ? list : [])
        .map((item) => normalizeSearchResult(item))
        .filter((item) => item.nodeId && item.senseId && item.searchKey)
    );

    const matchNodeBCandidate = (nodeLike = {}) => matchesKeywordByTitleAndSense(nodeLike, keywordText);
    const isNodeBCandidateSelectable = (nodeLike = {}) => (
      isRelationManagerCandidateSelectable(nodeLike, excludedSenseKeySet)
    );

    const normalizedParents = normalizeCandidateList(relationManager.nodeBCandidates.parents);
    const normalizedChildren = normalizeCandidateList(relationManager.nodeBCandidates.children);

    const filteredNodeBCandidates = hasSubmittedSearch
      ? {
        parents: normalizedParents.filter((item) => isNodeBCandidateSelectable(item) && matchNodeBCandidate(item)),
        children: normalizedChildren.filter((item) => isNodeBCandidateSelectable(item) && matchNodeBCandidate(item))
      }
      : { parents: [], children: [] };

    const visibleParentsRaw = hasSubmittedSearch && keywordMode !== 'expand' ? filteredNodeBCandidates.parents : [];
    const visibleChildrenRaw = hasSubmittedSearch && keywordMode !== 'include' ? filteredNodeBCandidates.children : [];

    const baseCandidateKeySet = new Set([
      ...filteredNodeBCandidates.parents.map((item) => item?.searchKey || ''),
      ...filteredNodeBCandidates.children.map((item) => item?.searchKey || '')
    ].filter(Boolean));

    const extraNodeBCandidates = (!hasSubmittedSearch || keywordMode)
      ? []
      : normalizeCandidateList(relationManager.nodeBExtraSearchResults).filter((node) => {
        if (baseCandidateKeySet.has(node?.searchKey || '')) return false;
        if (!keywordText.trim()) return false;
        if (!isNodeBCandidateSelectable(node)) return false;
        return matchNodeBCandidate(node);
      });

    const toParentHint = (node) => `插入到 ${node.displayName || formatNodeSenseDisplay(node, node.senseId)} 和 ${targetDisplay} 之间`;
    const toChildHint = (node) => `插入到 ${targetDisplay} 和 ${node.displayName || formatNodeSenseDisplay(node, node.senseId)} 之间`;

    return {
      parents: visibleParentsRaw.map((node) => ({ ...node, hint: toParentHint(node) })),
      children: visibleChildrenRaw.map((node) => ({ ...node, hint: toChildHint(node) })),
      extra: extraNodeBCandidates.map((node) => ({
        ...node,
        hint: `插入到 ${targetDisplay} 和 ${node.displayName || formatNodeSenseDisplay(node, node.senseId)} 之间（将新建承接关系）`
      }))
    };
  })();

  const selectedNodeBSenseKey = toSenseKey(relationManager.selectedNodeB, relationManager.selectedNodeBSenseId);

  const nodeASenseOptions = normalizeNodeSenses(relationManager.selectedNodeA, relationManager.selectedNodeASenseId)
    .filter((sense) => {
      if (
        relationManager.currentStep === ASSOC_STEPS.PREVIEW
        && relationManager.selectedRelationType === ASSOC_RELATION_TYPES.INSERT
        && selectedNodeBSenseKey
      ) {
        const key = toSenseKey(relationManager.selectedNodeA, sense.senseId);
        if (key === selectedNodeBSenseKey) return false;
      }
      return true;
    });

  const insertRelationAvailable = (
    Array.isArray(relationManager.nodeBCandidates.parents) && relationManager.nodeBCandidates.parents.length > 0
  ) || (
    Array.isArray(relationManager.nodeBCandidates.children) && relationManager.nodeBCandidates.children.length > 0
  );
  const hasSelectedNodeA = !!String(
    relationManager.selectedNodeA?._id
    || relationManager.selectedNodeA?.nodeId
    || ''
  ).trim();
  const insertRelationUnavailableReason = (
    hasSelectedNodeA
    && relationManager.selectedNodeASenseId
    && !insertRelationAvailable
  )
    ? '当前目标释义在释义层没有可用的 #include / #expand 链路，无法创建插入关系。'
    : '';

  const previewInfoText = (() => {
    if (relationManager.selectedRelationType === ASSOC_RELATION_TYPES.EXTENDS) {
      return `${sourceDisplay} ${REL_SYMBOL_SUPERSET} ${targetDisplay}`;
    }
    if (relationManager.selectedRelationType === ASSOC_RELATION_TYPES.CONTAINS) {
      return `${sourceDisplay} ${REL_SYMBOL_SUBSET} ${targetDisplay}`;
    }
    if (relationManager.selectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
      const relationSymbol = relationManager.insertDirection === 'bToA' ? REL_SYMBOL_SUBSET : REL_SYMBOL_SUPERSET;
      const chainPreview = `${targetDisplay} ${relationSymbol} ${sourceDisplay} ${relationSymbol} ${secondTargetDisplay}`;
      if (relationManager.insertDirectionLocked) {
        return `${sourceDisplay} 将插入到 ${targetDisplay} 和 ${secondTargetDisplay} 之间，原有链路将改为：${chainPreview}`;
      }
      return `${sourceDisplay} 将插入到 ${targetDisplay} 和 ${secondTargetDisplay} 之间，将新建链路：${chainPreview}`;
    }
    return '';
  })();

  useEffect(() => {
    if (relationManager.currentStep === ASSOC_STEPS.PREVIEW && previewCanvasRef.current) {
      const canvas = previewCanvasRef.current;
      const shouldRecreateRenderer = (
        !previewRendererRef.current
        || previewRendererRef.current.canvas !== canvas
      );
      if (shouldRecreateRenderer) {
        if (previewRendererRef.current) {
          previewRendererRef.current.destroy();
        }
        previewRendererRef.current = new MiniPreviewRenderer(canvas);
      }

      previewRendererRef.current.setPreviewScene({
        nodeA: relationManager.selectedNodeA,
        nodeB: relationManager.selectedNodeB,
        relationType: relationManager.selectedRelationType,
        newNodeName: sourceDisplay,
        insertDirection: relationManager.insertDirection || 'aToB',
        nodeALabel: targetDisplay,
        nodeBLabel: secondTargetDisplay,
        newNodeLabel: sourceDisplay,
        showPendingTag: !isAdmin
      });
    }

    return () => {
      if (relationManager.currentStep !== ASSOC_STEPS.PREVIEW && previewRendererRef.current) {
        previewRendererRef.current.destroy();
        previewRendererRef.current = null;
      }
    };
  }, [
    relationManager.currentStep,
    relationManager.selectedNodeA,
    relationManager.selectedNodeB,
    relationManager.selectedRelationType,
    relationManager.insertDirection,
    relationManager.selectedNodeASenseId,
    relationManager.selectedNodeBSenseId,
    isAdmin,
    sourceDisplay,
    targetDisplay,
    secondTargetDisplay
  ]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content create-node-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>创建新知识域</h3>
          <button onClick={onClose} className="btn btn-danger btn-small">
            <X className="icon-small" />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>创建者</label>
            <div className="form-input read-only">{username}</div>
          </div>

          <div className="form-group">
            <label>标题 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
              placeholder="输入知识域总标题"
              maxLength={50}
            />
            {title.trim() === '' && <span className="error-text">标题不能为空</span>}
            {isTitleDuplicated && <span className="error-text">该标题已存在（审核通过）</span>}
          </div>

          <div className="form-group">
            <label>概述 *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-textarea"
              rows={3}
              placeholder="输入该知识域总体概述"
              maxLength={300}
            />
            {description.trim() === '' && <span className="error-text">概述不能为空</span>}
          </div>

          <div className="associations-section">
            <div className="associations-header">
              <h4>同义词释义（{requiresSenseRelations ? '每个释义必须有至少 1 条关系' : '当前可暂不设置关联关系'}）</h4>
              <button type="button" className="btn btn-secondary btn-small" onClick={addSense}>
                <Plus className="icon-small" /> 新增释义
              </button>
            </div>

            <div className="sense-list-scroll">
              {senses.map((sense, index) => {
                const fieldErrors = validation.fieldErrorsByLocalId[sense.localId] || { title: '', content: '', relation: '' };

                return (
                  <div key={sense.localId} className="sense-card">
                    <div className="sense-card-header">
                      <strong className="node-name">{`释义 ${index + 1}`}</strong>
                      <span className="sense-relation-count">{`已添加 ${sense.relations.length} 条`}</span>
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => removeSense(sense.localId)}
                        disabled={senses.length <= 1}
                      >
                        <Trash2 className="icon-small" />
                      </button>
                    </div>

                    <input
                      type="text"
                      className="form-input"
                      placeholder="释义题目（同一标题下不可重名）"
                      value={sense.title}
                      onChange={(e) => updateSenseField(sense.localId, 'title', e.target.value)}
                    />
                    {fieldErrors.title && <span className="error-text inline-field-error">{fieldErrors.title}</span>}

                    <textarea
                      className="form-textarea"
                      rows={3}
                      placeholder="该释义下的知识内容"
                      value={sense.content}
                      onChange={(e) => updateSenseField(sense.localId, 'content', e.target.value)}
                    />
                    {fieldErrors.content && <span className="error-text inline-field-error">{fieldErrors.content}</span>}

                    <div className="sense-relations-summary">
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        onClick={() => openRelationManager(sense.localId)}
                      >
                        关联管理
                      </button>
                      <span className="sense-relations-summary-text">
                        已设置 {sense.relations.length} 条关联
                      </span>
                    </div>
                    {fieldErrors.relation && <span className="error-text inline-field-error">{fieldErrors.relation}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">取消</button>
          <div className="create-node-submit-wrap">
            <button
              onClick={handleSubmitAction}
              className={`btn btn-primary ${!canSubmit ? 'is-disabled' : ''}`}
              aria-disabled={!canSubmit}
            >
              {isAdmin ? '确认创建新知识域' : '提交新知识域申请'}
            </button>
            {!canSubmit && !!submitLightTip && (
              <span className="create-node-submit-light-tip">{submitLightTip}</span>
            )}
          </div>
        </div>

        <CreateNodeAssociationManager
          isOpen={relationManager.isOpen}
          relationManager={relationManager}
          managedSense={managedSense}
          managedSenseIndex={managedSenseIndex}
          managedSenseFieldErrors={managedSenseFieldErrors}
          relSymbolSubset={REL_SYMBOL_SUBSET}
          relSymbolSuperset={REL_SYMBOL_SUPERSET}
          buildRelationDisplayText={buildRelationDisplayText}
          steps={ASSOC_STEPS}
          relationTypes={ASSOC_RELATION_TYPES}
          sourceDisplay={sourceDisplay}
          targetDisplay={targetDisplay}
          secondTargetDisplay={secondTargetDisplay}
          nodeASenseOptions={nodeASenseOptions}
          nodeBCandidatesParents={managedNodeBView.parents}
          nodeBCandidatesChildren={managedNodeBView.children}
          nodeBCandidatesExtra={managedNodeBView.extra}
          previewCanvasRef={previewCanvasRef}
          previewInfoText={previewInfoText}
          insertRelationAvailable={insertRelationAvailable}
          insertRelationUnavailableReason={insertRelationUnavailableReason}
          onClose={closeRelationManager}
          onRequestDeleteRelation={requestRemoveManagedRelation}
          onConfirmDeleteRelation={confirmRemoveManagedRelation}
          onCancelDeleteRelation={cancelRemoveManagedRelation}
          onStartManagedRelationEditor={startManagedRelationEditor}
          onNodeASearchKeywordChange={(value) => setRelationManager((prev) => ({ ...prev, searchKeyword: value }))}
          onSubmitNodeASearch={() => searchManagedNodeA(relationManager.searchKeyword)}
          onClearNodeASearch={clearManagedNodeASearch}
          onSelectNodeA={selectManagedNodeA}
          onChangeNodeASenseId={handleManagedNodeASenseChange}
          onSelectRelationType={selectManagedRelationType}
          onNodeBSearchKeywordChange={(value) => setRelationManager((prev) => ({ ...prev, nodeBSearchKeyword: value }))}
          onSubmitNodeBSearch={(keyword) => submitManagedNodeBSearch(keyword ?? relationManager.nodeBSearchKeyword)}
          onClearNodeBSearch={clearManagedNodeBSearch}
          onSelectNodeBParent={(node) => selectManagedNodeB(node, true)}
          onSelectNodeBChild={(node) => selectManagedNodeB(node, false)}
          onSelectNodeBExtra={(node) => selectManagedNodeB(node, false)}
          onConfirmManagedRelationAdd={confirmManagedRelationAdd}
          onGoBackFlow={goBackManagedRelationStep}
          onCancelFlow={cancelManagedRelationFlow}
        />
      </div>
    </div>
  );
};

export default CreateNodeModal;
