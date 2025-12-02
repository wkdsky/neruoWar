import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import './NavigationTreeModal.css';

const NavigationTreeModal = ({ 
    isOpen, 
    onClose, 
    navigationPaths, 
    currentNode,
    onNavigate,
    onHome 
}) => {
    const treeCanvasRef = useRef(null);

    // 绘制导航树Canvas
    useEffect(() => {
        if (!isOpen || !treeCanvasRef.current || !navigationPaths || navigationPaths.length === 0) return;

        const canvas = treeCanvasRef.current;
        const ctx = canvas.getContext('2d');

        // 构建树结构
        const buildTree = () => {
            const tree = { id: 'home', name: '首页', children: [], parentIds: [] };
            const nodeMap = new Map([['home', tree]]);

            navigationPaths.forEach(path => {
                let parentId = 'home';

                path.forEach(node => {
                    if (!nodeMap.has(node._id)) {
                        const treeNode = {
                            id: node._id,
                            name: node.name,
                            children: [],
                            parentIds: [parentId]
                        };
                        nodeMap.set(node._id, treeNode);
                        nodeMap.get(parentId).children.push(treeNode);
                    } else {
                        // 节点已存在，添加额外的父节点引用
                        const existingNode = nodeMap.get(node._id);
                        if (!existingNode.parentIds.includes(parentId)) {
                            existingNode.parentIds.push(parentId);
                        }
                    }
                    parentId = node._id;
                });
            });

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
                    parentIds: node.parentIds
                });
            });
        });

        // 存储节点位置用于点击检测
        canvas._nodePositions = nodePositions;

        // 清空画布
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
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
            const isActive = nodePos.id === currentNode?._id;
            const isHome = nodePos.id === 'home';

            // 节点背景
            if (isHome) {
                const gradient = ctx.createLinearGradient(
                    nodePos.x - nodeWidth / 2, nodePos.y,
                    nodePos.x + nodeWidth / 2, nodePos.y
                );
                gradient.addColorStop(0, '#7c3aed');
                gradient.addColorStop(1, '#a855f7');
                ctx.fillStyle = gradient;
            } else if (isActive) {
                ctx.fillStyle = 'rgba(168, 85, 247, 0.6)';
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
            ctx.strokeStyle = isActive ? '#a855f7' : 'rgba(168, 85, 247, 0.5)';
            ctx.lineWidth = isActive ? 3 : 2;
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

    }, [isOpen, navigationPaths, currentNode]);

    const handleCanvasClick = (e) => {
        const canvas = treeCanvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        // 检查点击了哪个节点
        const nodePositions = canvas._nodePositions || [];
        for (const nodePos of nodePositions) {
            const dx = x - nodePos.x;
            const dy = y - nodePos.y;
            if (Math.abs(dx) <= nodePos.width / 2 && Math.abs(dy) <= nodePos.height / 2) {
                if (nodePos.id === 'home') {
                    onHome();
                } else {
                    onNavigate(nodePos.id);
                }
                onClose();
                break;
            }
        }
    };

    if (!isOpen || !navigationPaths || navigationPaths.length === 0) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content navigation-tree-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>完整导航路径</h2>
                    <button
                        className="btn-close"
                        onClick={onClose}
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="navigation-tree-canvas-container">
                        <canvas
                            ref={treeCanvasRef}
                            className="navigation-tree-canvas"
                            onClick={handleCanvasClick}
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        className="btn btn-secondary"
                        onClick={onClose}
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NavigationTreeModal;
