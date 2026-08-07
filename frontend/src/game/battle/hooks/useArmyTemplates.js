import { useCallback, useEffect, useState } from 'react';
import BattleDataService from '../data/BattleDataService';

const useArmyTemplates = ({ open = false } = {}) => {
  const [armyTemplates, setArmyTemplates] = useState([]);
  const [armyTemplatesLoading, setArmyTemplatesLoading] = useState(false);
  const [armyTemplatesError, setArmyTemplatesError] = useState('');

  const loadTemplates = useCallback(async ({ signal } = {}) => {
    setArmyTemplatesLoading(true);
    setArmyTemplatesError('');
    try {
      const data = await BattleDataService.getArmyTemplates({ signal });
      const templates = Array.isArray(data?.templates) ? data.templates : [];
      setArmyTemplates(templates);
      return templates;
    } catch (loadError) {
      if (loadError?.name === 'AbortError') return [];
      setArmyTemplates([]);
      setArmyTemplatesError(`加载部队模板失败: ${loadError.message}`);
      throw loadError;
    } finally {
      if (signal?.aborted !== true) setArmyTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setArmyTemplates([]);
      setArmyTemplatesLoading(false);
      setArmyTemplatesError('');
      return;
    }

    const abortController = new AbortController();

    loadTemplates({ signal: abortController.signal }).catch(() => {});

    return () => {
      abortController.abort();
    };
  }, [loadTemplates, open]);

  const createTemplate = useCallback(async (payload) => {
    const data = await BattleDataService.createArmyTemplate({ payload });
    const templates = Array.isArray(data?.templates) ? data.templates : null;
    if (templates) setArmyTemplates(templates);
    return data?.template || null;
  }, []);

  const updateTemplate = useCallback(async (templateId, payload) => {
    const data = await BattleDataService.updateArmyTemplate({ templateId, payload });
    const templates = Array.isArray(data?.templates) ? data.templates : null;
    if (templates) setArmyTemplates(templates);
    return data?.template || null;
  }, []);

  const deleteTemplate = useCallback(async (templateId) => {
    const data = await BattleDataService.deleteArmyTemplate({ templateId });
    const templates = Array.isArray(data?.templates) ? data.templates : [];
    setArmyTemplates(templates);
    return templates;
  }, []);

  return {
    armyTemplates,
    armyTemplatesLoading,
    armyTemplatesError,
    reloadArmyTemplates: loadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate
  };
};

export default useArmyTemplates;
