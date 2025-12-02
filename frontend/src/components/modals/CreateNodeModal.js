import React, { useState } from 'react';
import { X, Search, Check } from 'lucide-react';
import './CreateNodeModal.css';

const CreateNodeModal = ({ 
    isOpen, 
    onClose, 
    username, 
    isAdmin, 
    existingNodes, 
    onSuccess 
}) => {
    const [newNodeData, setNewNodeData] = useState({
        title: '',
        description: ''
    });
    const [searchKeyword, setSearchKeyword] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedNodes, setSelectedNodes] = useState([]);
    const [currentAssociation, setCurrentAssociation] = useState({
        relationType: ''
    });
    const [associations, setAssociations] = useState([]);

    // Reset state when modal opens is handled by parent unmounting/mounting or we can use useEffect
    // Since we are moving it to a component that might be conditionally rendered, 
    // the state will reset when it's unmounted and remounted.
    
    if (!isOpen) return null;

    const searchNodes = async () => {
        if (!searchKeyword.trim()) {
            setSearchResults([]);
            return;
        }

        setSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(searchKeyword)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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
    };

    const toggleNodeSelection = (node) => {
        setSelectedNodes(prev => {
            const isSelected = prev.some(n => n._id === node._id);
            if (isSelected) {
                return prev.filter(n => n._id !== node._id);
            } else {
                return [...prev, node];
            }
        });
    };

    const addAssociation = () => {
        if (selectedNodes.length === 0 || !currentAssociation.relationType) {
            alert('请选择至少一个节点并选择关联关系类型');
            return;
        }

        // Check for duplicates
        const duplicateNodes = selectedNodes.filter(node =>
            associations.some(assoc => assoc.targetNode === node._id)
        );

        if (duplicateNodes.length > 0) {
            alert(`以下节点已在关联列表中，一个节点只能有一种关联关系：\n${duplicateNodes.map(n => n.name).join(', ')}`);
            return;
        }

        const newAssociations = selectedNodes.map(node => ({
            targetNode: node._id,
            relationType: currentAssociation.relationType,
            nodeName: node.name
        }));

        setAssociations(prev => [...prev, ...newAssociations]);
        setSelectedNodes([]);
        setCurrentAssociation({ relationType: '' });
        setSearchResults([]);
        setSearchKeyword('');
    };

    const removeAssociation = (index) => {
        setAssociations(prev => prev.filter((_, i) => i !== index));
    };

    const canSubmitNode = () => {
        const hasTitle = newNodeData.title.trim() !== '';
        const hasDescription = newNodeData.description.trim() !== '';
        const hasAssociations = associations.length > 0 || isAdmin;
        
        const isTitleUnique = !existingNodes.some(node => node.name === newNodeData.title);
        
        return hasTitle && hasDescription && hasAssociations && isTitleUnique;
    };

    const submitNodeCreation = async () => {
        if (!canSubmitNode()) {
            alert('请填写所有必填字段并确保标题唯一');
            return;
        }

        const token = localStorage.getItem('token');
        try {
            const x = Math.random() * 700 + 50;
            const y = Math.random() * 400 + 50;

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
                    associations: associations
                })
            });

            const data = await response.json();
            if (response.ok) {
                if (isAdmin) {
                    alert('节点创建成功！');
                    onSuccess(data); // Pass back the new node
                } else {
                    alert('节点创建申请已提交，等待管理员审批');
                    onSuccess(null); // No immediate node update
                }
                onClose();
            } else {
                alert(data.error || '创建失败');
            }
        } catch (error) {
            console.error('创建节点失败:', error);
            alert('创建失败');
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content create-node-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>创建新节点</h3>
                    <button
                        onClick={onClose}
                        className="btn-close"
                    >
                        <X className="icon-small" />
                    </button>
                </div>

                <div className="modal-body">
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
                            onChange={(e) => setNewNodeData({
                                ...newNodeData,
                                title: e.target.value
                            })}
                            placeholder="输入节点标题"
                            className="form-input"
                        />
                        {newNodeData.title.trim() === '' && (
                            <span className="error-text">标题不能为空</span>
                        )}
                        {newNodeData.title.trim() !== '' && existingNodes.some(node => node.name === newNodeData.title) && (
                            <span className="error-text">标题必须唯一</span>
                        )}
                    </div>

                    <div className="form-group">
                        <label>节点简介 *</label>
                        <textarea
                            value={newNodeData.description}
                            onChange={(e) => setNewNodeData({
                                ...newNodeData,
                                description: e.target.value
                            })}
                            placeholder="输入节点简介"
                            rows="3"
                            className="form-textarea"
                        />
                        {newNodeData.description.trim() === '' && (
                            <span className="error-text">简介不能为空</span>
                        )}
                    </div>

                    {/* 关联关系创建 */}
                    <div className="associations-section">
                        <h4>关联关系 {!isAdmin && <span className="required-star">*</span>}</h4>

                        {/* 搜索和选择节点 */}
                        <div className="search-section">
                            <div className="search-input-group">
                                <input
                                    type="text"
                                    value={searchKeyword}
                                    onChange={(e) => setSearchKeyword(e.target.value)}
                                    placeholder="搜索节点标题或简介..."
                                    className="form-input"
                                />
                                <button
                                    onClick={searchNodes}
                                    disabled={searchLoading}
                                    className="btn btn-primary"
                                >
                                    <Search className="icon-small" />
                                    {searchLoading ? '搜索中...' : '搜索'}
                                </button>
                            </div>

                            {/* 搜索结果 */}
                            {searchResults.length > 0 && (
                                <div className="search-results">
                                    <h5>搜索结果</h5>
                                    {searchResults.map(node => (
                                        <div
                                            key={node._id}
                                            className={`search-result-item ${selectedNodes.some(n => n._id === node._id) ? 'selected' : ''}`}
                                            onClick={() => toggleNodeSelection(node)}
                                        >
                                            <div className="node-info">
                                                <strong>{node.name}</strong>
                                                <span className="node-description">{node.description}</span>
                                            </div>
                                            <div className="selection-indicator">
                                                {selectedNodes.some(n => n._id === node._id) ? '✓' : '+'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 搜索状态提示 */}
                            {searchLoading && (
                                <div className="search-status">
                                    <p>正在搜索...</p>
                                </div>
                            )}
                            {!searchLoading && searchKeyword.trim() !== '' && searchResults.length === 0 && (
                                <div className="search-status">
                                    <p>未找到匹配的节点</p>
                                </div>
                            )}

                            {/* 关联类型选择 */}
                            {selectedNodes.length > 0 && (
                                <div className="relation-type-section">
                                    <label>关联类型:</label>
                                    <div className="relation-options">
                                        <label className="radio-label">
                                            <input
                                                type="radio"
                                                name="relationType"
                                                value="contains"
                                                checked={currentAssociation.relationType === 'contains'}
                                                onChange={(e) => setCurrentAssociation({
                                                    ...currentAssociation,
                                                    relationType: e.target.value
                                                })}
                                            />
                                            <span>包含</span>
                                        </label>
                                        <label className="radio-label">
                                            <input
                                                type="radio"
                                                name="relationType"
                                                value="extends"
                                                checked={currentAssociation.relationType === 'extends'}
                                                onChange={(e) => setCurrentAssociation({
                                                    ...currentAssociation,
                                                    relationType: e.target.value
                                                })}
                                            />
                                            <span>拓展</span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {/* 添加关联关系按钮 */}
                            {selectedNodes.length > 0 && currentAssociation.relationType && (
                                <button
                                    onClick={addAssociation}
                                    className="btn btn-success"
                                >
                                    <Check className="icon-small" />
                                    添加关联关系
                                </button>
                            )}
                        </div>

                        {/* 已添加的关联关系列表 */}
                        {associations.length > 0 && (
                            <div className="associations-list">
                                <h5>已添加的关联关系</h5>
                                {associations.map((association, index) => (
                                    <div key={index} className="association-item">
                                        <div className="association-info">
                                            <span className="node-name">{association.nodeName}</span>
                                            <span className="relation-type">
                                                {association.relationType === 'contains' ? '包含' : '拓展'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => removeAssociation(index)}
                                            className="btn btn-danger btn-small"
                                        >
                                            <X className="icon-small" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {!isAdmin && associations.length === 0 && (
                            <span className="error-text">至少需要一个关联关系</span>
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        onClick={onClose}
                        className="btn btn-secondary"
                    >
                        取消
                    </button>
                    <button
                        onClick={submitNodeCreation}
                        disabled={!canSubmitNode()}
                        className={`btn ${canSubmitNode() ? 'btn-success' : 'btn-disabled'}`}
                    >
                        {isAdmin ? '创建节点' : '申请创建'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateNodeModal;
