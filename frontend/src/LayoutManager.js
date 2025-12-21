/**
 * LayoutManager - 布局管理器
 * 负责计算不同场景下节点的位置
 */

class LayoutManager {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.centerX = width / 2;
    this.centerY = height / 2;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.centerX = width / 2;
    this.centerY = height / 2;
  }

  /**
   * 首页布局
   * 包括：搜索栏、根节点网格、热门节点横向滚动
   */
  calculateHomeLayout(rootNodes, featuredNodes, searchResults = []) {
    const layout = {
      nodes: [],
      lines: []
    };

    const isSearching = searchResults.length > 0;

    if (isSearching) {
      // 搜索结果模式：长方体条目列表布局
      // 注意：搜索结果使用HTML渲染，不在WebGL中显示
      // 这里返回空的节点列表，搜索结果由React组件处理
      return layout;
    }

    // 正常首页布局

    // 整体下移偏移量
    const yOffset = 70;

    // 根节点：网格布局
    const rootStartY = this.height * 0.35 + yOffset;
    const rootCols = Math.min(3, rootNodes.length);
    const rootSpacingX = Math.min(250, this.width * 0.25);
    const rootSpacingY = 180;

    rootNodes.forEach((node, index) => {
      const row = Math.floor(index / rootCols);
      const col = index % rootCols;
      const rowWidth = Math.min(rootNodes.length - row * rootCols, rootCols);
      const offsetX = (rowWidth - 1) * rootSpacingX / 2;

      layout.nodes.push({
        id: `root-${node._id}`,
        x: this.centerX - offsetX + col * rootSpacingX,
        y: rootStartY + row * rootSpacingY,
        radius: 70,
        scale: 1,
        opacity: 1,
        type: 'root',
        label: node.name,
        subLabel: `${(node.knowledgePoint?.value || 0).toFixed(2)} 知识点`,
        data: node,
        visible: true
      });
    });

    // 热门节点：横向排列
    const featuredY = this.height * 0.70 + yOffset;
    const featuredSpacing = 150;
    const featuredStartX = this.centerX - (featuredNodes.length - 1) * featuredSpacing / 2;

    featuredNodes.forEach((node, index) => {
      layout.nodes.push({
        id: `featured-${node._id}`,
        x: featuredStartX + index * featuredSpacing,
        y: featuredY,
        radius: 55,
        scale: 1,
        opacity: 1,
        type: 'featured',
        label: node.name,
        subLabel: `${(node.knowledgePoint?.value || 0).toFixed(2)} 知识点`,
        data: node,
        visible: true
      });
    });

    return layout;
  }

  /**
   * 节点详情布局
   * 中心节点 + 母域节点(上半圆) + 子域节点(下半圆)
   */
  calculateNodeDetailLayout(centerNode, parentNodes = [], childNodes = []) {
    const layout = {
      nodes: [],
      lines: []
    };

    // 整体下移偏移量
    const yOffset = 60;

    // 中心节点
    layout.nodes.push({
      id: `center-${centerNode._id}`,
      x: this.centerX,
      y: this.centerY + yOffset,
      radius: 80,
      scale: 1,
      opacity: 1,
      type: 'center',
      label: centerNode.name,
      subLabel: `${(centerNode.knowledgePoint?.value || 0).toFixed(2)} 知识点`,
      data: centerNode,
      visible: true
    });

    // 母域节点 (上半圆)
    const parentDistance = Math.min(250, this.height * 0.25);
    const parentRadius = 50;

    parentNodes.forEach((node, index) => {
      const angle = Math.PI + (Math.PI / (parentNodes.length + 1)) * (index + 1);
      const x = this.centerX + Math.cos(angle) * parentDistance;
      const y = this.centerY + yOffset + Math.sin(angle) * parentDistance;

      const nodeId = `parent-${node._id}`;

      layout.nodes.push({
        id: nodeId,
        x,
        y,
        radius: parentRadius,
        scale: 1,
        opacity: 1,
        type: 'parent',
        label: node.name,
        subLabel: `${(node.knowledgePoint?.value || 0).toFixed(1)} 点`,
        data: node,
        visible: true
      });

      // 添加连线
      layout.lines.push({
        from: `center-${centerNode._id}`,
        to: nodeId,
        color: [0.06, 0.73, 0.51, 0.6] // 绿色
      });
    });

    // 子域节点 (下半圆)
    const childDistance = Math.min(230, this.height * 0.22);
    const childRadius = 40;

    childNodes.forEach((node, index) => {
      const angle = (Math.PI / (childNodes.length + 1)) * (index + 1);
      const x = this.centerX + Math.cos(angle) * childDistance;
      const y = this.centerY + yOffset + Math.sin(angle) * childDistance;

      const nodeId = `child-${node._id}`;

      layout.nodes.push({
        id: nodeId,
        x,
        y,
        radius: childRadius,
        scale: 1,
        opacity: 1,
        type: 'child',
        label: node.name,
        subLabel: `${(node.knowledgePoint?.value || 0).toFixed(1)} 点`,
        data: node,
        visible: true
      });

      // 添加连线
      layout.lines.push({
        from: `center-${centerNode._id}`,
        to: nodeId,
        color: [0.98, 0.75, 0.14, 0.6] // 黄色
      });
    });

    return layout;
  }

  /**
   * 计算过渡动画：从当前布局到新布局
   * 处理节点的进入、退出、移动
   */
  calculateTransition(currentLayout, newLayout) {
    const transitions = {
      enter: [],      // 新出现的节点 (淡入 + 缩放)
      exit: [],       // 要消失的节点 (淡出 + 缩小)
      move: [],       // 移动的节点 (位置变化)
      stay: []        // 保持的节点
    };

    const currentIds = new Set(currentLayout.nodes.map(n => n.id));
    const newIds = new Set(newLayout.nodes.map(n => n.id));

    // 查找退出的节点
    for (const node of currentLayout.nodes) {
      if (!newIds.has(node.id)) {
        transitions.exit.push({
          id: node.id,
          from: { ...node },
          to: { ...node, scale: 0, opacity: 0 }
        });
      }
    }

    // 查找进入和移动的节点
    for (const node of newLayout.nodes) {
      if (!currentIds.has(node.id)) {
        // 新节点：从缩小+透明状态进入
        transitions.enter.push({
          id: node.id,
          from: { ...node, scale: 0, opacity: 0 },
          to: { ...node }
        });
      } else {
        // 已存在的节点：检查是否移动
        const currentNode = currentLayout.nodes.find(n => n.id === node.id);
        const moved = currentNode.x !== node.x || currentNode.y !== node.y ||
                     currentNode.scale !== node.scale || currentNode.radius !== node.radius;

        if (moved) {
          transitions.move.push({
            id: node.id,
            from: { ...currentNode },
            to: { ...node }
          });
        } else {
          transitions.stay.push({
            id: node.id,
            config: { ...node }
          });
        }
      }
    }

    return transitions;
  }

  /**
   * 特殊过渡：点击节点放大到中心
   * 用于从首页点击节点到节点详情页
   */
  calculateClickTransition(clickedNode, fromLayout, toLayout) {
    // 找到被点击的节点
    const sourceNode = fromLayout.nodes.find(n => n.id === clickedNode.id);
    const targetCenterNode = toLayout.nodes.find(n => n.type === 'center');

    if (!sourceNode || !targetCenterNode) {
      return this.calculateTransition(fromLayout, toLayout);
    }

    const transitions = {
      enter: [],
      exit: [],
      move: [],
      stay: [],
      special: null  // 被点击节点的特殊动画
    };

    // 被点击的节点：特殊处理
    transitions.special = {
      id: sourceNode.id,
      from: { ...sourceNode },
      to: {
        ...targetCenterNode,
        id: sourceNode.id  // 保持ID，后续会重命名
      }
    };

    // 其他节点全部淡出
    for (const node of fromLayout.nodes) {
      if (node.id !== sourceNode.id) {
        transitions.exit.push({
          id: node.id,
          from: { ...node },
          to: { ...node, opacity: 0, scale: node.scale * 0.5 }
        });
      }
    }

    // 新布局的其他节点延迟淡入
    for (const node of toLayout.nodes) {
      if (node.id !== targetCenterNode.id) {
        transitions.enter.push({
          id: node.id,
          from: {
            ...node,
            x: targetCenterNode.x + (Math.random() - 0.5) * 100,
            y: targetCenterNode.y + (Math.random() - 0.5) * 100,
            scale: 0,
            opacity: 0
          },
          to: { ...node }
        });
      }
    }

    return transitions;
  }

  // ==================== 关联关系预览布局计算 ====================

  /**
   * 计算关联关系预览布局
   * @param {Object} newNodeData - 新节点数据 {name, description}
   * @param {Object} nodeA - 第一个关联节点（包含 parentNodesInfo, childNodesInfo）
   * @param {string} relationType - 'extends' | 'contains' | 'insert'
   * @param {Object} nodeB - 第二个关联节点（仅 insert 模式，包含 node 和 direction）
   * @param {Object} currentLayout - 当前布局
   * @returns {Object} 预览布局配置
   */
  calculateAssociationPreviewLayout(newNodeData, nodeA, relationType, nodeB, currentLayout) {
    // 整体下移偏移量
    const yOffset = 60;

    // 找到 nodeA 在当前布局中的位置
    const nodeAInLayout = currentLayout.nodes.find(
      n => n.data && n.data._id === nodeA._id
    );

    // 如果找不到 nodeA，使用中心位置
    const nodeAPosition = nodeAInLayout
      ? { x: nodeAInLayout.x, y: nodeAInLayout.y }
      : { x: this.centerX, y: this.centerY + yOffset };

    // 根据关系类型计算预览布局
    if (relationType === 'insert' && nodeB) {
      return this.calculateInsertPreviewLayout(newNodeData, nodeA, nodeB, currentLayout, nodeAPosition);
    } else {
      return this.calculateSimplePreviewLayout(newNodeData, nodeA, relationType, currentLayout, nodeAPosition);
    }
  }

  /**
   * 计算简单关联预览布局（新节点直接作为 nodeA 的母域或子域）
   */
  calculateSimplePreviewLayout(newNodeData, nodeA, relationType, currentLayout, nodeAPosition) {
    const result = {
      movements: [],
      previewNode: null,
      previewLines: []
    };

    const distance = 150;
    const previewRadius = 45;

    // 确定新节点位置
    let previewX, previewY;
    let lineColor;

    if (relationType === 'extends') {
      // 新节点作为 nodeA 的母域（上方）
      // 需要检查 nodeA 已有的母域节点数量来确定位置
      const existingParentCount = nodeA.parentNodesInfo?.length || 0;
      const angle = Math.PI + (Math.PI / (existingParentCount + 2)) * (existingParentCount + 1);

      previewX = nodeAPosition.x + Math.cos(angle) * distance;
      previewY = nodeAPosition.y + Math.sin(angle) * distance;
      lineColor = [0.06, 0.73, 0.51, 0.8]; // 绿色（母域连线）

      // 如果有现有母域节点，需要移动它们以腾出空间
      if (existingParentCount > 0 && currentLayout.nodes) {
        const parentNodes = currentLayout.nodes.filter(n => n.type === 'parent');
        const totalParents = existingParentCount + 1;

        parentNodes.forEach((node, index) => {
          const newAngle = Math.PI + (Math.PI / (totalParents + 1)) * (index + 1);
          const newX = nodeAPosition.x + Math.cos(newAngle) * distance;
          const newY = nodeAPosition.y + Math.sin(newAngle) * distance;

          if (Math.abs(node.x - newX) > 5 || Math.abs(node.y - newY) > 5) {
            result.movements.push({
              id: node.id,
              x: newX,
              y: newY
            });
          }
        });
      }
    } else {
      // 新节点作为 nodeA 的子域（下方）
      const existingChildCount = nodeA.childNodesInfo?.length || 0;
      const angle = (Math.PI / (existingChildCount + 2)) * (existingChildCount + 1);

      previewX = nodeAPosition.x + Math.cos(angle) * distance;
      previewY = nodeAPosition.y + Math.sin(angle) * distance;
      lineColor = [0.98, 0.75, 0.14, 0.8]; // 黄色（子域连线）

      // 如果有现有子域节点，需要移动它们以腾出空间
      if (existingChildCount > 0 && currentLayout.nodes) {
        const childNodes = currentLayout.nodes.filter(n => n.type === 'child');
        const totalChildren = existingChildCount + 1;

        childNodes.forEach((node, index) => {
          const newAngle = (Math.PI / (totalChildren + 1)) * (index + 1);
          const newX = nodeAPosition.x + Math.cos(newAngle) * distance;
          const newY = nodeAPosition.y + Math.sin(newAngle) * distance;

          if (Math.abs(node.x - newX) > 5 || Math.abs(node.y - newY) > 5) {
            result.movements.push({
              id: node.id,
              x: newX,
              y: newY
            });
          }
        });
      }
    }

    // 设置预览节点
    result.previewNode = {
      x: previewX,
      y: previewY,
      radius: previewRadius,
      scale: 1,
      opacity: 0.75,
      label: newNodeData.name || '新节点',
      subLabel: '',
      visible: true
    };

    // 设置预览连线（从 nodeA 到新节点）
    const nodeAId = currentLayout.nodes.find(n => n.data && n.data._id === nodeA._id)?.id;
    if (nodeAId) {
      result.previewLines.push({
        from: nodeAId,
        to: 'preview-new-node',
        color: lineColor,
        isDashed: true,
        isNew: true
      });
    }

    return result;
  }

  /**
   * 计算插入预览布局（新节点插入到 A 和 B 之间）
   */
  calculateInsertPreviewLayout(newNodeData, nodeA, nodeBConfig, currentLayout, nodeAPosition) {
    const nodeB = nodeBConfig.node;
    const direction = nodeBConfig.direction; // 'aToB' 或 'bToA'

    const result = {
      movements: [],
      previewNode: null,
      previewLines: []
    };

    // 找到 nodeB 在当前布局中的位置
    const nodeBInLayout = currentLayout.nodes.find(
      n => n.data && n.data._id === nodeB._id
    );

    if (!nodeBInLayout) {
      // 如果找不到 nodeB，回退到简单布局
      return this.calculateSimplePreviewLayout(
        newNodeData,
        nodeA,
        direction === 'aToB' ? 'contains' : 'extends',
        currentLayout,
        nodeAPosition
      );
    }

    const nodeBPosition = { x: nodeBInLayout.x, y: nodeBInLayout.y };

    // 计算新节点位置（在 A 和 B 中间）
    const midX = (nodeAPosition.x + nodeBPosition.x) / 2;
    const midY = (nodeAPosition.y + nodeBPosition.y) / 2;

    // 稍微偏移以避免完全重叠
    const dx = nodeBPosition.x - nodeAPosition.x;
    const dy = nodeBPosition.y - nodeAPosition.y;
    const perpX = -dy * 0.15; // 垂直偏移
    const perpY = dx * 0.15;

    const previewX = midX + perpX;
    const previewY = midY + perpY;

    // 设置预览节点
    result.previewNode = {
      x: previewX,
      y: previewY,
      radius: 45,
      scale: 1,
      opacity: 0.75,
      label: newNodeData.name || '新节点',
      subLabel: '',
      visible: true
    };

    // 获取节点 ID
    const nodeALayoutNode = currentLayout.nodes.find(n => n.data && n.data._id === nodeA._id);
    const nodeAId = nodeALayoutNode?.id;
    const nodeBId = nodeBInLayout.id;

    if (!nodeAId || !nodeBId) {
      return result;
    }

    // 确定连线方向和颜色
    // aToB: 新节点是 A 的子域，B 的母域
    // bToA: 新节点是 B 的子域，A 的母域
    const parentLineColor = [0.06, 0.73, 0.51, 0.8]; // 绿色
    const childLineColor = [0.98, 0.75, 0.14, 0.8];  // 黄色

    if (direction === 'aToB') {
      // 新节点是 A 的子域 -> A 到新节点用黄线
      // 新节点是 B 的母域 -> 新节点到 B 用绿线
      result.previewLines.push({
        from: nodeAId,
        to: 'preview-new-node',
        color: childLineColor,
        isDashed: true,
        isNew: true
      });
      result.previewLines.push({
        from: 'preview-new-node',
        to: nodeBId,
        color: parentLineColor,
        isDashed: true,
        isNew: true
      });
    } else {
      // 新节点是 B 的子域 -> B 到新节点用黄线
      // 新节点是 A 的母域 -> 新节点到 A 用绿线
      result.previewLines.push({
        from: nodeBId,
        to: 'preview-new-node',
        color: childLineColor,
        isDashed: true,
        isNew: true
      });
      result.previewLines.push({
        from: 'preview-new-node',
        to: nodeAId,
        color: parentLineColor,
        isDashed: true,
        isNew: true
      });
    }

    // 标记原有的 A-B 连线为移除状态
    const existingLine = currentLayout.lines.find(
      l => (l.from === nodeAId && l.to === nodeBId) || (l.from === nodeBId && l.to === nodeAId)
    );

    if (existingLine) {
      result.previewLines.push({
        from: existingLine.from,
        to: existingLine.to,
        color: existingLine.color,
        isRemoved: true
      });
    }

    // 计算需要移动的节点（为新节点腾出空间）
    // 将中间区域的节点稍微外移
    const pushDistance = 30;
    for (const node of currentLayout.nodes) {
      if (node.id === nodeAId || node.id === nodeBId) continue;
      if (!node.visible) continue;

      const distToPreview = Math.sqrt(
        Math.pow(node.x - previewX, 2) + Math.pow(node.y - previewY, 2)
      );

      // 如果节点太靠近预览位置，将其推开
      if (distToPreview < 100) {
        const angle = Math.atan2(node.y - previewY, node.x - previewX);
        result.movements.push({
          id: node.id,
          x: node.x + Math.cos(angle) * pushDistance,
          y: node.y + Math.sin(angle) * pushDistance
        });
      }
    }

    return result;
  }

  /**
   * 获取节点的候选关联节点（用于插入选择）
   * @param {Object} nodeA - 选中的节点A
   * @returns {Object} { parents: [], children: [] }
   */
  getCandidateNodesForInsertion(nodeA) {
    // 返回 nodeA 的母域和子域节点
    return {
      parents: nodeA.parentNodesInfo || [],
      children: nodeA.childNodesInfo || []
    };
  }
}

export default LayoutManager;
