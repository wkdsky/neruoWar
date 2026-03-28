module.exports = ({
  User,
  EntropyAlliance,
  getIdString,
  isValidObjectId
}) => {
  const VISUAL_PATTERN_TYPES = ['none', 'dots', 'grid', 'diagonal', 'rings', 'noise'];
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  const normalizeHexColor = (value, fallback) => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
  };

  const normalizePatternType = (value, fallback = 'diagonal') => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    return VISUAL_PATTERN_TYPES.includes(normalized) ? normalized : fallback;
  };

  const toPlainObject = (value) => (
    value && typeof value.toObject === 'function'
      ? value.toObject()
      : value
  );

  const isPopulatedAllianceDoc = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (value._bsontype === 'ObjectId') return false;
    return (
      typeof value.name === 'string' ||
      typeof value.flag === 'string' ||
      Array.isArray(value.visualStyles) ||
      value.activeVisualStyleId !== undefined
    );
  };

  const normalizeVisualStyleForNode = (style = {}, fallbackFlag = '#7c3aed') => ({
    name: typeof style?.name === 'string' ? style.name : '默认风格',
    primaryColor: normalizeHexColor(style?.primaryColor, normalizeHexColor(fallbackFlag, '#7c3aed')),
    secondaryColor: normalizeHexColor(style?.secondaryColor, '#334155'),
    glowColor: normalizeHexColor(style?.glowColor, '#c084fc'),
    rimColor: normalizeHexColor(style?.rimColor, '#f5d0fe'),
    textColor: normalizeHexColor(style?.textColor, '#ffffff'),
    patternType: normalizePatternType(style?.patternType, 'diagonal')
  });

  const resolveAllianceActiveStyle = (alliance) => {
    if (!alliance) return null;
    const styleList = Array.isArray(alliance.visualStyles) ? alliance.visualStyles : [];
    if (styleList.length === 0) {
      return normalizeVisualStyleForNode({
        name: '默认风格',
        primaryColor: alliance.flag || '#7c3aed',
        secondaryColor: '#334155',
        glowColor: '#c084fc',
        rimColor: '#f5d0fe',
        textColor: '#ffffff',
        patternType: 'diagonal'
      }, alliance.flag);
    }
    const activeId = getIdString(alliance.activeVisualStyleId);
    const active = styleList.find((styleItem) => getIdString(styleItem?._id) === activeId) || styleList[0];
    return normalizeVisualStyleForNode(active, alliance.flag);
  };

  const attachVisualStyleToNodeList = async (nodes = []) => {
    const plainNodes = (nodes || []).map(toPlainObject).filter(Boolean);
    if (plainNodes.length === 0) return [];

    const nodeKeyByIndex = new Map();
    const nodeAllianceIdByKey = new Map();
    const allianceById = new Map();
    const unresolvedNodeAllianceIds = new Set();

    const domainMasterIds = new Set();
    const allianceByMasterId = new Map();

    plainNodes.forEach((nodeItem, index) => {
      const nodeKey = getIdString(nodeItem?._id) || `idx_${index}`;
      nodeKeyByIndex.set(index, nodeKey);

      const nodeAllianceValue = nodeItem?.allianceId;
      const nodeAllianceId = getIdString(
        nodeAllianceValue && typeof nodeAllianceValue === 'object'
          ? nodeAllianceValue._id
          : nodeAllianceValue
      );
      if (isValidObjectId(nodeAllianceId)) {
        nodeAllianceIdByKey.set(nodeKey, nodeAllianceId);
        if (isPopulatedAllianceDoc(nodeAllianceValue)) {
          allianceById.set(nodeAllianceId, toPlainObject(nodeAllianceValue));
        } else {
          unresolvedNodeAllianceIds.add(nodeAllianceId);
        }
      }

      const domainMasterValue = nodeItem.domainMaster;
      const domainMasterId = getIdString(
        domainMasterValue && typeof domainMasterValue === 'object'
          ? domainMasterValue._id
          : domainMasterValue
      );
      if (!isValidObjectId(domainMasterId)) return;
      domainMasterIds.add(domainMasterId);

      if (domainMasterValue && typeof domainMasterValue === 'object') {
        const allianceRef = domainMasterValue.alliance || domainMasterValue.allianceId;
        if (isPopulatedAllianceDoc(allianceRef)) {
          allianceByMasterId.set(domainMasterId, toPlainObject(allianceRef));
        }
      }
    });

    const unresolvedNodeAllianceIdList = Array.from(unresolvedNodeAllianceIds).filter((id) => !allianceById.has(id));
    if (unresolvedNodeAllianceIdList.length > 0) {
      const directAlliances = await EntropyAlliance.find({ _id: { $in: unresolvedNodeAllianceIdList } })
        .select('name flag visualStyles activeVisualStyleId')
        .lean();
      directAlliances.forEach((allianceItem) => {
        const allianceId = getIdString(allianceItem?._id);
        if (allianceId) {
          allianceById.set(allianceId, allianceItem);
        }
      });
    }

    const unresolvedMasterIds = Array.from(domainMasterIds).filter((id) => !allianceByMasterId.has(id));
    if (unresolvedMasterIds.length > 0) {
      const masters = await User.find({ _id: { $in: unresolvedMasterIds } })
        .select('_id allianceId')
        .lean();
      const unresolvedAllianceIds = Array.from(new Set(
        masters.map((userItem) => getIdString(userItem.allianceId)).filter((id) => isValidObjectId(id))
      ));
      let allianceMap = new Map();
      if (unresolvedAllianceIds.length > 0) {
        const alliances = await EntropyAlliance.find({ _id: { $in: unresolvedAllianceIds } })
          .select('name flag visualStyles activeVisualStyleId')
          .lean();
        allianceMap = new Map(alliances.map((allianceItem) => [getIdString(allianceItem._id), allianceItem]));
      }
      masters.forEach((masterItem) => {
        const masterId = getIdString(masterItem._id);
        const allianceId = getIdString(masterItem.allianceId);
        if (masterId && allianceMap.has(allianceId)) {
          const resolvedAlliance = allianceMap.get(allianceId);
          allianceByMasterId.set(masterId, resolvedAlliance);
          if (allianceId) {
            allianceById.set(allianceId, resolvedAlliance);
          }
        }
      });
    }

    return plainNodes.map((nodeItem, index) => {
      const nodeKey = nodeKeyByIndex.get(index);
      const nodeAllianceId = nodeAllianceIdByKey.get(nodeKey) || '';
      let alliance = nodeAllianceId ? (allianceById.get(nodeAllianceId) || null) : null;

      const domainMasterId = getIdString(
        nodeItem.domainMaster && typeof nodeItem.domainMaster === 'object'
          ? nodeItem.domainMaster._id
          : nodeItem.domainMaster
      );
      if (!alliance) {
        alliance = allianceByMasterId.get(domainMasterId) || null;
      }
      if (!alliance) {
        return {
          ...nodeItem,
          visualStyle: null
        };
      }
      const style = resolveAllianceActiveStyle(alliance);
      return {
        ...nodeItem,
        visualStyle: {
          ...style,
          allianceId: getIdString(alliance._id) || nodeAllianceId,
          allianceName: alliance.name || '',
          styleId: getIdString(alliance.activeVisualStyleId) || ''
        }
      };
    });
  };

  return {
    attachVisualStyleToNodeList
  };
};
