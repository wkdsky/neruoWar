import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { senseArticleApi } from '../../../utils/senseArticleApi';
import {
  diagLog,
  durationMs,
  newFlowId,
  newRequestId,
  nowMs,
  safeJsonByteLength
} from '../../../utils/senseArticleDiagnostics';
import { buildSenseArticleAllianceContext } from '../senseArticleTheme';
import { buildSenseArticleBreadcrumb } from '../senseArticleUi';

const useSenseArticleReadingPageData = ({
  nodeId,
  senseId,
  articleContext,
  onContextPatch,
  myEditsOpen
}) => {
  const [pageData, setPageData] = useState(null);
  const [referenceData, setReferenceData] = useState({ references: [] });
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [readingSideData, setReadingSideData] = useState({ annotations: [], readingMeta: null });
  const [readingSideDataLoading, setReadingSideDataLoading] = useState(false);
  const [readingSideDataError, setReadingSideDataError] = useState('');
  const [myEditsLoading, setMyEditsLoading] = useState(false);
  const [myEditsError, setMyEditsError] = useState('');
  const [myEdits, setMyEdits] = useState([]);
  const [myEditsLoaded, setMyEditsLoaded] = useState(false);
  const [activeFullDraft, setActiveFullDraft] = useState(null);
  const [abandoningRevisionId, setAbandoningRevisionId] = useState('');

  const loadCurrentSequenceRef = useRef(0);
  const readingSideDataRequestSequenceRef = useRef(0);
  const myEditsRequestSequenceRef = useRef(0);
  const myEditsRequestRef = useRef(null);
  const latestRouteRef = useRef({ nodeId, senseId });

  latestRouteRef.current = { nodeId, senseId };

  const loadMyEdits = useCallback(async () => {
    const requestSequence = myEditsRequestSequenceRef.current + 1;
    myEditsRequestSequenceRef.current = requestSequence;
    setMyEditsLoading(true);
    setMyEditsError('');
    const request = senseArticleApi.getMyEdits(nodeId, senseId, { limit: 50 }, { view: 'senseArticlePage' })
      .then((data) => {
        if (myEditsRequestSequenceRef.current !== requestSequence) return [];
        const revisions = Array.isArray(data?.revisions) ? data.revisions.slice() : [];
        setMyEdits(revisions);
        setActiveFullDraft(data?.activeFullDraft || null);
        setMyEditsLoaded(true);
        return revisions;
      })
      .catch((requestError) => {
        if (myEditsRequestSequenceRef.current !== requestSequence) return [];
        setMyEditsError(requestError.message || '加载失败');
        setMyEdits([]);
        setActiveFullDraft(null);
        setMyEditsLoaded(true);
        return [];
      })
      .finally(() => {
        if (myEditsRequestSequenceRef.current === requestSequence) {
          setMyEditsLoading(false);
        }
        if (myEditsRequestRef.current === request) {
          myEditsRequestRef.current = null;
        }
      });
    myEditsRequestRef.current = request;
    return request;
  }, [nodeId, senseId]);

  const loadCurrent = useCallback(async () => {
    const requestId = newRequestId('load-current');
    const flowId = newFlowId('page');
    const requestSequence = loadCurrentSequenceRef.current + 1;
    const startedAt = nowMs();
    loadCurrentSequenceRef.current = requestSequence;
    setLoading(true);
    setError(null);
    try {
      const data = await senseArticleApi.getCurrent(nodeId, senseId, {
        flowId,
        view: 'senseArticlePage',
        requestId: `${requestId}_current`
      });
      const revision = data?.revision || {};
      const isStale = loadCurrentSequenceRef.current !== requestSequence
        || latestRouteRef.current.nodeId !== nodeId
        || latestRouteRef.current.senseId !== senseId;
      diagLog('sense.page.load_current', {
        requestId,
        flowId,
        view: 'senseArticlePage',
        nodeId,
        senseId,
        revisionId: revision?._id || '',
        durationMs: durationMs(startedAt),
        responseBytes: safeJsonByteLength(data),
        blockCount: Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks.length : 0,
        referenceCount: Array.isArray(revision?.referenceIndex) ? revision.referenceIndex.length : 0,
        headingCount: Array.isArray(revision?.headingIndex) ? revision.headingIndex.length : 0,
        isStale
      });
      setPageData(data);
    } catch (requestError) {
      diagLog('sense.page.load_current', {
        requestId,
        flowId,
        view: 'senseArticlePage',
        nodeId,
        senseId,
        durationMs: durationMs(startedAt),
        responseBytes: 0,
        isStale: loadCurrentSequenceRef.current !== requestSequence,
        status: 'error',
        errorName: requestError?.name || 'Error',
        errorMessage: requestError?.message || 'load current failed'
      });
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, [nodeId, senseId]);

  const loadCurrentSideData = useCallback(async () => {
    const requestId = newRequestId('load-current-side');
    const flowId = newFlowId('page');
    const requestSequence = readingSideDataRequestSequenceRef.current + 1;
    const startedAt = nowMs();
    readingSideDataRequestSequenceRef.current = requestSequence;
    setReadingSideDataLoading(true);
    setReadingSideDataError('');
    try {
      const data = await senseArticleApi.getCurrentSideData(nodeId, senseId, {
        flowId,
        view: 'senseArticlePage',
        requestId
      });
      if (readingSideDataRequestSequenceRef.current !== requestSequence) return;
      setReadingSideData({
        annotations: Array.isArray(data?.annotations) ? data.annotations : [],
        readingMeta: data?.readingMeta || null
      });
      diagLog('sense.page.load_current_side_data', {
        requestId,
        flowId,
        view: 'senseArticlePage',
        nodeId,
        senseId,
        durationMs: durationMs(startedAt),
        responseBytes: safeJsonByteLength(data),
        annotationCount: Array.isArray(data?.annotations) ? data.annotations.length : 0,
        hasReadingMeta: !!data?.readingMeta
      });
    } catch (requestError) {
      if (readingSideDataRequestSequenceRef.current !== requestSequence) return;
      setReadingSideData({ annotations: [], readingMeta: null });
      setReadingSideDataError(requestError.message || '加载失败');
      diagLog('sense.page.load_current_side_data', {
        requestId,
        flowId,
        view: 'senseArticlePage',
        nodeId,
        senseId,
        durationMs: durationMs(startedAt),
        responseBytes: 0,
        status: 'error',
        errorName: requestError?.name || 'Error',
        errorMessage: requestError?.message || 'load current side data failed'
      });
    } finally {
      if (readingSideDataRequestSequenceRef.current === requestSequence) {
        setReadingSideDataLoading(false);
      }
    }
  }, [nodeId, senseId]);

  const refreshAll = useCallback(() => {
    loadCurrent();
    loadMyEdits();
    loadCurrentSideData();
  }, [loadCurrent, loadCurrentSideData, loadMyEdits]);

  const abandonMyEdit = useCallback(async (revisionId) => {
    const normalizedRevisionId = String(revisionId || '').trim();
    if (!normalizedRevisionId || abandoningRevisionId) return;
    const confirmed = window.confirm('确定放弃这条未提交审核的修订吗？删除后无法恢复。');
    if (!confirmed) return;
    setAbandoningRevisionId(normalizedRevisionId);
    try {
      await senseArticleApi.deleteDraft(nodeId, senseId, normalizedRevisionId);
      setMyEdits((prev) => prev.filter((item) => String(item?._id || '') !== normalizedRevisionId));
    } catch (requestError) {
      window.alert(requestError.message || '放弃修订失败');
    } finally {
      setAbandoningRevisionId('');
    }
  }, [abandoningRevisionId, nodeId, senseId]);

  useEffect(() => {
    let cancelled = false;
    setReferencesLoading(true);
    const requestId = newRequestId('load-references');
    const flowId = newFlowId('page');
    const startedAt = nowMs();
    senseArticleApi.getReferences(nodeId, senseId, {
      flowId,
      view: 'senseArticlePage',
      requestId
    }).then((references) => {
      if (cancelled) return;
      setReferenceData(references || { references: [] });
      diagLog('sense.page.load_references', {
        requestId,
        flowId,
        view: 'senseArticlePage',
        nodeId,
        senseId,
        durationMs: durationMs(startedAt),
        responseBytes: safeJsonByteLength(references || { references: [] }),
        referenceCount: Array.isArray(references?.references) ? references.references.length : 0
      });
    }).catch(() => {
      if (cancelled) return;
      setReferenceData({ references: [] });
    }).finally(() => {
      if (!cancelled) setReferencesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId, senseId]);

  useEffect(() => {
    loadCurrent();
  }, [loadCurrent]);

  useEffect(() => {
    loadCurrentSideData();
  }, [loadCurrentSideData]);

  useEffect(() => {
    if (!pageData) return;
    const node = pageData.node || {};
    const nodeSense = pageData.nodeSense || {};
    const article = pageData.article || {};
    const revision = pageData.revision || {};
    onContextPatch && onContextPatch({
      nodeId,
      senseId,
      articleId: article._id || '',
      currentRevisionId: article.currentRevisionId || revision._id || '',
      selectedRevisionId: revision._id || '',
      revisionId: revision._id || '',
      nodeName: node.name || '',
      senseTitle: nodeSense.title || senseId,
      revisionStatus: revision.status || '',
      ...buildSenseArticleAllianceContext(node, articleContext),
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: node.name || '',
        senseTitle: nodeSense.title || senseId,
        pageType: 'senseArticle',
        revisionNumber: revision.revisionNumber
      })
    });
  }, [articleContext, nodeId, onContextPatch, pageData, senseId]);

  useEffect(() => {
    if (myEditsOpen && !myEditsLoaded && !myEditsRequestRef.current) {
      loadMyEdits();
    }
  }, [loadMyEdits, myEditsLoaded, myEditsOpen]);

  useEffect(() => {
    if (!pageData?.permissions?.canCreateRevision) return;
    if (myEditsLoaded || myEditsRequestRef.current) return;
    loadMyEdits();
  }, [loadMyEdits, myEditsLoaded, pageData?.permissions?.canCreateRevision]);

  useEffect(() => {
    if (!articleContext?.myEditsRefreshKey) return;
    refreshAll();
  }, [articleContext?.myEditsRefreshKey, refreshAll]);

  useEffect(() => {
    setMyEdits([]);
    setMyEditsError('');
    setMyEditsLoaded(false);
    setMyEditsLoading(false);
    setActiveFullDraft(null);
    setReadingSideData({ annotations: [], readingMeta: null });
    setReadingSideDataLoading(false);
    setReadingSideDataError('');
    readingSideDataRequestSequenceRef.current += 1;
    myEditsRequestSequenceRef.current += 1;
    myEditsRequestRef.current = null;
  }, [nodeId, senseId]);

  const annotations = useMemo(() => (
    Array.isArray(readingSideData?.annotations) ? readingSideData.annotations : []
  ), [readingSideData?.annotations]);

  const annotationsByStatus = useMemo(() => {
    const groups = { exact: [], relocated: [], uncertain: [], broken: [] };
    annotations.forEach((item) => {
      const status = item?.relocation?.status || 'exact';
      if (groups[status]) groups[status].push(item);
    });
    return groups;
  }, [annotations]);

  const referenceMap = useMemo(() => (
    new Map((referenceData.references || []).map((item) => [item.referenceId, item]))
  ), [referenceData]);

  return {
    pageData,
    referenceData,
    referenceMap,
    referencesLoading,
    loading,
    error,
    readingSideData,
    readingSideDataLoading,
    readingSideDataError,
    annotations,
    annotationsByStatus,
    myEditsLoading,
    myEditsError,
    myEdits,
    activeFullDraft,
    abandoningRevisionId,
    loadMyEdits,
    loadCurrentSideData,
    abandonMyEdit
  };
};

export default useSenseArticleReadingPageData;
