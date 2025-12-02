import React, { useState, useEffect, useRef } from 'react';
import { Home, Shield } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';
import Login from './components/auth/Login';
import AdminPanel from './components/admin/AdminPanel';
import AlliancePanel from './components/game/AlliancePanel';
import NodeDetail from './components/game/NodeDetail';
import HomeView from './components/game/Home';
import SceneManager from './SceneManager';
import LocationSelectionModal from './LocationSelectionModal';
import AssociationModal from './components/modals/AssociationModal';
import NodeInfoModal from './components/modals/NodeInfoModal';
import NavigationTreeModal from './components/modals/NavigationTreeModal';
import CreateNodeModal from './components/modals/CreateNodeModal';

const App = () => {
    const [socket, setSocket] = useState(null);
    const [authenticated, setAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [nodes, setNodes] = useState([]);
    const [technologies, setTechnologies] = useState([]);
    const [view, setView] = useState('login');
    const socketRef = useRef(null);
    const [isAdmin, setIsAdmin] = useState(false);


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
    
    // 关联显示状态
    const [showAssociationModal, setShowAssociationModal] = useState(false);
    const [viewingAssociationNode, setViewingAssociationNode] = useState(null);



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
    const [showSearchResults, setShowSearchResults] = useState(false); // 控制搜索结果的显示/隐藏，默认隐藏

    // 节点详情页面相关状态
    const [currentNodeDetail, setCurrentNodeDetail] = useState(null);
    const [showNodeInfoModal, setShowNodeInfoModal] = useState(false);


    // 导航路径相关状态
    const [navigationPath, setNavigationPath] = useState([{ type: 'home', label: '首页' }]);
    const [showNavigationTree, setShowNavigationTree] = useState(false);
    const [fullNavigationPaths, setFullNavigationPaths] = useState([]);

    // WebGL场景管理
    const webglCanvasRef = useRef(null);
    const sceneManagerRef = useRef(null);
    const [isWebGLReady, setIsWebGLReady] = useState(false);
    const [clickedNodeForTransition, setClickedNodeForTransition] = useState(null);
    const [canvasKey, setCanvasKey] = useState(0); // 用于强制重新渲染canvas

    // 搜索栏相关引用
    const searchBarRef = useRef(null);

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
    
        const newSocket = io('http://localhost:5000', {
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


  const handleLoginSuccess = async (data) => {
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
  };

  // 更新用户location
  const updateUserLocation = async (location) => {
    const token = localStorage.getItem('token');
    try {
      console.log('正在更新location:', location);
      const response = await fetch('http://localhost:5000/api/location', {
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
      const response = await fetch(`http://localhost:5000/api/nodes/public/search?query=${encodeURIComponent(locationName)}`);
      if (response.ok) {
        const data = await response.json();
        // 精确匹配节点名称
        const exactMatch = data.results.find(node => node.name === locationName);
        if (exactMatch) {
          // 获取完整的节点详情
          const detailResponse = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${exactMatch._id}`);
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
    
        const newSocket = io('http://localhost:5000', {
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
            const response = await fetch('http://localhost:5000/api/admin/users', {
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

    // 获取根节点
    const fetchRootNodes = async () => {
        try {
            const response = await fetch('http://localhost:5000/api/nodes/public/root-nodes');
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
            const response = await fetch('http://localhost:5000/api/nodes/public/featured-nodes');
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
            const response = await fetch('http://localhost:5000/api/nodes/public/all-nodes');

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
            const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${nodeId}`);
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
            const response = await fetch(`http://localhost:5000/api/nodes/public/search?query=${encodeURIComponent(query)}`);
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
            if (view === 'home' || view === 'nodeDetail') {
                performHomeSearch(homeSearchQuery);
                // 只有在用户主动输入时才显示搜索结果，而不是在view变化时
                if (homeSearchQuery.trim() !== '') {
                    setShowSearchResults(true);
                }
            }
        }, 300); // 防抖：300ms后执行搜索

        return () => clearTimeout(timeoutId);
    }, [homeSearchQuery]); // 移除view依赖，只在搜索词变化时触发

    // 全局点击事件监听器 - 用于控制搜索结果显示/隐藏
    useEffect(() => {
        const handleClickOutside = (event) => {
            // 只在首页和节点详情页监听点击事件
            if (view !== 'home' && view !== 'nodeDetail') return;

            // 检查点击是否在搜索栏区域内
            if (searchBarRef.current && !searchBarRef.current.contains(event.target)) {
                // 点击在搜索栏外部，隐藏搜索结果
                setShowSearchResults(false);
            }
        };

        // 添加全局点击事件监听器
        document.addEventListener('mousedown', handleClickOutside);

        // 清理函数：移除事件监听器
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [view]); // 依赖view状态，当view变化时重新绑定事件

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


    // 新节点创建相关函数
    const openCreateNodeModal = () => {
        setShowCreateNodeModal(true);
    };

    if (view === 'login') {
        return <Login onLogin={handleLoginSuccess} />;
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
                            <div className="header-buttons">
                                <span className="user-name" style={{marginRight: '1rem', display: 'flex', alignItems: 'center'}}>
                                    当前用户: {username}
                                </span>
                                <button
                                    onClick={handleLogout}
                                    className="btn btn-logout"
                                >
                                    退出登录
                                </button>
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
                                    onClick={() => {
                                        setView('alliance');
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
                                        }}
                                        className="btn btn-warning"
                                    >
                                        管理员面板
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 首页视图 */}
                {view === "home" && (
                    <HomeView
                        webglCanvasRef={webglCanvasRef}
                        searchQuery={homeSearchQuery}
                        onSearchChange={(e) => setHomeSearchQuery(e.target.value)}
                        onSearchFocus={() => setShowSearchResults(true)}
                        onSearchClear={() => {
                            setHomeSearchQuery("");
                            setHomeSearchResults([]);
                            setShowSearchResults(true);
                        }}
                        searchResults={homeSearchResults}
                        showSearchResults={showSearchResults}
                        isSearching={isSearching}
                        onSearchResultClick={(node) => {
                            fetchNodeDetail(node._id, {
                                id: `search-${node._id}`,
                                data: node,
                                type: "search"
                            });
                            setShowSearchResults(false);
                        }}
                        onCreateNode={openCreateNodeModal}
                        isAdmin={isAdmin}
                        currentLocationNodeDetail={currentLocationNodeDetail}
                    />
                )}
                {/* 节点详情视图 */}
                {view === "nodeDetail" && currentNodeDetail && (
                    <NodeDetail
                        node={currentNodeDetail}
                        navigationPath={navigationPath}
                        onNavigate={(nodeId) => fetchNodeDetail(nodeId)}
                        onHome={() => {
                            setView("home");
                            setNavigationPath([{ type: "home", label: "首页" }]);
                        }}
                        onShowNavigationTree={() => setShowNavigationTree(true)}
                        searchQuery={homeSearchQuery}
                        onSearchChange={(e) => setHomeSearchQuery(e.target.value)}
                        onSearchFocus={() => setShowSearchResults(true)}
                        onSearchClear={() => {
                            setHomeSearchQuery("");
                            setHomeSearchResults([]);
                            setShowSearchResults(true);
                        }}
                        searchResults={homeSearchResults}
                        showSearchResults={showSearchResults}
                        isSearching={isSearching}
                        onSearchResultClick={(node) => {
                            fetchNodeDetail(node._id, {
                                id: `search-${node._id}`,
                                data: node,
                                type: "search"
                            });
                            setShowSearchResults(false);
                        }}
                        onCreateNode={openCreateNodeModal}
                        onNodeInfoClick={() => setShowNodeInfoModal(true)}
                        webglCanvasRef={webglCanvasRef}
                    />
                )}
                {view === "alliance" && (
                    <AlliancePanel 
                        username={username} 
                        token={localStorage.getItem("token")} 
                        isAdmin={isAdmin} 
                    />
                )}
                {view === "admin" && isAdmin && (
                    <AdminPanel />
                )}
                
                <AssociationModal 
                    isOpen={showAssociationModal}
                    onClose={() => setShowAssociationModal(false)}
                    viewingAssociationNode={viewingAssociationNode}
                />

                <NodeInfoModal 
                    isOpen={showNodeInfoModal}
                    onClose={() => setShowNodeInfoModal(false)}
                    nodeDetail={currentNodeDetail}
                />

                {showCreateNodeModal && (
                    <CreateNodeModal 
                        isOpen={showCreateNodeModal}
                        onClose={() => setShowCreateNodeModal(false)}
                        username={username}
                        isAdmin={isAdmin}
                        existingNodes={nodes}
                        onSuccess={(newNode) => {
                            if (newNode) {
                                setNodes(prev => [...prev, newNode]);
                            }
                        }}
                    />
                )}

                <NavigationTreeModal 
                    isOpen={showNavigationTree}
                    onClose={() => setShowNavigationTree(false)}
                    navigationPaths={fullNavigationPaths}
                    currentNode={currentNodeDetail}
                    onNavigate={(nodeId) => fetchNodeDetail(nodeId)}
                    onHome={() => {
                        setView('home');
                        setNavigationPath([{ type: 'home', label: '首页' }]);
                    }}
                />
            </div>
        </div>
    );
};

export default App;
