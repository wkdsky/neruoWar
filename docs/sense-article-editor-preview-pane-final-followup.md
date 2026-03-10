# Sense Article Editor Preview Pane Final Follow-up

## Modified Files

- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
- `frontend/src/components/senseArticle/SenseArticlePreviewPanel.js`
- `docs/sense-article-editor-preview-pane-final-followup.md`

## 1. Moving Toggle From Divider To Preview Topbar

The preview toggle is no longer rendered inside the divider.

Previous structure:

- editor pane
- divider
  - resize handle
  - toggle
- preview pane

Current structure:

- editor pane
- divider
  - resize handle
- preview pane
  - `.sense-editor-preview-topbar`
    - title/status
    - refresh button
    - collapse/expand button
  - `.sense-editor-preview-body`
    - `SenseArticlePreviewPanel`

The relevant DOM change is in `SenseArticleEditor.js`, where the old divider toggle was removed and the preview section now owns:

- `.sense-editor-preview-topbar`
- `.sense-editor-preview-actions`
- `.sense-editor-preview-toggle`
- `.sense-editor-preview-body`

This makes the button semantically and visually part of the preview pane instead of the splitter.

## 2. Two-stage Collapse / Expand

`useSenseEditorPreviewPane` now controls both:

- whether the preview pane is in collapsed layout
- whether the heavy preview body is mounted

The hook state now includes:

- `previewPaneWidthPct`
- `isPreviewCollapsed`
- `lastExpandedPreviewWidthPct`
- `isPreviewBodyMounted`
- `isDesktopResizable`
- `previewVisibilityPhase`

`previewVisibilityPhase` uses:

- `expanded`
- `collapsing`
- `collapsed`
- `expanding`

### Collapse flow

When clicking collapse:

1. The heavy preview body is immediately removed from layout by setting `isPreviewBodyMounted = false`.
2. The phase changes to `collapsing`.
3. In the next animation frame, the pane enters collapsed layout by setting `isPreviewCollapsed = true` and phase `collapsed`.

This means the browser does not have to collapse the grid column while still laying out the large preview subtree.

### Expand flow

When clicking expand:

1. The pane width is restored first using `lastExpandedPreviewWidthPct` and the new width clamp rules.
2. `isPreviewCollapsed` becomes `false`.
3. The phase becomes `expanding`.
4. In the next animation frame, the preview body is mounted again with `startTransition`, then the phase returns to `expanded`.

This separates layout restoration from heavy preview subtree mounting.

## 3. Why This Reduces Collapse Jank

The previous implementation still made collapse depend on one big outer layout switch while the preview body stayed part of the render tree until that same interaction completed.

The new sequence reduces work on the hot path:

- first remove heavy preview body participation
- then collapse the layout one frame later

This avoids forcing the browser to do a large subtree relayout and a grid collapse in the same click frame.

On expand, the reverse staging prevents width restoration and heavy renderer remount from landing in one synchronous step.

## 4. New Width Rules And localStorage Compatibility

The preview pane width range is now:

- default: `36%`
- min: `30%`
- max: `70%`

The hook storage key was upgraded to:

- `sense-article-editor.preview-pane.v2`

Compatibility strategy:

- read `v2` first
- if missing, fall back to `sense-article-editor.preview-pane.v1`
- all loaded values are re-clamped to `30% ~ 70%`

So old persisted values from the previous `18% ~ 45%` implementation are corrected automatically on read.

## 5. Components / Hooks / Classes Changed

### Hook changes

`useSenseEditorPreviewPane.js`

- upgraded width constants to `36 / 30 / 70`
- added `LEGACY_PREVIEW_PANE_STORAGE_KEY`
- added `isPreviewBodyMounted`
- added `previewVisibilityPhase`
- added `collapsePreviewPane()` and `expandPreviewPane()`
- changed resize start rule so dragging only works while preview is expanded

### Component changes

`SenseArticleEditor.js`

- removed the divider toggle button
- added preview-owned topbar controls
- split preview shell and preview body
- preview body now mounts only when `isPreviewBodyMounted === true`

`SenseArticlePreviewPanel.js`

- reduced to the heavy preview body only
- kept memoized
- no longer receives pure layout state

### CSS classes

New / changed key classes:

- `.sense-editor-preview-topbar`
- `.sense-editor-preview-topbar.sticky`
- `.sense-editor-preview-status`
- `.sense-editor-preview-actions`
- `.sense-editor-preview-toggle`
- `.sense-editor-preview-body`
- `.sense-editor-preview-body.hidden`
- `.sense-editor-pane.preview.preview-phase-expanded`
- `.sense-editor-pane.preview.preview-phase-collapsing`
- `.sense-editor-pane.preview.preview-phase-collapsed`
- `.sense-editor-pane.preview.preview-phase-expanding`

Removed from the active structure:

- `.sense-editor-divider-sticky`
- divider-owned toggle semantics

## 6. Sticky Behavior

Sticky now belongs to the preview pane topbar:

- `.sense-editor-preview-topbar.sticky { position: sticky; top: var(--sense-editor-sticky-top); }`

It works because:

- the sticky node is inside the preview pane
- the preview pane no longer uses `overflow: hidden` at the outer level
- the topbar remains in normal document flow

The preview body keeps its own overflow clipping, while the topbar can stay sticky relative to the page/editor scroll context.

On narrow screens, sticky is intentionally disabled and the topbar becomes a normal block-level control row.

## 7. Heavy Transitions Removed

The implementation still avoids transitions on:

- `grid-template-columns`
- `width`
- `minmax(...)`
- `flex-basis`
- large padding-driven layout animations

Only lightweight transitions remain on:

- opacity
- transform
- icon rotation
- border/background/shadow states

## Manual QA Checklist

- Desktop: scroll down and confirm the preview control stays at the preview pane top, not on the divider.
- Desktop: confirm the divider only provides resize semantics.
- Desktop: confirm the preview topbar remains sticky and does not drift to a strange position.
- Desktop: with a large article, click `收起` and confirm it is noticeably smoother than before.
- Desktop: confirm collapse does not flash white and does not cause the topbar button to jump away.
- Desktop: click `展开` and confirm width restores from the last expanded width, not from a fixed default.
- Desktop: drag width and confirm the range is now `30% ~ 70%`.
- Desktop: confirm dragging is disabled while the preview is collapsed.
- Refresh the page and confirm persisted width/collapsed state still restore correctly.
- Confirm old localStorage values are re-clamped into the new range.
- Mobile/narrow width: confirm the page is still single-column.
- Mobile/narrow width: confirm the preview topbar remains correctly positioned and usable.
- Mobile/narrow width: confirm resize handle remains unavailable.
- Edit content and wait: confirm preview auto refresh still works.
- Click `刷新预览`: confirm manual refresh still works.
- Trigger parse errors: confirm parse errors still show on the left side.
- Scoped mode: confirm scoped editing and tracked diff behavior are unchanged.
- Save draft / submit review / back / dashboard: confirm no regression in existing business actions.

## Small polish follow-up

This round only adjusted presentation details and did not change the main pane state machine.

- The editor/preview spacing was tightened by reducing the desktop split gap and narrowing the divider width.
- Resize hit area was kept usable by letting `.sense-editor-resize-handle::before` extend the effective interaction strip beyond the slimmer visual divider.
- The preview topbar button now uses an explicit label span plus icon span, so the state reads correctly as:
  - expanded: `收起 >`
  - collapsed: `展开 <`
- The collapsed-state CSS no longer hides the button label, so the visual feedback now matches the real state instead of only rotating the arrow.
- A small `min-width` was added to the topbar toggle so the button does not jitter noticeably when switching between `收起` and `展开`.

Manual QA for this polish:

- Desktop: confirm the editor/preview gap is visibly tighter than before.
- Desktop: confirm the divider is still easy to grab and drag despite looking slimmer.
- Desktop: confirm expanded state reads as `收起 >`.
- Desktop: confirm collapsed state reads as `展开 <`.
- Desktop: confirm the button does not jump or resize aggressively when toggling.
- Desktop/mobile: confirm sticky topbar, resize, collapse/expand, auto refresh, manual refresh, draft save, and submit still work.

## Arrow pairing fix

The preview toggle no longer relies on a Lucide chevron component for the visible arrow. It now renders an explicit text pair inside `.sense-editor-preview-toggle`:

- expanded: `收起` + `>`
- collapsed: `展开` + `<`

This keeps the visible label and arrow direction paired correctly regardless of `aria-hidden`, while the arrow span itself stays `aria-hidden="true"` because the accessible name already comes from the button label and `aria-label`.
