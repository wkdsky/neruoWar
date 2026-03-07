import { useEffect, useState } from 'react';
import BattleDataService from '../data/BattleDataService';

const useArmyTemplates = ({ open = false } = {}) => {
  const [armyTemplates, setArmyTemplates] = useState([]);
  const [armyTemplatesLoading, setArmyTemplatesLoading] = useState(false);
  const [armyTemplatesError, setArmyTemplatesError] = useState('');

  useEffect(() => {
    if (!open) {
      setArmyTemplates([]);
      setArmyTemplatesLoading(false);
      setArmyTemplatesError('');
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    const fetchTemplates = async () => {
      setArmyTemplatesLoading(true);
      setArmyTemplatesError('');
      try {
        const data = await BattleDataService.getArmyTemplates({ signal: abortController.signal });
        if (cancelled) return;
        setArmyTemplates(Array.isArray(data?.templates) ? data.templates : []);
      } catch (loadError) {
        if (cancelled || loadError?.name === 'AbortError') return;
        setArmyTemplates([]);
        setArmyTemplatesError(`加载部队模板失败: ${loadError.message}`);
      } finally {
        if (!cancelled) {
          setArmyTemplatesLoading(false);
        }
      }
    };

    fetchTemplates();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [open]);

  return {
    armyTemplates,
    armyTemplatesLoading,
    armyTemplatesError
  };
};

export default useArmyTemplates;
