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
}

export default LayoutManager;
