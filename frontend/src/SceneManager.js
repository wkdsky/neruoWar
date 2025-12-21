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

    this.currentScene = null;  // 'home' | 'nodeDetail'
    this.currentLayout = { nodes: [], lines: [] };

    // 回调函数
    this.onNodeClick = null;
    this.onSceneChange = null;

    // 预览模式状态
    this.isInPreviewMode = false;
    this.previewConfig = null;

    // 绑定点击事件
    this.renderer.onClick = (node) => {
      if (this.onNodeClick) {
        this.onNodeClick(node);
      }
    };
  }

  /**
   * 显示首页场景
   */
  async showHome(rootNodes, featuredNodes, searchResults = []) {
    console.log('showHome called:', {
      rootCount: rootNodes?.length,
      featuredCount: featuredNodes?.length,
      searchCount: searchResults?.length
    });

    const newLayout = this.layout.calculateHomeLayout(rootNodes, featuredNodes, searchResults);

    console.log('Home layout:', {
      nodeCount: newLayout.nodes.length,
      lineCount: newLayout.lines.length
    });

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
  async showNodeDetail(centerNode, parentNodes, childNodes, clickedNode = null) {
    console.log('showNodeDetail called:', {
      centerNode: centerNode?.name,
      parentCount: parentNodes?.length,
      childCount: childNodes?.length,
      hasClickedNode: !!clickedNode
    });

    const newLayout = this.layout.calculateNodeDetailLayout(centerNode, parentNodes, childNodes);

    console.log('New layout:', {
      nodeCount: newLayout.nodes.length,
      lineCount: newLayout.lines.length,
      nodes: newLayout.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y }))
    });

    // 如果当前场景没有节点或者是第一次加载，直接设置布局
    if (this.currentLayout.nodes.length === 0 || this.currentScene === null) {
      console.log('First load, setting layout directly');
      this.setLayout(newLayout);
      this.currentScene = 'nodeDetail';
      if (this.onSceneChange) {
        this.onSceneChange('nodeDetail', centerNode);
      }
      return;
    }

    if (this.currentScene === 'home' && clickedNode) {
      // 从首页点击节点：特殊过渡动画
      console.log('Transition from home with clicked node');
      await this.clickTransition(clickedNode, newLayout);
    } else if (this.currentScene === 'nodeDetail') {
      // 节点详情之间切换
      console.log('Transition between node details');
      await this.nodeToNodeTransition(clickedNode, newLayout);
    } else {
      // 其他情况：直接设置布局
      console.log('Other case, setting layout directly');
      this.setLayout(newLayout);
    }

    this.currentScene = 'nodeDetail';

    if (this.onSceneChange) {
      this.onSceneChange('nodeDetail', centerNode);
    }
  }

  /**
   * 直接设置布局 (无动画)
   */
  setLayout(layout) {
    console.log('setLayout called with', layout.nodes.length, 'nodes');
    this.renderer.clearNodes();

    for (const nodeConfig of layout.nodes) {
      this.renderer.setNode(nodeConfig.id, nodeConfig);
    }

    this.renderer.setLines(layout.lines);
    this.renderer.render();

    console.log('Layout set, renderer has', this.renderer.nodes.size, 'nodes');
    this.currentLayout = layout;
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
