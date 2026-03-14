import { useCallback, useState } from 'react';
import { API_BASE } from '../runtimeConfig';
import {
  createDefaultDistributionPanelState,
  createEmptyNodeDistributionStatus,
  normalizeObjectId
} from '../app/appShared';

const normalizeDistributionParticipationData = (raw = {}, fallbackNodeId = '') => {
  const rawPool = raw?.pool && typeof raw.pool === 'object' ? raw.pool : {};
  const hasRewardValue = rawPool.rewardValue !== null && rawPool.rewardValue !== undefined;
  const parsedRewardValue = Number(rawPool.rewardValue);
  return {
    active: !!raw.active,
    nodeId: normalizeObjectId(raw.nodeId) || fallbackNodeId || '',
    nodeName: raw.nodeName || '',
    phase: raw.phase || 'none',
    executeAt: raw.executeAt || null,
    entryCloseAt: raw.entryCloseAt || null,
    endAt: raw.endAt || null,
    executedAt: raw.executedAt || null,
    secondsToEntryClose: Number(raw.secondsToEntryClose || 0),
    secondsToExecute: Number(raw.secondsToExecute || 0),
    secondsToEnd: Number(raw.secondsToEnd || 0),
    requiresManualEntry: !!raw.requiresManualEntry,
    autoEntry: !!raw.autoEntry,
    joined: !!raw.joined,
    joinedManual: !!raw.joinedManual,
    canJoin: !!raw.canJoin,
    canExit: !!raw.canExit,
    canExitWithoutConfirm: !!raw.canExitWithoutConfirm,
    joinTip: raw.joinTip || '',
    participantTotal: Number(raw.participantTotal || 0),
    pool: {
      key: rawPool.key || '',
      label: rawPool.label || '',
      poolPercent: Number(rawPool.poolPercent || 0),
      participantCount: Number(rawPool.participantCount || 0),
      userActualPercent: Number(rawPool.userActualPercent || 0),
      estimatedReward: Number(rawPool.estimatedReward || 0),
      rewardValue: hasRewardValue && Number.isFinite(parsedRewardValue) ? parsedRewardValue : null,
      rewardFrozen: !!rawPool.rewardFrozen,
      users: Array.isArray(rawPool.users) ? rawPool.users : []
    }
  };
};

const useDistributionPanelState = ({
  isAdmin,
  currentTitleDetail,
  userLocation,
  parseApiResponse,
  getApiErrorMessage,
  handleMoveToNode
}) => {
  const [nodeDistributionStatus, setNodeDistributionStatus] = useState(createEmptyNodeDistributionStatus);
  const [showDistributionPanel, setShowDistributionPanel] = useState(false);
  const [distributionPanelState, setDistributionPanelState] = useState(createDefaultDistributionPanelState);

  const closeDistributionPanel = useCallback(() => {
    setShowDistributionPanel(false);
    setDistributionPanelState(createDefaultDistributionPanelState());
  }, []);

  const resetDistributionState = useCallback(() => {
    setNodeDistributionStatus(createEmptyNodeDistributionStatus());
    setShowDistributionPanel(false);
    setDistributionPanelState(createDefaultDistributionPanelState());
  }, []);

  const openDistributionPanel = useCallback((participationData) => {
    if (!participationData || !participationData.active) return;
    setDistributionPanelState({
      loading: false,
      joining: false,
      exiting: false,
      error: '',
      feedback: '',
      data: participationData
    });
    setShowDistributionPanel(true);
  }, []);

  const fetchDistributionParticipationStatus = useCallback(async (nodeId, silent = true, options = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || isAdmin) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/distribution-participation`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取分发参与状态失败'));
        }
        return null;
      }
      const normalized = normalizeDistributionParticipationData(data, nodeId);
      setNodeDistributionStatus({
        nodeId: normalized.nodeId,
        active: normalized.active,
        phase: normalized.phase,
        requiresManualEntry: normalized.requiresManualEntry,
        joined: normalized.joined,
        canJoin: normalized.canJoin,
        canExit: normalized.canExit,
        joinTip: normalized.joinTip
      });
      if (options.updatePanel) {
        setDistributionPanelState((prev) => ({
          ...prev,
          data: normalized,
          loading: false,
          error: ''
        }));
      }
      return normalized;
    } catch (error) {
      if (!silent) {
        window.alert(`获取分发参与状态失败: ${error.message}`);
      }
      return null;
    }
  }, [getApiErrorMessage, isAdmin, parseApiResponse]);

  const handleDistributionParticipationAction = useCallback(async (targetNodeDetail) => {
    if (!targetNodeDetail?._id) return;
    if (isAdmin) {
      window.alert('系统管理员不参与知识点分发');
      return;
    }

    const participation = await fetchDistributionParticipationStatus(targetNodeDetail._id, false);
    if (!participation) return;
    if (!participation.active) {
      window.alert('该知识域当前没有进行中的分发活动');
      return;
    }

    const refreshed = await fetchDistributionParticipationStatus(targetNodeDetail._id, true);
    const panelData = refreshed && refreshed.active ? refreshed : participation;
    if (panelData.active) {
      openDistributionPanel(panelData);
    }
  }, [fetchDistributionParticipationStatus, isAdmin, openDistributionPanel]);

  const joinDistributionFromPanel = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = normalizeObjectId(currentTitleDetail?._id);
    const panelData = distributionPanelState.data;
    if (!token || !nodeId || !panelData) return;

    if (!panelData.active) {
      setDistributionPanelState((prev) => ({
        ...prev,
        error: ''
      }));
      return;
    }
    if (!panelData.canJoin) {
      const currentNodeName = (currentTitleDetail?.name || '').trim();
      const currentLocationName = (userLocation || '').trim();
      const shouldPromptMove = (
        panelData.requiresManualEntry &&
        !panelData.joined &&
        panelData.phase === 'entry_open' &&
        !!currentNodeName &&
        currentLocationName !== currentNodeName
      );
      if (shouldPromptMove && currentTitleDetail?._id) {
        await handleMoveToNode(currentTitleDetail, { promptMode: 'distribution' });
      }
      setDistributionPanelState((prev) => ({
        ...prev,
        error: ''
      }));
      return;
    }

    const confirmed = window.confirm(
      `确认参与知识域「${currentTitleDetail?.name || ''}」分发活动？确认后在本次分发结束前不可移动。`
    );
    if (!confirmed) return;

    setDistributionPanelState((prev) => ({
      ...prev,
      joining: true,
      error: '',
      feedback: ''
    }));
    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/distribution-participation/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionPanelState((prev) => ({
          ...prev,
          joining: false,
          error: getApiErrorMessage(parsed, '参与分发失败')
        }));
        return;
      }
      const refreshed = await fetchDistributionParticipationStatus(nodeId, true, { updatePanel: true });
      setDistributionPanelState((prev) => ({
        ...prev,
        joining: false,
        feedback: '',
        data: refreshed || prev.data
      }));
    } catch (error) {
      setDistributionPanelState((prev) => ({
        ...prev,
        joining: false,
        error: `参与分发失败: ${error.message}`
      }));
    }
  }, [
    currentTitleDetail,
    distributionPanelState.data,
    fetchDistributionParticipationStatus,
    getApiErrorMessage,
    handleMoveToNode,
    parseApiResponse,
    userLocation
  ]);

  const exitDistributionFromPanel = useCallback(async () => {
    const token = localStorage.getItem('token');
    const nodeId = normalizeObjectId(currentTitleDetail?._id);
    const panelData = distributionPanelState.data;
    if (!token || !nodeId || !panelData?.canExit) return;

    if (!panelData.canExitWithoutConfirm) {
      const confirmed = window.confirm(`确认退出知识域「${currentTitleDetail?.name || ''}」分发活动？`);
      if (!confirmed) return;
    }

    setDistributionPanelState((prev) => ({
      ...prev,
      exiting: true,
      error: '',
      feedback: ''
    }));
    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/distribution-participation/exit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionPanelState((prev) => ({
          ...prev,
          exiting: false,
          error: getApiErrorMessage(parsed, '退出分发失败')
        }));
        return;
      }
      const refreshed = await fetchDistributionParticipationStatus(nodeId, true, { updatePanel: true });
      setDistributionPanelState((prev) => ({
        ...prev,
        exiting: false,
        feedback: '',
        data: refreshed || prev.data
      }));
    } catch (error) {
      setDistributionPanelState((prev) => ({
        ...prev,
        exiting: false,
        error: `退出分发失败: ${error.message}`
      }));
    }
  }, [
    currentTitleDetail,
    distributionPanelState.data,
    fetchDistributionParticipationStatus,
    getApiErrorMessage,
    parseApiResponse
  ]);

  return {
    nodeDistributionStatus,
    showDistributionPanel,
    distributionPanelState,
    fetchDistributionParticipationStatus,
    handleDistributionParticipationAction,
    closeDistributionPanel,
    resetDistributionState,
    joinDistributionFromPanel,
    exitDistributionFromPanel
  };
};

export default useDistributionPanelState;
