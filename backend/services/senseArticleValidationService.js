const { getIdString } = require('../utils/objectId');
const {
  TABLE_BORDER_PRESETS,
  TABLE_DIAGONAL_MODES,
  TABLE_STYLE_OPTIONS,
  TABLE_WIDTH_MODES
} = require('./senseArticleTableMetaService');

const FORMULA_MARKUP_PATTERN = /data-formula-placeholder\s*=\s*["']true["']/i;

const hasSemanticInlineContent = (block = {}) => {
  const html = String(block?.html || '').trim();
  if (!html) return false;
  return FORMULA_MARKUP_PATTERN.test(html);
};

const isMeaningfulBlock = (block = {}) => {
  const type = String(block?.type || '').trim();
  if (['image', 'audio', 'video', 'table', 'horizontal_rule'].includes(type)) return true;
  if (hasSemanticInlineContent(block)) return true;
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
  const formulaRefs = Array.isArray(revision?.formulaRefs) ? revision.formulaRefs : [];
  const effectiveMediaReferences = Array.isArray(mediaReferences) ? mediaReferences : (Array.isArray(revision?.mediaReferences) ? revision.mediaReferences : []);
  const hasFormulaContent = formulaRefs.some((item) => String(item?.formula || '').trim().length > 0);

  if (!hasFormulaContent && !blocks.some(isMeaningfulBlock)) {
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
    return rows.length === 0 || rows.every((row) => (
      Array.isArray(row?.cells) ? row.cells : []
    ).every((cell) => !String(typeof cell === 'string' ? cell : cell?.text || '').trim()));
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

  const invalidTableBlocks = blocks.filter((block) => String(block?.type || '').trim() === 'table').flatMap((block) => {
    const issues = [];
    if (block.tableStyle && !TABLE_STYLE_OPTIONS.has(String(block.tableStyle))) {
      issues.push({ code: 'invalid_table_style', level: 'warning', message: `表格 ${block.id || ''} 含非法样式枚举。` });
    }
    if (block.tableBorderPreset && !TABLE_BORDER_PRESETS.has(String(block.tableBorderPreset))) {
      issues.push({ code: 'invalid_table_border_preset', level: 'warning', message: `表格 ${block.id || ''} 含非法边框预设。` });
    }
    if (block.tableWidthMode && !TABLE_WIDTH_MODES.has(String(block.tableWidthMode))) {
      issues.push({ code: 'invalid_table_width_mode', level: 'warning', message: `表格 ${block.id || ''} 含非法宽度模式。` });
    }
    const widthValue = Number(block.tableWidthValue || 100);
    if (block.tableWidthMode && block.tableWidthMode !== 'auto' && (!Number.isFinite(widthValue) || widthValue < 40 || widthValue > 100)) {
      issues.push({ code: 'invalid_table_width_value', level: 'warning', message: `表格 ${block.id || ''} 的宽度值超出允许范围。` });
    }
    if (Array.isArray(block.columnWidths) && block.columnWidths.some((item) => !Number.isFinite(Number(item)) || Number(item) < 40 || Number(item) > 1200)) {
      issues.push({ code: 'invalid_table_column_widths', level: 'warning', message: `表格 ${block.id || ''} 含非法列宽。` });
    }
    (Array.isArray(block.rows) ? block.rows : []).forEach((row) => {
      (Array.isArray(row?.cells) ? row.cells : []).forEach((cell) => {
        if (!cell || typeof cell === 'string') return;
        const rowSpan = Number(cell.rowspan ?? 1);
        const colSpan = Number(cell.colspan ?? 1);
        if (!Number.isFinite(rowSpan) || rowSpan < 1 || !Number.isFinite(colSpan) || colSpan < 1) {
          issues.push({ code: 'invalid_table_merge_span', level: 'blocking', message: `表格 ${block.id || ''} 存在非法的 rowspan/colspan。` });
        }
        if (cell.diagonalMode && !TABLE_DIAGONAL_MODES.has(String(cell.diagonalMode))) {
          issues.push({ code: 'invalid_table_diagonal_mode', level: 'warning', message: `表格 ${block.id || ''} 含非法斜线模式。` });
        }
        if (cell.diagonalMode && cell.diagonalMode !== 'none' && !cell.isHeader) {
          issues.push({ code: 'diagonal_on_non_header_cell', level: 'warning', message: `表格 ${block.id || ''} 存在非表头斜线单元格，建议确认是否符合预期。` });
        }
      });
    });
    if ((block.mergeSummary?.mergedCellCount || 0) > 0 && (block.mergeSummary?.maxRowspan || 1) > (Array.isArray(block.rows) ? block.rows.length : 0)) {
      issues.push({ code: 'invalid_table_merge_structure', level: 'blocking', message: `表格 ${block.id || ''} 的合并结构超过表格行数。` });
    }
    if ((Array.isArray(block.rows) ? block.rows.length : 0) > 0 && Math.max(0, ...(block.rows || []).map((row) => (row.cells || []).length)) === 0) {
      issues.push({ code: 'empty_table_shell', level: 'warning', message: `表格 ${block.id || ''} 只有壳结构，建议补充内容或删除。` });
    }
    return issues;
  });

  invalidTableBlocks.forEach((issue) => {
    pushIssue(issue.level === 'blocking' ? blocking : warnings, issue);
  });

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
