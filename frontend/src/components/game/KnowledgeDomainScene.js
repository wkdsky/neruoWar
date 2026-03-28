/**
 * KnowledgeDomainScene - 知识域3D俯视角场景
 * 显示：承口+道路（上方）、圆形地面（中间）、启口+道路（下方）
 */

import React, { useRef, useEffect, useState } from 'react';
import BattlefieldPreviewModal from './BattlefieldPreviewModal';
import './KnowledgeDomainScene.css';
import { API_BASE } from '../../runtimeConfig';
import { useUserCard } from '../social/UserCardContext';
import { getApiError, parseApiResponse } from './knowledgeDomain/api';
import KnowledgeDomainRenderer from './knowledgeDomain/KnowledgeDomainRenderer';
import KnowledgeDomainCityView from './knowledgeDomain/KnowledgeDomainCityView';
import KnowledgeDomainRightDock from './knowledgeDomain/KnowledgeDomainRightDock';
import KnowledgeDomainDistributionRuleModal from './knowledgeDomain/KnowledgeDomainDistributionRuleModal';
import KnowledgeDomainIntelHeistOverlay from './knowledgeDomain/KnowledgeDomainIntelHeistOverlay';
import useDistributionSettings from './knowledgeDomain/useDistributionSettings';
import useDomainAdmins from './knowledgeDomain/useDomainAdmins';
import useDefenseLayout from './knowledgeDomain/useDefenseLayout';
import useIntelHeist from './knowledgeDomain/useIntelHeist';
import {
  CITY_CAMERA_BUILD_ANGLE_DEG,
  CITY_CAMERA_DEFAULT_ANGLE_DEG,
  CITY_CAMERA_TRANSITION_MS,
  CITY_GATE_KEYS,
  CITY_GATE_LABELS,
  INTEL_HEIST_SCAN_MS,
  clampCityCameraAngle,
  clampPercent,
  clampPositionInsideCity,
  clampScenePanOffset,
  cloneDefenseLayout,
  formatCountdown,
  getGateDefenseTotal,
  getCityMetrics,
  isValidPlacement,
  normalizeDomainManagerUser
} from './knowledgeDomain/shared';

