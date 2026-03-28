import { useCallback, useEffect, useRef, useState } from 'react';
import { senseArticleApi } from '../../../utils/senseArticleApi';
import { ANNOTATION_COLORS, buildSelectionAnchor } from '../reading/senseArticleReadingUi';

const useSenseArticleSelectionTools = ({
  nodeId,
  senseId,
  loadCurrentSideData
}) => {
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [annotationDraft, setAnnotationDraft] = useState({ note: '', color: ANNOTATION_COLORS[0] });
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [referencePreview, setReferencePreview] = useState(null);

  const selectionToolbarRef = useRef(null);

  useEffect(() => {
    const handleMouseUp = () => setSelectionAnchor(buildSelectionAnchor());
    const handleMouseDown = (event) => {
      if (selectionToolbarRef.current && selectionToolbarRef.current.contains(event.target)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSelectionAnchor(null);
    };
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const createAnnotation = useCallback(async () => {
    if (!selectionAnchor?.selectionText) return;
    setAnnotationSaving(true);
    try {
      await senseArticleApi.createAnnotation(nodeId, senseId, {
        anchorType: 'text_range',
        anchor: selectionAnchor,
        highlightColor: annotationDraft.color,
        note: annotationDraft.note
      });
      setSelectionAnchor(null);
      setAnnotationDraft({ note: '', color: ANNOTATION_COLORS[0] });
      await loadCurrentSideData();
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setAnnotationSaving(false);
    }
  }, [annotationDraft.color, annotationDraft.note, loadCurrentSideData, nodeId, selectionAnchor, senseId]);

  const handleReferenceHover = useCallback((reference, anchorElement) => {
    if (!reference || !anchorElement) {
      setReferencePreview(null);
      return;
    }
    const rect = anchorElement.getBoundingClientRect();
    setReferencePreview({
      reference,
      rect: {
        left: rect.left + window.scrollX,
        top: rect.bottom + window.scrollY + 8
      }
    });
  }, []);

  return {
    selectionAnchor,
    annotationDraft,
    setAnnotationDraft,
    annotationSaving,
    referencePreview,
    selectionToolbarRef,
    createAnnotation,
    handleReferenceHover
  };
};

export default useSenseArticleSelectionTools;
