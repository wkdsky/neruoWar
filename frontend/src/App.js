import React, { useState, useEffect, useRef } from 'react';
import { Home, Shield, Bell, Layers, Star, MapPin, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';
import Login from './components/auth/Login';
import AdminPanel from './components/admin/AdminPanel';
import AlliancePanel from './components/game/AlliancePanel';
import ProfilePanel from './components/game/ProfilePanel';
import ArmyPanel from './components/game/ArmyPanel';
import NodeDetail from './components/game/NodeDetail';
import HomeView from './components/game/Home';
import KnowledgeDomainScene from './components/game/KnowledgeDomainScene';
import SceneManager from './SceneManager';
import LocationSelectionModal from './LocationSelectionModal';
import AssociationModal from './components/modals/AssociationModal';
import NodeInfoModal from './components/modals/NodeInfoModal';
import NavigationTreeModal from './components/modals/NavigationTreeModal';
import CreateNodeModal from './components/modals/CreateNodeModal';

// 导入头像
import defaultMale1 from './assets/avatars/default_male_1.svg';
import defaultMale2 from './assets/avatars/default_male_2.svg';
import defaultMale3 from './assets/avatars/default_male_3.svg';
import defaultFemale1 from './assets/avatars/default_female_1.svg';
import defaultFemale2 from './assets/avatars/default_female_2.svg';
import defaultFemale3 from './assets/avatars/default_female_3.svg';

// 头像映射
const avatarMap = {
    default_male_1: defaultMale1,
    default_male_2: defaultMale2,
    default_male_3: defaultMale3,
    default_female_1: defaultFemale1,
    default_female_2: defaultFemale2,
    default_female_3: defaultFemale3
};

const PAGE_STATE_STORAGE_KEY = 'app:lastPageState';

const readSavedPageState = () => {
    try {
        const raw = localStorage.getItem(PAGE_STATE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const view = typeof parsed.view === 'string' ? parsed.view : '';
        const nodeId = typeof parsed.nodeId === 'string' ? parsed.nodeId : '';
        return { view, nodeId };
    } catch (error) {
        return null;
    }
};

const normalizeObjectId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value._id) return normalizeObjectId(value._id);
    if (typeof value.toString === 'function') return value.toString();
    return '';
};

const ANNOUNCEMENT_NOTIFICATION_TYPES = ['domain_distribution_announcement', 'alliance_announcement'];
const isAnnouncementNotification = (notification) => (
    ANNOUNCEMENT_NOTIFICATION_TYPES.includes(notification?.type)
);
const RIGHT_DOCK_COLLAPSE_MS = 220;
const createEmptyNodeDistributionStatus = () => ({
    nodeId: '',
    active: false,
    phase: 'none',
    requiresManualEntry: false,
    joined: false,
    canJoin: false,
    canExit: false,
    joinTip: ''
});
const createDefaultDistributionPanelState = () => ({
    loading: false,
    joining: false,
    exiting: false,
    error: '',
    feedback: '',
    data: null
});
const formatCountdownText = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const day = Math.floor(total / 86400);
    const hour = Math.floor((total % 86400) / 3600);
    const minute = Math.floor((total % 3600) / 60);
    const second = total % 60;
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const ss = String(second).padStart(2, '0');
    if (day > 0) {
        return `${day}天 ${hh}:${mm}:${ss}`;
    }
    return `${hh}:${mm}:${ss}`;
};

