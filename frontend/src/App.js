import React, { useState, useEffect, useRef } from 'react';
import { Play, Plus, Zap, Sword, FlaskConical, Link, Users, Home, Search, X, Check, Bell } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';

const App = () => {
    const [socket, setSocket] = useState(null);
    const [authenticated, setAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [nodes, setNodes] = useState([]);
    const [selectedNode, setSelectedNode] = useState(null);
    const [armies, setArmies] = useState([]);
    const [technologies, setTechnologies] = useState([]);
    const [view, setView] = useState('login');
    const canvasRef = useRef(null);
    const socketRef = useRef(null);
    const [systemStats, setSystemStats] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [allUsers, setAllUsers] = useState([]);
    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState({
      username: '',
      password: '',
      level: 0,
      experience: 0
    });

    // 新节点创建状态
    const [showCreateNodeModal, setShowCreateNodeModal] = useState(false);
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
    const [showNotifications, setShowNotifications] = useState(false);
    const [pendingNodes, setPendingNodes] = useState([]);
    useEffect(() => {
        if (socketRef.current) {
            return;
        }

        const newSocket = io('http://192.168.1.96:5000', {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5,
            timeout: 20000,
            autoConnect: true
        });
        
        newSocket.on('connect', () => {
            console.log('WebSocket 连接成功:', newSocket.id);
        });

        newSocket.on('connect_error', (error) => {
            console.error('WebSocket 连接错误:', error);
        });

        newSocket.on('disconnect', (reason) => {
            console.log('WebSocket 断开连接:', reason);
        });

        newSocket.on('authenticated', (data) => {
            setAuthenticated(true);
            setView('game');
            newSocket.emit('getGameState');
        });

        newSocket.on('gameState', (data) => {
            setNodes(data.nodes || []);
            setArmies(data.armies || []);
        });

        newSocket.on('nodeCreated', (node) => {
            setNodes(prev => [...prev, node]);
        });

        newSocket.on('armyProduced', (data) => {
            setArmies(prev => {
                const existing = prev.find(a => a.nodeId === data.nodeId && a.type === data.type);
                if (existing) {
                    return prev.map(a => 
                        a.nodeId === data.nodeId && a.type === data.type 
                            ? { ...a, count: a.count + data.count }
                            : a
                    );
                }
                return [...prev, data.army];
            });
        });

        newSocket.on('techUpgraded', (tech) => {
            setTechnologies(prev => {
                const existing = prev.find(t => t.techId === tech.techId);
                if (existing) {
                    return prev.map(t => t.techId === tech.techId ? tech : t);
                }
                return [...prev, tech];
            });
        });

        newSocket.on('resourcesUpdated', () => {
            newSocket.emit('getGameState');
        });

        socketRef.current = newSocket;
        setSocket(newSocket);

        return () => {
            if (socketRef.current) {
                socketRef.current.removeAllListeners();
                socketRef.current.close();
                socketRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (canvasRef.current && nodes.length > 0) {
            drawNetwork();
        }
    }, [nodes, selectedNode]);

    const drawNetwork = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // 绘制连接线
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 2;
        nodes.forEach(node => {
            node.connectedNodes?.forEach(connectedId => {
                const connectedNode = nodes.find(n => n._id === connectedId);
                if (connectedNode) {
                    ctx.beginPath();
                    ctx.moveTo(node.position.x, node.position.y);
                    ctx.lineTo(connectedNode.position.x, connectedNode.position.y);
                    ctx.stroke();
                }
            });
        });

        // 绘制节点
        nodes.forEach(node => {
            const prosperity = node.prosperity || 100;
            const radius = 15 + (prosperity / 50);
            
            // 节点光晕
            const gradient = ctx.createRadialGradient(
                node.position.x, node.position.y, 0,
                node.position.x, node.position.y, radius
            );
            gradient.addColorStop(0, `rgba(59, 130, 246, ${prosperity / 200})`);
            gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(node.position.x, node.position.y, radius * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // 节点主体
            ctx.fillStyle = selectedNode?._id === node._id ? '#3b82f6' : '#6366f1';
            ctx.beginPath();
            ctx.arc(node.position.x, node.position.y, radius, 0, Math.PI * 2);
            ctx.fill();

            // 节点边框
            ctx.strokeStyle = '#1e40af';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 节点名称
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(node.name, node.position.x, node.position.y - radius - 5);
        });
    };

    const handleLogin = async (isRegister = false) => {
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/${isRegister ? 'register' : 'login'}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            if (response.ok) {
                localStorage.setItem('token', data.token);
                socket.emit('authenticate', data.token);
                await checkAdminStatus();
            } else {
                window.alert(data.error);
            }
        } catch (error) {
            window.alert('连接失败: ' + error.message);
        }
    };

    const handleCreateNode = () => {
        const name = window.prompt('输入节点名称:');
        if (!name) return;

        const x = Math.random() * 700 + 50;
        const y = Math.random() * 400 + 50;

        socket.emit('createNode', {
            name,
            position: { x, y }
        });
    };

    const handleProduceArmy = (type) => {
        if (!selectedNode) {
            window.alert('请先选择一个节点');
            return;
        }

        const count = parseInt(window.prompt(`生产${type}数量:`));
        if (!count || count <= 0) return;

        socket.emit('produceArmy', {
            nodeId: selectedNode._id,
            type,
            count
        });
    };

    const handleUpgradeTech = (techId) => {
        socket.emit('upgradeTech', { techId });
    };

    const handleCanvasClick = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        
        // 计算Canvas坐标系统的缩放比例
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        // 将点击坐标转换为Canvas内部坐标
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const clickedNode = nodes.find(node => {
            const prosperity = node.prosperity || 100;
            const radius = 15 + (prosperity / 50);
            
            const dx = node.position.x - x;
            const dy = node.position.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // 使用节点的实际绘制半径作为点击检测范围
            return distance < (radius * 1.5); // 包括光晕区域
        });

        setSelectedNode(clickedNode || null);
    };

    const checkAdminStatus = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;
    
        try {
            const response = await fetch('http://192.168.1.96:5000/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
    
            if (response.ok) {
                setIsAdmin(true);
            }
        } catch (error) {
            console.log('非管理员用户');
        }
    };    

    // 获取所有用户信息
    const fetchAllUsers = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://192.168.1.96:5000/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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
            const response = await fetch(`http://192.168.1.96:5000/api/admin/users/${userId}`, {
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
            const response = await fetch(`http://192.168.1.96:5000/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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

    // 新节点创建相关函数
    const openCreateNodeModal = () => {
        setShowCreateNodeModal(true);
        setNewNodeData({ title: '', description: '' });
        setAssociations([]);
        setSelectedNodes([]);
        setSearchResults([]);
        setSearchKeyword('');
    };

    const searchNodes = async () => {
        if (!searchKeyword.trim()) {
            setSearchResults([]);
            return;
        }

        setSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/search?keyword=${encodeURIComponent(searchKeyword)}`, {
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
        
        // 检查标题唯一性（在前端进行基本检查，后端会再次验证）
        const isTitleUnique = !nodes.some(node => node.name === newNodeData.title);
        
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

            const response = await fetch('http://192.168.1.96:5000/api/nodes/create', {
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
                    setNodes(prev => [...prev, data]);
                } else {
                    alert('节点创建申请已提交，等待管理员审批');
                }
                setShowCreateNodeModal(false);
            } else {
                alert(data.error || '创建失败');
            }
        } catch (error) {
            console.error('创建节点失败:', error);
            alert('创建失败');
        }
    };

    const fetchPendingNodes = async () => {
        if (!isAdmin) return;
        
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://192.168.1.96:5000/api/nodes/pending', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                setPendingNodes(data);
            }
        } catch (error) {
            console.error('获取待审批节点失败:', error);
        }
    };

    const approveNode = async (nodeId) => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://192.168.1.96:5000/api/nodes/approve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nodeId })
            });

            if (response.ok) {
                alert('节点审批通过');
                setPendingNodes(prev => prev.filter(node => node._id !== nodeId));
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
            const response = await fetch('http://192.168.1.96:5000/api/nodes/reject', {
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

    if (view === 'login') {
        return (
            <div className="login-container">
                <div className="login-box">
                    <div className="login-header">
                        <h1 className="login-title">策略经营游戏</h1>
                        <p className="login-subtitle">多节点网络战略系统</p>
                    </div>
                    
                    <div className="login-form">
                        <input
                            type="text"
                            placeholder="用户名"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="login-input"
                        />
                        <input
                            type="password"
                            placeholder="密码"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="login-input"
                        />
                        <div className="login-buttons">
                            <button
                                onClick={() => handleLogin(false)}
                                className="btn btn-primary"
                            >
                                登录
                            </button>
                            <button
                                onClick={() => handleLogin(true)}
                                className="btn btn-secondary"
                            >
                                注册
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="game-container">
            <div className="game-content">
                {/* 头部 */}
                <div className="header">
                    <div className="header-content">
                        <h1 className="header-title">
                            <Home className="icon" />
                            多节点策略系统
                        </h1>
                        <div className="header-buttons">
                            <button
                                onClick={() => setView('game')}
                                className="btn btn-primary"
                            >
                                地图
                            </button>
                            <button
                                onClick={() => setView('tech')}
                                className="btn btn-secondary"
                            >
                                科技
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => {
                                        setView('admin');
                                        fetchAllUsers();
                                    }}
                                    className="btn btn-warning"
                                >
                                    管理员面板
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {view === 'game' && (
                    <div className="game-layout">
                        {/* 主地图区域 */}
                        <div className="map-section">
                            <div className="section-header">
                                <h2 className="section-title">节点网络图</h2>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button
                                    onClick={openCreateNodeModal}
                                    className="btn btn-success"
                                >
                                    <Plus className="icon-small" />
                                    创建节点
                                </button>
                                {!isAdmin && (
                                    <button
                                        onClick={() => {
                                            setShowNotifications(!showNotifications);
                                            fetchPendingNodes();
                                        }}
                                        className="btn btn-info"
                                    >
                                        <Bell className="icon-small" />
                                        通知
                                        {pendingNodes.length > 0 && (
                                            <span className="notification-badge">{pendingNodes.length}</span>
                                        )}
                                    </button>
                                )}
                            </div>
                            </div>
                            <canvas
                                ref={canvasRef}
                                width={800}
                                height={500}
                                onClick={handleCanvasClick}
                                className="game-canvas"
                            />
                        </div>

                        {/* 侧边栏 */}
                        <div className="sidebar">
                            {/* 节点信息 */}
                            <div className="card">
                                <h3 className="card-title">
                                    <Zap className="icon-small icon-yellow" />
                                    {selectedNode ? selectedNode.name : '未选择节点'}
                                </h3>
                                
                                {selectedNode && (
                                    <div className="card-content">
                                        <div className="info-box">
                                            <p className="info-label">繁荣度</p>
                                            <div className="progress-container">
                                                <div className="progress-bar">
                                                    <div
                                                        className="progress-fill"
                                                        style={{ width: `${Math.min(selectedNode.prosperity || 0, 100)}%` }}
                                                    />
                                                </div>
                                                <span className="progress-value">{Math.round(selectedNode.prosperity || 0)}</span>
                                            </div>
                                        </div>

                                        <div className="info-box">
                                            <p className="info-label">资源</p>
                                            <div className="resource-list">
                                                <div className="resource-item">
                                                    <span>食物:</span>
                                                    <span className="resource-value">{Math.round(selectedNode.resources?.food || 0)}</span>
                                                </div>
                                                <div className="resource-item">
                                                    <span>金属:</span>
                                                    <span className="resource-value">{Math.round(selectedNode.resources?.metal || 0)}</span>
                                                </div>
                                                <div className="resource-item">
                                                    <span>能量:</span>
                                                    <span className="resource-value">{Math.round(selectedNode.resources?.energy || 0)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="info-box">
                                            <p className="info-label">生产率</p>
                                            <div className="resource-list">
                                                <div className="resource-item">
                                                    <span>食物/分:</span>
                                                    <span className="resource-value">{selectedNode.productionRates?.food || 0}</span>
                                                </div>
                                                <div className="resource-item">
                                                    <span>金属/分:</span>
                                                    <span className="resource-value">{selectedNode.productionRates?.metal || 0}</span>
                                                </div>
                                                <div className="resource-item">
                                                    <span>能量/分:</span>
                                                    <span className="resource-value">{selectedNode.productionRates?.energy || 0}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 军队生产 */}
                            <div className="card">
                                <h3 className="card-title">
                                    <Sword className="icon-small icon-red" />
                                    军队生产
                                </h3>
                                
                                <div className="army-grid">
                                    {[
                                        { type: 'infantry', label: '步兵' },
                                        { type: 'cavalry', label: '骑兵' },
                                        { type: 'archer', label: '弓箭手' },
                                        { type: 'siege', label: '攻城器' }
                                    ].map(army => (
                                        <button
                                            key={army.type}
                                            onClick={() => handleProduceArmy(army.type)}
                                            disabled={!selectedNode}
                                            className="btn btn-danger"
                                        >
                                            {army.label}
                                        </button>
                                    ))}
                                </div>

                                {selectedNode && (
                                    <div className="army-list">
                                        {armies
                                            .filter(a => a.nodeId === selectedNode._id)
                                            .map((army, idx) => (
                                                <div key={idx} className="army-item">
                                                    <span className="army-name">
                                                        {army.type === 'infantry' ? '步兵' :
                                                         army.type === 'cavalry' ? '骑兵' :
                                                         army.type === 'archer' ? '弓箭手' : '攻城器'}
                                                    </span>
                                                    <span className="army-count">×{army.count}</span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 节点创建模态框 */}
                        {showCreateNodeModal && (
                            <div className="modal-overlay">
                                <div className="modal-content">
                                    <div className="modal-header">
                                        <h3>创建新节点</h3>
                                        <button 
                                            onClick={() => setShowCreateNodeModal(false)}
                                            className="btn-close"
                                        >
                                            <X className="icon-small" />
                                        </button>
                                    </div>
                                    
                                    <div className="modal-body">
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
                                            {newNodeData.title.trim() !== '' && nodes.some(node => node.name === newNodeData.title) && (
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
                                            onClick={() => setShowCreateNodeModal(false)}
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
                        )}

                        {/* 通知面板 */}
                        {showNotifications && !isAdmin && (
                            <div className="notifications-panel">
                                <div className="notifications-header">
                                    <h3>节点创建申请</h3>
                                    <button 
                                        onClick={() => setShowNotifications(false)}
                                        className="btn-close"
                                    >
                                        <X className="icon-small" />
                                    </button>
                                </div>
                                
                                <div className="notifications-body">
                                    {pendingNodes.length === 0 ? (
                                        <div className="no-notifications">
                                            <p>暂无待处理申请</p>
                                        </div>
                                    ) : (
                                        <div className="pending-nodes-list">
                                            {pendingNodes.map(node => (
                                                <div key={node._id} className="pending-node-item">
                                                    <div className="node-details">
                                                        <h4>{node.name}</h4>
                                                        <p className="node-description">{node.description}</p>
                                                        <div className="associations-summary">
                                                            关联关系: {node.associations?.length || 0} 个
                                                        </div>
                                                    </div>
                                                    <div className="node-status">
                                                        <span className={`status-badge status-${node.status}`}>
                                                            {node.status === 'pending' ? '待审批' : 
                                                             node.status === 'approved' ? '已通过' : '已拒绝'}
                                                        </span>
                                                        <div className="submission-time">
                                                            提交时间: {new Date(node.createdAt).toLocaleString('zh-CN')}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {view === 'tech' && (
                    <div className="tech-section">
                        <h2 className="section-title-large">
                            <FlaskConical className="icon" />
                            科技树
                        </h2>
                        
                        <div className="tech-grid">
                            {[
                                { id: 'agriculture', name: '农业科技', icon: '🌾', color: 'green' },
                                { id: 'metallurgy', name: '冶金学', icon: '⚒️', color: 'orange' },
                                { id: 'warfare', name: '军事学', icon: '⚔️', color: 'red' },
                                { id: 'engineering', name: '工程学', icon: '🏗️', color: 'blue' }
                            ].map(tech => {
                                const userTech = technologies.find(t => t.techId === tech.id);
                                const level = userTech?.level || 0;

                                return (
                                    <div key={tech.id} className="tech-card">
                                        <div className="tech-header">
                                            <div className="tech-info">
                                                <span className="tech-icon">{tech.icon}</span>
                                                <div>
                                                    <h3 className="tech-name">{tech.name}</h3>
                                                    <p className="tech-level">等级 {level}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => handleUpgradeTech(tech.id)}
                                            className={`btn btn-${tech.color}`}
                                        >
                                            升级到 {level + 1} 级
                                        </button>

                                        {userTech && (
                                            <div className="tech-effects">
                                                <p>繁荣度加成: +{(userTech.effects.prosperityBonus * 100).toFixed(0)}%</p>
                                                <p>生产加成: +{(userTech.effects.productionBonus * 100).toFixed(0)}%</p>
                                                <p>军事加成: +{(userTech.effects.militaryBonus * 100).toFixed(0)}%</p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                {view === 'admin' && isAdmin && (
                    <div className="admin-section">
                        <h2 className="section-title-large">
                            <Users className="icon" />
                            管理员面板 - 用户数据库
                        </h2>

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
                                                        <span className="username-cell">{user.username}</span>
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
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
