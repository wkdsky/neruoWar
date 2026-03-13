import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Equal, FunctionSquare, Sigma, Shapes, Workflow } from 'lucide-react';
import DialogFrame from './DialogFrame';
import FormulaPreviewView from '../FormulaPreviewView';
import FormulaSymbolPopover from './FormulaSymbolPopover';
import { FORMULA_DISPLAY_MODES, FORMULA_GROUPS } from '../formula/formulaTemplates';
import { insertLatexAtCursor } from '../formula/insertLatexAtCursor';
import { normalizeFormulaSource } from '../formula/katexRenderUtils';

const GROUP_ICON_BY_KEY = {
  greek: Sigma,
  operators: FunctionSquare,
  relations: Equal,
  arrows: Workflow,
  structure: Shapes,
  special: Shapes
};

const FormulaEditorDialog = ({
  open,
  initialValue = '',
  initialDisplayMode = 'inline',
  onClose,
  onSubmit,
  restoreFocusOnClose = true,
  restoreFocusTarget = null,
  onAfterCloseFocus = null,
  autoFocusTarget = 'none',
  portalTarget = null,
  submitLabel = '插入公式'
}) => {
  const [formulaSource, setFormulaSource] = useState('');
  const [displayMode, setDisplayMode] = useState('inline');
  const [openGroupKey, setOpenGroupKey] = useState('');
  const toolbarButtonRefs = useRef(new Map());
  const textareaRef = useRef(null);
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      hasOpenedRef.current = false;
      setOpenGroupKey('');
      return;
    }
    if (hasOpenedRef.current) return;
    hasOpenedRef.current = true;
    setFormulaSource(String(initialValue || ''));
    setDisplayMode(initialDisplayMode === 'block' ? 'block' : 'inline');
    setOpenGroupKey('');
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      try {
        textareaRef.current.focus({ preventScroll: true });
      } catch (_error) {
        textareaRef.current.focus();
      }
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
    });
  }, [initialDisplayMode, initialValue, open]);

  const normalizedSource = useMemo(() => normalizeFormulaSource(formulaSource), [formulaSource]);
  const openGroup = useMemo(() => FORMULA_GROUPS.find((group) => group.key === openGroupKey) || null, [openGroupKey]);

  const handleInsertSnippet = (item = {}) => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const next = insertLatexAtCursor({
      value: formulaSource,
      selectionStart: textarea.selectionStart || 0,
      selectionEnd: textarea.selectionEnd || 0,
      snippet: item.insert || ''
    }, item.selection || null);
    setFormulaSource(next.value);
    setOpenGroupKey('');
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const footer = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!normalizedSource}
        onClick={() => onSubmit && onSubmit({
          latex: normalizedSource,
          displayMode
        })}
      >
        {submitLabel}
      </button>
    </>
  );

  return (
    <DialogFrame
      open={open}
      title="公式 / 特殊字符"
      description="左侧输入 TeX / LaTeX，顶部工具栏用于插入模板与常用符号，右侧实时预览最终排版。"
      onClose={onClose}
      footer={footer}
      wide
      restoreFocusOnClose={restoreFocusOnClose}
      restoreFocusTarget={restoreFocusTarget}
      onAfterCloseFocus={onAfterCloseFocus}
      autoFocusTarget={autoFocusTarget}
      portalTarget={portalTarget}
      dialogClassName="sense-formula-editor-dialog"
      bodyClassName="sense-formula-editor-dialog-body"
    >
      <div className="sense-formula-editor">
        <div className="sense-formula-editor-toolbar">
          <div className="sense-formula-group-strip">
            {FORMULA_GROUPS.map((group) => {
              const Icon = GROUP_ICON_BY_KEY[group.key] || Shapes;
              return (
                <button
                  key={group.key}
                  ref={(node) => {
                    if (node) toolbarButtonRefs.current.set(group.key, node);
                    else toolbarButtonRefs.current.delete(group.key);
                  }}
                  type="button"
                  className={`sense-formula-group-button${openGroupKey === group.key ? ' active' : ''}`}
                  onClick={() => setOpenGroupKey((prev) => (prev === group.key ? '' : group.key))}
                  title={group.label}
                  aria-label={group.label}
                >
                  {group.key === 'structure' ? <Icon size={15} /> : null}
                  <span>{group.key === 'structure' ? group.label : (group.shortLabel || group.label)}</span>
                </button>
              );
            })}
          </div>
          <div className="sense-formula-mode-shell">
            <span className="sense-formula-mode-label">插入方式</span>
            <div className="sense-formula-mode-switch" role="tablist" aria-label="公式模式">
              {FORMULA_DISPLAY_MODES.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  className={displayMode === mode.key ? 'active' : ''}
                  onClick={() => setDisplayMode(mode.key)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sense-formula-editor-panels">
          <label className="sense-formula-input-pane">
            <div className="sense-formula-pane-head">
              <strong>TeX 输入</strong>
              <span>支持直接输入，也可通过上方工具栏插入模板到当前光标位置。</span>
            </div>
            <textarea
              ref={textareaRef}
              className="sense-formula-latex-input"
              value={formulaSource}
              onChange={(event) => setFormulaSource(event.target.value)}
              placeholder="输入 TeX 公式，例如：\\frac{1}{n}\\sum_{i=1}^{n}x_i"
              spellCheck="false"
            />
          </label>

          <div className="sense-formula-preview-pane">
            <div className="sense-formula-pane-head">
              <strong>实时预览</strong>
              <span>{displayMode === 'block' ? '当前为块公式模式' : '当前为行内公式模式'}</span>
            </div>
            <div className={`sense-formula-preview-card${displayMode === 'block' ? ' block-mode' : ''}`}>
              <FormulaPreviewView
                as="div"
                source={normalizedSource}
                displayMode={displayMode}
                className={`sense-formula-preview-stage${displayMode === 'block' ? ' block-mode' : ''}`}
                placeholder="输入公式后将在这里实时预览"
                showErrorDetails
              />
            </div>
            <div className="sense-formula-source-caption">{normalizedSource || '当前尚未输入公式源码'}</div>
          </div>
        </div>

        <FormulaSymbolPopover
          open={!!openGroup}
          anchorRef={openGroup ? { current: toolbarButtonRefs.current.get(openGroup.key) || null } : null}
          group={openGroup}
          onClose={() => setOpenGroupKey('')}
          onSelect={handleInsertSnippet}
        />
      </div>
    </DialogFrame>
  );
};

export default FormulaEditorDialog;
