export const canSelectBoardPlacement = (selectionScope, additive = false) => (
  !additive || selectionScope !== 'component'
);

export const canSelectComponentPlacement = (selectionScope, additive = false) => (
  !additive || selectionScope !== 'board'
);
