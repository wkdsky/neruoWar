import React, { useEffect, useMemo, useState } from 'react';
import './formula/formulaFont.css';
import { ensureKatexReady, normalizeFormulaSource, renderLatexWithKatex } from './formula/katexRenderUtils';

const FormulaPreviewView = ({
  source = '',
  className = '',
  as = 'span',
  placeholder = '',
  title = '',
  displayMode = 'inline',
  showErrorDetails = false,
  ...restProps
}) => {
  const TagName = as;
  const normalizedClassName = ['sense-formula-preview', className].filter(Boolean).join(' ');
  const normalizedSource = useMemo(() => normalizeFormulaSource(source), [source]);
  const [renderState, setRenderState] = useState({
    status: normalizedSource ? 'loading' : 'empty',
    html: '',
    error: ''
  });

  useEffect(() => {
    let active = true;
    if (!normalizedSource) {
      setRenderState({
        status: 'empty',
        html: '',
        error: ''
      });
      return undefined;
    }
    setRenderState((prev) => ({
      status: 'loading',
      html: '',
      error: ''
    }));
    ensureKatexReady()
      .then(() => {
        if (!active) return;
        const rendered = renderLatexWithKatex(normalizedSource, {
          displayMode: displayMode === 'block'
        });
        setRenderState({
          status: rendered.error ? 'error' : 'ready',
          html: rendered.html || '',
          error: rendered.error || ''
        });
      })
      .catch(() => {
        if (!active) return;
        setRenderState({
          status: 'error',
          html: '',
          error: '公式引擎加载失败，请稍后重试。'
        });
      });

    return () => {
      active = false;
    };
  }, [displayMode, normalizedSource]);

  if (renderState.status === 'empty') {
    return (
      <TagName {...restProps} className={`${normalizedClassName} is-empty`} data-formula-placeholder-empty="true">
        {placeholder || '输入公式后在这里预览'}
      </TagName>
    );
  }

  if (renderState.status === 'error') {
    return (
      <TagName {...restProps} className={`${normalizedClassName} is-error`} data-formula-source={normalizedSource} title={title || normalizedSource}>
        <span className="sense-formula-error-badge">公式有误</span>
        {showErrorDetails ? <span className="sense-formula-error-copy">{renderState.error}</span> : null}
      </TagName>
    );
  }

  if (renderState.status === 'loading') {
    return (
      <TagName {...restProps} className={`${normalizedClassName} is-loading`} data-formula-source={normalizedSource} title={title || normalizedSource}>
        正在渲染公式…
      </TagName>
    );
  }

  return (
    <TagName
      {...restProps}
      className={normalizedClassName}
      title={title || normalizedSource}
      data-formula-source={normalizedSource}
      data-formula-display={displayMode}
      dangerouslySetInnerHTML={{ __html: renderState.html }}
    />
  );
};

export default FormulaPreviewView;
