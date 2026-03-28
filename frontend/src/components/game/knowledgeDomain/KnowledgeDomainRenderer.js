import {
  CITY_CAMERA_DEFAULT_ANGLE_DEG,
  clampCityCameraAngle,
  getCityMetrics
} from './shared';

class KnowledgeDomainRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.animationId = null;
    this.time = 0;
    this.viewOffset = { x: 0, y: 0 };
    this.cameraAngleDeg = CITY_CAMERA_DEFAULT_ANGLE_DEG;
    this.gateVisibility = {
      cheng: true,
      qi: true
    };

    this.groundColor = '#1a1f35';
    this.roadColor = '#2d3555';
    this.roadBorderColor = '#4a5580';
    this.centerColor = '#252b45';
    this.glowColor = 'rgba(103, 232, 249, 0.24)';

    this.particles = [];
    this.initParticles();
  }

  initParticles() {
    for (let i = 0; i < 50; i += 1) {
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

  setViewOffset(offsetX = 0, offsetY = 0) {
    this.viewOffset = {
      x: Number.isFinite(Number(offsetX)) ? Number(offsetX) : 0,
      y: Number.isFinite(Number(offsetY)) ? Number(offsetY) : 0
    };
  }

  setCameraAngle(angleDeg = CITY_CAMERA_DEFAULT_ANGLE_DEG) {
    this.cameraAngleDeg = clampCityCameraAngle(angleDeg);
  }

  setGateVisibility(visibility = {}) {
    this.gateVisibility = {
      cheng: visibility?.cheng !== false,
      qi: visibility?.qi !== false
    };
  }

  getSceneMetrics() {
    return getCityMetrics(this.canvas.width, this.canvas.height, this.cameraAngleDeg);
  }

  drawGround() {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const { radiusX, radiusY } = metrics;

    const gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, radiusX
    );
    gradient.addColorStop(0, 'rgba(103, 232, 249, 0.15)');
    gradient.addColorStop(0.7, 'rgba(103, 232, 249, 0.05)');
    gradient.addColorStop(1, 'transparent');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 1.3, radiusY * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.centerColor;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.34)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(103, 232, 249, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 0.8, radiusY * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 0.5, radiusY * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawRoad(gateKey) {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const isTop = gateKey === 'cheng';
    const showRoad = isTop ? this.gateVisibility.cheng : this.gateVisibility.qi;
    if (!showRoad) return;

    const roadHalfWidth = 34;
    const flare = 24 * (1 - metrics.tiltBlend);
    const outerY = isTop
      ? centerY - metrics.radiusY - 92
      : centerY + metrics.radiusY + 92;
    const innerY = isTop
      ? centerY - metrics.radiusY * 0.44
      : centerY + metrics.radiusY * 0.44;

    const points = isTop
      ? [
          { x: centerX - roadHalfWidth - flare, y: outerY },
          { x: centerX + roadHalfWidth + flare, y: outerY },
          { x: centerX + roadHalfWidth, y: innerY },
          { x: centerX - roadHalfWidth, y: innerY }
        ]
      : [
          { x: centerX - roadHalfWidth, y: innerY },
          { x: centerX + roadHalfWidth, y: innerY },
          { x: centerX + roadHalfWidth + flare, y: outerY },
          { x: centerX - roadHalfWidth - flare, y: outerY }
        ];

    ctx.fillStyle = this.roadColor;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = this.roadBorderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.setLineDash([15, 10]);
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, outerY);
    ctx.lineTo(centerX, innerY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawGate(gateKey) {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const isTop = gateKey === 'cheng';
    const isVisible = isTop ? this.gateVisibility.cheng : this.gateVisibility.qi;
    if (!isVisible) return;

    const x = centerX;
    const y = isTop
      ? centerY - metrics.radiusY - 92
      : centerY + metrics.radiusY + 92;
    const gateWidth = 108;
    const gateHeight = 22 + ((1 - metrics.tiltBlend) * 18);
    const gateColor = isTop ? '#38bdf8' : '#34d399';

    const fanGradient = ctx.createRadialGradient(x, y, 8, x, y, 150);
    fanGradient.addColorStop(0, isTop ? 'rgba(56, 189, 248, 0.38)' : 'rgba(52, 211, 153, 0.38)');
    fanGradient.addColorStop(0.55, isTop ? 'rgba(56, 189, 248, 0.16)' : 'rgba(52, 211, 153, 0.16)');
    fanGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = fanGradient;
    ctx.beginPath();
    if (isTop) {
      ctx.moveTo(x, y);
      ctx.arc(x, y, 140, Math.PI, Math.PI * 2);
    } else {
      ctx.moveTo(x, y);
      ctx.arc(x, y, 140, 0, Math.PI);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = gateColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (isTop) {
      ctx.ellipse(x, y + 8, gateWidth * 0.5, gateHeight, 0, Math.PI, Math.PI * 2);
    } else {
      ctx.ellipse(x, y - 8, gateWidth * 0.5, gateHeight, 0, 0, Math.PI);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.beginPath();
    ctx.ellipse(x, y, gateWidth * 0.26, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawParticles() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;

    for (const particle of this.particles) {
      particle.y += particle.speed;
      if (particle.y > 1) particle.y = -1;

      const projX = centerX + particle.x * width * 0.4;
      const projY = centerY + particle.y * height * (0.3 + (metrics.tiltBlend * 0.08)) - particle.z * (50 - (metrics.tiltBlend * 18));

      if (projX > 0 && projX < width && projY > 0 && projY < height) {
        ctx.fillStyle = `rgba(103, 232, 249, ${particle.alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(projX, projY, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawPulseRings() {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const { radiusX, radiusY } = metrics;

    for (let i = 0; i < 3; i += 1) {
      const phase = (this.time * 0.5 + i * 0.33) % 1;
      const scale = 0.5 + phase * 0.5;
      const alpha = (1 - phase) * 0.3;

      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
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

    ctx.fillStyle = this.groundColor;
    ctx.fillRect(0, 0, width, height);

    this.drawRoad('cheng');
    this.drawRoad('qi');
    this.drawGround();
    this.drawPulseRings();
    this.drawGate('cheng');
    this.drawGate('qi');
    this.drawParticles();

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

export default KnowledgeDomainRenderer;