const KnowledgeDomainScene = ({
  node,
  isVisible,
  onExit,
  transitionProgress = 1, // 0-1，用于过渡动画
  mode = 'normal',
  onIntelSnapshotCaptured
}) => {
  const { openUserCard } = useUserCard();

  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const containerRef = useRef(null);
  const cityDefenseLayerRef = useRef(null);
  const cityGateLayerRef = useRef(null);
  const [activeTab, setActiveTab] = useState('info');
  const [infoPanelNode, setInfoPanelNode] = useState(node || null);
  const [isRefreshingInfoPanel, setIsRefreshingInfoPanel] = useState(false);
  const [infoPanelError, setInfoPanelError] = useState('');
  const [activeManageSidePanel, setActiveManageSidePanel] = useState('');
  const [isDomainInfoDockExpanded, setIsDomainInfoDockExpanded] = useState(false);
  const [battlefieldPreviewState, setBattlefieldPreviewState] = useState({
    open: false,
    gateKey: ''
  });
  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 });
  const [isScenePanning, setIsScenePanning] = useState(false);
  const [cameraAngleDeg, setCameraAngleDeg] = useState(CITY_CAMERA_DEFAULT_ANGLE_DEG);
  const buildingDragRef = useRef(null);
  const scenePanOffsetRef = useRef({ x: 0, y: 0 });
  const scenePanDragRef = useRef(null);
  const cameraAngleRef = useRef(CITY_CAMERA_DEFAULT_ANGLE_DEG);
  const cameraAngleAnimRef = useRef(null);
  const {
    distributionState,
    setDistributionState,
    distributionUserKeyword,
    setDistributionUserKeyword,
    distributionUserResults,
    distributionUserSearching,
    distributionAllianceKeyword,
    setDistributionAllianceKeyword,
    distributionAllianceResults,
    distributionAllianceSearching,
    isDistributionRuleModalOpen,
    setIsDistributionRuleModalOpen,
    newDistributionRuleName,
    setNewDistributionRuleName,
    hasUnsavedDistributionDraft,
    distributionToast,
    resetDistributionSettings,
    updateDistributionRule,
    updateActiveDistributionRuleName,
    setActiveDistributionRule,
    createDistributionRuleProfileItem,
    removeActiveDistributionRule,
    fetchDistributionSettings,
    saveDistributionSettings,
    publishDistributionPlan,
    distributionProfiles,
    activeDistributionRuleId,
    activeDistributionProfile,
    publishDistributionProfile,
    publishDistributionRuleId,
    distributionRule,
    hasMasterAlliance,
    currentPercentSummary,
    scopePercent,
    unallocatedPercent,
    lockedExecuteMs,
    hasLockedPlan,
    hasUpcomingPublishedPlan,
    countdownSeconds,
    blockedRuleNotes,
    conflictMessages
  } = useDistributionSettings({
    nodeId: node?._id || '',
    isVisible,
    activeTab
  });
  const {
    domainAdminState,
    searchKeyword,
    setSearchKeyword,
    searchResults,
    setSearchResults,
    isSearchingUsers,
    hasSearchedAdminUsers,
    setHasSearchedAdminUsers,
    invitingUsername,
    revokingInviteId,
    removingAdminId,
    isSubmittingResign,
    manageFeedback,
    setManageFeedback,
    isDomainAdminPermissionModalOpen,
    domainAdminPermissionDraftMap,
    domainAdminPermissionDirty,
    isSavingDomainAdminPermissions,
    normalizePermissionLabels,
    resetDomainAdmins,
    fetchDomainAdmins,
    applyResignDomainAdmin,
    inviteDomainAdmin,
    clearDomainAdminSearch,
    searchDomainAdminUsers,
    removeDomainAdmin,
    openDomainAdminPermissionModal,
    closeDomainAdminPermissionModal,
    toggleDomainAdminPermission,
    saveDomainAdminPermissions,
    revokeDomainAdminInvite
  } = useDomainAdmins({
    nodeId: node?._id || '',
    onMembershipChanged: () => fetchDistributionSettings(true)
  });
  const {
    defenseLayoutState,
    setDefenseLayoutState,
    gateDeployState,
    setGateDeployState,
    draggingBuildingTypeId,
    closeGateDeployDialog,
    resetDefenseState,
    fetchDefenseLayout,
    handleCityBuildDragOver,
    handleCityBuildDrop: handleCityBuildDropAction,
    updateSelectedBuildingType,
    toggleBuildMode,
    addDefenseBuilding,
    handleBuildingPaletteDragStart,
    handleBuildingPaletteDragEnd,
    setIntelOnSelectedBuilding,
    removeSelectedDefenseBuilding,
    saveDefenseLayout,
    handleDefenseBuildingPointerDown
  } = useDefenseLayout({
    nodeId: node?._id || '',
    buildingDragRef
  });
  const isIntelHeistMode = mode === 'intelHeist';
  const {
    intelHeistState,
    intelHeistClockMs,
    isIntelHeistExitConfirmOpen,
    setIsIntelHeistExitConfirmOpen,
    resetIntelHeistState,
    armIntelHeist,
    startIntelHeistSearch,
    exitIntelHeistGame,
    requestExitIntelHeistGame,
    cancelExitIntelHeistGame
  } = useIntelHeist({
    isVisible,
    isIntelHeistMode,
    nodeId: node?._id || '',
    node,
    onExit,
    onIntelSnapshotCaptured
  });
  const showManageTab = !!domainAdminState.canView;
  const hasParentEntrance = Array.isArray(node?.relatedParentDomains) && node.relatedParentDomains.length > 0;
  const hasChildEntrance = Array.isArray(node?.relatedChildDomains) && node.relatedChildDomains.length > 0;

  const refreshDomainInfoPanel = async (silent = false) => {
    const nodeId = typeof node?._id === 'string'
      ? node._id
      : (typeof node?._id?.toString === 'function' ? node._id.toString() : '');
    if (!nodeId) return null;

    if (!silent) {
      setIsRefreshingInfoPanel(true);
      setInfoPanelError('');
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/public/node-detail/${nodeId}?includeFavoriteCount=1`);
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data?.node) {
        const errorMessage = getApiError(parsed, '刷新知识域信息失败');
        const shouldAlert = !silent || parsed?.data?.code === 'NODE_SENSE_READ_MISS';
        if (!silent) {
          setInfoPanelError(errorMessage);
        }
        if (shouldAlert) {
          window.alert(errorMessage);
        }
        return null;
      }
      setInfoPanelNode(data.node);
      if (!silent) {
        setInfoPanelError('');
      }
      return data.node;
    } catch (error) {
      const errorMessage = `刷新知识域信息失败: ${error.message}`;
      if (!silent) {
        setInfoPanelError(errorMessage);
        window.alert(errorMessage);
      }
      return null;
    } finally {
      if (!silent) {
        setIsRefreshingInfoPanel(false);
      }
    }
  };

  const toggleManageSidePanel = (section) => {
    setActiveManageSidePanel((prev) => (prev === section ? '' : section));
  };

  const openBattlefieldPreview = (gateKey) => {
    if (!CITY_GATE_KEYS.includes(gateKey)) return;
    setBattlefieldPreviewState({
      open: true,
      gateKey
    });
  };

  const closeBattlefieldPreview = () => {
    setBattlefieldPreviewState({
      open: false,
      gateKey: ''
    });
    fetchDefenseLayout(true);
  };

  const handleBattlefieldPreviewSaved = () => {
    fetchDefenseLayout(true);
  };

  const applyCameraAngle = (angleDeg, syncState = true) => {
    const clamped = clampCityCameraAngle(angleDeg);
    cameraAngleRef.current = clamped;
    if (rendererRef.current) {
      rendererRef.current.setCameraAngle(clamped);
    }
    if (syncState) {
      setCameraAngleDeg(clamped);
    }
  };

  const applyScenePanOffset = (nextOffset = { x: 0, y: 0 }) => {
    const container = containerRef.current;
    const width = container?.clientWidth || sceneSize.width || 0;
    const height = container?.clientHeight || sceneSize.height || 0;
    const clamped = clampScenePanOffset(nextOffset, width, height);
    scenePanOffsetRef.current = clamped;
    if (rendererRef.current) {
      rendererRef.current.setViewOffset(clamped.x, clamped.y);
    }
    if (cityDefenseLayerRef.current) {
      cityDefenseLayerRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    }
    if (cityGateLayerRef.current) {
      cityGateLayerRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    }
  };

  const handleScenePointerDown = (event) => {
    if (event.button !== 0) return;
    if (!isVisible || displayOpacity <= 0.5) return;
    if (battlefieldPreviewState.open) return;
    if (defenseLayoutState.draggingBuildingId) return;
    const target = event.target;
    if (
      target?.closest('.domain-right-dock')
      || target?.closest('.exit-domain-btn')
      || target?.closest('.domain-return-top-btn')
      || target?.closest('.city-gate-trigger')
      || target?.closest('.gate-deploy-panel')
      || target?.closest('.number-pad-dialog-overlay')
      || target?.closest('.distribution-rule-modal-overlay')
      || target?.closest('.intel-heist-hud')
      || target?.closest('.intel-heist-result-overlay')
      || target?.closest('.intel-heist-hint')
      || target?.closest('.intel-heist-exit-confirm-overlay')
      || target?.closest('.intel-heist-exit-confirm-card')
      || target?.closest('.intel-heist-timeout-overlay')
      || target?.closest('.intel-heist-timeout-card')
      || target?.closest('.battlefield-modal-overlay')
      || target?.closest('.battlefield-modal')
      || target?.closest('.city-build-palette')
      || target?.closest('.city-defense-building.editable')
      || target?.closest('.city-defense-building.intel-heist-searchable')
    ) {
      return;
    }

    scenePanDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: scenePanOffsetRef.current.x,
      originY: scenePanOffsetRef.current.y,
      pointerId: event.pointerId
    };
    setIsScenePanning(true);
    if (typeof containerRef.current?.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        containerRef.current.setPointerCapture(event.pointerId);
      } catch (e) {
        // ignore capture errors in unsupported environments
      }
    }
  };

  const getPointerNormPosition = (clientX, clientY) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return null;
    const metrics = getCityMetrics(containerRect.width, containerRect.height, cameraAngleRef.current);
    const panOffset = scenePanOffsetRef.current || { x: 0, y: 0 };
    const rawX = (clientX - containerRect.left - metrics.centerX - panOffset.x) / (metrics.radiusX || 1);
    const rawY = (clientY - containerRect.top - metrics.centerY - panOffset.y) / (metrics.radiusY || 1);
    return clampPositionInsideCity({
      x: Math.max(-1, Math.min(1, rawX)),
      y: Math.max(-1, Math.min(1, rawY))
    });
  };

  const handleCityBuildDrop = (event) => {
    handleCityBuildDropAction(event, getPointerNormPosition);
  };

  // 计算实际的显示透明度（在进度40%后开始淡入，或退出时在60%前淡出完成）
  const displayOpacity = transitionProgress < 0.4
    ? 0
    : Math.min(1, (transitionProgress - 0.4) / 0.5);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setInfoPanelNode(node || null);
    setInfoPanelError('');
    setIsRefreshingInfoPanel(false);
  }, [node]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isVisible || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      setSceneSize({
        width: container.clientWidth,
        height: container.clientHeight
      });
    }

    // 创建渲染器
    rendererRef.current = new KnowledgeDomainRenderer(canvas);
    rendererRef.current.setCameraAngle(cameraAngleRef.current);
    rendererRef.current.setGateVisibility({
      cheng: hasParentEntrance,
      qi: hasChildEntrance
    });
    applyScenePanOffset(scenePanOffsetRef.current);
    rendererRef.current.startRenderLoop();

    // 监听窗口大小变化
    const handleResize = () => {
      if (container && rendererRef.current) {
        rendererRef.current.resize(container.clientWidth, container.clientHeight);
        setSceneSize({
          width: container.clientWidth,
          height: container.clientHeight
        });
        applyScenePanOffset(scenePanOffsetRef.current);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, hasParentEntrance, hasChildEntrance]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isVisible || !node?._id) return;

    setActiveTab('info');
    resetDomainAdmins();
    resetDistributionSettings();
    setActiveManageSidePanel(isIntelHeistMode ? '' : 'distribution');
    setIsDomainInfoDockExpanded(false);
    resetDefenseState();
    setBattlefieldPreviewState({
      open: false,
      gateKey: ''
    });
    resetIntelHeistState();
    buildingDragRef.current = null;
    scenePanDragRef.current = null;
    setIsScenePanning(false);
    if (cameraAngleAnimRef.current) {
      cancelAnimationFrame(cameraAngleAnimRef.current);
      cameraAngleAnimRef.current = null;
    }
    applyCameraAngle(CITY_CAMERA_DEFAULT_ANGLE_DEG);
    applyScenePanOffset({ x: 0, y: 0 });
    if (!isIntelHeistMode) {
      fetchDomainAdmins(false);
    }
    fetchDefenseLayout(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, node?._id, isIntelHeistMode]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showManageTab && activeTab === 'manage') {
      setActiveTab('info');
    }
  }, [showManageTab, activeTab]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || hasUnsavedDistributionDraft) return;
    fetchDistributionSettings(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isVisible, node?._id, hasUnsavedDistributionDraft]);

  useEffect(() => {
    if (!isVisible || !defenseLayoutState.draggingBuildingId || !defenseLayoutState.buildMode || !defenseLayoutState.canEdit) {
      return undefined;
    }

    const handlePointerMove = (event) => {
      const draggingId = buildingDragRef.current?.buildingId;
      if (!draggingId) return;
      const nextPosition = getPointerNormPosition(event.clientX, event.clientY);
      if (!nextPosition) return;

      setDefenseLayoutState((prev) => {
        if (!prev.buildMode || !prev.canEdit) return prev;
        const draftBuildings = prev.draftLayout?.buildings || [];
        const target = draftBuildings.find((item) => item.buildingId === draggingId);
        if (!target) return prev;
        const clamped = clampPositionInsideCity(nextPosition);
        if (!isValidPlacement(clamped, draftBuildings, draggingId)) {
          return prev;
        }
        const nextDraftLayout = cloneDefenseLayout(prev.draftLayout);
        nextDraftLayout.buildings = nextDraftLayout.buildings.map((item) => (
          item.buildingId === draggingId
            ? { ...item, x: clamped.x, y: clamped.y }
            : item
        ));
        return {
          ...prev,
          draftLayout: nextDraftLayout,
          selectedBuildingId: draggingId,
          isDirty: true,
          feedback: '',
          error: ''
        };
      });
    };

    const stopDragging = () => {
      buildingDragRef.current = null;
      setDefenseLayoutState((prev) => ({
        ...prev,
        draggingBuildingId: ''
      }));
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [isVisible, defenseLayoutState.draggingBuildingId, defenseLayoutState.buildMode, defenseLayoutState.canEdit, setDefenseLayoutState]);

  useEffect(() => {
    if (!isVisible) return;
    setDefenseLayoutState((prev) => {
      const catalog = Array.isArray(prev.buildingCatalog) ? prev.buildingCatalog : [];
      if (catalog.length === 0) {
        if (!prev.selectedBuildingTypeId) return prev;
        return { ...prev, selectedBuildingTypeId: '' };
      }
      const hasSelected = catalog.some((item) => item.buildingTypeId === prev.selectedBuildingTypeId);
      if (hasSelected) return prev;
      return { ...prev, selectedBuildingTypeId: catalog[0]?.buildingTypeId || '' };
    });
  }, [isVisible, defenseLayoutState.buildingCatalog, setDefenseLayoutState]);

  useEffect(() => {
    if (!isVisible || !isScenePanning) return undefined;

    const handlePointerMove = (event) => {
      const dragMeta = scenePanDragRef.current;
      if (!dragMeta) return;
      const dx = event.clientX - dragMeta.startX;
      const dy = event.clientY - dragMeta.startY;
      applyScenePanOffset({
        x: dragMeta.originX + dx,
        y: dragMeta.originY + dy
      });
    };

    const stopPanning = () => {
      const dragMeta = scenePanDragRef.current;
      if (
        dragMeta?.pointerId !== undefined
        && typeof containerRef.current?.releasePointerCapture === 'function'
      ) {
        try {
          containerRef.current.releasePointerCapture(dragMeta.pointerId);
        } catch (e) {
          // ignore capture errors in unsupported environments
        }
      }
      scenePanDragRef.current = null;
      setIsScenePanning(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopPanning);
    window.addEventListener('pointercancel', stopPanning);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopPanning);
      window.removeEventListener('pointercancel', stopPanning);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, isScenePanning]);

  useEffect(() => {
    if (!isVisible) {
      if (cameraAngleAnimRef.current) {
        cancelAnimationFrame(cameraAngleAnimRef.current);
        cameraAngleAnimRef.current = null;
      }
      applyCameraAngle(CITY_CAMERA_DEFAULT_ANGLE_DEG);
      return undefined;
    }

    const targetAngle = defenseLayoutState.buildMode
      ? CITY_CAMERA_BUILD_ANGLE_DEG
      : CITY_CAMERA_DEFAULT_ANGLE_DEG;
    const startAngle = cameraAngleRef.current;

    if (Math.abs(startAngle - targetAngle) < 0.05) {
      applyCameraAngle(targetAngle);
      return undefined;
    }

    if (cameraAngleAnimRef.current) {
      cancelAnimationFrame(cameraAngleAnimRef.current);
      cameraAngleAnimRef.current = null;
    }

    const transitionDuration = CITY_CAMERA_TRANSITION_MS;
    const startAt = performance.now();
    const easeInOutCubic = (t) => (
      t < 0.5
        ? (4 * t * t * t)
        : (1 - ((-2 * t + 2) ** 3) / 2)
    );

    const tick = (timestamp) => {
      const progress = Math.max(0, Math.min(1, (timestamp - startAt) / transitionDuration));
      const eased = easeInOutCubic(progress);
      const nextAngle = startAngle + ((targetAngle - startAngle) * eased);
      applyCameraAngle(nextAngle);
      if (progress < 1) {
        cameraAngleAnimRef.current = requestAnimationFrame(tick);
      } else {
        cameraAngleAnimRef.current = null;
        applyCameraAngle(targetAngle);
      }
    };

    cameraAngleAnimRef.current = requestAnimationFrame(tick);

    return () => {
      if (cameraAngleAnimRef.current) {
        cancelAnimationFrame(cameraAngleAnimRef.current);
        cameraAngleAnimRef.current = null;
      }
    };
  }, [defenseLayoutState.buildMode, isVisible]);

  useEffect(() => {
    if (!battlefieldPreviewState.open) return;
    scenePanDragRef.current = null;
    setIsScenePanning(false);
  }, [battlefieldPreviewState.open]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode) {
      resetIntelHeistState();
      return;
    }
    const buildings = Array.isArray(defenseLayoutState.savedLayout?.buildings)
      ? defenseLayoutState.savedLayout.buildings
      : [];
    if (defenseLayoutState.loading || buildings.length === 0) return;
    armIntelHeist(buildings);
    setIsDomainInfoDockExpanded(false);
    setGateDeployState((prev) => ({
      ...prev,
      activeGateKey: '',
      draggingUnitTypeId: '',
      editMode: false
    }));
    setBattlefieldPreviewState({
      open: false,
      gateKey: ''
    });
    setIsDistributionRuleModalOpen(false);
    closeGateDeployDialog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, isIntelHeistMode, node?._id, defenseLayoutState.loading, defenseLayoutState.savedLayout]);

  const adminPercentMap = new Map(
    (distributionRule.adminPercents || [])
      .filter((item) => item.userId)
      .map((item) => [item.userId, clampPercent(item.percent, 0)])
  );
  const effectiveAdminPercents = (domainAdminState.domainAdmins || []).map((adminUser) => ({
    userId: adminUser._id,
    username: adminUser.username,
    percent: adminPercentMap.get(adminUser._id) || 0
  }));
  const infoPanelDomainNode = infoPanelNode || node || null;
  const infoKnowledgePointValue = Number(infoPanelDomainNode?.knowledgePoint?.value);
  const infoProsperityValue = Number(infoPanelDomainNode?.prosperity);
  const infoContentScoreValue = Number(infoPanelDomainNode?.contentScore);
  const infoFavoriteUserCountValue = Number(infoPanelDomainNode?.favoriteUserCount);

  const canEditGateDefense = !!defenseLayoutState.canEdit;
  const isGateDeployEditing = canEditGateDefense && gateDeployState.editMode;
  const buildingCatalog = Array.isArray(defenseLayoutState.buildingCatalog) ? defenseLayoutState.buildingCatalog : [];
  const buildingTypeMap = new Map(
    buildingCatalog
      .map((item) => [item?.buildingTypeId || '', item])
      .filter(([id]) => !!id)
  );
  const buildingTypeUsageMap = new Map();
  const activeDefenseLayout = (defenseLayoutState.buildMode || isGateDeployEditing)
    ? defenseLayoutState.draftLayout
    : defenseLayoutState.savedLayout;
  const defenseBuildings = Array.isArray(activeDefenseLayout?.buildings)
    ? activeDefenseLayout.buildings
    : [];
  defenseBuildings.forEach((item) => {
    const buildingTypeId = typeof item?.buildingTypeId === 'string' ? item.buildingTypeId : '';
    if (!buildingTypeId) return;
    buildingTypeUsageMap.set(buildingTypeId, (buildingTypeUsageMap.get(buildingTypeId) || 0) + 1);
  });
  const defenseMetrics = getCityMetrics(
    sceneSize.width || containerRef.current?.clientWidth || 1280,
    sceneSize.height || containerRef.current?.clientHeight || 720,
    cameraAngleDeg
  );
  const gatePositions = {
    cheng: {
      x: defenseMetrics.centerX,
      y: defenseMetrics.centerY - defenseMetrics.radiusY - 92
    },
    qi: {
      x: defenseMetrics.centerX,
      y: defenseMetrics.centerY + defenseMetrics.radiusY + 92
    }
  };
  const gateTotals = {
    cheng: getGateDefenseTotal(activeDefenseLayout, 'cheng'),
    qi: getGateDefenseTotal(activeDefenseLayout, 'qi')
  };
  const canInspectGateDefense = !!defenseLayoutState.canViewGateDefense;
  const selectedDefenseBuilding = (defenseLayoutState.buildMode
    ? (defenseLayoutState.draftLayout?.buildings || [])
    : defenseBuildings
  ).find((item) => item.buildingId === defenseLayoutState.selectedBuildingId) || null;
  const selectedBuildingTypeForAdd = buildingTypeMap.get(defenseLayoutState.selectedBuildingTypeId)
    || buildingCatalog[0]
    || null;
  const selectedBuildingTypeUsedCount = selectedBuildingTypeForAdd?.buildingTypeId
    ? (buildingTypeUsageMap.get(selectedBuildingTypeForAdd.buildingTypeId) || 0)
    : 0;
  const selectedBuildingTypeRemainingCount = selectedBuildingTypeForAdd
    ? Math.max(0, Math.floor(Number(selectedBuildingTypeForAdd.initialCount) || 0) - selectedBuildingTypeUsedCount)
    : 0;
  const canAddDefenseBuilding = (
    defenseLayoutState.canEdit
    && defenseLayoutState.buildMode
    && (defenseLayoutState.draftLayout?.buildings || []).length < defenseLayoutState.maxBuildings
    && !!selectedBuildingTypeForAdd
    && selectedBuildingTypeRemainingCount > 0
  );
  const showBuildingPalette = defenseLayoutState.canEdit && defenseLayoutState.buildMode && !isIntelHeistMode;
  const masterFromNode = normalizeDomainManagerUser(infoPanelDomainNode?.domainMaster);
  const masterFromAdminState = normalizeDomainManagerUser(domainAdminState.domainMaster);
  const displayMaster = masterFromNode || masterFromAdminState || null;
  const adminSourceList = [];
  if (Array.isArray(infoPanelDomainNode?.domainAdmins)) {
    adminSourceList.push(...infoPanelDomainNode.domainAdmins);
  }
  if (Array.isArray(domainAdminState.domainAdmins)) {
    adminSourceList.push(...domainAdminState.domainAdmins);
  }
  const adminUserMap = new Map();
  adminSourceList.forEach((item) => {
    const normalized = normalizeDomainManagerUser(item);
    if (!normalized) return;
    if (displayMaster && normalized._id === displayMaster._id) return;
    if (!adminUserMap.has(normalized._id)) {
      adminUserMap.set(normalized._id, normalized);
    }
  });
  const displayAdmins = Array.from(adminUserMap.values());
  const showDefenseManagerCard = defenseLayoutState.canEdit;
  const displayDefenseBuildings = defenseBuildings.map((building, index) => ({
    ...building,
    displayName: buildingTypeMap.get(building?.buildingTypeId)?.name || building.name,
    ordinal: index + 1,
    isIntel: defenseLayoutState.canEdit && activeDefenseLayout?.intelBuildingId === building.buildingId
  }));
  const intelHeistRemainingMs = isIntelHeistMode && intelHeistState.deadlineMs > 0
    ? Math.max(0, intelHeistState.deadlineMs - intelHeistClockMs)
    : 0;
  const intelHeistRemainingRatio = isIntelHeistMode && intelHeistState.totalMs > 0
    ? Math.max(0, Math.min(1, intelHeistRemainingMs / intelHeistState.totalMs))
    : 1;
  const intelHeistActiveSearchRatio = isIntelHeistMode && intelHeistState.activeBuildingId && intelHeistState.searchStartedAtMs > 0
    ? Math.max(0, Math.min(1, 1 - ((intelHeistClockMs - intelHeistState.searchStartedAtMs) / INTEL_HEIST_SCAN_MS)))
    : 1;
  const intelHeistRemainingSeconds = Math.max(0, Math.ceil(intelHeistRemainingMs / 1000));
  const intelHeistCountdownText = formatCountdown(intelHeistRemainingSeconds);
  const showGateLayer = !isIntelHeistMode;
  const showRightDock = !isIntelHeistMode;
  const showBottomExitButton = !isIntelHeistMode;

  if (!isVisible && transitionProgress <= 0) return null;

  return (
    <div
      ref={containerRef}
      className={`knowledge-domain-container ${isScenePanning ? 'is-scene-panning' : ''}`}
      style={{
        opacity: displayOpacity,
        pointerEvents: displayOpacity > 0.5 ? 'auto' : 'none'
      }}
      onPointerDown={handleScenePointerDown}
    >
      <canvas ref={canvasRef} className="knowledge-domain-canvas" />
      <KnowledgeDomainCityView
        cityDefenseLayerRef={cityDefenseLayerRef}
        cityGateLayerRef={cityGateLayerRef}
        isIntelHeistMode={isIntelHeistMode}
        intelHeistCountdownText={intelHeistCountdownText}
        intelHeistRemainingRatio={intelHeistRemainingRatio}
        requestExitIntelHeistGame={requestExitIntelHeistGame}
        onExit={onExit}
        defenseLayoutState={defenseLayoutState}
        handleCityBuildDragOver={handleCityBuildDragOver}
        handleCityBuildDrop={handleCityBuildDrop}
        displayDefenseBuildings={displayDefenseBuildings}
        defenseMetrics={defenseMetrics}
        intelHeistState={intelHeistState}
        intelHeistActiveSearchRatio={intelHeistActiveSearchRatio}
        handleDefenseBuildingPointerDown={handleDefenseBuildingPointerDown}
        startIntelHeistSearch={startIntelHeistSearch}
        setDefenseLayoutState={setDefenseLayoutState}
        showBuildingPalette={showBuildingPalette}
        buildingCatalog={buildingCatalog}
        buildingTypeUsageMap={buildingTypeUsageMap}
        draggingBuildingTypeId={draggingBuildingTypeId}
        updateSelectedBuildingType={updateSelectedBuildingType}
        handleBuildingPaletteDragStart={handleBuildingPaletteDragStart}
        handleBuildingPaletteDragEnd={handleBuildingPaletteDragEnd}
        showGateLayer={showGateLayer}
        hasParentEntrance={hasParentEntrance}
        hasChildEntrance={hasChildEntrance}
        canInspectGateDefense={canInspectGateDefense}
        gatePositions={gatePositions}
        openBattlefieldPreview={openBattlefieldPreview}
        gateTotals={gateTotals}
      />


            <KnowledgeDomainRightDock
        dock={{
          showRightDock,
          activeTab,
          showManageTab,
          isDomainInfoDockExpanded,
          setActiveTab,
          setIsDomainInfoDockExpanded,
          refreshDomainInfoPanel,
          fetchDomainAdmins,
          fetchDistributionSettings
        }}
        infoPanel={{
          infoPanelDomainNode,
          isRefreshingInfoPanel,
          infoPanelError,
          infoKnowledgePointValue,
          infoProsperityValue,
          infoContentScoreValue,
          infoFavoriteUserCountValue,
          displayMaster,
          displayAdmins,
          openUserCard
        }}
        defensePanel={{
          showDefenseManagerCard,
          defenseLayoutState,
          defenseBuildings,
          buildingCatalog,
          buildingTypeUsageMap,
          updateSelectedBuildingType,
          toggleBuildMode,
          addDefenseBuilding,
          canAddDefenseBuilding,
          saveDefenseLayout,
          selectedDefenseBuilding,
          buildingTypeMap,
          setIntelOnSelectedBuilding,
          removeSelectedDefenseBuilding
        }}
        adminPanel={{
          domainAdminState,
          manageFeedback,
          activeManageSidePanel,
          toggleManageSidePanel,
          normalizePermissionLabels,
          removeDomainAdmin,
          removingAdminId,
          revokeDomainAdminInvite,
          revokingInviteId,
          openDomainAdminPermissionModal,
          searchKeyword,
          setSearchKeyword,
          setManageFeedback,
          setHasSearchedAdminUsers,
          setSearchResults,
          searchDomainAdminUsers,
          clearDomainAdminSearch,
          isSearchingUsers,
          hasSearchedAdminUsers,
          searchResults,
          inviteDomainAdmin,
          invitingUsername,
          applyResignDomainAdmin,
          isSubmittingResign,
          isDomainAdminPermissionModalOpen,
          closeDomainAdminPermissionModal,
          isSavingDomainAdminPermissions,
          domainAdminPermissionDraftMap,
          toggleDomainAdminPermission,
          saveDomainAdminPermissions,
          domainAdminPermissionDirty
        }}
        distributionPanel={{
          distributionState,
          currentPercentSummary,
          activeDistributionProfile,
          distributionProfiles,
          hasLockedPlan,
          setIsDistributionRuleModalOpen,
          publishDistributionRuleId,
          setDistributionState,
          publishDistributionProfile,
          publishDistributionPlan,
          hasUpcomingPublishedPlan,
          countdownSeconds,
          lockedExecuteMs,
          distributionRule,
          scopePercent,
          unallocatedPercent,
          formatCountdown
        }}
      />

      {showGateLayer && (
      <BattlefieldPreviewModal
        open={battlefieldPreviewState.open}
        nodeId={node?._id || ''}
        gateKey={battlefieldPreviewState.gateKey}
        gateLabel={CITY_GATE_LABELS[battlefieldPreviewState.gateKey] || ''}
        canEdit={canEditGateDefense}
        overlayTopOffsetPx={105}
        onSaved={handleBattlefieldPreviewSaved}
        onClose={closeBattlefieldPreview}
      />
      )}

            <KnowledgeDomainIntelHeistOverlay
        isIntelHeistMode={isIntelHeistMode}
        isIntelHeistExitConfirmOpen={isIntelHeistExitConfirmOpen}
        setIsIntelHeistExitConfirmOpen={setIsIntelHeistExitConfirmOpen}
        cancelExitIntelHeistGame={cancelExitIntelHeistGame}
        exitIntelHeistGame={exitIntelHeistGame}
        intelHeistState={intelHeistState}
        node={node}
      />

            <KnowledgeDomainDistributionRuleModal
        open={showRightDock && isDistributionRuleModalOpen}
        canEdit={distributionState.canEdit}
        distributionState={distributionState}
        distributionToast={distributionToast}
        onClose={() => setIsDistributionRuleModalOpen(false)}
        saveDistributionSettings={saveDistributionSettings}
        distributionProfiles={distributionProfiles}
        activeDistributionRuleId={activeDistributionRuleId}
        setActiveDistributionRule={setActiveDistributionRule}
        newDistributionRuleName={newDistributionRuleName}
        setNewDistributionRuleName={setNewDistributionRuleName}
        createDistributionRuleProfileItem={createDistributionRuleProfileItem}
        removeActiveDistributionRule={removeActiveDistributionRule}
        distributionRule={distributionRule}
        updateDistributionRule={updateDistributionRule}
        scopePercent={scopePercent}
        activeDistributionProfile={activeDistributionProfile}
        updateActiveDistributionRuleName={updateActiveDistributionRuleName}
        hasMasterAlliance={hasMasterAlliance}
        currentPercentSummary={currentPercentSummary}
        effectiveAdminPercents={effectiveAdminPercents}
        distributionUserKeyword={distributionUserKeyword}
        setDistributionUserKeyword={setDistributionUserKeyword}
        distributionUserSearching={distributionUserSearching}
        distributionUserResults={distributionUserResults}
        distributionAllianceKeyword={distributionAllianceKeyword}
        setDistributionAllianceKeyword={setDistributionAllianceKeyword}
        distributionAllianceSearching={distributionAllianceSearching}
        distributionAllianceResults={distributionAllianceResults}
        blockedRuleNotes={blockedRuleNotes}
        conflictMessages={conflictMessages}
        unallocatedPercent={unallocatedPercent}
      />

        {showBottomExitButton && (
          <button className="exit-domain-btn" onClick={onExit}>
            离开知识域
          </button>
        )}
    </div>
  );
};

export default KnowledgeDomainScene;
