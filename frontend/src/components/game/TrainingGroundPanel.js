import React, { useCallback, useEffect, useState } from 'react';
import { BattleSceneModal } from '../../game/battle';
import { API_BASE } from '../../runtimeConfig';

const createTrainingState = () => ({
  loading: true,
  error: '',
  data: null
});

const parseApiResponse = async (response) => {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const TrainingGroundPanel = ({ onExit }) => {
  const [state, setState] = useState(() => createTrainingState());

  const fetchTrainingInit = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setState({ loading: false, error: '未登录，无法进入训练场', data: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: '' }));

    try {
      const response = await fetch(`${API_BASE}/army/training/init`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed) {
        setState({
          loading: false,
          error: parsed?.error || parsed?.message || '加载训练场失败',
          data: null
        });
        return;
      }
      setState({ loading: false, error: '', data: parsed });
    } catch (error) {
      setState({ loading: false, error: `加载训练场失败: ${error.message}`, data: null });
    }
  }, []);

  useEffect(() => {
    fetchTrainingInit();
  }, [fetchTrainingInit]);

  return (
    <BattleSceneModal
      open
      loading={state.loading}
      error={state.error}
      battleInitData={state.data}
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
