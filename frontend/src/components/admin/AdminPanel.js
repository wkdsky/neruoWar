import React, { useState, useEffect, useMemo } from 'react';
import { Users, Zap, Bell, Shield, Check, X, Search, Plus, Trash2, AlertTriangle } from 'lucide-react';
import './Admin.css';

const AdminPanel = () => {
    const [adminTab, setAdminTab] = useState('users');
    
    // User Management State
    const [allUsers, setAllUsers] = useState([]);
    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState({
        username: '',
        password: '',
        level: 0,
        experience: 0
    });

    // Node Management State
    const [allNodes, setAllNodes] = useState([]);
    const [editingNode, setEditingNode] = useState(null);
    const [editNodeForm, setEditNodeForm] = useState({
        name: '',
        description: '',
        prosperity: 0,
        resources: { food: 0, metal: 0, energy: 0 },
        productionRates: { food: 0, metal: 0, energy: 0 },
        contentScore: 1
    });
    const [pendingNodes, setPendingNodes] = useState([]);

    // 将待审核节点按名称分组
    const groupedPendingNodes = useMemo(() => {
        const groups = {};
        pendingNodes.forEach(node => {
            const name = node.name;
            if (!groups[name]) {
                groups[name] = [];
            }
            groups[name].push(node);
        });
        // 转换为数组，同名的排在前面（优先显示有竞争的）
        return Object.entries(groups)
            .map(([name, nodes]) => ({ name, nodes, hasConflict: nodes.length > 1 }))
            .sort((a, b) => {
                // 有冲突的优先显示
                if (a.hasConflict && !b.hasConflict) return -1;
                if (!a.hasConflict && b.hasConflict) return 1;
                // 同样冲突状态的按提交时间排序
                return new Date(b.nodes[0].createdAt) - new Date(a.nodes[0].createdAt);
            });
    }, [pendingNodes]);

    // Master Change State
    const [showChangeMasterModal, setShowChangeMasterModal] = useState(false);
    const [changingMasterNode, setChangingMasterNode] = useState(null);
    const [masterSearchKeyword, setMasterSearchKeyword] = useState('');
    const [masterSearchResults, setMasterSearchResults] = useState([]);
    const [selectedNewMaster, setSelectedNewMaster] = useState(null);

    // Alliance Management State
    const [adminAlliances, setAdminAlliances] = useState([]);
    const [editingAlliance, setEditingAlliance] = useState(null);
    const [editAllianceForm, setEditAllianceForm] = useState({
        name: '',
        flag: '',
        declaration: ''
    });

    // Association View/Edit State
    const [showAssociationModal, setShowAssociationModal] = useState(false);
    const [viewingAssociationNode, setViewingAssociationNode] = useState(null);
    
    const [showEditAssociationModal, setShowEditAssociationModal] = useState(false);
    const [editingAssociationNode, setEditingAssociationNode] = useState(null);
    const [editAssociations, setEditAssociations] = useState([]);
    const [assocSearchKeyword, setAssocSearchKeyword] = useState('');
    const [assocSearchResults, setAssocSearchResults] = useState([]);
    const [newAssocType, setNewAssocType] = useState('contains');

    // Initial Fetch
    useEffect(() => {
        fetchPendingNodes();
        fetchAllUsers();
        fetchAllNodes();
    }, []);

    // --- User Management Functions ---
    const fetchAllUsers = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/admin/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setAllUsers(data.users);
            }
        } catch (error) {
            console.error('获取用户列表失败:', error);
        }
    };

    const startEditUser = (user) => {
        setEditingUser(user._id);
        setEditForm({
            username: user.username,
            password: user.password,
            level: user.level,
            experience: user.experience
        });
    };

    const saveUserEdit = async (userId) => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editForm)
            });
            if (response.ok) {
                alert('用户信息已更新');
                setEditingUser(null);
                fetchAllUsers();
            } else {
                const data = await response.json();
                alert(data.error || '更新失败');
            }
        } catch (error) {
            console.error('更新用户失败:', error);
            alert('更新失败');
        }
    };

    const deleteUser = async (userId, username) => {
        if (!window.confirm(`确定要删除用户 ${username} 吗？`)) return;
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                alert('用户已删除');
                fetchAllUsers();
            } else {
                const data = await response.json();
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除用户失败:', error);
            alert('删除失败');
        }
    };

    // --- Node Management Functions ---
    const fetchPendingNodes = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('http://localhost:5000/api/nodes/pending', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setPendingNodes(data);
            }
        } catch (error) {
            console.error('获取待审批节点失败:', error);
        }
    };

    const approveNode = async (nodeId, nodeName) => {
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
                let message = '节点审批通过';
                if (data.autoRejectedCount > 0) {
                    message += `，已自动拒绝 ${data.autoRejectedCount} 个同名申请`;
                }
                alert(message);
                fetchPendingNodes();
            } else {
                const data = await response.json();
                alert(data.error || '审批失败');
            }
        } catch (error) {
            console.error('审批节点失败:', error);
            alert('审批失败');
        }
    };

    const rejectNode = async (nodeId) => {
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
                alert('节点已拒绝');
                setPendingNodes(prev => prev.filter(node => node._id !== nodeId));
            } else {
                const data = await response.json();
                alert(data.error || '拒绝失败');
            }
        } catch (error) {
            console.error('拒绝节点失败:', error);
            alert('拒绝失败');
        }
    };

    const fetchAllNodes = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/nodes', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setAllNodes(data.nodes);
            }
        } catch (error) {
            console.error('获取节点列表失败:', error);
        }
    };

    const startEditNode = (node) => {
        setEditingNode(node._id);
        setEditNodeForm({
            name: node.name,
            description: node.description,
            prosperity: node.prosperity || 100,
            resources: {
                food: node.resources?.food || 0,
                metal: node.resources?.metal || 0,
                energy: node.resources?.energy || 0
            },
            productionRates: {
                food: node.productionRates?.food || 0,
                metal: node.productionRates?.metal || 0,
                energy: node.productionRates?.energy || 0
            },
            contentScore: node.contentScore || 1
        });
    };

    const saveNodeEdit = async (nodeId) => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editNodeForm)
            });
            if (response.ok) {
                alert('节点信息已更新');
                setEditingNode(null);
                fetchAllNodes();
            } else {
                const data = await response.json();
                alert(data.error || '更新失败');
            }
        } catch (error) {
            console.error('更新节点失败:', error);
            alert('更新失败');
        }
    };

    const deleteNode = async (nodeId, nodeName) => {
        if (!window.confirm(`确定要删除节点 "${nodeName}" 吗？此操作不可撤销！`)) return;
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                alert('节点已删除');
                fetchAllNodes();
            } else {
                const data = await response.json();
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除节点失败:', error);
            alert('删除失败');
        }
    };

    const toggleFeaturedNode = async (nodeId, currentFeatured) => {
        const token = localStorage.getItem('token');
        const action = currentFeatured ? '取消热门' : '设置为热门';
        if (!window.confirm(`确定要${action}吗？`)) return;

        let featuredOrder = 0;
        if (!currentFeatured) {
            const orderInput = window.prompt('请输入热门节点的排序（数字越小越靠前）：', '0');
            if (orderInput === null) return;
            featuredOrder = parseInt(orderInput) || 0;
        }

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/featured`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    isFeatured: !currentFeatured,
                    featuredOrder: featuredOrder
                })
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                fetchAllNodes();
            } else {
                const data = await response.json();
                alert(data.error || '操作失败');
            }
        } catch (error) {
            console.error('设置热门节点失败:', error);
            alert('操作失败');
        }
    };

    // --- Association Management Functions ---
    const openAssociationModal = (node) => {
        setViewingAssociationNode(node);
        setShowAssociationModal(true);
    };

    const openEditAssociationModal = async (node) => {
        setEditingAssociationNode(node);
        setAssocSearchKeyword('');
        setAssocSearchResults([]);
        setNewAssocType('contains');
        setShowEditAssociationModal(true);

        // Rebuild associations for editing
        const token = localStorage.getItem('token');
        const allRelatedNames = [
            ...(node.relatedParentDomains || []),
            ...(node.relatedChildDomains || [])
        ];

        if (allRelatedNames.length === 0) {
            setEditAssociations([]);
            return;
        }

        try {
            const response = await fetch('http://localhost:5000/api/nodes', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                const allNodesList = data.nodes || [];
                const nodeMap = {};
                allNodesList.forEach(n => { nodeMap[n.name] = n; });

                const rebuiltAssociations = [];
                (node.relatedParentDomains || []).forEach(nodeName => {
                    const targetNode = nodeMap[nodeName];
                    if (targetNode) {
                        rebuiltAssociations.push({
                            targetNode: targetNode._id,
                            targetNodeName: targetNode.name,
                            relationType: 'extends'
                        });
                    }
                });
                (node.relatedChildDomains || []).forEach(nodeName => {
                    const targetNode = nodeMap[nodeName];
                    if (targetNode) {
                        rebuiltAssociations.push({
                            targetNode: targetNode._id,
                            targetNodeName: targetNode.name,
                            relationType: 'contains'
                        });
                    }
                });
                setEditAssociations(rebuiltAssociations);
            }
        } catch (error) {
            console.error('获取节点列表失败:', error);
            setEditAssociations([]);
        }
    };

    const searchAssociationNodes = async (keyword) => {
        if (!keyword || keyword.trim() === '') {
            setAssocSearchResults([]);
            return;
        }
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(keyword)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const filtered = data.filter(n => {
                    if (n._id === editingAssociationNode._id) return false;
                    return !editAssociations.some(assoc => assoc.targetNode === n._id);
                });
                setAssocSearchResults(filtered);
            }
        } catch (error) {
            console.error('搜索节点失败:', error);
        }
    };

    const addEditAssociation = (targetNode) => {
        const exists = editAssociations.some(a => a.targetNode === targetNode._id);
        if (exists) {
            alert('该节点已在关联列表中。');
            return;
        }
        setEditAssociations([
            ...editAssociations,
            {
                targetNode: targetNode._id,
                targetNodeName: targetNode.name,
                relationType: newAssocType
            }
        ]);
        setAssocSearchResults(prev => prev.filter(node => node._id !== targetNode._id));
    };

    const removeEditAssociation = (index) => {
        setEditAssociations(prev => prev.filter((_, i) => i !== index));
    };

    const saveAssociationEdit = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${editingAssociationNode._id}/associations`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    associations: editAssociations.map(a => ({
                        targetNode: a.targetNode,
                        relationType: a.relationType
                    }))
                })
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                setShowEditAssociationModal(false);
                fetchAllNodes();
            } else {
                const data = await response.json();
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存关联失败:', error);
            alert('保存失败');
        }
    };

    // --- Alliance Management Functions ---
    const fetchAdminAlliances = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/alliances/admin/all', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setAdminAlliances(data.alliances);
            }
        } catch (error) {
            console.error('获取熵盟列表失败:', error);
        }
    };

    const startEditAlliance = (alliance) => {
        setEditingAlliance(alliance);
        setEditAllianceForm({
            name: alliance.name,
            flag: alliance.flag,
            declaration: alliance.declaration
        });
    };

    const cancelEditAlliance = () => {
        setEditingAlliance(null);
        setEditAllianceForm({ name: '', flag: '', declaration: '' });
    };

    const saveAllianceEdit = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/admin/${editingAlliance._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editAllianceForm)
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                cancelEditAlliance();
                fetchAdminAlliances();
            } else {
                const data = await response.json();
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存熵盟失败:', error);
            alert('保存失败');
        }
    };

    const deleteAlliance = async (allianceId, allianceName) => {
        if (!window.confirm(`确定要删除熵盟 "${allianceName}" 吗？此操作将清除所有成员的熵盟关联！`)) return;
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/admin/${allianceId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                fetchAdminAlliances();
            } else {
                const data = await response.json();
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除熵盟失败:', error);
            alert('删除失败');
        }
    };

    // --- Master Change Functions ---
    const searchUsersForMaster = async (keyword) => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/admin/search-users?keyword=${keyword}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setMasterSearchResults(data.users);
            }
        } catch (error) {
            console.error('搜索用户失败:', error);
        }
    };

    const openChangeMasterModal = (node) => {
        setChangingMasterNode(node);
        setSelectedNewMaster(node.domainMaster || null);
        setMasterSearchKeyword('');
        setMasterSearchResults([]);
        setShowChangeMasterModal(true);
        searchUsersForMaster('');
    };

    const confirmChangeMaster = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/admin/domain-master/${changingMasterNode._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    domainMasterId: selectedNewMaster?._id || null
                })
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                setShowChangeMasterModal(false);
                fetchAllNodes();
            } else {
                alert(data.error || '更换失败');
            }
        } catch (error) {
            console.error('更换域主失败:', error);
            alert('更换失败');
        }
    };

    return (
        <div className="admin-section">
            <h2 className="section-title-large">
                <Users className="icon" />
                管理员面板
            </h2>

            {/* 选项卡导航 */}
            <div className="admin-tabs">
                <button
                    onClick={() => {
                        setAdminTab('users');
                        fetchAllUsers();
                    }}
                    className={`admin-tab ${adminTab === 'users' ? 'active' : ''}`}
                >
                    <Users className="icon-small" />
                    用户管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('nodes');
                        fetchAllNodes();
                    }}
                    className={`admin-tab ${adminTab === 'nodes' ? 'active' : ''}`}
                >
                    <Zap className="icon-small" />
                    节点管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('pending');
                        fetchPendingNodes();
                    }}
                    className={`admin-tab ${adminTab === 'pending' ? 'active' : ''}`}
                >
                    <Bell className="icon-small" />
                    待审批节点
                    {pendingNodes.length > 0 && (
                        <span className="notification-badge">{pendingNodes.length}</span>
                    )}
                </button>
                <button
                    onClick={() => {
                        setAdminTab('alliances');
                        fetchAdminAlliances();
                    }}
                    className={`admin-tab ${adminTab === 'alliances' ? 'active' : ''}`}
                >
                    <Shield className="icon-small" />
                    熵盟管理
                </button>
            </div>

            {/* 用户管理选项卡 */}
            {adminTab === 'users' && (
                <div className="users-table-container">
                    <div className="table-info">
                        <p>总用户数: <strong>{allUsers.length}</strong></p>
                        <button 
                            onClick={fetchAllUsers}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                    </div>
                    
                    <div className="table-responsive">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th>数据库ID</th>
                                    <th>用户名</th>
                                    <th>密码（明文）</th>
                                    <th>等级</th>
                                    <th>经验值</th>
                                    <th>拥有节点</th>
                                    <th>创建时间</th>
                                    <th>更新时间</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allUsers.map((user) => (
                                    <tr key={user._id}>
                                        <td className="id-cell">{user._id}</td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="text"
                                                    value={editForm.username}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        username: e.target.value
                                                    })}
                                                    className="edit-input"
                                                />
                                            ) : (
                                                <span className="username-cell">
                                                    {user.username}
                                                    {user.profession && <span className="user-profession">【{user.profession}】</span>}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="text"
                                                    value={editForm.password}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        password: e.target.value
                                                    })}
                                                    className="edit-input"
                                                />
                                            ) : (
                                                <span className="password-cell">{user.password}</span>
                                            )}
                                        </td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="number"
                                                    value={editForm.level}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        level: parseInt(e.target.value)
                                                    })}
                                                    className="edit-input-small"
                                                />
                                            ) : (
                                                user.level
                                            )}
                                        </td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="number"
                                                    value={editForm.experience}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        experience: parseInt(e.target.value)
                                                    })}
                                                    className="edit-input-small"
                                                />
                                            ) : (
                                                user.experience
                                            )}
                                        </td>
                                        <td>{user.ownedNodes?.length || 0}</td>
                                        <td>{new Date(user.createdAt).toLocaleString('zh-CN')}</td>
                                        <td>{new Date(user.updatedAt).toLocaleString('zh-CN')}</td>
                                        <td className="action-cell">
                                            {editingUser === user._id ? (
                                                <>
                                                    <button
                                                        onClick={() => saveUserEdit(user._id)}
                                                        className="btn-action btn-save"
                                                    >
                                                        保存
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingUser(null)}
                                                        className="btn-action btn-cancel"
                                                    >
                                                        取消
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => startEditUser(user)}
                                                        className="btn-action btn-edit"
                                                    >
                                                        编辑
                                                    </button>
                                                    <button
                                                        onClick={() => deleteUser(user._id, user.username)}
                                                        className="btn-action btn-delete"
                                                    >
                                                        删除
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* 待审批节点选项卡 */}
            {adminTab === 'pending' && (
                <div className="pending-nodes-container">
                    <div className="table-info">
                        <p>待审批节点数: <strong>{pendingNodes.length}</strong></p>
                        {groupedPendingNodes.some(g => g.hasConflict) && (
                            <span className="conflict-warning">
                                <AlertTriangle className="icon-small" />
                                存在同名申请竞争
                            </span>
                        )}
                        <button
                            onClick={fetchPendingNodes}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                    </div>

                    {pendingNodes.length === 0 ? (
                        <div className="no-pending-nodes">
                            <p>暂无待审批节点</p>
                        </div>
                    ) : (
                        <div className="pending-nodes-list admin">
                            {groupedPendingNodes.map(group => (
                                <div key={group.name} className={`pending-group ${group.hasConflict ? 'has-conflict' : ''}`}>
                                    {/* 同名节点组标题 */}
                                    {group.hasConflict && (
                                        <div className="conflict-group-header">
                                            <AlertTriangle className="icon-small" />
                                            <span>同名申请竞争: "{group.name}" ({group.nodes.length} 个申请)</span>
                                            <span className="conflict-hint">请对比后选择一个通过，其他将自动拒绝</span>
                                        </div>
                                    )}

                                    <div className={`pending-nodes-grid ${group.hasConflict ? 'conflict-grid' : ''}`}>
                                        {group.nodes.map((node, index) => (
                                            <div key={node._id} className={`pending-node-card ${group.hasConflict ? 'conflict-card' : ''}`}>
                                                {group.hasConflict && (
                                                    <div className="conflict-badge">申请 #{index + 1}</div>
                                                )}
                                                <div className="node-header">
                                                    <h3 className="node-title">{node.name}</h3>
                                                    <span className={`status-badge status-${node.status}`}>
                                                        {node.status === 'pending' ? '待审批' :
                                                         node.status === 'approved' ? '已通过' : '已拒绝'}
                                                    </span>
                                                </div>

                                                <div className="node-details">
                                                    <p className="node-description">{node.description}</p>

                                                    <div className="node-meta">
                                                        <div className="meta-item">
                                                            <strong>创建者:</strong> {node.owner?.username || '未知用户'}
                                                            {node.owner?.profession && (
                                                                <span className="user-profession">【{node.owner.profession}】</span>
                                                            )}
                                                        </div>
                                                        <div className="meta-item">
                                                            <strong>提交时间:</strong> {new Date(node.createdAt).toLocaleString('zh-CN')}
                                                        </div>
                                                        <div className="meta-item">
                                                            <strong>位置:</strong> ({Math.round(node.position?.x || 0)}, {Math.round(node.position?.y || 0)})
                                                        </div>
                                                    </div>

                                                    {node.associations && node.associations.length > 0 && (
                                                        <div className="associations-section">
                                                            <h4>关联关系 ({node.associations.length} 个)</h4>
                                                            <div className="associations-list">
                                                                {node.associations.map((association, idx) => (
                                                                    <div key={idx} className="association-item">
                                                                        <span className="node-name">
                                                                            {association.targetNode?.name || '未知节点'}
                                                                        </span>
                                                                        <span className={`relation-type ${association.relationType}`}>
                                                                            {association.relationType === 'contains' ? '子域' : '母域'}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="node-actions">
                                                    <button
                                                        onClick={() => approveNode(node._id, node.name)}
                                                        className="btn btn-success"
                                                    >
                                                        <Check className="icon-small" />
                                                        {group.hasConflict ? '选择此申请' : '通过'}
                                                    </button>
                                                    <button
                                                        onClick={() => rejectNode(node._id)}
                                                        className="btn btn-danger"
                                                    >
                                                        <X className="icon-small" />
                                                        拒绝
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 节点管理选项卡 */}
            {adminTab === 'nodes' && (
                <div className="nodes-table-container">
                    <div className="table-info">
                        <p>总节点数: <strong>{allNodes.length}</strong></p>
                        <button 
                            onClick={fetchAllNodes}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                    </div>
                    
                    <div className="table-responsive">
                        <table className="nodes-table">
                            <thead>
                                <tr>
                                    <th>数据库ID</th>
                                    <th>节点名称</th>
                                    <th>描述</th>
                                    <th>繁荣度</th>
                                    <th>知识点</th>
                                    <th>内容分数</th>
                                    <th>状态</th>
                                    <th>创建者</th>
                                    <th>域主</th>
                                    <th>创建时间</th>
                                    <th>热门</th>
                                    <th>查看关联</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allNodes.map((node) => (
                                    <tr key={node._id}>
                                        <td className="id-cell">{node._id}</td>
                                        <td>
                                            {editingNode === node._id ? (
                                                <input
                                                    type="text"
                                                    value={editNodeForm.name}
                                                    onChange={(e) => setEditNodeForm({
                                                        ...editNodeForm,
                                                        name: e.target.value
                                                    })}
                                                    className="edit-input"
                                                />
                                            ) : (
                                                <span className="node-name-cell">{node.name}</span>
                                            )}
                                        </td>
                                        <td>
                                            {editingNode === node._id ? (
                                                <textarea
                                                    value={editNodeForm.description}
                                                    onChange={(e) => setEditNodeForm({
                                                        ...editNodeForm,
                                                        description: e.target.value
                                                    })}
                                                    className="edit-textarea"
                                                    rows="2"
                                                />
                                            ) : (
                                                <span className="node-description-cell">{node.description}</span>
                                            )}
                                        </td>
                                        <td>
                                            {editingNode === node._id ? (
                                                <input
                                                    type="number"
                                                    value={editNodeForm.prosperity}
                                                    onChange={(e) => setEditNodeForm({
                                                        ...editNodeForm,
                                                        prosperity: parseInt(e.target.value)
                                                    })}
                                                    className="edit-input-small"
                                                />
                                            ) : (
                                                Math.round(node.prosperity || 0)
                                            )}
                                        </td>
                                        <td>
                                            {editingNode === node._id ? (
                                                <div className="resource-inputs">
                                                    <input
                                                        type="text"
                                                        value={(node.knowledgePoint?.value || 0).toFixed(2)}
                                                        readOnly
                                                        className="edit-input-tiny"
                                                        placeholder="知识点"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="resource-display">
                                                    <span>{(node.knowledgePoint?.value || 0).toFixed(2)}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {editingNode === node._id ? (
                                                <div className="production-inputs">
                                                    <input
                                                        type="number"
                                                        value={editNodeForm.contentScore}
                                                        onChange={(e) => setEditNodeForm({
                                                            ...editNodeForm,
                                                            contentScore: parseInt(e.target.value)
                                                        })}
                                                        className="edit-input-tiny"
                                                        placeholder="内容分数"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="production-display">
                                                    <span>{node.contentScore || 1}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`status-badge status-${node.status}`}>
                                                {node.status === 'pending' ? '待审批' : 
                                                 node.status === 'approved' ? '已通过' : '已拒绝'}
                                            </span>
                                        </td>
                                        <td>{node.owner?.username || '系统'}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span>{node.domainMaster?.username || '(未设置)'}</span>
                                                <button
                                                    onClick={() => openChangeMasterModal(node)}
                                                    className="btn-action btn-primary-small"
                                                    title="更换域主"
                                                >
                                                    更换
                                                </button>
                                            </div>
                                        </td>
                                        <td>{new Date(node.createdAt).toLocaleString('zh-CN')}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {node.isFeatured && (
                                                    <span className="featured-badge-small">
                                                        热门 (排序: {node.featuredOrder || 0})
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => toggleFeaturedNode(node._id, node.isFeatured)}
                                                    className={`btn-action ${node.isFeatured ? 'btn-featured-active' : 'btn-featured'}`}
                                                >
                                                    {node.isFeatured ? '取消热门' : '设为热门'}
                                                </button>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button
                                                    onClick={() => openAssociationModal(node)}
                                                    className="btn-action btn-view"
                                                >
                                                    查看
                                                </button>
                                                <button
                                                    onClick={() => openEditAssociationModal(node)}
                                                    className="btn-action btn-edit"
                                                >
                                                    编辑
                                                </button>
                                            </div>
                                        </td>
                                        <td className="action-cell">
                                            {editingNode === node._id ? (
                                                <>
                                                    <button
                                                        onClick={() => saveNodeEdit(node._id)}
                                                        className="btn-action btn-save"
                                                    >
                                                        保存
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingNode(null)}
                                                        className="btn-action btn-cancel"
                                                    >
                                                        取消
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => startEditNode(node)}
                                                        className="btn-action btn-edit"
                                                    >
                                                        编辑
                                                    </button>
                                                    <button
                                                        onClick={() => deleteNode(node._id, node.name)}
                                                        className="btn-action btn-delete"
                                                    >
                                                        删除
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* 熵盟管理选项卡 */}
            {adminTab === 'alliances' && (
                <div className="alliances-admin-container">
                    <div className="table-info">
                        <p>总熵盟数: <strong>{adminAlliances.length}</strong></p>
                        <button
                            onClick={fetchAdminAlliances}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                    </div>

                    <div className="alliances-admin-grid">
                        {adminAlliances.map((alliance) => (
                            <div key={alliance._id} className="alliance-admin-card">
                                {editingAlliance && editingAlliance._id === alliance._id ? (
                                    /* 编辑模式 */
                                    <div className="alliance-edit-form">
                                        <div className="form-group">
                                            <label>熵盟名称</label>
                                            <input
                                                type="text"
                                                value={editAllianceForm.name}
                                                onChange={(e) => setEditAllianceForm({
                                                    ...editAllianceForm,
                                                    name: e.target.value
                                                })}
                                                className="form-input"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label>旗帜颜色</label>
                                            <div className="color-picker-group">
                                                <input
                                                    type="color"
                                                    value={editAllianceForm.flag}
                                                    onChange={(e) => setEditAllianceForm({
                                                        ...editAllianceForm,
                                                        flag: e.target.value
                                                    })}
                                                    className="color-picker"
                                                />
                                                <div className="flag-preview-small" style={{ backgroundColor: editAllianceForm.flag }}></div>
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label>熵盟号召</label>
                                            <textarea
                                                value={editAllianceForm.declaration}
                                                onChange={(e) => setEditAllianceForm({
                                                    ...editAllianceForm,
                                                    declaration: e.target.value
                                                })}
                                                className="form-textarea"
                                                rows="3"
                                            />
                                        </div>

                                        <div className="alliance-edit-actions">
                                            <button onClick={saveAllianceEdit} className="btn btn-success">
                                                保存
                                            </button>
                                            <button onClick={cancelEditAlliance} className="btn btn-secondary">
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* 查看模式 */
                                    <>
                                        <div className="alliance-admin-header">
                                            <div className="alliance-flag-medium" style={{ backgroundColor: alliance.flag }}></div>
                                            <div className="alliance-admin-info">
                                                <h3>{alliance.name}</h3>
                                                <p className="alliance-id">ID: {alliance._id}</p>
                                            </div>
                                        </div>

                                        <div className="alliance-admin-details">
                                            <div className="detail-row">
                                                <span className="detail-label">号召:</span>
                                                <span className="detail-value">{alliance.declaration}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">创始人:</span>
                                                <span className="detail-value">{alliance.founder?.username || '未知'}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">成员数:</span>
                                                <span className="detail-value">{alliance.memberCount}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">管辖域:</span>
                                                <span className="detail-value">{alliance.domainCount}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">创建时间:</span>
                                                <span className="detail-value">{new Date(alliance.createdAt).toLocaleString('zh-CN')}</span>
                                            </div>
                                        </div>

                                        <div className="alliance-admin-actions">
                                            <button
                                                onClick={() => startEditAlliance(alliance)}
                                                className="btn btn-primary"
                                            >
                                                编辑
                                            </button>
                                            <button
                                                onClick={() => deleteAlliance(alliance._id, alliance.name)}
                                                className="btn btn-danger"
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}

                        {adminAlliances.length === 0 && (
                            <div className="empty-alliances-admin">
                                <p>暂无熵盟</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Change Master Modal */}
            {showChangeMasterModal && changingMasterNode && (
                <div className="modal-backdrop" onClick={() => setShowChangeMasterModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>更换域主: {changingMasterNode.name}</h3>
                            <button className="btn-close" onClick={() => setShowChangeMasterModal(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>当前域主: {changingMasterNode.domainMaster?.username || '无'}</label>
                            </div>
                            <div className="form-group">
                                <label>搜索新域主:</label>
                                <div className="search-input-group">
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="输入用户名..."
                                        value={masterSearchKeyword}
                                        onChange={(e) => {
                                            setMasterSearchKeyword(e.target.value);
                                            searchUsersForMaster(e.target.value);
                                        }}
                                    />
                                    <button className="btn btn-primary" onClick={() => searchUsersForMaster(masterSearchKeyword)}>
                                        <Search size={16} />
                                    </button>
                                </div>
                            </div>
                            {masterSearchResults.length > 0 && (
                                <div className="search-results">
                                    <h5>搜索结果:</h5>
                                    {masterSearchResults.map(user => (
                                        <div
                                            key={user._id}
                                            className={`search-result-item ${selectedNewMaster?._id === user._id ? 'selected' : ''}`}
                                            onClick={() => setSelectedNewMaster(user)}
                                        >
                                            <span>{user.username}</span>
                                            {selectedNewMaster?._id === user._id && <Check size={16} className="text-green-500" />}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="form-group">
                                <label>已选择: {selectedNewMaster ? selectedNewMaster.username : '未选择 (将清除域主)'}</label>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowChangeMasterModal(false)}>取消</button>
                            <button className="btn btn-primary" onClick={confirmChangeMaster}>确认更换</button>
                        </div>
                    </div>
                </div>
            )}

            {/* View Association Modal */}
            {showAssociationModal && viewingAssociationNode && (
                <div className="modal-backdrop" onClick={() => setShowAssociationModal(false)}>
                    <div className="modal-content association-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>节点关联详情: {viewingAssociationNode.name}</h2>
                            <button className="btn-close" onClick={() => setShowAssociationModal(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="association-section">
                                <h4 className="section-title">母域节点 (Extends)</h4>
                                <div className="association-list">
                                    {viewingAssociationNode.relatedParentDomains?.length > 0 ? (
                                        <ul>
                                            {viewingAssociationNode.relatedParentDomains.map((domain, i) => (
                                                <li key={i} className="domain-item parent-domain">
                                                    <span className="domain-badge parent">⬆ 母域</span>
                                                    {domain}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <p className="empty-message">暂无母域节点</p>}
                                </div>
                            </div>
                            <div className="association-section">
                                <h4 className="section-title">子域节点 (Contains)</h4>
                                <div className="association-list">
                                    {viewingAssociationNode.relatedChildDomains?.length > 0 ? (
                                        <ul>
                                            {viewingAssociationNode.relatedChildDomains.map((domain, i) => (
                                                <li key={i} className="domain-item child-domain">
                                                    <span className="domain-badge child">⬇ 子域</span>
                                                    {domain}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <p className="empty-message">暂无子域节点</p>}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAssociationModal(false)}>关闭</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Association Modal */}
            {showEditAssociationModal && editingAssociationNode && (
                <div className="modal-backdrop" onClick={() => setShowEditAssociationModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>编辑关联: {editingAssociationNode.name}</h3>
                            <button className="btn-close" onClick={() => setShowEditAssociationModal(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>现有关联:</label>
                                <div className="associations-list">
                                    {editAssociations.length === 0 ? <p className="text-gray-400">暂无关联</p> : (
                                        editAssociations.map((assoc, index) => (
                                            <div key={index} className="association-item">
                                                <div className="association-info">
                                                    <span className="relation-type">
                                                        {assoc.relationType === 'contains' ? '包含 (Contains)' : '拓展 (Extends)'}
                                                    </span>
                                                    <span className="node-name">{assoc.targetNodeName}</span>
                                                </div>
                                                <button onClick={() => removeEditAssociation(index)} className="btn-danger btn-small">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="form-group">
                                <label>添加新关联:</label>
                                <div className="relation-type-section">
                                    <div className="relation-options">
                                        <label className="radio-label">
                                            <input
                                                type="radio"
                                                name="assocType"
                                                checked={newAssocType === 'contains'}
                                                onChange={() => setNewAssocType('contains')}
                                            />
                                            包含 (Contains)
                                        </label>
                                        <label className="radio-label">
                                            <input
                                                type="radio"
                                                name="assocType"
                                                checked={newAssocType === 'extends'}
                                                onChange={() => setNewAssocType('extends')}
                                            />
                                            拓展 (Extends)
                                        </label>
                                    </div>
                                </div>
                                <div className="search-input-group">
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="搜索节点..."
                                        value={assocSearchKeyword}
                                        onChange={(e) => {
                                            setAssocSearchKeyword(e.target.value);
                                            searchAssociationNodes(e.target.value);
                                        }}
                                    />
                                    <button className="btn btn-primary" onClick={() => searchAssociationNodes(assocSearchKeyword)}>
                                        <Search size={16} />
                                    </button>
                                </div>
                                {assocSearchResults.length > 0 && (
                                    <div className="search-results">
                                        {assocSearchResults.map(node => (
                                            <div
                                                key={node._id}
                                                className="search-result-item"
                                                onClick={() => addEditAssociation(node)}
                                            >
                                                <span>{node.name}</span>
                                                <Plus size={16} className="text-green-500" />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowEditAssociationModal(false)}>取消</button>
                            <button className="btn btn-primary" onClick={saveAssociationEdit}>保存更改</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPanel;