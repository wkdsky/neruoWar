import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AUTOSAVE_DEBOUNCE_MS = 1800;

const buildCacheKey = ({ nodeId = '', senseId = '', revisionId = '' } = {}) => (
  `sense-rich-autosave:${String(nodeId)}:${String(senseId)}:${String(revisionId)}`
);

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
};

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
  const cacheKey = useMemo(() => buildCacheKey({ nodeId, senseId, revisionId }), [nodeId, senseId, revisionId]);
  const snapshotString = useMemo(() => JSON.stringify(snapshot || {}), [snapshot]);
  const [status, setStatus] = useState('saved');
  const [lastSavedAt, setLastSavedAt] = useState(initialLastSavedAt);
  const [error, setError] = useState(null);
  const [recoverableDraft, setRecoverableDraft] = useState(null);
  const lastSavedSignatureRef = useRef(snapshotString);
  const snapshotRef = useRef(snapshot);
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  const initializedKeyRef = useRef('');

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const nextInitKey = `${cacheKey}:${revisionVersion}:${initialLastSavedAt || ''}`;
    if (initializedKeyRef.current === nextInitKey) return;
    initializedKeyRef.current = nextInitKey;
    lastSavedSignatureRef.current = snapshotString;
    setLastSavedAt(initialLastSavedAt);
    setStatus('saved');
    setError(null);
    const stored = safeParse(window.localStorage.getItem(cacheKey) || '');
    if (!stored?.snapshot) {
      setRecoverableDraft(null);
      return;
    }
    const storedSignature = JSON.stringify(stored.snapshot);
    if (storedSignature === snapshotString) {
      window.localStorage.removeItem(cacheKey);
      setRecoverableDraft(null);
      return;
    }
    setRecoverableDraft(stored);
  }, [cacheKey, initialLastSavedAt, revisionVersion, snapshotString]);

  const persistLocalBackup = useCallback((nextSnapshot) => {
    if (!enabled || !cacheKey) return;
    const payload = {
      nodeId,
      senseId,
      revisionId,
      contentFormat: nextSnapshot?.contentFormat || 'rich_html',
      savedAt: new Date().toISOString(),
      snapshot: nextSnapshot
    };
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
    setRecoverableDraft(payload);
  }, [cacheKey, enabled, nodeId, revisionId, senseId]);

  const clearLocalBackup = useCallback(() => {
    if (!cacheKey) return;
    window.localStorage.removeItem(cacheKey);
    setRecoverableDraft(null);
  }, [cacheKey]);

  const saveNow = useCallback(async ({ reason = 'manual' } = {}) => {
    if (!enabled || savingRef.current || typeof onSave !== 'function') return { ok: true, skipped: true };
    window.clearTimeout(timerRef.current);
    const latestSnapshot = snapshotRef.current || {};
    const signature = JSON.stringify(latestSnapshot);
    if (signature === lastSavedSignatureRef.current) {
      setStatus('saved');
      return { ok: true, skipped: true };
    }
    savingRef.current = true;
    setStatus('saving');
    setError(null);
    persistLocalBackup(latestSnapshot);
    try {
      const response = await onSave({
        snapshot: latestSnapshot,
        expectedRevisionVersion: revisionVersion,
        reason
      });
      lastSavedSignatureRef.current = signature;
      setLastSavedAt(response?.revision?.updatedAt || new Date().toISOString());
      setStatus('saved');
      setError(null);
      clearLocalBackup();
      if (typeof onAfterSave === 'function') onAfterSave(response);
      return { ok: true, response };
    } catch (requestError) {
      setStatus(requestError?.code === 'revision_edit_conflict' || requestError?.payload?.code === 'revision_edit_conflict' ? 'conflict' : 'error');
      setError(requestError);
      persistLocalBackup(latestSnapshot);
      return { ok: false, error: requestError };
    } finally {
      savingRef.current = false;
    }
  }, [clearLocalBackup, enabled, onAfterSave, onSave, persistLocalBackup, revisionVersion]);

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

  const restoreLocalDraft = useCallback(() => {
    if (!recoverableDraft?.snapshot) return null;
    return recoverableDraft.snapshot;
  }, [recoverableDraft]);

  const isDirty = enabled && snapshotString !== lastSavedSignatureRef.current;

  return {
    status,
    error,
    isDirty,
    lastSavedAt,
    recoverableDraft,
    restoreLocalDraft,
    discardRecovery: clearLocalBackup,
    saveNow,
    retry,
    clearLocalBackup
  };
};

export default useSenseArticleAutosave;
