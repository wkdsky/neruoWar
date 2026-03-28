import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import NumberPadDialog from '../common/NumberPadDialog';
import BattlefieldHeader from './battlefieldPreview/BattlefieldHeader';
import BattlefieldToolbar from './battlefieldPreview/BattlefieldToolbar';
import DefenderEditorPanel from './battlefieldPreview/DefenderEditorPanel';
import BattlefieldSidebar from './battlefieldPreview/BattlefieldSidebar';
import ItemDetailModal from './battlefieldPreview/ItemDetailModal';
import useBattlefieldLayoutData from './battlefieldPreview/useBattlefieldLayoutData';
import useBattlefieldScene from './battlefieldPreview/useBattlefieldScene';
import useBattlefieldOverlay from './battlefieldPreview/useBattlefieldOverlay';
import useBattlefieldComputedData from './battlefieldPreview/useBattlefieldComputedData';
import useBattlefieldViewState from './battlefieldPreview/useBattlefieldViewState';
import useBattlefieldEditing from './battlefieldPreview/useBattlefieldEditing';
import useDefenderDeployment from './battlefieldPreview/useDefenderDeployment';
import useBattlefieldInteractions from './battlefieldPreview/useBattlefieldInteractions';
import {
  CAMERA_ANGLE_PREVIEW,
  CAMERA_YAW_DEFAULT,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  MAX_STACK_LEVEL,
  DEFAULT_ZOOM,
  DEFAULT_VIEWPORT_WIDTH,
  DEFAULT_VIEWPORT_HEIGHT,
  DEPLOY_ZONE_RATIO,
  DEFAULT_MAX_ITEMS_PER_TYPE,
  readBattlefieldCache,
  writeBattlefieldCache,
  sanitizeWalls,
  sanitizeWallsWithLegacyCleanup,
  sanitizeDefenderDeployments,
  normalizeDefenderDeploymentsToRightZone,
  normalizeItemCatalog,
  mapLayoutBundleToWalls,
  mapLayoutBundleToDefenderDeployments,
  buildLayoutPayload
} from './battlefieldPreview/battlefieldShared';
import { getPlacementReasonText } from './battlefieldPreview/battlefieldPlacementUtils';
import { recomputeMergedWallAttributes } from './battlefieldPreview/battlefieldConnectivityUtils';
import './BattlefieldPreviewModal.css';

