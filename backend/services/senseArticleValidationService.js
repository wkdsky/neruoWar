const { getIdString } = require('../utils/objectId');

const isMeaningfulBlock = (block = {}) => {
  const type = String(block?.type || '').trim();
  if (['image', 'audio', 'video', 'table', 'horizontal_rule'].includes(type)) return true;
  return String(block?.plainText || '').trim().length > 0;
};

const pushIssue = (list, issue) => {
  list.push({
    code: issue.code || 'validation_issue',
    message: issue.message || '',
    level: issue.level || 'warning',
    meta: issue.meta || null
  });
};

const validateRevisionContent = ({ revision = null, mediaReferences = null } = {}) => {
  const blocking = [];
  const warnings = [];
  const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
  const headingIndex = Array.isArray(revision?.headingIndex) ? revision.headingIndex : [];
  const referenceIndex = Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : [];
  const effectiveMediaReferences = Array.isArray(mediaReferences) ? mediaReferences : (Array.isArray(revision?.mediaReferences) ? revision.mediaReferences : []);

  if (!blocks.some(isMeaningfulBlock)) {
    pushIssue(blocking, {
      code: 'empty_body',
      level: 'blocking',
      message: '正文为空，不能提交或发布空百科内容。'
    });
  }

  let previousLevel = 0;
  headingIndex.forEach((heading) => {
    const level = Number(heading?.level || 0);
    if (previousLevel > 0 && level > previousLevel + 1) {
      pushIssue(warnings, {
        code: 'heading_level_jump',
        message: `标题层级从 H${previousLevel} 直接跳到 H${level}，建议调整层级结构。`,
        meta: {
          headingId: heading?.headingId || '',
          title: heading?.title || '',
          previousLevel,
          nextLevel: level
        }
      });
    }
    if (level > 0) previousLevel = level;
  });

  const invalidReferences = referenceIndex.filter((item) => item?.isValid === false);
  if (invalidReferences.length > 0) {
    pushIssue(blocking, {
      code: 'invalid_internal_references',
      level: 'blocking',
      message: `存在 ${invalidReferences.length} 个未解析的内部引用，提交前请修正。`,
      meta: {
        references: invalidReferences.map((item) => ({
          referenceId: item.referenceId || '',
          targetNodeId: getIdString(item.targetNodeId),
          targetSenseId: item.targetSenseId || '',
          displayText: item.displayText || ''
        }))
      }
    });
  }

  const missingMedia = effectiveMediaReferences.filter((item) => item?.missingAsset);
  if (missingMedia.length > 0) {
    pushIssue(blocking, {
      code: 'missing_media_assets',
      level: 'blocking',
      message: `存在 ${missingMedia.length} 个媒体地址没有对应资源记录，不能进入发布流程。`,
      meta: {
        media: missingMedia.map((item) => ({
          url: item.url || '',
          kind: item.kind || '',
          blockId: item.blockId || ''
        }))
      }
    });
  }

  const imageWithoutAlt = effectiveMediaReferences.filter((item) => item?.kind === 'image' && !String(item?.alt || '').trim());
  if (imageWithoutAlt.length > 0) {
    pushIssue(warnings, {
      code: 'image_alt_missing',
      message: `有 ${imageWithoutAlt.length} 张图片缺少 alt 文本，建议补充以提升可访问性。`,
      meta: {
        images: imageWithoutAlt.map((item) => ({
          url: item.url || '',
          blockId: item.blockId || ''
        }))
      }
    });
  }

  const emptyTables = blocks.filter((block) => String(block?.type || '').trim() === 'table').filter((block) => {
    const rows = Array.isArray(block?.rows) ? block.rows : [];
    return rows.length === 0 || rows.every((row) => (Array.isArray(row?.cells) ? row.cells : []).every((cell) => !String(cell || '').trim()));
  });
  if (emptyTables.length > 0) {
    pushIssue(warnings, {
      code: 'empty_tables',
      message: `检测到 ${emptyTables.length} 个空表格，建议删除或补充内容。`,
      meta: {
        blockIds: emptyTables.map((item) => item.id || '')
      }
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    blocking,
    warnings,
    hasBlockingIssues: blocking.length > 0,
    hasWarnings: warnings.length > 0
  };
};

module.exports = {
  validateRevisionContent
};
