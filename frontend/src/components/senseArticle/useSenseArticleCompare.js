import { useEffect, useState } from 'react';
import { senseArticleApi } from '../../utils/senseArticleApi';

const useSenseArticleCompare = ({ nodeId, senseId, fromRevisionId, toRevisionId, enabled = true }) => {
  const [compare, setCompare] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!enabled || !nodeId || !senseId || !fromRevisionId || !toRevisionId) {
        setCompare(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await senseArticleApi.compareRevisions(nodeId, senseId, fromRevisionId, toRevisionId);
        setCompare(response?.compare || null);
      } catch (requestError) {
        setCompare(null);
        setError(requestError);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [enabled, nodeId, senseId, fromRevisionId, toRevisionId]);

  return { compare, loading, error };
};

export default useSenseArticleCompare;
