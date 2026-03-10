# Sense Article Editor Preview Pane Performance Follow-up

## Modified Files

- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
- `frontend/src/components/senseArticle/SenseArticlePreviewPanel.js`

## Sticky Toggle Changes

To make the preview collapse/expand control follow page scroll, the divider DOM was adjusted from:

- resize handle
- toggle button

to:

- resize handle
- `.sense-editor-divider-sticky`
  - `.sense-editor-divider-toggle`

The key class additions/changes are:

- `.sense-editor-divider-sticky`
  - new sticky wrapper
- `.sense-editor-divider-toggle`
  - changed from absolute positioning to a normal inline-flex button inside the sticky wrapper

## Why Sticky Works

`position: sticky` now lives on `.sense-editor-divider-sticky`, not on the entire divider and not on the resize handle.

It works in the current structure because:

- the sticky wrapper sits inside `.sense-editor-divider`
- the divider stays in the normal editor grid flow
- no ancestor in this path was changed to a conflicting scroll container
- the sticky element is therefore able to use the page/editor scroll context as its reference

The configured top offset is:

- `--sense-editor-sticky-top: 16px`

This keeps the toggle below the top edge with a small safe gap while still staying visually aligned with the editor page chrome.

On narrow screens, `.sense-editor-divider-sticky` is intentionally reset to `position: static` so the mobile single-column layout stays simple and does not drift.

## Main Cause Of The Collapse/Expand Jank

The visible lag had two main sources:

1. Clicking collapse/expand changed layout state in `SenseArticleEditor`, which caused the heavy preview subtree to re-render even though preview content itself did not change.
2. The layout still animated heavy properties:
   - `grid-template-columns`
   - `gap`
   - preview pane `padding`

That combination is especially expensive with large preview content because the browser has to do more layout and paint work while React is also reconciling a large subtree.

## What Was Done To Reduce Jank

### 1. Memoized The Preview Content

A new component was added:

- `frontend/src/components/senseArticle/SenseArticlePreviewPanel.js`

This component is wrapped with `React.memo` and only receives preview-content-related props:

- `previewRevision`
- `previewState`
- `onRefresh`

It does not receive pure layout props such as:

- `isPreviewCollapsed`
- `previewPaneWidthPct`

That keeps the heavy preview renderer mounted and stable while collapse/expand only changes the outer pane layout class.

### 2. Stabilized The Manual Refresh Callback

`SenseArticleEditor` now passes a stable `handleManualPreviewRefresh` created via `useCallback`, so the memoized preview panel does not re-render due to callback identity churn.

### 3. Reduced Collapse Toggle State Churn

`togglePreviewCollapsed` in `useSenseEditorPreviewPane` was tightened so it no longer writes redundant width state during collapse.

Specifically:

- collapse no longer re-sets `previewPaneWidthPct` to the same value
- expand only restores width if the restored width actually differs from the current stored width

That reduces synchronous state updates on the click path.

### 4. Removed Heavy Layout Transitions

The following heavy transitions were removed:

- `.sense-editor-layout.resizable`
  - no longer transitions `grid-template-columns`
  - no longer transitions `gap`
- `.sense-editor-pane.preview`
  - no longer transitions `padding`

Collapse/expand layout switching is now effectively immediate, while lightweight visual transitions remain on:

- opacity
- transform
- border/shadow/button visual states

### 5. Added Lightweight Renderer Containment

The preview renderer is wrapped in:

- `.sense-editor-preview-renderer`

This wrapper uses:

- `contain: layout paint;`

That narrows layout/paint invalidation around the rendered preview content without changing the outer pane contract.

## Old Structure / Styles Replaced

Replaced structure:

- divider direct child toggle button

with:

- sticky wrapper around the toggle button

Replaced styles:

- absolute-positioned `.sense-editor-divider-toggle`
- layout transition on `.sense-editor-layout.resizable`
- padding transition on `.sense-editor-pane.preview`

## Memo Status

Yes. The preview content is now memoized through:

- `React.memo(SenseArticlePreviewPanel)`

`SenseArticleRenderer` remains mounted under that stable memoized subtree and is no longer forced to reconcile on every collapse/expand layout toggle.

## Manual QA Checklist

- Desktop: scroll the page down and confirm the preview toggle follows the viewport top area instead of staying pinned at its original vertical position.
- Desktop: confirm the sticky toggle does not overlap the resize handle interaction zone.
- Desktop: drag the resize handle after the sticky change and confirm pointer resize still works normally.
- Desktop: click collapse/expand repeatedly on a large article and confirm it is noticeably smoother than before.
- Desktop: confirm the preview does not flash white or fully remount on collapse/expand.
- Desktop: expand after collapse and confirm the last width is restored.
- Desktop: refresh the page and confirm width/collapsed state still restores from localStorage.
- Mobile/narrow width: confirm layout still degrades to single column and toggle placement is not offset.
- Mobile/narrow width: confirm resize handle is still unavailable.
- Edit正文 and wait for auto refresh: confirm preview auto refresh still works.
- Click `刷新预览`: confirm manual refresh still works.
- Create parse errors: confirm errors still remain on the left editor pane.
- Scoped mode: confirm scoped editing and tracked diff controls still behave normally.
- Save draft / submit review / back / dashboard: confirm no regression in existing editor actions.
