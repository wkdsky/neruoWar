import { CITY_CHANNEL_TEMPLATE_META_VERSION } from './constants';
import { normalizeString } from './valueUtils';

export const normalizeTemplateMeta = (meta = {}, fallback = {}) => {
  const source = meta && typeof meta === 'object' ? meta : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const parentTemplateId = normalizeString(source.parentTemplateId, normalizeString(fallbackSource.parentTemplateId, null));
  const rootTemplateId = normalizeString(
    source.rootTemplateId,
    normalizeString(fallbackSource.rootTemplateId, parentTemplateId || null)
  );
  const lineage = Array.isArray(source.lineage) ? source.lineage : (Array.isArray(fallbackSource.lineage) ? fallbackSource.lineage : []);
  const normalizedLineage = lineage
    .map((entry) => normalizeString(entry, ''))
    .filter(Boolean);

  if (parentTemplateId && !normalizedLineage.includes(parentTemplateId)) {
    normalizedLineage.unshift(parentTemplateId);
  }

  return {
    schemaVersion: CITY_CHANNEL_TEMPLATE_META_VERSION,
    source: normalizeString(source.source, normalizeString(fallbackSource.source, 'local')),
    templateId: normalizeString(source.templateId, normalizeString(fallbackSource.templateId, null)),
    parentTemplateId,
    rootTemplateId,
    originalTemplateId: normalizeString(source.originalTemplateId, normalizeString(fallbackSource.originalTemplateId, rootTemplateId || parentTemplateId || null)),
    authorId: normalizeString(source.authorId, normalizeString(fallbackSource.authorId, null)),
    visibility: normalizeString(source.visibility, normalizeString(fallbackSource.visibility, 'private')),
    forkedAt: normalizeString(source.forkedAt, normalizeString(fallbackSource.forkedAt, null)),
    savedAt: normalizeString(source.savedAt, normalizeString(fallbackSource.savedAt, null)),
    lineage: normalizedLineage
  };
};
