import { useCallback, useState } from 'react';
import { API_BASE } from '../runtimeConfig';
import BattleDataService from '../game/battle/data/BattleDataService';
import {
  CITY_GATE_LABEL_MAP,
  createEmptyIntelHeistStatus,
  createEmptySiegeStatus,
  mergeSiegeStatusPreservingIntelView,
  normalizeIntelSnapshot,
  normalizeObjectId,
  normalizeSiegeStatus
} from '../app/appShared';

const createClosedIntelHeistDialog = () => ({
  open: false,
  loading: false,
  node: null,
  snapshot: null,
  error: ''
});

const createClosedSiegeDialog = () => ({
  open: false,
  loading: false,
  submitting: false,
  supportSubmitting: false,
  node: null,
  error: '',
  message: ''
});

const createEmptySiegeSupportDraft = () => ({
  gateKey: '',
  autoRetreatPercent: 40,
  units: {}
});

const createClosedPveBattleState = () => ({
  open: false,
  loading: false,
  error: '',
  nodeId: '',
  gateKey: '',
  data: null
});

const createClosedBattlefieldPreviewState = () => ({
  open: false,
  loading: false,
  error: '',
  nodeId: '',
  gateKey: '',
  gateLabel: '',
  layoutBundle: null
});

const buildInitialSiegeSupportDraft = (status) => {
  const units = {};
  (status?.ownRoster?.units || []).forEach((entry) => {
    if (!entry?.unitTypeId) return;
    units[entry.unitTypeId] = 0;
  });
  return {
    gateKey: status?.supportGate || status?.compareGate || status?.preferredGate || '',
    autoRetreatPercent: 40,
    units
  };
};

