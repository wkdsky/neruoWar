import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Search, Trash2, Link2 } from 'lucide-react';
import './CreateNodeModal.css';

const RELATION_OPTIONS = [
  { value: 'contains', label: '包含', hint: '当前释义在上，目标释义在下（下级）' },
  { value: 'extends', label: '扩展', hint: '目标释义在上，当前释义在下（上级）' },
  { value: 'insert', label: '插入', hint: '左右可切换方向；若原有上下级关系则自动锁定方向并按该方向重连' }
];

const RELATION_LABEL_MAP = {
  contains: '包含（下级）',
  extends: '扩展（上级）',
  insert: '插入（左右连接）'
};

const makeLocalId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const createSenseDraft = () => ({
  localId: makeLocalId('sense'),
  title: '',
  content: '',
  relationType: 'contains',
  selectedTarget: null,
  insertLeftTarget: null,
  insertRightTarget: null,
  insertDirection: 'contains',
  insertDirectionLocked: false,
  insertDirectionHint: '',
  relations: []
});

const normalizeSearchResult = (item) => ({
  nodeId: item?.nodeId || item?._id || '',
  senseId: typeof item?.senseId === 'string' ? item.senseId : '',
  displayName: item?.displayName || item?.name || '',
  domainName: item?.domainName || item?.name || '',
  senseTitle: item?.senseTitle || item?.activeSenseTitle || '',
  description: item?.senseContent || item?.description || '',
  searchKey: item?.searchKey || `${item?.nodeId || item?._id || ''}:${item?.senseId || ''}`,
  relationToAnchor: item?.relationToAnchor || ''
});

const escapeRegExp = (text = '') => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const renderKeywordHighlight = (text, rawQuery) => {
  const content = typeof text === 'string' ? text : '';
  const keywords = String(rawQuery || '')
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!content || keywords.length === 0) return content;
  const uniqueKeywords = Array.from(new Set(keywords.map((item) => item.toLowerCase())));
  const pattern = uniqueKeywords.map((item) => escapeRegExp(item)).join('|');
  if (!pattern) return content;
  const matcher = new RegExp(`(${pattern})`, 'ig');
  const parts = content.split(matcher);
  return parts.map((part, index) => {
    const lowered = part.toLowerCase();
    const matched = uniqueKeywords.some((keyword) => keyword === lowered);
    if (!matched) return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
    return <mark key={`mark-${index}`} className="subtle-keyword-highlight">{part}</mark>;
  });
};

const createTargetSelectorState = () => ({
  isOpen: false,
  senseLocalId: '',
  side: 'single',
  keyword: '',
  loading: false,
  results: [],
  selected: null
});

const parseSelectorKeyword = (rawKeyword = '') => {
  const tokens = String(rawKeyword || '')
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  let mode = '';
  const textTokens = [];
  tokens.forEach((token) => {
    const lowered = token.toLowerCase().replace(/[，,;；。！!？?]+$/g, '');
    if (lowered === '#include' || lowered.startsWith('#include')) {
      mode = 'include';
      return;
    }
    if (lowered === '#expand' || lowered.startsWith('#expand')) {
      mode = 'expand';
      return;
    }
    textTokens.push(token);
  });
  return {
    mode,
    textKeyword: textTokens.join(' ').trim()
  };
};

const matchesKeywordByTitleAndSense = (item = {}, textKeyword = '') => {
  const normalizedKeyword = String(textKeyword || '').trim().toLowerCase();
  if (!normalizedKeyword) return true;
  const keywords = normalizedKeyword.split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return true;
  const searchText = `${item?.domainName || ''} ${item?.senseTitle || ''}`.toLowerCase();
  return keywords.every((keyword) => searchText.includes(keyword));
};

