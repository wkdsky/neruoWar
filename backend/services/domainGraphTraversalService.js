const Node = require('../models/Node');

const normalizeName = (value = '') => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeNameList = (names = []) => Array.from(new Set(
  (Array.isArray(names) ? names : [])
    .map((item) => normalizeName(item))
    .filter(Boolean)
));

const listApprovedNodesByNames = async (names = [], {
  select = '_id name relatedParentDomains relatedChildDomains'
} = {}) => {
  const normalizedNames = normalizeNameList(names);
  if (normalizedNames.length === 0) return [];
  const BATCH_SIZE = 500;
  const rows = [];
  for (let i = 0; i < normalizedNames.length; i += BATCH_SIZE) {
    const batchNames = normalizedNames.slice(i, i + BATCH_SIZE);
    const batchRows = await Node.find({
      status: 'approved',
      name: { $in: batchNames }
    }).select(select).lean();
    rows.push(...batchRows);
  }
  return rows;
};

const collectNeighborNames = (node = {}) => normalizeNameList([
  ...(Array.isArray(node?.relatedParentDomains) ? node.relatedParentDomains : []),
  ...(Array.isArray(node?.relatedChildDomains) ? node.relatedChildDomains : [])
]);

const rebuildPathNames = (prevByName = new Map(), targetName = '') => {
  const result = [];
  let cursor = normalizeName(targetName);
  while (cursor) {
    result.push(cursor);
    cursor = prevByName.get(cursor) || '';
  }
  return result.reverse();
};

const bfsByNames = async ({
  startName = '',
  isTargetName = () => false,
  maxDepth = 64,
  maxVisited = 50000
} = {}) => {
  const normalizedStartName = normalizeName(startName);
  if (!normalizedStartName || typeof isTargetName !== 'function') {
    return {
      found: false,
      targetName: '',
      pathNames: []
    };
  }

  if (isTargetName(normalizedStartName)) {
    return {
      found: true,
      targetName: normalizedStartName,
      pathNames: [normalizedStartName]
    };
  }

  const frontierSeed = await listApprovedNodesByNames([normalizedStartName]);
  if (frontierSeed.length === 0) {
    return {
      found: false,
      targetName: '',
      pathNames: []
    };
  }

  const visited = new Set([normalizedStartName]);
  const prevByName = new Map();
  let frontier = [normalizedStartName];
  let depth = 0;
  const safeMaxDepth = Math.max(1, Math.min(200, parseInt(maxDepth, 10) || 64));
  const safeMaxVisited = Math.max(1000, Math.min(500000, parseInt(maxVisited, 10) || 50000));

  while (frontier.length > 0 && depth < safeMaxDepth && visited.size < safeMaxVisited) {
    const layerNodes = await listApprovedNodesByNames(frontier);
    const nodeByName = new Map(layerNodes.map((item) => [normalizeName(item?.name), item]));
    const nextFrontier = [];

    for (const currentName of frontier) {
      const currentNode = nodeByName.get(currentName);
      if (!currentNode) continue;
      const neighborNames = collectNeighborNames(currentNode);
      for (const neighborName of neighborNames) {
        if (!neighborName || visited.has(neighborName)) continue;
        visited.add(neighborName);
        prevByName.set(neighborName, currentName);
        if (isTargetName(neighborName)) {
          return {
            found: true,
            targetName: neighborName,
            pathNames: rebuildPathNames(prevByName, neighborName)
          };
        }
        if (visited.size >= safeMaxVisited) break;
        nextFrontier.push(neighborName);
      }
      if (visited.size >= safeMaxVisited) break;
    }

    frontier = nextFrontier;
    depth += 1;
  }

  return {
    found: false,
    targetName: '',
    pathNames: []
  };
};

const findShortestApprovedPathByNames = async ({
  startName = '',
  targetName = '',
  maxDepth = 64,
  maxVisited = 50000
} = {}) => {
  const normalizedTargetName = normalizeName(targetName);
  if (!normalizedTargetName) {
    return {
      found: false,
      pathNames: []
    };
  }
  const result = await bfsByNames({
    startName,
    maxDepth,
    maxVisited,
    isTargetName: (name) => name === normalizedTargetName
  });
  return {
    found: result.found,
    pathNames: result.pathNames
  };
};

const findShortestApprovedPathToAnyTargets = async ({
  startName = '',
  targetNames = [],
  maxDepth = 64,
  maxVisited = 50000
} = {}) => {
  const targetSet = new Set(normalizeNameList(targetNames));
  if (targetSet.size === 0) {
    return {
      found: false,
      targetName: '',
      pathNames: []
    };
  }
  return bfsByNames({
    startName,
    maxDepth,
    maxVisited,
    isTargetName: (name) => targetSet.has(name)
  });
};

module.exports = {
  findShortestApprovedPathByNames,
  findShortestApprovedPathToAnyTargets,
  listApprovedNodesByNames
};