const BattlefieldPreviewModal = ({
  open = false,
  nodeId = '',
  gateKey = 'cheng',
  gateLabel = '',
  canEdit = false,
  overlayTopOffsetPx = null,
  layoutBundleOverride = null,
  onSaved = null,
  onClose
}) => {
  const sceneCanvasRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const threeRef = useRef(null);
  const raycasterRef = useRef(null);
  const raycastPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const panDragRef = useRef(null);
  const rotateDragRef = useRef(null);
  const wallActionButtonsRef = useRef([]);
  const defenderActionButtonsRef = useRef([]);
  const mouseWorldRef = useRef({ x: 0, y: 0 });
  const mouseScreenRef = useRef({ x: 0, y: 0, valid: false });
  const mouseSnapHintRef = useRef(null);
  const panWorldRef = useRef({ x: 0, y: 0 });
  const editSessionWallsRef = useRef(null);
  const editSessionDefenderDeploymentsRef = useRef(null);
  const cameraAnimRef = useRef(null);
  const cameraAngleRef = useRef(CAMERA_ANGLE_PREVIEW);
  const cameraYawRef = useRef(CAMERA_YAW_DEFAULT);
  const zoomAnimRef = useRef(null);
  const zoomTargetRef = useRef(DEFAULT_ZOOM);
  const spacePressedRef = useRef(false);
  const defenderFormationStateRef = useRef(new Map());
  const resetDefenderUiRef = useRef(() => {});
  const [editMode, setEditMode] = useState(false);
  const [cameraAngle, setCameraAngle] = useState(CAMERA_ANGLE_PREVIEW);
  const [cameraYaw, setCameraYaw] = useState(CAMERA_YAW_DEFAULT);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [panWorld, setPanWorld] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT
  });
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [ghost, setGhost] = useState(null);
  const [ghostBlocked, setGhostBlocked] = useState(false);
  const [snapState, setSnapState] = useState(null);
  const [invalidReason, setInvalidReason] = useState('');
  const [selectedPaletteItem, setSelectedPaletteItem] = useState('');
  const [sidebarTab, setSidebarTab] = useState('items');
  const [itemDetailModalItemId, setItemDetailModalItemId] = useState('');
  const [selectedWallId, setSelectedWallId] = useState('');
  const defaultLayoutMeta = useMemo(() => ({
    layoutId: `${gateKey || 'cheng'}_default`,
    name: '',
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    maxItemsPerType: DEFAULT_MAX_ITEMS_PER_TYPE
  }), [gateKey]);

  const resetTransientLayoutState = useCallback(() => {
    editSessionWallsRef.current = null;
    editSessionDefenderDeploymentsRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    if (cameraAnimRef.current) cancelAnimationFrame(cameraAnimRef.current);
    if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current);
    cameraAnimRef.current = null;
    zoomAnimRef.current = null;
    cameraAngleRef.current = CAMERA_ANGLE_PREVIEW;
    setCameraAngle(CAMERA_ANGLE_PREVIEW);
    cameraYawRef.current = CAMERA_YAW_DEFAULT;
    setCameraYaw(CAMERA_YAW_DEFAULT);
    zoomTargetRef.current = DEFAULT_ZOOM;
    setZoom(DEFAULT_ZOOM);
    panWorldRef.current = { x: 0, y: 0 };
    setPanWorld({ x: 0, y: 0 });
    setIsPanning(false);
    setIsRotating(false);
    rotateDragRef.current = null;
    panDragRef.current = null;
    setGhost(null);
    setGhostBlocked(false);
    setSnapState(null);
    setInvalidReason('');
    defenderFormationStateRef.current = new Map();
    setSidebarTab('items');
    resetDefenderUiRef.current();
    setItemDetailModalItemId('');
    setSelectedPaletteItem('');
    setSelectedWallId('');
  }, []);

  const {
    walls,
    setWallsWithRecompute,
    loadingLayout,
    savingLayout,
    cacheNeedsSync,
    serverCanEdit,
    errorText,
    message,
    setMessage,
    normalizedItemCatalog,
    defenderRoster,
    defenderDeployments,
    setDefenderDeployments,
    activeLayoutMeta,
    persistBattlefieldLayout
  } = useBattlefieldLayoutData({
    open,
    nodeId,
    gateKey,
    canEdit,
    layoutBundleOverride,
    onSaved,
    defaultLayoutMeta,
    editMode,
    resetTransientState: resetTransientLayoutState,
    fieldWidthDefault: FIELD_WIDTH,
    fieldHeightDefault: FIELD_HEIGHT,
    defaultMaxItemsPerType: DEFAULT_MAX_ITEMS_PER_TYPE,
    normalizeItemCatalog,
    sanitizeWalls,
    sanitizeWallsWithLegacyCleanup,
    sanitizeDefenderDeployments,
    normalizeDefenderDeploymentsToRightZone,
    mapLayoutBundleToWalls,
    mapLayoutBundleToDefenderDeployments,
    buildLayoutPayload,
    recomputeMergedWallAttributes,
    readBattlefieldCache,
    writeBattlefieldCache
  });

  const effectiveCanEdit = !!canEdit && !!serverCanEdit;

  const {
    fieldWidth,
    fieldHeight,
    wallGroups,
    itemStockMetaMap,
    itemCatalogById,
    itemDetailModalItem,
    itemDetailModalStock,
    itemDetailInteractionLabels,
    itemDetailSocketCount,
    itemDetailColliderPartCount,
    totalItemLimit,
    totalItemRemaining,
    defenderRosterMap,
    deployedDefenderCountMap,
    defenderStockRows,
    defenderUnitTypesForFormation,
    totalDefenderPlaced,
    defenderZoneMinX,
    defenderDeploymentRows
  } = useBattlefieldComputedData({
    activeLayoutMeta,
    fieldWidthDefault: FIELD_WIDTH,
    fieldHeightDefault: FIELD_HEIGHT,
    normalizedItemCatalog,
    walls,
    itemDetailModalItemId,
    defenderRoster,
    defenderDeployments,
    deployZoneRatio: DEPLOY_ZONE_RATIO
  });
  const {
    viewport,
    worldScale,
    getWorldFromScreenPoint,
    pickWallFromScreenPoint,
    clearPanDragging,
    clearRotateDragging,
    animateCameraAngle,
    animateZoomTo,
    resolveMouseSnapHint,
    syncGhostByMouse,
    cancelGhostPlacement
  } = useBattlefieldViewState({
    open,
    viewportSize,
    setViewportSize,
    cameraAngle,
    setCameraAngle,
    cameraYaw,
    setCameraYaw,
    zoom,
    setZoom,
    panWorld,
    fieldWidth,
    fieldHeight,
    ghost,
    walls,
    itemCatalogById,
    refs: {
      wrapperRef,
      sceneCanvasRef,
      threeRef,
      raycasterRef,
      raycastPlaneRef,
      panDragRef,
      rotateDragRef,
      mouseWorldRef,
      mouseSnapHintRef,
      panWorldRef,
      cameraAnimRef,
      cameraAngleRef,
      cameraYawRef,
      zoomAnimRef,
      zoomTargetRef
    },
    setters: {
      setIsPanning,
      setIsRotating,
      setGhost,
      setGhostBlocked,
      setSnapState,
      setInvalidReason,
      setSelectedPaletteItem,
      setMessage
    }
  });
  const {
    selectedDeploymentId,
    setSelectedDeploymentId,
    activeDefenderMoveId,
    setActiveDefenderMoveId,
    defenderDragPreview,
    setDefenderDragPreview,
    defenderEditorOpen,
    setDefenderEditorOpen,
    defenderEditingDeployId,
    defenderEditorDraft,
    setDefenderEditorDraft,
    defenderEditorAvailableRows,
    defenderEditorTotalCount,
    defenderEditorUnits,
    defenderQuantityDialog,
    setDefenderQuantityDialog,
    selectedDefenderDeployment,
    resolveDefenderDeploymentRadius,
    findDeploymentAtWorld,
    moveDefenderDeployment,
    resolveDefenderMovePreview,
    openDefenderEditor,
    startEditDefenderDeployment,
    closeDefenderEditor,
    openDefenderQuantityDialog,
    removeDraftUnit,
    confirmDefenderQuantityDialog,
    saveDefenderEditor,
    removeDefenderDeployment,
    unplaceDefenderDeployment,
    handleSelectDeploymentFromSidebar
  } = useDefenderDeployment({
    defenderDeployments,
    setDefenderDeployments,
    defenderRosterMap,
    deployedDefenderCountMap,
    defenderDeploymentRows,
    defenderStockRows,
    defenderUnitTypesForFormation,
    defenderFormationStateRef,
    fieldWidth,
    fieldHeight,
    defenderZoneMinX,
    effectiveCanEdit,
    editMode,
    walls,
    persistBattlefieldLayout,
    cancelGhostPlacement,
    setHasDraftChanges,
    setMessage,
    setSelectedWallId,
    setSidebarTab,
    mouseWorldRef
  });

  resetDefenderUiRef.current = () => {
    setSelectedDeploymentId('');
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    setDefenderEditorDraft({
      name: '',
      sortOrder: 1,
      units: []
    });
    setDefenderEditorOpen(false);
    setDefenderQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 0
    });
  };
  const {
    pickPaletteItem,
    startMoveWall,
    recycleWallToPalette,
    startLayoutEditing,
    cancelLayoutEditing,
    saveLayoutEditing
  } = useBattlefieldEditing({
    selectedWallId,
    editMode,
    effectiveCanEdit,
    hasDraftChanges,
    walls,
    defenderDeployments,
    normalizedItemCatalog,
    itemStockMetaMap,
    itemCatalogById,
    fieldWidth,
    fieldHeight,
    refs: {
      mouseWorldRef,
      mouseSnapHintRef,
      editSessionWallsRef,
      editSessionDefenderDeploymentsRef,
      resetDefenderUiRef
    },
    setters: {
      setMessage,
      setSelectedDeploymentId,
      setSelectedWallId,
      setSidebarTab,
      setSelectedPaletteItem,
      setGhost,
      setGhostBlocked,
      setSnapState,
      setInvalidReason,
      setHasDraftChanges,
      setEditMode,
      setDefenderDeployments,
      setWallsWithRecompute
    },
    callbacks: {
      cancelGhostPlacement,
      animateCameraAngle,
      persistBattlefieldLayout
    }
  });

  useEffect(() => {
    if (!itemDetailModalItemId) return;
    if (!itemCatalogById.has(itemDetailModalItemId)) {
      setItemDetailModalItemId('');
    }
  }, [itemCatalogById, itemDetailModalItemId]);

  useBattlefieldScene({
    open,
    threeRef,
    viewport,
    fieldWidth,
    fieldHeight,
    walls,
    ghost,
    ghostBlocked,
    snapState,
    cameraAngle,
    cameraYaw,
    zoom,
    worldScale,
    editMode,
    effectiveCanEdit,
    itemCatalogById,
    defenderUnitTypesForFormation,
    selectedWallId,
    defenderDeployments,
    selectedDeploymentId,
    defenderDragPreview,
    panWorld,
    resolveDefenderDeploymentRadius,
    defenderFormationStateRef
  });

  const { findWallActionButton, findDefenderActionButton } = useBattlefieldOverlay({
    open,
    canvasRef,
    threeRef,
    wallActionButtonsRef,
    defenderActionButtonsRef,
    viewport,
    cameraAngle,
    cameraYaw,
    worldScale,
    walls,
    defenderDeployments,
    selectedDeploymentId,
    ghost,
    snapState,
    wallGroups,
    invalidReason,
    editMode,
    effectiveCanEdit,
    selectedWallId,
    itemCatalogById
  });

  const {
    handleMouseDown,
    handleMouseMove,
    handleCanvasDoubleClick,
    handleCanvasDragOver,
    handleCanvasDragLeave,
    handleCanvasDrop,
    handleWheel
  } = useBattlefieldInteractions({
    open,
    editMode,
    effectiveCanEdit,
    sidebarTab,
    ghost,
    ghostBlocked,
    snapState,
    invalidReason,
    activeDefenderMoveId,
    selectedDeploymentId,
    selectedWallId,
    itemDetailModalItemId,
    walls,
    defenderDeployments,
    fieldWidth,
    fieldHeight,
    defenderZoneMinX,
    cameraAngle,
    cameraYaw,
    worldScale,
    zoom,
    viewport,
    itemCatalogById,
    itemStockMetaMap,
    refs: {
      canvasRef,
      threeRef,
      mouseScreenRef,
      mouseWorldRef,
      mouseSnapHintRef,
      panDragRef,
      panWorldRef,
      rotateDragRef,
      spacePressedRef,
      cameraYawRef,
      zoomTargetRef
    },
    setters: {
      setMessage,
      setItemDetailModalItemId,
      setActiveDefenderMoveId,
      setDefenderDragPreview,
      setSelectedDeploymentId,
      setSelectedWallId,
      setSidebarTab,
      setHasDraftChanges,
      setPanWorld,
      setCameraYaw,
      setGhost,
      setGhostBlocked,
      setSnapState,
      setInvalidReason,
      setDefenderDeployments,
      setWallsWithRecompute,
      setIsPanning,
      setIsRotating
    },
    callbacks: {
      cancelGhostPlacement,
      resolveMouseSnapHint,
      getWorldFromScreenPoint,
      moveDefenderDeployment,
      resolveDefenderMovePreview,
      findDeploymentAtWorld,
      unplaceDefenderDeployment,
      startMoveWall,
      recycleWallToPalette,
      startLayoutEditing,
      animateZoomTo,
      clearPanDragging,
      clearRotateDragging,
      syncGhostByMouse,
      findWallActionButton,
      findDefenderActionButton,
      pickWallFromScreenPoint
    }
  });

  if (!open) return null;

  const overlayStyle = Number.isFinite(Number(overlayTopOffsetPx))
    ? {
        '--battlefield-modal-top': `${Math.max(16, Math.floor(Number(overlayTopOffsetPx)))}px`,
        '--battlefield-modal-top-mobile': `${Math.max(12, Math.floor(Number(overlayTopOffsetPx) - 6))}px`
      }
    : null;

  return (
    <div
      className="battlefield-modal-overlay"
      style={overlayStyle}
      onClick={onClose}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onPointerMoveCapture={(event) => event.stopPropagation()}
      onPointerUpCapture={(event) => event.stopPropagation()}
    >
      <div
        className="battlefield-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDownCapture={(event) => event.stopPropagation()}
      >
        <BattlefieldHeader
          gateLabel={gateLabel}
          loadingLayout={loadingLayout}
          effectiveCanEdit={effectiveCanEdit}
          editMode={editMode}
          savingLayout={savingLayout}
          onStartLayoutEditing={startLayoutEditing}
          onCancelLayoutEditing={cancelLayoutEditing}
          onSaveLayoutEditing={saveLayoutEditing}
          onClose={onClose}
        />

        <BattlefieldToolbar
          wallsCount={walls.length}
          totalItemRemaining={totalItemRemaining}
          totalItemLimit={totalItemLimit}
          totalDefenderPlaced={totalDefenderPlaced}
          maxStackLevel={MAX_STACK_LEVEL}
          editMode={editMode}
          hasDraftChanges={hasDraftChanges}
          cacheNeedsSync={cacheNeedsSync}
          savingLayout={savingLayout}
        />

        <div className="battlefield-main">
          {defenderEditorOpen && (
            <DefenderEditorPanel
              defenderEditingDeployId={defenderEditingDeployId}
              effectiveCanEdit={effectiveCanEdit}
              defenderEditorTotalCount={defenderEditorTotalCount}
              defenderEditorDraft={defenderEditorDraft}
              defenderEditorAvailableRows={defenderEditorAvailableRows}
              defenderEditorUnits={defenderEditorUnits}
              defenderRosterMap={defenderRosterMap}
              onClose={closeDefenderEditor}
              onSave={saveDefenderEditor}
              onDraftChange={setDefenderEditorDraft}
              onOpenQuantityDialog={openDefenderQuantityDialog}
              onRemoveDraftUnit={removeDraftUnit}
            />
          )}

          <BattlefieldSidebar
            sidebarTab={sidebarTab}
            normalizedItemCatalog={normalizedItemCatalog}
            itemStockMetaMap={itemStockMetaMap}
            effectiveCanEdit={effectiveCanEdit}
            editMode={editMode}
            selectedPaletteItem={selectedPaletteItem}
            ghostActive={!!ghost}
            defenderStockRows={defenderStockRows}
            defenderDeploymentRows={defenderDeploymentRows}
            selectedDeploymentId={selectedDeploymentId}
            selectedDefenderDeployment={selectedDefenderDeployment}
            onChangeTab={setSidebarTab}
            onPickItem={pickPaletteItem}
            onOpenItemDetail={setItemDetailModalItemId}
            onOpenDefenderEditor={openDefenderEditor}
            onSelectDeployment={handleSelectDeploymentFromSidebar}
            onEditDeployment={startEditDefenderDeployment}
            onRemoveDeployment={removeDefenderDeployment}
          />

          <div className="battlefield-canvas-wrap" ref={wrapperRef}>
            <canvas
              ref={sceneCanvasRef}
              className="battlefield-scene-canvas"
            />
            <canvas
              ref={canvasRef}
              className={`battlefield-canvas battlefield-overlay-canvas ${isPanning ? 'is-panning' : ''} ${isRotating ? 'is-rotating' : ''}`}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              onDrop={handleCanvasDrop}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onDoubleClick={handleCanvasDoubleClick}
              onMouseUp={clearPanDragging}
              onMouseLeave={clearPanDragging}
              onWheel={handleWheel}
            />
          </div>
        </div>

        <div className="battlefield-footer">
          <span>{errorText || message || getPlacementReasonText(invalidReason) || '提示: 右键按住并拖动可旋转战场；右键点击可取消放置；Space+左键或中键平移；滚轮缩放/旋转'}</span>
        </div>
        <ItemDetailModal
          item={itemDetailModalItem}
          stock={itemDetailModalStock}
          colliderPartCount={itemDetailColliderPartCount}
          socketCount={itemDetailSocketCount}
          interactionLabels={itemDetailInteractionLabels}
          onClose={() => setItemDetailModalItemId('')}
        />
        <NumberPadDialog
          open={defenderQuantityDialog.open}
          title={`设置兵力：${defenderQuantityDialog.unitName || defenderQuantityDialog.unitTypeId}`}
          description="可滑动或直接输入数量"
          min={1}
          max={Math.max(1, Math.floor(Number(defenderQuantityDialog.max) || 1))}
          initialValue={Math.max(1, Math.floor(Number(defenderQuantityDialog.current) || 1))}
          confirmLabel="确定"
          cancelLabel="取消"
          onCancel={() => setDefenderQuantityDialog((prev) => ({ ...prev, open: false }))}
          onConfirm={confirmDefenderQuantityDialog}
        />
      </div>
    </div>
  );
};

export default BattlefieldPreviewModal;
