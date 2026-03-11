import { looksLikeMarkdown, markdownToRichHtml } from './markdownToRichContent';

test('markdown importer keeps basic long-form structure', () => {
  const html = markdownToRichHtml('# 标题\n\n- 条目 A\n- 条目 B\n\n> 引用\n\n```js\nconst a = 1;\n```');
  expect(html).toContain('<h1>标题</h1>');
  expect(html).toContain('<ul><li>条目 A</li><li>条目 B</li></ul>');
  expect(html).toContain('<blockquote><p>引用</p></blockquote>');
  expect(html).toContain('<pre><code>const a = 1;');
});

test('markdown detector avoids treating normal text as markdown', () => {
  expect(looksLikeMarkdown('普通正文，不应该被当作 Markdown。')).toBe(false);
  expect(looksLikeMarkdown('## 二级标题')).toBe(true);
});
