import React, { useMemo, useState } from 'react';
import DialogFrame from './DialogFrame';
import { markdownToRichHtml } from '../paste/markdownToRichContent';

const ImportMarkdownDialog = ({ open, onClose, onSubmit }) => {
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');

  const footer = useMemo(() => (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!markdown.trim()}
        onClick={() => {
          try {
            onSubmit({
              markdown,
              html: markdownToRichHtml(markdown)
            });
            setMarkdown('');
            setError('');
          } catch (submitError) {
            setError(submitError?.message || 'Markdown 导入失败，请检查内容结构后重试。');
          }
        }}
      >
        导入 Markdown
      </button>
    </>
  ), [markdown, onClose, onSubmit]);

  return (
    <DialogFrame open={open} title="从 Markdown 导入" description="将基础 Markdown 转换为当前 rich_html 内容并插入到编辑器光标位置。" onClose={onClose} footer={footer} wide>
      <div className="sense-rich-form-grid">
        <label>
          <span>Markdown 内容</span>
          <textarea
            value={markdown}
            onChange={(event) => {
              setMarkdown(event.target.value);
              setError('');
            }}
            className="sense-review-comment"
            rows={14}
            placeholder={'# 标题\n\n- 列表项\n- 另一个列表项\n\n> 引用\n\n```js\ncode\n```'}
          />
        </label>
        <div className="sense-review-note">支持基础标题、段落、列表、引用、代码块、分割线、链接和基础表格。</div>
        {error ? <div className="sense-rich-inline-error">{error}</div> : null}
      </div>
    </DialogFrame>
  );
};

export default ImportMarkdownDialog;