const useDomainConflictState = ({
  authenticated,
  isAdmin,
  currentTitleDetail,
  currentNodeDetail,
  parseApiResponse,
  getApiErrorMessage,
  fetchNotifications,
  fetchSiegeSupportStatuses
}) => {
  const [intelHeistStatus, setIntelHeistStatus] = useState(createEmptyIntelHeistStatus);
  const [intelHeistDialog, setIntelHeistDialog] = useState(createClosedIntelHeistDialog);
  const [siegeStatus, setSiegeStatus] = useState(createEmptySiegeStatus);
  const [siegeDialog, setSiegeDialog] = useState(createClosedSiegeDialog);
  const [siegeSupportDraft, setSiegeSupportDraft] = useState(createEmptySiegeSupportDraft);
  const [pveBattleState, setPveBattleState] = useState(createClosedPveBattleState);
  const [siegeBattlefieldPreviewState, setSiegeBattlefieldPreviewState] = useState(createClosedBattlefieldPreviewState);

  const closeIntelHeistDialog = useCallback(() => {
    setIntelHeistDialog(createClosedIntelHeistDialog());
  }, []);

  const resetSiegeDialog = useCallback(() => {
    setSiegeDialog(createClosedSiegeDialog());
    setSiegeBattlefieldPreviewState(createClosedBattlefieldPreviewState());
  }, []);

  const closeSiegePveBattle = useCallback(() => {
    setPveBattleState(createClosedPveBattleState());
  }, []);

  const closeSiegeBattlefieldPreview = useCallback(() => {
    setSiegeBattlefieldPreviewState(createClosedBattlefieldPreviewState());
  }, []);

  const clearSiegeStatus = useCallback(() => {
    setSiegeStatus(createEmptySiegeStatus());
  }, []);

  const resetDomainConflictState = useCallback(() => {
    setIntelHeistStatus(createEmptyIntelHeistStatus());
    setIntelHeistDialog(createClosedIntelHeistDialog());
    setSiegeStatus(createEmptySiegeStatus());
    setSiegeDialog(createClosedSiegeDialog());
    setSiegeSupportDraft(createEmptySiegeSupportDraft());
    setPveBattleState(createClosedPveBattleState());
    setSiegeBattlefieldPreviewState(createClosedBattlefieldPreviewState());
  }, []);

  const fetchSiegeStatus = useCallback(async (targetNodeId, { silent = true, force = false, preserveIntelView = false } = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !targetNodeId || !authenticated || isAdmin) {
      if (!silent) {
        setSiegeStatus(createEmptySiegeStatus());
      }
      return null;
    }

    if (!silent) {
      setSiegeStatus((prev) => ({
        ...prev,
        loading: true,
        nodeId: targetNodeId
      }));
    }

    try {
      const requestUrl = force
        ? `${API_BASE}/nodes/${targetNodeId}/siege?_=${Date.now()}`
        : `${API_BASE}/nodes/${targetNodeId}/siege`;
      const response = await fetch(requestUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        const fallback = createEmptySiegeStatus();
        const next = {
          ...fallback,
          loading: false,
          nodeId: targetNodeId,
          startDisabledReason: getApiErrorMessage(parsed, '无法获取围城状态'),
          supportDisabledReason: getApiErrorMessage(parsed, '无法获取围城状态')
        };
        let resolved = next;
        setSiegeStatus((prev) => {
          resolved = preserveIntelView ? mergeSiegeStatusPreservingIntelView(prev, next, targetNodeId) : next;
          return resolved;
        });
        return resolved;
      }
      const normalized = normalizeSiegeStatus(parsed.data, targetNodeId);
      let resolved = normalized;
      setSiegeStatus((prev) => {
        resolved = preserveIntelView ? mergeSiegeStatusPreservingIntelView(prev, normalized, targetNodeId) : normalized;
        return resolved;
      });
      return resolved;
    } catch (error) {
      const fallback = createEmptySiegeStatus();
      const next = {
        ...fallback,
        loading: false,
        nodeId: targetNodeId,
        startDisabledReason: `获取围城状态失败: ${error.message}`,
        supportDisabledReason: `获取围城状态失败: ${error.message}`
      };
      let resolved = next;
      setSiegeStatus((prev) => {
        resolved = preserveIntelView ? mergeSiegeStatusPreservingIntelView(prev, next, targetNodeId) : next;
        return resolved;
      });
      return resolved;
    }
  }, [authenticated, getApiErrorMessage, isAdmin, parseApiResponse]);

  const fetchIntelHeistStatus = useCallback(async (targetNodeId, { silent = true } = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !targetNodeId || !authenticated || isAdmin) {
      if (!silent) {
        setIntelHeistStatus(createEmptyIntelHeistStatus());
      }
      return null;
    }

    if (!silent) {
      setIntelHeistStatus((prev) => ({
        ...prev,
        loading: true,
        nodeId: targetNodeId
      }));
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/${targetNodeId}/intel-heist`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok || !data) {
        const next = {
          loading: false,
          nodeId: targetNodeId,
          canSteal: false,
          reason: data?.error || '无法获取情报窃取状态',
          latestSnapshot: null
        };
        setIntelHeistStatus(next);
        return next;
      }
      const next = {
        loading: false,
        nodeId: targetNodeId,
        canSteal: !!data.canSteal,
        reason: data.reason || '',
        latestSnapshot: data.latestSnapshot ? normalizeIntelSnapshot(data.latestSnapshot) : null
      };
      setIntelHeistStatus(next);
      return next;
    } catch (error) {
      const next = {
        loading: false,
        nodeId: targetNodeId,
        canSteal: false,
        reason: `获取情报窃取状态失败: ${error.message}`,
        latestSnapshot: null
      };
      setIntelHeistStatus(next);
      return next;
    }
  }, [authenticated, isAdmin]);

  const refreshDomainConflictForNode = useCallback((targetNodeId) => {
    const normalizedNodeId = normalizeObjectId(targetNodeId);
    if (!normalizedNodeId) return;
    setIntelHeistStatus(createEmptyIntelHeistStatus());
    setSiegeStatus(createEmptySiegeStatus());
    fetchIntelHeistStatus(normalizedNodeId, { silent: false });
    fetchSiegeStatus(normalizedNodeId, { silent: false });
  }, [fetchIntelHeistStatus, fetchSiegeStatus]);

  const handleIntelHeistSnapshotCaptured = useCallback((snapshot, nodeInfo) => {
    const normalized = snapshot ? normalizeIntelSnapshot(snapshot) : null;
    const targetNodeId = normalizeObjectId(nodeInfo?._id || snapshot?.nodeId);
    if (!normalized || !targetNodeId) return;
    setIntelHeistStatus((prev) => {
      if (prev.nodeId && prev.nodeId !== targetNodeId) return prev;
      return {
        loading: false,
        nodeId: targetNodeId,
        canSteal: true,
        reason: '',
        latestSnapshot: normalized
      };
    });
    const currentSiegeNodeId = normalizeObjectId(siegeDialog.node?._id || siegeStatus.nodeId);
    if (currentSiegeNodeId && currentSiegeNodeId === targetNodeId) {
      fetchSiegeStatus(targetNodeId, { silent: false, force: true, preserveIntelView: true });
    }
  }, [fetchSiegeStatus, siegeDialog.node, siegeStatus.nodeId]);

  const handleSiegeAction = useCallback(async (targetNode) => {
    if (!targetNode?._id || isAdmin) return;
    const nodeId = normalizeObjectId(targetNode._id);
    if (!nodeId) return;

    setSiegeDialog({
      open: true,
      loading: true,
      submitting: false,
      supportSubmitting: false,
      node: targetNode,
      error: '',
      message: ''
    });

    const status = await fetchSiegeStatus(nodeId, { silent: false, force: true, preserveIntelView: true });
    if (!status) {
      setSiegeDialog((prev) => ({
        ...prev,
        loading: false,
        error: '无法获取围城状态'
      }));
      return;
    }

    setSiegeSupportDraft(buildInitialSiegeSupportDraft(status));
    setSiegeDialog((prev) => ({
      ...prev,
      loading: false,
      error: '',
      message: ''
    }));
  }, [fetchSiegeStatus, isAdmin]);

  const resolveActiveSiegeNodeId = useCallback(() => (
    normalizeObjectId(siegeDialog.node?._id || currentTitleDetail?._id || currentNodeDetail?._id || siegeStatus.nodeId)
  ), [currentNodeDetail, currentTitleDetail, siegeDialog.node, siegeStatus.nodeId]);

  const startSiege = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = resolveActiveSiegeNodeId();
    if (!token || !nodeId || siegeDialog.submitting) return;

    setSiegeDialog((prev) => ({
      ...prev,
      submitting: true,
      error: '',
      message: ''
    }));

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/siege/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        setSiegeDialog((prev) => ({
          ...prev,
          submitting: false,
          error: getApiErrorMessage(parsed, '发起围城失败')
        }));
        return;
      }

      const normalized = normalizeSiegeStatus(parsed.data, nodeId);
      setSiegeStatus(normalized);
      setSiegeSupportDraft(buildInitialSiegeSupportDraft(normalized));
      setSiegeDialog((prev) => ({
        ...prev,
        submitting: false,
        error: '',
        message: parsed.data.message || '已发起围城'
      }));
      await fetchSiegeSupportStatuses(true);
    } catch (error) {
      setSiegeDialog((prev) => ({
        ...prev,
        submitting: false,
        error: `发起围城失败: ${error.message}`
      }));
    }
  }, [fetchSiegeSupportStatuses, getApiErrorMessage, parseApiResponse, resolveActiveSiegeNodeId, siegeDialog.submitting]);

  const requestSiegeSupport = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = resolveActiveSiegeNodeId();
    if (!token || !nodeId || siegeDialog.submitting) return;

    setSiegeDialog((prev) => ({
      ...prev,
      submitting: true,
      error: '',
      message: ''
    }));

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/siege/request-support`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        setSiegeDialog((prev) => ({
          ...prev,
          submitting: false,
          error: getApiErrorMessage(parsed, '呼叫支援失败')
        }));
        return;
      }

      const normalized = normalizeSiegeStatus(parsed.data, nodeId);
      setSiegeStatus(normalized);
      setSiegeDialog((prev) => ({
        ...prev,
        submitting: false,
        error: '',
        message: parsed.data.message || '已呼叫熵盟支援'
      }));
      await fetchNotifications(true);
    } catch (error) {
      setSiegeDialog((prev) => ({
        ...prev,
        submitting: false,
        error: `呼叫支援失败: ${error.message}`
      }));
    }
  }, [fetchNotifications, getApiErrorMessage, parseApiResponse, resolveActiveSiegeNodeId, siegeDialog.submitting]);

  const retreatSiege = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = resolveActiveSiegeNodeId();
    if (!token || !nodeId || siegeDialog.submitting) return;

    setSiegeDialog((prev) => ({
      ...prev,
      submitting: true,
      error: '',
      message: ''
    }));

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/siege/retreat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        setSiegeDialog((prev) => ({
          ...prev,
          submitting: false,
          error: getApiErrorMessage(parsed, '撤退失败')
        }));
        return;
      }

      const normalized = normalizeSiegeStatus(parsed.data, nodeId);
      setSiegeStatus(normalized);
      setSiegeSupportDraft(buildInitialSiegeSupportDraft(normalized));
      setSiegeDialog((prev) => ({
        ...prev,
        submitting: false,
        error: '',
        message: parsed.data.message || '已撤退并取消攻城'
      }));
      await fetchSiegeSupportStatuses(true);
    } catch (error) {
      setSiegeDialog((prev) => ({
        ...prev,
        submitting: false,
        error: `撤退失败: ${error.message}`
      }));
    }
  }, [fetchSiegeSupportStatuses, getApiErrorMessage, parseApiResponse, resolveActiveSiegeNodeId, siegeDialog.submitting]);

  const submitSiegeSupport = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = resolveActiveSiegeNodeId();
    if (!token || !nodeId || siegeDialog.supportSubmitting) return;

    const units = Object.entries(siegeSupportDraft.units || {})
      .map(([unitTypeId, count]) => ({
        unitTypeId,
        count: Math.max(0, Math.floor(Number(count) || 0))
      }))
      .filter((item) => item.unitTypeId && item.count > 0);
    if (units.length === 0) {
      setSiegeDialog((prev) => ({
        ...prev,
        error: '请至少选择一支兵种和数量'
      }));
      return;
    }

    setSiegeDialog((prev) => ({
      ...prev,
      supportSubmitting: true,
      error: '',
      message: ''
    }));
    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/siege/support`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          gateKey: siegeSupportDraft.gateKey || siegeStatus.supportGate || siegeStatus.compareGate || '',
          autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(siegeSupportDraft.autoRetreatPercent) || 40))),
          units
        })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        setSiegeDialog((prev) => ({
          ...prev,
          supportSubmitting: false,
          error: getApiErrorMessage(parsed, '派遣支援失败')
        }));
        return;
      }

      const normalized = normalizeSiegeStatus(parsed.data, nodeId);
      setSiegeStatus(normalized);
      setSiegeSupportDraft(buildInitialSiegeSupportDraft(normalized));
      setSiegeDialog((prev) => ({
        ...prev,
        supportSubmitting: false,
        error: '',
        message: parsed.data.message || '已派遣支援'
      }));
      await fetchNotifications(true);
      await fetchSiegeSupportStatuses(true);
    } catch (error) {
      setSiegeDialog((prev) => ({
        ...prev,
        supportSubmitting: false,
        error: `派遣支援失败: ${error.message}`
      }));
    }
  }, [
    fetchNotifications,
    fetchSiegeSupportStatuses,
    getApiErrorMessage,
    parseApiResponse,
    resolveActiveSiegeNodeId,
    siegeDialog.supportSubmitting,
    siegeStatus.compareGate,
    siegeStatus.supportGate,
    siegeSupportDraft
  ]);

  const handleOpenSiegeBattlefieldPreview = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = resolveActiveSiegeNodeId();
    const gateKey = (
      (siegeStatus.compareGate && (siegeStatus.activeGateKeys || []).includes(siegeStatus.compareGate) ? siegeStatus.compareGate : '')
      || (siegeStatus.activeGateKeys || [])[0]
      || ''
    );
    if (!token || !nodeId || !gateKey) return;

    setSiegeBattlefieldPreviewState({
      open: false,
      loading: true,
      error: '',
      nodeId,
      gateKey,
      gateLabel: CITY_GATE_LABEL_MAP[gateKey] || gateKey,
      layoutBundle: null
    });
    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/siege/battlefield-preview?gateKey=${encodeURIComponent(gateKey)}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        setSiegeBattlefieldPreviewState((prev) => ({
          ...prev,
          open: false,
          loading: false,
          error: getApiErrorMessage(parsed, '加载战场预览失败')
        }));
        return;
      }

      const payload = parsed.data;
      setSiegeBattlefieldPreviewState({
        open: true,
        loading: false,
        error: '',
        nodeId: payload.nodeId || nodeId,
        gateKey: payload.gateKey || gateKey,
        gateLabel: payload.gateLabel || CITY_GATE_LABEL_MAP[payload.gateKey || gateKey] || gateKey,
        layoutBundle: payload.layoutBundle && typeof payload.layoutBundle === 'object' ? payload.layoutBundle : null
      });
    } catch (error) {
      setSiegeBattlefieldPreviewState((prev) => ({
        ...prev,
        open: false,
        loading: false,
        error: `加载战场预览失败: ${error.message}`
      }));
    }
  }, [getApiErrorMessage, parseApiResponse, resolveActiveSiegeNodeId, siegeStatus.activeGateKeys, siegeStatus.compareGate]);

  const handleOpenSiegePveBattle = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = resolveActiveSiegeNodeId();
    const gateKey = (
      (siegeStatus.compareGate && (siegeStatus.activeGateKeys || []).includes(siegeStatus.compareGate) ? siegeStatus.compareGate : '')
      || (siegeStatus.activeGateKeys || [])[0]
      || ''
    );
    if (!token || !nodeId || !gateKey) return;

    setPveBattleState({
      open: true,
      loading: true,
      error: '',
      nodeId,
      gateKey,
      data: null
    });

    try {
      const data = await BattleDataService.getPveBattleInit({ nodeId, gateKey });
      setPveBattleState({
        open: true,
        loading: false,
        error: '',
        nodeId,
        gateKey,
        data
      });
    } catch (error) {
      setPveBattleState({
        open: true,
        loading: false,
        error: `初始化战斗失败: ${error.message}`,
        nodeId,
        gateKey,
        data: null
      });
    }
  }, [resolveActiveSiegeNodeId, siegeStatus.activeGateKeys, siegeStatus.compareGate]);

  const handlePveBattleFinished = useCallback(async () => {
    const nodeId = normalizeObjectId(pveBattleState.nodeId || siegeDialog.node?._id || currentTitleDetail?._id || currentNodeDetail?._id || siegeStatus.nodeId);
    if (nodeId) {
      await fetchSiegeStatus(nodeId, { silent: false, preserveIntelView: true });
    }
  }, [currentNodeDetail, currentTitleDetail, fetchSiegeStatus, pveBattleState.nodeId, siegeDialog.node, siegeStatus.nodeId]);

  return {
    intelHeistStatus,
    intelHeistDialog,
    siegeStatus,
    siegeDialog,
    siegeSupportDraft,
    pveBattleState,
    siegeBattlefieldPreviewState,
    setIntelHeistDialog,
    setSiegeSupportDraft,
    setSiegeStatus,
    fetchSiegeStatus,
    fetchIntelHeistStatus,
    clearSiegeStatus,
    resetDomainConflictState,
    refreshDomainConflictForNode,
    closeIntelHeistDialog,
    resetSiegeDialog,
    closeSiegePveBattle,
    closeSiegeBattlefieldPreview,
    handleIntelHeistSnapshotCaptured,
    handleSiegeAction,
    startSiege,
    requestSiegeSupport,
    retreatSiege,
    submitSiegeSupport,
    handleOpenSiegeBattlefieldPreview,
    handleOpenSiegePveBattle,
    handlePveBattleFinished
  };
};

export default useDomainConflictState;
