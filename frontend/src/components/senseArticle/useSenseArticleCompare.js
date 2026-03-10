import { useEffect, useRef, useState } from 'react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import { diagLog, newRequestId, nowMs, durationMs } from '../../utils/senseArticleDiagnostics';

const useSenseArticleCompare = ({ nodeId, senseId, fromRevisionId, toRevisionId, enabled = true }) => {
  const [compare, setCompare] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const latestRequestKeyRef = useRef('');

  latestRequestKeyRef.current = `${enabled ? '1' : '0'}:${nodeId}:${senseId}:${fromRevisionId}:${toRevisionId}`;

  useEffect(() => {
    const load = async () => {
      if (!enabled || !nodeId || !senseId || !fromRevisionId || !toRevisionId) {
        setCompare(null);
        setError(null);
        setLoading(false);
        return;
      }
      const requestId = newRequestId('compare');
      const requestKey = `${enabled ? '1' : '0'}:${nodeId}:${senseId}:${fromRevisionId}:${toRevisionId}`;
      const startedAt = nowMs();
      setLoading(true);
      setError(null);
      try {
        const response = await senseArticleApi.compareRevisions(nodeId, senseId, fromRevisionId, toRevisionId, {
          requestId,
          view: 'senseArticleCompare',
          nodeId,
          senseId
        });
        const isStale = latestRequestKeyRef.current !== requestKey;
        diagLog('sense.compare.request', {
          requestId,
          nodeId,
          senseId,
          fromRevisionId,
          toRevisionId,
          durationMs: durationMs(startedAt),
          isStale,
          status: 'success'
        });
        setCompare(response?.compare || null);
      } catch (requestError) {
        const isStale = latestRequestKeyRef.current !== requestKey;
        diagLog('sense.compare.request', {
          requestId,
          nodeId,
          senseId,
          fromRevisionId,
          toRevisionId,
          durationMs: durationMs(startedAt),
          isStale,
          status: 'error',
          errorName: requestError?.name || 'Error',
          errorMessage: requestError?.message || 'compare request failed'
        });
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
