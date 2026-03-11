import { normalizePastedHtml } from './normalizePastedContent';

test('pasted html removes word styles and drops inline images', () => {
  const result = normalizePastedHtml('<div class="MsoNormal" style="color:red"><strong>正文</strong><img src="data:image/png;base64,aaa" /></div>');
  expect(result.html).toContain('<strong>正文</strong>');
  expect(result.html).not.toContain('<img');
  expect(result.warnings.length).toBeGreaterThan(0);
});
