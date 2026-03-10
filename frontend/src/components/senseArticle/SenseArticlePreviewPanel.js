import React, { memo } from 'react';
import SenseArticleRenderer from './SenseArticleRenderer';

const SenseArticlePreviewPanel = ({ previewRevision }) => (
  <div className="sense-editor-preview-renderer">
    <SenseArticleRenderer revision={previewRevision} />
  </div>
);

export default memo(SenseArticlePreviewPanel);
