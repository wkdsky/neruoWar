import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Check, ArrowRight, ArrowLeft, RotateCcw, Plus, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import MiniPreviewRenderer from './MiniPreviewRenderer';
import './CreateNodeModal.css';

// 关联关系编辑步骤
const STEPS = {
  SELECT_NODE_A: 'select_node_a',
  SELECT_RELATION: 'select_relation',
  SELECT_NODE_B: 'select_node_b',
  PREVIEW: 'preview'
};

// 关系类型
const RELATION_TYPES = {
  EXTENDS: 'extends',
  CONTAINS: 'contains',
  INSERT: 'insert'
};

const CreateNodeModal = ({
    isOpen,
    onClose,
    username,
    isAdmin,
    existingNodes,
    onSuccess
}) => {
    // 基本信息状态
    const [newNodeData, setNewNodeData] = useState({
        title: '',
        description: ''
    });

    // 搜索状态
    const [searchKeyword, setSearchKeyword] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);

    // 关联关系编辑状态机
    const [currentStep, setCurrentStep] = useState(null);
    const [selectedNodeA, setSelectedNodeA] = useState(null);
    const [selectedRelationType, setSelectedRelationType] = useState(null);
    const [selectedNodeB, setSelectedNodeB] = useState(null);
    const [insertDirection, setInsertDirection] = useState(null);

    // Node B 候选节点
    const [nodeBCandidates, setNodeBCandidates] = useState({ parents: [], children: [] });
    const [nodeBSearchKeyword, setNodeBSearchKeyword] = useState('');

    // 已确认的关联关系列表
    const [associations, setAssociations] = useState([]);

    // 展开/折叠关联关系列表
    const [isAssociationListExpanded, setIsAssociationListExpanded] = useState(true);

    // 当前正在编辑的关联索引
    const [editingAssociationIndex, setEditingAssociationIndex] = useState(null);

    // 预览画布引用
    const previewCanvasRef = useRef(null);
    const previewRendererRef = useRef(null);

    // 管理员同名申请冲突状态
    const [showPendingConflict, setShowPendingConflict] = useState(false);
    const [conflictingPendingNodes, setConflictingPendingNodes] = useState([]);
    const [pendingApprovalLoading, setPendingApprovalLoading] = useState(false);

    // 重置关联关系编辑状态
    const resetAssociationEdit = useCallback(() => {
        setCurrentStep(null);
        setSelectedNodeA(null);
        setSelectedRelationType(null);
        setSelectedNodeB(null);
        setInsertDirection(null);
        setNodeBCandidates({ parents: [], children: [] });
        setNodeBSearchKeyword('');
        setEditingAssociationIndex(null);
        setSearchKeyword('');
        setSearchResults([]);

        // 销毁预览渲染器
        if (previewRendererRef.current) {
            previewRendererRef.current.destroy();
            previewRendererRef.current = null;
        }
    }, []);

    // 模态框打开时重置所有状态（确保每次打开都是干净的状态）
    useEffect(() => {
        if (isOpen) {
            // 打开时重置，确保不同的新节点创建会话互不干扰
            setNewNodeData({ title: '', description: '' });
            setAssociations([]);
            resetAssociationEdit();
            // 重置冲突状态
            setShowPendingConflict(false);
            setConflictingPendingNodes([]);
        }
    }, [isOpen, resetAssociationEdit]);

    // 初始化/更新预览渲染器
    useEffect(() => {
        if (currentStep === STEPS.PREVIEW && previewCanvasRef.current) {
            // 创建或重用渲染器
            if (!previewRendererRef.current) {
                previewRendererRef.current = new MiniPreviewRenderer(previewCanvasRef.current);
            }

            // 设置预览场景
            previewRendererRef.current.setPreviewScene({
                nodeA: selectedNodeA,
                nodeB: selectedNodeB,
                relationType: selectedRelationType,
                newNodeName: newNodeData.title || '新节点',
                insertDirection: insertDirection
            });
        }

        return () => {
            // 当离开预览步骤时停止动画
            if (currentStep !== STEPS.PREVIEW && previewRendererRef.current) {
                previewRendererRef.current.stopAnimation();
            }
        };
    }, [currentStep, selectedNodeA, selectedNodeB, selectedRelationType, newNodeData.title, insertDirection]);

    // 搜索节点
    const searchNodes = useCallback(async (keyword) => {
        const normalizedKeyword = (keyword || '').trim();
        if (!normalizedKeyword) {
            setSearchResults([]);
            return;
        }

        setSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(normalizedKeyword)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setSearchResults(data);
            } else {
                setSearchResults([]);
            }
        } catch (error) {
            console.error('搜索节点失败:', error);
            setSearchResults([]);
        } finally {
            setSearchLoading(false);
        }
    }, []);

    // 选择节点步骤中，输入时自动搜索
    useEffect(() => {
        if (currentStep !== STEPS.SELECT_NODE_A) {
            return;
        }

        if (!searchKeyword.trim()) {
            setSearchResults([]);
            setSearchLoading(false);
            return;
        }

        const timer = setTimeout(() => {
            searchNodes(searchKeyword);
        }, 220);

        return () => clearTimeout(timer);
    }, [searchKeyword, currentStep, searchNodes]);

    // 获取节点详情
    const fetchNodeDetail = async (nodeId) => {
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${nodeId}`);
            if (response.ok) {
                const data = await response.json();
                return data.node;
            }
        } catch (error) {
            console.error('获取节点详情失败:', error);
        }
        return null;
    };

    // 开始添加新的关联关系
    const startAddAssociation = () => {
        resetAssociationEdit();
        setCurrentStep(STEPS.SELECT_NODE_A);
    };

    // 选择 Node A
    const selectNodeA = async (node) => {
        const nodeDetail = await fetchNodeDetail(node._id);
        if (nodeDetail) {
            setSelectedNodeA(nodeDetail);
            setCurrentStep(STEPS.SELECT_RELATION);
            setSearchResults([]);
            setSearchKeyword('');
        } else {
            alert('获取节点详情失败');
        }
    };

    // 选择关系类型
    const selectRelationType = (type) => {
        setSelectedRelationType(type);

        if (type === RELATION_TYPES.INSERT) {
            const candidates = {
                parents: selectedNodeA.parentNodesInfo || [],
                children: selectedNodeA.childNodesInfo || []
            };
            setNodeBCandidates(candidates);

            if (candidates.parents.length === 0 && candidates.children.length === 0) {
                alert('该节点没有母域或子域节点，无法使用插入模式。');
                return;
            }
            setCurrentStep(STEPS.SELECT_NODE_B);
        } else {
            setCurrentStep(STEPS.PREVIEW);
        }
    };

    // 选择 Node B
    const selectNodeB = (node, fromParents) => {
        setSelectedNodeB(node);
        const direction = fromParents ? 'bToA' : 'aToB';
        setInsertDirection(direction);
        setCurrentStep(STEPS.PREVIEW);
    };

    // 重播预览动画
    const replayPreview = () => {
        if (previewRendererRef.current) {
            previewRendererRef.current.setPreviewScene({
                nodeA: selectedNodeA,
                nodeB: selectedNodeB,
                relationType: selectedRelationType,
                newNodeName: newNodeData.title || '新节点',
                insertDirection: insertDirection
            });
        }
    };

    // 确认当前关联关系
    const confirmAssociation = () => {
        let associationData;

        if (selectedRelationType === RELATION_TYPES.INSERT) {
            associationData = {
                type: 'insert',
                nodeA: selectedNodeA,
                nodeB: selectedNodeB,
                direction: insertDirection,
                actualAssociations: insertDirection === 'aToB'
                    ? [
                        { targetNode: selectedNodeA._id, relationType: 'extends', nodeName: selectedNodeA.name },
                        { targetNode: selectedNodeB._id, relationType: 'contains', nodeName: selectedNodeB.name }
                    ]
                    : [
                        { targetNode: selectedNodeB._id, relationType: 'extends', nodeName: selectedNodeB.name },
                        { targetNode: selectedNodeA._id, relationType: 'contains', nodeName: selectedNodeA.name }
                    ],
                displayText: `插入到 ${selectedNodeA.name} 和 ${selectedNodeB.name} 之间`
            };
        } else {
            // UI 中的“作为母域/子域”是从新节点相对目标节点的角色描述，
            // 后端 relationType 则是“当前节点相对目标节点”的关系：
            // 作为目标母域 => 当前节点包含目标 => contains
            // 作为目标子域 => 当前节点拓展目标 => extends
            const backendRelationType = selectedRelationType === RELATION_TYPES.EXTENDS
                ? RELATION_TYPES.CONTAINS
                : RELATION_TYPES.EXTENDS;

            associationData = {
                type: selectedRelationType,
                nodeA: selectedNodeA,
                nodeB: null,
                direction: null,
                actualAssociations: [{
                    targetNode: selectedNodeA._id,
                    relationType: backendRelationType,
                    nodeName: selectedNodeA.name
                }],
                displayText: selectedRelationType === 'extends'
                    ? `作为 ${selectedNodeA.name} 的母域`
                    : `作为 ${selectedNodeA.name} 的子域`
            };
        }

        // 检查重复（仅在同一个新节点的创建会话内检测）
        let duplicateReason = null;
        const isDuplicate = associations.some(assoc => {
            // 两个都是 insert 类型：检查是否是同一对节点（无论顺序）
            if (assoc.type === 'insert' && associationData.type === 'insert') {
                const existingPair = [assoc.nodeA._id, assoc.nodeB._id].sort();
                const newPair = [associationData.nodeA._id, associationData.nodeB._id].sort();
                if (existingPair[0] === newPair[0] && existingPair[1] === newPair[1]) {
                    duplicateReason = `已经存在插入到 ${assoc.nodeA.name} 和 ${assoc.nodeB.name} 之间的关联`;
                    return true;
                }
                return false;
            }

            // 非 insert 类型之间的重复检查：同一目标节点不能有相同类型的关系
            if (assoc.type !== 'insert' && associationData.type !== 'insert') {
                const found = assoc.actualAssociations.some(aa =>
                    associationData.actualAssociations.some(ba =>
                        aa.targetNode === ba.targetNode && aa.relationType === ba.relationType
                    )
                );
                if (found) {
                    duplicateReason = `已经存在与 ${assoc.nodeA.name} 的${assoc.type === 'extends' ? '母域' : '子域'}关系`;
                    return true;
                }
                return false;
            }

            // insert 与非 insert 之间的冲突检查：
            // 检查是否会对同一个目标节点产生冲突的关系类型
            const insertAssoc = assoc.type === 'insert' ? assoc : associationData;
            const simpleAssoc = assoc.type === 'insert' ? associationData : assoc;

            const conflict = insertAssoc.actualAssociations.find(ia =>
                simpleAssoc.actualAssociations.some(sa =>
                    ia.targetNode === sa.targetNode && ia.relationType === sa.relationType
                )
            );
            if (conflict) {
                duplicateReason = `与现有关联冲突：新节点对 ${conflict.nodeName} 已经有${conflict.relationType === 'extends' ? '母域' : '子域'}关系`;
                return true;
            }
            return false;
        });

        if (isDuplicate) {
            alert(duplicateReason || '该关联关系已存在');
            return;
        }

        if (editingAssociationIndex !== null) {
            setAssociations(prev => {
                const newAssocs = [...prev];
                newAssocs[editingAssociationIndex] = associationData;
                return newAssocs;
            });
        } else {
            setAssociations(prev => [...prev, associationData]);
        }

        resetAssociationEdit();
    };

    // 取消当前编辑
    const cancelAssociationEdit = () => {
        resetAssociationEdit();
    };

    // 返回上一步
    const goBack = () => {
        if (previewRendererRef.current) {
            previewRendererRef.current.stopAnimation();
        }

        switch (currentStep) {
            case STEPS.SELECT_RELATION:
                setSelectedRelationType(null);
                setCurrentStep(STEPS.SELECT_NODE_A);
                break;
            case STEPS.SELECT_NODE_B:
                setSelectedNodeB(null);
                setInsertDirection(null);
                setCurrentStep(STEPS.SELECT_RELATION);
                break;
            case STEPS.PREVIEW:
                if (selectedRelationType === RELATION_TYPES.INSERT) {
                    setCurrentStep(STEPS.SELECT_NODE_B);
                } else {
                    setCurrentStep(STEPS.SELECT_RELATION);
                }
                break;
            default:
                cancelAssociationEdit();
        }
    };

    // 删除关联关系
    const removeAssociation = (index) => {
        setAssociations(prev => prev.filter((_, i) => i !== index));
    };

    // 编辑已有关联关系
    const editAssociation = (index) => {
        const assoc = associations[index];
        setEditingAssociationIndex(index);
        setSelectedNodeA(assoc.nodeA);
        setSelectedRelationType(assoc.type);
        setSelectedNodeB(assoc.nodeB);
        setInsertDirection(assoc.direction);
        setCurrentStep(STEPS.PREVIEW);
    };

    // 检查是否可以提交
    const canSubmitNode = () => {
        const hasTitle = newNodeData.title.trim() !== '';
        const hasDescription = newNodeData.description.trim() !== '';
        const hasAssociations = associations.length > 0 || isAdmin;
        // 只检查已审核通过的节点名称是否重复
        const isTitleUnique = !existingNodes.some(node =>
            node.status === 'approved' && node.name === newNodeData.title
        );
        return hasTitle && hasDescription && hasAssociations && isTitleUnique;
    };

    // 提交节点创建
    const submitNodeCreation = async () => {
        if (!canSubmitNode()) {
            alert('请填写所有必填字段');
            return;
        }

        const token = localStorage.getItem('token');
        try {
            const x = Math.random() * 700 + 50;
            const y = Math.random() * 400 + 50;
            const allAssociations = associations.flatMap(assoc => assoc.actualAssociations);

            const response = await fetch('http://localhost:5000/api/nodes/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: newNodeData.title,
                    description: newNodeData.description,
                    position: { x, y },
                    associations: allAssociations
                })
            });

            const data = await response.json();
            if (response.ok) {
                if (isAdmin) {
                    alert('节点创建成功！');
                    onSuccess(data);
                } else {
                    alert('节点创建申请已提交，等待管理员审批');
                    onSuccess(null);
                }
                onClose();
            } else if (response.status === 409 && data.error === 'PENDING_NODES_EXIST') {
                // 管理员遇到同名待审核节点，显示冲突处理界面
                setConflictingPendingNodes(data.pendingNodes);
                setShowPendingConflict(true);
            } else {
                alert(data.error || '创建失败');
            }
        } catch (error) {
            console.error('创建节点失败:', error);
            alert('创建失败');
        }
    };

    // 管理员审批待审核节点（在冲突界面中）
    const approvePendingNode = async (nodeId) => {
        setPendingApprovalLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/nodes/approve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nodeId })
            });

            if (response.ok) {
                const data = await response.json();
                let message = '已批准该申请';
                if (data.autoRejectedCount > 0) {
                    message += `，其他 ${data.autoRejectedCount} 个同名申请已自动拒绝`;
                }
                alert(message);
                onSuccess(data);
                onClose();
            } else {
                const data = await response.json();
                alert(data.error || '审批失败');
            }
        } catch (error) {
            console.error('审批失败:', error);
            alert('审批失败');
        } finally {
            setPendingApprovalLoading(false);
        }
    };

    // 管理员拒绝待审核节点
    const rejectPendingNode = async (nodeId) => {
        setPendingApprovalLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/nodes/reject', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nodeId })
            });

            if (response.ok) {
                // 从列表中移除已拒绝的节点
                setConflictingPendingNodes(prev => prev.filter(n => n._id !== nodeId));
                // 如果没有剩余的待审核节点，关闭冲突界面
                if (conflictingPendingNodes.length <= 1) {
                    setShowPendingConflict(false);
                    alert('所有同名申请已处理，您现在可以继续创建节点');
                }
            } else {
                const data = await response.json();
                alert(data.error || '拒绝失败');
            }
        } catch (error) {
            console.error('拒绝失败:', error);
            alert('拒绝失败');
        } finally {
            setPendingApprovalLoading(false);
        }
    };

    // 管理员放弃创建，关闭冲突界面
    const abandonCreation = () => {
        setShowPendingConflict(false);
        setConflictingPendingNodes([]);
    };

    // 过滤 Node B 候选
    const filteredNodeBCandidates = {
        parents: nodeBCandidates.parents.filter(n =>
            nodeBSearchKeyword.trim() === '' ||
            n.name.toLowerCase().includes(nodeBSearchKeyword.toLowerCase())
        ),
        children: nodeBCandidates.children.filter(n =>
            nodeBSearchKeyword.trim() === '' ||
            n.name.toLowerCase().includes(nodeBSearchKeyword.toLowerCase())
        )
    };

    // 渲染步骤指示器
    const renderStepIndicator = () => {
        if (!currentStep) return null;

        const steps = [
            { key: STEPS.SELECT_NODE_A, label: '选择节点' },
            { key: STEPS.SELECT_RELATION, label: '选择关系' },
            ...(selectedRelationType === RELATION_TYPES.INSERT ? [{ key: STEPS.SELECT_NODE_B, label: '第二节点' }] : []),
            { key: STEPS.PREVIEW, label: '预览确认' }
        ];

        const currentIndex = steps.findIndex(s => s.key === currentStep);

        return (
            <div className="step-indicator">
                {steps.map((step, index) => (
                    <React.Fragment key={step.key}>
                        <div className={`step-dot ${index <= currentIndex ? 'active' : ''} ${step.key === currentStep ? 'current' : ''}`}>
                            {index + 1}
                        </div>
                        {index < steps.length - 1 && (
                            <div className={`step-line ${index < currentIndex ? 'active' : ''}`} />
                        )}
                    </React.Fragment>
                ))}
                <div className="step-labels">
                    {steps.map((step) => (
                        <span key={step.key} className={`step-label ${step.key === currentStep ? 'current' : ''}`}>
                            {step.label}
                        </span>
                    ))}
                </div>
            </div>
        );
    };

    // 渲染 Step 1: 选择 Node A
    const renderSelectNodeA = () => (
        <div className="association-step">
            <h5>步骤 1：选择关联节点</h5>
            <p className="step-description">搜索并选择一个现有节点作为关联目标</p>

            <div className="search-input-group">
                <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && searchNodes(searchKeyword)}
                    placeholder="搜索节点标题或简介..."
                    className="form-input"
                />
                <button onClick={() => searchNodes(searchKeyword)} disabled={searchLoading} className="btn btn-primary">
                    <Search className="icon-small" />
                    {searchLoading ? '...' : '搜索'}
                </button>
            </div>

            {searchResults.length > 0 && (
                <div className="search-results">
                    <h6>搜索结果</h6>
                    {searchResults.map(node => (
                        <div key={node._id} className="search-result-item clickable" onClick={() => selectNodeA(node)}>
                            <div className="node-info">
                                <strong>{node.name}</strong>
                                <span className="node-description">{node.description}</span>
                            </div>
                            <ArrowRight className="icon-small" />
                        </div>
                    ))}
                </div>
            )}

            {!searchLoading && searchKeyword.trim() !== '' && searchResults.length === 0 && (
                <div className="search-status"><p>未找到匹配的节点</p></div>
            )}
        </div>
    );

    // 渲染 Step 2: 选择关系类型
    const renderSelectRelation = () => (
        <div className="association-step">
            <h5>步骤 2：选择关系类型</h5>
            <p className="step-description">
                选择新节点与 <strong>{selectedNodeA?.name}</strong> 的关系
            </p>

            <div className="relation-type-cards">
                <div className="relation-card" onClick={() => selectRelationType(RELATION_TYPES.EXTENDS)}>
                    <div className="relation-card-icon extends-icon">↑</div>
                    <div className="relation-card-content">
                        <h6>作为母域节点</h6>
                        <p>新节点将成为 {selectedNodeA?.name} 的母域（上级概念）</p>
                    </div>
                </div>

                <div className="relation-card" onClick={() => selectRelationType(RELATION_TYPES.CONTAINS)}>
                    <div className="relation-card-icon contains-icon">↓</div>
                    <div className="relation-card-content">
                        <h6>作为子域节点</h6>
                        <p>新节点将成为 {selectedNodeA?.name} 的子域（下级概念）</p>
                    </div>
                </div>

                <div
                    className={`relation-card ${(!selectedNodeA?.parentNodesInfo?.length && !selectedNodeA?.childNodesInfo?.length) ? 'disabled' : ''}`}
                    onClick={() => {
                        if (selectedNodeA?.parentNodesInfo?.length || selectedNodeA?.childNodesInfo?.length) {
                            selectRelationType(RELATION_TYPES.INSERT);
                        }
                    }}
                >
                    <div className="relation-card-icon insert-icon">⇄</div>
                    <div className="relation-card-content">
                        <h6>插入到两节点之间</h6>
                        <p>将新节点插入到 {selectedNodeA?.name} 与另一个节点之间</p>
                        {(!selectedNodeA?.parentNodesInfo?.length && !selectedNodeA?.childNodesInfo?.length) && (
                            <span className="disabled-hint">该节点没有母域或子域节点</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    // 渲染 Step 3: 选择 Node B（插入模式）
    const renderSelectNodeB = () => (
        <div className="association-step">
            <h5>步骤 3：选择第二个节点</h5>
            <p className="step-description">
                选择要与 <strong>{selectedNodeA?.name}</strong> 之间插入新节点的目标节点
            </p>

            <div className="node-b-search">
                <input
                    type="text"
                    value={nodeBSearchKeyword}
                    onChange={(e) => setNodeBSearchKeyword(e.target.value)}
                    placeholder="搜索候选节点..."
                    className="form-input"
                />
            </div>

            {filteredNodeBCandidates.parents.length > 0 && (
                <div className="candidate-section">
                    <h6 className="candidate-header parent-header">
                        <span className="candidate-icon">↑</span> 母域节点（上级）
                    </h6>
                    <div className="candidate-list">
                        {filteredNodeBCandidates.parents.map(node => (
                            <div key={node._id} className="candidate-item" onClick={() => selectNodeB(node, true)}>
                                <span className="candidate-name">{node.name}</span>
                                <span className="candidate-hint">插入到 {node.name} 和 {selectedNodeA?.name} 之间</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {filteredNodeBCandidates.children.length > 0 && (
                <div className="candidate-section">
                    <h6 className="candidate-header child-header">
                        <span className="candidate-icon">↓</span> 子域节点（下级）
                    </h6>
                    <div className="candidate-list">
                        {filteredNodeBCandidates.children.map(node => (
                            <div key={node._id} className="candidate-item" onClick={() => selectNodeB(node, false)}>
                                <span className="candidate-name">{node.name}</span>
                                <span className="candidate-hint">插入到 {selectedNodeA?.name} 和 {node.name} 之间</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {filteredNodeBCandidates.parents.length === 0 && filteredNodeBCandidates.children.length === 0 && (
                <div className="no-candidates"><p>没有找到匹配的候选节点</p></div>
            )}
        </div>
    );

    // 渲染 Step 4: 预览（带动画画布）
    const renderPreview = () => (
        <div className="association-step preview-step">
            <h5>步骤 {selectedRelationType === RELATION_TYPES.INSERT ? '4' : '3'}：预览确认</h5>
            <p className="step-description">查看关联关系生效后的结构变化</p>

            {/* 预览画布 */}
            <div className="preview-canvas-container">
                <canvas
                    ref={previewCanvasRef}
                    width={320}
                    height={200}
                    className="preview-canvas"
                />
                <div className="preview-legend">
                    <div className="legend-item">
                        <span className="legend-dot existing"></span>
                        <span>现有节点</span>
                    </div>
                    <div className="legend-item">
                        <span className="legend-dot preview"></span>
                        <span>新节点（待审核）</span>
                    </div>
                    <div className="legend-item">
                        <span className="legend-line dashed"></span>
                        <span>新关联</span>
                    </div>
                </div>
            </div>

            {/* 关系说明 */}
            <div className="preview-info-box">
                <div className="preview-info-row">
                    <span className="info-icon">📍</span>
                    <span>
                        {selectedRelationType === RELATION_TYPES.EXTENDS && (
                            <><strong>{newNodeData.title || '新节点'}</strong> 将成为 <strong>{selectedNodeA?.name}</strong> 的母域</>
                        )}
                        {selectedRelationType === RELATION_TYPES.CONTAINS && (
                            <><strong>{newNodeData.title || '新节点'}</strong> 将成为 <strong>{selectedNodeA?.name}</strong> 的子域</>
                        )}
                        {selectedRelationType === RELATION_TYPES.INSERT && (
                            <><strong>{newNodeData.title || '新节点'}</strong> 将插入到 <strong>{selectedNodeA?.name}</strong> 和 <strong>{selectedNodeB?.name}</strong> 之间</>
                        )}
                    </span>
                </div>
            </div>

            <div className="preview-actions">
                <button onClick={replayPreview} className="btn btn-secondary">
                    <RotateCcw className="icon-small" /> 重播
                </button>
                <button onClick={confirmAssociation} className="btn btn-success">
                    <Check className="icon-small" /> 确认关联
                </button>
            </div>
        </div>
    );

    // 渲染当前步骤内容
    const renderCurrentStepContent = () => {
        switch (currentStep) {
            case STEPS.SELECT_NODE_A: return renderSelectNodeA();
            case STEPS.SELECT_RELATION: return renderSelectRelation();
            case STEPS.SELECT_NODE_B: return renderSelectNodeB();
            case STEPS.PREVIEW: return renderPreview();
            default: return null;
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content create-node-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{showPendingConflict ? '处理同名节点申请' : '创建新节点'}</h3>
                    <button onClick={showPendingConflict ? abandonCreation : onClose} className="btn-close">
                        <X className="icon-small" />
                    </button>
                </div>

                <div className="modal-body">
                    {/* 同名待审核节点冲突处理界面 */}
                    {showPendingConflict ? (
                        <div className="pending-conflict-panel">
                            <div className="conflict-alert">
                                <AlertTriangle className="icon-medium" />
                                <div className="conflict-alert-content">
                                    <h4>发现同名节点申请</h4>
                                    <p>您要创建的节点 "<strong>{newNodeData.title}</strong>" 已有 {conflictingPendingNodes.length} 个用户提交了申请。</p>
                                    <p>请选择一个申请批准，或拒绝所有申请后继续创建。</p>
                                </div>
                            </div>

                            <div className="conflict-pending-list">
                                {conflictingPendingNodes.map((node, index) => (
                                    <div key={node._id} className="conflict-pending-card">
                                        <div className="conflict-pending-header">
                                            <span className="conflict-index">申请 #{index + 1}</span>
                                            <span className="conflict-owner">
                                                申请人: {node.owner?.username || '未知'}
                                                {node.owner?.profession && (
                                                    <span className="owner-profession">【{node.owner.profession}】</span>
                                                )}
                                            </span>
                                        </div>

                                        <div className="conflict-pending-body">
                                            <div className="conflict-field">
                                                <label>节点标题:</label>
                                                <span>{node.name}</span>
                                            </div>
                                            <div className="conflict-field">
                                                <label>节点简介:</label>
                                                <p className="conflict-description">{node.description}</p>
                                            </div>
                                            <div className="conflict-field">
                                                <label>提交时间:</label>
                                                <span>{new Date(node.createdAt).toLocaleString('zh-CN')}</span>
                                            </div>

                                            {node.associations && node.associations.length > 0 && (
                                                <div className="conflict-field">
                                                    <label>关联关系:</label>
                                                    <div className="conflict-associations">
                                                        {node.associations.map((assoc, idx) => (
                                                            <span key={idx} className={`conflict-assoc-tag ${assoc.relationType}`}>
                                                                {assoc.relationType === 'extends' ? '母域' : '子域'}: {assoc.targetNode?.name || '未知'}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="conflict-pending-actions">
                                            <button
                                                onClick={() => approvePendingNode(node._id)}
                                                disabled={pendingApprovalLoading}
                                                className="btn btn-success"
                                            >
                                                <Check className="icon-small" />
                                                批准此申请
                                            </button>
                                            <button
                                                onClick={() => rejectPendingNode(node._id)}
                                                disabled={pendingApprovalLoading}
                                                className="btn btn-danger"
                                            >
                                                <X className="icon-small" />
                                                拒绝
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="conflict-footer-actions">
                                <button onClick={abandonCreation} className="btn btn-secondary">
                                    放弃创建
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* 节点信息 */}
                            <div className="node-creation-info">
                                <div className="info-row">
                                    <span className="info-label-display">创建者:</span>
                                    <span className="info-value-display">{username}</span>
                                </div>
                                <div className="info-row">
                                    <span className="info-label-display">当前域主:</span>
                                    <span className="info-value-display">{username}</span>
                                </div>
                            </div>

                            {/* 基本信息 */}
                            <div className="form-group">
                                <label>节点标题 *</label>
                                <input
                                    type="text"
                                    value={newNodeData.title}
                                    onChange={(e) => setNewNodeData({ ...newNodeData, title: e.target.value })}
                                    placeholder="输入节点标题"
                                    className="form-input"
                                />
                                {newNodeData.title.trim() === '' && <span className="error-text">标题不能为空</span>}
                                {newNodeData.title.trim() !== '' && existingNodes.some(node =>
                                    node.status === 'approved' && node.name === newNodeData.title
                                ) && (
                                    <span className="error-text">该标题已有审核通过的节点</span>
                                )}
                            </div>

                            <div className="form-group">
                                <label>节点简介 *</label>
                                <textarea
                                    value={newNodeData.description}
                                    onChange={(e) => setNewNodeData({ ...newNodeData, description: e.target.value })}
                                    placeholder="输入节点简介"
                                    rows="3"
                                    className="form-textarea"
                                />
                                {newNodeData.description.trim() === '' && <span className="error-text">简介不能为空</span>}
                            </div>

                            {/* 关联关系部分 */}
                            <div className="associations-section">
                                <div className="associations-header" onClick={() => setIsAssociationListExpanded(!isAssociationListExpanded)}>
                                    <h4>
                                        关联关系 {!isAdmin && <span className="required-star">*</span>}
                                        <span className="association-count">({associations.length})</span>
                                    </h4>
                                    {isAssociationListExpanded ? <ChevronUp className="icon-small" /> : <ChevronDown className="icon-small" />}
                                </div>

                                {/* 已添加的关联关系列表 */}
                                {isAssociationListExpanded && associations.length > 0 && (
                                    <div className="associations-list">
                                        {associations.map((association, index) => (
                                            <div
                                                key={index}
                                                className={`association-item ${currentStep === null ? 'clickable' : ''}`}
                                                onClick={() => {
                                                    if (currentStep === null) {
                                                        editAssociation(index);
                                                    }
                                                }}
                                            >
                                                <div className="association-info">
                                                    <span className="association-display-text">{association.displayText}</span>
                                                    <span className={`relation-type-badge ${association.type}`}>
                                                        {association.type === 'extends' && '母域'}
                                                        {association.type === 'contains' && '子域'}
                                                        {association.type === 'insert' && '插入'}
                                                    </span>
                                                </div>
                                                <div className="association-actions">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeAssociation(index);
                                                        }}
                                                        className="btn btn-danger btn-small"
                                                        disabled={currentStep !== null}
                                                    >
                                                        <X className="icon-small" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {!isAdmin && associations.length === 0 && !currentStep && (
                                    <span className="error-text">至少需要一个关联关系</span>
                                )}

                                {/* 关联关系编辑区域 */}
                                {currentStep ? (
                                    <div className="association-editor">
                                        {renderStepIndicator()}
                                        {renderCurrentStepContent()}

                                        <div className="editor-navigation">
                                            <button onClick={goBack} className="btn btn-secondary">
                                                <ArrowLeft className="icon-small" /> 返回
                                            </button>
                                            <button onClick={cancelAssociationEdit} className="btn btn-danger">
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button onClick={startAddAssociation} className="btn btn-primary add-association-btn">
                                        <Plus className="icon-small" /> 添加关联关系
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Modal Footer - 只在非冲突模式下显示 */}
                {!showPendingConflict && (
                    <div className="modal-footer">
                        <button onClick={onClose} className="btn btn-secondary">取消</button>
                        <button
                            onClick={submitNodeCreation}
                            disabled={!canSubmitNode() || currentStep !== null}
                            className={`btn ${canSubmitNode() && currentStep === null ? 'btn-success' : 'btn-disabled'}`}
                        >
                            {isAdmin ? '创建节点' : '申请创建'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CreateNodeModal;
