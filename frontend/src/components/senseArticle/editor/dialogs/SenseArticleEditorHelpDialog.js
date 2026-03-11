import React from 'react';
import DialogFrame from './DialogFrame';

const HELP_SECTIONS = [
  {
    title: '基础排版',
    items: ['支持标题、段落、引用块、代码块、分割线、无序/有序/任务列表。', '支持字号、粗体、斜体、下划线、删除线、颜色、高亮、对齐与缩进。']
  },
  {
    title: '表格与媒体',
    items: ['表格支持快捷尺寸、表头开关、样式切换、行列增删与单元格对齐。', '图片、音频、视频都必须通过上传或 URL 引用插入，不支持 base64 嵌入。']
  },
  {
    title: 'Markdown 与粘贴',
    items: ['工具栏可打开 Markdown 导入对话框，将基础 Markdown 转为富文本。', '网页/Word 粘贴会自动清洗脏样式；复杂样式会降级保留语义结构。']
  },
  {
    title: '自动保存与恢复',
    items: ['富文本草稿会自动保存到后端草稿，并按 revision 维度做本地恢复缓存。', '如果自动保存失败或刷新离开，可从状态区恢复最近一次未同步内容。']
  },
  {
    title: '局部修订与兼容',
    items: ['scoped 修订仍采用整页编辑，但会自动定位并高亮相关块。', 'legacy 内容会先尝试保守转换为 rich_html；转换失败时仍保留只读 fallback。']
  },
  {
    title: '发布前校验',
    items: ['提交与发布前会检查空正文、无效内部引用、缺失媒体、图片 alt、标题层级和空表格。', '阻塞问题会拦截流转，warning 仅提示风险。']
  }
];

const SenseArticleEditorHelpDialog = ({ open, onClose }) => (
  <DialogFrame
    open={open}
    onClose={onClose}
    title="百科富文本编辑帮助"
    description="本面板概括当前富文本编辑器的基础能力、导入方式、自动保存、局部修订和发布前校验规则。"
    wide
  >
    <div className="sense-editor-help-grid">
      {HELP_SECTIONS.map((section) => (
        <section key={section.title} className="sense-editor-help-card">
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ))}
    </div>
  </DialogFrame>
);

export default SenseArticleEditorHelpDialog;
