import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, MapPin, Eye, LogOut } from 'lucide-react';

const LocationSelectionModal = ({ onConfirm, featuredNodes = [], onClose, username, onLogout }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const [showLocationTree, setShowLocationTree] = useState(false);
    const [locationTreeData, setLocationTreeData] = useState(null);
    const treeCanvasRef = useRef(null);

    // 搜索节点
    const performSearch = useCallback(async (query) => {
        if (!query || query.trim() === '') {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/public/search?query=${encodeURIComponent(query)}`);
            if (response.ok) {
                const data = await response.json();
                setSearchResults(data.results);
            }
        } catch (error) {
            console.error('搜索失败:', error);
        } finally {
            setIsSearching(false);
        }
    }, []);

    // 防抖搜索
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            performSearch(searchQuery);
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [searchQuery, performSearch]);

    // 选择节点
    const handleSelectNode = (node) => {
        setSelectedNode(node);
        setShowLocationTree(false);
    };

    // 获取节点的完整路径和子节点
    const fetchLocationTree = async (nodeId) => {
        try {
            // 使用公开API端点，所有用户都可以访问
            const response = await fetch('http://localhost:5000/api/nodes/public/all-nodes');

            if (!response.ok) return null;

            const data = await response.json();
            const allNodes = data.nodes || [];

            // 创建节点映射
            const nodeMap = new Map();
            allNodes.forEach(node => {
                nodeMap.set(node._id, node);
            });

            // 递归查找所有到根节点的路径
            const findPaths = (currentNodeId, visited = new Set()) => {
                if (visited.has(currentNodeId)) return [];

                const currentNode = nodeMap.get(currentNodeId);
                if (!currentNode) return [];

                visited.add(currentNodeId);

                const parentDomains = currentNode.relatedParentDomains || [];

                if (parentDomains.length === 0) {
                    return [[currentNode]];
                }

                const allPaths = [];
                for (const parentName of parentDomains) {
                    const parentNode = Array.from(nodeMap.values()).find(n => n.name === parentName);
                    if (parentNode) {
                        const parentPaths = findPaths(parentNode._id, new Set(visited));
                        parentPaths.forEach(path => {
                            allPaths.push([...path, currentNode]);
                        });
                    }
                }

                return allPaths;
            };

            // 获取当前节点的子节点
            const currentNode = nodeMap.get(nodeId);
            const childNodes = [];
            if (currentNode && currentNode.relatedChildDomains) {
                currentNode.relatedChildDomains.forEach(childName => {
                    const childNode = Array.from(nodeMap.values()).find(n => n.name === childName);
                    if (childNode) {
                        childNodes.push(childNode);
                    }
                });
            }

            const paths = findPaths(nodeId);

            return {
                paths,
                currentNode,
                childNodes
            };
        } catch (error) {
            console.error('获取位置树失败:', error);
            return null;
        }
    };

    // 查看方位
    const handleViewLocation = async () => {
        if (!selectedNode) return;

        const treeData = await fetchLocationTree(selectedNode._id);
        if (treeData) {
            setLocationTreeData(treeData);
            setShowLocationTree(true);
        }
    };

    // 绘制位置树
    useEffect(() => {
        if (!showLocationTree || !treeCanvasRef.current || !locationTreeData) return;

        const canvas = treeCanvasRef.current;
        const ctx = canvas.getContext('2d');
        const { paths, currentNode, childNodes } = locationTreeData;

        // 构建树结构，包含子节点
        const buildTree = () => {
            const tree = { id: 'home', name: '首页', children: [], parentIds: [], isHome: true };
            const nodeMap = new Map([['home', tree]]);

            // 添加路径中的节点
            paths.forEach(path => {
                let parentId = 'home';

                path.forEach(node => {
                    if (!nodeMap.has(node._id)) {
                        const treeNode = {
                            id: node._id,
                            name: node.name,
                            children: [],
                            parentIds: [parentId],
                            isSelected: node._id === currentNode?._id
                        };
                        nodeMap.set(node._id, treeNode);
                        nodeMap.get(parentId).children.push(treeNode);
                    } else {
                        const existingNode = nodeMap.get(node._id);
                        if (!existingNode.parentIds.includes(parentId)) {
                            existingNode.parentIds.push(parentId);
                        }
                    }
                    parentId = node._id;
                });
            });

            // 添加子节点（多显示一层）
            if (currentNode && childNodes.length > 0) {
                const selectedTreeNode = nodeMap.get(currentNode._id);
                if (selectedTreeNode) {
                    childNodes.forEach(child => {
                        if (!nodeMap.has(child._id)) {
                            const childTreeNode = {
                                id: child._id,
                                name: child.name,
                                children: [],
                                parentIds: [currentNode._id],
                                isChild: true
                            };
                            nodeMap.set(child._id, childTreeNode);
                            selectedTreeNode.children.push(childTreeNode);
                        }
                    });
                }
            }

            return { tree, nodeMap };
        };

        const { tree } = buildTree();

        // 按层级收集节点
        const levels = [];
        const visited = new Set();
        let currentLevel = [tree];

        while (currentLevel.length > 0) {
            levels.push(currentLevel);
            currentLevel.forEach(n => visited.add(n.id));

            const nextLevel = [];
            currentLevel.forEach(node => {
                node.children.forEach(child => {
                    if (!visited.has(child.id)) {
                        nextLevel.push(child);
                    }
                });
            });
            currentLevel = nextLevel;
        }

        // 计算Canvas尺寸
        const nodeWidth = 100;
        const nodeHeight = 36;
        const horizontalGap = 20;
        const verticalGap = 60;

        const maxNodesInLevel = Math.max(...levels.map(l => l.length));
        const canvasWidth = Math.max(600, maxNodesInLevel * (nodeWidth + horizontalGap) + 40);
        const canvasHeight = levels.length * (nodeHeight + verticalGap) + 40;

        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        // 计算节点位置
        const nodePositions = [];

        levels.forEach((level, levelIndex) => {
            const levelWidth = level.length * (nodeWidth + horizontalGap) - horizontalGap;
            const startX = (canvasWidth - levelWidth) / 2;
            const y = 20 + levelIndex * (nodeHeight + verticalGap) + nodeHeight / 2;

            level.forEach((node, nodeIndex) => {
                const x = startX + nodeIndex * (nodeWidth + horizontalGap) + nodeWidth / 2;
                nodePositions.push({
                    id: node.id,
                    name: node.name,
                    x,
                    y,
                    width: nodeWidth,
                    height: nodeHeight,
                    parentIds: node.parentIds,
                    isSelected: node.isSelected,
                    isHome: node.isHome,
                    isChild: node.isChild
                });
            });
        });

        // 存储节点位置用于点击检测
        canvas._nodePositions = nodePositions;

        // 清空画布
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // 画连线
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;

        nodePositions.forEach(nodePos => {
            nodePos.parentIds.forEach(parentId => {
                const parentPos = nodePositions.find(p => p.id === parentId);
                if (parentPos) {
                    ctx.beginPath();
                    ctx.moveTo(parentPos.x, parentPos.y + nodeHeight / 2);
                    ctx.lineTo(nodePos.x, nodePos.y - nodeHeight / 2);
                    ctx.stroke();
                }
            });
        });

        // 画节点
        nodePositions.forEach(nodePos => {
            // 节点背景
            if (nodePos.isHome) {
                const gradient = ctx.createLinearGradient(
                    nodePos.x - nodeWidth / 2, nodePos.y,
                    nodePos.x + nodeWidth / 2, nodePos.y
                );
                gradient.addColorStop(0, '#7c3aed');
                gradient.addColorStop(1, '#a855f7');
                ctx.fillStyle = gradient;
            } else if (nodePos.isSelected) {
                ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
            } else if (nodePos.isChild) {
                ctx.fillStyle = 'rgba(251, 191, 36, 0.6)';
            } else {
                ctx.fillStyle = 'rgba(51, 65, 85, 0.9)';
            }

            // 圆角矩形
            const radius = 8;
            ctx.beginPath();
            ctx.roundRect(
                nodePos.x - nodeWidth / 2,
                nodePos.y - nodeHeight / 2,
                nodeWidth,
                nodeHeight,
                radius
            );
            ctx.fill();

            // 边框
            if (nodePos.isSelected) {
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth = 3;
            } else if (nodePos.isChild) {
                ctx.strokeStyle = '#fbbf24';
                ctx.lineWidth = 2;
            } else {
                ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
                ctx.lineWidth = 2;
            }
            ctx.stroke();

            // 文字
            ctx.fillStyle = '#e9d5ff';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // 截断长文本
            let text = nodePos.name;
            if (ctx.measureText(text).width > nodeWidth - 16) {
                while (ctx.measureText(text + '...').width > nodeWidth - 16 && text.length > 0) {
                    text = text.slice(0, -1);
                }
                text += '...';
            }
            ctx.fillText(text, nodePos.x, nodePos.y);
        });

    }, [showLocationTree, locationTreeData]);

    // 处理树节点点击
    const handleTreeCanvasClick = async (e) => {
        const canvas = treeCanvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const nodePositions = canvas._nodePositions || [];
        for (const nodePos of nodePositions) {
            const dx = x - nodePos.x;
            const dy = y - nodePos.y;
            if (Math.abs(dx) <= nodePos.width / 2 && Math.abs(dy) <= nodePos.height / 2) {
                if (nodePos.id !== 'home') {
                    // 点击了一个节点，获取其完整信息并选中
                    try {
                        const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${nodePos.id}`);
                        if (response.ok) {
                            const data = await response.json();
                            setSelectedNode(data.node);
                            // 更新关系树数据
                            const treeData = await fetchLocationTree(nodePos.id);
                            if (treeData) {
                                setLocationTreeData(treeData);
                            }
                        }
                    } catch (error) {
                        console.error('获取节点详情失败:', error);
                    }
                }
                break;
            }
        }
    };

    // 确认降临
    const handleConfirm = () => {
        if (selectedNode) {
            onConfirm(selectedNode);
        }
    };

    return (
        <div className="location-selection-overlay">
            <div className="location-selection-modal">
                <div className="location-modal-header">
                    <div className="location-header-top">
                        <div className="location-user-info">
                            <span className="location-username">当前用户: {username}</span>
                        </div>
                        <button
                            onClick={onLogout}
                            className="location-logout-btn"
                            title="退出登录"
                        >
                            <LogOut size={18} />
                            退出登录
                        </button>
                    </div>
                    <h2>选择你要降临的知识域</h2>
                </div>

                <div className="location-modal-content">
                    {/* 搜索栏 */}
                    <div className="location-search-section">
                        <div className="location-search-bar">
                            <Search className="search-icon" size={24} />
                            <input
                                type="text"
                                placeholder="搜索节点...（支持多关键词，用空格分隔）"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="location-search-input"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => {
                                        setSearchQuery('');
                                        setSearchResults([]);
                                    }}
                                    className="location-search-clear"
                                >
                                    <X size={18} />
                                </button>
                            )}
                        </div>

                        {/* 搜索结果 */}
                        {searchQuery && searchResults.length > 0 && (
                            <div className="location-search-results">
                                {searchResults.map((node) => (
                                    <div
                                        key={node._id}
                                        className={`location-search-result-item ${selectedNode?._id === node._id ? 'selected' : ''}`}
                                        onClick={() => handleSelectNode(node)}
                                    >
                                        <div className="result-title">{node.name}</div>
                                        <div className="result-desc">{node.description}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {searchQuery && !isSearching && searchResults.length === 0 && (
                            <div className="location-no-results">未找到匹配的节点</div>
                        )}

                        {isSearching && (
                            <div className="location-searching">搜索中...</div>
                        )}
                    </div>

                    {/* 热门节点 */}
                    <div className="location-featured-section">
                        <h3>热门节点</h3>
                        <div className="location-featured-grid">
                            {featuredNodes.map((node) => (
                                <div
                                    key={node._id}
                                    className={`location-featured-item ${selectedNode?._id === node._id ? 'selected' : ''}`}
                                    onClick={() => handleSelectNode(node)}
                                >
                                    <div className="featured-circle">
                                        <span className="featured-name">{node.name}</span>
                                    </div>
                                </div>
                            ))}
                            {featuredNodes.length === 0 && (
                                <div className="no-featured">暂无热门节点</div>
                            )}
                        </div>
                    </div>

                    {/* 当前选择的节点 */}
                    <div className="location-selected-section">
                        <h3>当前选择</h3>
                        {selectedNode ? (
                            <div className="location-selected-node">
                                <div className="selected-node-circle">
                                    <span className="selected-node-name">{selectedNode.name}</span>
                                </div>
                                <div className="selected-node-info">
                                    <div className="selected-node-desc">{selectedNode.description}</div>
                                    <button
                                        className="btn-view-location"
                                        onClick={handleViewLocation}
                                    >
                                        <Eye size={16} />
                                        查看其方位
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="no-selection">请选择一个知识域</div>
                        )}
                    </div>
                </div>

                {/* 降临按钮 */}
                <div className="location-modal-footer">
                    <button
                        className={`btn-descend ${selectedNode ? 'active' : 'disabled'}`}
                        onClick={handleConfirm}
                        disabled={!selectedNode}
                    >
                        <MapPin size={20} />
                        降临!
                    </button>
                </div>

                {/* 位置树浮窗 */}
                {showLocationTree && locationTreeData && (
                    <div className="location-tree-overlay" onClick={() => setShowLocationTree(false)}>
                        <div className="location-tree-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="location-tree-header">
                                <h3>节点方位 - {selectedNode?.name}</h3>
                                <button
                                    className="location-tree-close"
                                    onClick={() => setShowLocationTree(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>
                            <div className="location-tree-content">
                                <div className="location-tree-legend">
                                    <span className="legend-item current">当前选择</span>
                                    <span className="legend-item child">子节点</span>
                                    <span className="legend-item path">路径节点</span>
                                </div>
                                <div className="location-tree-canvas-container">
                                    <canvas
                                        ref={treeCanvasRef}
                                        className="location-tree-canvas"
                                        onClick={handleTreeCanvasClick}
                                    />
                                </div>
                                <p className="location-tree-hint">点击任意节点可选择为新的降临位置</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LocationSelectionModal;
