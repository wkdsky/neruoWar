import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBattleGlContext,
  resizeCanvasToDisplaySize
} from '../presentation/render/WebGL2Context';
import ImpostorRenderer from '../presentation/render/ImpostorRenderer';
import BuildingRenderer from '../presentation/render/BuildingRenderer';
import ProjectileRenderer from '../presentation/render/ProjectileRenderer';
import EffectRenderer from '../presentation/render/EffectRenderer';
import GroundRenderer from '../presentation/render/GroundRenderer';
import createBattleProceduralTextures from '../presentation/assets/ProceduralTextures';
import BattleSnapshotSchema from '../presentation/snapshot/BattleSnapshotSchema';
import { UNIT_INSTANCE_STRIDE } from '../presentation/render/ImpostorRenderer';
import { BUILDING_INSTANCE_STRIDE } from '../presentation/render/BuildingRenderer';
import { PROJECTILE_INSTANCE_STRIDE } from '../presentation/render/ProjectileRenderer';
import { EFFECT_INSTANCE_STRIDE } from '../presentation/render/EffectRenderer';

const createNoopImpostorRenderer = () => ({
  updateFromSnapshot() {},
  render() {},
  dispose() {}
});

const assertSnapshotSchemaOnce = () => {
  if (process.env.NODE_ENV === 'production') return;
  const checks = [
    ['units', BattleSnapshotSchema.units.stride, UNIT_INSTANCE_STRIDE],
    ['buildings', BattleSnapshotSchema.buildings.stride, BUILDING_INSTANCE_STRIDE],
    ['projectiles', BattleSnapshotSchema.projectiles.stride, PROJECTILE_INSTANCE_STRIDE],
    ['effects', BattleSnapshotSchema.effects.stride, EFFECT_INSTANCE_STRIDE]
  ];
  checks.forEach(([key, schemaStride, rendererStride]) => {
    if (schemaStride !== rendererStride) {
      console.error(`[BattleSnapshotSchema] stride mismatch for ${key}: schema=${schemaStride}, renderer=${rendererStride}. Please update renderer to match schema.`);
    }
  });
};

export default function useBattleRenderPipeline({
  canvasRef,
  enabled = false,
  loading = false,
  error = '',
  battleInitData = null
} = {}) {
  const pipelineRef = useRef({
    gl: null,
    renderers: null,
    proceduralTex: null,
    devOrientationChecked: false,
    prepareFrame: () => ({ width: 0, height: 0 }),
    render: () => {},
    dispose: () => {}
  });
  const [isReady, setIsReady] = useState(false);
  const [glError, setGlError] = useState('');

  const dispose = useCallback(() => {
    const current = pipelineRef.current;
    const renderers = current?.renderers;
    if (renderers?.ground) renderers.ground.dispose();
    if (renderers?.impostor) renderers.impostor.dispose();
    if (renderers?.building) renderers.building.dispose();
    if (renderers?.projectile) renderers.projectile.dispose();
    if (renderers?.effect) renderers.effect.dispose();
    if (current?.proceduralTex?.dispose) current.proceduralTex.dispose();
    pipelineRef.current = {
      gl: null,
      renderers: null,
      proceduralTex: null,
      devOrientationChecked: false,
      prepareFrame: () => ({ width: 0, height: 0 }),
      render: () => {},
      dispose: () => {}
    };
    setIsReady(false);
  }, []);

  useEffect(() => {
    if (!enabled || !canvasRef?.current || loading || error || !battleInitData) {
      dispose();
      return undefined;
    }
    try {
      const gl = createBattleGlContext(canvasRef.current);
      if (!gl) {
        setGlError('当前环境不支持 WebGL2，无法进入新版战斗场景');
        dispose();
        return undefined;
      }
      assertSnapshotSchemaOnce();
      const renderers = {
        ground: new GroundRenderer(gl),
        building: new BuildingRenderer(gl),
        projectile: new ProjectileRenderer(gl),
        effect: new EffectRenderer(gl),
        impostor: null
      };
      const proceduralTex = createBattleProceduralTextures(gl);
      if (proceduralTex) {
        renderers.projectile.setTextureArray?.(proceduralTex.projectileTexArray);
        renderers.effect.setTextureArray?.(proceduralTex.effectTexArray);
      }
      try {
        renderers.impostor = new ImpostorRenderer(gl, { maxSlices: 64, textureSize: 64 });
        renderers.impostor.setTextureArray?.(
          proceduralTex?.unitTexArray,
          proceduralTex?.unitTexLayerCount || 64
        );
      } catch (impostorError) {
        console.error('ImpostorRenderer 初始化失败，降级为空渲染器:', impostorError);
        renderers.impostor = createNoopImpostorRenderer();
      }
      pipelineRef.current = {
        gl,
        renderers,
        proceduralTex,
        devOrientationChecked: false,
        prepareFrame: () => {
          const canvas = canvasRef.current;
          if (!canvas) return { width: 0, height: 0 };
          resizeCanvasToDisplaySize(canvas, gl);
          return { width: canvas.width, height: canvas.height };
        },
        render: ({ cameraState, snapshot, runtime }) => {
          if (!cameraState || !snapshot) return;
          const field = runtime?.getField?.();
          renderers.ground.setFieldSize(field?.width || 2700, field?.height || 1488);
          renderers.ground.setDeployRange(runtime?.getDeployRange?.());
          let orientationCheckBuildings = null;
          if (
            process.env.NODE_ENV !== 'production'
            && renderers.building?.devOrientationChecked !== true
            && runtime
          ) {
            const devMinimapSnapshot = runtime.getMinimapSnapshot?.();
            if (Array.isArray(devMinimapSnapshot?.buildings) && devMinimapSnapshot.buildings.length > 0) {
              orientationCheckBuildings = devMinimapSnapshot.buildings;
            }
          }
          renderers.building.updateFromSnapshot(snapshot.buildings, orientationCheckBuildings);
          renderers.impostor.updateFromSnapshot(snapshot.units);
          renderers.projectile.updateFromSnapshot(snapshot.projectiles);
          renderers.effect.updateFromSnapshot(snapshot.effects);

          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          renderers.ground.render(cameraState);
          renderers.building.render(cameraState, runtime?.cameraPitchMix || 0);
          renderers.impostor.render(cameraState, runtime?.cameraPitchMix || 0);
          renderers.projectile.render(cameraState);
          renderers.effect.render(cameraState);
        },
        dispose
      };
      setGlError('');
      setIsReady(true);
    } catch (renderInitError) {
      setGlError(`初始化渲染器失败: ${renderInitError.message}`);
      dispose();
    }
    return () => {
      dispose();
    };
  }, [battleInitData, canvasRef, dispose, enabled, error, loading]);

  return {
    pipelineRef,
    dispose,
    isReady,
    glError
  };
}
