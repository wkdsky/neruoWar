const createSenseArticleAnnotationService = ({
  SenseAnnotation,
  createAnchorFromSelection,
  createExposeError,
  getArticleBundle,
  normalizeAnchor,
  relocateAnchor,
  serializeAnnotation,
  serializeArticleSummary
} = {}) => {
  const listMyAnnotations = async ({ nodeId, senseId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const annotations = await SenseAnnotation.find({ userId, articleId: bundle.article._id }).sort({ updatedAt: -1 }).lean();
    return {
      article: serializeArticleSummary(bundle.article),
      revisionId: bundle.currentRevision?._id || null,
      annotations: annotations.map((item) => serializeAnnotation(item, relocateAnchor({ anchor: item.anchor, currentRevision: bundle.currentRevision })))
    };
  };

  const createAnnotation = async ({ nodeId, senseId, userId, payload = {} }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const anchor = payload.anchorType === 'text_range'
      ? createAnchorFromSelection({
          revision: bundle.currentRevision,
          blockId: payload?.anchor?.blockId || '',
          headingId: payload?.anchor?.headingId || '',
          selectionText: payload?.anchor?.selectionText || payload?.anchor?.textQuote || '',
          textPositionStart: payload?.anchor?.textPositionStart,
          textPositionEnd: payload?.anchor?.textPositionEnd,
          prefixText: payload?.anchor?.prefixText || payload?.anchor?.beforeText || '',
          suffixText: payload?.anchor?.suffixText || payload?.anchor?.afterText || ''
        })
      : normalizeAnchor(payload.anchor, bundle.currentRevision?._id || null);
    const annotation = await SenseAnnotation.create({
      userId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      articleId: bundle.article._id,
      revisionId: payload.revisionId || bundle.currentRevision?._id || null,
      anchorType: payload.anchorType || 'text_range',
      anchor,
      highlightColor: typeof payload.highlightColor === 'string' && payload.highlightColor.trim() ? payload.highlightColor.trim() : '#fde68a',
      note: typeof payload.note === 'string' ? payload.note.trim() : '',
      visibility: 'private'
    });
    return serializeAnnotation(annotation.toObject(), relocateAnchor({ anchor: annotation.anchor, currentRevision: bundle.currentRevision }));
  };

  const updateAnnotation = async ({ nodeId, senseId, annotationId, userId, payload = {} }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const annotation = await SenseAnnotation.findOne({ _id: annotationId, userId, articleId: bundle.article._id });
    if (!annotation) throw createExposeError('标注不存在', 404, 'annotation_not_found');
    if (payload.anchor) {
      annotation.anchor = payload.anchorType === 'text_range'
        ? createAnchorFromSelection({
            revision: bundle.currentRevision,
            blockId: payload.anchor.blockId,
            headingId: payload.anchor.headingId,
            selectionText: payload.anchor.selectionText || payload.anchor.textQuote || '',
            textPositionStart: payload.anchor.textPositionStart,
            textPositionEnd: payload.anchor.textPositionEnd,
            prefixText: payload.anchor.prefixText || payload.anchor.beforeText || '',
            suffixText: payload.anchor.suffixText || payload.anchor.afterText || ''
          })
        : normalizeAnchor(payload.anchor, bundle.currentRevision?._id || null);
    }
    if (typeof payload.note === 'string') annotation.note = payload.note.trim();
    if (typeof payload.highlightColor === 'string' && payload.highlightColor.trim()) annotation.highlightColor = payload.highlightColor.trim();
    await annotation.save();
    return serializeAnnotation(annotation.toObject(), relocateAnchor({ anchor: annotation.anchor, currentRevision: bundle.currentRevision }));
  };

  const deleteAnnotation = async ({ nodeId, senseId, annotationId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const result = await SenseAnnotation.deleteOne({ _id: annotationId, userId, articleId: bundle.article._id });
    return { deleted: (result?.deletedCount || 0) > 0 };
  };

  return {
    createAnnotation,
    deleteAnnotation,
    listMyAnnotations,
    updateAnnotation
  };
};

module.exports = {
  createSenseArticleAnnotationService
};
