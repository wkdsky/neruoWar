const ARTICLE_RENDER_VERSION = 2;
const ARTICLE_SEARCH_VERSION = 2;
const ARTICLE_TOC_VERSION = 2;
const PARSER_CONTRACT_VERSION = 2;
const NOTIFICATION_PAYLOAD_SCHEMA_VERSION = 1;

const AST_NODE_TYPES = {
  DOCUMENT: 'document',
  HEADING: 'heading',
  PARAGRAPH: 'paragraph',
  LIST: 'list',
  LIST_ITEM: 'list_item',
  BLOCKQUOTE: 'blockquote',
  TEXT: 'text',
  CODE_INLINE: 'code_inline',
  CODE_BLOCK: 'code_block',
  EMPHASIS: 'emphasis',
  STRONG: 'strong',
  FORMULA_INLINE: 'formula_inline',
  FORMULA_BLOCK: 'formula_block',
  SYMBOL: 'symbol',
  SENSE_REFERENCE: 'sense_reference'
};

const PARSER_ERROR_CODES = {
  INVALID_REFERENCE_SYNTAX: 'invalid_reference_syntax',
  UNCLOSED_REFERENCE: 'unclosed_reference',
  UNCLOSED_INLINE_MARK: 'unclosed_inline_mark'
};

const REVISION_SOURCE_MODES = ['full', 'section', 'selection'];
const REVISION_REVIEW_STAGES = ['review', 'domain_admin', 'domain_master', 'completed'];
const REVISION_STATUSES = [
  'draft',
  'submitted',
  'pending_review',
  'pending_domain_admin_review',
  'changes_requested_by_domain_admin',
  'rejected_by_domain_admin',
  'pending_domain_master_review',
  'changes_requested_by_domain_master',
  'rejected_by_domain_master',
  'rejected',
  'published',
  'superseded',
  'withdrawn'
];

const REVISION_DECISIONS = ['pending', 'approved', 'rejected', 'changes_requested'];
const REVISION_FINAL_DECISIONS = ['published', 'rejected', 'changes_requested', 'superseded'];

const DRAFT_EDITABLE_STATUSES = [
  'draft',
  'changes_requested_by_domain_admin',
  'changes_requested_by_domain_master'
];

const ACTIVE_REVIEW_STATUSES = [
  'submitted',
  'pending_review',
  'pending_domain_admin_review',
  'pending_domain_master_review'
];

const ACTIVE_SUPERSEDE_STATUSES = [
  'draft',
  'submitted',
  'pending_review',
  'pending_domain_admin_review',
  'changes_requested_by_domain_admin',
  'pending_domain_master_review',
  'changes_requested_by_domain_master'
];

const ANCHOR_TYPES = ['text_range', 'heading', 'block'];
const ANNOTATION_VISIBILITIES = ['private'];
const ANCHOR_RELOCATION_STATUSES = ['exact', 'relocated', 'uncertain', 'broken'];

const NOTIFICATION_TYPES = [
  'domain_admin_invite',
  'domain_admin_invite_result',
  'domain_admin_resign_request',
  'domain_admin_resign_result',
  'domain_master_apply',
  'domain_master_apply_result',
  'alliance_join_apply',
  'alliance_join_apply_result',
  'friend_request',
  'friend_request_result',
  'group_invite',
  'group_invite_result',
  'group_member_removed',
  'domain_distribution_announcement',
  'alliance_announcement',
  'domain_distribution_result',
  'sense_article_revision_submitted',
  'sense_article_domain_admin_review_requested',
  'sense_article_domain_admin_approved',
  'sense_article_domain_admin_rejected',
  'sense_article_domain_master_review_requested',
  'sense_article_published',
  'sense_article_domain_master_rejected',
  'sense_article_changes_requested',
  'sense_article_revision_superseded',
  'sense_article_referenced',
  'info'
];

const SENSE_ARTICLE_NOTIFICATION_TYPES = [
  'sense_article_revision_submitted',
  'sense_article_domain_admin_review_requested',
  'sense_article_domain_admin_approved',
  'sense_article_domain_admin_rejected',
  'sense_article_domain_master_review_requested',
  'sense_article_published',
  'sense_article_domain_master_rejected',
  'sense_article_changes_requested',
  'sense_article_revision_superseded',
  'sense_article_referenced'
];

const SENSE_ARTICLE_NOTIFICATION_PAYLOAD_SCHEMA = {
  commonRequired: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
  byType: {
    sense_article_revision_submitted: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_domain_admin_review_requested: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_domain_admin_approved: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_domain_admin_rejected: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_domain_master_review_requested: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_published: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_domain_master_rejected: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_changes_requested: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId'],
    sense_article_revision_superseded: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId', 'publishedRevisionId'],
    sense_article_referenced: ['schemaVersion', 'nodeId', 'senseId', 'articleId', 'revisionId', 'stage', 'action', 'actorId', 'sourceNodeId', 'sourceSenseId']
  }
};

const NOTIFICATION_STATUSES = ['pending', 'accepted', 'rejected', 'info'];

const SYMBOL_SHORTCUTS = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  omega: 'ω',
  forall: '∀',
  exists: '∃',
  in: '∈',
  notin: '∉',
  sub: '⊂',
  subeq: '⊆',
  sup: '⊃',
  union: '∪',
  inter: '∩',
  and: '∧',
  or: '∨',
  implies: '⇒',
  iff: '⇔',
  to: '→',
  from: '←',
  mapsto: '↦',
  inf: '∞',
  approx: '≈',
  ne: '≠',
  le: '≤',
  ge: '≥',
  degree: '°'
};

module.exports = {
  ACTIVE_REVIEW_STATUSES,
  ACTIVE_SUPERSEDE_STATUSES,
  ANCHOR_RELOCATION_STATUSES,
  ANCHOR_TYPES,
  ANNOTATION_VISIBILITIES,
  ARTICLE_RENDER_VERSION,
  ARTICLE_SEARCH_VERSION,
  ARTICLE_TOC_VERSION,
  AST_NODE_TYPES,
  DRAFT_EDITABLE_STATUSES,
  NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  PARSER_CONTRACT_VERSION,
  PARSER_ERROR_CODES,
  REVISION_DECISIONS,
  REVISION_FINAL_DECISIONS,
  REVISION_REVIEW_STAGES,
  REVISION_SOURCE_MODES,
  REVISION_STATUSES,
  SENSE_ARTICLE_NOTIFICATION_PAYLOAD_SCHEMA,
  SENSE_ARTICLE_NOTIFICATION_TYPES,
  SYMBOL_SHORTCUTS
};
