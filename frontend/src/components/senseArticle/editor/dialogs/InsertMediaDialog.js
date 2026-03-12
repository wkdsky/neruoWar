import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, ChevronDown, StretchHorizontal, X } from 'lucide-react';
import DialogFrame from './DialogFrame';
import { describeActiveElement, describeScrollPosition, senseEditorDebugLog } from '../editorDebug';

const MEDIA_FIELD_BY_KIND = {
  image: {
    title: '插入图片',
    widthOptions: ['25%', '50%', '75%', '100%'],
    accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
  },
  audio: {
    title: '插入音频',
    widthOptions: [],
    accept: 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,audio/flac,audio/aac'
  },
  video: {
    title: '插入视频',
    widthOptions: ['50%', '75%', '100%'],
    accept: 'video/mp4,video/webm,video/ogg,video/quicktime'
  }
};

const VALIDATION_PATTERNS = {
  image: /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i,
  audio: /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i,
  video: /\.(mp4|webm|ogg|mov)(\?.*)?$/i
};

const AUDIO_MIME_BY_EXTENSION = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac'
};

const VIDEO_MIME_BY_EXTENSION = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime'
};

const resolveExtensionFromValue = (value = '') => {
  const normalized = String(value || '').trim().split('?')[0].toLowerCase();
  const match = normalized.match(/\.([a-z0-9]+)$/i);
  return match ? match[1] : '';
};

const inferMediaMimeType = ({ kind = 'image', fileType = '', fileName = '', sourceUrl = '' } = {}) => {
  const normalizedFileType = String(fileType || '').trim().toLowerCase();
  if (normalizedFileType) return normalizedFileType;
  const extension = resolveExtensionFromValue(fileName || sourceUrl);
  if (!extension) return '';
  if (kind === 'audio') return AUDIO_MIME_BY_EXTENSION[extension] || '';
  if (kind === 'video') return VIDEO_MIME_BY_EXTENSION[extension] || '';
  return '';
};

const canBrowserPlayMedia = ({ kind = 'audio', mimeType = '' } = {}) => {
  if ((kind !== 'audio' && kind !== 'video') || typeof document === 'undefined') return true;
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  if (!normalizedMimeType) return true;
  const element = document.createElement(kind);
  if (!element || typeof element.canPlayType !== 'function') return true;
  return element.canPlayType(normalizedMimeType).replace(/^no$/i, '') !== '';
};

const getUnsupportedMediaMessage = (kind = 'audio') => {
  if (kind === 'audio') {
    return '当前浏览器不支持该音频格式。建议使用 MP3、WAV 或 OGG；M4A 取决于具体编码。';
  }
  if (kind === 'video') {
    return '当前浏览器不支持该视频格式。建议使用 MP4 或 WebM。';
  }
  return '当前浏览器不支持该媒体格式。';
};

const focusWithoutScroll = (target) => {
  if (!target?.focus) return;
  try {
    target.focus({ preventScroll: true });
  } catch (_error) {
    target.focus();
  }
};

