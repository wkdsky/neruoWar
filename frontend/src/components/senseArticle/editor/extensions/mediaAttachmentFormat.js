export const MEDIA_ATTACHMENT_NODE_NAMES = ['figureImage', 'audioNode', 'videoNode'];

export const MEDIA_ATTACHMENT_KIND_LABELS = {
  figureImage: '图片',
  audioNode: '音频',
  videoNode: '视频'
};

export const isMediaAttachmentNodeName = (name = '') => MEDIA_ATTACHMENT_NODE_NAMES.includes(String(name || '').trim());

export const resolveMediaAttachmentTypeLabel = (nodeName = '') => MEDIA_ATTACHMENT_KIND_LABELS[nodeName] || '多媒体';

export const resolveMediaAttachmentKind = (nodeName = '') => {
  if (nodeName === 'figureImage') return 'image';
  if (nodeName === 'audioNode') return 'audio';
  if (nodeName === 'videoNode') return 'video';
  return '';
};

export const resolveAttachmentReferenceText = (attachmentIndex = null) => `附件${Number.isFinite(Number(attachmentIndex)) ? Number(attachmentIndex) : '?'}`;

export const extractAttachmentTitleFromCaption = (value = '') => {
  const source = String(value || '').trim();
  if (!source) return '';
  const match = source.match(/^附件\d+（[^）]+）\s*(.*)$/);
  return match ? String(match[1] || '').trim() : source;
};

export const buildAttachmentCaptionText = ({
  attachmentIndex = null,
  nodeName = '',
  attachmentTitle = ''
} = {}) => {
  const label = `${resolveAttachmentReferenceText(attachmentIndex)}（${resolveMediaAttachmentTypeLabel(nodeName)}）`;
  const title = String(attachmentTitle || '').trim();
  return title ? `${label} ${title}` : label;
};

export const buildAttachmentCaptionChildren = ({
  attachmentIndex = null,
  nodeName = '',
  attachmentTitle = ''
} = {}) => {
  const label = `${resolveAttachmentReferenceText(attachmentIndex)}（${resolveMediaAttachmentTypeLabel(nodeName)}）`;
  const title = String(attachmentTitle || '').trim();
  return [
    ['span', { class: 'sense-rich-attachment-label' }, label],
    ['span', { class: 'sense-rich-attachment-title' }, title ? ` ${title}` : '']
  ];
};
