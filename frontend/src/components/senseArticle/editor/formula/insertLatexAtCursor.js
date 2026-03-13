export const insertLatexAtCursor = ({
  value = '',
  selectionStart = 0,
  selectionEnd = 0,
  snippet = ''
} = {}, selection = null) => {
  const normalizedValue = String(value || '');
  const normalizedSnippet = String(snippet || '');
  const start = Number.isFinite(Number(selectionStart)) ? Number(selectionStart) : 0;
  const end = Number.isFinite(Number(selectionEnd)) ? Number(selectionEnd) : start;
  const before = normalizedValue.slice(0, start);
  const after = normalizedValue.slice(end);
  const nextValue = `${before}${normalizedSnippet}${after}`;
  const fallbackCursor = start + normalizedSnippet.length;
  const nextSelectionStart = start + (selection?.[0] ?? normalizedSnippet.length);
  const nextSelectionEnd = start + (selection?.[1] ?? normalizedSnippet.length);
  return {
    value: nextValue,
    selectionStart: Number.isFinite(nextSelectionStart) ? nextSelectionStart : fallbackCursor,
    selectionEnd: Number.isFinite(nextSelectionEnd) ? nextSelectionEnd : fallbackCursor
  };
};