const App = () => {
    const [socket, setSocket] = useState(null);
    const [authenticated, setAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [profession, setProfession] = useState('');
    const [userAvatar, setUserAvatar] = useState('default_male_1');
    const [nodes, setNodes] = useState([]);
    const [technologies, setTechnologies] = useState([]);
    const [view, setView] = useState('login');
    const socketRef = useRef(null);
    const isRestoringPageRef = useRef(false);
    const hasRestoredPageRef = useRef(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminEntryTab, setAdminEntryTab] = useState('users');


    // 修改检查登录状态的useEffect
    useEffect(() => {
        const token = localStorage.getItem('token');
        const storedUsername = localStorage.getItem('username');
        const storedLocation = localStorage.getItem('userLocation');
        const storedProfession = localStorage.getItem('profession');
        const storedAvatar = localStorage.getItem('userAvatar');

        if (token && storedUsername) {
            setAuthenticated(true);
            setUsername(storedUsername);
            setProfession(storedProfession || '');
            setUserLocation(storedLocation || '');
            setUserAvatar(storedAvatar || 'default_male_1');

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

    useEffect(() => {
        if (!authenticated) {
            hasRestoredPageRef.current = false;
            isRestoringPageRef.current = false;
        }
    }, [authenticated]);


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
    const [travelStatus, setTravelStatus] = useState({ isTraveling: false });
    const [nodeDistributionStatus, setNodeDistributionStatus] = useState(createEmptyNodeDistributionStatus);
    const [showDistributionPanel, setShowDistributionPanel] = useState(false);
    const [distributionPanelState, setDistributionPanelState] = useState(createDefaultDistributionPanelState);
    const [isStoppingTravel, setIsStoppingTravel] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
    const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
    const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
    const [isClearingNotifications, setIsClearingNotifications] = useState(false);
    const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
    const [isMarkingAnnouncementsRead, setIsMarkingAnnouncementsRead] = useState(false);
    const [isLocationDockExpanded, setIsLocationDockExpanded] = useState(false);
    const [isAnnouncementDockExpanded, setIsAnnouncementDockExpanded] = useState(false);
    const [announcementDockTab, setAnnouncementDockTab] = useState('system');
    const [notificationActionId, setNotificationActionId] = useState('');
    const [adminPendingNodes, setAdminPendingNodes] = useState([]);
    const [showRelatedDomainsPanel, setShowRelatedDomainsPanel] = useState(false);
    const [relatedDomainsData, setRelatedDomainsData] = useState({
        loading: false,
        error: '',
        domainMasterDomains: [],
        domainAdminDomains: [],
        favoriteDomains: [],
        recentDomains: []
    });
    const [favoriteActionDomainId, setFavoriteActionDomainId] = useState('');

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
    const [isApplyingDomainMaster, setIsApplyingDomainMaster] = useState(false);


    // 导航路径相关状态
    const [navigationPath, setNavigationPath] = useState([{ type: 'home', label: '首页' }]);
    const [showNavigationTree, setShowNavigationTree] = useState(false);
    const [fullNavigationPaths, setFullNavigationPaths] = useState([]);

    // 知识域场景相关状态
    const [showKnowledgeDomain, setShowKnowledgeDomain] = useState(false);
    const [knowledgeDomainNode, setKnowledgeDomainNode] = useState(null);
    const [domainTransitionProgress, setDomainTransitionProgress] = useState(0);
    const [isTransitioningToDomain, setIsTransitioningToDomain] = useState(false);

    // WebGL场景管理
    const webglCanvasRef = useRef(null);
    const sceneManagerRef = useRef(null);
    const [isWebGLReady, setIsWebGLReady] = useState(false);
    const [clickedNodeForTransition, setClickedNodeForTransition] = useState(null);
    const [canvasKey, setCanvasKey] = useState(0); // 用于强制重新渲染canvas

    // 搜索栏相关引用
    const searchBarRef = useRef(null);
    const notificationsWrapperRef = useRef(null);
    const relatedDomainsWrapperRef = useRef(null);

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

            // 设置按钮点击回调
            sceneManager.onButtonClick = (nodeId, button) => {
                if (button.action === 'enterKnowledgeDomain') {
                    // 获取当前节点详情并进入知识域
                    if (currentNodeDetail) {
                        handleEnterKnowledgeDomain(currentNodeDetail);
                    }
                } else if (button.action === 'joinDistribution' && currentNodeDetail) {
                    handleDistributionParticipationAction(currentNodeDetail);
                } else if (button.action === 'moveToNode' && currentNodeDetail) {
                    handleMoveToNode(currentNodeDetail);
                } else if (button.action === 'toggleFavoriteNode' && currentNodeDetail?._id) {
                    toggleFavoriteDomain(currentNodeDetail._id);
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

    // 更新按钮点击回调（确保获取最新的 currentNodeDetail）
    useEffect(() => {
        if (sceneManagerRef.current) {
            sceneManagerRef.current.onButtonClick = (nodeId, button) => {
                if (button.action === 'enterKnowledgeDomain' && currentNodeDetail) {
                    handleEnterKnowledgeDomain(currentNodeDetail);
                } else if (button.action === 'joinDistribution' && currentNodeDetail) {
                    handleDistributionParticipationAction(currentNodeDetail);
                } else if (button.action === 'moveToNode' && currentNodeDetail) {
                    handleMoveToNode(currentNodeDetail);
                } else if (button.action === 'toggleFavoriteNode' && currentNodeDetail?._id) {
                    toggleFavoriteDomain(currentNodeDetail._id);
                }
            };
        }
    }, [currentNodeDetail, isAdmin, userLocation, travelStatus.isTraveling, nodeDistributionStatus]);

    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        sceneManagerRef.current.setUserState(userLocation, travelStatus);
    }, [isWebGLReady, userLocation, travelStatus]);

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
    localStorage.setItem('profession', data.profession || '求知');
    localStorage.setItem('userAvatar', data.avatar || 'default_male_1');
    setAuthenticated(true);
    setUsername(data.username);
    setProfession(data.profession || '求知');
    setUserLocation(data.location || '');
    setUserAvatar(data.avatar || 'default_male_1');

    // 重新初始化socket连接（连接事件中会处理认证）
    initializeSocket(data.token);

    await checkAdminStatus();
    if (data.role !== 'admin') {
      fetchTravelStatus(true);
    } else {
      setTravelStatus({ isTraveling: false });
    }

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

  const syncUserLocation = (location) => {
    if (!location || location === '任意') {
      setUserLocation(location || '');
      localStorage.setItem('userLocation', location || '');
      return;
    }
    setUserLocation(location);
    localStorage.setItem('userLocation', location);
  };

  const parseApiResponse = async (response) => {
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (e) {
      data = null;
    }
    return { response, data, rawText };
  };

  const getApiErrorMessage = ({ response, data, rawText }, fallbackText) => {
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (typeof rawText === 'string' && rawText.includes('Cannot POST /api/travel/start')) {
      return '移动接口不存在（后端可能未重启，请重启后端服务）';
    }
    if (typeof rawText === 'string' && rawText.includes('Cannot GET /api/travel/status')) {
      return '移动状态接口不存在（后端可能未重启，请重启后端服务）';
    }
    if (typeof rawText === 'string' && rawText.includes('Cannot POST /api/travel/stop')) {
      return '停止移动接口不存在（后端可能未重启，请重启后端服务）';
    }
    if (typeof rawText === 'string' && rawText.includes('Cannot POST /api/travel/estimate')) {
      return '移动预估接口不存在（后端可能未重启，请重启后端服务）';
    }
    return `${fallbackText}（HTTP ${response.status}）`;
  };

  const fetchRelatedDomains = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    if (!silent) {
      setRelatedDomainsData((prev) => ({ ...prev, loading: true, error: '' }));
    }

    try {
      const response = await fetch('http://localhost:5000/api/nodes/me/related-domains', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        const errorText = getApiErrorMessage(parsed, '获取相关知识域失败');
        setRelatedDomainsData((prev) => ({
          ...prev,
          loading: false,
          error: errorText
        }));
        return null;
      }

      const nextData = {
        loading: false,
        error: '',
        domainMasterDomains: data.domainMasterDomains || [],
        domainAdminDomains: data.domainAdminDomains || [],
        favoriteDomains: data.favoriteDomains || [],
        recentDomains: data.recentDomains || []
      };
      setRelatedDomainsData(nextData);
      return nextData;
    } catch (error) {
      setRelatedDomainsData((prev) => ({
        ...prev,
        loading: false,
        error: `获取相关知识域失败: ${error.message}`
      }));
      return null;
    }
  };

  const toggleFavoriteDomain = async (domainId) => {
    const token = localStorage.getItem('token');
    const normalizedId = normalizeObjectId(domainId);
    if (!token || !normalizedId) return;

    setFavoriteActionDomainId(normalizedId);
    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${normalizedId}/favorite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '更新收藏失败'));
        return;
      }
      await fetchRelatedDomains(true);
    } catch (error) {
      window.alert(`更新收藏失败: ${error.message}`);
    } finally {
      setFavoriteActionDomainId('');
    }
  };

  const trackRecentDomain = async (nodeOrId) => {
    const token = localStorage.getItem('token');
    const domainId = normalizeObjectId(nodeOrId?._id || nodeOrId);
    if (!token || !domainId) return;

    try {
      await fetch(`http://localhost:5000/api/nodes/${domainId}/recent-visit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      // 最近访问记录失败不影响主流程
    }
  };

  const formatDomainKnowledgePoint = (node) => {
    const value = Number(node?.knowledgePoint?.value);
    if (!Number.isFinite(value)) return '知识点: --';
    return `知识点: ${value.toFixed(2)}`;
  };

  const fetchNotifications = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    if (!silent) {
      setIsNotificationsLoading(true);
    }

    try {
      const response = await fetch('http://localhost:5000/api/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取通知失败'));
        }
        return null;
      }

      setNotifications(data.notifications || []);
      setNotificationUnreadCount(data.unreadCount || 0);
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取通知失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setIsNotificationsLoading(false);
      }
    }
  };

  const fetchAdminPendingNodeReminders = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !isAdmin) {
      setAdminPendingNodes([]);
      return [];
    }

    try {
      const response = await fetch('http://localhost:5000/api/nodes/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !Array.isArray(data)) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取待审批创建申请失败'));
        }
        return [];
      }

      setAdminPendingNodes(data);
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取待审批创建申请失败: ${error.message}`);
      }
      return [];
    }
  };

  const markNotificationRead = async (notificationId) => {
    const token = localStorage.getItem('token');
    if (!token || !notificationId) return;
    const target = notifications.find((item) => item._id === notificationId);
    if (target?.read) return;

    try {
      const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '标记已读失败'));
        return;
      }

      setNotifications((prev) => prev.map((item) => (
        item._id === notificationId ? { ...item, read: true } : item
      )));
      if (!target?.read) {
        setNotificationUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      window.alert(`标记已读失败: ${error.message}`);
    }
  };

  const markAllNotificationsRead = async () => {
    const token = localStorage.getItem('token');
    if (!token || notificationUnreadCount <= 0) return;

    setIsMarkingAllRead(true);
    try {
      const response = await fetch('http://localhost:5000/api/notifications/read-all', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        return;
      }

      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
      setNotificationUnreadCount(0);
    } catch (error) {
      // 忽略提示，避免打断用户
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const markAnnouncementNotificationsRead = async () => {
    const token = localStorage.getItem('token');
    if (!token || isMarkingAnnouncementsRead) return;

    const unreadAnnouncementIds = notifications
      .filter((notification) => (
        isAnnouncementNotification(notification) &&
        !notification.read &&
        notification._id
      ))
      .map((notification) => notification._id);

    if (unreadAnnouncementIds.length === 0) {
      return;
    }

    setIsMarkingAnnouncementsRead(true);
    setNotifications((prev) => prev.map((item) => (
      isAnnouncementNotification(item) ? { ...item, read: true } : item
    )));
    setNotificationUnreadCount((prev) => Math.max(0, prev - unreadAnnouncementIds.length));

    try {
      await Promise.all(unreadAnnouncementIds.map(async (notificationId) => {
        const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/read`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) {
          throw new Error('标记公告已读失败');
        }
      }));
    } catch (error) {
      await fetchNotifications(true);
      if (isAdmin) {
        await fetchAdminPendingNodeReminders(true);
      }
    } finally {
      setIsMarkingAnnouncementsRead(false);
    }
  };

  const clearNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    if (!notifications.length) return;

    setIsClearingNotifications(true);
    try {
      const response = await fetch('http://localhost:5000/api/notifications/clear', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        window.alert(getApiErrorMessage(parsed, '清空通知失败'));
        return;
      }

      await fetchNotifications(true);
      if (isAdmin) {
        await fetchAdminPendingNodeReminders(true);
      }
    } catch (error) {
      window.alert(`清空通知失败: ${error.message}`);
    } finally {
      setIsClearingNotifications(false);
    }
  };

  const respondDomainAdminInvite = async (notificationId, action) => {
    const token = localStorage.getItem('token');
    if (!token || !notificationId) return;

    const actionKey = `${notificationId}:${action}`;
    setNotificationActionId(actionKey);

    try {
      const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        window.alert(getApiErrorMessage(parsed, '处理失败'));
        return;
      }

      window.alert(data.message || '处理完成');
      await fetchNotifications(true);
    } catch (error) {
      window.alert(`处理失败: ${error.message}`);
    } finally {
      setNotificationActionId('');
    }
  };

  const applyDomainMaster = async (nodeId, reason) => {
    const token = localStorage.getItem('token');
    const targetNodeId = normalizeObjectId(nodeId);
    if (!token || !targetNodeId) return false;

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${targetNodeId}/domain-master/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        window.alert(getApiErrorMessage(parsed, '提交域主申请失败'));
        return false;
      }

      window.alert(data.message || '域主申请已提交');
      await fetchNotifications(true);
      return true;
    } catch (error) {
      window.alert(`提交域主申请失败: ${error.message}`);
      return false;
    }
  };

  const handleApplyDomainMaster = async (reason) => {
    const targetNodeId = normalizeObjectId(currentNodeDetail?._id);
    if (!targetNodeId) return false;
    setIsApplyingDomainMaster(true);
    try {
      return await applyDomainMaster(targetNodeId, reason);
    } finally {
      setIsApplyingDomainMaster(false);
    }
  };

  const formatNotificationTime = (time) => {
    if (!time) return '';
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const openAdminPanel = async (tab = 'users') => {
    setAdminEntryTab(tab);
    await prepareForPrimaryNavigation();
    setView('admin');
  };

  const fetchTravelStatus = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch('http://localhost:5000/api/travel/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取移动状态失败'));
        }
        return null;
      }

      if (!data) {
        if (!silent) {
          window.alert('获取移动状态失败：返回数据不是 JSON');
        }
        return null;
      }

      const currentStoredLocation = localStorage.getItem('userLocation') || '';
      if (typeof data.location === 'string' && data.location !== currentStoredLocation) {
        syncUserLocation(data.location);
      }

      setTravelStatus(data.travel || { isTraveling: false });
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取移动状态失败: ${error.message}`);
      }
      return null;
    }
  };

  const normalizeDistributionParticipationData = (raw = {}, fallbackNodeId = '') => {
    const rawPool = raw?.pool && typeof raw.pool === 'object' ? raw.pool : {};
    const hasRewardValue = rawPool.rewardValue !== null && rawPool.rewardValue !== undefined;
    const parsedRewardValue = Number(rawPool.rewardValue);
    return {
      active: !!raw.active,
      nodeId: normalizeObjectId(raw.nodeId) || fallbackNodeId || '',
      nodeName: raw.nodeName || '',
      phase: raw.phase || 'none',
      executeAt: raw.executeAt || null,
      entryCloseAt: raw.entryCloseAt || null,
      endAt: raw.endAt || null,
      executedAt: raw.executedAt || null,
      secondsToEntryClose: Number(raw.secondsToEntryClose || 0),
      secondsToExecute: Number(raw.secondsToExecute || 0),
      secondsToEnd: Number(raw.secondsToEnd || 0),
      requiresManualEntry: !!raw.requiresManualEntry,
      autoEntry: !!raw.autoEntry,
      joined: !!raw.joined,
      joinedManual: !!raw.joinedManual,
      canJoin: !!raw.canJoin,
      canExit: !!raw.canExit,
      canExitWithoutConfirm: !!raw.canExitWithoutConfirm,
      joinTip: raw.joinTip || '',
      participantTotal: Number(raw.participantTotal || 0),
      pool: {
        key: rawPool.key || '',
        label: rawPool.label || '',
        poolPercent: Number(rawPool.poolPercent || 0),
        participantCount: Number(rawPool.participantCount || 0),
        userActualPercent: Number(rawPool.userActualPercent || 0),
        estimatedReward: Number(rawPool.estimatedReward || 0),
        rewardValue: hasRewardValue && Number.isFinite(parsedRewardValue) ? parsedRewardValue : null,
        rewardFrozen: !!rawPool.rewardFrozen,
        users: Array.isArray(rawPool.users) ? rawPool.users : []
      }
    };
  };

  const fetchDistributionParticipationStatus = async (nodeId, silent = true, options = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || isAdmin) {
      return null;
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/distribution-participation`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取分发参与状态失败'));
        }
        return null;
      }
      const normalized = normalizeDistributionParticipationData(data, nodeId);
      setNodeDistributionStatus({
        nodeId: normalized.nodeId,
        active: normalized.active,
        phase: normalized.phase,
        requiresManualEntry: normalized.requiresManualEntry,
        joined: normalized.joined,
        canJoin: normalized.canJoin,
        canExit: normalized.canExit,
        joinTip: normalized.joinTip
      });
      if (options.updatePanel) {
        setDistributionPanelState((prev) => ({
          ...prev,
          data: normalized,
          loading: false,
          error: ''
        }));
      }
      return normalized;
    } catch (error) {
      if (!silent) {
        window.alert(`获取分发参与状态失败: ${error.message}`);
      }
      return null;
    }
  };

  const estimateTravelToNode = async (targetNodeId) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch('http://localhost:5000/api/travel/estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ targetNodeId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        return {
          error: getApiErrorMessage(parsed, '获取移动预估失败')
        };
      }
      return data;
    } catch (error) {
      return { error: `获取移动预估失败: ${error.message}` };
    }
  };

  const startTravelToNode = async (targetNodeId) => {
    const token = localStorage.getItem('token');
    if (!token) return 'failed';

    try {
      const response = await fetch('http://localhost:5000/api/travel/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetNodeId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '开始移动失败'));
        return 'failed';
      }

      if (!data) {
        window.alert('开始移动失败：返回数据不是 JSON');
        return 'failed';
      }

      setTravelStatus(data.travel || { isTraveling: false });
      const currentStoredLocation = localStorage.getItem('userLocation') || '';
      if (typeof data.location === 'string' && data.location !== currentStoredLocation) {
        syncUserLocation(data.location);
      }

      if (data.travel?.isStopping) {
        if (data.message) {
          window.alert(data.message);
        }
        return 'queued';
      }

      return 'started';
    } catch (error) {
      window.alert(`开始移动失败: ${error.message}`);
      return 'failed';
    }
  };

  const stopTravel = async () => {
    if (isStoppingTravel) return;
    setIsStoppingTravel(true);
    const token = localStorage.getItem('token');

    try {
      const response = await fetch('http://localhost:5000/api/travel/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '停止移动失败'));
        return;
      }

      if (!data) {
        window.alert('停止移动失败：返回数据不是 JSON');
        return;
      }

      setTravelStatus(data.travel || { isTraveling: false });
      if (typeof data.location === 'string') {
        syncUserLocation(data.location);
      }
    } catch (error) {
      window.alert(`停止移动失败: ${error.message}`);
    } finally {
      setIsStoppingTravel(false);
    }
  };

  const handleMoveToNode = async (targetNode, options = {}) => {
    if (!targetNode || !targetNode._id) return;
    const promptMode = options?.promptMode === 'distribution' ? 'distribution' : 'default';

    if (isAdmin) {
      window.alert('管理员不可执行移动操作');
      return false;
    }

    const isHardMoving = travelStatus.isTraveling && !travelStatus.isStopping;
    const isStopping = !!travelStatus.isStopping;

    if (isHardMoving) {
      window.alert('你正在移动中，不能更换目的地。请先停止移动。');
      return false;
    }

    if (!userLocation || userLocation.trim() === '') {
      window.alert('尚未设置当前位置，暂时无法移动');
      return false;
    }

    if (!isStopping && targetNode.name === userLocation) {
      window.alert('你已经在该节点，无需移动');
      return false;
    }

    if (isStopping && targetNode.name === travelStatus?.stoppingNearestNode?.nodeName) {
      window.alert('停止移动期间不能把最近节点设为新的目标');
      return false;
    }

    let confirmMessage = '';
    if (isStopping) {
      confirmMessage = `是否将「${targetNode.name}」设为新的目标？将在停止移动完成后自动出发。`;
    } else {
      const estimate = await estimateTravelToNode(targetNode._id);
      if (estimate?.error) {
        window.alert(estimate.error);
        return false;
      }
      const estimatedText = estimate?.estimatedDurationText || formatTravelSeconds(estimate?.estimatedSeconds);
      confirmMessage = promptMode === 'distribution'
        ? `您不在该知识域，需先移动到此，预计花费${estimatedText}，您希望立刻移动吗？`
        : `是否移动到「${targetNode.name}」？预计花费 ${estimatedText}。`;
    }

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return false;

    const startResult = await startTravelToNode(targetNode._id);
    if (startResult === 'started') {
      return true;
    }
    return startResult === 'queued';
  };

  // 当userLocation变化时，获取节点详情
  useEffect(() => {
    if (authenticated && userLocation) {
      fetchLocationNodeDetail(userLocation);
    }
  }, [userLocation, authenticated]);

  useEffect(() => {
    if (!authenticated || isAdmin) {
      setTravelStatus({ isTraveling: false });
      return;
    }

    fetchTravelStatus(true);
    const timer = setInterval(() => {
      fetchTravelStatus(true);
    }, 1000);

    return () => clearInterval(timer);
  }, [authenticated, isAdmin]);

  useEffect(() => {
    const targetNodeId = normalizeObjectId(currentNodeDetail?._id);
    if (!authenticated || isAdmin || view !== 'nodeDetail' || !targetNodeId) {
      setNodeDistributionStatus(createEmptyNodeDistributionStatus());
      return undefined;
    }

    fetchDistributionParticipationStatus(targetNodeId, true);
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true);
    }, 4000);

    return () => clearInterval(timer);
  }, [authenticated, isAdmin, view, currentNodeDetail?._id, userLocation, travelStatus.isTraveling]);

  useEffect(() => {
    if (!showDistributionPanel) return undefined;
    const targetNodeId = normalizeObjectId(currentNodeDetail?._id);
    if (!targetNodeId || view !== 'nodeDetail') {
      setShowDistributionPanel(false);
      return undefined;
    }
    fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    }, 1000);
    return () => clearInterval(timer);
  }, [showDistributionPanel, view, currentNodeDetail?._id]);

  useEffect(() => {
    if (!authenticated) {
      setNotifications([]);
      setNotificationUnreadCount(0);
      setShowNotificationsPanel(false);
      setAdminPendingNodes([]);
      return;
    }

    fetchNotifications(true);
    if (isAdmin) {
      fetchAdminPendingNodeReminders(true);
    } else {
      setAdminPendingNodes([]);
    }
    const timer = setInterval(() => {
      fetchNotifications(true);
      if (isAdmin) {
        fetchAdminPendingNodeReminders(true);
      }
    }, 8000);

    return () => clearInterval(timer);
  }, [authenticated, isAdmin]);

  useEffect(() => {
    if (!socket) return;

    const handleAdminSyncPending = async () => {
      if (!authenticated || !isAdmin) return;
      await fetchNotifications(true);
      await fetchAdminPendingNodeReminders(true);
    };

    socket.on('admin-sync-pending', handleAdminSyncPending);
    return () => {
      socket.off('admin-sync-pending', handleAdminSyncPending);
    };
  }, [socket, authenticated, isAdmin]);

  useEffect(() => {
    if (!authenticated || isAdmin) {
      setRelatedDomainsData({
        loading: false,
        error: '',
        domainMasterDomains: [],
        domainAdminDomains: [],
        favoriteDomains: [],
        recentDomains: []
      });
      setShowRelatedDomainsPanel(false);
      return;
    }

    fetchRelatedDomains(true);
  }, [authenticated, isAdmin]);

  useEffect(() => {
    if (!authenticated || showLocationModal || hasRestoredPageRef.current) return;

    const saved = readSavedPageState();
    if (!saved?.view || saved.view === 'home') {
      hasRestoredPageRef.current = true;
      return;
    }

    isRestoringPageRef.current = true;

    const restorePage = async () => {
      const targetView = saved.view;
      const targetNodeId = normalizeObjectId(saved.nodeId);

      if ((targetView === 'nodeDetail' || targetView === 'knowledgeDomain') && targetNodeId) {
        const restoredNode = await fetchNodeDetail(targetNodeId);
        if (!restoredNode) {
          setView('home');
          return;
        }

        if (targetView === 'knowledgeDomain') {
          setKnowledgeDomainNode(restoredNode);
          setShowKnowledgeDomain(true);
          setIsTransitioningToDomain(false);
          setDomainTransitionProgress(1);
        }
        return;
      }

      if (targetView === 'alliance' || targetView === 'profile' || targetView === 'home') {
        setView(targetView);
        return;
      }

      if (targetView === 'army' && !isAdmin) {
        setView(targetView);
        return;
      }

      if (targetView === 'admin' && isAdmin) {
        setView('admin');
        return;
      }

      setView('home');
    };

    restorePage()
      .finally(() => {
        hasRestoredPageRef.current = true;
        isRestoringPageRef.current = false;
      });
  }, [authenticated, showLocationModal, isAdmin]);

  useEffect(() => {
    if (!authenticated || showLocationModal || isRestoringPageRef.current) return;

    const currentView = (showKnowledgeDomain || isTransitioningToDomain) ? 'knowledgeDomain' : view;
    const nodeId = normalizeObjectId(
      currentView === 'knowledgeDomain'
        ? (knowledgeDomainNode?._id || currentNodeDetail?._id)
        : (currentView === 'nodeDetail' ? currentNodeDetail?._id : '')
    );

    localStorage.setItem(PAGE_STATE_STORAGE_KEY, JSON.stringify({
      view: currentView,
      nodeId,
      updatedAt: Date.now()
    }));
  }, [
    authenticated,
    showLocationModal,
    view,
    showKnowledgeDomain,
    isTransitioningToDomain,
    currentNodeDetail,
    knowledgeDomainNode
  ]);

  useEffect(() => {
    if (!authenticated || showLocationModal || isRestoringPageRef.current) return;

    const isKnownView = ['home', 'nodeDetail', 'alliance', 'admin', 'profile', 'army'].includes(view);
    if (!isKnownView) {
      setView('home');
      return;
    }

    if (view === 'admin' && !isAdmin) {
      setView('home');
      return;
    }

    if (view === 'army' && isAdmin) {
      setView('home');
      return;
    }

    if (view === 'nodeDetail' && !currentNodeDetail && hasRestoredPageRef.current) {
      setView('home');
    }
  }, [authenticated, showLocationModal, view, isAdmin, currentNodeDetail]);

  useEffect(() => {
    if (!showNotificationsPanel) return undefined;

    const handleClickOutside = (event) => {
      if (notificationsWrapperRef.current && !notificationsWrapperRef.current.contains(event.target)) {
        setShowNotificationsPanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotificationsPanel]);

  useEffect(() => {
    if (!showRelatedDomainsPanel) return undefined;

    const handleClickOutside = (event) => {
      if (relatedDomainsWrapperRef.current && !relatedDomainsWrapperRef.current.contains(event.target)) {
        setShowRelatedDomainsPanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRelatedDomainsPanel]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('userLocation');
        localStorage.removeItem('profession');
        localStorage.removeItem('userAvatar');
        localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
        hasRestoredPageRef.current = false;
        isRestoringPageRef.current = false;
        setAuthenticated(false);
        setUsername('');
        setProfession('');
        setView('login');
        setIsAdmin(false);
        setAdminEntryTab('users');
        setUserLocation('');
        setTravelStatus({ isTraveling: false });
        setIsStoppingTravel(false);
        setNotifications([]);
        setNotificationUnreadCount(0);
        setShowNotificationsPanel(false);
        setIsNotificationsLoading(false);
        setNotificationActionId('');
        setAdminPendingNodes([]);
        setShowRelatedDomainsPanel(false);
        setRelatedDomainsData({
            loading: false,
            error: '',
            domainMasterDomains: [],
            domainAdminDomains: [],
            favoriteDomains: [],
            recentDomains: []
        });
        setFavoriteActionDomainId('');
        setIsApplyingDomainMaster(false);
        setCurrentLocationNodeDetail(null);
        setUserAvatar('default_male_1');
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
            } else {
                setIsAdmin(false);
            }
        } catch (error) {
            console.log('非管理员用户');
            setIsAdmin(false);
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

    const formatTravelSeconds = (seconds) => {
        if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
        const rounded = Math.round(seconds);
        const mins = Math.floor(rounded / 60);
        const remain = rounded % 60;
        if (mins <= 0) return `${remain} 秒`;
        return `${mins} 分 ${remain} 秒`;
    };

    const collapseRightDocksBeforeNavigation = async () => {
        if (isAdmin) return;
        const hasExpanded = isLocationDockExpanded || isAnnouncementDockExpanded;
        if (!hasExpanded) return;
        setIsLocationDockExpanded(false);
        setIsAnnouncementDockExpanded(false);
        await new Promise((resolve) => {
            setTimeout(resolve, RIGHT_DOCK_COLLAPSE_MS);
        });
    };

    const closeKnowledgeDomainBeforeNavigation = () => {
        if (showKnowledgeDomain || isTransitioningToDomain || knowledgeDomainNode) {
            setShowKnowledgeDomain(false);
            setIsTransitioningToDomain(false);
            setDomainTransitionProgress(0);
            setKnowledgeDomainNode(null);
            setClickedNodeForTransition(null);
        }
        if (showDistributionPanel) {
            setShowDistributionPanel(false);
            setDistributionPanelState(createDefaultDistributionPanelState());
        }
    };

    const prepareForPrimaryNavigation = async () => {
        closeKnowledgeDomainBeforeNavigation();
        await collapseRightDocksBeforeNavigation();
    };

    const navigateToHomeWithDockCollapse = async () => {
        await prepareForPrimaryNavigation();
        setView('home');
        setNavigationPath([{ type: 'home', label: '首页' }]);
    };

    // 获取节点详情
    const fetchNodeDetail = async (nodeId, clickedNode = null) => {
        try {
            await prepareForPrimaryNavigation();
            const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${nodeId}`);
            if (response.ok) {
                const data = await response.json();
                trackRecentDomain(data.node);
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
                return data.node;
            } else {
                alert('获取节点详情失败');
                return null;
            }
        } catch (error) {
            console.error('获取节点详情失败:', error);
            alert('获取节点详情失败');
            return null;
        }
    };

    const buildClickedNodeFromScene = (targetNodeId) => {
        const sceneNodes = sceneManagerRef.current?.currentLayout?.nodes || [];
        const matched = sceneNodes.find((n) => n?.data?._id === targetNodeId);
        if (!matched) return null;
        return {
            id: matched.id,
            data: matched.data,
            type: matched.type
        };
    };

    const handleJumpToCurrentLocationView = async () => {
        if (!currentLocationNodeDetail?._id) {
            return;
        }

        if (view === 'nodeDetail' && currentNodeDetail?.name === userLocation) {
            return;
        }

        const clickedNode = buildClickedNodeFromScene(currentLocationNodeDetail._id);
        await fetchNodeDetail(currentLocationNodeDetail._id, clickedNode);
    };

    const openDistributionPanel = (participationData) => {
        if (!participationData || !participationData.active) return;
        setDistributionPanelState({
            loading: false,
            joining: false,
            exiting: false,
            error: '',
            feedback: '',
            data: participationData
        });
        setShowDistributionPanel(true);
    };

    const handleDistributionParticipationAction = async (targetNodeDetail) => {
        if (!targetNodeDetail?._id) return;
        if (isAdmin) {
            window.alert('系统管理员不参与知识点分发');
            return;
        }

        const participation = await fetchDistributionParticipationStatus(targetNodeDetail._id, false);
        if (!participation) return;
        if (!participation.active) {
            window.alert('该知识域当前没有进行中的分发活动');
            return;
        }

        const refreshed = await fetchDistributionParticipationStatus(targetNodeDetail._id, true);
        const panelData = refreshed && refreshed.active ? refreshed : participation;
        if (panelData.active) openDistributionPanel(panelData);
    };

    const handleDistributionAnnouncementClick = async (notification) => {
        if (!notification) return;

        if (!notification.read && notification._id) {
            await markNotificationRead(notification._id);
        }

        let targetNodeId = normalizeObjectId(notification.nodeId);
        if (!targetNodeId && typeof notification.nodeName === 'string' && notification.nodeName.trim()) {
            try {
                const response = await fetch(`http://localhost:5000/api/nodes/public/search?query=${encodeURIComponent(notification.nodeName.trim())}`);
                if (response.ok) {
                    const data = await response.json();
                    const exactMatch = Array.isArray(data?.results)
                        ? data.results.find((node) => node?.name === notification.nodeName.trim())
                        : null;
                    targetNodeId = normalizeObjectId(exactMatch?._id);
                }
            } catch (error) {
                targetNodeId = '';
            }
        }
        if (!targetNodeId) return;

        const clickedNode = buildClickedNodeFromScene(targetNodeId);
        await fetchNodeDetail(targetNodeId, clickedNode);
        setShowSearchResults(false);
    };

    const handleArrivalNotificationClick = async (notification) => {
        if (!notification) return;
        await handleDistributionAnnouncementClick(notification);
    };

    const handleHomeAnnouncementClick = async (notification) => {
        if (!notification) return;
        if (notification.type === 'domain_distribution_announcement') {
            await handleDistributionAnnouncementClick(notification);
            return;
        }

        if (!notification.read && notification._id) {
            await markNotificationRead(notification._id);
        }
    };

    const closeDistributionPanel = () => {
        setShowDistributionPanel(false);
        setDistributionPanelState(createDefaultDistributionPanelState());
    };

    const joinDistributionFromPanel = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(currentNodeDetail?._id);
        const panelData = distributionPanelState.data;
        if (!token || !nodeId || !panelData) return;

        if (!panelData.active) {
            setDistributionPanelState((prev) => ({
                ...prev,
                error: ''
            }));
            return;
        }
        if (!panelData.canJoin) {
            const currentNodeName = (currentNodeDetail?.name || '').trim();
            const currentLocationName = (userLocation || '').trim();
            const shouldPromptMove = (
                panelData.requiresManualEntry &&
                !panelData.joined &&
                panelData.phase === 'entry_open' &&
                !!currentNodeName &&
                currentLocationName !== currentNodeName
            );
            if (shouldPromptMove && currentNodeDetail?._id) {
                await handleMoveToNode(currentNodeDetail, { promptMode: 'distribution' });
            }
            setDistributionPanelState((prev) => ({
                ...prev,
                error: ''
            }));
            return;
        }

        const confirmed = window.confirm(
            `确认参与知识域「${currentNodeDetail?.name || ''}」分发活动？确认后在本次分发结束前不可移动。`
        );
        if (!confirmed) return;

        setDistributionPanelState((prev) => ({
            ...prev,
            joining: true,
            error: '',
            feedback: ''
        }));
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/distribution-participation/join`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const parsed = await parseApiResponse(response);
            const data = parsed.data;
            if (!response.ok || !data) {
                setDistributionPanelState((prev) => ({
                    ...prev,
                    joining: false,
                    error: getApiErrorMessage(parsed, '参与分发失败')
                }));
                return;
            }
            const refreshed = await fetchDistributionParticipationStatus(nodeId, true, { updatePanel: true });
            setDistributionPanelState((prev) => ({
                ...prev,
                joining: false,
                feedback: '',
                data: refreshed || prev.data
            }));
        } catch (error) {
            setDistributionPanelState((prev) => ({
                ...prev,
                joining: false,
                error: `参与分发失败: ${error.message}`
            }));
        }
    };

    const exitDistributionFromPanel = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(currentNodeDetail?._id);
        const panelData = distributionPanelState.data;
        if (!token || !nodeId || !panelData?.canExit) return;

        if (!panelData.canExitWithoutConfirm) {
            const confirmed = window.confirm(`确认退出知识域「${currentNodeDetail?.name || ''}」分发活动？`);
            if (!confirmed) return;
        }

        setDistributionPanelState((prev) => ({
            ...prev,
            exiting: true,
            error: '',
            feedback: ''
        }));
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/distribution-participation/exit`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const parsed = await parseApiResponse(response);
            const data = parsed.data;
            if (!response.ok || !data) {
                setDistributionPanelState((prev) => ({
                    ...prev,
                    exiting: false,
                    error: getApiErrorMessage(parsed, '退出分发失败')
                }));
                return;
            }
            const refreshed = await fetchDistributionParticipationStatus(nodeId, true, { updatePanel: true });
            setDistributionPanelState((prev) => ({
                ...prev,
                exiting: false,
                feedback: '',
                data: refreshed || prev.data
            }));
        } catch (error) {
            setDistributionPanelState((prev) => ({
                ...prev,
                exiting: false,
                error: `退出分发失败: ${error.message}`
            }));
        }
    };

    const domainMasterDomains = relatedDomainsData.domainMasterDomains || [];
    const domainAdminDomains = relatedDomainsData.domainAdminDomains || [];
    const favoriteDomains = relatedDomainsData.favoriteDomains || [];
    const recentDomains = relatedDomainsData.recentDomains || [];

    const favoriteDomainSet = new Set(favoriteDomains.map((node) => normalizeObjectId(node?._id)));
    const relatedDomainCount = new Set([
        ...domainMasterDomains.map((node) => normalizeObjectId(node?._id)),
        ...domainAdminDomains.map((node) => normalizeObjectId(node?._id)),
        ...favoriteDomains.map((node) => normalizeObjectId(node?._id)),
        ...recentDomains.map((node) => normalizeObjectId(node?._id))
    ].filter(Boolean)).size;
    const pendingMasterApplyCount = notifications.filter((notification) => (
        notification.type === 'domain_master_apply' &&
        notification.status === 'pending'
    )).length;
    const systemAnnouncements = notifications
        .filter((notification) => notification.type === 'domain_distribution_announcement')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
    const allianceAnnouncements = notifications
        .filter((notification) => notification.type === 'alliance_announcement')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
    const announcementGroups = {
        system: systemAnnouncements,
        alliance: allianceAnnouncements
    };
    const announcementUnreadCount = notifications.filter((notification) => (
        isAnnouncementNotification(notification) && !notification.read
    )).length;
    useEffect(() => {
        if (announcementDockTab === 'system' && systemAnnouncements.length === 0 && allianceAnnouncements.length > 0) {
            setAnnouncementDockTab('alliance');
        } else if (announcementDockTab === 'alliance' && allianceAnnouncements.length === 0 && systemAnnouncements.length > 0) {
            setAnnouncementDockTab('system');
        }
    }, [announcementDockTab, systemAnnouncements.length, allianceAnnouncements.length]);
    useEffect(() => {
        const canRenderDock = !isAdmin && (view === 'home' || (view === 'nodeDetail' && currentNodeDetail));
        if (!canRenderDock) {
            setIsLocationDockExpanded(false);
            setIsAnnouncementDockExpanded(false);
        }
    }, [view, currentNodeDetail, isAdmin]);
    const adminPendingApprovalCount = pendingMasterApplyCount + adminPendingNodes.length;
    const notificationBadgeCount = isAdmin ? adminPendingApprovalCount : notificationUnreadCount;
    const currentNodeMasterId = normalizeObjectId(currentNodeDetail?.domainMaster);
    const currentNodeOwnerRole = currentNodeDetail?.owner?.role || '';
    const canApplyDomainMaster = Boolean(
        authenticated &&
        !isAdmin &&
        normalizeObjectId(currentNodeDetail?._id) &&
        !currentNodeMasterId &&
        (currentNodeOwnerRole === 'admin' || currentNodeOwnerRole === '')
    );

    const handleOpenRelatedDomain = async (node) => {
        const nodeId = normalizeObjectId(node?._id);
        if (!nodeId) return;
        setShowRelatedDomainsPanel(false);
        const clickedNode = buildClickedNodeFromScene(nodeId);
        await fetchNodeDetail(nodeId, clickedNode);
    };

    const handleOpenTravelNode = async (travelNode) => {
        const nodeId = normalizeObjectId(travelNode?.nodeId);
        if (!nodeId) return;
        const clickedNode = buildClickedNodeFromScene(nodeId);
        await fetchNodeDetail(nodeId, clickedNode);
    };

    const renderRelatedDomainSection = (title, domainList, emptyText) => (
        <div className="related-domain-section">
            <div className="related-domain-section-title">
                <span>{title}</span>
                <span className="related-domain-count">{domainList.length}</span>
            </div>
            {domainList.length === 0 ? (
                <div className="related-domain-empty">{emptyText}</div>
            ) : (
                <div className="related-domain-list">
                    {domainList.map((domain) => {
                        const domainId = normalizeObjectId(domain?._id);
                        const isFavorite = favoriteDomainSet.has(domainId);
                        const isUpdatingFavorite = favoriteActionDomainId === domainId;
                        return (
                            <div key={`${title}-${domainId}`} className="related-domain-item">
                                <button
                                    type="button"
                                    className="related-domain-link"
                                    onClick={() => handleOpenRelatedDomain(domain)}
                                >
                                    <span className="related-domain-name">{domain.name}</span>
                                    <span className="related-domain-meta">{formatDomainKnowledgePoint(domain)}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`related-domain-fav-btn ${isFavorite ? 'active' : ''}`}
                                    onClick={() => toggleFavoriteDomain(domainId)}
                                    disabled={isUpdatingFavorite}
                                    title={isFavorite ? '取消收藏' : '加入收藏'}
                                >
                                    <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const renderRelatedDomainsPanel = () => {
        if (!showRelatedDomainsPanel) return null;

        return (
            <div className="related-domains-panel">
                <div className="related-domains-header">
                    <h3>与我相关的知识域</h3>
                </div>
                <div className="related-domains-body">
                    {relatedDomainsData.loading && <div className="related-domain-empty">加载中...</div>}
                    {!relatedDomainsData.loading && relatedDomainsData.error && (
                        <div className="related-domains-error">{relatedDomainsData.error}</div>
                    )}
                    {renderRelatedDomainSection('作为域主', domainMasterDomains, '当前没有作为域主的知识域')}
                    {renderRelatedDomainSection('作为域相', domainAdminDomains, '当前没有域相身份的知识域')}
                    {renderRelatedDomainSection('收藏的知识域', favoriteDomains, '暂无收藏，点击右侧星标可收藏')}
                    {renderRelatedDomainSection('最近访问的知识域', recentDomains, '暂无访问记录')}
                </div>
            </div>
        );
    };

    const getNodeDetailButtonContext = (nodeDetail) => {
        const isAtCurrentNode = nodeDetail?.name === userLocation;
        const isHardMoving = travelStatus.isTraveling && !travelStatus.isStopping;
        const isNearestInStopping = travelStatus.isStopping && nodeDetail?.name === travelStatus?.stoppingNearestNode?.nodeName;
        const moveDisabled = isAtCurrentNode || isHardMoving || !userLocation || isNearestInStopping;
        const moveDisabledReason = isAtCurrentNode
            ? '已位于该节点'
            : (isHardMoving
                ? '移动中不可切换目的地'
                : (!userLocation
                    ? '未设置当前位置'
                    : (isNearestInStopping ? '停止移动期间不能选择最近节点' : '当前不可移动')));
        const targetNodeId = normalizeObjectId(nodeDetail?._id);
        const distributionStatusMatched = nodeDistributionStatus.nodeId === targetNodeId
            ? nodeDistributionStatus
            : createEmptyNodeDistributionStatus();
        const showDistributionButton = !isAdmin && !!distributionStatusMatched.active;
        const distributionHighlighted = false;
        const distributionDisabled = false;
        const distributionDisabledReason = '';
        const distributionButtonTooltip = '知识点分发';

        return {
            showMoveButton: !isAdmin,
            isFavorite: favoriteDomainSet.has(normalizeObjectId(nodeDetail?._id)),
            moveDisabled,
            moveDisabledReason,
            showDistributionButton,
            distributionHighlighted,
            distributionDisabled,
            distributionDisabledReason,
            distributionButtonTooltip
        };
    };

    useEffect(() => {
        if (!sceneManagerRef.current) return;

        sceneManagerRef.current.onNodeClick = (node) => {
            if (!node?.data?._id) return;

            if (view === 'nodeDetail' && node.type === 'center') {
                setShowNodeInfoModal(true);
                return;
            }

            fetchNodeDetail(node.data._id, node);
        };
    }, [view]);

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
        sceneManagerRef.current.showNodeDetail(
            currentNodeDetail,
            parentNodes,
            childNodes,
            clickedNodeForTransition,
            getNodeDetailButtonContext(currentNodeDetail)
        );

        // 动画完成后清除clickedNode状态
        setClickedNodeForTransition(null);
    }, [isWebGLReady, view, currentNodeDetail]);

    useEffect(() => {
        if (!sceneManagerRef.current) return;
        if (view !== 'nodeDetail' || !currentNodeDetail) return;

        sceneManagerRef.current.setupCenterNodeButtons(
            currentNodeDetail,
            getNodeDetailButtonContext(currentNodeDetail)
        );
    }, [view, currentNodeDetail, isAdmin, userLocation, travelStatus.isTraveling, travelStatus.isStopping, relatedDomainsData.favoriteDomains, nodeDistributionStatus]);


    // 新节点创建相关函数
    const openCreateNodeModal = () => {
        setShowCreateNodeModal(true);
    };

    // 进入知识域
    const handleEnterKnowledgeDomain = (node) => {
        if (!sceneManagerRef.current || !node) return;

        trackRecentDomain(node);
        setKnowledgeDomainNode(node);
        setIsTransitioningToDomain(true);
        setShowNodeInfoModal(false); // 关闭节点信息弹窗

        // 开始过渡动画
        sceneManagerRef.current.enterKnowledgeDomain(
            () => {
                // 动画完成，显示知识域场景
                setShowKnowledgeDomain(true);
                setIsTransitioningToDomain(false);
                setDomainTransitionProgress(1);
            },
            (progress) => {
                // 更新过渡进度
                setDomainTransitionProgress(progress);
            }
        );
    };

    // 退出知识域
    const handleExitKnowledgeDomain = () => {
        if (!sceneManagerRef.current) {
            setShowKnowledgeDomain(false);
            setDomainTransitionProgress(0);
            setKnowledgeDomainNode(null);
            return;
        }

        setIsTransitioningToDomain(true);

        // 开始反向过渡动画
        sceneManagerRef.current.exitKnowledgeDomain(
            () => {
                // 开始恢复场景，知识域开始淡出
                setShowKnowledgeDomain(false);
            },
            (progress) => {
                // 更新过渡进度（从1到0）
                setDomainTransitionProgress(progress);
            },
            () => {
                // 动画完成
                setIsTransitioningToDomain(false);
                setDomainTransitionProgress(0);
                setKnowledgeDomainNode(null);
            }
        );
    };

    const renderUnifiedRightDock = () => {
        if (isAdmin) return null;
        const canRenderDock = view === 'home' || (view === 'nodeDetail' && currentNodeDetail);
        if (!canRenderDock) return null;

        const canJumpToLocationView = Boolean(
            !travelStatus.isTraveling &&
            currentLocationNodeDetail &&
            userLocation &&
            !(view === 'nodeDetail' && currentNodeDetail?.name === userLocation)
        );
        const activeAnnouncements = announcementDockTab === 'alliance'
            ? allianceAnnouncements
            : systemAnnouncements;

        return (
            <>
                <div className={`home-announcement-dock ${isAnnouncementDockExpanded ? 'expanded' : 'collapsed'}`}>
                    <aside className={`home-announcement-dock-panel ${isAnnouncementDockExpanded ? 'expanded' : ''}`}>
                        <div className="home-announcement-dock-header">
                            <h3>公告栏</h3>
                            <div className="home-announcement-header-actions">
                                <button
                                    type="button"
                                    className="home-announcement-readall-btn"
                                    onClick={() => markAnnouncementNotificationsRead()}
                                    disabled={isMarkingAnnouncementsRead || announcementUnreadCount <= 0}
                                >
                                    {isMarkingAnnouncementsRead ? '处理中...' : '全部已读'}
                                </button>
                                <button
                                    type="button"
                                    className="home-announcement-collapse-btn"
                                    onClick={() => setIsAnnouncementDockExpanded(false)}
                                >
                                    收起
                                </button>
                            </div>
                        </div>
                        <div className="home-announcement-tab-row">
                            <button
                                type="button"
                                className={`home-announcement-tab ${announcementDockTab === 'system' ? 'active' : ''}`}
                                onClick={() => setAnnouncementDockTab('system')}
                            >
                                系统公告
                            </button>
                            <button
                                type="button"
                                className={`home-announcement-tab ${announcementDockTab === 'alliance' ? 'active' : ''}`}
                                onClick={() => setAnnouncementDockTab('alliance')}
                            >
                                熵盟公告
                            </button>
                        </div>
                        <div className="home-announcement-dock-body">
                            {activeAnnouncements.length === 0 ? (
                                <div className="home-announcement-empty">
                                    {announcementDockTab === 'alliance' ? '暂无熵盟公告' : '暂无系统公告'}
                                </div>
                            ) : (
                                activeAnnouncements.map((item) => (
                                    <button
                                        type="button"
                                        key={item._id}
                                        className={`home-announcement-item ${item.read ? '' : 'unread'}`}
                                        onClick={() => handleHomeAnnouncementClick(item)}
                                    >
                                        {!item.read && <span className="home-announcement-new">NEW!</span>}
                                        <span className="home-announcement-title">{item.title || '知识点分发预告'}</span>
                                        <span className="home-announcement-message">{item.message || ''}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </aside>
                    <button
                        type="button"
                        className="home-announcement-dock-toggle"
                        onClick={() => {
                            setIsAnnouncementDockExpanded((prev) => {
                                const next = !prev;
                                if (next) {
                                    markAnnouncementNotificationsRead();
                                }
                                return next;
                            });
                        }}
                        title={isAnnouncementDockExpanded ? '收起公告栏' : '展开公告栏'}
                    >
                        <Bell size={18} />
                        <span className="home-announcement-dock-label">公告</span>
                        {announcementUnreadCount > 0 && <span className="home-announcement-dock-dot" />}
                        {isAnnouncementDockExpanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>

                <div className={`home-location-dock ${isLocationDockExpanded ? 'expanded' : 'collapsed'}`}>
                    <aside className={`home-location-dock-panel ${isLocationDockExpanded ? 'expanded' : ''}`}>
                        <div className="location-sidebar-header home-location-sidebar-header">
                            <div className="home-location-header-row">
                                <h3>{travelStatus?.isTraveling ? '移动状态' : '当前所在的知识域'}</h3>
                                <button
                                    type="button"
                                    className="home-location-collapse-btn"
                                    onClick={() => setIsLocationDockExpanded(false)}
                                >
                                    收起
                                </button>
                            </div>
                        </div>

                        <div className="home-location-panel-body">
                            {travelStatus?.isTraveling ? (
                                <div className="travel-sidebar-content">
                                    <div className="travel-main-info">
                                        <div className="travel-destination">
                                            {travelStatus?.isStopping ? '停止目标' : '目标节点'}: <strong>{travelStatus?.targetNode?.nodeName}</strong>
                                        </div>
                                        <div className="travel-metrics">
                                            <span>剩余距离: {travelStatus?.remainingDistanceUnits?.toFixed?.(2) ?? travelStatus?.remainingDistanceUnits} 单位</span>
                                            <span>剩余时间: {formatTravelSeconds(travelStatus?.remainingSeconds)}</span>
                                            {travelStatus?.queuedTargetNode?.nodeName && (
                                                <span>已排队目标: {travelStatus.queuedTargetNode.nodeName}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="travel-anim-layout">
                                        <button
                                            type="button"
                                            className={`travel-node-card next ${normalizeObjectId(travelStatus?.nextNode?.nodeId) ? 'clickable' : 'disabled'}`}
                                            onClick={() => handleOpenTravelNode(travelStatus?.nextNode)}
                                            disabled={!normalizeObjectId(travelStatus?.nextNode?.nodeId)}
                                        >
                                            <div className="travel-node-label">下一目的地</div>
                                            <div className="travel-node-name">{travelStatus?.nextNode?.nodeName || '-'}</div>
                                        </button>
                                        <div className="travel-track-wrap">
                                            <div className="travel-track">
                                                <div
                                                    className="travel-progress-dot"
                                                    style={{ left: `${(1 - (travelStatus?.progressInCurrentSegment || 0)) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className={`travel-node-card reached ${normalizeObjectId(travelStatus?.lastReachedNode?.nodeId) ? 'clickable' : 'disabled'}`}
                                            onClick={() => handleOpenTravelNode(travelStatus?.lastReachedNode)}
                                            disabled={!normalizeObjectId(travelStatus?.lastReachedNode?.nodeId)}
                                        >
                                            <div className="travel-node-label">最近到达</div>
                                            <div className="travel-node-name">{travelStatus?.lastReachedNode?.nodeName || '-'}</div>
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        className="btn btn-danger travel-stop-btn"
                                        onClick={stopTravel}
                                        disabled={isStoppingTravel || travelStatus?.isStopping}
                                    >
                                        {(isStoppingTravel || travelStatus?.isStopping) ? '停止进行中...' : '停止移动'}
                                    </button>
                                </div>
                            ) : currentLocationNodeDetail ? (
                                <div
                                    className={`location-sidebar-content ${canJumpToLocationView ? 'location-sidebar-jumpable' : ''}`}
                                    onClick={() => {
                                        if (canJumpToLocationView) {
                                            handleJumpToCurrentLocationView();
                                        }
                                    }}
                                >
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
                    </aside>

                    <button
                        type="button"
                        className="home-location-dock-toggle"
                        onClick={() => setIsLocationDockExpanded((prev) => !prev)}
                        title={isLocationDockExpanded ? '收起当前所在知识域' : '展开当前所在知识域'}
                    >
                        <MapPin size={18} />
                        <span className="home-location-dock-label">
                            {travelStatus?.isTraveling ? '移动中' : '知识域'}
                        </span>
                        {isLocationDockExpanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>
            </>
        );
    };

    const renderDistributionParticipationPanel = () => {
        if (view !== 'nodeDetail' || !showDistributionPanel || !currentNodeDetail) return null;
        const data = distributionPanelState.data;
        if (!data) return null;
        const pool = data.pool || {};
        const phaseLabelMap = {
            entry_open: '可入场',
            entry_closed: '入场截止',
            settling: '结算中',
            ended: '已结束',
            none: '未开始'
        };
        const phaseLabel = phaseLabelMap[data.phase] || '进行中';
        const participationStatusText = data.joined
            ? '你已参与'
            : (data.phase === 'entry_open' ? '你未参与' : '已无法参与');
        const participationStatusClass = data.joined
            ? 'joined'
            : (data.phase === 'entry_open' ? 'not-joined' : 'locked');
        const rewardLabel = pool.rewardFrozen ? '实际获得知识点' : '当前可获得';
        const rewardText = (pool.rewardValue === null || pool.rewardValue === undefined)
            ? ''
            : Number(pool.rewardValue).toFixed(2);
        const poolUsers = Array.isArray(pool.users) ? pool.users : [];
        const canPromptMoveThenJoin = (
            !!data.requiresManualEntry &&
            !data.joined &&
            data.phase === 'entry_open' &&
            ((userLocation || '').trim() !== (currentNodeDetail?.name || '').trim())
        );
        const joinButtonDisabled = (!data.canJoin && !canPromptMoveThenJoin) || distributionPanelState.joining;
        return (
            <div className="distribution-panel-overlay">
                <div className="distribution-panel-modal">
                    <button type="button" className="distribution-panel-close" onClick={closeDistributionPanel}>×</button>
                    <div className="distribution-panel-title-row">
                        <h3>{`分发活动：${currentNodeDetail.name}`}</h3>
                        <div className="distribution-panel-title-tags">
                            <span className={`distribution-panel-phase phase-${data.phase}`}>{phaseLabel}</span>
                            <span className={`distribution-panel-participation-status ${participationStatusClass}`}>{participationStatusText}</span>
                        </div>
                    </div>

                    {data.phase === 'entry_open' && (
                        <div className="distribution-panel-timer-row">
                            <span>{`入场截止：${formatCountdownText(data.secondsToEntryClose)}`}</span>
                            <span>{`执行倒计时：${formatCountdownText(data.secondsToExecute)}`}</span>
                        </div>
                    )}
                    {data.phase === 'entry_closed' && (
                        <div className="distribution-panel-timer-row">
                            <span>{`执行倒计时：${formatCountdownText(data.secondsToExecute)}`}</span>
                        </div>
                    )}
                    {data.phase === 'settling' && (
                        <div className="distribution-panel-timer-row">
                            <span>{`活动结束：${formatCountdownText(data.secondsToEnd)}`}</span>
                        </div>
                    )}

                    <div className="distribution-panel-grid">
                        <div className="distribution-panel-card"><span>参与总人数</span><strong>{data.participantTotal || 0}</strong></div>
                        <div className="distribution-panel-card"><span>本池总比例</span><strong>{Number(pool.poolPercent || 0).toFixed(2)}%</strong></div>
                        <div className="distribution-panel-card"><span>你的实际比例</span><strong>{Number(pool.userActualPercent || 0).toFixed(2)}%</strong></div>
                        <div className="distribution-panel-card"><span>{rewardLabel}</span><strong>{rewardText}</strong></div>
                        <div className="distribution-panel-card"><span>所在规则池</span><strong>{pool.label || '未命中规则池'}</strong></div>
                    </div>

                    {distributionPanelState.error && <div className="distribution-panel-error">{distributionPanelState.error}</div>}
                    <div className="distribution-panel-pool-row">
                        <div className="distribution-panel-pool-row-title">
                            {`同池人数：${pool.participantCount || 0}`}
                        </div>
                        <div className="distribution-panel-pool-avatars">
                            {poolUsers.length > 0 ? poolUsers.map((item) => (
                                <div
                                    key={item.userId || item.username}
                                    className="distribution-panel-pool-avatar"
                                    title={item.displayName || item.username || ''}
                                >
                                    <img
                                        src={avatarMap[item.avatar] || avatarMap.default_male_1}
                                        alt={item.username || '用户'}
                                    />
                                </div>
                            )) : (
                                <span className="distribution-panel-pool-empty">暂无</span>
                            )}
                        </div>
                    </div>

                    <div className="distribution-panel-actions">
                        <button
                            type="button"
                            className="btn btn-small btn-success"
                            onClick={joinDistributionFromPanel}
                            disabled={joinButtonDisabled}
                        >
                            {distributionPanelState.joining ? '参与中...' : '参与分发'}
                        </button>
                        {data.canExit && (
                            <button
                                type="button"
                                className="btn btn-small btn-danger"
                                onClick={exitDistributionFromPanel}
                                disabled={distributionPanelState.exiting}
                            >
                                {distributionPanelState.exiting ? '退出中...' : '退出分发活动'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderNotificationsPanel = () => {
        if (!showNotificationsPanel) return null;
        const refreshNotifications = async () => {
            await fetchNotifications(false);
            if (isAdmin) {
                await fetchAdminPendingNodeReminders(false);
            }
        };

        if (isAdmin) {
            const latestPendingNode = [...adminPendingNodes]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
            const adminReminders = [];

            if (pendingMasterApplyCount > 0) {
                adminReminders.push({
                    key: 'pending-master-apply',
                    title: '有用户申请域主',
                    message: `当前有 ${pendingMasterApplyCount} 条域主申请待处理。`,
                    createdAt: notifications.find((item) => (
                        item.type === 'domain_master_apply' && item.status === 'pending'
                    ))?.createdAt || null
                });
            }

            if (adminPendingNodes.length > 0) {
                adminReminders.push({
                    key: 'pending-node-create',
                    title: (adminPendingNodes.length === 1 && latestPendingNode?.name)
                        ? `有用户提交了创建「${latestPendingNode.name}」知识域`
                        : '有用户提交了创建知识域申请',
                    message: `当前有 ${adminPendingNodes.length} 条建节点申请待审批。`,
                    createdAt: latestPendingNode?.createdAt || null
                });
            }

            return (
                <div className="notifications-panel">
                    <div className="notifications-header">
                        <h3>通知中心</h3>
                        <button
                            type="button"
                            className="btn btn-small btn-blue"
                            onClick={markAllNotificationsRead}
                            disabled={isNotificationsLoading || isMarkingAllRead || notificationUnreadCount === 0}
                        >
                            {isMarkingAllRead ? '处理中...' : '全部已读'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-small btn-danger"
                            onClick={clearNotifications}
                            disabled={isNotificationsLoading || isClearingNotifications || notifications.length === 0}
                        >
                            {isClearingNotifications ? '清空中...' : '清空通知'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-small btn-secondary"
                            onClick={refreshNotifications}
                            disabled={isNotificationsLoading}
                        >
                            {isNotificationsLoading ? '刷新中...' : '刷新'}
                        </button>
                    </div>
                    <div className="notifications-body">
                        {adminReminders.length === 0 ? (
                            <div className="no-notifications">暂无审批提醒</div>
                        ) : (
                            <div className="notifications-list">
                                {adminReminders.map((reminder) => (
                                    <div key={reminder.key} className="notification-item unread">
                                        <div className="notification-item-title-row">
                                            <h4>{reminder.title}</h4>
                                            <span className="notification-dot" />
                                        </div>
                                        <div className="notification-item-message">{reminder.message}</div>
                                        <div className="notification-item-meta">
                                            {formatNotificationTime(reminder.createdAt)}
                                        </div>
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="btn btn-small btn-warning"
                                                onClick={() => {
                                                    setShowNotificationsPanel(false);
                                                    openAdminPanel('pending');
                                                }}
                                            >
                                                前往待审批
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div className="notifications-panel">
                <div className="notifications-header">
                    <h3>通知中心</h3>
                    <button
                        type="button"
                        className="btn btn-small btn-blue"
                        onClick={markAllNotificationsRead}
                        disabled={isNotificationsLoading || isMarkingAllRead || notificationUnreadCount === 0}
                    >
                        {isMarkingAllRead ? '处理中...' : '全部已读'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={clearNotifications}
                        disabled={isNotificationsLoading || isClearingNotifications || notifications.length === 0}
                    >
                        {isClearingNotifications ? '清空中...' : '清空通知'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={refreshNotifications}
                        disabled={isNotificationsLoading}
                    >
                        {isNotificationsLoading ? '刷新中...' : '刷新'}
                    </button>
                </div>
                <div className="notifications-body">
                    {notifications.length === 0 ? (
                        <div className="no-notifications">暂无通知</div>
                    ) : (
                        <div className="notifications-list">
                            {notifications.map((notification) => {
                                const isInvitePending =
                                    notification.type === 'domain_admin_invite' &&
                                    notification.status === 'pending';
                                const isResignRequestPending =
                                    notification.type === 'domain_admin_resign_request' &&
                                    notification.status === 'pending';
                                const isMasterApplyPending =
                                    notification.type === 'domain_master_apply' &&
                                    notification.status === 'pending';
                                const isAllianceJoinApplyPending =
                                    notification.type === 'alliance_join_apply' &&
                                    notification.status === 'pending';
                                const isDistributionAnnouncement =
                                    notification.type === 'domain_distribution_announcement';
                                const isArrivalNotification =
                                    notification.type === 'info' &&
                                    typeof notification.nodeName === 'string' &&
                                    notification.nodeName.trim() !== '';
                                const currentActionKey = notificationActionId.split(':')[0];
                                const isActing = currentActionKey === notification._id;

                                return (
                                    <div
                                        key={notification._id}
                                        className={`notification-item ${notification.read ? '' : 'unread'}`}
                                        onClick={(event) => {
                                            if (event.target.closest('.notification-actions')) {
                                                return;
                                            }
                                            if (isDistributionAnnouncement) {
                                                handleDistributionAnnouncementClick(notification);
                                                return;
                                            }
                                            if (isArrivalNotification) {
                                                handleArrivalNotificationClick(notification);
                                                return;
                                            }
                                            if (!notification.read) {
                                                markNotificationRead(notification._id);
                                            }
                                        }}
                                    >
                                        <div className="notification-item-title-row">
                                            <h4>{notification.title || '系统通知'}</h4>
                                            {!notification.read && <span className="notification-dot" />}
                                        </div>
                                        <div className="notification-item-message">{notification.message || ''}</div>
                                        <div className="notification-item-meta">
                                            {formatNotificationTime(notification.createdAt)}
                                        </div>
                                        {(notification.type === 'domain_admin_invite_result'
                                            || notification.type === 'domain_admin_resign_result'
                                            || notification.type === 'domain_master_apply_result'
                                            || notification.type === 'alliance_join_apply_result') && (
                                            <div className={`notification-result-tag ${notification.status === 'accepted' ? 'accepted' : 'rejected'}`}>
                                                {notification.status === 'accepted'
                                                    ? (notification.type === 'domain_admin_resign_result'
                                                        ? '域主已同意卸任'
                                                        : notification.type === 'domain_master_apply_result'
                                                            ? '管理员已同意你成为域主'
                                                            : notification.type === 'alliance_join_apply_result'
                                                                ? '盟主已同意入盟'
                                                            : '对方已接受')
                                                    : (notification.type === 'domain_admin_resign_result'
                                                        ? '域主已拒绝卸任'
                                                        : notification.type === 'domain_master_apply_result'
                                                            ? '管理员已拒绝你的域主申请'
                                                            : notification.type === 'alliance_join_apply_result'
                                                                ? '盟主已拒绝入盟'
                                                            : '对方已拒绝')}
                                            </div>
                                        )}

                                        {isInvitePending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-success"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                    disabled={isActing}
                                                >
                                                    接受
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-danger"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                    disabled={isActing}
                                                >
                                                    拒绝
                                                </button>
                                            </div>
                                        ) : isResignRequestPending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-success"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                    disabled={isActing}
                                                >
                                                    同意卸任
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-danger"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                    disabled={isActing}
                                                >
                                                    拒绝
                                                </button>
                                            </div>
                                        ) : isMasterApplyPending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-warning"
                                                    onClick={() => {
                                                        setShowNotificationsPanel(false);
                                                        openAdminPanel('pending');
                                                    }}
                                                >
                                                    前往待审批
                                                </button>
                                            </div>
                                        ) : isAllianceJoinApplyPending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-success"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                    disabled={isActing}
                                                >
                                                    同意加入
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-danger"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                    disabled={isActing}
                                                >
                                                    拒绝
                                                </button>
                                            </div>
                                        ) : (isDistributionAnnouncement && notification.requiresArrival) ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-warning"
                                                    onClick={() => handleDistributionAnnouncementClick(notification)}
                                                >
                                                    点击前往
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
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

    const isKnowledgeDomainActive = showKnowledgeDomain || isTransitioningToDomain;

    return (
        <div className={`game-container ${isKnowledgeDomainActive ? 'knowledge-domain-active' : ''}`}>
            <div className="game-content">
                {/* 头部 */}
                <div className={`header ${isKnowledgeDomainActive ? 'header-knowledge-domain-active' : ''}`}>
                    <div className="header-content">
                        <h1 className="header-title">
                            <Home className="icon" />
                            多节点策略系统
                        </h1>
                        <div className="header-right">
                            <div className="header-buttons">
                                <div className="user-identity-group">
                                    <div
                                        className="user-avatar-container"
                                        onClick={async () => {
                                            await prepareForPrimaryNavigation();
                                            setView('profile');
                                        }}
                                        title="点击进入个人中心"
                                    >
                                        <img
                                            src={avatarMap[userAvatar] || avatarMap['default_male_1']}
                                            alt="头像"
                                            className="user-avatar-small"
                                        />
                                        <span className="user-name">
                                            {username} {profession && `【${profession}】`}
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="btn btn-logout"
                                    >
                                        退出
                                    </button>
                                </div>
                                <div className="notifications-wrapper" ref={notificationsWrapperRef}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary notification-trigger-btn"
                                        onClick={async () => {
                                            const nextVisible = !showNotificationsPanel;
                                            setShowNotificationsPanel(nextVisible);
                                            setShowRelatedDomainsPanel(false);
                                            if (nextVisible) {
                                                await fetchNotifications(false);
                                                if (isAdmin) {
                                                    await fetchAdminPendingNodeReminders(false);
                                                }
                                            }
                                        }}
                                    >
                                        <Bell size={18} />
                                        通知
                                        {notificationBadgeCount > 0 && (
                                            <span className="notification-badge">
                                                {notificationBadgeCount > 99 ? '99+' : notificationBadgeCount}
                                            </span>
                                        )}
                                    </button>
                                    {renderNotificationsPanel()}
                                </div>
                                <div className="related-domains-wrapper" ref={relatedDomainsWrapperRef}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary related-domains-trigger-btn"
                                        onClick={async () => {
                                            const nextVisible = !showRelatedDomainsPanel;
                                            setShowNotificationsPanel(false);
                                            setShowRelatedDomainsPanel(nextVisible);
                                            if (nextVisible) {
                                                await fetchRelatedDomains(false);
                                            }
                                        }}
                                    >
                                        <Layers size={18} />
                                        我的知识域
                                        {relatedDomainCount > 0 && (
                                            <span className="notification-badge">
                                                {relatedDomainCount > 99 ? '99+' : relatedDomainCount}
                                            </span>
                                        )}
                                    </button>
                                    {renderRelatedDomainsPanel()}
                                </div>
                                <button
                                    onClick={async () => {
                                        await navigateToHomeWithDockCollapse();
                                    }}
                                    className="btn btn-primary"
                                >
                                    <Home size={18} />
                                    首页
                                </button>
                                <button
                                    onClick={async () => {
                                        await prepareForPrimaryNavigation();
                                        setView('alliance');
                                    }}
                                    className="btn btn-secondary"
                                >
                                    <Shield size={18} />
                                    熵盟
                                </button>
                                {!isAdmin && (
                                    <button
                                        onClick={async () => {
                                            await prepareForPrimaryNavigation();
                                            setView('army');
                                        }}
                                        className="btn btn-secondary"
                                    >
                                        <Users size={18} />
                                        军团编制
                                    </button>
                                )}
                                {isAdmin && (
                                    <button
                                        onClick={() => {
                                            openAdminPanel('users');
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
                        travelStatus={travelStatus}
                        onStopTravel={stopTravel}
                        isStoppingTravel={isStoppingTravel}
                        canJumpToLocationView={Boolean(
                            !travelStatus.isTraveling &&
                            currentLocationNodeDetail &&
                            userLocation
                        )}
                        onJumpToLocationView={handleJumpToCurrentLocationView}
                        announcementGroups={announcementGroups}
                        announcementUnreadCount={announcementUnreadCount}
                        isMarkingAnnouncementsRead={isMarkingAnnouncementsRead}
                        onAnnouncementClick={handleHomeAnnouncementClick}
                        onMarkAllAnnouncementsRead={markAnnouncementNotificationsRead}
                        onAnnouncementPanelViewed={markAnnouncementNotificationsRead}
                        showRightDocks={false}
                    />
                )}
                {/* 节点详情视图 */}
                {view === "nodeDetail" && currentNodeDetail && (
                    <>
                        <NodeDetail
                            node={currentNodeDetail}
                            navigationPath={navigationPath}
                            onNavigate={(nodeId) => fetchNodeDetail(nodeId)}
                            onHome={async () => {
                                await navigateToHomeWithDockCollapse();
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
                    </>
                )}
                {renderUnifiedRightDock()}
                {renderDistributionParticipationPanel()}
                {view === "alliance" && (
                    <AlliancePanel 
                        username={username} 
                        token={localStorage.getItem("token")} 
                        isAdmin={isAdmin} 
                    />
                )}
                {view === "admin" && isAdmin && (
                    <AdminPanel
                        key={`admin-${adminEntryTab}`}
                        initialTab={adminEntryTab}
                        onPendingMasterApplyHandled={() => fetchNotifications(true)}
                    />
                )}
                {view === "profile" && (
                    <ProfilePanel
                        username={username}
                        onAvatarChange={(newAvatar) => {
                            setUserAvatar(newAvatar);
                            localStorage.setItem('userAvatar', newAvatar);
                        }}
                    />
                )}
                {view === "army" && !isAdmin && (
                    <ArmyPanel />
                )}

                {view !== "home" &&
                 !(view === "nodeDetail" && currentNodeDetail) &&
                 view !== "alliance" &&
                 !(view === "admin" && isAdmin) &&
                 view !== "profile" &&
                 !(view === "army" && !isAdmin) && (
                    <div className="no-pending-nodes">
                        <p>页面状态异常，已为你回退到首页</p>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={async () => {
                                await navigateToHomeWithDockCollapse();
                            }}
                        >
                            返回首页
                        </button>
                    </div>
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
                    onEnterKnowledgeDomain={handleEnterKnowledgeDomain}
                    canApplyDomainMaster={canApplyDomainMaster}
                    isApplyingDomainMaster={isApplyingDomainMaster}
                    onApplyDomainMaster={handleApplyDomainMaster}
                />

                {showCreateNodeModal && (
                    <CreateNodeModal
                        isOpen={showCreateNodeModal}
                        onClose={() => setShowCreateNodeModal(false)}
                        username={username}
                        isAdmin={isAdmin}
                        existingNodes={nodes}
                        sceneManager={sceneManagerRef.current}
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
                    onHome={async () => {
                        await navigateToHomeWithDockCollapse();
                    }}
                />

                {/* 知识域场景 */}
                <KnowledgeDomainScene
                    node={knowledgeDomainNode}
                    isVisible={showKnowledgeDomain || isTransitioningToDomain}
                    onExit={handleExitKnowledgeDomain}
                    transitionProgress={domainTransitionProgress}
                />
            </div>
        </div>
    );
};

export default App;
