import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  CAMERA_ANGLE_PREVIEW,
  CAMERA_TWEEN_MS,
  MIN_ZOOM,
  MAX_ZOOM,
  BASELINE_FIELD_COVERAGE,
  DEFAULT_VIEWPORT_WIDTH,
  DEFAULT_VIEWPORT_HEIGHT,
  clearThreeGroup,
  roundTo,
  lerp,
  clamp01,
  easeOutCubic,
  getGroundProjectionScale,
  unprojectScreen
} from './battlefieldShared';
import { evaluateGhostPlacement } from './battlefieldPlacementUtils';

const useBattlefieldViewState = ({
  open = false,
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
  walls = [],
  itemCatalogById,
  refs,
  setters
}) => {
  const {
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
  } = refs;
  const {
    setIsPanning,
    setIsRotating,
    setGhost,
    setGhostBlocked,
    setSnapState,
    setInvalidReason,
    setSelectedPaletteItem,
    setMessage
  } = setters;

  const syncViewportSize = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect?.width || DEFAULT_VIEWPORT_WIDTH));
    const height = Math.max(1, Math.floor(rect?.height || DEFAULT_VIEWPORT_HEIGHT));
    setViewportSize((prev) => (
      prev.width === width && prev.height === height
        ? prev
        : { width, height }
    ));
  }, [setViewportSize, wrapperRef]);

  useLayoutEffect(() => {
    if (!open) return;
    syncViewportSize();
  }, [open, syncViewportSize]);

  useEffect(() => {
    if (!open) return undefined;
    let resizeObserver = null;
    const rafId = requestAnimationFrame(syncViewportSize);
    const wrapper = wrapperRef.current;
    if (typeof ResizeObserver !== 'undefined' && wrapper) {
      resizeObserver = new ResizeObserver(() => {
        syncViewportSize();
      });
      resizeObserver.observe(wrapper);
    }
    window.addEventListener('resize', syncViewportSize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncViewportSize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [open, syncViewportSize, wrapperRef]);

  const viewport = useMemo(() => {
    const width = viewportSize.width;
    const height = viewportSize.height;
    return {
      width,
      height,
      centerX: width / 2,
      centerY: height / 2,
      panX: 0,
      panY: 0
    };
  }, [viewportSize.height, viewportSize.width]);

  const worldScale = useMemo(() => {
    const widthBase = (viewport.width * BASELINE_FIELD_COVERAGE) / fieldWidth;
    const heightBase = (viewport.height * BASELINE_FIELD_COVERAGE) / (fieldHeight * getGroundProjectionScale(cameraAngle));
    const baseScale = Math.max(0.01, Math.min(widthBase, heightBase));
    return baseScale * zoom;
  }, [cameraAngle, fieldHeight, fieldWidth, viewport.height, viewport.width, zoom]);

  const getWorldFromScreenPoint = useCallback((sx, sy) => {
    const three = threeRef.current;
    const camera = three?.camera;
    if (camera && viewport.width > 0 && viewport.height > 0) {
      if (!raycasterRef.current) {
        raycasterRef.current = new THREE.Raycaster();
      }
      const ndc = new THREE.Vector2(
        ((sx / viewport.width) * 2) - 1,
        1 - ((sy / viewport.height) * 2)
      );
      raycasterRef.current.setFromCamera(ndc, camera);
      const target = new THREE.Vector3();
      if (raycasterRef.current.ray.intersectPlane(raycastPlaneRef.current, target)) {
        return { x: target.x, y: target.y };
      }
    }
    return unprojectScreen(sx, sy, viewport, cameraAngle, cameraYaw, worldScale);
  }, [cameraAngle, cameraYaw, raycastPlaneRef, raycasterRef, threeRef, viewport, worldScale]);

  const pickWallMeshHitFromScreenPoint = useCallback((sx, sy) => {
    const three = threeRef.current;
    const camera = three?.camera;
    const pickableWallMeshes = Array.isArray(three?.pickableWallMeshes) ? three.pickableWallMeshes : [];
    if (!camera || pickableWallMeshes.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }
    if (!raycasterRef.current) {
      raycasterRef.current = new THREE.Raycaster();
    }
    const ndc = new THREE.Vector2(
      ((sx / viewport.width) * 2) - 1,
      1 - ((sy / viewport.height) * 2)
    );
    raycasterRef.current.setFromCamera(ndc, camera);
    const hits = raycasterRef.current.intersectObjects(pickableWallMeshes, false);
    if (!hits || hits.length === 0) return null;
    const hit = hits[0];
    const wallId = hit?.object?.userData?.wallId;
    if (!wallId) return null;
    const wall = walls.find((item) => item.id === wallId) || null;
    if (!wall) return null;
    const data = hit?.object?.userData && typeof hit.object.userData === 'object' ? hit.object.userData : {};
    const localNormal = hit?.face?.normal || null;
    const normalZ = Number(localNormal?.z) || 0;
    const faceType = normalZ > 0.8 ? 'top' : (normalZ < -0.8 ? 'bottom' : 'side');
    return {
      wall,
      wallId,
      point: {
        x: Number(hit?.point?.x) || 0,
        y: Number(hit?.point?.y) || 0,
        z: Number(hit?.point?.z) || 0
      },
      faceType,
      partIndex: Number.isFinite(Number(data?.partIndex)) ? Math.floor(Number(data.partIndex)) : null,
      partMinZ: Number.isFinite(Number(data?.partMinZ)) ? Number(data.partMinZ) : null,
      partMaxZ: Number.isFinite(Number(data?.partMaxZ)) ? Number(data.partMaxZ) : null,
      partCenterZ: Number.isFinite(Number(data?.partCenterZ)) ? Number(data.partCenterZ) : null
    };
  }, [raycasterRef, threeRef, viewport.height, viewport.width, walls]);

  const pickWallFromScreenPoint = useCallback((sx, sy) => {
    const hit = pickWallMeshHitFromScreenPoint(sx, sy);
    return hit?.wall || null;
  }, [pickWallMeshHitFromScreenPoint]);

  useEffect(() => {
    cameraAngleRef.current = cameraAngle;
  }, [cameraAngle, cameraAngleRef]);

  useEffect(() => {
    cameraYawRef.current = cameraYaw;
  }, [cameraYaw, cameraYawRef]);

  useEffect(() => {
    panWorldRef.current = {
      x: Number(panWorld.x) || 0,
      y: Number(panWorld.y) || 0
    };
  }, [panWorld.x, panWorld.y, panWorldRef]);

  useEffect(() => {
    if (!open || !sceneCanvasRef.current) return undefined;
    const canvas = sceneCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));
    renderer.setSize(
      Math.max(1, Math.floor(canvas.clientWidth || 1)),
      Math.max(1, Math.floor(canvas.clientHeight || 1)),
      false
    );

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
    camera.up.set(0, 0, 1);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xe2e8f0, 0.74);
    directionalLight.position.set(-420, -520, 860);
    scene.add(directionalLight);

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    threeRef.current = {
      renderer,
      scene,
      camera,
      worldGroup
    };

    return () => {
      clearThreeGroup(worldGroup);
      renderer.dispose();
      threeRef.current = null;
    };
  }, [open, sceneCanvasRef, threeRef]);

  useEffect(() => () => {
    if (cameraAnimRef.current) cancelAnimationFrame(cameraAnimRef.current);
    if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current);
    if (threeRef.current) {
      clearThreeGroup(threeRef.current.worldGroup);
      threeRef.current.renderer?.dispose?.();
      threeRef.current = null;
    }
    panDragRef.current = null;
    rotateDragRef.current = null;
  }, [cameraAnimRef, panDragRef, rotateDragRef, threeRef, zoomAnimRef]);

  const clearPanDragging = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
  }, [panDragRef, setIsPanning]);

  const clearRotateDragging = useCallback(() => {
    rotateDragRef.current = null;
    setIsRotating(false);
  }, [rotateDragRef, setIsRotating]);

  const animateCameraAngle = useCallback((targetAngle, durationMs = CAMERA_TWEEN_MS) => {
    const start = cameraAngleRef.current;
    const target = Number(targetAngle) || CAMERA_ANGLE_PREVIEW;
    if (Math.abs(start - target) < 0.001) {
      setCameraAngle(target);
      cameraAngleRef.current = target;
      return;
    }
    if (cameraAnimRef.current) cancelAnimationFrame(cameraAnimRef.current);
    const startedAt = performance.now();
    const tick = (now) => {
      const t = clamp01((now - startedAt) / Math.max(1, durationMs));
      const eased = easeOutCubic(t);
      const next = lerp(start, target, eased);
      cameraAngleRef.current = next;
      setCameraAngle(next);
      if (t < 1) {
        cameraAnimRef.current = requestAnimationFrame(tick);
      } else {
        cameraAnimRef.current = null;
      }
    };
    cameraAnimRef.current = requestAnimationFrame(tick);
  }, [cameraAngleRef, cameraAnimRef, setCameraAngle]);

  const animateZoomTo = useCallback((targetZoom) => {
    zoomTargetRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, roundTo(targetZoom, 3)));
    if (zoomAnimRef.current) return;
    const tick = () => {
      setZoom((prev) => {
        const target = zoomTargetRef.current;
        const next = prev + ((target - prev) * 0.24);
        if (Math.abs(target - next) < 0.001) {
          zoomAnimRef.current = null;
          return target;
        }
        zoomAnimRef.current = requestAnimationFrame(tick);
        return roundTo(next, 4);
      });
    };
    zoomAnimRef.current = requestAnimationFrame(tick);
  }, [setZoom, zoomAnimRef, zoomTargetRef]);

  const resolveMouseSnapHint = useCallback((sx, sy) => {
    const meshHit = pickWallMeshHitFromScreenPoint(sx, sy);
    if (!meshHit?.wall) {
      mouseSnapHintRef.current = null;
      return null;
    }
    const hint = {
      anchorId: meshHit.wall.id,
      partIndex: Number.isFinite(Number(meshHit.partIndex)) ? Number(meshHit.partIndex) : null,
      hitX: Number(meshHit?.point?.x) || 0,
      hitY: Number(meshHit?.point?.y) || 0,
      hitZ: Number(meshHit?.point?.z) || 0,
      partCenterZ: Number.isFinite(Number(meshHit?.partCenterZ)) ? Number(meshHit.partCenterZ) : null,
      faceType: typeof meshHit?.faceType === 'string' ? meshHit.faceType : ''
    };
    mouseSnapHintRef.current = hint;
    return hint;
  }, [mouseSnapHintRef, pickWallMeshHitFromScreenPoint]);

  const syncGhostByMouse = useCallback((sourceGhost = ghost) => {
    if (!sourceGhost) return null;
    const candidate = {
      ...sourceGhost,
      x: mouseWorldRef.current.x,
      y: mouseWorldRef.current.y,
      z: 0
    };
    const evaluated = evaluateGhostPlacement(
      candidate,
      walls,
      mouseWorldRef.current,
      fieldWidth,
      fieldHeight,
      itemCatalogById,
      mouseSnapHintRef.current
    );
    setGhost(evaluated.ghost);
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    return evaluated;
  }, [
    fieldHeight,
    fieldWidth,
    ghost,
    itemCatalogById,
    mouseSnapHintRef,
    mouseWorldRef,
    setGhost,
    setGhostBlocked,
    setInvalidReason,
    setSnapState,
    walls
  ]);

  const cancelGhostPlacement = useCallback((tip = '已取消放置') => {
    setGhost(null);
    setGhostBlocked(false);
    setSnapState(null);
    setInvalidReason('');
    mouseSnapHintRef.current = null;
    setSelectedPaletteItem('');
    if (tip) setMessage(tip);
  }, [
    mouseSnapHintRef,
    setGhost,
    setGhostBlocked,
    setInvalidReason,
    setMessage,
    setSelectedPaletteItem,
    setSnapState
  ]);

  return {
    viewport,
    worldScale,
    getWorldFromScreenPoint,
    pickWallMeshHitFromScreenPoint,
    pickWallFromScreenPoint,
    clearPanDragging,
    clearRotateDragging,
    animateCameraAngle,
    animateZoomTo,
    resolveMouseSnapHint,
    syncGhostByMouse,
    cancelGhostPlacement
  };
};

export default useBattlefieldViewState;
