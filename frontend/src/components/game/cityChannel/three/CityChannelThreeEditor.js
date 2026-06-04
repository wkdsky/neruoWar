import React, { useEffect, useRef, useState } from 'react';
import CityChannelThreeRuntime from './CityChannelThreeRuntime';
import '../CityChannelImmersiveEditor.css';
import './CityChannelThreeEditor.css';

const CityChannelThreeEditor = ({
  initialMapData,
  templateName,
  activeTool,
  activeTileType,
  activeRotation,
  activeLayer,
  panelPose,
  onCommitOperations,
  onExit,
  onExitPreview
}) => {
  const mountRef = useRef(null);
  const runtimeRef = useRef(null);
  const initialRuntimeConfigRef = useRef(null);
  const [status, setStatus] = useState('正交 3D 预览加载中');
  initialRuntimeConfigRef.current = {
    mapData: initialMapData,
    activeTool,
    activeTileType,
    activeRotation,
    activeLayer,
    panelPose,
    onCommitOperations
  };

  useEffect(() => {
    const ownsBodyClass = !document.body.classList.contains('city-channel-immersive-active');
    document.body.classList.add('city-channel-immersive-active');
    return () => {
      if (ownsBodyClass) document.body.classList.remove('city-channel-immersive-active');
    };
  }, []);

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const runtime = new CityChannelThreeRuntime({
      mount: mountRef.current,
      ...initialRuntimeConfigRef.current,
      onStatusChange: setStatus
    });
    runtimeRef.current = runtime;
    return () => {
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setMapData(initialMapData);
  }, [initialMapData]);

  useEffect(() => {
    runtimeRef.current?.setConfig({
      activeTool,
      activeTileType,
      activeRotation,
      activeLayer,
      panelPose,
      onCommitOperations
    });
  }, [activeLayer, activeRotation, activeTileType, activeTool, onCommitOperations, panelPose]);

  return (
    <div className="city-channel-immersive city-channel-three-editor">
      <div className="city-channel-immersive__void" aria-hidden="true" />

      <div className="city-channel-three-editor__topbar">
        <button type="button" className="city-channel-glass-btn" onClick={onExit}>
          返回工坊
        </button>
        {onExitPreview ? (
          <button type="button" className="city-channel-glass-btn is-primary" onClick={onExitPreview}>
            返回编辑器
          </button>
        ) : null}
        <span>{templateName || initialMapData?.name || '城内通道模板'}</span>
      </div>

      <div className="city-channel-three-editor__stage" ref={mountRef} />

      <div className="city-channel-three-editor__status">
        <span>{status}</span>
        <em>Three.js OrthographicCamera</em>
      </div>
    </div>
  );
};

export default CityChannelThreeEditor;
