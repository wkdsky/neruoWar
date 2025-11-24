import React, { useState, useEffect, useRef } from 'react';
import { Play, Plus, Zap, Sword, FlaskConical, Link, Users, Home, Search, X, Check, Bell, Shield } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';
import SceneManager from './SceneManager';
import LocationSelectionModal from './LocationSelectionModal';

const App = () => {
    const [socket, setSocket] = useState(null);
    const [authenticated, setAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [nodes, setNodes] = useState([]);
    const [technologies, setTechnologies] = useState([]);
    const [view, setView] = useState('login');
    const socketRef = useRef(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [allUsers, setAllUsers] = useState([]);
    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState({
      username: '',
      password: '',
      level: 0,
      experience: 0
    });

    // 修改检查登录状态的useEffect
    useEffect(() => {
        const token = localStorage.getItem('token');
        const storedUsername = localStorage.getItem('username');
        const storedLocation = localStorage.getItem('userLocation');

        if (token && storedUsername) {
            setAuthenticated(true);
            setUsername(storedUsername);
            setUserLocation(storedLocation || '');

            // 如果location为空，需要显示位置选择弹窗
            if (!storedLocation || storedLocation === '') {
                // 先获取热门节点，然后显示弹窗
                fetchFeaturedNodes();
                setShowLocationModal(true);
            } else {
                setView('home');
            }

            // 如果socket已连接，重新认证
            if (socket && socket.connected) {
                socket.emit('authenticate', token);
                setTimeout(() => {
                    socket.emit('getGameState');
                }, 200);
            }

            // 检查管理员状态
            checkAdminStatus();
        }
    }, []); // 只在组件挂载时执行一次


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
    const [adminTab, setAdminTab] = useState('users'); // 管理员面板选项卡状态
    const [allNodes, setAllNodes] = useState([]); // 所有节点数据
    const [editingNode, setEditingNode] = useState(null); // 正在编辑的节点
    const [editNodeForm, setEditNodeForm] = useState({
      name: '',
      description: '',
      prosperity: 0,
      resources: { food: 0, metal: 0, energy: 0 },
      productionRates: { food: 0, metal: 0, energy: 0 }
    });

    // 更换域主相关状态
    const [showChangeMasterModal, setShowChangeMasterModal] = useState(false);
    const [changingMasterNode, setChangingMasterNode] = useState(null);
    const [masterSearchKeyword, setMasterSearchKeyword] = useState('');
    const [masterSearchResults, setMasterSearchResults] = useState([]);
    const [selectedNewMaster, setSelectedNewMaster] = useState(null);

    // 熵盟管理相关状态
    const [adminAlliances, setAdminAlliances] = useState([]);
    const [editingAlliance, setEditingAlliance] = useState(null);
    const [editAllianceForm, setEditAllianceForm] = useState({
      name: '',
      flag: '',
      declaration: ''
    });

    const [showAssociationModal, setShowAssociationModal] = useState(false);
    const [viewingAssociationNode, setViewingAssociationNode] = useState(null);

    // 编辑关联相关状态
    const [showEditAssociationModal, setShowEditAssociationModal] = useState(false);
    const [editingAssociationNode, setEditingAssociationNode] = useState(null);
    const [editAssociations, setEditAssociations] = useState([]);
    const [assocSearchKeyword, setAssocSearchKeyword] = useState('');
    const [assocSearchResults, setAssocSearchResults] = useState([]);
    const [newAssocType, setNewAssocType] = useState('contains');

    // 用户位置相关状态
    const [userLocation, setUserLocation] = useState('');
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [selectedLocationNode, setSelectedLocationNode] = useState(null);
    const [currentLocationNodeDetail, setCurrentLocationNodeDetail] = useState(null);

    // 首页相关状态
    const [rootNodes, setRootNodes] = useState([]);
    const [featuredNodes, setFeaturedNodes] = useState([]);
    const [homeSearchQuery, setHomeSearchQuery] = useState('');
    const [homeSearchResults, setHomeSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    // 节点详情页面相关状态
    const [currentNodeDetail, setCurrentNodeDetail] = useState(null);
    const [showNodeInfoModal, setShowNodeInfoModal] = useState(false);
    const detailCanvasRef = useRef(null);

    // 导航路径相关状态
    const [navigationPath, setNavigationPath] = useState([{ type: 'home', label: '首页' }]);
    const [showNavigationTree, setShowNavigationTree] = useState(false);
    const [fullNavigationPaths, setFullNavigationPaths] = useState([]);
    const treeCanvasRef = useRef(null);

    // WebGL场景管理
    const webglCanvasRef = useRef(null);
    const sceneManagerRef = useRef(null);
    const [isWebGLReady, setIsWebGLReady] = useState(false);
    const [clickedNodeForTransition, setClickedNodeForTransition] = useState(null);
    const [canvasKey, setCanvasKey] = useState(0); // 用于强制重新渲染canvas

    // 熵盟相关状态
    const [alliances, setAlliances] = useState([]);
    const [selectedAlliance, setSelectedAlliance] = useState(null);
    const [showAllianceDetailModal, setShowAllianceDetailModal] = useState(false);
    const [showCreateAllianceModal, setShowCreateAllianceModal] = useState(false);
    const [newAllianceData, setNewAllianceData] = useState({
        name: '',
        flag: '#7c3aed',
        declaration: ''
    });
    const [userAlliance, setUserAlliance] = useState(null);

    // 初始化WebGL场景
    useEffect(() => {
        const canvas = webglCanvasRef.current;
        if (!canvas) {
            // canvas不存在时，清理旧的场景管理器
            if (sceneManagerRef.current) {
                sceneManagerRef.current.destroy();
                sceneManagerRef.current = null;
                setIsWebGLReady(false);
            }
            return;
        }

        // 每次view变化时，清理并重新创建场景管理器
        if (sceneManagerRef.current) {
            sceneManagerRef.current.destroy();
            sceneManagerRef.current = null;
        }

        try {
            const parent = canvas.parentElement;
            if (!parent) return;

            // 设置canvas大小
            const rect = parent.getBoundingClientRect();
            canvas.width = rect.width || 800;
            canvas.height = rect.height || 600;

            // 创建场景管理器
            const sceneManager = new SceneManager(canvas);

            // 设置点击回调
            sceneManager.onNodeClick = (node) => {
                if (!node.data || !node.data._id) return;

                // 如果在节点详情页，且点击的是中央节点，显示详情弹窗
                if (view === 'nodeDetail' && node.type === 'center') {
                    setShowNodeInfoModal(true);
                } else {
                    // 其他情况：导航到节点详情页
                    fetchNodeDetail(node.data._id, node);
                }
            };

            sceneManagerRef.current = sceneManager;
            setIsWebGLReady(true);

            // 监听窗口大小变化
            const handleResize = () => {
                const newRect = parent.getBoundingClientRect();
                if (newRect.width > 0 && newRect.height > 0) {
                    canvas.width = newRect.width;
                    canvas.height = newRect.height;
                    if (sceneManagerRef.current) {
                        sceneManagerRef.current.resize(newRect.width, newRect.height);
                    }
                }
            };

            window.addEventListener('resize', handleResize);

            return () => {
                window.removeEventListener('resize', handleResize);
            };
        } catch (error) {
            console.error('WebGL初始化失败:', error);
        }
    }, [view, canvasKey]); // 添加canvasKey作为依赖，用于强制重新初始化

    useEffect(() => {
        // 只在没有socket时初始化
        if (!socketRef.current) {
            initializeSocket();
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
            // 如果用户已经登录，自动认证
            const token = localStorage.getItem('token');
            if (token) {
                newSocket.emit('authenticate', token);
            }
        });
    
        newSocket.on('connect_error', (error) => {
            console.error('WebSocket 连接错误:', error);
        });
    
        newSocket.on('disconnect', (reason) => {
            console.log('WebSocket 断开连接:', reason);
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
        // ... 其他代码
        if (isAdmin) {
            fetchPendingNodes();
        }
    }, [isAdmin]);
    
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
        localStorage.setItem('username', data.username);
        localStorage.setItem('userLocation', data.location || '');
        setAuthenticated(true);
        setUsername(data.username);
        setUserLocation(data.location || '');

        // 重新初始化socket连接（连接事件中会处理认证）
        initializeSocket(data.token);

        await checkAdminStatus();

        // 检查location字段，如果为空且不是管理员，显示位置选择弹窗
        if (!data.location || data.location === '') {
          if (data.role === 'admin') {
            // 管理员自动设置location为"任意"
            await updateUserLocation('任意');
            setUserLocation('任意');
            localStorage.setItem('userLocation', '任意');
            setView('home');
          } else {
            // 普通用户显示位置选择弹窗
            setShowLocationModal(true);
            // 不设置view，保持在登录状态但显示弹窗
          }
        } else {
          setView('home');
        }
      } else {
        window.alert(data.error);
      }
    } catch (error) {
      window.alert('连接失败: ' + error.message);
    }
  };

  // 更新用户location
  const updateUserLocation = async (location) => {
    const token = localStorage.getItem('token');
    try {
      console.log('正在更新location:', location);
      const response = await fetch('http://192.168.1.96:5000/api/location', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ location })
      });

      const data = await response.json();

      if (response.ok) {
        console.log('location更新成功:', data.location);
        return data.location;
      } else {
        console.error('location更新失败:', data);
        window.alert(`设置降临位置失败: ${data.error || '未知错误'}`);
        return null;
      }
    } catch (error) {
      console.error('更新location失败:', error);
      window.alert(`网络错误: ${error.message}`);
      return null;
    }
  };

  // 处理位置选择确认
  const handleLocationConfirm = async (selectedNode) => {
    console.log('用户选择的节点:', selectedNode);

    if (!selectedNode || !selectedNode.name) {
      window.alert('选择的节点无效，请重新选择');
      return;
    }

    const locationName = selectedNode.name;
    const updatedLocation = await updateUserLocation(locationName);

    if (updatedLocation) {
      setUserLocation(updatedLocation);
      setSelectedLocationNode(selectedNode);
      setCurrentLocationNodeDetail(selectedNode);
      localStorage.setItem('userLocation', updatedLocation);

      // 关闭modal并切换到home视图
      setShowLocationModal(false);
      setView('home');

      // 强制重新初始化WebGL（确保canvas渲染后再初始化）
      setTimeout(() => {
        setCanvasKey(prev => prev + 1);
      }, 50);
    }
    // 如果失败，updateUserLocation已经显示了错误消息，保持弹窗打开
  };

  // 根据location名称获取节点详细信息
  const fetchLocationNodeDetail = async (locationName) => {
    if (!locationName || locationName === '' || locationName === '任意') {
      setCurrentLocationNodeDetail(null);
      return;
    }

    try {
      const response = await fetch(`http://192.168.1.96:5000/api/nodes/public/search?query=${encodeURIComponent(locationName)}`);
      if (response.ok) {
        const data = await response.json();
        // 精确匹配节点名称
        const exactMatch = data.results.find(node => node.name === locationName);
        if (exactMatch) {
          // 获取完整的节点详情
          const detailResponse = await fetch(`http://192.168.1.96:5000/api/nodes/public/node-detail/${exactMatch._id}`);
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            setCurrentLocationNodeDetail(detailData.node);
          } else {
            setCurrentLocationNodeDetail(exactMatch);
          }
        }
      }
    } catch (error) {
      console.error('获取位置节点详情失败:', error);
    }
  };

  // 当userLocation变化时，获取节点详情
  useEffect(() => {
    if (authenticated && userLocation) {
      fetchLocationNodeDetail(userLocation);
    }
  }, [userLocation, authenticated]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('userLocation');
        setAuthenticated(false);
        setUsername('');
        setPassword('');
        setView('login');
        setIsAdmin(false);
        setUserLocation('');
        setSelectedLocationNode(null);
        setShowLocationModal(false);
        
        // 清理socket连接和引用
        if (socket) {
            socket.disconnect();
        }
        if (socketRef.current) {
            socketRef.current.removeAllListeners();
            socketRef.current.close();
            socketRef.current = null; // 关键：清空引用
        }
        setSocket(null); // 清空state
        
        // 清理节点数据
        setNodes([]);
    };

    // 将socket初始化逻辑提取为独立函数
    const initializeSocket = (token = null) => {
        // 如果已存在socket，先清理
        if (socketRef.current) {
            socketRef.current.removeAllListeners();
            socketRef.current.close();
            socketRef.current = null;
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
            const authToken = token || localStorage.getItem('token');
            if (authToken) {
                newSocket.emit('authenticate', authToken);
                // 认证后立即请求游戏状态
                setTimeout(() => {
                    newSocket.emit('getGameState');
                }, 200);
            }
            
            // 如果是登录操作，立即获取游戏状态
            if (token) {
                setTimeout(() => {
                    newSocket.emit('getGameState');
                }, 300);
            }
        });
    
        newSocket.on('connect_error', (error) => {
            console.error('WebSocket 连接错误:', error);
        });
    
        newSocket.on('disconnect', (reason) => {
            console.log('WebSocket 断开连接:', reason);
        });
    
        newSocket.on('authenticated', (data) => {
            console.log('认证成功');
            setAuthenticated(true);
            setView('home');
            newSocket.emit('getGameState');
        });
    
        newSocket.on('gameState', (data) => {
            console.log('收到游戏状态:', data);
            const approvedNodes = (data.nodes || []).filter(node => node.status === 'approved');
            setNodes(approvedNodes);
        });

    newSocket.on('nodeCreated', (node) => {
            if (node.status === 'approved') {
                setNodes(prev => [...prev, node]);
            }
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
    
        // 【关键修改】添加知识点更新监听器
        newSocket.on('knowledgePointUpdated', (updatedNodes) => {
            console.log('收到知识点更新:', updatedNodes);
            setNodes(prevNodes => {
                const updatedNodeMap = new Map();
                updatedNodes.forEach(node => updatedNodeMap.set(node._id, node));
                
                // 更新现有节点状态 - 创建全新节点对象
                const newNodes = prevNodes.map(node => {
                    const updatedNode = updatedNodeMap.get(node._id);
                    if (updatedNode) {
                        // 创建全新的节点对象
                        return {
                            ...node,
                            knowledgePoint: updatedNode.knowledgePoint
                        };
                    }
                    return node;
                });
                
                return newNodes;
            });
        });

        socketRef.current = newSocket;
        setSocket(newSocket);
        
        return newSocket;
    };

    const handleUpgradeTech = (techId) => {
        socket.emit('upgradeTech', { techId });
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

    // 获取根节点
    const fetchRootNodes = async () => {
        try {
            const response = await fetch('http://192.168.1.96:5000/api/nodes/public/root-nodes');
            if (response.ok) {
                const data = await response.json();
                setRootNodes(data.nodes);
            }
        } catch (error) {
            console.error('获取根节点失败:', error);
        }
    };

    // 获取热门节点
    const fetchFeaturedNodes = async () => {
        try {
            const response = await fetch('http://192.168.1.96:5000/api/nodes/public/featured-nodes');
            if (response.ok) {
                const data = await response.json();
                setFeaturedNodes(data.nodes);
            }
        } catch (error) {
            console.error('获取热门节点失败:', error);
        }
    };

    // 构建从当前节点到根节点的所有路径
    const buildPathsToRoot = async (nodeId) => {
        try {
            // 使用公开API端点，所有用户都可以访问
            const response = await fetch('http://192.168.1.96:5000/api/nodes/public/all-nodes');

            if (!response.ok) return [];

            const data = await response.json();
            const allNodes = data.nodes || [];

            // 创建节点映射
            const nodeMap = new Map();
            allNodes.forEach(node => {
                nodeMap.set(node._id, node);
            });

            // 递归查找所有到根节点的路径
            const findPaths = (currentNodeId, visited = new Set()) => {
                if (visited.has(currentNodeId)) return []; // 避免循环

                const currentNode = nodeMap.get(currentNodeId);
                if (!currentNode) return [];

                visited.add(currentNodeId);

                // 获取关联母域（被谁包含）
                const parentDomains = currentNode.relatedParentDomains || [];

                // 如果没有关联母域，说明是根节点
                if (parentDomains.length === 0) {
                    return [[currentNode]];
                }

                // 查找所有父节点的路径
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

            return findPaths(nodeId);
        } catch (error) {
            console.error('构建路径失败:', error);
            return [];
        }
    };

    // 应用省略规则并生成导航路径
    const generateNavigationPath = (paths) => {
        if (paths.length === 0) return [{ type: 'home', label: '首页' }];

        const nav = [{ type: 'home', label: '首页' }];

        // 如果只有一条路径，直接显示
        if (paths.length === 1) {
            paths[0].forEach(node => {
                nav.push({
                    type: 'node',
                    label: node.name,
                    nodeId: node._id,
                    node: node
                });
            });
            return nav;
        }

        // 两条路径：按二叉树结构显示
        if (paths.length === 2) {
            const maxDepth = Math.max(...paths.map(p => p.length));

            for (let depth = 0; depth < maxDepth; depth++) {
                const nodesAtDepth = paths
                    .filter(p => p.length > depth)
                    .map(p => p[depth]);

                const uniqueNodes = Array.from(new Map(nodesAtDepth.map(n => [n._id, n])).values());

                if (uniqueNodes.length === 1) {
                    // 只有一个节点，正常显示
                    nav.push({
                        type: 'node',
                        label: uniqueNodes[0].name,
                        nodeId: uniqueNodes[0]._id,
                        node: uniqueNodes[0]
                    });
                } else if (uniqueNodes.length === 2) {
                    // 两个节点，并列显示（二叉树分叉）
                    nav.push({
                        type: 'branch',
                        nodes: uniqueNodes.map(node => ({
                            label: node.name,
                            nodeId: node._id,
                            node: node
                        }))
                    });
                }
            }

            return nav;
        }

        // 三条及以上路径：从根节点层开始检查，找到第一个有>=3个节点的层就省略
        const maxDepth = Math.max(...paths.map(p => p.length));
        let omitStartDepth = -1;

        // 从第0层开始检查
        for (let depth = 0; depth < maxDepth; depth++) {
            const nodesAtDepth = paths
                .filter(p => p.length > depth)
                .map(p => p[depth]);

            const uniqueNodes = Array.from(new Map(nodesAtDepth.map(n => [n._id, n])).values());

            if (uniqueNodes.length >= 3) {
                omitStartDepth = depth;
                break;
            }
        }

        if (omitStartDepth === -1) {
            // 没有找到需要省略的层，全部显示（理论上不会到这里，因为>=3条路径）
            omitStartDepth = maxDepth - 1;
        }

        // 显示省略之前的层
        for (let depth = 0; depth < omitStartDepth; depth++) {
            const nodesAtDepth = paths
                .filter(p => p.length > depth)
                .map(p => p[depth]);

            const uniqueNodes = Array.from(new Map(nodesAtDepth.map(n => [n._id, n])).values());

            if (uniqueNodes.length === 1) {
                nav.push({
                    type: 'node',
                    label: uniqueNodes[0].name,
                    nodeId: uniqueNodes[0]._id,
                    node: uniqueNodes[0]
                });
            } else if (uniqueNodes.length === 2) {
                nav.push({
                    type: 'branch',
                    nodes: uniqueNodes.map(node => ({
                        label: node.name,
                        nodeId: node._id,
                        node: node
                    }))
                });
            }
        }

        // 添加省略项
        nav.push({
            type: 'omit-paths',
            label: `省略路径:${paths.length}`,
            count: paths.length,
            paths: paths
        });

        // 添加目标节点
        const targetNode = paths[0][paths[0].length - 1];
        nav.push({
            type: 'node',
            label: targetNode.name,
            nodeId: targetNode._id,
            node: targetNode
        });

        return nav;
    };

    // 获取节点详情
    const fetchNodeDetail = async (nodeId, clickedNode = null) => {
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/public/node-detail/${nodeId}`);
            if (response.ok) {
                const data = await response.json();
                setCurrentNodeDetail(data.node);
                setView('nodeDetail');

                // 保存被点击的节点，用于WebGL过渡动画
                if (clickedNode) {
                    setClickedNodeForTransition(clickedNode);
                } else {
                    setClickedNodeForTransition(null);
                }

                // 构建导航路径
                const paths = await buildPathsToRoot(nodeId);
                setFullNavigationPaths(paths); // 保存完整路径用于浮窗显示
                const navPath = generateNavigationPath(paths);
                setNavigationPath(navPath);
                // WebGL场景更新由useEffect自动处理
            } else {
                alert('获取节点详情失败');
            }
        } catch (error) {
            console.error('获取节点详情失败:', error);
            alert('获取节点详情失败');
        }
    };

    // 实时搜索
    const performHomeSearch = async (query) => {
        if (!query || query.trim() === '') {
            setHomeSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/public/search?query=${encodeURIComponent(query)}`);
            if (response.ok) {
                const data = await response.json();
                setHomeSearchResults(data.results);
            }
        } catch (error) {
            console.error('搜索失败:', error);
        } finally {
            setIsSearching(false);
        }
    };

    // 监听搜索输入变化
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (view === 'home') {
                performHomeSearch(homeSearchQuery);
            }
        }, 300); // 防抖：300ms后执行搜索

        return () => clearTimeout(timeoutId);
    }, [homeSearchQuery, view]);

    // 初始化首页数据
    useEffect(() => {
        if (authenticated && view === 'home') {
            fetchRootNodes();
            fetchFeaturedNodes();
            setNavigationPath([{ type: 'home', label: '首页' }]);
        }
    }, [authenticated, view]);

    // 更新WebGL首页场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'home') return;

        // 确保有数据才渲染
        if (rootNodes.length > 0 || featuredNodes.length > 0) {
            sceneManagerRef.current.showHome(rootNodes, featuredNodes, []);
        }
    }, [isWebGLReady, view, rootNodes, featuredNodes]);

    // 更新WebGL节点详情场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'nodeDetail' || !currentNodeDetail) return;

        const parentNodes = currentNodeDetail.parentNodesInfo || [];
        const childNodes = currentNodeDetail.childNodesInfo || [];

        // 将被点击的节点传递给SceneManager，用于正确的过渡动画
        sceneManagerRef.current.showNodeDetail(currentNodeDetail, parentNodes, childNodes, clickedNodeForTransition);

        // 动画完成后清除clickedNode状态
        setClickedNodeForTransition(null);
    }, [isWebGLReady, view, currentNodeDetail]);

    // 绘制导航树Canvas
    useEffect(() => {
        if (!showNavigationTree || !treeCanvasRef.current || fullNavigationPaths.length === 0) return;

        const canvas = treeCanvasRef.current;
        const ctx = canvas.getContext('2d');

        // 构建树结构
        const buildTree = () => {
            const tree = { id: 'home', name: '首页', children: [], parentIds: [] };
            const nodeMap = new Map([['home', tree]]);

            fullNavigationPaths.forEach(path => {
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
            const isActive = nodePos.id === currentNodeDetail?._id;
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

    }, [showNavigationTree, fullNavigationPaths, currentNodeDetail]);

    // 绘制节点详情页面的canvas
    useEffect(() => {
        if (view !== 'nodeDetail' || !currentNodeDetail || !detailCanvasRef.current) return;

        const canvas = detailCanvasRef.current;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // 清空画布
        ctx.clearRect(0, 0, width, height);

        // 中央节点位置和大小
        const centerX = width / 2;
        const centerY = height / 2;
        const centerRadius = 80;

        // 母域节点（上方半圆）
        const parentNodes = currentNodeDetail.parentNodesInfo || [];
        const parentRadius = 50;
        const parentDistance = 200;

        // 子域节点（下方半圆）
        const childNodes = currentNodeDetail.childNodesInfo || [];
        const childRadius = 40;
        const childDistance = 180;

        // 绘制连线 - 母域
        parentNodes.forEach((_, index) => {
            const angle = Math.PI + (Math.PI / (parentNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * parentDistance;
            const y = centerY + Math.sin(angle) * parentDistance;

            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - centerRadius);
            ctx.lineTo(x, y + parentRadius);
            ctx.stroke();
        });

        // 绘制连线 - 子域
        childNodes.forEach((_, index) => {
            const angle = (Math.PI / (childNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * childDistance;
            const y = centerY + Math.sin(angle) * childDistance;

            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY + centerRadius);
            ctx.lineTo(x, y - childRadius);
            ctx.stroke();
        });

        // 绘制母域节点
        parentNodes.forEach((node, index) => {
            const angle = Math.PI + (Math.PI / (parentNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * parentDistance;
            const y = centerY + Math.sin(angle) * parentDistance;

            // 光晕
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, parentRadius);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, parentRadius * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // 节点主体
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(x, y, parentRadius, 0, Math.PI * 2);
            ctx.fill();

            // 边框
            ctx.strokeStyle = '#059669';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 名称
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(node.name, x, y - parentRadius - 10);

            // 知识点
            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#d1fae5';
            ctx.fillText(`${(node.knowledgePoint?.value || 0).toFixed(1)}`, x, y + 5);
        });

        // 绘制子域节点
        childNodes.forEach((node, index) => {
            const angle = (Math.PI / (childNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * childDistance;
            const y = centerY + Math.sin(angle) * childDistance;

            // 光晕
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, childRadius);
            gradient.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
            gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, childRadius * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // 节点主体
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(x, y, childRadius, 0, Math.PI * 2);
            ctx.fill();

            // 边框
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 名称
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(node.name, x, y + childRadius + 20);

            // 知识点
            ctx.font = '11px sans-serif';
            ctx.fillStyle = '#fef3c7';
            ctx.fillText(`${(node.knowledgePoint?.value || 0).toFixed(1)}`, x, y + 4);
        });

        // 绘制中央节点（最后绘制，确保在最上层）
        // 光晕
        const centerGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, centerRadius);
        centerGradient.addColorStop(0, 'rgba(168, 85, 247, 0.4)');
        centerGradient.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = centerGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, centerRadius * 1.5, 0, Math.PI * 2);
        ctx.fill();

        // 节点主体
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.arc(centerX, centerY, centerRadius, 0, Math.PI * 2);
        ctx.fill();

        // 边框
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 4;
        ctx.stroke();

        // 节点名称
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(currentNodeDetail.name, centerX, centerY - 10);

        // 知识点
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#e9d5ff';
        ctx.fillText(`${(currentNodeDetail.knowledgePoint?.value || 0).toFixed(2)}`, centerX, centerY + 10);

        // 内容分数
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#c4b5fd';
        ctx.fillText(`分数: ${currentNodeDetail.contentScore || 1}/分钟`, centerX, centerY + 28);

    }, [view, currentNodeDetail]);

    // 处理节点详情canvas点击
    const handleDetailCanvasClick = (e) => {
        if (!detailCanvasRef.current || !currentNodeDetail) return;

        const canvas = detailCanvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // 计算canvas逻辑尺寸和显示尺寸的缩放比例
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        // 将点击坐标从显示坐标系转换到canvas逻辑坐标系
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const centerRadius = 80;

        // 检查是否点击中央节点
        const distanceToCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (distanceToCenter <= centerRadius) {
            setShowNodeInfoModal(true);
            return;
        }

        // 检查是否点击母域节点
        const parentNodes = currentNodeDetail.parentNodesInfo || [];
        const parentRadius = 50;
        const parentDistance = 200;
        for (let i = 0; i < parentNodes.length; i++) {
            const angle = Math.PI + (Math.PI / (parentNodes.length + 1)) * (i + 1);
            const nodeX = centerX + Math.cos(angle) * parentDistance;
            const nodeY = centerY + Math.sin(angle) * parentDistance;
            const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
            if (distance <= parentRadius) {
                fetchNodeDetail(parentNodes[i]._id);
                return;
            }
        }

        // 检查是否点击子域节点
        const childNodes = currentNodeDetail.childNodesInfo || [];
        const childRadius = 40;
        const childDistance = 180;
        for (let i = 0; i < childNodes.length; i++) {
            const angle = (Math.PI / (childNodes.length + 1)) * (i + 1);
            const nodeX = centerX + Math.cos(angle) * childDistance;
            const nodeY = centerY + Math.sin(angle) * childDistance;
            const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
            if (distance <= childRadius) {
                fetchNodeDetail(childNodes[i]._id);
                return;
            }
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

        // 检查是否有节点已经在关联列表中（防止重复）
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
        try {
            const token = localStorage.getItem('token');
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

    // 获取所有节点信息（管理员专用）
    const fetchAllNodes = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://192.168.1.96:5000/api/nodes', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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
            }
        });
    };

    const saveNodeEdit = async (nodeId) => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/${nodeId}`, {
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
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/${nodeId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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

    // ===== 熵盟相关函数 =====

    // 获取所有熵盟列表
    const fetchAlliances = async () => {
        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/list');
            if (response.ok) {
                const data = await response.json();
                setAlliances(data.alliances);
            }
        } catch (error) {
            console.error('获取熵盟列表失败:', error);
        }
    };

    // 获取用户的熵盟信息
    const fetchUserAlliance = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;

        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/my/info', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                setUserAlliance(data.alliance);
            }
        } catch (error) {
            console.error('获取用户熵盟信息失败:', error);
        }
    };

    // 获取单个熵盟详情
    const fetchAllianceDetail = async (allianceId) => {
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/alliances/${allianceId}`);
            if (response.ok) {
                const data = await response.json();
                setSelectedAlliance(data);
                setShowAllianceDetailModal(true);
            }
        } catch (error) {
            console.error('获取熵盟详情失败:', error);
        }
    };

    // 创建新熵盟
    const createAlliance = async () => {
        const token = localStorage.getItem('token');
        const { name, flag, declaration } = newAllianceData;

        if (!name.trim() || !declaration.trim()) {
            alert('请填写所有必填字段');
            return;
        }

        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, flag, declaration })
            });

            const data = await response.json();
            if (response.ok) {
                alert('熵盟创建成功！');
                setShowCreateAllianceModal(false);
                setNewAllianceData({ name: '', flag: '#7c3aed', declaration: '' });
                fetchAlliances();
                fetchUserAlliance();
            } else {
                alert(data.error || '创建失败');
            }
        } catch (error) {
            console.error('创建熵盟失败:', error);
            alert('创建失败');
        }
    };

    // 加入熵盟
    const joinAlliance = async (allianceId) => {
        const token = localStorage.getItem('token');

        try {
            const response = await fetch(`http://192.168.1.96:5000/api/alliances/join/${allianceId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok) {
                alert('成功加入熵盟！');
                setShowAllianceDetailModal(false);
                fetchAlliances();
                fetchUserAlliance();
            } else {
                alert(data.error || '加入失败');
            }
        } catch (error) {
            console.error('加入熵盟失败:', error);
            alert('加入失败');
        }
    };

    // 退出熵盟
    const leaveAlliance = async () => {
        if (!window.confirm('确定要退出当前熵盟吗？')) return;

        const token = localStorage.getItem('token');

        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/leave', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                setShowAllianceDetailModal(false);
                fetchAlliances();
                fetchUserAlliance();
            } else {
                alert(data.error || '退出失败');
            }
        } catch (error) {
            console.error('退出熵盟失败:', error);
            alert('退出失败');
        }
    };

    // ===== 管理员：更换域主相关函数 =====

    // 搜索用户（用于选择域主）
    const searchUsersForMaster = async (keyword) => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/admin/search-users?keyword=${keyword}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                setMasterSearchResults(data.users);
            }
        } catch (error) {
            console.error('搜索用户失败:', error);
        }
    };

    // 打开更换域主弹窗
    const openChangeMasterModal = (node) => {
        setChangingMasterNode(node);
        setSelectedNewMaster(node.domainMaster || null);
        setMasterSearchKeyword('');
        setMasterSearchResults([]);
        setShowChangeMasterModal(true);
        // 自动搜索所有用户
        searchUsersForMaster('');
    };

    // 确认更换域主
    const confirmChangeMaster = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/admin/domain-master/${changingMasterNode._id}`, {
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
                fetchAllNodes(); // 刷新节点列表
            } else {
                alert(data.error || '更换失败');
            }
        } catch (error) {
            console.error('更换域主失败:', error);
            alert('更换失败');
        }
    };

    // ===== 管理员：熵盟管理相关函数 =====

    // 获取所有熵盟
    const fetchAdminAlliances = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/admin/all', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                setAdminAlliances(data.alliances);
            }
        } catch (error) {
            console.error('获取熵盟列表失败:', error);
        }
    };

    // 开始编辑熵盟
    const startEditAlliance = (alliance) => {
        setEditingAlliance(alliance);
        setEditAllianceForm({
            name: alliance.name,
            flag: alliance.flag,
            declaration: alliance.declaration
        });
    };

    // 取消编辑熵盟
    const cancelEditAlliance = () => {
        setEditingAlliance(null);
        setEditAllianceForm({ name: '', flag: '', declaration: '' });
    };

    // 保存熵盟修改
    const saveAllianceEdit = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/alliances/admin/${editingAlliance._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editAllianceForm)
            });

            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                cancelEditAlliance();
                fetchAdminAlliances();
            } else {
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存熵盟失败:', error);
            alert('保存失败');
        }
    };

    // 删除熵盟
    const deleteAlliance = async (allianceId, allianceName) => {
        if (!window.confirm(`确定要删除熵盟 "${allianceName}" 吗？此操作将清除所有成员的熵盟关联！`)) return;

        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/alliances/admin/${allianceId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                fetchAdminAlliances();
            } else {
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除熵盟失败:', error);
            alert('删除失败');
        }
    };

    // 设置/取消热门节点
    const toggleFeaturedNode = async (nodeId, currentFeatured) => {
        const token = localStorage.getItem('token');
        const action = currentFeatured ? '取消热门' : '设置为热门';

        if (!window.confirm(`确定要${action}吗？`)) return;

        let featuredOrder = 0;
        if (!currentFeatured) {
            // 如果是设置为热门，让用户输入排序
            const orderInput = window.prompt('请输入热门节点的排序（数字越小越靠前）：', '0');
            if (orderInput === null) return; // 用户取消
            featuredOrder = parseInt(orderInput) || 0;
        }

        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/${nodeId}/featured`, {
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
                fetchFeaturedNodes(); // 更新首页的热门节点
            } else {
                const data = await response.json();
                alert(data.error || '操作失败');
            }
        } catch (error) {
            console.error('设置热门节点失败:', error);
            alert('操作失败');
        }
    };

    // 打开编辑关联模态框
    const openEditAssociationModal = async (node) => {
        setEditingAssociationNode(node);
        setAssocSearchKeyword('');
        setAssocSearchResults([]);
        setNewAssocType('contains');
        setShowEditAssociationModal(true);

        // 根据关联母域和关联子域重建关联关系
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
            // 获取所有节点以便根据名称查找ID
            const response = await fetch('http://192.168.1.96:5000/api/nodes', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const allNodes = data.nodes || [];

                // 创建名称到节点的映射
                const nodeMap = {};
                allNodes.forEach(n => {
                    nodeMap[n.name] = n;
                });

                // 根据关联母域和关联子域构建关联关系
                const rebuiltAssociations = [];

                // 关联母域中的节点 → 当前节点拓展(extends)它们
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

                // 关联子域中的节点 → 当前节点包含(contains)它们
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
            // 如果获取失败，尝试使用原有的associations
            const normalizedAssociations = (node.associations || []).map(assoc => {
                if (typeof assoc.targetNode === 'object' && assoc.targetNode !== null) {
                    return {
                        targetNode: assoc.targetNode._id,
                        targetNodeName: assoc.targetNode.name,
                        relationType: assoc.relationType
                    };
                }
                return {
                    targetNode: assoc.targetNode,
                    targetNodeName: assoc.targetNodeName || assoc.targetNode,
                    relationType: assoc.relationType
                };
            });
            setEditAssociations(normalizedAssociations);
        }
    };

    // 搜索关联节点（用于编辑关联）
    const searchAssociationNodes = async (keyword, currentAssociations = null) => {
        if (!keyword || keyword.trim() === '') {
            setAssocSearchResults([]);
            return;
        }

        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/search?keyword=${encodeURIComponent(keyword)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                // 使用传入的 currentAssociations 或默认使用 editAssociations
                const associations = currentAssociations !== null ? currentAssociations : editAssociations;
                // 过滤掉当前节点自己，以及已经在关联列表中的节点
                const filtered = data.filter(n => {
                    if (n._id === editingAssociationNode._id) return false;
                    return !associations.some(assoc => assoc.targetNode === n._id);
                });
                setAssocSearchResults(filtered);
            }
        } catch (error) {
            console.error('搜索节点失败:', error);
        }
    };

    // 添加编辑关联
    const addEditAssociation = (targetNode) => {
        // 检查是否已存在（无论什么类型）
        const exists = editAssociations.some(a => a.targetNode === targetNode._id);
        if (exists) {
            alert('该节点已在关联列表中。一个节点只能有一种关联关系（拓展或包含），不能同时存在两种关系。');
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

        // 从搜索结果中移除已添加的节点，但保留其他搜索结果和搜索关键词
        setAssocSearchResults(prev => prev.filter(node => node._id !== targetNode._id));
    };

    // 移除编辑关联
    const removeEditAssociation = async (index) => {
        // 先计算删除后的新关联列表
        const newAssociations = editAssociations.filter((_, i) => i !== index);
        setEditAssociations(newAssociations);

        // 如果当前有搜索关键词，使用新的关联列表重新搜索
        if (assocSearchKeyword && assocSearchKeyword.trim() !== '') {
            await searchAssociationNodes(assocSearchKeyword, newAssociations);
        }
    };

    // 修改关联类型
    const changeAssociationType = (index, newType) => {
        const updated = [...editAssociations];
        updated[index].relationType = newType;
        setEditAssociations(updated);
    };

    // 保存关联编辑
    const saveAssociationEdit = async () => {
        const token = localStorage.getItem('token');

        try {
            const response = await fetch(`http://192.168.1.96:5000/api/nodes/${editingAssociationNode._id}/associations`, {
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

    // 如果需要显示位置选择弹窗，只显示弹窗，不显示其他内容
    if (showLocationModal) {
        return (
            <LocationSelectionModal
                onConfirm={handleLocationConfirm}
                featuredNodes={featuredNodes}
                username={username}
                onLogout={handleLogout}
            />
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
                        <div className="header-right">
                            <div className="user-info">
                                <span className="user-name">当前用户: {username}</span>
                                <button
                                    onClick={handleLogout}
                                    className="btn btn-logout"
                                >
                                    退出登录
                                </button>
                            </div>
                            <div className="header-buttons">
                                <button
                                    onClick={() => {
                                        setView('home');
                                        setNavigationPath([{ type: 'home', label: '首页' }]);
                                    }}
                                    className="btn btn-primary"
                                >
                                    <Home size={18} />
                                    首页
                                </button>
                                <button
                                    onClick={openCreateNodeModal}
                                    className="btn btn-success"
                                >
                                    <Plus size={18} />
                                    创建节点
                                </button>
                                <button
                                    onClick={() => {
                                        setView('alliance');
                                        fetchAlliances();
                                        fetchUserAlliance();
                                    }}
                                    className="btn btn-secondary"
                                >
                                    <Shield size={18} />
                                    熵盟
                                </button>
            {isAdmin && (
                <button
                    onClick={() => {
                        setView('admin');
                        fetchPendingNodes();
                        fetchAllUsers();
                        fetchAllNodes();
                    }}
                    className="btn btn-warning"
                >
                    管理员面板
                    {pendingNodes.length > 0 && (
                        <span className="notification-badge">!</span>
                    )}
                </button>
            )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 首页视图 */}
                {view === 'home' && (
                    <>
                        {/* 左侧导航栏 */}
                        <div className="navigation-sidebar">
                            <div className="nav-item active">
                                <span className="nav-label">首页</span>
                            </div>
                        </div>

                        <div className="webgl-scene-container">
                            {/* WebGL Canvas */}
                            <canvas
                                ref={webglCanvasRef}
                                className="webgl-canvas"
                            />

                            {/* 悬浮搜索栏 */}
                            <div className="floating-search-bar">
                                <Search className="search-icon" size={24} />
                                <input
                                    type="text"
                                    placeholder="搜索节点...（支持多关键词，用空格分隔）"
                                    value={homeSearchQuery}
                                    onChange={(e) => setHomeSearchQuery(e.target.value)}
                                    className="search-input-floating"
                                />
                                {homeSearchQuery && (
                                    <button
                                        onClick={() => {
                                            setHomeSearchQuery('');
                                            setHomeSearchResults([]);
                                        }}
                                        className="search-clear-btn"
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                            </div>

                            {/* 搜索结果列表（长方体条目） */}
                            {homeSearchQuery && homeSearchResults.length > 0 && (
                                <div className="search-results-panel">
                                    <div className="search-results-scroll">
                                        {homeSearchResults.map((node) => (
                                            <div
                                                key={node._id}
                                                className="search-result-card"
                                                onClick={() => {
                                                    // 点击搜索结果，跳转到节点详情
                                                    fetchNodeDetail(node._id, {
                                                        id: `search-${node._id}`,
                                                        data: node,
                                                        type: 'search'
                                                    });
                                                }}
                                            >
                                                <div className="search-card-title">{node.name}</div>
                                                <div className="search-card-desc">{node.description}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 搜索无结果 */}
                            {homeSearchQuery && !isSearching && homeSearchResults.length === 0 && (
                                <div className="search-no-results">
                                    未找到匹配的节点
                                </div>
                            )}

                            {/* 搜索中 */}
                            {isSearching && (
                                <div className="search-loading-indicator">
                                    搜索中...
                                </div>
                            )}
                        </div>

                        {/* 右侧知识域驻留栏 */}
                        {!isAdmin ? (
                            <div className="location-resident-sidebar">
                                <div className="location-sidebar-header">
                                    <h3>当前所在的知识域</h3>
                                </div>

                                {currentLocationNodeDetail ? (
                                    <div className="location-sidebar-content">
                                        <div className="location-node-title">{currentLocationNodeDetail.name}</div>

                                        {currentLocationNodeDetail.description && (
                                            <div className="location-node-section">
                                                <div className="section-label">描述</div>
                                                <div className="section-content">{currentLocationNodeDetail.description}</div>
                                            </div>
                                        )}

                                        {currentLocationNodeDetail.relatedParentDomains && currentLocationNodeDetail.relatedParentDomains.length > 0 && (
                                            <div className="location-node-section">
                                                <div className="section-label">父域</div>
                                                <div className="section-tags">
                                                    {currentLocationNodeDetail.relatedParentDomains.map((parent, idx) => (
                                                        <span key={idx} className="node-tag parent-tag">{parent}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {currentLocationNodeDetail.relatedChildDomains && currentLocationNodeDetail.relatedChildDomains.length > 0 && (
                                            <div className="location-node-section">
                                                <div className="section-label">子域</div>
                                                <div className="section-tags">
                                                    {currentLocationNodeDetail.relatedChildDomains.map((child, idx) => (
                                                        <span key={idx} className="node-tag child-tag">{child}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {currentLocationNodeDetail.knowledge && (
                                            <div className="location-node-section">
                                                <div className="section-label">知识内容</div>
                                                <div className="section-content knowledge-content">
                                                    {currentLocationNodeDetail.knowledge}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="location-sidebar-empty">
                                        <p>暂未降临到任何知识域</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="location-resident-sidebar admin-sidebar">
                                <div className="location-sidebar-header">
                                    <h3>管理员视图</h3>
                                </div>
                                <div className="location-sidebar-empty">
                                    <p>管理员可查看所有知识域</p>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* 节点详情视图 */}
                {view === 'nodeDetail' && currentNodeDetail && (
                    <>
                        {/* 左侧导航栏 */}
                        <div className="navigation-sidebar">
                            {/* 添加标题说明 */}
                            <div className="navigation-header">
                                <h3 className="navigation-title">当前查看的节点</h3>
                                <div className="navigation-divider"></div>
                            </div>

                            {navigationPath.map((item, index) => (
                                <div key={index}>
                                    {item.type === 'branch' ? (
                                        // 二叉树分叉，两个节点并列显示
                                        <div className="nav-branch">
                                            {item.nodes.map((branchNode, branchIndex) => (
                                                <div
                                                    key={branchIndex}
                                                    className={`nav-item branch-item clickable ${branchNode.nodeId === currentNodeDetail._id ? 'active' : ''}`}
                                                    onClick={() => fetchNodeDetail(branchNode.nodeId)}
                                                >
                                                    <span className="nav-label">{branchNode.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div
                                            className={`nav-item ${item.type === 'node' && item.nodeId === currentNodeDetail._id ? 'active' : ''} ${item.type === 'omit-paths' ? 'clickable omit-item' : item.type !== 'home' ? 'clickable' : ''}`}
                                            onClick={() => {
                                                if (item.type === 'home') {
                                                    setView('home');
                                                    setNavigationPath([{ type: 'home', label: '首页' }]);
                                                } else if (item.type === 'node') {
                                                    fetchNodeDetail(item.nodeId);
                                                } else if (item.type === 'omit-paths') {
                                                    // 点击省略项，显示完整导航树
                                                    setShowNavigationTree(true);
                                                }
                                            }}
                                        >
                                            <span className="nav-label">{item.label}</span>
                                        </div>
                                    )}
                                    {index < navigationPath.length - 1 && (
                                        <div className="nav-arrow">↓</div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="webgl-scene-container">
                            {/* WebGL Canvas */}
                            <canvas
                                ref={webglCanvasRef}
                                className="webgl-canvas"
                            />
                        </div>
                    </>
                )}

                {view === 'alliance' && (
                    <div className="alliance-section">
                        <h2 className="section-title-large">
                            <Shield className="icon" />
                            熵盟系统
                        </h2>

                        {/* 用户当前熵盟状态 */}
                        {!isAdmin && (
                            <div className="user-alliance-status">
                                {userAlliance ? (
                                    <div className="current-alliance-card">
                                        <div className="alliance-flag" style={{ backgroundColor: userAlliance.flag }}></div>
                                        <div className="alliance-info-compact">
                                            <h3>{userAlliance.name}</h3>
                                            <p>成员: {userAlliance.memberCount} | 管辖域: {userAlliance.domainCount}</p>
                                        </div>
                                        <button
                                            onClick={leaveAlliance}
                                            className="btn btn-danger btn-small"
                                        >
                                            退出熵盟
                                        </button>
                                    </div>
                                ) : (
                                    <div className="no-alliance-prompt">
                                        <p>您还未加入任何熵盟</p>
                                        <button
                                            onClick={() => setShowCreateAllianceModal(true)}
                                            className="btn btn-primary"
                                        >
                                            创立新熵盟
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 熵盟列表 */}
                        <div className="alliances-grid">
                            {alliances.length === 0 ? (
                                <div className="empty-alliances">
                                    <p>暂无熵盟，快来创建第一个熵盟吧！</p>
                                </div>
                            ) : (
                                alliances.map((alliance) => (
                                    <div
                                        key={alliance._id}
                                        className="alliance-card"
                                        onClick={() => fetchAllianceDetail(alliance._id)}
                                    >
                                        <div className="alliance-flag-large" style={{ backgroundColor: alliance.flag }}></div>
                                        <div className="alliance-card-content">
                                            <h3 className="alliance-name">{alliance.name}</h3>
                                            <p className="alliance-declaration">{alliance.declaration}</p>
                                            <div className="alliance-stats">
                                                <div className="stat-item">
                                                    <Users className="icon-tiny" />
                                                    <span>成员: {alliance.memberCount}</span>
                                                </div>
                                                <div className="stat-item">
                                                    <Zap className="icon-tiny" />
                                                    <span>管辖域: {alliance.domainCount}</span>
                                                </div>
                                            </div>
                                            <div className="alliance-founder">
                                                创始人: {alliance.founder?.username || '未知'}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
                {view === 'admin' && isAdmin && (
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
                        )}

                        {/* 待审批节点选项卡 */}
                        {adminTab === 'pending' && (
                            <div className="pending-nodes-container">
                                <div className="table-info">
                                    <p>待审批节点数: <strong>{pendingNodes.length}</strong></p>
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
                                        {pendingNodes.map(node => (
                                            <div key={node._id} className="pending-node-card">
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
                                                                {node.associations.map((association, index) => (
                                                                    <div key={index} className="association-item">
                                                                        <span className="node-name">
                                                                            {association.targetNode?.name || '未知节点'}
                                                                        </span>
                                                                        <span className="relation-type">
                                                                            {association.relationType === 'contains' ? '包含' : '拓展'}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="node-actions">
                                                    <button
                                                        onClick={() => approveNode(node._id)}
                                                        className="btn btn-success"
                                                    >
                                                        <Check className="icon-small" />
                                                        通过
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
                                                                onClick={() => {
                                                                    setViewingAssociationNode(node);
                                                                    setShowAssociationModal(true);
                                                                }}
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
                    </div>
                )}

                {/* 查看关联浮窗 */}
                {showAssociationModal && viewingAssociationNode && (
                    <div className="modal-backdrop" onClick={() => setShowAssociationModal(false)}>
                        <div className="modal-content association-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>节点关联详情</h2>
                                <button
                                    className="modal-close"
                                    onClick={() => setShowAssociationModal(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="association-info">
                                    <h3 className="node-title">{viewingAssociationNode.name}</h3>
                                    <p className="node-desc">{viewingAssociationNode.description}</p>
                                </div>

                                <div className="association-section">
                                    <h4 className="section-title">
                                        母域节点
                                    </h4>
                                    <p className="association-hint">当前节点拓展了以下节点（或者说，以下节点包含当前节点）</p>
                                    <div className="association-list">
                                        {viewingAssociationNode.relatedParentDomains &&
                                         viewingAssociationNode.relatedParentDomains.length > 0 ? (
                                            <ul>
                                                {viewingAssociationNode.relatedParentDomains.map((domain, index) => (
                                                    <li key={index} className="domain-item parent-domain">
                                                        <span className="domain-badge parent">⬆ 母域</span>
                                                        {domain}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="empty-message">暂无母域节点</p>
                                        )}
                                    </div>
                                </div>

                                <div className="association-section">
                                    <h4 className="section-title">
                                        子域节点
                                    </h4>
                                    <p className="association-hint">以下节点拓展了当前节点（或者说，当前节点包含以下节点）</p>
                                    <div className="association-list">
                                        {viewingAssociationNode.relatedChildDomains &&
                                         viewingAssociationNode.relatedChildDomains.length > 0 ? (
                                            <ul>
                                                {viewingAssociationNode.relatedChildDomains.map((domain, index) => (
                                                    <li key={index} className="domain-item child-domain">
                                                        <span className="domain-badge child">⬇ 子域</span>
                                                        {domain}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="empty-message">暂无子域节点</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowAssociationModal(false)}
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 编辑关联浮窗 */}
                {showEditAssociationModal && editingAssociationNode && (
                    <div className="modal-backdrop" onClick={() => setShowEditAssociationModal(false)}>
                        <div className="modal-content edit-association-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>编辑节点关联 - {editingAssociationNode.name}</h2>
                                <button
                                    className="modal-close"
                                    onClick={() => setShowEditAssociationModal(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="modal-body">
                                {/* 搜索添加新关联 */}
                                <div className="add-association-section">
                                    <h4>添加新关联</h4>
                                    <div className="search-add-container">
                                        <div className="search-input-group">
                                            <input
                                                type="text"
                                                placeholder="搜索节点..."
                                                value={assocSearchKeyword}
                                                onChange={(e) => {
                                                    setAssocSearchKeyword(e.target.value);
                                                    searchAssociationNodes(e.target.value);
                                                }}
                                                className="search-input"
                                            />
                                        </div>
                                        <div className="relation-type-selector">
                                            <label>
                                                <input
                                                    type="radio"
                                                    value="contains"
                                                    checked={newAssocType === 'contains'}
                                                    onChange={(e) => setNewAssocType(e.target.value)}
                                                />
                                                包含
                                            </label>
                                            <label>
                                                <input
                                                    type="radio"
                                                    value="extends"
                                                    checked={newAssocType === 'extends'}
                                                    onChange={(e) => setNewAssocType(e.target.value)}
                                                />
                                                拓展
                                            </label>
                                        </div>
                                    </div>

                                    {assocSearchResults.length > 0 && (
                                        <div className="search-results-box">
                                            {assocSearchResults.map((node) => (
                                                <div key={node._id} className="search-result-item">
                                                    <span>{node.name}</span>
                                                    <button
                                                        onClick={() => addEditAssociation(node)}
                                                        className="btn-action btn-add-small"
                                                    >
                                                        添加
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 当前关联列表 */}
                                <div className="current-associations-section">
                                    <h4>当前关联（{editAssociations.length}个）</h4>
                                    {editAssociations.length > 0 ? (
                                        <div className="associations-list">
                                            {editAssociations.map((assoc, index) => (
                                                <div key={index} className="association-item-edit">
                                                    <div className="assoc-info">
                                                        <span className="assoc-name">
                                                            {assoc.targetNodeName || assoc.targetNode}
                                                        </span>
                                                        <select
                                                            value={assoc.relationType}
                                                            onChange={(e) => changeAssociationType(index, e.target.value)}
                                                            className="assoc-type-select"
                                                        >
                                                            <option value="contains">包含</option>
                                                            <option value="extends">拓展</option>
                                                        </select>
                                                    </div>
                                                    <button
                                                        onClick={() => removeEditAssociation(index)}
                                                        className="btn-action btn-delete-small"
                                                    >
                                                        删除
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="empty-message">暂无关联</p>
                                    )}
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowEditAssociationModal(false)}
                                >
                                    取消
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={saveAssociationEdit}
                                >
                                    保存
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 节点详细信息模态框 */}
                {showNodeInfoModal && currentNodeDetail && (
                    <div className="modal-backdrop" onClick={() => setShowNodeInfoModal(false)}>
                        <div className="modal-content node-info-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>节点详细信息</h2>
                                <button
                                    className="btn-close"
                                    onClick={() => setShowNodeInfoModal(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="node-info-section">
                                    <h3 className="info-section-title">{currentNodeDetail.name}</h3>
                                    <p className="info-section-desc">{currentNodeDetail.description}</p>
                                </div>

                                <div className="node-info-grid">
                                    <div className="info-item">
                                        <span className="info-label">创建者</span>
                                        <span className="info-value">{currentNodeDetail.owner?.username || '系统'}</span>
                                    </div>
                                    <div className="info-item">
                                        <span className="info-label">创建时间</span>
                                        <span className="info-value">
                                            {new Date(currentNodeDetail.createdAt).toLocaleString('zh-CN')}
                                        </span>
                                    </div>
                                    <div className="info-item">
                                        <span className="info-label">内容分数</span>
                                        <span className="info-value highlight">{currentNodeDetail.contentScore || 1} 点/分钟</span>
                                    </div>
                                    <div className="info-item">
                                        <span className="info-label">知识点存量</span>
                                        <span className="info-value highlight">
                                            {(currentNodeDetail.knowledgePoint?.value || 0).toFixed(2)} 点
                                        </span>
                                    </div>
                                </div>

                                <div className="node-info-section">
                                    <h4 className="info-section-subtitle">关联域</h4>
                                    <div className="domain-summary">
                                        <div className="domain-summary-item">
                                            <span className="domain-summary-label">母域节点：</span>
                                            <span className="domain-summary-value">
                                                {currentNodeDetail.relatedParentDomains?.length || 0} 个
                                            </span>
                                        </div>
                                        <div className="domain-summary-item">
                                            <span className="domain-summary-label">子域节点：</span>
                                            <span className="domain-summary-value">
                                                {currentNodeDetail.relatedChildDomains?.length || 0} 个
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowNodeInfoModal(false)}
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 节点创建模态框 - 全局访问 */}
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

                {/* 完整导航树浮窗 */}
                {showNavigationTree && fullNavigationPaths.length > 0 && (
                    <div className="modal-backdrop" onClick={() => setShowNavigationTree(false)}>
                        <div className="modal-content navigation-tree-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>完整导航路径</h2>
                                <button
                                    className="btn-close"
                                    onClick={() => setShowNavigationTree(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="navigation-tree-canvas-container">
                                    <canvas
                                        ref={treeCanvasRef}
                                        className="navigation-tree-canvas"
                                        onClick={(e) => {
                                            // 处理Canvas点击
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
                                                        setView('home');
                                                        setNavigationPath([{ type: 'home', label: '首页' }]);
                                                    } else {
                                                        fetchNodeDetail(nodePos.id);
                                                    }
                                                    setShowNavigationTree(false);
                                                    break;
                                                }
                                            }
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowNavigationTree(false)}
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 熵盟详情弹窗 */}
                {showAllianceDetailModal && selectedAlliance && (
                    <div className="modal-backdrop" onClick={() => setShowAllianceDetailModal(false)}>
                        <div className="modal-content alliance-detail-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>熵盟详情</h2>
                                <button
                                    className="modal-close"
                                    onClick={() => setShowAllianceDetailModal(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="modal-body">
                                {/* 熵盟基本信息 */}
                                <div className="alliance-detail-header">
                                    <div className="alliance-flag-huge" style={{ backgroundColor: selectedAlliance.alliance.flag }}></div>
                                    <div className="alliance-main-info">
                                        <h2>{selectedAlliance.alliance.name}</h2>
                                        <p className="declaration-text">{selectedAlliance.alliance.declaration}</p>
                                        <div className="alliance-meta">
                                            <span>创始人: {selectedAlliance.alliance.founder?.username || '未知'}</span>
                                            <span>成立时间: {new Date(selectedAlliance.alliance.createdAt).toLocaleDateString('zh-CN')}</span>
                                        </div>
                                        <div className="alliance-stats-large">
                                            <div className="stat-box">
                                                <Users className="icon" />
                                                <div>
                                                    <span className="stat-number">{selectedAlliance.alliance.memberCount}</span>
                                                    <span className="stat-label">成员</span>
                                                </div>
                                            </div>
                                            <div className="stat-box">
                                                <Zap className="icon" />
                                                <div>
                                                    <span className="stat-number">{selectedAlliance.alliance.domainCount}</span>
                                                    <span className="stat-label">管辖域</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 成员列表 */}
                                <div className="alliance-section-detail">
                                    <h3>成员列表 ({selectedAlliance.members.length}人)</h3>
                                    <div className="members-list">
                                        {selectedAlliance.members.map((member) => (
                                            <div key={member._id} className="member-item">
                                                <Users className="icon-small" />
                                                <span className="member-name">{member.username}</span>
                                                <span className="member-level">Lv.{member.level}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* 管辖知识域列表 */}
                                <div className="alliance-section-detail">
                                    <h3>管辖知识域 ({selectedAlliance.domains.length}个)</h3>
                                    <div className="domains-list">
                                        {selectedAlliance.domains.length > 0 ? (
                                            selectedAlliance.domains.map((domain) => (
                                                <div key={domain._id} className="domain-item">
                                                    <Zap className="icon-small" />
                                                    <div className="domain-info">
                                                        <span className="domain-name">{domain.name}</span>
                                                        <span className="domain-master">域主: {domain.domainMaster?.username || '暂无'}</span>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="empty-message">该熵盟暂无管辖知识域</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer">
                                {!isAdmin && (
                                    <>
                                        {userAlliance && userAlliance._id === selectedAlliance.alliance._id ? (
                                            <button
                                                className="btn btn-danger"
                                                onClick={leaveAlliance}
                                            >
                                                退出熵盟
                                            </button>
                                        ) : !userAlliance ? (
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => joinAlliance(selectedAlliance.alliance._id)}
                                            >
                                                加入熵盟
                                            </button>
                                        ) : null}
                                    </>
                                )}
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowAllianceDetailModal(false)}
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 创建熵盟弹窗 */}
                {showCreateAllianceModal && (
                    <div className="modal-backdrop" onClick={() => setShowCreateAllianceModal(false)}>
                        <div className="modal-content create-alliance-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>创立新熵盟</h2>
                                <button
                                    className="modal-close"
                                    onClick={() => setShowCreateAllianceModal(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="form-group">
                                    <label>熵盟名称 *</label>
                                    <input
                                        type="text"
                                        value={newAllianceData.name}
                                        onChange={(e) => setNewAllianceData({
                                            ...newAllianceData,
                                            name: e.target.value
                                        })}
                                        placeholder="输入熵盟名称"
                                        className="form-input"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>熵盟旗帜（颜色） *</label>
                                    <div className="color-picker-group">
                                        <input
                                            type="color"
                                            value={newAllianceData.flag}
                                            onChange={(e) => setNewAllianceData({
                                                ...newAllianceData,
                                                flag: e.target.value
                                            })}
                                            className="color-picker"
                                        />
                                        <div className="flag-preview" style={{ backgroundColor: newAllianceData.flag }}>
                                            <span>预览</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>熵盟号召（势力宣言） *</label>
                                    <textarea
                                        value={newAllianceData.declaration}
                                        onChange={(e) => setNewAllianceData({
                                            ...newAllianceData,
                                            declaration: e.target.value
                                        })}
                                        placeholder="输入熵盟的号召或宣言..."
                                        rows="4"
                                        className="form-textarea"
                                    />
                                </div>

                                <div className="create-alliance-info">
                                    <p><strong>注意：</strong></p>
                                    <ul>
                                        <li>创建熵盟需要至少是一个知识域的域主</li>
                                        <li>创建成功后，您将自动成为该熵盟的成员</li>
                                        <li>每个用户只能属于一个熵盟</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowCreateAllianceModal(false)}
                                >
                                    取消
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={createAlliance}
                                    disabled={!newAllianceData.name.trim() || !newAllianceData.declaration.trim()}
                                >
                                    创立熵盟
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 更换域主弹窗 */}
                {showChangeMasterModal && changingMasterNode && (
                    <div className="modal-backdrop" onClick={() => setShowChangeMasterModal(false)}>
                        <div className="modal-content change-master-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>更换域主</h2>
                                <button
                                    className="modal-close"
                                    onClick={() => setShowChangeMasterModal(false)}
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="change-master-info">
                                    <p><strong>节点:</strong> {changingMasterNode.name}</p>
                                    <p><strong>当前域主:</strong> {changingMasterNode.domainMaster?.username || '(未设置)'}</p>
                                </div>

                                {/* 搜索用户 */}
                                <div className="form-group">
                                    <label>搜索用户</label>
                                    <input
                                        type="text"
                                        value={masterSearchKeyword}
                                        onChange={(e) => {
                                            setMasterSearchKeyword(e.target.value);
                                            searchUsersForMaster(e.target.value);
                                        }}
                                        placeholder="输入用户名搜索..."
                                        className="form-input"
                                    />
                                </div>

                                {/* 搜索结果列表 */}
                                <div className="user-search-results">
                                    <h4>选择新域主:</h4>
                                    <div className="user-list">
                                        {masterSearchResults.length > 0 ? (
                                            masterSearchResults.map((user) => (
                                                <div
                                                    key={user._id}
                                                    className={`user-item ${selectedNewMaster?._id === user._id ? 'selected' : ''}`}
                                                    onClick={() => setSelectedNewMaster(user)}
                                                >
                                                    <div className="user-info">
                                                        <span className="user-name">{user.username}</span>
                                                        <span className="user-meta">Lv.{user.level} | {user.role === 'admin' ? '管理员' : '普通用户'}</span>
                                                    </div>
                                                    {selectedNewMaster?._id === user._id && (
                                                        <Check className="check-icon" size={20} />
                                                    )}
                                                </div>
                                            ))
                                        ) : (
                                            <p className="no-results">没有找到用户</p>
                                        )}
                                    </div>
                                </div>

                                {/* 显示选中的新域主 */}
                                <div className="selected-master-display">
                                    <h4>新域主:</h4>
                                    {selectedNewMaster ? (
                                        <div className="selected-master-card">
                                            <span className="master-name">{selectedNewMaster.username}</span>
                                            <span className="master-level">Lv.{selectedNewMaster.level}</span>
                                            <button
                                                onClick={() => setSelectedNewMaster(null)}
                                                className="btn-remove-selection"
                                                title="清除选择"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="no-selection">(未选择，将清除域主)</p>
                                    )}
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowChangeMasterModal(false)}
                                >
                                    取消
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={confirmChangeMaster}
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
