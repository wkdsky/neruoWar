import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AUTOSAVE_DEBOUNCE_MS = 1800;

export const formatAutosaveTime = (value = null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

const useSenseArticleAutosave = ({
  nodeId,
  senseId,
  revisionId,
  snapshot,
  revisionVersion = 0,
  initialLastSavedAt = null,
  enabled = true,
  onSave,
  onAfterSave
}) => {
  const snapshotString = useMemo(() => JSON.stringify(snapshot || {}), [snapshot]);
  const [status, setStatus] = useState('saved');
  const [lastSavedAt, setLastSavedAt] = useState(initialLastSavedAt);
  const [error, setError] = useState(null);
  const lastSavedSignatureRef = useRef(snapshotString);
  const snapshotRef = useRef(snapshot);
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  const savePromiseRef = useRef(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    lastSavedSignatureRef.current = JSON.stringify(snapshotRef.current || {});
    setLastSavedAt(initialLastSavedAt);
    setStatus('saved');
    setError(null);
  }, [initialLastSavedAt, revisionVersion, revisionId]);

  const saveNow = useCallback(async ({ reason = 'manual', snapshotOverride = null, force = false } = {}) => {
    if (!enabled || typeof onSave !== 'function') return { ok: true, skipped: true };
    window.clearTimeout(timerRef.current);
    while (savingRef.current && savePromiseRef.current) {
      try {
        await savePromiseRef.current;
      } catch (_error) {
        break;
      }
    }
    const latestSnapshot = snapshotOverride || snapshotRef.current || {};
    const signature = JSON.stringify(latestSnapshot);
    if (!force && signature === lastSavedSignatureRef.current) {
      setStatus('saved');
      return { ok: true, skipped: true };
    }
    savingRef.current = true;
    setStatus('saving');
    setError(null);
    let currentSavePromise = null;
    currentSavePromise = (async () => {
      try {
        const response = await onSave({
          snapshot: latestSnapshot,
          expectedRevisionVersion: revisionVersion,
          reason
        });
        snapshotRef.current = latestSnapshot;
        lastSavedSignatureRef.current = signature;
        setLastSavedAt(response?.revision?.updatedAt || new Date().toISOString());
        setStatus('saved');
        setError(null);
        if (typeof onAfterSave === 'function') onAfterSave(response, latestSnapshot);
        return { ok: true, response };
      } catch (requestError) {
        setStatus(requestError?.code === 'revision_edit_conflict' || requestError?.payload?.code === 'revision_edit_conflict' ? 'conflict' : 'error');
        setError(requestError);
        return { ok: false, error: requestError };
      } finally {
        savingRef.current = false;
        if (savePromiseRef.current === currentSavePromise) {
          savePromiseRef.current = null;
        }
      }
    })();
    savePromiseRef.current = currentSavePromise;
    return currentSavePromise;
  }, [enabled, onAfterSave, onSave, revisionVersion]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (snapshotString === lastSavedSignatureRef.current) {
      if (status !== 'saved') setStatus('saved');
      return undefined;
    }
    setStatus((prev) => (prev === 'saving' ? prev : 'dirty'));
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      saveNow({ reason: 'autosave' });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [enabled, saveNow, snapshotString, status]);

  const retry = useCallback(() => saveNow({ reason: 'retry' }), [saveNow]);

  const isDirty = enabled && snapshotString !== lastSavedSignatureRef.current;

  return {
    status,
    error,
    isDirty,
    lastSavedAt,
    saveNow,
    retry
  };
};

export default useSenseArticleAutosave;
