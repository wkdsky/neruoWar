const HEX_HEIGHT_RATIO = 2 / Math.sqrt(3);

export const getNodePrimarySense = (node) => {
  const senses = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
  if (typeof node?.activeSenseId === 'string' && node.activeSenseId.trim()) {
    const matched = senses.find((item) => item?.senseId === node.activeSenseId.trim());
    if (matched) return matched;
  }
  return senses[0] || null;
};

export const getNodeDisplayName = (node) => {
  if (typeof node?.displayName === 'string' && node.displayName.trim()) return node.displayName.trim();
  const name = typeof node?.name === 'string' ? node.name.trim() : '';
  const senseTitle = typeof node?.activeSenseTitle === 'string' && node.activeSenseTitle.trim()
    ? node.activeSenseTitle.trim()
    : (typeof getNodePrimarySense(node)?.title === 'string' ? getNodePrimarySense(node).title.trim() : '');
  return senseTitle ? `${name}-${senseTitle}` : (name || '未命名知识域');
};

export const getNodeSenseTitle = (node) => {
  if (typeof node?.activeSenseTitle === 'string' && node.activeSenseTitle.trim()) return node.activeSenseTitle.trim();
  const sense = getNodePrimarySense(node);
  return typeof sense?.title === 'string' ? sense.title.trim() : '';
};

export const getNodeSenseSummary = (node) => {
  if (typeof node?.description === 'string' && node.description.trim()) return node.description.trim();
  if (typeof node?.knowledge === 'string' && node.knowledge.trim()) return node.knowledge.trim();
  return '';
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const buildHomeSafeAreaInsets = (viewportWidth, viewportHeight) => {
  const width = Number(viewportWidth) || 0;
  const height = Number(viewportHeight) || 0;

  // 这里预留了首页主入口区的“安全内容区”，避免六边形与导航、顶部搜索、
  // 右侧 dock 以及底部操作留白互相覆盖。小屏时优先压缩安全边距，再缩小六边形。
  return {
    left: width >= 1480 ? 190 : (width >= 1180 ? 166 : (width >= 920 ? 138 : (width >= 720 ? 118 : 20))),
    right: width >= 1520 ? 392 : (width >= 1240 ? 348 : (width >= 980 ? 292 : 24)),
    top: width >= 1180 ? 194 : (width >= 920 ? 186 : 152),
    bottom: width >= 720
      ? (height >= 860 ? 72 : 42)
      : (height >= 860 ? 124 : 108)
  };
};

const resolveHexMetrics = (availableWidth, itemCount, { minWidth, maxWidth, maxColumns } = {}) => {
  const safeWidth = Math.max(240, Number(availableWidth) || 0);
  const safeCount = Math.max(1, Number(itemCount) || 1);
  const maxCols = Math.max(1, Math.min(safeCount, Number(maxColumns) || safeCount));
  const minHexWidth = Number(minWidth) || 120;
  const maxHexWidth = Number(maxWidth) || 210;

  for (let columns = maxCols; columns >= 1; columns -= 1) {
    const rows = Math.ceil(safeCount / columns);
    const requiredUnits = columns + (rows > 1 ? 0.5 : 0);
    const hexWidth = Math.floor(safeWidth / requiredUnits);
    if (hexWidth >= minHexWidth) {
      return {
        columns,
        hexWidth: clamp(hexWidth, minHexWidth, maxHexWidth)
      };
    }
  }

  return {
    columns: 1,
    hexWidth: clamp(safeWidth * 0.72, Math.min(84, minHexWidth), maxHexWidth)
  };
};

export const buildHoneycombLayout = (items = [], availableWidth, options = {}) => {
  const list = Array.isArray(items) ? items : [];
  if (list.length < 1) {
    return {
      cards: [],
      columns: 0,
      rows: 0,
      width: 0,
      height: 0,
      hexWidth: 0,
      hexHeight: 0
    };
  }

  // 真正的蜂窝实现：奇偶行做半个单元偏移，行间距按 pointy-top 六边形的几何关系
  // 计算，不使用矩形 grid 假装蜂窝。
  const { columns, hexWidth } = resolveHexMetrics(availableWidth, list.length, options);
  const rows = Math.ceil(list.length / columns);
  const horizontalStep = hexWidth;
  const hexHeight = hexWidth * HEX_HEIGHT_RATIO;
  const verticalStep = hexHeight * 0.75;
  const rowOffset = rows > 1 ? hexWidth * 0.5 : 0;
  const contentWidth = columns * hexWidth + rowOffset;
  const stageWidth = Math.max(hexWidth, Math.min(Math.max(240, Number(availableWidth) || 0), contentWidth));
  const stageHeight = hexHeight + Math.max(0, rows - 1) * verticalStep;
  const centerRow = (rows - 1) / 2;
  const centerColumn = (columns - 1) / 2;
  const baseX = Math.max(0, (stageWidth - contentWidth) * 0.5);

  const cards = list.map((item, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const offsetX = row % 2 === 1 ? rowOffset : 0;
    const x = baseX + offsetX + column * horizontalStep;
    const y = row * verticalStep;
    const staggerDistance = Math.abs(row - centerRow) + Math.abs(column - centerColumn);
    return {
      item,
      index,
      row,
      column,
      x,
      y,
      width: hexWidth,
      height: hexHeight,
      enterDelayMs: Math.round(staggerDistance * 55)
    };
  });

  return {
    cards,
    columns,
    rows,
    width: stageWidth,
    height: stageHeight,
    hexWidth,
    hexHeight
  };
};