const InsertMediaDialog = ({
  open,
  kind = 'image',
  initialValue = {},
  onClose,
  onUpload,
  onSubmit,
  mediaLibrary = null,
  restoreFocusOnClose = true,
  restoreFocusTarget = null,
  onAfterCloseFocus = null,
  presentation = 'dialog',
  anchorRef = null,
  portalTarget = null
}) => {
  const [insertMode, setInsertMode] = useState('upload');
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [poster, setPoster] = useState('');
  const [width, setWidth] = useState(kind === 'image' ? '75%' : '100%');
  const [align, setAlign] = useState('center');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inlinePanelRef = useRef(null);
  const closeButtonRef = useRef(null);
  const titleIdRef = useRef(`sense-rich-media-title-${Math.random().toString(36).slice(2)}`);
  const descriptionIdRef = useRef(`sense-rich-media-description-${Math.random().toString(36).slice(2)}`);
  const initialSrc = initialValue?.src || '';
  const initialAlt = initialValue?.alt || '';
  const initialCaption = initialValue?.caption || '';
  const initialTitle = initialValue?.title || '';
  const initialDescription = initialValue?.description || '';
  const initialPoster = initialValue?.poster || '';
  const initialWidth = initialValue?.width || (kind === 'image' ? '75%' : '100%');
  const initialAlign = initialValue?.align || 'center';

  useEffect(() => {
    if (!open) return;
    setInsertMode('upload');
    setFile(null);
    setUrl(initialSrc);
    setAlt(initialAlt);
    setCaption(initialCaption);
    setTitle(initialTitle);
    setDescription(initialDescription);
    setPoster(initialPoster);
    setWidth(initialWidth);
    setAlign(initialAlign);
    setError('');
  }, [initialAlign, initialAlt, initialCaption, initialDescription, initialPoster, initialSrc, initialTitle, initialWidth, kind, open]);

  useEffect(() => {
    if (!open) return;
    senseEditorDebugLog('media-dialog', 'Media dialog rendered/opened', {
      kind,
      presentation,
      activeElement: describeActiveElement(),
      scroll: describeScrollPosition(),
      insertMode,
      hasInitialSrc: !!initialSrc
    });
  }, [initialSrc, insertMode, kind, open, presentation]);

  useEffect(() => {
    if (!open || presentation !== 'inline' || typeof document === 'undefined') return undefined;
    const handlePointerDown = (event) => {
      const panelElement = inlinePanelRef.current;
      const anchorElement = anchorRef?.current || null;
      if (panelElement?.contains(event.target)) return;
      if (anchorElement?.contains?.(event.target)) return;
      senseEditorDebugLog('media-dialog', 'Inline media panel closing from outside pointerdown', {
        kind,
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition()
      });
      onClose?.();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose?.();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => {
      focusWithoutScroll(closeButtonRef.current || inlinePanelRef.current);
    });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, kind, onClose, open, presentation]);

  const kindMeta = MEDIA_FIELD_BY_KIND[kind] || MEDIA_FIELD_BY_KIND.image;

  const readLocalMediaMetadata = useCallback((selectedFile) => new Promise((resolve) => {
    if (!selectedFile || typeof window === 'undefined') {
      resolve({});
      return;
    }
    if (kind === 'image') {
      const reader = new window.FileReader();
      reader.onload = () => {
        const image = new window.Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({});
        image.src = reader.result;
      };
      reader.onerror = () => resolve({});
      reader.readAsDataURL(selectedFile);
      return;
    }
    if (kind === 'audio' || kind === 'video') {
      const element = document.createElement(kind);
      const objectUrl = window.URL.createObjectURL(selectedFile);
      element.preload = 'metadata';
      element.onloadedmetadata = () => {
        const payload = {
          duration: Number.isFinite(Number(element.duration)) ? Number(element.duration) : null
        };
        if (kind === 'video') {
          payload.width = element.videoWidth || null;
          payload.height = element.videoHeight || null;
        }
        window.URL.revokeObjectURL(objectUrl);
        resolve(payload);
      };
      element.onerror = () => {
        window.URL.revokeObjectURL(objectUrl);
        resolve({});
      };
      element.src = objectUrl;
      return;
    }
    resolve({});
  }), [kind]);

  const validateUrl = useCallback((candidate) => {
    const normalized = String(candidate || '').trim();
    if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith('/uploads/sense-article-media/')) {
      return '请输入有效的 http(s) URL，或使用已上传的媒体地址。';
    }
    const pattern = VALIDATION_PATTERNS[kind];
    if (pattern && !pattern.test(normalized) && !normalized.startsWith('/uploads/sense-article-media/')) {
      return 'URL 后缀与当前媒体类型不匹配。';
    }
    return '';
  }, [kind]);

  const handleSubmit = useCallback(async () => {
    setError('');
    setPending(true);
    senseEditorDebugLog('media-dialog', 'Submitting media dialog form', {
      kind,
      insertMode,
      activeElement: describeActiveElement(),
      scroll: describeScrollPosition(),
      hasFile: !!file,
      hasUrl: !!url.trim()
    });
    try {
      let sourceUrl = url.trim();
      if (insertMode === 'upload' && file) {
        const selectedMimeType = inferMediaMimeType({
          kind,
          fileType: file.type,
          fileName: file.name
        });
        if (!canBrowserPlayMedia({ kind, mimeType: selectedMimeType })) {
          setError(getUnsupportedMediaMessage(kind));
          return;
        }
        try {
          const metadata = await readLocalMediaMetadata(file);
          const response = await onUpload({
            kind,
            file,
            alt,
            caption,
            title,
            description,
            posterUrl: poster,
            ...metadata
          });
          sourceUrl = response?.asset?.url || '';
          if (!sourceUrl) {
            setError('上传成功但未返回可用地址，请重试。');
            return;
          }
        } catch (uploadError) {
          setError(uploadError?.message || '上传失败，请重试。');
          return;
        }
      }
      if (insertMode === 'url') {
        const validationError = validateUrl(sourceUrl);
        if (validationError) {
          setError(validationError);
          return;
        }
        const urlMimeType = inferMediaMimeType({
          kind,
          sourceUrl
        });
        if (!canBrowserPlayMedia({ kind, mimeType: urlMimeType })) {
          setError(getUnsupportedMediaMessage(kind));
          return;
        }
      }
      if (!sourceUrl) {
        setError('未获取到可插入的媒体地址。');
        return;
      }
      onSubmit({
        kind,
        src: sourceUrl,
        alt,
        caption,
        title,
        description,
        poster,
        width,
        align
      });
    } finally {
      setPending(false);
    }
  }, [align, alt, caption, description, file, insertMode, kind, onSubmit, onUpload, poster, readLocalMediaMetadata, title, url, validateUrl, width]);

  const libraryAssets = useMemo(() => {
    const referenced = Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets : [];
    const recent = Array.isArray(mediaLibrary?.recentAssets) ? mediaLibrary.recentAssets : [];
    return [...referenced, ...recent].filter((item, index, array) => item?.kind === kind && array.findIndex((target) => target?._id === item?._id) === index);
  }, [kind, mediaLibrary]);

  const footer = useMemo(() => (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>取消</button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || (insertMode === 'upload' ? !file : !url.trim())}
        onClick={handleSubmit}
      >
        {pending ? '处理中…' : '插入媒体'}
      </button>
    </>
  ), [file, handleSubmit, insertMode, onClose, pending, url]);

  const content = (
    <>
      <div className="sense-rich-link-tabs">
        <button type="button" className={insertMode === 'upload' ? 'active' : ''} onClick={() => setInsertMode('upload')}>上传文件</button>
        <button type="button" className={insertMode === 'url' ? 'active' : ''} onClick={() => setInsertMode('url')}>粘贴 URL</button>
        <button type="button" className={insertMode === 'library' ? 'active' : ''} onClick={() => setInsertMode('library')}>已上传资源</button>
      </div>
      <div className="sense-rich-form-grid">
        {insertMode === 'upload' ? (
          <label>
            <span>选择文件</span>
            <input type="file" accept={kindMeta.accept} onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setError('');
            }} />
          </label>
        ) : insertMode === 'url' ? (
          <label>
            <span>资源 URL</span>
            <input value={url} onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }} placeholder="https://..." />
          </label>
        ) : (
          <div className="sense-rich-reference-list">
            {libraryAssets.length === 0 ? (
              <div className="sense-rich-reference-empty">暂无可复用的已上传资源。</div>
            ) : libraryAssets.map((asset) => (
              <button
                key={asset._id}
                type="button"
                className="sense-rich-reference-item"
                onClick={() => {
                  setUrl(asset.url || '');
                  setAlt(asset.alt || '');
                  setCaption(asset.caption || '');
                  setTitle(asset.title || '');
                  setDescription(asset.description || '');
                  setPoster(asset.posterUrl || '');
                  setInsertMode('url');
                }}
              >
                <strong>{asset.originalName || asset.title || asset.url}</strong>
                <span>{asset.status || 'uploaded'} · {asset.mimeType || asset.kind}</span>
              </button>
            ))}
          </div>
        )}
        {error ? <div className="sense-rich-inline-error">{error}</div> : null}
        {kind === 'image' ? (
          <>
            <label>
              <span>alt</span>
              <input value={alt} onChange={(event) => setAlt(event.target.value)} placeholder="图片说明" />
            </label>
            <label>
              <span>caption</span>
              <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="可选说明" />
            </label>
            <label>
              <span>宽度</span>
              <div className="sense-rich-dialog-select">
                <StretchHorizontal size={16} className="sense-rich-dialog-select-icon" />
                <select value={width} onChange={(event) => setWidth(event.target.value)}>
                  {kindMeta.widthOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <ChevronDown size={16} className="sense-rich-dialog-select-caret" />
              </div>
            </label>
            <label>
              <span>对齐</span>
              <div className="sense-rich-dialog-select">
                <AlignCenter size={16} className="sense-rich-dialog-select-icon" />
                <select value={align} onChange={(event) => setAlign(event.target.value)}>
                  <option value="left">左</option>
                  <option value="center">中</option>
                  <option value="right">右</option>
                </select>
                <ChevronDown size={16} className="sense-rich-dialog-select-caret" />
              </div>
            </label>
          </>
        ) : null}
        {kind === 'audio' ? (
          <>
            <label>
              <span>标题</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="音频标题" />
            </label>
            <label>
              <span>说明</span>
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选说明" />
            </label>
          </>
        ) : null}
        {kind === 'video' ? (
          <>
            <label>
              <span>说明</span>
              <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="视频说明" />
            </label>
            <label>
              <span>Poster URL</span>
              <input value={poster} onChange={(event) => setPoster(event.target.value)} placeholder="可选封面" />
            </label>
            <label>
              <span>宽度</span>
              <div className="sense-rich-dialog-select">
                <StretchHorizontal size={16} className="sense-rich-dialog-select-icon" />
                <select value={width} onChange={(event) => setWidth(event.target.value)}>
                  {kindMeta.widthOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <ChevronDown size={16} className="sense-rich-dialog-select-caret" />
              </div>
            </label>
          </>
        ) : null}
      </div>
    </>
  );

  if (presentation === 'inline') {
    if (!open) return null;
    return (
      <div
        ref={inlinePanelRef}
        className="sense-rich-inline-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleIdRef.current}
        aria-describedby={descriptionIdRef.current}
        tabIndex={-1}
      >
        <div className="sense-rich-dialog-header">
          <div className="sense-rich-dialog-header-copy">
            <strong id={titleIdRef.current}>{kindMeta.title}</strong>
            <span id={descriptionIdRef.current} className="sense-rich-dialog-description">
              媒体必须通过上传或 URL 引用插入；上传成功后会记录媒体元数据与 revision 引用关系。
            </span>
          </div>
          <button ref={closeButtonRef} type="button" className="sense-rich-dialog-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="sense-rich-dialog-body">{content}</div>
        <div className="sense-rich-dialog-footer">{footer}</div>
      </div>
    );
  }

  return (
    <DialogFrame
      open={open}
      title={kindMeta.title}
      description="媒体必须通过上传或 URL 引用插入；上传成功后会记录媒体元数据与 revision 引用关系。"
      onClose={onClose}
      footer={footer}
      wide
      restoreFocusOnClose={restoreFocusOnClose}
      restoreFocusTarget={restoreFocusTarget}
      onAfterCloseFocus={onAfterCloseFocus}
      autoFocusTarget="dialog"
      portalTarget={portalTarget}
    >
      {content}
    </DialogFrame>
  );
};

export default InsertMediaDialog;
