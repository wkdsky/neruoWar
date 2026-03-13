import React, { useEffect, useMemo, useRef, useState } from 'react';
import DialogFrame from './DialogFrame';
import { buildAttachmentCaptionText, resolveAttachmentReferenceText } from '../extensions/mediaAttachmentFormat';

const DIALOG_META = {
  media: {
    title: '引用内部多媒体',
    description: '仅显示正文中已保存的附件实例；点击后会在当前光标位置插入“附件n”超链接，并跳转到对应附件。'
  },
  external: {
    title: '引用外部链接',
    description: '插入标准外部链接。'
  },
  literature: {
    title: '引用文献',
    description: '插入文献引用链接；当前以标准链接形式写入正文。'
  },
  internal: {
    title: '引用其他释义',
    description: '搜索并引用其他释义百科条目；会保留 nodeId 与 senseId 元数据。'
  }
};

const MEDIA_TABS = [
  { key: 'image', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' }
];

const getDefaultDisplayText = (initialValue = {}) => String(initialValue?.displayText || '').trim();

const buildSavedMediaAssets = (mediaLibrary = null) => {
  const referencedAssets = Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets : [];
  const deduped = [...referencedAssets].filter((asset, index, array) => {
    const assetId = String(asset?._id || '');
    return !!assetId && array.findIndex((item) => String(item?._id || '') === assetId) === index;
  });
  return deduped.filter((asset) => !asset?.isTemporary && String(asset?.status || '').trim() === 'active');
};

const resolveMediaLabel = (asset = {}) => (
  asset?.originalName
  || asset?.title
  || asset?.caption
  || asset?.description
  || asset?.url
  || '未命名媒体'
);

const buildFallbackMediaAttachments = (mediaLibrary = null) => buildSavedMediaAssets(mediaLibrary).map((asset, index) => ({
  key: String(asset?._id || `${asset?.kind || 'media'}-${index}`),
  kind: asset?.kind || 'image',
  assetId: String(asset?._id || ''),
  attachmentId: '',
  attachmentIndex: index + 1,
  attachmentTitle: resolveMediaLabel(asset),
  displayLabel: buildAttachmentCaptionText({
    attachmentIndex: index + 1,
    nodeName: asset?.kind === 'audio' ? 'audioNode' : asset?.kind === 'video' ? 'videoNode' : 'figureImage',
    attachmentTitle: resolveMediaLabel(asset)
  }),
  statusLabel: `${asset?.mimeType || asset?.kind || '媒体'} · 已保存`
}));

const InsertLinkDialog = ({
  open,
  mode = 'external',
  initialValue = {},
  onClose,
  onSubmit,
  onSearchReferences,
  mediaLibrary = null,
  mediaAttachments = null,
  restoreFocusOnClose = true,
  restoreFocusTarget = null,
  onAfterCloseFocus = null,
  autoFocusTarget = 'closeButton',
  portalTarget = null
}) => {
  const [href, setHref] = useState('');
  const [targetBlank, setTargetBlank] = useState(true);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [referenceDisplayText, setReferenceDisplayText] = useState('');
  const [referenceResults, setReferenceResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [literatureTitle, setLiteratureTitle] = useState('');
  const [mediaTab, setMediaTab] = useState('image');
  const lastOpenModeRef = useRef('');
  const initialHref = initialValue.href || '';
  const initialTargetBlank = initialValue.target === '_blank' || !initialValue.target;
  const initialDisplayText = getDefaultDisplayText(initialValue);
  const initialTitle = initialValue.title || '';

  useEffect(() => {
    if (!open) {
      lastOpenModeRef.current = '';
      return;
    }
    const openModeKey = `${mode}:open`;
    if (lastOpenModeRef.current === openModeKey) return;
    lastOpenModeRef.current = openModeKey;
    setHref(initialHref);
    setTargetBlank(initialTargetBlank);
    setReferenceQuery('');
    setReferenceDisplayText(initialDisplayText);
    setReferenceResults([]);
    setLoading(false);
    setLiteratureTitle(initialTitle);
    setMediaTab('image');
  }, [initialDisplayText, initialHref, initialTargetBlank, initialTitle, open, mode]);

  useEffect(() => {
    let active = true;
    if (!open || mode !== 'internal' || !referenceQuery.trim()) {
      setReferenceResults([]);
      setLoading(false);
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
  }, [mode, onSearchReferences, open, referenceQuery]);

  const dialogMeta = DIALOG_META[mode] || DIALOG_META.external;
  const savedMediaAssets = useMemo(() => {
    const explicitAttachments = Array.isArray(mediaAttachments) ? mediaAttachments : null;
    if (explicitAttachments) {
      return explicitAttachments
        .filter((item) => item?.isSaved !== false)
        .map((item, index) => ({
          key: String(item?.key || item?.attachmentId || item?.assetId || `${item?.kind || 'media'}-${index}`),
          kind: item?.kind || 'image',
          assetId: String(item?.assetId || ''),
          attachmentId: String(item?.attachmentId || ''),
          attachmentIndex: Number(item?.attachmentIndex || 0) || index + 1,
          attachmentTitle: String(item?.attachmentTitle || '').trim(),
          displayLabel: String(item?.displayLabel || '').trim() || buildAttachmentCaptionText({
            attachmentIndex: item?.attachmentIndex,
            nodeName: item?.kind === 'audio' ? 'audioNode' : item?.kind === 'video' ? 'videoNode' : 'figureImage',
            attachmentTitle: item?.attachmentTitle || ''
          }),
          statusLabel: String(item?.statusLabel || '').trim() || '正文中已保存的附件'
        }));
    }
    return buildFallbackMediaAttachments(mediaLibrary);
  }, [mediaAttachments, mediaLibrary]);
  const visibleMediaAssets = useMemo(
    () => savedMediaAssets.filter((asset) => asset?.kind === mediaTab),
    [mediaTab, savedMediaAssets]
  );

  const footer = useMemo(() => {
    if (mode === 'internal' || mode === 'media') {
      return (
        <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
      );
    }
    if (mode === 'literature') {
      return (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!href.trim()}
            onClick={() => onSubmit({
              type: 'literature',
              href: href.trim(),
              title: literatureTitle.trim(),
              displayText: referenceDisplayText.trim() || literatureTitle.trim() || href.trim(),
              target: targetBlank ? '_blank' : '_self'
            })}
          >
            插入引用
          </button>
        </>
      );
    }
    return (
      <>
        <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!href.trim()}
          onClick={() => onSubmit({
            type: 'external',
            href: href.trim(),
            displayText: referenceDisplayText.trim() || href.trim(),
            target: targetBlank ? '_blank' : '_self'
          })}
        >
          插入引用
        </button>
      </>
    );
  }, [href, literatureTitle, mode, onClose, onSubmit, referenceDisplayText, targetBlank]);

  return (
    <DialogFrame
      open={open}
      title={dialogMeta.title}
      description={dialogMeta.description}
      onClose={onClose}
      footer={footer}
      wide
      restoreFocusOnClose={restoreFocusOnClose}
      restoreFocusTarget={restoreFocusTarget}
      onAfterCloseFocus={onAfterCloseFocus}
      autoFocusTarget={autoFocusTarget}
      portalTarget={portalTarget}
    >
      {mode === 'media' ? (
        <div className="sense-rich-form-grid">
          <div className="sense-rich-link-tabs">
            {MEDIA_TABS.map((tab) => (
              <button key={tab.key} type="button" className={mediaTab === tab.key ? 'active' : ''} onClick={() => setMediaTab(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="sense-rich-reference-list">
            {visibleMediaAssets.length === 0 ? (
              <div className="sense-rich-reference-empty">当前没有可引用的已保存{MEDIA_TABS.find((item) => item.key === mediaTab)?.label || '媒体'}。</div>
            ) : visibleMediaAssets.map((asset) => (
              <button
                key={asset.key}
                type="button"
                className="sense-rich-reference-item"
                onClick={() => onSubmit({
                  type: 'media',
                  href: asset.attachmentId ? `#${asset.attachmentId}` : '#',
                  assetId: asset.assetId || '',
                  attachmentId: asset.attachmentId || '',
                  attachmentIndex: asset.attachmentIndex || null,
                  mediaKind: asset.kind,
                  displayText: resolveAttachmentReferenceText(asset.attachmentIndex)
                })}
              >
                <strong>{asset.displayLabel || resolveAttachmentReferenceText(asset.attachmentIndex)}</strong>
                <span>{asset.statusLabel}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === 'external' ? (
        <div className="sense-rich-form-grid">
          <label>
            <span>URL</span>
            <input value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://example.com" />
          </label>
          <label>
            <span>显示文本</span>
            <input value={referenceDisplayText} onChange={(event) => setReferenceDisplayText(event.target.value)} placeholder="默认使用 URL" />
          </label>
          <label className="sense-rich-checkbox-row">
            <input type="checkbox" checked={targetBlank} onChange={(event) => setTargetBlank(event.target.checked)} />
            <span>新窗口打开</span>
          </label>
        </div>
      ) : null}

      {mode === 'literature' ? (
        <div className="sense-rich-form-grid">
          <label>
            <span>文献标题</span>
            <input value={literatureTitle} onChange={(event) => setLiteratureTitle(event.target.value)} placeholder="文献/资料标题" />
          </label>
          <label>
            <span>文献链接</span>
            <input value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://example.com/paper" />
          </label>
          <label>
            <span>显示文本</span>
            <input value={referenceDisplayText} onChange={(event) => setReferenceDisplayText(event.target.value)} placeholder="默认使用文献标题" />
          </label>
          <label className="sense-rich-checkbox-row">
            <input type="checkbox" checked={targetBlank} onChange={(event) => setTargetBlank(event.target.checked)} />
            <span>新窗口打开</span>
          </label>
        </div>
      ) : null}

      {mode === 'internal' ? (
        <div className="sense-rich-form-grid">
          <label>
            <span>搜索目标词条 / 释义</span>
            <input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="输入关键词" />
          </label>
          <label>
            <span>显示文本</span>
            <input value={referenceDisplayText} onChange={(event) => setReferenceDisplayText(event.target.value)} placeholder="默认使用目标释义标题" />
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
      ) : null}
    </DialogFrame>
  );
};

export default InsertLinkDialog;
