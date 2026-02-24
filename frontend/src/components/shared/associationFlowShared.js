export const ASSOC_STEPS = {
  SELECT_NODE_A: 'select_node_a',
  SELECT_RELATION: 'select_relation',
  SELECT_NODE_B: 'select_node_b',
  PREVIEW: 'preview'
};

export const ASSOC_RELATION_TYPES = {
  EXTENDS: 'extends',
  CONTAINS: 'contains',
  INSERT: 'insert'
};

export const parseAssociationKeyword = (rawKeyword = '') => {
  const tokens = String(rawKeyword || '')
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  let mode = '';
  const textTokens = [];
  tokens.forEach((token) => {
    const normalized = token.toLowerCase().replace(/[，,;；。！？!?]+$/g, '');
    if (normalized === '#include' || normalized.startsWith('#include')) {
      mode = 'include';
      return;
    }
    if (normalized === '#expand' || normalized.startsWith('#expand')) {
      mode = 'expand';
      return;
    }
    textTokens.push(token);
  });
  return {
    mode,
    textKeyword: textTokens.join(' ').trim()
  };
};

export const resolveAssociationNextStep = (relationType = '') => (
  relationType === ASSOC_RELATION_TYPES.INSERT
    ? ASSOC_STEPS.SELECT_NODE_B
    : ASSOC_STEPS.PREVIEW
);

export const resolveAssociationBackStep = (currentStep = '', selectedRelationType = '') => {
  if (currentStep === ASSOC_STEPS.SELECT_RELATION) {
    return ASSOC_STEPS.SELECT_NODE_A;
  }
  if (currentStep === ASSOC_STEPS.SELECT_NODE_B) {
    return ASSOC_STEPS.SELECT_RELATION;
  }
  if (currentStep === ASSOC_STEPS.PREVIEW) {
    return selectedRelationType === ASSOC_RELATION_TYPES.INSERT
      ? ASSOC_STEPS.SELECT_NODE_B
      : ASSOC_STEPS.SELECT_RELATION;
  }
  return null;
};
