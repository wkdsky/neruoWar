# 知识锦功能优化实施计划

更新时间：2026-07-03

## 概述

本文档描述为知识锦添加三个优化功能的完整实施计划：
1. **全文搜索** - 快速搜索节点标题和内容
2. **快捷键支持** - 提升操作效率
3. **缩略图导航** - 快速定位和导航

---

## 一、文件结构

```
frontend/src/components/knowledgeBrocade/
├── KnowledgeBrocadeWorkspacePage.js    # 主工作区（修改）
├── KnowledgeBrocadeWorkspacePage.css   # 样式文件（修改）
├── KnowledgeBrocadeSearchModal.js      # 搜索弹窗组件（新增）
├── KnowledgeBrocadeMiniMap.js          # 缩略图组件（新增）
└── KnowledgeBrocadeShortcutsModal.js  # 快捷键帮助弹窗（新增）
```

---

## 二、全文搜索功能

### 2.1 功能描述

- 用户可通过工具栏按钮或 `Ctrl+F` 打开搜索
- 支持搜索节点标题和内容
- 实时显示搜索结果列表
- 点击结果可跳转到对应节点并居中显示
- 支持 Escape 关闭搜索

### 2.2 组件设计

**搜索弹窗 (`KnowledgeBrocadeSearchModal.js`)**

```
┌─────────────────────────────────────┐
│ 🔍 [搜索节点...]              ✕    │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 📄 线性代数                    │ │
│ │   复习笔记的第三章...          │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 📄 高等数学                    │ │
│ │   极限与连续...                │ │
│ └─────────────────────────────────┘ │
│                                     │
│ 按 ↑↓ 选择，Enter 跳转             │
└─────────────────────────────────────┘
```

### 2.3 搜索算法

```javascript
// 搜索逻辑
const performSearch = (query, nodes) => {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  return nodes
    .map(node => {
      const titleMatch = node.title?.toLowerCase().includes(lowerQuery);
      const contentMatch = node.contentText?.toLowerCase().includes(lowerQuery);

      if (!titleMatch && !contentMatch) return null;

      // 计算匹配分数用于排序
      let score = 0;
      if (titleMatch) score += 10;
      if (node.title?.toLowerCase().startsWith(lowerQuery)) score += 5;
      if (contentMatch) score += 3;

      return { ...node, searchScore: score };
    })
    .filter(Boolean)
    .sort((a, b) => b.searchScore - a.searchScore);
};
```

### 2.4 状态定义

```javascript
// 新增状态
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState([]);
const [searchActiveIndex, setSearchActiveIndex] = useState(0);
```

### 2.5 样式变量

```css
.jinzhi-search-modal-backdrop { /* 复用 outline-modal */ }
.jinzhi-search-modal { width: min(520px, 100%); }
.jinzhi-search-input-wrapper { /* 输入框容器 */ }
.jinzhi-search-input { /* 输入框样式 */ }
.jinzhi-search-result-item { /* 结果项 */ }
.jinzhi-search-result-item.is-active { /* 高亮选中项 */ }
.jinzhi-search-highlight { /* 匹配高亮 */ }
```

---

## 三、快捷键支持

### 3.1 快捷键定义

| 快捷键 | 功能 | 条件 |
|--------|------|------|
| `Ctrl/Cmd + F` | 打开搜索 | 全局 |
| `Ctrl/Cmd + Z` | 撤销 | 全局（编辑器外） |
| `Ctrl/Cmd + Shift+Z` / `Ctrl+Y` | 重做 | 全局（编辑器外） |
| `Tab` / `Enter` | 添加子节点 | 选中节点时 |
| `E` | 编辑节点 | 选中节点时 |
| `Delete` | 删除节点 | 选中节点时（非根节点） |
| `Space` | 折叠/展开节点 | 选中节点时有子节点 |
| `Escape` | 关闭弹窗/取消选择 | 全局 |
| `↑↓←→` | 选择相邻节点 | 图谱内导航 |

### 3.2 实现方式

```javascript
useEffect(() => {
  const handleKeyDown = (event) => {
    // 忽略编辑器内的按键
    if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') {
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdKey = isMac ? event.metaKey : event.ctrlKey;

    // Ctrl/Cmd + F: 打开搜索
    if (cmdKey && event.key === 'f') {
      event.preventDefault();
      setSearchOpen(true);
      return;
    }

    // ... 其他快捷键
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [依赖项]);
```

### 3.3 快捷键帮助弹窗

显示所有可用快捷键，用户可通过工具栏按钮打开。

---

## 四、缩略图导航

### 4.1 功能描述

- 右下角显示整个图谱的缩略图
- 灰色方块表示节点位置
- 蓝色半透明矩形表示当前视口
- 点击缩略图任意位置可快速跳转到对应位置
- 拖拽视口框也可导航

### 4.2 布局设计