const CreateNodeModal = ({
  isOpen,
  onClose,
  username,
  existingNodes,
  onSuccess
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [senses, setSenses] = useState([createSenseDraft()]);
  const [targetSelector, setTargetSelector] = useState(createTargetSelectorState());
  const [isRelationHelpOpen, setIsRelationHelpOpen] = useState(false);
  const relationContextCacheRef = useRef(new Map());

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setDescription('');
    setSenses([createSenseDraft()]);
    setTargetSelector(createTargetSelectorState());
    setIsRelationHelpOpen(false);
    relationContextCacheRef.current = new Map();
  }, [isOpen]);

  const approvedNameSet = useMemo(() => (
    new Set((Array.isArray(existingNodes) ? existingNodes : [])
      .filter((node) => node?.status === 'approved' && typeof node?.name === 'string')
      .map((node) => node.name.trim())
      .filter(Boolean))
  ), [existingNodes]);

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

  const getAnchorTargetFromSense = useCallback((sense, side = 'single') => {
    if (!sense || side === 'single') return null;
    return side === 'left' ? (sense.insertRightTarget || null) : (sense.insertLeftTarget || null);
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
      const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${nodeId}?senseId=${encodeURIComponent(senseId)}`);
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
        (Array.isArray(list) ? list : [])
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
      );
      const parentTargets = normalizeNodeList(detailNode?.parentNodesInfo || data?.parentNodes || []);
      const childTargets = normalizeNodeList(detailNode?.childNodesInfo || data?.childNodes || []);
      const parentKeySet = new Set(parentTargets.map((item) => item.searchKey));
      const childKeySet = new Set(childTargets.map((item) => item.searchKey));

      (Array.isArray(detailNode?.associations) ? detailNode.associations : []).forEach((assoc) => {
        const relationType = assoc?.relationType;
        if (relationType !== 'extends' && relationType !== 'contains') return;
        const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
        if (sourceSenseId && sourceSenseId !== activeSenseId) return;
        const targetNodeId = getTargetNodeId(assoc?.targetNode);
        const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
        if (!targetNodeId || !targetSenseId) return;
        const relationKey = `${targetNodeId}:${targetSenseId}`;
        if (relationType === 'extends') {
          parentKeySet.add(relationKey);
        } else if (relationType === 'contains') {
          childKeySet.add(relationKey);
        }
      });

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

  const syncInsertDirectionByTargets = useCallback(async (senseLocalId, leftTarget, rightTarget) => {
    if (!leftTarget?.searchKey || !rightTarget?.searchKey) {
      updateSense(senseLocalId, (sense) => ({
        ...sense,
        insertDirectionLocked: false,
        insertDirectionHint: '先选定左右释义；若两者无直接上下级，可点击线段在“→包含→包含 / ←拓展←拓展”之间切换。'
      }));
      return;
    }

    const [leftContext, rightContext] = await Promise.all([
      fetchSenseRelationContext(leftTarget),
      fetchSenseRelationContext(rightTarget)
    ]);
    const rightKey = rightTarget.searchKey;
    const leftKey = leftTarget.searchKey;
    const rightIsChild = leftContext.childKeySet.has(rightKey) || rightContext.parentKeySet.has(leftKey);
    const rightIsParent = leftContext.parentKeySet.has(rightKey) || rightContext.childKeySet.has(leftKey);

    if (rightIsChild || rightIsParent) {
      updateSense(senseLocalId, (sense) => ({
        ...sense,
        insertDirection: rightIsChild ? 'contains' : 'extends',
        insertDirectionLocked: true,
        insertDirectionHint: rightIsChild
          ? '已识别：左侧与右侧原本是“上级→下级”，方向已锁定为“→包含→包含”。'
          : '已识别：左侧与右侧原本是“下级←上级”，方向已锁定为“←拓展←拓展”。'
      }));
      return;
    }

    updateSense(senseLocalId, (sense) => ({
      ...sense,
      insertDirectionLocked: false,
      insertDirectionHint: '左右释义当前无直接上下级，可点击线段在“→包含→包含 / ←拓展←拓展”之间切换。'
    }));
  }, [fetchSenseRelationContext, updateSense]);

  const addSense = () => {
    setSenses((prev) => [...prev, createSenseDraft()]);
  };

  const removeSense = (localId) => {
    setSenses((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item.localId !== localId);
    });
    setTargetSelector((prev) => (prev.senseLocalId === localId ? createTargetSelectorState() : prev));
  };

  const updateSenseField = (localId, field, value) => {
    updateSense(localId, { [field]: value });
  };

  const closeTargetSelector = () => {
    setTargetSelector(createTargetSelectorState());
  };

  const openTargetSelector = (senseLocalId, side = 'single') => {
    const sense = findSenseByLocalId(senseLocalId);
    if (!sense) return;

    let selected = null;
    if (side === 'left') selected = sense.insertLeftTarget || null;
    if (side === 'right') selected = sense.insertRightTarget || null;
    if (side === 'single') selected = sense.selectedTarget || null;

    setTargetSelector({
      isOpen: true,
      senseLocalId,
      side,
      keyword: '',
      loading: false,
      results: [],
      selected
    });
  };

  useEffect(() => {
    if (!targetSelector.isOpen) return undefined;
    const keywordMeta = parseSelectorKeyword(targetSelector.keyword);
    if (!keywordMeta.textKeyword && !keywordMeta.mode) {
      setTargetSelector((prev) => ({ ...prev, loading: false, results: [] }));
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setTargetSelector((prev) => ({ ...prev, loading: true }));
      const token = localStorage.getItem('token');
      try {
        const currentSense = senses.find((item) => item.localId === targetSelector.senseLocalId) || null;
        const anchorTarget = getAnchorTargetFromSense(currentSense, targetSelector.side);
        const anchorContext = anchorTarget ? await fetchSenseRelationContext(anchorTarget) : null;
        let results = [];

        if (keywordMeta.mode === 'include' || keywordMeta.mode === 'expand') {
          if (anchorContext) {
            results = keywordMeta.mode === 'include'
              ? anchorContext.parentTargets
              : anchorContext.childTargets;
          }
        } else if (keywordMeta.textKeyword) {
          const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(keywordMeta.textKeyword)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (response.ok) {
            const data = await response.json();
            results = (Array.isArray(data) ? data : [])
              .map(normalizeSearchResult)
              .filter((item) => item.nodeId && item.senseId && item.displayName);
          }
        }

        if (keywordMeta.textKeyword) {
          results = results.filter((item) => matchesKeywordByTitleAndSense(item, keywordMeta.textKeyword));
        }

        const excludedSearchKey = targetSelector.side === 'left'
          ? (currentSense?.insertRightTarget?.searchKey || '')
          : (targetSelector.side === 'right' ? (currentSense?.insertLeftTarget?.searchKey || '') : '');
        let filteredResults = excludedSearchKey
          ? results.filter((item) => item.searchKey !== excludedSearchKey)
          : results;

        if (anchorContext) {
          filteredResults = filteredResults.map((item) => {
            let relationToAnchor = '无关';
            if (anchorContext.parentKeySet.has(item.searchKey)) relationToAnchor = '上级';
            if (anchorContext.childKeySet.has(item.searchKey)) relationToAnchor = '下级';
            return { ...item, relationToAnchor };
          });
        }

        if (!cancelled) {
          setTargetSelector((prev) => ({ ...prev, loading: false, results: filteredResults }));
        }
      } catch (error) {
        console.error('搜索节点失败:', error);
        if (!cancelled) {
          setTargetSelector((prev) => ({ ...prev, loading: false, results: [] }));
        }
      }
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    targetSelector.isOpen,
    targetSelector.keyword,
    targetSelector.side,
    targetSelector.senseLocalId,
    senses,
    getAnchorTargetFromSense,
    fetchSenseRelationContext
  ]);

  const confirmTargetSelection = () => {
    if (!targetSelector.selected?.nodeId || !targetSelector.selected?.senseId) {
      window.alert('请先选择一个目标释义');
      return;
    }

    const selected = targetSelector.selected;
    const side = targetSelector.side;
    const senseLocalId = targetSelector.senseLocalId;
    const currentSense = findSenseByLocalId(senseLocalId);
    const nextLeftTarget = side === 'left' ? selected : (currentSense?.insertLeftTarget || null);
    const nextRightTarget = side === 'right' ? selected : (currentSense?.insertRightTarget || null);
    updateSense(senseLocalId, (sense) => {
      if (side === 'left') return { ...sense, insertLeftTarget: selected };
      if (side === 'right') return { ...sense, insertRightTarget: selected };
      return { ...sense, selectedTarget: selected };
    });
    if (side === 'left' || side === 'right') {
      syncInsertDirectionByTargets(senseLocalId, nextLeftTarget, nextRightTarget);
    }
    closeTargetSelector();
  };

  const toggleInsertDirection = (senseLocalId) => {
    updateSense(senseLocalId, (sense) => {
      if (sense.insertDirectionLocked) return sense;
      return {
        ...sense,
        insertDirection: sense.insertDirection === 'extends' ? 'contains' : 'extends'
      };
    });
  };

  const addRelationToSense = (senseLocalId) => {
    updateSense(senseLocalId, (sense) => {
      if (sense.relationType === 'insert') {
        if (!sense.insertLeftTarget?.nodeId || !sense.insertRightTarget?.nodeId) {
          window.alert('请先分别选择左侧和右侧目标释义');
          return sense;
        }
        if (sense.insertLeftTarget.searchKey === sense.insertRightTarget.searchKey) {
          window.alert('左右两侧不能选择同一个目标释义');
          return sense;
        }

        const exists = sense.relations.some((item) => (
          item.kind === 'insert'
          && item.direction === (sense.insertDirection === 'extends' ? 'extends' : 'contains')
          && item.leftTarget?.searchKey === sense.insertLeftTarget.searchKey
          && item.rightTarget?.searchKey === sense.insertRightTarget.searchKey
        ));
        if (exists) {
          window.alert('该插入关系已存在');
          return sense;
        }

        return {
          ...sense,
          relations: [
            ...sense.relations,
            {
              id: makeLocalId('rel'),
              kind: 'insert',
              relationType: 'insert',
              direction: sense.insertDirection === 'extends' ? 'extends' : 'contains',
              leftTarget: sense.insertLeftTarget,
              rightTarget: sense.insertRightTarget
            }
          ],
          insertLeftTarget: null,
          insertRightTarget: null,
          insertDirectionLocked: false,
          insertDirectionHint: '先选定左右释义；若两者无直接上下级，可点击线段在“→包含→包含 / ←拓展←拓展”之间切换。'
        };
      }

      if (!sense.selectedTarget?.nodeId || !sense.selectedTarget?.senseId) {
        window.alert('请先选择目标释义');
        return sense;
      }

      const oppositeType = sense.relationType === 'contains' ? 'extends' : 'contains';
      const hasOpposite = sense.relations.some((item) => (
        item.kind === 'single'
        && item.relationType === oppositeType
        && item.target?.searchKey === sense.selectedTarget.searchKey
      ));
      if (hasOpposite) {
        window.alert('同一个释义不能同时包含并拓展同一个目标释义');
        return sense;
      }

      const exists = sense.relations.some((item) => (
        item.kind === 'single'
        && item.relationType === sense.relationType
        && item.target?.searchKey === sense.selectedTarget.searchKey
      ));
      if (exists) {
        window.alert('该关联关系已存在');
        return sense;
      }

      return {
        ...sense,
        relations: [
          ...sense.relations,
          {
            id: makeLocalId('rel'),
            kind: 'single',
            relationType: sense.relationType,
            target: sense.selectedTarget
          }
        ],
        selectedTarget: null
      };
    });
  };

  const removeRelationFromSense = (senseLocalId, relationId) => {
    updateSense(senseLocalId, (sense) => ({
      ...sense,
      relations: sense.relations.filter((item) => item.id !== relationId)
    }));
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
      const relationError = (item.title && item.content && item.relations.length === 0)
        ? '每个释义至少需要 1 条关联关系'
        : '';

      if (!item.title || !item.content) hasIncompleteSense = true;
      if (item.title && item.content && item.relations.length === 0) hasMissingRelation = true;
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
  }, [senses]);

  const canSubmit = useMemo(() => {
    if (isTitleDuplicated) return false;
    if (!title.trim() || !description.trim()) return false;
    if (senses.length === 0) return false;
    if (validation.hasDuplicateSenseTitle || validation.hasIncompleteSense || validation.hasMissingRelation) return false;
    return validation.readySenses.length === senses.length;
  }, [isTitleDuplicated, title, description, senses.length, validation]);

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
          associations.push({
            targetNode: relation.target.nodeId,
            relationType: relation.relationType,
            sourceSenseId,
            targetSenseId: relation.target.senseId
          });
        }
        if (relation.kind === 'insert' && relation.leftTarget?.nodeId && relation.rightTarget?.nodeId) {
          const upperTarget = relation.direction === 'extends' ? relation.rightTarget : relation.leftTarget;
          const lowerTarget = relation.direction === 'extends' ? relation.leftTarget : relation.rightTarget;
          associations.push({
            targetNode: upperTarget.nodeId,
            relationType: 'insert',
            sourceSenseId,
            targetSenseId: upperTarget.senseId,
            insertSide: 'left',
            insertGroupId: relation.id
          });
          associations.push({
            targetNode: lowerTarget.nodeId,
            relationType: 'insert',
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
      const response = await fetch('http://localhost:5000/api/nodes/create', {
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

      window.alert(data?.status === 'pending' ? '知识域申请已提交，等待管理员审批' : '知识域创建成功');
      onSuccess(data || null);
      onClose();
    } catch (error) {
      console.error('创建节点失败:', error);
      window.alert('创建失败');
    }
  };

  if (!isOpen) return null;

  const parsedSelectorKeyword = parseSelectorKeyword(targetSelector.keyword);
  const selectorSearchHighlightKeyword = parsedSelectorKeyword.textKeyword || '';
  const selectorTitle = targetSelector.side === 'left'
    ? '选择左侧释义'
    : (targetSelector.side === 'right' ? '选择右侧释义' : '选择目标释义');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content create-node-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>创建知识域</h3>
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
              <h4>同义词释义（每个释义必须有至少 1 条关系）</h4>
              <button type="button" className="btn btn-secondary btn-small" onClick={addSense}>
                <Plus className="icon-small" /> 新增释义
              </button>
            </div>

            <div className="sense-list-scroll">
              {senses.map((sense, index) => {
                const fieldErrors = validation.fieldErrorsByLocalId[sense.localId] || { title: '', content: '', relation: '' };
                const insertDirection = sense.insertDirection === 'extends' ? 'extends' : 'contains';
                const insertSegmentText = insertDirection === 'contains' ? '→包含→' : '←拓展←';
                const insertDirectionHint = sense.insertDirectionHint
                  || '先选定左右释义；若两者无直接上下级，可点击线段在“→包含→包含 / ←拓展←拓展”之间切换。';
                const relationHint = sense.relationType === 'insert'
                  ? `${insertSegmentText}${insertDirection === 'contains' ? '包含' : '拓展'}；${insertDirectionHint}`
                  : (RELATION_OPTIONS.find((option) => option.value === sense.relationType)?.hint || '');

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

                    <div className="sense-relations-editor">
                      <div className="relation-type-row">
                        <div className="relation-type-switcher">
                          {RELATION_OPTIONS.map((option) => (
                            <button
                              key={`${sense.localId}-${option.value}`}
                              type="button"
                              className={`relation-type-btn ${sense.relationType === option.value ? 'active' : ''}`}
                              onClick={() => updateSense(sense.localId, {
                                relationType: option.value,
                                selectedTarget: null,
                                insertLeftTarget: null,
                                insertRightTarget: null,
                                insertDirection: 'contains',
                                insertDirectionLocked: false,
                                insertDirectionHint: '先选定左右释义；若两者无直接上下级，可点击线段在“→包含→包含 / ←拓展←拓展”之间切换。'
                              })}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="relation-help-btn"
                          onClick={() => setIsRelationHelpOpen(true)}
                        >
                          关系说明
                        </button>
                      </div>

                      <div className="relation-hint-text">{relationHint}</div>

                      {sense.relationType === 'insert' ? (
                        <>
                          <div className="relation-visual relation-visual-insert">
                            <button
                              type="button"
                              className="relation-node target clickable"
                              onClick={() => openTargetSelector(sense.localId, 'left')}
                            >
                              {sense.insertLeftTarget?.displayName || '点此选择左侧释义'}
                            </button>
                            <button
                              type="button"
                              className={`insert-segment-btn ${sense.insertDirectionLocked ? 'locked' : ''}`}
                              onClick={() => toggleInsertDirection(sense.localId)}
                              disabled={sense.insertDirectionLocked}
                              title={sense.insertDirectionLocked ? '该方向已由左右节点现有关联锁定，不能切换' : '点击可切换插入方向'}
                            >
                              {insertSegmentText}
                            </button>
                            <div className="relation-node current">
                              {sense.title?.trim() || `当前释义${index + 1}`}
                            </div>
                            <button
                              type="button"
                              className={`insert-segment-btn ${sense.insertDirectionLocked ? 'locked' : ''}`}
                              onClick={() => toggleInsertDirection(sense.localId)}
                              disabled={sense.insertDirectionLocked}
                              title={sense.insertDirectionLocked ? '该方向已由左右节点现有关联锁定，不能切换' : '点击可切换插入方向'}
                            >
                              {insertSegmentText}
                            </button>
                            <button
                              type="button"
                              className="relation-node target clickable"
                              onClick={() => openTargetSelector(sense.localId, 'right')}
                            >
                              {sense.insertRightTarget?.displayName || '点此选择右侧释义'}
                            </button>
                          </div>
                          <div className={`insert-direction-state ${sense.insertDirectionLocked ? 'locked' : ''}`}>
                            {sense.insertDirectionLocked
                              ? '当前方向已锁定（由左右释义原有上下级关系决定）'
                              : '当前方向可切换（点击任一线段即可切换）'}
                          </div>
                        </>
                      ) : (
                        <div className="relation-visual relation-visual-single">
                          {sense.relationType === 'contains' ? (
                            <>
                              <div className="relation-node current">{sense.title?.trim() || `当前释义${index + 1}`}</div>
                              <div className="relation-arrow">下级 ↓</div>
                              <button
                                type="button"
                                className="relation-node target clickable"
                                onClick={() => openTargetSelector(sense.localId, 'single')}
                              >
                                {sense.selectedTarget?.displayName || '点此选择目标释义'}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="relation-node target clickable"
                                onClick={() => openTargetSelector(sense.localId, 'single')}
                              >
                                {sense.selectedTarget?.displayName || '点此选择目标释义'}
                              </button>
                              <div className="relation-arrow">上级 ↑</div>
                              <div className="relation-node current">{sense.title?.trim() || `当前释义${index + 1}`}</div>
                            </>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn btn-success add-relation-btn"
                        onClick={() => addRelationToSense(sense.localId)}
                      >
                        <Link2 className="icon-small" />
                        确认添加当前关系
                      </button>
                      {fieldErrors.relation && <span className="error-text inline-field-error">{fieldErrors.relation}</span>}

                      <div className="sense-relations-list relation-inner-scroll">
                        {sense.relations.length === 0 ? (
                          <div className="empty-relation-hint">当前释义还没有关联关系</div>
                        ) : (
                          sense.relations.map((relation) => (
                            <div key={relation.id} className="relation-card">
                              <div className="relation-card-top">
                                <span className="relation-type-pill">{RELATION_LABEL_MAP[relation.relationType] || relation.relationType}</span>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-small"
                                  onClick={() => removeRelationFromSense(sense.localId, relation.id)}
                                >
                                  删除
                                </button>
                              </div>

                              {relation.kind === 'insert' ? (
                                <div className="relation-visual relation-visual-insert compact">
                                  <div className="relation-node target">{relation.leftTarget?.displayName || '-'}</div>
                                  <div className="insert-segment-static">
                                    {relation.direction === 'extends' ? '←拓展←' : '→包含→'}
                                  </div>
                                  <div className="relation-node current">{sense.title?.trim() || `当前释义${index + 1}`}</div>
                                  <div className="insert-segment-static">
                                    {relation.direction === 'extends' ? '←拓展←' : '→包含→'}
                                  </div>
                                  <div className="relation-node target">{relation.rightTarget?.displayName || '-'}</div>
                                </div>
                              ) : (
                                <div className="relation-visual relation-visual-single compact">
                                  {relation.relationType === 'contains' ? (
                                    <>
                                      <div className="relation-node current">{sense.title?.trim() || `当前释义${index + 1}`}</div>
                                      <div className="relation-arrow">下级 ↓</div>
                                      <div className="relation-node target">{relation.target?.displayName || '-'}</div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="relation-node target">{relation.target?.displayName || '-'}</div>
                                      <div className="relation-arrow">上级 ↑</div>
                                      <div className="relation-node current">{sense.title?.trim() || `当前释义${index + 1}`}</div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">取消</button>
          <button onClick={submitNodeCreation} className="btn btn-primary" disabled={!canSubmit}>确认创建</button>
        </div>

        {targetSelector.isOpen && (
          <div className="target-selector-overlay" onClick={closeTargetSelector}>
            <div className="target-selector-panel" onClick={(event) => event.stopPropagation()}>
              <div className="target-selector-header">
                <strong>{selectorTitle}</strong>
                <button type="button" className="btn btn-danger btn-small" onClick={closeTargetSelector}>
                  <X className="icon-small" />
                </button>
              </div>

              <div className="target-selector-search-row">
                <Search className="target-selector-search-icon" size={16} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="搜索：标题-释义题目（支持 #include / #expand）"
                  value={targetSelector.keyword}
                  onChange={(e) => setTargetSelector((prev) => ({ ...prev, keyword: e.target.value }))}
                />
              </div>
              <div className="target-selector-command-hint">
                <code>#include</code> 显示另一侧释义的上级，<code>#expand</code> 显示另一侧释义的下级
              </div>

              <div className="target-selector-results relation-inner-scroll">
                {targetSelector.loading && (
                  <div className="target-selector-empty">搜索中...</div>
                )}
                {!targetSelector.loading && !parsedSelectorKeyword.textKeyword && !parsedSelectorKeyword.mode && (
                  <div className="target-selector-empty">输入关键字开始搜索</div>
                )}
                {!targetSelector.loading && (parsedSelectorKeyword.textKeyword || parsedSelectorKeyword.mode) && targetSelector.results.length === 0 && (
                  <div className="target-selector-empty">没有匹配结果</div>
                )}
                {!targetSelector.loading && targetSelector.results.map((item) => (
                  <button
                    key={item.searchKey}
                    type="button"
                    className={`search-result-item selectable ${targetSelector.selected?.searchKey === item.searchKey ? 'selected' : ''}`}
                    onClick={() => setTargetSelector((prev) => ({ ...prev, selected: item }))}
                  >
                    <div className="node-info">
                      <div className="node-title-row">
                        {targetSelector.side !== 'single' && !!item.relationToAnchor && (
                          <span className={`relation-prefix relation-${item.relationToAnchor || 'none'}`}>
                            {item.relationToAnchor || '无关'}
                          </span>
                        )}
                        <strong>{renderKeywordHighlight(item.displayName, selectorSearchHighlightKeyword)}</strong>
                      </div>
                      <span className="node-description">{item.description}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="target-selector-footer">
                <button type="button" className="btn btn-secondary" onClick={closeTargetSelector}>取消</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={confirmTargetSelection}
                  disabled={!targetSelector.selected}
                >
                  确认选择
                </button>
              </div>
            </div>
          </div>
        )}

        {isRelationHelpOpen && (
          <div className="target-selector-overlay" onClick={() => setIsRelationHelpOpen(false)}>
            <div className="target-selector-panel relation-help-panel" onClick={(event) => event.stopPropagation()}>
              <div className="target-selector-header">
                <strong>关联关系说明与示例</strong>
                <button type="button" className="btn btn-danger btn-small" onClick={() => setIsRelationHelpOpen(false)}>
                  <X className="icon-small" />
                </button>
              </div>
              <div className="relation-help-content relation-inner-scroll">
                <p><strong>包含</strong>：当前释义为上级，目标释义为下级。</p>
                <p><strong>扩展</strong>：目标释义为上级，当前释义为下级。</p>
                <p><strong>插入（可切换）</strong>：左右释义若原本无直接关系，可点击任一线段在“→包含→包含”和“←拓展←拓展”之间切换。</p>
                <p><strong>插入（锁定）</strong>：若左右释义原本已有上下级，方向将自动锁定且不可切换，并与原上下级方向保持一致。</p>
                <p><strong>重连语义</strong>：当左右释义原本有直接关联时，保存后会断开该直连，改为“上级 -> 当前 -> 下级”。</p>
                <p>例如：A 直接包含 B，插入 C 后变为 A 只包含 C，B 只扩展到 C。</p>
                <p>搜索时可用 <code>#include</code> 查看另一侧释义全部上级，用 <code>#expand</code> 查看全部下级；结果前会标注“上级/下级/无关”。</p>
              </div>
              <div className="target-selector-footer">
                <button type="button" className="btn btn-primary" onClick={() => setIsRelationHelpOpen(false)}>我知道了</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreateNodeModal;
