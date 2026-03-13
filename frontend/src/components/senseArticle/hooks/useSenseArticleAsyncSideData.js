import { useCallback, useEffect, useRef, useState } from 'react';
import { senseArticleApi } from '../../../utils/senseArticleApi';
import { diagLog, diagWarn, durationMs, nowMs } from '../../../utils/senseArticleDiagnostics';

const EMPTY_MEDIA_LIBRARY = Object.freeze({
  referencedAssets: [],
  recentAssets: [],
  orphanCandidates: []
});

const buildIdleState = (status = 'idle') => ({
  status,
  error: null,
  lastLoadedAt: null
});

const normalizeMediaLibrary = (data = null) => ({
  referencedAssets: Array.isArray(data?.referencedAssets) ? data.referencedAssets : [],
  recentAssets: Array.isArray(data?.recentAssets) ? data.recentAssets : [],
  orphanCandidates: Array.isArray(data?.orphanCandidates) ? data.orphanCandidates : []
});

const useSenseArticleAsyncSideData = ({
  nodeId,
  senseId,
  revisionId,
  enabled = true,
  initialValidationSnapshot = null
}) => {
  const [mediaLibrary, setMediaLibrary] = useState(EMPTY_MEDIA_LIBRARY);
  const [mediaState, setMediaState] = useState(buildIdleState());
  const [validationSnapshot, setValidationSnapshot] = useState(initialValidationSnapshot || null);
  const [validationState, setValidationState] = useState(buildIdleState(initialValidationSnapshot ? 'ready' : 'idle'));
  const initialValidationSnapshotRef = useRef(initialValidationSnapshot || null);
  const mediaRequestSequenceRef = useRef(0);
  const validationRequestSequenceRef = useRef(0);

  const normalizedRevisionId = String(revisionId || '').trim();

  useEffect(() => {
    initialValidationSnapshotRef.current = initialValidationSnapshot || null;
  }, [initialValidationSnapshot]);

  useEffect(() => {
    setMediaLibrary(EMPTY_MEDIA_LIBRARY);
    setMediaState(buildIdleState(normalizedRevisionId && enabled ? 'loading' : 'idle'));
    setValidationSnapshot(initialValidationSnapshotRef.current || null);
    setValidationState(buildIdleState(initialValidationSnapshotRef.current ? 'ready' : normalizedRevisionId && enabled ? 'loading' : 'idle'));
    mediaRequestSequenceRef.current += 1;
    validationRequestSequenceRef.current += 1;
  }, [enabled, normalizedRevisionId]);

  useEffect(() => {
    if (!initialValidationSnapshot) return;
    setValidationSnapshot(initialValidationSnapshot);
    setValidationState((prev) => ({
      status: 'ready',
      error: null,
      lastLoadedAt: prev.lastLoadedAt || new Date().toISOString()
    }));
  }, [initialValidationSnapshot]);

  const loadMediaLibrary = useCallback(async () => {
    if (!enabled || !normalizedRevisionId) return null;
    const requestSequence = mediaRequestSequenceRef.current + 1;
    mediaRequestSequenceRef.current = requestSequence;
    const startedAt = nowMs();
    setMediaState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const data = await senseArticleApi.listMediaAssets(nodeId, senseId, { revisionId: normalizedRevisionId }, {
        view: 'senseArticleEditor',
        apiName: 'listEditorMediaLibrary',
        revisionId: normalizedRevisionId
      });
      if (mediaRequestSequenceRef.current !== requestSequence) return null;
      const nextLibrary = normalizeMediaLibrary(data);
      setMediaLibrary(nextLibrary);
      setMediaState({
        status: 'ready',
        error: null,
        lastLoadedAt: new Date().toISOString()
      });
      diagLog('sense.editor.side_data.media', {
        nodeId,
        senseId,
        revisionId: normalizedRevisionId,
        durationMs: durationMs(startedAt),
        referencedCount: nextLibrary.referencedAssets.length,
        recentCount: nextLibrary.recentAssets.length,
        orphanCount: nextLibrary.orphanCandidates.length
      });
      return nextLibrary;
    } catch (error) {
      if (mediaRequestSequenceRef.current !== requestSequence) return null;
      setMediaLibrary(EMPTY_MEDIA_LIBRARY);
      setMediaState({
        status: 'error',
        error,
        lastLoadedAt: null
      });
      diagWarn('sense.editor.side_data.media', {
        nodeId,
        senseId,
        revisionId: normalizedRevisionId,
        durationMs: durationMs(startedAt),
        errorName: error?.name || 'Error',
        errorMessage: error?.message || 'load media library failed'
      });
      return null;
    }
  }, [enabled, nodeId, normalizedRevisionId, senseId]);

  const loadValidation = useCallback(async ({ force = false } = {}) => {
    if (!enabled || !normalizedRevisionId) return null;
    if (!force && initialValidationSnapshot) return initialValidationSnapshot;
    const requestSequence = validationRequestSequenceRef.current + 1;
    validationRequestSequenceRef.current = requestSequence;
    const startedAt = nowMs();
    setValidationState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const data = await senseArticleApi.getRevisionValidation(nodeId, senseId, normalizedRevisionId, {
        view: 'senseArticleEditor',
        revisionId: normalizedRevisionId
      });
      if (validationRequestSequenceRef.current !== requestSequence) return null;
      const nextValidation = data?.validationSnapshot || null;
      setValidationSnapshot(nextValidation);
      setValidationState({
        status: 'ready',
        error: null,
        lastLoadedAt: new Date().toISOString()
      });
      diagLog('sense.editor.side_data.validation', {
        nodeId,
        senseId,
        revisionId: normalizedRevisionId,
        durationMs: durationMs(startedAt),
        blockingCount: Array.isArray(nextValidation?.blocking) ? nextValidation.blocking.length : 0,
        warningCount: Array.isArray(nextValidation?.warnings) ? nextValidation.warnings.length : 0,
        mediaReferenceCount: Number(data?.mediaReferenceCount || 0)
      });
      return nextValidation;
    } catch (error) {
      if (validationRequestSequenceRef.current !== requestSequence) return null;
      setValidationState({
        status: 'error',
        error,
        lastLoadedAt: null
      });
      diagWarn('sense.editor.side_data.validation', {
        nodeId,
        senseId,
        revisionId: normalizedRevisionId,
        durationMs: durationMs(startedAt),
        errorName: error?.name || 'Error',
        errorMessage: error?.message || 'load validation failed'
      });
      return null;
    }
  }, [enabled, initialValidationSnapshot, nodeId, normalizedRevisionId, senseId]);

  useEffect(() => {
    if (!enabled || !normalizedRevisionId) return undefined;
    loadMediaLibrary();
    if (!initialValidationSnapshot) {
      loadValidation();
    }
    return undefined;
  }, [enabled, initialValidationSnapshot, loadMediaLibrary, loadValidation, normalizedRevisionId]);

  return {
    mediaLibrary,
    mediaState,
    reloadMediaLibrary: loadMediaLibrary,
    validationSnapshot,
    validationState,
    reloadValidation: () => loadValidation({ force: true }),
    setMediaLibrary,
    setValidationSnapshot
  };
};

export default useSenseArticleAsyncSideData;
