import React, { useCallback, useEffect, useState } from 'react';
import BattleSceneModal from './BattleSceneModal';
import { BACKEND_ORIGIN } from '../../runtimeConfig';

const API_BASE = BACKEND_ORIGIN;

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

const TrainingGroundPanel = () => {
  const [state, setState] = useState(() => createTrainingState());
  const [openBattle, setOpenBattle] = useState(true);

  const fetchTrainingInit = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setState({ loading: false, error: '未登录，无法进入训练场', data: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: '' }));

    try {
      const response = await fetch(`${API_BASE}/api/army/training/init`, {
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
    setOpenBattle(true);
    fetchTrainingInit();
  }, [fetchTrainingInit]);

  return (
    <>
      {!openBattle ? (
        <div className="training-ground-entry">
          <h2>训练场</h2>
          <p>可无限布置我方/敌方部队与战场物品。</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setOpenBattle(true)}
          >
            进入训练场
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchTrainingInit}
          >
            刷新训练场数据
          </button>
        </div>
      ) : null}
      <BattleSceneModal
        open={openBattle}
        loading={state.loading}
        error={state.error}
        battleInitData={state.data}
        mode="training"
        startLabel="开始训练"
        requireResultReport={false}
        onClose={() => setOpenBattle(false)}
      />
    </>
  );
};

export default TrainingGroundPanel;
