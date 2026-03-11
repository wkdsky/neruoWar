import React, { useEffect, useMemo, useState } from 'react';
import DialogFrame from './DialogFrame';

const InsertLinkDialog = ({
  open,
  mode = 'external',
  initialValue = {},
  onClose,
  onSubmit,
  onSearchReferences
}) => {
  const [tab, setTab] = useState(mode);
  const [href, setHref] = useState('');
  const [targetBlank, setTargetBlank] = useState(true);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [referenceDisplayText, setReferenceDisplayText] = useState('');
  const [referenceResults, setReferenceResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(mode || 'external');
    setHref(initialValue.href || '');
    setTargetBlank(initialValue.target === '_blank' || !initialValue.target);
    setReferenceQuery('');
    setReferenceDisplayText(initialValue.displayText || '');
    setReferenceResults([]);
  }, [open, mode, initialValue]);

  useEffect(() => {
    let active = true;
    if (!open || tab !== 'internal' || !referenceQuery.trim()) {
      setReferenceResults([]);
      return undefined;
    }
    const timerId = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await onSearchReferences(referenceQuery.trim());
        if (!active) return;
        setReferenceResults(Array.isArray(data?.results) ? data.results : []);
      } catch (_error) {
        if (active) setReferenceResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 240);

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [open, tab, referenceQuery, onSearchReferences]);

  const footer = useMemo(() => (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
      {tab === 'external' ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!href.trim()}
          onClick={() => onSubmit({
            type: 'external',
            href: href.trim(),
            target: targetBlank ? '_blank' : '_self'
          })}
        >
          插入链接
        </button>
      ) : null}
    </>
  ), [href, onClose, onSubmit, tab, targetBlank]);

  return (
    <DialogFrame open={open} title="插入链接" description="支持插入外部 URL 或内部百科引用；内部引用会保留 nodeId 与 senseId 元数据。" onClose={onClose} footer={footer} wide>
      <div className="sense-rich-link-tabs">
        <button type="button" className={tab === 'external' ? 'active' : ''} onClick={() => setTab('external')}>外部链接</button>
        <button type="button" className={tab === 'internal' ? 'active' : ''} onClick={() => setTab('internal')}>内部百科引用</button>
      </div>
      {tab === 'external' ? (
        <div className="sense-rich-form-grid">
          <label>
            <span>URL</span>
            <input value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://example.com" />
          </label>
          <label className="sense-rich-checkbox-row">
            <input type="checkbox" checked={targetBlank} onChange={(event) => setTargetBlank(event.target.checked)} />
            <span>新窗口打开</span>
          </label>
        </div>
      ) : (
        <div className="sense-rich-form-grid">
          <label>
            <span>搜索目标词条 / 释义</span>
            <input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="输入关键词" />
          </label>
          <label>
            <span>显示文本</span>
            <input value={referenceDisplayText} onChange={(event) => setReferenceDisplayText(event.target.value)} placeholder="可选" />
          </label>
          <div className="sense-rich-reference-list">
            {loading ? <div className="sense-rich-reference-empty">正在搜索…</div> : null}
            {!loading && referenceResults.length === 0 ? <div className="sense-rich-reference-empty">没有匹配结果</div> : null}
            {referenceResults.map((result) => (
              <button
                key={`${result.nodeId}-${result.senseId}`}
                type="button"
                className="sense-rich-reference-item"
                onClick={() => onSubmit({
                  type: 'internal',
                  nodeId: result.nodeId,
                  senseId: result.senseId,
                  displayText: referenceDisplayText.trim() || result.senseTitle || result.displayLabel || `${result.nodeId}:${result.senseId}`
                })}
              >
                <strong>{result.displayLabel || result.senseTitle || result.senseId}</strong>
                <span>{result.summary || '无摘要'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </DialogFrame>
  );
};

export default InsertLinkDialog;
