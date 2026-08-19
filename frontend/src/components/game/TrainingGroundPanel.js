import React, { useCallback, useEffect, useState } from 'react';
import BattleSceneModal from '../../game/battle/screens/BattleSceneModal';
import { API_BASE } from '../../runtimeConfig';

const createTrainingState = () => ({
  loading: true,
  error: '',
  data: null,
  progress: {
    phase: 'request',
    loadedBytes: 0,
    totalBytes: 0,
    fraction: null
  }
});

const parseApiResponse = (raw = '') => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const resolveContentLength = (response = null) => {
  const contentLength = Number(response?.headers?.get?.('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > 0
    ? Math.floor(contentLength)
    : 0;
};

const readTrainingInitResponse = async (response, onProgress = null) => {
  const totalBytes = resolveContentLength(response);
  const reportProgress = (loadedBytes) => onProgress?.({
    phase: 'download',
    loadedBytes: Math.max(0, Math.floor(Number(loadedBytes) || 0)),
    totalBytes,
    fraction: totalBytes > 0
      ? Math.min(1, Math.max(0, Number(loadedBytes) / totalBytes))
      : null
  });
  reportProgress(0);

  if (!response?.body || typeof response.body.getReader !== 'function') {
    const raw = await response.text();
    reportProgress(totalBytes || raw.length);
    return raw;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loadedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      loadedBytes += value.byteLength;
      reportProgress(loadedBytes);
    }
  } finally {
    reader.releaseLock?.();
  }

  const content = new Uint8Array(loadedBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  });
  reportProgress(loadedBytes);
  return new TextDecoder().decode(content);
};

const TrainingGroundPanel = ({ onExit }) => {
  const [state, setState] = useState(() => createTrainingState());

  const fetchTrainingInit = useCallback(async (signal) => {
    const token = localStorage.getItem('token');
    if (!token) {
      setState({ loading: false, error: '未登录，无法进入训练场', data: null, progress: null });
      return;
    }

    setState((prev) => ({
      ...prev,
      loading: true,
      error: '',
      progress: {
        phase: 'request',
        loadedBytes: 0,
        totalBytes: 0,
        fraction: null
      }
    }));

    try {
      const response = await fetch(`${API_BASE}/army/training/init`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        signal
      });
      const raw = await readTrainingInitResponse(response, (progress) => {
        if (signal?.aborted) return;
        setState((prev) => ({ ...prev, progress }));
      });
      if (signal?.aborted) return;
      const parsed = parseApiResponse(raw);
      if (!response.ok || !parsed) {
        setState({
          loading: false,
          error: parsed?.error || parsed?.message || '加载训练场失败',
          data: null,
          progress: null
        });
        return;
      }
      setState({
        loading: false,
        error: '',
        data: parsed,
        progress: {
          phase: 'complete',
          loadedBytes: resolveContentLength(response),
          totalBytes: resolveContentLength(response),
          fraction: 1
        }
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return;
      setState({ loading: false, error: `加载训练场失败: ${error.message}`, data: null, progress: null });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrainingInit(controller.signal);
    return () => controller.abort();
  }, [fetchTrainingInit]);

  return (
    <BattleSceneModal
      open
      loading={state.loading}
      error={state.error}
      battleInitData={state.data}
      loadingProgress={state.progress}
      mode="training"
      startLabel="开始训练"
      requireResultReport={false}
      onClose={() => {
        if (typeof onExit === 'function') onExit();
      }}
    />
  );
};

export default TrainingGroundPanel;
