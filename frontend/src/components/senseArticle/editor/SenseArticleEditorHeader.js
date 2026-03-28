import React from 'react';
import { ArrowLeft } from 'lucide-react';

const SenseArticleEditorHeader = ({
  inputRef,
  nodeName,
  senseTitle,
  senseTitleDraft,
  isEditingSenseTitle,
  canEdit,
  onSenseTitleDraftChange,
  onCommitSenseTitleEdit,
  onCancelSenseTitleEdit,
  onStartSenseTitleEdit,
  onBack,
  backLabel
}) => {
  const editorHeaderTitle = (
    <span className="sense-editor-header-title">
      <span>{nodeName}</span>
      <span className="sense-editor-header-separator">/</span>
      {isEditingSenseTitle ? (
        <input
          ref={inputRef}
          value={senseTitleDraft}
          onChange={(event) => onSenseTitleDraftChange(event.target.value)}
          onBlur={onCommitSenseTitleEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommitSenseTitleEdit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancelSenseTitleEdit();
            }
          }}
          className="sense-editor-header-input"
          disabled={!canEdit}
          aria-label="释义名"
        />
      ) : (
        <span
          className={`sense-editor-header-editable${canEdit ? '' : ' disabled'}`}
          onDoubleClick={() => {
            if (!canEdit) return;
            onStartSenseTitleEdit();
          }}
          title={canEdit ? '双击释义名进行修改' : ''}
        >
          {senseTitle}
        </span>
      )}
      {canEdit && !isEditingSenseTitle ? <span className="sense-editor-header-hint">双击释义名修改</span> : null}
    </span>
  );

  return (
    <div className="sense-rich-editor-shell-head-row">
      <button type="button" className="btn btn-secondary sense-rich-editor-shell-back" onClick={onBack}>
        <ArrowLeft size={16} /> {backLabel}
      </button>
      <div className="sense-rich-editor-shell-title">
        {editorHeaderTitle}
      </div>
    </div>
  );
};

export default SenseArticleEditorHeader;
