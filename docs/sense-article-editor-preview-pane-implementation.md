# Sense Article Editor Preview Pane Implementation

## 1. Modified Files

- `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - Removed the old in-component preview resize/collapse state and `window`-level pointer listeners.
  - Switched the layout container to consume `useSenseEditorPreviewPane`.
  - Replaced the old `.sense-preview-toggle-tab` divider markup with:
    - `.sense-editor-resize-handle`
    - `.sense-editor-divider-toggle`
    - `.sense-editor-pane.preview`
- `frontend/src/components/senseArticle/SenseArticle.css`
  - Rebuilt `.sense-editor-layout.resizable`, `.sense-editor-divider`, `.sense-editor-resize-handle`, `.sense-editor-divider-toggle`, and `.sense-editor-pane.preview.collapsed`.
  - Added desktop/mobile behavior separation and drag-time body class styling.
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
  - New hook for preview pane state, resize pointer events, breakpoint detection, state persistence, and cleanup.
- `docs/sense-article-editor-preview-pane-implementation.md`
  - This implementation note.

## 2. Why This Design

The audit conclusion was correct: the broken part was the layout control layer, not the editor business flow. The implementation keeps the existing editor, preview parsing, refresh, draft save, submit, scoped editing, and parse error rendering in `SenseArticleEditor`, but moves pane control into `useSenseEditorPreviewPane`.

That split gives one stable integration surface:

- `layoutClassName`
- `layoutStyle`
- `dividerClassName`
- `previewPaneClassName`
- `togglePreviewCollapsed()`
- `resizeHandleProps`

`SenseArticleEditor` now only renders the three intended layout segments:

1. left editor pane
2. center divider
3. right preview pane

## 3. New State Model

The new hook owns these states:

- `previewPaneWidthPct`
  - Current expanded preview width percentage.
- `isPreviewCollapsed`
  - Whether the preview pane is collapsed.
- `isResizingPreview`
  - Whether a pointer resize interaction is active.
- `lastExpandedPreviewWidthPct`
  - The last valid expanded width, used when restoring from collapsed state.
- `isDesktopResizable`
  - `true` only when the media query `(min-width: 1081px)` matches.

Width rules:

- default: `30`
- min clamp: `18`
- max clamp: `45`

The hook keeps `previewPaneWidthPct` as a valid expanded width even while collapsed. The collapsed layout is expressed by CSS/grid, not by mutating the width state to `0`.

## 4. localStorage Key And Format

Key:

- `sense-article-editor.preview-pane.v1`

Stored JSON shape:

```json
{
  "previewPaneWidthPct": 30,
  "isPreviewCollapsed": false,
  "lastExpandedPreviewWidthPct": 30
}
```

Read behavior:

- invalid JSON falls back to defaults
- invalid width values are clamped
- old fallback keys like `widthPct`, `expandedWidthPct`, `collapsed` are tolerated

Write behavior:

- persistence is handled in `useSenseEditorPreviewPane`
- width and collapsed state are written whenever pane state changes

## 5. Desktop vs Mobile Behavior

Desktop (`> 1080px`):

- `.sense-editor-layout.resizable` stays as a CSS grid split layout
- preview width is controlled through `--sense-editor-preview-width`
- divider shows both:
  - `.sense-editor-resize-handle`
  - `.sense-editor-divider-toggle`
- pointer resize is enabled
- collapse keeps the divider visible and hides the preview pane in a true collapsed layout state
- expand restores `lastExpandedPreviewWidthPct`

Mobile / narrow screen (`<= 1080px`):

- `.sense-editor-layout.resizable` degrades to a single-column grid
- `.sense-editor-resize-handle` is hidden and JS also blocks resize start via `isDesktopResizable`
- `.sense-editor-divider-toggle` remains available
- `.sense-editor-layout.resizable.preview-collapsed .sense-editor-pane.preview` uses `display: none`

## 6. Old Logic Removed Or Replaced

Removed from `SenseArticleEditor.js`:

- local component states:
  - `previewWidthPct`
  - `previewCollapsed`
  - `isResizingPreview`
- old refs/state coupling:
  - `dragPointerIdRef`
- old behavior:
  - `handlePreviewToggle` resetting width back to default on every expand
  - `handlePreviewResizeStart`
  - `useEffect` with `window.addEventListener('pointermove' | 'pointerup' | 'pointercancel')`
  - inline `document.body.style.userSelect` / `cursor` mutation effect

Replaced in CSS:

- `.sense-preview-toggle-tab`
  - removed from the new divider UI
- old preview collapsed style
  - replaced with a cleaner collapsed state on `.sense-editor-pane.preview.collapsed`
- old heavy divider visual
  - replaced by a slim control band with:
    - divider guide line
    - hover/drag feedback
    - pill toggle

## 7. How Business Logic Was Kept Intact

The implementation deliberately does not touch these contracts:

- `senseArticleApi`
- `parseSenseArticleSource`
- `SenseArticleRenderer`
- `senseArticleScopedRevision`

Business compatibility is preserved because:

- `previewSource`, `previewState`, `refreshPreview`, and auto-refresh timing remain in `SenseArticleEditor`
- preview parsing still depends on `previewSource`, not on pane width or collapse state
- parse errors still render inside the left editor pane
- scoped editing composition still uses the existing `scopedState` flow
- save draft / submit / abandon / back / dashboard actions were not rewritten
- page mount and page switching behavior in `App.js` was left alone

In practice, the new hook only controls layout state and pointer interaction.

## 8. Key Classes And Functions

Important new hook functions:

- `useSenseEditorPreviewPane`
- `togglePreviewCollapsed`
- `handleResizePointerDown`
- `handleResizePointerMove`
- `handleResizePointerEnd`
- `handleResizeLostPointerCapture`

Important class names:

- `.sense-editor-layout.resizable`
- `.sense-editor-layout.resizable.preview-collapsed`
- `.sense-editor-layout.resizable.preview-resizing`
- `.sense-editor-divider`
- `.sense-editor-resize-handle`
- `.sense-editor-resize-handle-lines`
- `.sense-editor-divider-toggle`
- `.sense-editor-pane.preview`
- `.sense-editor-pane.preview.collapsed`
- `body.sense-editor-preview-resizing`

## 9. Stability And Cleanup Guarantees

The pointer resize flow now uses pointer events with capture semantics:

- `pointerdown`
  - desktop-only
  - records start pointer id / position / width
  - enables pointer capture when possible
  - adds `body.sense-editor-preview-resizing`
- `pointermove`
  - computes width from `.sense-editor-layout` bounding rect
  - clamps width
  - batches width updates with `requestAnimationFrame`
- `pointerup` / `pointercancel` / `lostpointercapture`
  - flush pending width
  - clear resize state
  - remove body class

Unmount cleanup also removes the body class and cancels any active resize frame.

## 10. Further Improvements Worth Considering

- Add a tiny width readout or tooltip while resizing on desktop.
- Add an optional double-click reset on the divider to restore default `30%`.
- Add a focused regression test around localStorage restore behavior for the hook.
- Add a small visual state badge near the preview title when the pane is collapsed on mobile.
- Move pane constants to a dedicated shared config file if more sense-article layouts need the same behavior.

## Manual QA checklist

- Desktop width above 1080px: drag the divider and confirm left/right widths update smoothly.
- Desktop width above 1080px: verify text is not broadly selected during drag.
- Desktop width above 1080px: collapse preview, then expand, and confirm the previous expanded width is restored.
- Desktop width above 1080px: refresh the page and confirm width/collapsed state restore from localStorage.
- Desktop width above 1080px: while resizing, confirm editor textarea focus and IME input are not broken.
- Mobile width at or below 1080px: confirm layout becomes single-column.
- Mobile width at or below 1080px: confirm resize handle is unavailable.
- Mobile width at or below 1080px: confirm the preview toggle still hides/shows the preview block correctly.
- Edit正文并等待自动刷新: confirm preview still refreshes after the existing debounce.
- Click `刷新预览`: confirm manual preview refresh still works.
- Create parse errors in source: confirm errors still appear in the left pane.
- In scoped edit mode: confirm scoped text editing, tracked diff refresh, and compose-back behavior still work.
- Click `保存草稿`: confirm draft saving still succeeds.
- Click `提交审核`: confirm submit flow still succeeds.
- Use `返回` / dashboard navigation / page switching: confirm no navigation regression.