```
┌─────────────────────────────────────────┐
│                                         │
│              主画布区域                   │
│                                         │
│                                         │
│                        ┌──────────┐     │
│                        │  ┌────┐  │     │
│                        │  │视图│  │     │
│                        │  └────┘  │     │
│                        └──────────┘     │
└─────────────────────────────────────────┘
```

### 4.3 组件实现

**MiniMap 组件 (`KnowledgeBrocadeMiniMap.js`)**

```javascript
const KnowledgeBrocadeMiniMap = ({
  nodes,
  canvasMetrics,
  viewportSize,
  zoom,
  scrollRef
}) => {
  const MINIMAP_WIDTH = 180;
  const MINIMAP_HEIGHT = 120;
  const PADDING = 8;

  const scale = Math.min(
    (MINIMAP_WIDTH - PADDING * 2) / canvasMetrics.width,
    (MINIMAP_HEIGHT - PADDING * 2) / canvasMetrics.height
  );

  // ... 计算视口位置和节点位置

  return (
    <div className="jinzhi-minimap" onClick={handleMiniMapClick}>
      {/* 节点 */}
      {nodes.map(node => (
        <div key={node._id} className="jinzhi-minimap__node" />
      ))}
      {/* 视口指示器 */}
      <div className="jinzhi-minimap__viewport" />
    </div>
  );
};
```

### 4.4 样式变量

```css
.jinzhi-minimap {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  z-index: 5;
  border-radius: 12px;
  background: var(--jinzhi-panel-bg);
  backdrop-filter: blur(12px);
}

.jinzhi-minimap__node {
  position: absolute;
  border-radius: 2px;
  background: var(--jinzhi-node-border);
  opacity: 0.6;
}

.jinzhi-minimap__viewport {
  position: absolute;
  border: 1.5px solid rgba(103, 232, 249, 0.6);
  border-radius: 2px;
  background: rgba(103, 232, 249, 0.08);
}
```

---

## 五、实施步骤

### 步骤 1: 准备工作 ✅

- [x] 导入新的 lucide-react 图标：`Search`, `Keyboard`, `Map`
- [x] 在主组件中添加新状态

### 步骤 2: 实现缩略图导航 ✅

- [x] 创建 `KnowledgeBrocadeMiniMap.js` 组件
- [x] 在 CSS 中添加缩略图样式
- [x] 在主组件中集成缩略图
- [x] 测试缩略图交互

### 步骤 3: 实现全文搜索 ✅

- [x] 创建 `KnowledgeBrocadeSearchModal.js` 组件
- [x] 在 CSS 中添加搜索弹窗样式
- [x] 实现搜索逻辑
- [x] 在主组件中集成搜索
- [x] 测试搜索功能

### 步骤 4: 实现快捷键支持 ✅

- [x] 创建 `KnowledgeBrocadeShortcutsModal.js` 组件
- [x] 在 CSS 中添加快捷键帮助弹窗样式
- [x] 实现键盘事件监听
- [x] 绑定快捷键到对应功能
- [x] 测试所有快捷键

### 步骤 5: 集成测试 🔄

- [ ] 测试三个功能之间的交互
- [ ] 测试 Escape 关闭逻辑
- [ ] 测试主题切换（亮/暗色）
- [ ] 测试响应式布局

---

## 六、样式设计规范

### 6.1 设计原则

- 复用现有 CSS 变量系统 (`--jinzhi-*`)
- 保持与现有弹窗（OutlineModal、TextPreviewModal）一致的视觉风格
- 圆角 22px，呼应现有设计
- 使用 backdrop-filter 实现毛玻璃效果

### 6.2 颜色方案

暗色主题（默认）：
- 背景：`--jinzhi-modal-bg` = `rgba(8, 15, 28, 0.98)`
- 边框：`--jinzhi-panel-border` = `rgba(148, 163, 184, 0.18)`
- 文字：`--jinzhi-modal-text` = `#e2e8f0`
- 高亮：`--jinzhi-eyebrow-color` = `rgba(134, 239, 172, 0.88)`

亮色主题：
- 背景：`--jinzhi-modal-bg` = `rgba(255, 255, 255, 0.96)`
- 边框：`--jinzhi-panel-border` = `rgba(148, 163, 184, 0.28)`
- 文字：`--jinzhi-modal-text` = `#17324d`
- 高亮：`--jinzhi-eyebrow-color` = `rgba(14, 116, 144, 0.9)`

---

## 七、注意事项

1. **编辑器冲突**：快捷键监听时需忽略 textarea/input 内的按键
2. **性能优化**：搜索使用防抖，缩略图使用 useMemo 缓存计算
3. **无障碍**：所有交互元素添加 aria-label
4. **移动端**：缩略图在小屏幕上可折叠或隐藏

---

## 八、预期效果

- 用户按 `Ctrl+F` 可快速搜索节点
- 用户按 `Tab` 可快速添加子节点
- 用户可在右下角缩略图快速定位
- 所有快捷键在工具栏有提示
- 功能完全兼容现有的亮/暗色主题
