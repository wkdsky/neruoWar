import React, { useState, useEffect, useRef } from 'react';
import { Play, Plus, Zap, Sword, FlaskConical, Link, Users, Home } from 'lucide-react';
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
                alert(data.error);
            }
        } catch (error) {
            alert('连接失败: ' + error.message);
        }
    };

    const handleCreateNode = () => {
        const name = prompt('输入节点名称:');
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
            alert('请先选择一个节点');
            return;
        }

        const count = parseInt(prompt(`生产${type}数量:`));
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
        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const clickedNode = nodes.find(node => {
            const dx = node.position.x - x;
            const dy = node.position.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance < 20;
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
        if (!confirm(`确定要删除用户 ${username} 吗？`)) return;
        
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
                                <button
                                    onClick={handleCreateNode}
                                    className="btn btn-success"
                                >
                                    <Plus className="icon-small" />
                                    创建节点
                                </button>
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