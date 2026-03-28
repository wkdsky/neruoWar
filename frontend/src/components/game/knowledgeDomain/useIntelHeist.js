import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../../runtimeConfig';
import { getApiError, parseApiResponse } from './api';
import { INTEL_HEIST_SCAN_MS, INTEL_HEIST_TIMEOUT_BUFFER_MS } from './shared';

const createDefaultIntelHeistState = () => ({
  active: false,
  totalMs: 0,
  deadlineMs: 0,
  activeBuildingId: '',
  searchStartedAtMs: 0,
  searchedBuildingIds: [],
  submitting: false,
  hintText: '',
  hintVisible: false,
  resultSnapshot: null,
  resultOpen: false,
  error: '',
  timeoutTriggered: false
});

const getIntelHeistTotalMs = (buildingCount) => (
  buildingCount <= 1
    ? (INTEL_HEIST_SCAN_MS + INTEL_HEIST_TIMEOUT_BUFFER_MS)
    : (((buildingCount - 1) * INTEL_HEIST_SCAN_MS) + INTEL_HEIST_TIMEOUT_BUFFER_MS)
);

const useIntelHeist = ({
  isVisible,
  isIntelHeistMode,
  nodeId,
  node,
  onExit,
  onIntelSnapshotCaptured
}) => {
  const [intelHeistState, setIntelHeistState] = useState(createDefaultIntelHeistState);
  const [intelHeistClockMs, setIntelHeistClockMs] = useState(Date.now());
  const [isIntelHeistExitConfirmOpen, setIsIntelHeistExitConfirmOpen] = useState(false);
  const intelHeistHintTimerRef = useRef(null);
  const intelHeistScanRequestRef = useRef('');
  const intelHeistPauseStartedAtRef = useRef(0);

  const clearIntelHeistHintTimer = useCallback(() => {
    if (intelHeistHintTimerRef.current) {
      clearTimeout(intelHeistHintTimerRef.current);
      intelHeistHintTimerRef.current = null;
    }
  }, []);

  const resetIntelHeistState = useCallback(() => {
    clearIntelHeistHintTimer();
    intelHeistScanRequestRef.current = '';
    intelHeistPauseStartedAtRef.current = 0;
    setIntelHeistClockMs(Date.now());
    setIsIntelHeistExitConfirmOpen(false);
    setIntelHeistState(createDefaultIntelHeistState());
  }, [clearIntelHeistHintTimer]);

  const showIntelHeistHint = useCallback((text) => {
    clearIntelHeistHintTimer();
    setIntelHeistState((prev) => ({
      ...prev,
      hintText: text,
      hintVisible: true
    }));
  }, [clearIntelHeistHintTimer]);

  const armIntelHeist = useCallback((buildings) => {
    const buildingCount = Math.max(1, Array.isArray(buildings) ? buildings.length : 0);
    if (buildingCount <= 0) return;
    setIntelHeistState((prev) => {
      if (prev.active && prev.totalMs > 0) return prev;
      const totalMs = getIntelHeistTotalMs(buildingCount);
      return {
        ...prev,
        active: true,
        totalMs,
        deadlineMs: Date.now() + totalMs,
        activeBuildingId: '',
        searchStartedAtMs: 0,
        searchedBuildingIds: [],
        submitting: false,
        hintText: '',
        hintVisible: false,
        resultSnapshot: null,
        resultOpen: false,
        error: '',
        timeoutTriggered: false
      };
    });
    setIntelHeistClockMs(Date.now());
  }, []);

  const startIntelHeistSearch = useCallback((buildingId) => {
    if (!isIntelHeistMode || !buildingId) return;
    setIntelHeistState((prev) => {
      if (!prev.active || prev.timeoutTriggered || prev.resultOpen) return prev;
      if (prev.submitting || prev.activeBuildingId) return prev;
      if ((prev.searchedBuildingIds || []).includes(buildingId)) return prev;
      if (prev.deadlineMs > 0 && Date.now() >= prev.deadlineMs) return prev;
      return {
        ...prev,
        activeBuildingId: buildingId,
        searchStartedAtMs: Date.now(),
        error: '',
        hintVisible: false
      };
    });
    clearIntelHeistHintTimer();
    intelHeistHintTimerRef.current = setTimeout(() => {
      setIntelHeistState((prev) => ({
        ...prev,
        hintText: ''
      }));
      intelHeistHintTimerRef.current = null;
    }, 220);
  }, [clearIntelHeistHintTimer, isIntelHeistMode]);

  const exitIntelHeistGame = useCallback((exitPayload = {}) => {
    resetIntelHeistState();
    if (typeof onExit === 'function') {
      onExit(exitPayload);
    }
  }, [onExit, resetIntelHeistState]);

  const requestExitIntelHeistGame = useCallback(() => {
    if (!isIntelHeistMode) {
      if (typeof onExit === 'function') onExit();
      return;
    }
    if (intelHeistState.resultOpen || intelHeistState.timeoutTriggered || !intelHeistState.active) {
      exitIntelHeistGame();
      return;
    }
    setIsIntelHeistExitConfirmOpen(true);
  }, [exitIntelHeistGame, intelHeistState, isIntelHeistMode, onExit]);

  const cancelExitIntelHeistGame = useCallback(() => {
    setIsIntelHeistExitConfirmOpen(false);
  }, []);

  const resolveIntelHeistSearch = useCallback(async (buildingId) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || !buildingId) return;
    const requestId = `${buildingId}_${Date.now()}`;
    intelHeistScanRequestRef.current = requestId;
    setIntelHeistState((prev) => ({
      ...prev,
      submitting: true,
      error: ''
    }));
    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/intel-heist/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ buildingId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (intelHeistScanRequestRef.current !== requestId) return;
      if (!response.ok || !data) {
        setIntelHeistState((prev) => ({
          ...prev,
          submitting: false,
          error: getApiError(parsed, '建筑搜索失败')
        }));
        return;
      }
      if (data.found && data.snapshot) {
        setIntelHeistState((prev) => ({
          ...prev,
          active: false,
          submitting: false,
          activeBuildingId: '',
          searchStartedAtMs: 0,
          resultSnapshot: data.snapshot,
          resultOpen: true,
          hintText: '',
          hintVisible: false,
          searchedBuildingIds: Array.from(new Set([...(prev.searchedBuildingIds || []), buildingId]))
        }));
        if (typeof onIntelSnapshotCaptured === 'function') {
          onIntelSnapshotCaptured(data.snapshot, node);
        }
        return;
      }
      setIntelHeistState((prev) => ({
        ...prev,
        submitting: false,
        searchedBuildingIds: Array.from(new Set([...(prev.searchedBuildingIds || []), buildingId]))
      }));
      showIntelHeistHint(data.message || '该建筑未发现情报文件');
    } catch (error) {
      if (intelHeistScanRequestRef.current !== requestId) return;
      setIntelHeistState((prev) => ({
        ...prev,
        submitting: false,
        error: `建筑搜索失败: ${error.message}`
      }));
    } finally {
      if (intelHeistScanRequestRef.current === requestId) {
        intelHeistScanRequestRef.current = '';
      }
    }
  }, [node, nodeId, onIntelSnapshotCaptured, showIntelHeistHint]);

  useEffect(() => {
    return () => {
      clearIntelHeistHintTimer();
      intelHeistScanRequestRef.current = '';
      intelHeistPauseStartedAtRef.current = 0;
    };
  }, [clearIntelHeistHintTimer]);

  useEffect(() => {
    if (!isIntelHeistMode || !intelHeistState.active) {
      intelHeistPauseStartedAtRef.current = 0;
      return;
    }

    if (isIntelHeistExitConfirmOpen) {
      if (!intelHeistPauseStartedAtRef.current) {
        intelHeistPauseStartedAtRef.current = Date.now();
      }
      return;
    }

    if (!intelHeistPauseStartedAtRef.current) return;
    const pauseDelta = Math.max(0, Date.now() - intelHeistPauseStartedAtRef.current);
    intelHeistPauseStartedAtRef.current = 0;
    if (pauseDelta <= 0) return;

    setIntelHeistState((prev) => {
      if (!prev.active) return prev;
      return {
        ...prev,
        deadlineMs: prev.deadlineMs > 0 ? prev.deadlineMs + pauseDelta : prev.deadlineMs,
        searchStartedAtMs: prev.searchStartedAtMs > 0 ? prev.searchStartedAtMs + pauseDelta : prev.searchStartedAtMs
      };
    });
    setIntelHeistClockMs(Date.now());
  }, [intelHeistState.active, isIntelHeistExitConfirmOpen, isIntelHeistMode]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode || !intelHeistState.active || isIntelHeistExitConfirmOpen) return undefined;
    const timerId = setInterval(() => {
      setIntelHeistClockMs(Date.now());
    }, 100);
    return () => clearInterval(timerId);
  }, [intelHeistState.active, isIntelHeistExitConfirmOpen, isIntelHeistMode, isVisible]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode || !intelHeistState.activeBuildingId || isIntelHeistExitConfirmOpen) return;
    if (!intelHeistState.searchStartedAtMs || intelHeistState.submitting) return;
    const elapsed = intelHeistClockMs - intelHeistState.searchStartedAtMs;
    if (elapsed < INTEL_HEIST_SCAN_MS) return;
    const targetBuildingId = intelHeistState.activeBuildingId;
    setIntelHeistState((prev) => ({
      ...prev,
      activeBuildingId: '',
      searchStartedAtMs: 0
    }));
    resolveIntelHeistSearch(targetBuildingId);
  }, [
    intelHeistClockMs,
    intelHeistState.activeBuildingId,
    intelHeistState.searchStartedAtMs,
    intelHeistState.submitting,
    isIntelHeistExitConfirmOpen,
    isIntelHeistMode,
    isVisible,
    resolveIntelHeistSearch
  ]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode || isIntelHeistExitConfirmOpen) return undefined;
    if (!intelHeistState.active || !intelHeistState.deadlineMs) return undefined;
    if (intelHeistState.resultOpen || intelHeistState.timeoutTriggered) return undefined;
    if (intelHeistClockMs < intelHeistState.deadlineMs) return undefined;
    setIntelHeistState((prev) => ({
      ...prev,
      active: false,
      timeoutTriggered: true,
      activeBuildingId: '',
      searchStartedAtMs: 0,
      submitting: false,
      hintText: '',
      hintVisible: false
    }));
    return undefined;
  }, [
    intelHeistClockMs,
    intelHeistState.active,
    intelHeistState.deadlineMs,
    intelHeistState.resultOpen,
    intelHeistState.timeoutTriggered,
    isIntelHeistExitConfirmOpen,
    isIntelHeistMode,
    isVisible
  ]);

  return {
    intelHeistState,
    intelHeistClockMs,
    isIntelHeistExitConfirmOpen,
    setIsIntelHeistExitConfirmOpen,
    resetIntelHeistState,
    armIntelHeist,
    startIntelHeistSearch,
    exitIntelHeistGame,
    requestExitIntelHeistGame,
    cancelExitIntelHeistGame
  };
};

export default useIntelHeist;
