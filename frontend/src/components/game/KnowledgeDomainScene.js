/**
 * KnowledgeDomainScene - 知识域3D俯视角场景
 * 显示：出口+道路（左侧15%）、圆形地面（中间70%）、入口+道路（右侧15%）
 */

import React, { useRef, useEffect, useState } from 'react';
import './KnowledgeDomainScene.css';

// 3D场景渲染器
class KnowledgeDomainRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.animationId = null;
    this.time = 0;

    // 场景参数
    this.groundColor = '#1a1f35';
    this.roadColor = '#2d3555';
    this.roadBorderColor = '#4a5580';
    this.centerColor = '#252b45';
    this.glowColor = 'rgba(168, 85, 247, 0.3)';

    // 动画状态
    this.particles = [];
    this.initParticles();
  }

  initParticles() {
    // 创建环境粒子
    for (let i = 0; i < 50; i++) {
      this.particles.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 0.5,
        speed: 0.0005 + Math.random() * 0.001,
        size: 1 + Math.random() * 2,
        alpha: 0.3 + Math.random() * 0.5
      });
    }
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  // 3D到2D投影（俯视角45度）
  project(x, y, z) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // 等距投影
    const scale = Math.min(width, height) * 0.4;
    const angle = Math.PI / 6; // 30度俯视角

    const projX = centerX + (x - y * 0.5) * scale;
    const projY = centerY + (x * 0.3 + y * 0.5 - z) * scale;

    return { x: projX, y: projY };
  }

  // 绘制椭圆形地面（俯视角看起来的圆）
  drawGround() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // 地面半径
    const radiusX = width * 0.35;
    const radiusY = height * 0.25;

    // 绘制外层发光
    const gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, radiusX
    );
    gradient.addColorStop(0, 'rgba(168, 85, 247, 0.15)');
    gradient.addColorStop(0.7, 'rgba(168, 85, 247, 0.05)');
    gradient.addColorStop(1, 'transparent');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 1.3, radiusY * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 绘制主地面
    ctx.fillStyle = this.centerColor;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    // 绘制边框
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 绘制内圈装饰
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 0.8, radiusY * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 0.5, radiusY * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 绘制道路
  drawRoad(side) {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerY = height / 2;

    const roadWidth = 60;
    const roadLength = width * 0.2;

    let startX, endX;
    if (side === 'left') {
      startX = 0;
      endX = width * 0.15 + 50;
    } else {
      startX = width * 0.85 - 50;
      endX = width;
    }

    // 道路主体
    ctx.fillStyle = this.roadColor;
    ctx.beginPath();
    ctx.moveTo(startX, centerY - roadWidth / 2);
    ctx.lineTo(endX, centerY - roadWidth / 2 + (side === 'left' ? 10 : -10));
    ctx.lineTo(endX, centerY + roadWidth / 2 + (side === 'left' ? 10 : -10));
    ctx.lineTo(startX, centerY + roadWidth / 2);
    ctx.closePath();
    ctx.fill();

    // 道路边框
    ctx.strokeStyle = this.roadBorderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 道路中线（虚线）
    ctx.setLineDash([15, 10]);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, centerY);
    ctx.lineTo(endX, centerY + (side === 'left' ? 5 : -5));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 绘制门/入口
  drawGate(side) {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerY = height / 2;

    let x;
    if (side === 'left') {
      x = width * 0.08;
    } else {
      x = width * 0.92;
    }

    const gateWidth = 40;
    const gateHeight = 80;

    // 门柱
    ctx.fillStyle = '#4a5580';
    ctx.fillRect(x - gateWidth / 2, centerY - gateHeight, 8, gateHeight);
    ctx.fillRect(x + gateWidth / 2 - 8, centerY - gateHeight, 8, gateHeight);

    // 门拱
    ctx.strokeStyle = side === 'left' ? '#ef4444' : '#22c55e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, centerY - gateHeight + 10, gateWidth / 2, Math.PI, 0);
    ctx.stroke();

    // 发光效果
    const glowGradient = ctx.createRadialGradient(x, centerY - gateHeight / 2, 0, x, centerY - gateHeight / 2, 60);
    glowGradient.addColorStop(0, side === 'left' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)');
    glowGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGradient;
    ctx.fillRect(x - 60, centerY - gateHeight - 30, 120, 100);

    // 标签
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(side === 'left' ? '出口' : '入口', x, centerY + 30);
  }

  // 绘制粒子
  drawParticles() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    for (const p of this.particles) {
      // 更新位置（缓慢飘动）
      p.y += p.speed;
      if (p.y > 1) p.y = -1;

      const projX = centerX + p.x * width * 0.4;
      const projY = centerY + p.y * height * 0.3 - p.z * 50;

      // 只绘制在可见区域内的粒子
      if (projX > 0 && projX < width && projY > 0 && projY < height) {
        ctx.fillStyle = `rgba(168, 85, 247, ${p.alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(projX, projY, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 绘制脉冲环
  drawPulseRings() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    const radiusX = width * 0.35;
    const radiusY = height * 0.25;

    // 多个脉冲环
    for (let i = 0; i < 3; i++) {
      const phase = (this.time * 0.5 + i * 0.33) % 1;
      const scale = 0.5 + phase * 0.5;
      const alpha = (1 - phase) * 0.3;

      ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX * scale, radiusY * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 清空画布
    ctx.fillStyle = this.groundColor;
    ctx.fillRect(0, 0, width, height);

    // 绘制各层
    this.drawRoad('left');
    this.drawRoad('right');
    this.drawGround();
    this.drawPulseRings();
    this.drawGate('left');
    this.drawGate('right');
    this.drawParticles();

    // 更新时间
    this.time += 0.016;
  }

  startRenderLoop() {
    const animate = () => {
      this.render();
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  stopRenderLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  destroy() {
    this.stopRenderLoop();
  }
}

const KnowledgeDomainScene = ({
  node,
  isVisible,
  onExit,
  transitionProgress = 1 // 0-1，用于过渡动画
}) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const containerRef = useRef(null);

  // 计算实际的显示透明度（在进度40%后开始淡入，或退出时在60%前淡出完成）
  const displayOpacity = transitionProgress < 0.4
    ? 0
    : Math.min(1, (transitionProgress - 0.4) / 0.5);

  useEffect(() => {
    if (!isVisible || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    // 创建渲染器
    rendererRef.current = new KnowledgeDomainRenderer(canvas);
    rendererRef.current.startRenderLoop();

    // 监听窗口大小变化
    const handleResize = () => {
      if (container && rendererRef.current) {
        rendererRef.current.resize(container.clientWidth, container.clientHeight);
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
  }, [isVisible]);

  if (!isVisible && transitionProgress <= 0) return null;

  return (
    <div
      ref={containerRef}
      className="knowledge-domain-container"
      style={{
        opacity: displayOpacity,
        pointerEvents: displayOpacity > 0.5 ? 'auto' : 'none'
      }}
    >
      <canvas ref={canvasRef} className="knowledge-domain-canvas" />

      {/* 节点信息浮窗 */}
      <div
        className="domain-info-panel"
        style={{
          opacity: displayOpacity,
          transform: `translateY(${(1 - displayOpacity) * -20}px)`
        }}
      >
        <h2 className="domain-title">{node?.name || '知识域'}</h2>
        <p className="domain-description">{node?.description || ''}</p>
        <div className="domain-stats">
          <div className="stat-item">
            <span className="stat-label">知识点</span>
            <span className="stat-value">{node?.knowledgePoint?.value?.toFixed(2) || '0.00'}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">内容分数</span>
            <span className="stat-value">{node?.contentScore || 1}</span>
          </div>
        </div>
        <button className="exit-domain-btn" onClick={onExit}>
          离开知识域
        </button>
      </div>
    </div>
  );
};

export default KnowledgeDomainScene;
