import React from 'react';
import { ANNOTATION_COLORS, buildSelectionToolbarStyle } from './senseArticleReadingUi';

const SenseArticleSelectionToolbar = ({
  selectionAnchor,
  selectionToolbarRef,
  annotationDraft,
  onAnnotationDraftChange,
  annotationSaving,
  onCreateAnnotation,
  onOpenSelectionEditor
}) => {
  if (!selectionAnchor?.selectionText) return null;

  const style = buildSelectionToolbarStyle(selectionAnchor);

  return (
    <div className="sense-selection-toolbar" style={style} ref={selectionToolbarRef}>
      <div className="sense-selection-toolbar-title">已选中：{selectionAnchor.selectionText.slice(0, 36)}{selectionAnchor.selectionText.length > 36 ? '…' : ''}</div>
      <div className="sense-selection-toolbar-actions">
        <button type="button" className="btn btn-small btn-primary" onClick={onOpenSelectionEditor}>
          选段修订
        </button>
        <button type="button" className="btn btn-small btn-secondary" onClick={onCreateAnnotation} disabled={annotationSaving}>
          {annotationSaving ? '保存中...' : '高亮/标注'}
        </button>
      </div>
      <div className="sense-annotation-inline-form">
        <div className="sense-annotation-color-row">
          {ANNOTATION_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`sense-color-swatch ${annotationDraft.color === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onAnnotationDraftChange((prev) => ({ ...prev, color }))}
            />
          ))}
        </div>
        <textarea value={annotationDraft.note} placeholder="仅自己可见的备注" onChange={(event) => onAnnotationDraftChange((prev) => ({ ...prev, note: event.target.value }))} />
      </div>
    </div>
  );
};

export default SenseArticleSelectionToolbar;
