/**
 * SceneManager - 场景管理器
 * 统一管理WebGL渲染器和布局切换
 */

import { WebGLNodeRenderer } from './WebGLNodeRenderer';
import LayoutManager from './LayoutManager';

class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new WebGLNodeRenderer(canvas);
    this.layout = new LayoutManager(canvas.width, canvas.height);

    this.currentScene = null;  // 'home' | 'nodeDetail' | 'titleDetail'
    this.currentLayout = { nodes: [], lines: [] };

    // 回调函数
    this.onNodeClick = null;
    this.onNodeDoubleClick = null;
    this.onSceneChange = null;
    this.onButtonClick = null; // 按钮点击回调
    this.onLineClick = null; // 连线点击回调

    // 预览模式状态
    this.isInPreviewMode = false;
    this.previewConfig = null;
    this.centerNodeButtonContext = {};

    // 绑定点击事件
    this.renderer.onClick = (node) => {
      if (this.onNodeClick) {
        this.onNodeClick(node);
      }
    };

    this.renderer.onDoubleClick = (node) => {
      if (this.onNodeDoubleClick) {
        this.onNodeDoubleClick(node);
      }
    };

    // 绑定按钮点击事件
    this.renderer.onButtonClick = (nodeId, button) => {
      if (this.onButtonClick) {
        this.onButtonClick(nodeId, button);
      }
    };
    this.renderer.onLineClick = (lineHit) => {
      if (this.onLineClick) {
        this.onLineClick(lineHit);
      }
    };
  }

  /**
   * 显示首页场景
   */
  async showHome(rootNodes, featuredNodes, searchResults = []) {
    this.renderer.setSceneType('home');

    // 清除节点按钮（首页不需要）
    this.renderer.clearNodeButtons();

    const newLayout = this.layout.calculateHomeLayout(rootNodes, featuredNodes, searchResults);

    if (this.currentScene === null) {
      // 首次加载：直接设置
      this.setLayout(newLayout);
      this.currentScene = 'home';
    } else if (this.currentScene === 'home') {
      // 已在首页：平滑过渡 (搜索切换)
      await this.transitionTo(newLayout);
    } else {
      // 从其他场景返回首页：淡出当前，淡入新场景
      await this.fadeTransition(newLayout);
      this.currentScene = 'home';
    }

    if (this.onSceneChange) {
      this.onSceneChange('home');
    }
  }

  /**
   * 显示节点详情场景
   */
  async showNodeDetail(centerNode, parentNodes, childNodes, clickedNode = null, buttonContext = {}) {
    this.renderer.setSceneType('nodeDetail');
    this.centerNodeButtonContext = buttonContext || {};

    // 清除之前的按钮
    this.renderer.clearNodeButtons();

    const newLayout = this.layout.calculateNodeDetailLayout(centerNode, parentNodes, childNodes);

    // 如果当前场景没有节点或者是第一次加载，直接设置布局
    if (this.currentLayout.nodes.length === 0 || this.currentScene === null) {
      this.setLayout(newLayout);
      this.setupCenterNodeButtons(centerNode, buttonContext);
      this.currentScene = 'nodeDetail';
      if (this.onSceneChange) {
        this.onSceneChange('nodeDetail', centerNode);
      }
      return;
    }

    if (this.currentScene === 'home' && clickedNode) {
      // 从首页点击节点：特殊过渡动画
      await this.clickTransition(clickedNode, newLayout);
    } else if (this.currentScene === 'nodeDetail') {
      // 节点详情之间切换
      await this.nodeToNodeTransition(clickedNode, newLayout);
    } else {
      // 其他情况：直接设置布局
      this.setLayout(newLayout);
    }

    // 设置中心节点的操作按钮
    this.setupCenterNodeButtons(centerNode, buttonContext);

    this.currentScene = 'nodeDetail';

    if (this.onSceneChange) {
      this.onSceneChange('nodeDetail', centerNode);
    }
  }

  /**
   * 显示标题主视角场景
   */
  async showTitleDetail(centerNode, graphNodes = [], graphEdges = [], levelByNodeId = {}, clickedNode = null, buttonContext = {}) {
    this.renderer.setSceneType('titleDetail');
    this.centerNodeButtonContext = buttonContext || {};
    this.renderer.clearNodeButtons();

    const newLayout = this.layout.calculateTitleDetailLayout(centerNode, graphNodes, graphEdges, levelByNodeId);

    if (this.currentLayout.nodes.length === 0 || this.currentScene === null) {
      this.setLayout(newLayout);
      this.setupCenterNodeButtons(centerNode, buttonContext);
      this.currentScene = 'titleDetail';
      if (this.onSceneChange) {
        this.onSceneChange('titleDetail', centerNode);
      }
      return;
    }

    if (this.currentScene === 'home' && clickedNode) {
      await this.clickTransition(clickedNode, newLayout);
    } else if (this.currentScene === 'titleDetail') {
      await this.nodeToNodeTransition(clickedNode, newLayout);
    } else {
      await this.fadeTransition(newLayout);
    }

    this.setupCenterNodeButtons(centerNode, buttonContext);
    this.currentScene = 'titleDetail';

    if (this.onSceneChange) {
      this.onSceneChange('titleDetail', centerNode);
    }
  }

  /**
   * 设置中心节点的操作按钮
   */
  setupCenterNodeButtons(centerNode, buttonContext = this.centerNodeButtonContext || {}) {
    if (!centerNode) return;

    const centerNodeId = `center-${centerNode._id}`;
    if (buttonContext?.senseDetailOnly) {
      this.renderer.setNodeButtons(centerNodeId, [{
        id: 'sense-entry',
        icon: 'i',
        angle: -Math.PI / 7,
        action: 'showSenseEntry',
        tooltip: '查看释义词条详情',
        color: [0.36, 0.74, 0.96, 0.92]
      }]);
      return;
    }
    if (buttonContext?.disableDefault) {
      this.renderer.setNodeButtons(centerNodeId, []);
      return;
    }
    const isFavorite = !!buttonContext.isFavorite;

    const buttons = [
      {
        id: 'enter-domain',
        icon: '◎',  // 使用圆圈符号表示进入
        angle: -Math.PI / 7, // 右上偏侧，避开顶部连线区域
        action: 'enterKnowledgeDomain',
        tooltip: '进入知识域',
        color: [0.3, 0.7, 0.9, 0.9]  // 柔和的青蓝色
      },
      {
        id: 'toggle-favorite',
        icon: isFavorite ? '★' : '☆',
        angle: Math.PI / 7, // 右下偏侧，避开底部连线区域
        action: 'toggleFavoriteNode',
        tooltip: isFavorite ? '取消收藏' : '收藏该知识域',
        color: [0.98, 0.80, 0.20, 0.95]
      }
    ];

    if (buttonContext.showDistributionButton) {
      buttons.push({
        id: 'join-distribution',
        icon: '✦',
        angle: -Math.PI * 0.62,
        action: 'joinDistribution',
        tooltip: '知识点分发',
        color: [0.25, 0.72, 0.95, 0.92],
        disabled: !!buttonContext.distributionDisabled
      });
    }

    if (buttonContext.showMoveButton) {
      buttons.push({
        id: 'move-to-node',
        icon: '⇦',
        angle: Math.PI, // 左侧
        action: 'moveToNode',
        tooltip: buttonContext.moveDisabled
          ? (buttonContext.moveDisabledReason || '当前不可移动')
          : '移动到该节点',
        color: buttonContext.moveDisabled
          ? [0.47, 0.55, 0.67, 0.85]
          : [0.20, 0.75, 0.40, 0.92],
        disabled: !!buttonContext.moveDisabled
      });
    }

    if (buttonContext.showIntelStealButton) {
      buttons.push({
        id: 'intel-heist',
        icon: buttonContext.intelStealHasSnapshot ? '◉' : '◌',
        angle: Math.PI * 0.62,
        action: 'intelSteal',
        tooltip: buttonContext.intelStealTooltip || '情报窃取',
        color: buttonContext.intelStealHasSnapshot
          ? [0.96, 0.58, 0.24, 0.95]
          : [0.56, 0.64, 0.78, 0.9],
        disabled: !!buttonContext.intelStealDisabled
      });
    }

    if (buttonContext.showSiegeButton) {
      buttons.push({
        id: 'siege-domain',
        icon: buttonContext.siegeActive ? '⚔' : '✦',
        angle: -Math.PI * 0.86,
        action: 'siegeDomain',
        tooltip: buttonContext.siegeTooltip || '攻占知识域',
        color: buttonContext.siegeActive
          ? [0.96, 0.38, 0.28, 0.96]
          : [0.78, 0.46, 0.26, 0.92],
        disabled: !!buttonContext.siegeDisabled
      });
    }

    this.renderer.setNodeButtons(centerNodeId, buttons);
  }

  setupSenseDetailButton(centerNode) {
    if (!centerNode?._id) return;
    const centerNodeId = `center-${centerNode._id}`;
    this.renderer.setNodeButtons(centerNodeId, [{
      id: 'sense-entry',
      icon: 'i',
      angle: -Math.PI / 7,
      action: 'showSenseEntry',
      tooltip: '查看释义词条详情',
      color: [0.36, 0.74, 0.96, 0.92]
    }]);
  }

  clearNodeButtons() {
    this.renderer.clearNodeButtons();
  }

  /**
   * 直接设置布局 (无动画)
   */
  setLayout(layout) {
    this.renderer.clearNodes();

    for (const nodeConfig of layout.nodes) {
      this.renderer.setNode(nodeConfig.id, nodeConfig);
    }

    this.renderer.setLines(layout.lines);
    this.renderer.render();
    this.currentLayout = layout;
  }

  setUserState(locationName, travelStatus) {
    this.renderer.setUserState({ locationName, travelStatus });
  }

  /**
   * 标准过渡动画
   */
  async transitionTo(newLayout, duration = 500) {
    const transitions = this.layout.calculateTransition(this.currentLayout, newLayout);

    // 阶段1: 退出的节点淡出
    if (transitions.exit.length > 0) {
      await Promise.all(
        transitions.exit.map(t =>
          this.renderer.animateNode(t.id, t.to, duration * 0.4, 'easeInCubic')
        )
      );

      // 移除已退出的节点
      transitions.exit.forEach(t => this.renderer.removeNode(t.id));
    }

    // 阶段2: 添加新节点 (初始状态)
    for (const t of transitions.enter) {
      this.renderer.setNode(t.id, t.from);
    }

    // 更新连线
    this.renderer.setLines(newLayout.lines);

    // 阶段3: 移动和进入动画
    const animations = [];

    transitions.move.forEach(t => {
      animations.push(
        this.renderer.animateNode(t.id, t.to, duration, 'easeOutCubic')
      );
    });

    transitions.enter.forEach(t => {
      animations.push(
        this.renderer.animateNode(t.id, t.to, duration * 0.6, 'easeOutBack')
      );
    });

    await Promise.all(animations);

    this.currentLayout = newLayout;

    // 所有动画完成后，强制重启渲染循环
    this.renderer.renderingLoop = false;
    this.renderer.render();
  }

  /**
   * 淡入淡出过渡
   */
  async fadeTransition(newLayout, duration = 400) {
    // 淡出当前所有节点
    const fadeOutPromises = Array.from(this.renderer.nodes.values()).map(node =>
      this.renderer.animateNode(node.id, { opacity: 0, scale: node.scale * 0.8 }, duration * 0.5, 'easeInCubic')
    );

    await Promise.all(fadeOutPromises);

    // 清空并设置新布局
    this.setLayout(newLayout);

    // 淡入新节点
    const fadeInPromises = newLayout.nodes.map(nodeConfig => {
      const node = this.renderer.nodes.get(nodeConfig.id);
      if (node) {
        node.opacity = 0;
        node.scale = nodeConfig.scale * 0.8;
        return this.renderer.animateNode(
          nodeConfig.id,
          { opacity: nodeConfig.opacity, scale: nodeConfig.scale },
          duration * 0.6,
          'easeOutCubic'
        );
      }
      return Promise.resolve();
    });

    await Promise.all(fadeInPromises);

    // 所有动画完成后，强制重启渲染循环
    this.renderer.renderingLoop = false;
    this.renderer.render();
  }

  /**
   * 点击节点过渡动画 (从首页到节点详情)
   */
  async clickTransition(clickedNode, newLayout, duration = 800) {
    const transitions = this.layout.calculateClickTransition(
      clickedNode,
      this.currentLayout,
      newLayout
    );

    // 阶段1: 其他节点淡出 (300ms)
    await Promise.all(
      transitions.exit.map(t =>
        this.renderer.animateNode(t.id, t.to, duration * 0.3, 'easeInCubic')
      )
    );

    // 移除淡出的节点
    transitions.exit.forEach(t => this.renderer.removeNode(t.id));

    // 阶段2: 被点击节点移动并放大到中心 (400ms)
    if (transitions.special) {
      const t = transitions.special;
      await this.renderer.animateNode(t.id, t.to, duration * 0.5, 'easeOutCubic');

      // 重命名节点ID (从 root-xxx 到 center-xxx)
      const centerNode = newLayout.nodes.find(n => n.type === 'center');
      if (centerNode) {
        const oldNode = this.renderer.nodes.get(t.id);
        this.renderer.removeNode(t.id);
        this.renderer.setNode(centerNode.id, {
          ...oldNode,
          ...centerNode,
          id: centerNode.id
        });
      }
    }

    // 更新连线
    this.renderer.setLines(newLayout.lines);

    // 阶段3: 母域和子域节点依次出现 (300ms，错开时间)
    const enterAnimations = transitions.enter.map((t, index) => {
      // 添加节点
      this.renderer.setNode(t.id, t.from);

      // 延迟进入
      return new Promise(resolve => {
        setTimeout(() => {
          this.renderer.animateNode(t.id, t.to, duration * 0.4, 'easeOutBack')
            .then(resolve);
        }, index * 60); // 每个节点延迟60ms
      });
    });

    await Promise.all(enterAnimations);

    this.currentLayout = newLayout;

    // 所有动画完成后，强制重启渲染循环
    this.renderer.renderingLoop = false;
    this.renderer.render();
  }

  /**
   * 节点详情之间的切换动画
   */
  async nodeToNodeTransition(clickedNode, newLayout, duration = 700) {
    if (!clickedNode) {
      await this.transitionTo(newLayout, duration);
      return;
    }

    // 找到被点击的节点（母域或子域）
    const sourceNode = this.renderer.nodes.get(clickedNode.id);
    if (!sourceNode) {
      await this.transitionTo(newLayout, duration);
      return;
    }

    const transitions = {
      exit: [],
      enter: [],
      special: null
    };

    // 中心节点和被点击节点：特殊处理
    const oldCenterNode = this.currentLayout.nodes.find(n => n.type === 'center');
    const newCenterNode = newLayout.nodes.find(n => n.type === 'center');

    // 阶段1: 旧中心节点和其他节点移开/缩小 (300ms)
    for (const [id, node] of this.renderer.nodes) {
      if (id === clickedNode.id) {
        // 被点击的节点：移动到中心并放大
        transitions.special = {
          id,
          from: { ...node },
          to: { ...newCenterNode, id }
        };
      } else {
        // 其他节点：向外移动并淡出
        const angle = Math.random() * Math.PI * 2;
        const distance = 300;
        transitions.exit.push({
          id,
          from: { ...node },
          to: {
            x: node.x + Math.cos(angle) * distance,
            y: node.y + Math.sin(angle) * distance,
            opacity: 0,
            scale: node.scale * 0.5
          }
        });
      }
    }

    // 执行退出和移动动画
    const exitAnimations = transitions.exit.map(t =>
      this.renderer.animateNode(t.id, t.to, duration * 0.4, 'easeInCubic')
    );

    let specialAnimation = Promise.resolve();
    if (transitions.special) {
      specialAnimation = this.renderer.animateNode(
        transitions.special.id,
        transitions.special.to,
        duration * 0.5,
        'easeOutCubic'
      );
    }

    await Promise.all([...exitAnimations, specialAnimation]);

    // 移除退出的节点
    transitions.exit.forEach(t => this.renderer.removeNode(t.id));

    // 重命名被点击节点为中心节点
    if (transitions.special && newCenterNode) {
      const node = this.renderer.nodes.get(transitions.special.id);
      this.renderer.removeNode(transitions.special.id);
      this.renderer.setNode(newCenterNode.id, {
        ...node,
        ...newCenterNode,
        id: newCenterNode.id,
        type: 'center'
      });
    }

    // 更新连线
    this.renderer.setLines(newLayout.lines);

    // 阶段2: 新的母域和子域节点出现 (400ms)
    const newNodes = newLayout.nodes.filter(n => n.type !== 'center');

    const enterAnimations = newNodes.map((nodeConfig, index) => {
      // 从中心位置开始
      this.renderer.setNode(nodeConfig.id, {
        ...nodeConfig,
        x: newCenterNode.x,
        y: newCenterNode.y,
        scale: 0,
        opacity: 0
      });

      // 延迟进入
      return new Promise(resolve => {
        setTimeout(() => {
          this.renderer.animateNode(nodeConfig.id, nodeConfig, duration * 0.5, 'easeOutBack')
            .then(resolve);
        }, index * 50);
      });
    });

    await Promise.all(enterAnimations);

    this.currentLayout = newLayout;

    // 所有动画完成后，强制重启渲染循环
    this.renderer.renderingLoop = false;
    this.renderer.render();
  }

  /**
   * 更新搜索结果 (仅首页)
   */
  async updateSearchResults(searchResults) {
    if (this.currentScene !== 'home') return;

    // 重新计算布局并过渡
    // 注意：需要从外部传入rootNodes和featuredNodes，这里简化处理
    const rootNodes = this.currentLayout.nodes
      .filter(n => n.type === 'root')
      .map(n => n.data);

    const featuredNodes = this.currentLayout.nodes
      .filter(n => n.type === 'featured')
      .map(n => n.data);

    const newLayout = this.layout.calculateHomeLayout(rootNodes, featuredNodes, searchResults);
    await this.transitionTo(newLayout, 400);
  }

  /**
   * 调整大小
   */
  resize(width, height) {
    this.layout.resize(width, height);
    this.renderer.resize(width, height);

    // 重新计算并应用当前布局
    if (this.currentScene === 'home' && this.currentLayout.nodes.length > 0) {
      const rootNodes = this.currentLayout.nodes
        .filter(n => n.type === 'root')
        .map(n => n.data)
        .filter(Boolean);

      const featuredNodes = this.currentLayout.nodes
        .filter(n => n.type === 'featured')
        .map(n => n.data)
        .filter(Boolean);

      const searchResults = this.currentLayout.nodes
        .filter(n => n.type === 'search')
        .map(n => n.data)
        .filter(Boolean);

      const newLayout = this.layout.calculateHomeLayout(rootNodes, featuredNodes, searchResults);
      this.setLayout(newLayout);
    } else if (this.currentScene === 'nodeDetail' && this.currentLayout.nodes.length > 0) {
      const centerNode = this.currentLayout.nodes
        .find(n => n.type === 'center')?.data;

      const parentNodes = this.currentLayout.nodes
        .filter(n => n.type === 'parent')
        .map(n => n.data)
        .filter(Boolean);

      const childNodes = this.currentLayout.nodes
        .filter(n => n.type === 'child')
        .map(n => n.data)
        .filter(Boolean);

      if (centerNode) {
        const newLayout = this.layout.calculateNodeDetailLayout(centerNode, parentNodes, childNodes);
        this.setLayout(newLayout);
      }
    } else if (this.currentScene === 'titleDetail' && this.currentLayout.nodes.length > 0) {
      const centerNode = this.currentLayout.nodes.find((n) => n.type === 'center')?.data;
      if (!centerNode) return;

      const graphNodes = this.currentLayout.nodes
        .filter((n) => n.type === 'title')
        .map((n) => n.data)
        .filter(Boolean);
      const levelByNodeId = {};
      graphNodes.forEach((node) => {
        const nodeId = String(node?._id || '');
        if (!nodeId) return;
        const level = Number(node?.graphLevel);
        levelByNodeId[nodeId] = Number.isFinite(level) && level > 0 ? level : 1;
      });
      levelByNodeId[String(centerNode._id)] = 0;

      const graphEdges = (Array.isArray(this.currentLayout.lines) ? this.currentLayout.lines : [])
        .map((line) => line?.edgeMeta)
        .filter(Boolean);
      const newLayout = this.layout.calculateTitleDetailLayout(centerNode, graphNodes, graphEdges, levelByNodeId);
      this.setLayout(newLayout);
    }
  }

  // ==================== 关联关系预览方法 ====================

  /**
   * 进入关联关系预览模式
   * @param {Object} newNodeData - 新节点数据 {name, description}
   * @param {Object} nodeA - 第一个关联节点
   * @param {string} relationType - 关系类型 'extends' | 'contains' | 'insert'
   * @param {Object} nodeB - 第二个关联节点（仅插入模式需要）
   */
  async enterAssociationPreview(newNodeData, nodeA, relationType, nodeB = null) {
    if (this.isInPreviewMode) {
      this.exitAssociationPreview();
    }

    this.isInPreviewMode = true;
    this.previewConfig = {
      newNodeData,
      nodeA,
      relationType,
      nodeB
    };

    // 进入渲染器预览模式
    this.renderer.enterPreviewMode();

    // 计算预览布局
    const previewLayout = this.layout.calculateAssociationPreviewLayout(
      newNodeData,
      nodeA,
      relationType,
      nodeB,
      this.currentLayout
    );

    // 如果需要移动现有节点，执行动画
    if (previewLayout.movements && previewLayout.movements.length > 0) {
      await this.renderer.animatePreviewLayout(previewLayout.movements, 500);
    }

    // 设置预览节点
    if (previewLayout.previewNode) {
      this.renderer.setPreviewNode('preview-new-node', previewLayout.previewNode);
    }

    // 设置预览连线
    if (previewLayout.previewLines) {
      this.renderer.setPreviewLines(previewLayout.previewLines);
    }

    return previewLayout;
  }

  /**
   * 退出关联关系预览模式（回滚所有变更）
   */
  exitAssociationPreview() {
    if (!this.isInPreviewMode) return;

    this.renderer.exitPreviewMode();
    this.isInPreviewMode = false;
    this.previewConfig = null;
  }

  /**
   * 重新播放预览动画
   */
  async replayPreview() {
    if (!this.isInPreviewMode || !this.previewConfig) return;

    const { newNodeData, nodeA, relationType, nodeB } = this.previewConfig;

    // 先退出再重新进入
    this.renderer.exitPreviewMode();

    // 短暂延迟后重新进入
    await new Promise(resolve => setTimeout(resolve, 100));

    await this.enterAssociationPreview(newNodeData, nodeA, relationType, nodeB);
  }

  /**
   * 获取当前预览配置
   */
  getPreviewConfig() {
    return this.previewConfig;
  }

  /**
   * 检查是否在预览模式
   */
  isPreviewMode() {
    return this.isInPreviewMode;
  }

  /**
   * 进入知识域动画 - 中心节点扩大并淡出，配合知识域淡入
   * @param {Function} onTransitionComplete - 过渡动画完成后的回调
   * @param {Function} onProgress - 动画进度回调 (0-1)
   */
  async enterKnowledgeDomain(onTransitionComplete, onProgress) {
    // 清除按钮（进入知识域时不需要显示）
    this.renderer.clearNodeButtons();

    const centerNode = this.currentLayout.nodes.find(n => n.type === 'center');
    if (!centerNode) {
      if (onTransitionComplete) onTransitionComplete();
      return;
    }

    const duration = 1000; // 动画时长
    const startTime = performance.now();

    // 保存初始状态
    const initialScale = centerNode.scale;
    const initialX = centerNode.x;
    const initialY = centerNode.y;
    const initialOpacity = 1;

    // 计算目标状态 - 节点需要扩大到覆盖整个画布
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const maxDimension = Math.max(canvasWidth, canvasHeight);
    const targetScale = (maxDimension / (centerNode.radius * 2)) * 1.5;
    const targetX = canvasWidth / 2;
    const targetY = canvasHeight / 2;

    // 其他节点淡出
    const otherNodes = this.currentLayout.nodes.filter(n => n.type !== 'center');
    otherNodes.forEach(n => {
      this.renderer.animateNode(n.id, { opacity: 0, scale: n.scale * 0.5 }, duration * 0.3, 'easeInCubic');
    });

    // 中心节点扩大并淡出动画
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // 使用easeInOutCubic缓动
      const easedProgress = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      // 更新中心节点
      const node = this.renderer.nodes.get(centerNode.id);
      if (node) {
        node.scale = initialScale + (targetScale - initialScale) * easedProgress;
        node.x = initialX + (targetX - initialX) * easedProgress;
        node.y = initialY + (targetY - initialY) * easedProgress;
        // 后半段开始淡出
        const fadeProgress = Math.max(0, (progress - 0.4) / 0.6);
        node.opacity = initialOpacity * (1 - fadeProgress);
        node.glowIntensity = 0.5 + easedProgress * 0.3 - fadeProgress * 0.5;
      }

      // 通知进度
      if (onProgress) {
        onProgress(progress);
      }

      this.renderer.render();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // 动画完成，清理节点
        otherNodes.forEach(n => this.renderer.removeNode(n.id));
        if (onTransitionComplete) {
          onTransitionComplete();
        }
      }
    };

    animate();
  }

  /**
   * 从知识域返回 - 反向动画：知识域淡出，节点从大到小淡入
   * @param {Function} onTransitionStart - 开始恢复场景的回调
   * @param {Function} onProgress - 动画进度回调 (0-1)
   * @param {Function} onTransitionComplete - 过渡动画完成后的回调
   */
  async exitKnowledgeDomain(onTransitionStart, onProgress, onTransitionComplete) {
    // 首先通知开始恢复，让知识域开始淡出
    if (onTransitionStart) {
      onTransitionStart();
    }

    const duration = 1000;
    const startTime = performance.now();

    // 计算初始状态（从放大状态开始）
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const maxDimension = Math.max(canvasWidth, canvasHeight);

    // 获取当前节点详情的中心节点配置
    const centerNodeConfig = this.currentLayout.nodes.find(n => n.type === 'center');
    if (!centerNodeConfig) {
      if (onTransitionComplete) onTransitionComplete();
      return;
    }

    const targetScale = centerNodeConfig.scale;
    const targetX = centerNodeConfig.x;
    const targetY = centerNodeConfig.y;
    const initialScale = (maxDimension / (centerNodeConfig.radius * 2)) * 1.5;
    const initialX = canvasWidth / 2;
    const initialY = canvasHeight / 2;

    // 先设置中心节点为放大状态
    this.renderer.setNode(centerNodeConfig.id, {
      ...centerNodeConfig,
      x: initialX,
      y: initialY,
      scale: initialScale,
      opacity: 0
    });

    // 反向动画：节点从大到小，从透明到可见
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // 使用easeInOutCubic缓动
      const easedProgress = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      // 更新中心节点
      const node = this.renderer.nodes.get(centerNodeConfig.id);
      if (node) {
        node.scale = initialScale + (targetScale - initialScale) * easedProgress;
        node.x = initialX + (targetX - initialX) * easedProgress;
        node.y = initialY + (targetY - initialY) * easedProgress;
        // 前半段淡入
        const fadeProgress = Math.min(1, progress / 0.6);
        node.opacity = fadeProgress;
        node.glowIntensity = 0.3 + fadeProgress * 0.2;
      }

      // 通知进度（反向，1到0）
      if (onProgress) {
        onProgress(1 - progress);
      }

      this.renderer.render();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // 动画完成，恢复其他节点
        const otherNodes = this.currentLayout.nodes.filter(n => n.type !== 'center');
        otherNodes.forEach((nodeConfig, index) => {
          this.renderer.setNode(nodeConfig.id, {
            ...nodeConfig,
            opacity: 0,
            scale: 0
          });
          // 延迟进入动画
          setTimeout(() => {
            this.renderer.animateNode(nodeConfig.id, nodeConfig, 400, 'easeOutBack');
          }, index * 50);
        });

        // 更新连线
        this.renderer.setLines(this.currentLayout.lines);

        // 重新设置中心节点的按钮
        if (centerNodeConfig.data) {
          this.setupCenterNodeButtons(centerNodeConfig.data);
        }

        // 确保渲染循环正常运行
        this.renderer.renderingLoop = false;
        this.renderer.render();

        if (onTransitionComplete) {
          setTimeout(onTransitionComplete, 400 + otherNodes.length * 50);
        }
      }
    };

    animate();
  }

  /**
   * 显示简单关联预览（新节点直接作为 nodeA 的母域或子域）
   * @param {Object} newNodeData - 新节点数据
   * @param {Object} nodeA - 关联节点A的完整数据（包括 parentNodesInfo, childNodesInfo）
   * @param {string} relationType - 'extends' 或 'contains'
   */
  async showSimpleAssociationPreview(newNodeData, nodeA, relationType) {
    return this.enterAssociationPreview(newNodeData, nodeA, relationType, null);
  }

  /**
   * 显示插入预览（新节点插入到 nodeA 和 nodeB 之间）
   * @param {Object} newNodeData - 新节点数据
   * @param {Object} nodeA - 关联节点A
   * @param {Object} nodeB - 关联节点B
   * @param {string} insertDirection - 插入方向 'aToB' (新节点在A-B之间，新作为A的子、B的父) 或 'bToA'
   */
  async showInsertAssociationPreview(newNodeData, nodeA, nodeB, insertDirection) {
    return this.enterAssociationPreview(newNodeData, nodeA, 'insert', {
      node: nodeB,
      direction: insertDirection
    });
  }

  /**
   * 为单个节点生成预览场景（用于在创建节点模态框中显示）
   * 这个方法会在指定的 canvas 上创建一个小型预览场景
   */
  createMiniPreviewScene(nodeA, relationType, newNodeName) {
    // 计算一个简化的预览布局
    const centerX = this.layout.centerX;
    const centerY = this.layout.centerY;
    const distance = 150;

    let previewNodePosition;
    let lineColor;

    if (relationType === 'extends') {
      // 新节点作为 nodeA 的母域 -> 新节点在上方
      previewNodePosition = {
        x: centerX,
        y: centerY - distance
      };
      lineColor = [0.06, 0.73, 0.51, 0.8]; // 绿色
    } else {
      // 新节点作为 nodeA 的子域 -> 新节点在下方
      previewNodePosition = {
        x: centerX,
        y: centerY + distance
      };
      lineColor = [0.98, 0.75, 0.14, 0.8]; // 黄色
    }

    return {
      centerNode: {
        x: centerX,
        y: centerY,
        label: nodeA.name || 'Node A'
      },
      previewNode: {
        ...previewNodePosition,
        label: newNodeName || '新节点'
      },
      lineColor
    };
  }

  /**
   * 销毁
   */
  destroy() {
    // 确保退出预览模式
    if (this.isInPreviewMode) {
      this.exitAssociationPreview();
    }
    this.renderer.destroy();
  }
}

export default SceneManager;
