/**
 * KnowledgeDomainScene - 知识域3D俯视角场景
 * 显示：出口+道路（左侧15%）、圆形地面（中间70%）、入口+道路（右侧15%）
 */

import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, ChevronLeft, ChevronRight } from 'lucide-react';
import './KnowledgeDomainScene.css';

const DISTRIBUTION_SCOPE_OPTIONS = [
  { value: 'all', label: '全部分发（100%）' },
  { value: 'partial', label: '部分分发（按比例）' }
];

const clampPercent = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const createDefaultDistributionRule = () => ({
  enabled: false,
  distributionScope: 'all',
  distributionPercent: 100,
  masterPercent: 10,
  adminPercents: [],
  customUserPercents: [],
  nonHostileAlliancePercent: 0,
  specificAlliancePercents: [],
  noAlliancePercent: 0,
  blacklistUsers: [],
  blacklistAlliances: []
});

const createDistributionRuleProfileId = () => (
  `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
);

const mapDistributionRuleFromApi = (rawRule = {}) => ({
  enabled: !!rawRule.enabled,
  distributionScope: rawRule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: clampPercent(rawRule?.distributionPercent, 100),
  masterPercent: clampPercent(rawRule.masterPercent, 10),
  adminPercents: Array.isArray(rawRule.adminPercents)
    ? rawRule.adminPercents.map((item) => ({
        userId: item.userId,
        username: item.username || '',
        percent: clampPercent(item.percent, 0)
      })).filter((item) => item.userId)
    : [],
  customUserPercents: Array.isArray(rawRule.customUserPercents)
    ? rawRule.customUserPercents.map((item) => ({
        userId: item.userId,
        username: item.username || '',
        percent: clampPercent(item.percent, 0)
      })).filter((item) => item.userId)
    : [],
  nonHostileAlliancePercent: clampPercent(rawRule.nonHostileAlliancePercent, 0),
  specificAlliancePercents: Array.isArray(rawRule.specificAlliancePercents)
    ? rawRule.specificAlliancePercents.map((item) => ({
        allianceId: item.allianceId,
        allianceName: item.allianceName || '',
        percent: clampPercent(item.percent, 0)
      })).filter((item) => item.allianceId)
    : [],
  noAlliancePercent: clampPercent(rawRule.noAlliancePercent, 0),
  blacklistUsers: Array.isArray(rawRule.blacklistUsers)
    ? rawRule.blacklistUsers.map((item) => ({
        userId: item.userId || item._id || '',
        username: item.username || ''
      })).filter((item) => item.userId)
    : [],
  blacklistAlliances: Array.isArray(rawRule.blacklistAlliances)
    ? rawRule.blacklistAlliances.map((item) => ({
        allianceId: item.allianceId || item._id || '',
        allianceName: item.allianceName || ''
      })).filter((item) => item.allianceId)
    : []
});

const mapDistributionRuleProfileFromApi = (rawProfile = {}, index = 0) => {
  const fallbackRule = mapDistributionRuleFromApi(rawProfile?.rule || rawProfile);
  return {
    profileId: typeof rawProfile.profileId === 'string' && rawProfile.profileId.trim()
      ? rawProfile.profileId.trim()
      : `rule_${index + 1}`,
    name: typeof rawProfile.name === 'string' && rawProfile.name.trim()
      ? rawProfile.name.trim()
      : `规则${index + 1}`,
    enabled: !!rawProfile.enabled,
    rule: fallbackRule,
    percentSummary: rawProfile.percentSummary || null
  };
};

const createDistributionRuleProfile = (profileId = 'default', name = '默认规则', rawRule = null) => ({
  profileId,
  name,
  enabled: true,
  rule: rawRule ? mapDistributionRuleFromApi(rawRule) : createDefaultDistributionRule(),
  percentSummary: null
});

const buildDistributionRulePayload = (rule = {}) => ({
  enabled: false,
  distributionScope: rule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: clampPercent(rule?.distributionPercent, 100),
  masterPercent: clampPercent(rule.masterPercent, 10),
  adminPercents: (rule.adminPercents || [])
    .filter((item) => item.userId && clampPercent(item.percent, 0) > 0)
    .map((item) => ({ userId: item.userId, percent: clampPercent(item.percent, 0) })),
  customUserPercents: (rule.customUserPercents || [])
    .filter((item) => item.userId && clampPercent(item.percent, 0) > 0)
    .map((item) => ({ userId: item.userId, percent: clampPercent(item.percent, 0) })),
  nonHostileAlliancePercent: clampPercent(rule.nonHostileAlliancePercent, 0),
  specificAlliancePercents: (rule.specificAlliancePercents || [])
    .filter((item) => item.allianceId && clampPercent(item.percent, 0) > 0)
    .map((item) => ({ allianceId: item.allianceId, percent: clampPercent(item.percent, 0) })),
  noAlliancePercent: clampPercent(rule.noAlliancePercent, 0),
  blacklistUserIds: (rule.blacklistUsers || []).map((item) => item.userId).filter(Boolean),
  blacklistAllianceIds: (rule.blacklistAlliances || []).map((item) => item.allianceId).filter(Boolean)
});

const createDefaultDistributionState = () => ({
  loading: false,
  saving: false,
  publishing: false,
  error: '',
  feedback: '',
  canView: false,
  canEdit: false,
  isRuleLocked: false,
  percentSummary: { x: 0, y: 0, z: 0, b: 0, d: 0, e: 0, f: 0, total: 0 },
  allianceContributionPercent: 0,
  masterAllianceName: '',
  carryoverValue: 0,
  knowledgePointValue: 0,
  lastSyncedAt: Date.now(),
  locked: null,
  publishRuleId: 'default',
  publishExecuteAt: '',
  activeRuleId: 'default',
  ruleProfiles: [createDistributionRuleProfile('default', '默认规则')]
});

const computePercentSummary = (rule, allianceContributionPercent) => {
  const x = clampPercent(rule?.masterPercent, 10);
  const y = (rule?.adminPercents || []).reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const z = clampPercent(allianceContributionPercent, 0);
  const b = (rule?.customUserPercents || []).reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const d = clampPercent(rule?.nonHostileAlliancePercent, 0);
  const e = (rule?.specificAlliancePercents || []).reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const f = clampPercent(rule?.noAlliancePercent, 0);
  const total = x + y + z + b + d + e + f;
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    z: Number(z.toFixed(2)),
    b: Number(b.toFixed(2)),
    d: Number(d.toFixed(2)),
    e: Number(e.toFixed(2)),
    f: Number(f.toFixed(2)),
    total: Number(total.toFixed(2))
  };
};

const getDistributionScopePercent = (rule = {}) => (
  rule?.distributionScope === 'partial' ? clampPercent(rule?.distributionPercent, 100) : 100
);

const toHourInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:00`;
};

const getDefaultPublishExecuteAtInput = () => {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toHourInputValue(date);
};

const parseHourInputToDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (date.getMinutes() !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0) return null;
  return date;
};

const formatCountdown = (seconds) => {
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
  const [activeTab, setActiveTab] = useState('info');
  const [domainAdminState, setDomainAdminState] = useState({
    loading: false,
    error: '',
    canView: false,
    canEdit: false,
    isSystemAdmin: false,
    canResign: false,
    resignPending: false,
    domainMaster: null,
    domainAdmins: [],
    pendingInvites: []
  });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [invitingUsername, setInvitingUsername] = useState('');
  const [revokingInviteId, setRevokingInviteId] = useState('');
  const [removingAdminId, setRemovingAdminId] = useState('');
  const [isSubmittingResign, setIsSubmittingResign] = useState(false);
  const [manageFeedback, setManageFeedback] = useState('');
  const [distributionState, setDistributionState] = useState(createDefaultDistributionState);
  const [distributionUserKeyword, setDistributionUserKeyword] = useState('');
  const [distributionUserResults, setDistributionUserResults] = useState([]);
  const [distributionUserSearching, setDistributionUserSearching] = useState(false);
  const [distributionAllianceKeyword, setDistributionAllianceKeyword] = useState('');
  const [distributionAllianceResults, setDistributionAllianceResults] = useState([]);
  const [distributionAllianceSearching, setDistributionAllianceSearching] = useState(false);
  const [isDistributionRuleModalOpen, setIsDistributionRuleModalOpen] = useState(false);
  const [newDistributionRuleName, setNewDistributionRuleName] = useState('');
  const [distributionClockMs, setDistributionClockMs] = useState(Date.now());
  const [hasUnsavedDistributionDraft, setHasUnsavedDistributionDraft] = useState(false);
  const [activeManageSidePanel, setActiveManageSidePanel] = useState('');
  const [isDomainInfoDockExpanded, setIsDomainInfoDockExpanded] = useState(false);
  const showManageTab = !!domainAdminState.canView;

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

  const getApiError = (parsed, fallback) => (
    parsed?.data?.error ||
    parsed?.data?.message ||
    fallback
  );

  const toggleManageSidePanel = (section) => {
    setActiveManageSidePanel((prev) => (prev === section ? '' : section));
  };

  const fetchDomainAdmins = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    if (!silent) {
      setDomainAdminState((prev) => ({ ...prev, loading: true, error: '' }));
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        // 权限不足时，直接隐藏“管理知识域”标签，不展示错误文案
        if (response.status === 403) {
          setDomainAdminState((prev) => ({
            ...prev,
            loading: false,
            canView: false,
            canEdit: false,
            isSystemAdmin: false,
              canResign: false,
              resignPending: false,
              pendingInvites: [],
              error: ''
            }));
            return;
        }

        setDomainAdminState((prev) => ({
          ...prev,
          loading: false,
          canView: false,
          canEdit: false,
          isSystemAdmin: false,
          canResign: false,
          resignPending: false,
          pendingInvites: [],
          error: getApiError(parsed, '获取域相列表失败')
        }));
        return;
      }

      setDomainAdminState({
        loading: false,
        error: '',
        canView: !!data.canView,
        canEdit: !!data.canEdit,
        isSystemAdmin: !!data.isSystemAdmin,
        canResign: !!data.canResign,
        resignPending: !!data.resignPending,
        domainMaster: data.domainMaster || null,
        domainAdmins: data.domainAdmins || [],
        pendingInvites: data.pendingInvites || []
      });
    } catch (error) {
      setDomainAdminState((prev) => ({
        ...prev,
        loading: false,
        isSystemAdmin: false,
        canResign: false,
        resignPending: false,
        pendingInvites: [],
        error: `获取域相列表失败: ${error.message}`
      }));
    }
  };

  const applyResignDomainAdmin = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    const confirmed = window.confirm('确认提交卸任申请？域主3天内未处理将自动同意。');
    if (!confirmed) return;

    setIsSubmittingResign(true);
    setManageFeedback('');

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/resign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '提交卸任申请失败'));
        return;
      }

      setManageFeedback(data.message || '卸任申请已提交');
      await fetchDomainAdmins(true);
    } catch (error) {
      setManageFeedback(`提交卸任申请失败: ${error.message}`);
    } finally {
      setIsSubmittingResign(false);
    }
  };

  const inviteDomainAdmin = async (username) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !username) return;

    setInvitingUsername(username);
    setManageFeedback('');

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '发送邀请失败'));
        return;
      }

      setManageFeedback(data.message || '邀请已发送');
      setSearchKeyword('');
      setSearchResults([]);
      await fetchDomainAdmins(true);
      await fetchDistributionSettings(true);
    } catch (error) {
      setManageFeedback(`发送邀请失败: ${error.message}`);
    } finally {
      setInvitingUsername('');
    }
  };

  const removeDomainAdmin = async (adminUserId) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !adminUserId) return;

    const confirmed = window.confirm('确认移除该管理员吗？');
    if (!confirmed) return;

    setRemovingAdminId(adminUserId);
    setManageFeedback('');

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/${adminUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '移除管理员失败'));
        return;
      }

      setManageFeedback(data.message || '管理员已移除');
      await fetchDomainAdmins(true);
      await fetchDistributionSettings(true);
    } catch (error) {
      setManageFeedback(`移除管理员失败: ${error.message}`);
    } finally {
      setRemovingAdminId('');
    }
  };

  const revokeDomainAdminInvite = async (notificationId) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !notificationId) return;

    setRevokingInviteId(notificationId);
    setManageFeedback('');

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/invite/${notificationId}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '撤销邀请失败'));
        return;
      }

      setManageFeedback(data.message || '邀请已撤销');
      await fetchDomainAdmins(true);
      await fetchDistributionSettings(true);
    } catch (error) {
      setManageFeedback(`撤销邀请失败: ${error.message}`);
    } finally {
      setRevokingInviteId('');
    }
  };

  const normalizeDistributionProfiles = (rawProfiles = [], rawActiveRuleId = '', allianceContributionPercent = 0) => {
    const input = Array.isArray(rawProfiles) && rawProfiles.length > 0
      ? rawProfiles
      : [createDistributionRuleProfile('default', '默认规则')];
    const seen = new Set();
    const profiles = input
      .map((profile, index) => mapDistributionRuleProfileFromApi(profile, index))
      .filter((profile) => {
        if (!profile.profileId || seen.has(profile.profileId)) return false;
        seen.add(profile.profileId);
        return true;
      })
      .map((profile) => ({
        ...profile,
        percentSummary: computePercentSummary(profile.rule, allianceContributionPercent)
      }));

    const safeProfiles = profiles.length > 0 ? profiles : [createDistributionRuleProfile('default', '默认规则')];
    const activeRuleId = safeProfiles.some((profile) => profile.profileId === rawActiveRuleId)
      ? rawActiveRuleId
      : safeProfiles[0].profileId;

    return { profiles: safeProfiles, activeRuleId };
  };

  const updateDistributionRule = (updater) => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextProfiles = [...normalized.profiles];
      const targetIndex = nextProfiles.findIndex((item) => item.profileId === normalized.activeRuleId);
      const currentRule = nextProfiles[targetIndex]?.rule || createDefaultDistributionRule();
      const nextRule = typeof updater === 'function' ? updater(currentRule) : updater;
      const nextSummary = computePercentSummary(nextRule, prev.allianceContributionPercent);
      nextProfiles[targetIndex] = {
        ...nextProfiles[targetIndex],
        rule: nextRule,
        percentSummary: nextSummary
      };

      return {
        ...prev,
        ruleProfiles: nextProfiles,
        activeRuleId: normalized.activeRuleId,
        percentSummary: nextSummary,
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  };

  const updateActiveDistributionRuleName = (name) => {
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : '未命名规则';
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      return {
        ...prev,
        ruleProfiles: normalized.profiles.map((profile) => (
          profile.profileId === normalized.activeRuleId
            ? { ...profile, name: nextName }
            : profile
        )),
        activeRuleId: normalized.activeRuleId,
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  };

  const setActiveDistributionRule = (profileId) => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextActiveRuleId = normalized.profiles.some((profile) => profile.profileId === profileId)
        ? profileId
        : normalized.activeRuleId;
      const activeProfile = normalized.profiles.find((profile) => profile.profileId === nextActiveRuleId) || normalized.profiles[0];
      return {
        ...prev,
        ruleProfiles: normalized.profiles,
        activeRuleId: nextActiveRuleId,
        percentSummary: computePercentSummary(activeProfile?.rule || createDefaultDistributionRule(), prev.allianceContributionPercent),
        feedback: ''
      };
    });
  };

  const createDistributionRuleProfileItem = () => {
    const trimmedName = newDistributionRuleName.trim();
    const nextName = trimmedName || `规则${(distributionState.ruleProfiles || []).length + 1}`;
    const nextId = createDistributionRuleProfileId();
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextProfiles = [
        ...normalized.profiles,
        {
          ...createDistributionRuleProfile(nextId, nextName),
          percentSummary: computePercentSummary(createDefaultDistributionRule(), prev.allianceContributionPercent)
        }
      ];
      return {
        ...prev,
        ruleProfiles: nextProfiles,
        activeRuleId: nextId,
        percentSummary: computePercentSummary(createDefaultDistributionRule(), prev.allianceContributionPercent),
        feedback: ''
      };
    });
    setNewDistributionRuleName('');
    setHasUnsavedDistributionDraft(true);
  };

  const removeActiveDistributionRule = () => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      if (normalized.profiles.length <= 1) {
        return {
          ...prev,
          feedback: '至少保留一套分发规则'
        };
      }
      const filtered = normalized.profiles.filter((profile) => profile.profileId !== normalized.activeRuleId);
      const nextActive = filtered[0];
      return {
        ...prev,
        ruleProfiles: filtered,
        activeRuleId: nextActive.profileId,
        percentSummary: computePercentSummary(nextActive.rule, prev.allianceContributionPercent),
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  };

  const fetchDistributionSettings = async (silent = true, forceApplyRules = false) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    if (!silent) {
      setDistributionState((prev) => ({ ...prev, loading: true, error: '', feedback: '' }));
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/distribution-settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        if (response.status === 403) {
          setDistributionState((prev) => ({ ...prev, loading: false, canView: false, canEdit: false, error: '' }));
          return;
        }
        setDistributionState((prev) => ({
          ...prev,
          loading: false,
          canView: false,
          canEdit: false,
          error: getApiError(parsed, '获取分发规则失败')
        }));
        return;
      }

      const allianceContributionPercent = Number(data.allianceContributionPercent || 0);
      const hasAlliance = !!data.masterAllianceName;
      const rawProfiles = Array.isArray(data.ruleProfiles) && data.ruleProfiles.length > 0
        ? data.ruleProfiles
        : [{ profileId: data.activeRuleId || 'default', name: '默认规则', rule: data.rule || {} }];
      const normalized = normalizeDistributionProfiles(rawProfiles, data.activeRuleId || '', allianceContributionPercent);
      const normalizedProfiles = hasAlliance
        ? normalized.profiles
        : normalized.profiles.map((profile) => ({
            ...profile,
            rule: {
              ...profile.rule,
              nonHostileAlliancePercent: 0,
              specificAlliancePercents: []
            },
            percentSummary: computePercentSummary({
              ...profile.rule,
              nonHostileAlliancePercent: 0,
              specificAlliancePercents: []
            }, allianceContributionPercent)
          }));
      const activeProfile = normalizedProfiles.find((profile) => profile.profileId === normalized.activeRuleId) || normalizedProfiles[0];
      const nextLocked = data.locked || null;
      const publishRuleId = nextLocked?.ruleProfileId
        || (normalizedProfiles.some((profile) => profile.profileId === data.activeRuleId) ? data.activeRuleId : activeProfile?.profileId || 'default');
      const publishExecuteAt = nextLocked?.executeAt
        ? toHourInputValue(nextLocked.executeAt)
        : getDefaultPublishExecuteAtInput();
      const shouldPreserveLocalDraft = silent && hasUnsavedDistributionDraft && !forceApplyRules;

      setDistributionState((prev) => {
        const appliedRuleState = shouldPreserveLocalDraft
          ? (() => {
              const localNormalized = normalizeDistributionProfiles(
                prev.ruleProfiles,
                prev.activeRuleId,
                allianceContributionPercent
              );
              const localProfiles = hasAlliance
                ? localNormalized.profiles
                : localNormalized.profiles.map((profile) => ({
                    ...profile,
                    rule: {
                      ...profile.rule,
                      nonHostileAlliancePercent: 0,
                      specificAlliancePercents: []
                    },
                    percentSummary: computePercentSummary({
                      ...profile.rule,
                      nonHostileAlliancePercent: 0,
                      specificAlliancePercents: []
                    }, allianceContributionPercent)
                  }));
              const localActiveProfile = localProfiles.find((profile) => profile.profileId === localNormalized.activeRuleId) || localProfiles[0];
              return {
                activeRuleId: localNormalized.activeRuleId,
                ruleProfiles: localProfiles,
                percentSummary: computePercentSummary(localActiveProfile?.rule || createDefaultDistributionRule(), allianceContributionPercent)
              };
            })()
          : {
              activeRuleId: normalized.activeRuleId,
              ruleProfiles: normalizedProfiles,
              percentSummary: computePercentSummary(activeProfile?.rule || createDefaultDistributionRule(), allianceContributionPercent)
            };

        return {
          ...prev,
          ...appliedRuleState,
          loading: false,
          saving: false,
          publishing: false,
          error: '',
          feedback: shouldPreserveLocalDraft ? prev.feedback : '',
          canView: !!data.canView,
          canEdit: !!data.canEdit,
          isRuleLocked: !!data.isRuleLocked,
          allianceContributionPercent,
          masterAllianceName: data.masterAllianceName || '',
          carryoverValue: Number(data.carryoverValue || 0),
          knowledgePointValue: Number(data.knowledgePointValue || 0),
          lastSyncedAt: Date.now(),
          locked: nextLocked,
          publishRuleId,
          publishExecuteAt
        };
      });
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        loading: false,
        error: `获取分发规则失败: ${error.message}`
      }));
    }
  };

  const saveDistributionSettings = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;
    if (!distributionState.canEdit) return;
    if (distributionState.locked) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '当前分发计划已发布，采用规则锁定中，请等待本次分发结束后再修改规则'
      }));
      return;
    }

    const hasMasterAlliance = !!distributionState.masterAllianceName;
    const normalized = normalizeDistributionProfiles(
      distributionState.ruleProfiles,
      distributionState.activeRuleId,
      distributionState.allianceContributionPercent
    );
    const overLimitProfile = normalized.profiles.find((profile) => (
      computePercentSummary(profile.rule, distributionState.allianceContributionPercent).total > 100
    ));
    if (overLimitProfile) {
      const overTotal = computePercentSummary(overLimitProfile.rule, distributionState.allianceContributionPercent).total;
      setDistributionState((prev) => ({
        ...prev,
        feedback: `规则「${overLimitProfile.name}」总比例 ${overTotal}% 超过 100%，请调整`
      }));
      return;
    }

    setDistributionState((prev) => ({ ...prev, saving: true, feedback: '', error: '' }));
    try {
      const payload = {
        activeRuleId: normalized.activeRuleId,
        ruleProfiles: normalized.profiles.map((profile) => ({
          profileId: profile.profileId,
          name: profile.name,
          rule: (() => {
            const baseRule = {
              ...buildDistributionRulePayload(profile.rule),
              distributionScope: profile.rule?.distributionScope === 'partial' ? 'partial' : 'all',
              distributionPercent: getDistributionScopePercent(profile.rule)
            };
            if (!hasMasterAlliance) {
              baseRule.nonHostileAlliancePercent = 0;
              baseRule.specificAlliancePercents = [];
            }
            return baseRule;
          })()
        }))
      };

      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/distribution-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionState((prev) => ({
          ...prev,
          saving: false,
          error: getApiError(parsed, '保存分发规则失败')
        }));
        return;
      }

      setDistributionState((prev) => ({
        ...prev,
        saving: false,
        feedback: data.message || '分发规则已保存',
        isRuleLocked: !!data.isRuleLocked
      }));
      setHasUnsavedDistributionDraft(false);
      await fetchDistributionSettings(true, true);
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        saving: false,
        error: `保存分发规则失败: ${error.message}`
      }));
    }
  };

  const publishDistributionPlan = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;
    if (!distributionState.canEdit) return;

    if (distributionState.locked) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '当前已有已发布分发计划，发布后不可撤回，请等待本次分发执行后再发布'
      }));
      return;
    }

    const now = Date.now();

    const executeAtDate = parseHourInputToDate(distributionState.publishExecuteAt);
    if (!executeAtDate) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '请设置整点执行时间（例如 2026-02-16 16:00）'
      }));
      return;
    }
    if (executeAtDate.getTime() <= now) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '执行时间必须晚于当前时间'
      }));
      return;
    }

    const normalized = normalizeDistributionProfiles(
      distributionState.ruleProfiles,
      distributionState.activeRuleId,
      distributionState.allianceContributionPercent
    );
    const targetProfile = normalized.profiles.find((profile) => profile.profileId === distributionState.publishRuleId)
      || normalized.profiles.find((profile) => profile.profileId === normalized.activeRuleId)
      || normalized.profiles[0];

    if (!targetProfile) {
      setDistributionState((prev) => ({ ...prev, feedback: '未找到可发布的分发规则' }));
      return;
    }

    const targetSummary = computePercentSummary(targetProfile.rule, distributionState.allianceContributionPercent);
    if (targetSummary.total > 100) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: `规则「${targetProfile.name}」总比例 ${targetSummary.total}% 超过 100%，请先调整再发布`
      }));
      return;
    }

    setDistributionState((prev) => ({
      ...prev,
      publishing: true,
      feedback: '',
      error: ''
    }));

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/distribution-settings/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ruleProfileId: targetProfile.profileId,
          executeAt: executeAtDate.toISOString()
        })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionState((prev) => ({
          ...prev,
          publishing: false,
          error: getApiError(parsed, '发布分发计划失败')
        }));
        return;
      }

      setDistributionState((prev) => ({
        ...prev,
        publishing: false,
        feedback: data.message || '分发计划已发布并锁定，不可撤回'
      }));
      setHasUnsavedDistributionDraft(false);
      await fetchDistributionSettings(true, true);
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        publishing: false,
        error: `发布分发计划失败: ${error.message}`
      }));
    }
  };

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

  useEffect(() => {
    if (!isVisible || !node?._id) return;

    setActiveTab('info');
    setSearchKeyword('');
    setSearchResults([]);
    setManageFeedback('');
    setDistributionUserKeyword('');
    setDistributionUserResults([]);
    setDistributionAllianceKeyword('');
    setDistributionAllianceResults([]);
    setIsDistributionRuleModalOpen(false);
    setNewDistributionRuleName('');
    setActiveManageSidePanel('distribution');
    setDistributionState(createDefaultDistributionState());
    setHasUnsavedDistributionDraft(false);
    fetchDomainAdmins(false);
  }, [isVisible, node?._id]);

  useEffect(() => {
    if (!showManageTab && activeTab === 'manage') {
      setActiveTab('info');
    }
  }, [showManageTab, activeTab]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || !domainAdminState.canEdit) {
      setSearchResults([]);
      return undefined;
    }

    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSearchResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setIsSearchingUsers(true);
      try {
        const response = await fetch(
          `http://localhost:5000/api/nodes/${node._id}/domain-admins/search-users?keyword=${encodeURIComponent(keyword)}`,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setSearchResults([]);
          setManageFeedback(getApiError(parsed, '搜索用户失败'));
          return;
        }
        setSearchResults(data.users || []);
      } catch (error) {
        setSearchResults([]);
        setManageFeedback(`搜索用户失败: ${error.message}`);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 300);

    return () => {
      clearTimeout(timerId);
    };
  }, [activeTab, isVisible, node?._id, searchKeyword, domainAdminState.canEdit]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || hasUnsavedDistributionDraft) return;
    fetchDistributionSettings(false);
  }, [activeTab, isVisible, node?._id, hasUnsavedDistributionDraft]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage') return undefined;
    setDistributionClockMs(Date.now());
    const timerId = setInterval(() => {
      setDistributionClockMs(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [isVisible, activeTab]);

  useEffect(() => {
    if (
      !isVisible ||
      activeTab !== 'manage' ||
      !node?._id ||
      !distributionState.canView ||
      hasUnsavedDistributionDraft ||
      isDistributionRuleModalOpen
    ) return undefined;
    const timerId = setInterval(() => {
      fetchDistributionSettings(true);
    }, 15000);
    return () => clearInterval(timerId);
  }, [activeTab, isVisible, node?._id, distributionState.canView, hasUnsavedDistributionDraft, isDistributionRuleModalOpen]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || !distributionState.canEdit) {
      setDistributionUserResults([]);
      return undefined;
    }
    const keyword = distributionUserKeyword.trim();
    if (!keyword) {
      setDistributionUserResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setDistributionUserSearching(true);
      try {
        const response = await fetch(
          `http://localhost:5000/api/nodes/${node._id}/distribution-settings/search-users?keyword=${encodeURIComponent(keyword)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setDistributionUserResults([]);
          return;
        }
        setDistributionUserResults(data.users || []);
      } catch (error) {
        setDistributionUserResults([]);
      } finally {
        setDistributionUserSearching(false);
      }
    }, 280);

    return () => clearTimeout(timerId);
  }, [activeTab, distributionUserKeyword, distributionState.canEdit, isVisible, node?._id]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || !distributionState.canEdit) {
      setDistributionAllianceResults([]);
      return undefined;
    }
    const keyword = distributionAllianceKeyword.trim();
    if (!keyword) {
      setDistributionAllianceResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setDistributionAllianceSearching(true);
      try {
        const response = await fetch(
          `http://localhost:5000/api/nodes/${node._id}/distribution-settings/search-alliances?keyword=${encodeURIComponent(keyword)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setDistributionAllianceResults([]);
          return;
        }
        setDistributionAllianceResults(data.alliances || []);
      } catch (error) {
        setDistributionAllianceResults([]);
      } finally {
        setDistributionAllianceSearching(false);
      }
    }, 280);

    return () => clearTimeout(timerId);
  }, [activeTab, distributionAllianceKeyword, distributionState.canEdit, isVisible, node?._id]);

  const normalizedDistributionProfiles = normalizeDistributionProfiles(
    distributionState.ruleProfiles,
    distributionState.activeRuleId,
    distributionState.allianceContributionPercent
  );
  const distributionProfiles = normalizedDistributionProfiles.profiles;
  const activeDistributionRuleId = normalizedDistributionProfiles.activeRuleId;
  const activeDistributionProfile = distributionProfiles.find((profile) => profile.profileId === activeDistributionRuleId) || distributionProfiles[0];
  const publishDistributionProfile = distributionProfiles.find((profile) => profile.profileId === distributionState.publishRuleId)
    || activeDistributionProfile
    || distributionProfiles[0];
  const publishDistributionRuleId = distributionProfiles.some((profile) => profile.profileId === distributionState.publishRuleId)
    ? distributionState.publishRuleId
    : (publishDistributionProfile?.profileId || '');
  const distributionRule = activeDistributionProfile?.rule || createDefaultDistributionRule();
  const hasMasterAlliance = !!distributionState.masterAllianceName;
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
  const currentPercentSummary = computePercentSummary(distributionRule, distributionState.allianceContributionPercent);
  const scopePercent = getDistributionScopePercent(distributionRule);
  const unallocatedPercent = Math.max(0, 100 - currentPercentSummary.total);

  const lockedDistribution = distributionState.locked || null;
  const lockedExecuteMs = new Date(lockedDistribution?.executeAt || 0).getTime();
  const hasLockedPlan = !!lockedDistribution && Number.isFinite(lockedExecuteMs);
  const hasUpcomingPublishedPlan = hasLockedPlan && lockedExecuteMs > distributionClockMs;
  const countdownSeconds = hasUpcomingPublishedPlan
    ? Math.max(0, Math.floor((lockedExecuteMs - distributionClockMs) / 1000))
    : 0;

  const blockedRuleNotes = [];
  if (!hasMasterAlliance) {
    blockedRuleNotes.push('域主当前未加入熵盟，Z / D / E 与敌对判定已自动禁用');
  } else {
    blockedRuleNotes.push('敌对熵盟成员优先级最高，固定不可获取（0%）');
  }
  blockedRuleNotes.push('黑名单（用户/熵盟）跟随域主，域主变更时将自动重置');

  const conflictMessages = [];
  const blackUserSet = new Set((distributionRule.blacklistUsers || []).map((item) => item.userId).filter(Boolean));
  const blackAllianceSet = new Set((distributionRule.blacklistAlliances || []).map((item) => item.allianceId).filter(Boolean));
  const conflictUsers = (distributionRule.customUserPercents || []).filter((item) => blackUserSet.has(item.userId));
  const conflictAlliances = (distributionRule.specificAlliancePercents || []).filter((item) => blackAllianceSet.has(item.allianceId));
  if (conflictUsers.length > 0) {
    conflictMessages.push(`指定用户与黑名单冲突 ${conflictUsers.length} 项，最终按“禁止”处理`);
  }
  if (conflictAlliances.length > 0) {
    conflictMessages.push(`指定熵盟与黑名单冲突 ${conflictAlliances.length} 项，最终按“禁止”处理`);
  }
  if (currentPercentSummary.total > 100) {
    conflictMessages.push(`总比例超限 ${currentPercentSummary.total.toFixed(2)}%，超出部分不会被允许保存`);
  }

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

      <div className={`domain-right-dock ${isDomainInfoDockExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="domain-info-panel">
        <div className="domain-tabs">
          <button
            type="button"
            className={`domain-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => setActiveTab('info')}
          >
            知识域信息
          </button>
          {showManageTab && (
            <button
              type="button"
              className={`domain-tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('manage');
                fetchDomainAdmins(false);
                fetchDistributionSettings(false);
              }}
            >
              管理知识域
            </button>
          )}
        </div>

        {activeTab === 'info' || !showManageTab ? (
          <div className="domain-tab-content">
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

          </div>
        ) : (
          <div className="domain-tab-content manage-tab-content">
            <h3 className="domain-manage-title">知识域域相</h3>

            {domainAdminState.loading && <div className="domain-manage-tip">加载中...</div>}
            {!domainAdminState.loading && domainAdminState.error && (
              <div className="domain-manage-error">{domainAdminState.error}</div>
            )}

            {!domainAdminState.loading && !domainAdminState.error && !domainAdminState.canView && (
              <div className="domain-manage-tip">你没有权限查看该知识域域相列表</div>
            )}

            {domainAdminState.canView && (
              <>
                {manageFeedback && <div className="domain-manage-feedback">{manageFeedback}</div>}

                <div className="manage-edge-shell">
                  <div className="manage-edge-tabs">
                    <button
                      type="button"
                      className={`manage-edge-tab ${activeManageSidePanel === 'admins' ? 'active' : ''}`}
                      onClick={() => toggleManageSidePanel('admins')}
                    >
                      域相管理
                    </button>
                    <button
                      type="button"
                      className={`manage-edge-tab ${activeManageSidePanel === 'distribution' ? 'active' : ''}`}
                      onClick={() => toggleManageSidePanel('distribution')}
                    >
                      知识点分发
                    </button>
                  </div>

                  <div className={`manage-edge-panel ${activeManageSidePanel ? 'open' : 'collapsed'}`}>
                    {!activeManageSidePanel && (
                      <div className="domain-manage-tip">点击左侧标签可展开对应管理面板，再次点击同标签可收回。</div>
                    )}

                    {activeManageSidePanel === 'admins' && (
                      <div className="manage-edge-panel-body">
                        <div className="domain-admins-section">
                          <div className="domain-admins-subtitle">域主</div>
                          <div className="domain-admin-row domain-master-row">
                            <span className="domain-admin-name">{domainAdminState.domainMaster?.username || '未设置'}</span>
                            <span className="domain-admin-badge master">域主</span>
                          </div>
                        </div>

                        <div className="domain-admins-section">
                          <div className="domain-admins-subtitle">域相列表</div>
                          {domainAdminState.domainAdmins.length === 0 && (!domainAdminState.pendingInvites || domainAdminState.pendingInvites.length === 0) ? (
                            <div className="domain-manage-tip">当前暂无其他域相</div>
                          ) : (
                            <div className="domain-admin-list">
                              {domainAdminState.domainAdmins.map((adminUser) => (
                                <div key={adminUser._id} className="domain-admin-row">
                                  <span className="domain-admin-name">{adminUser.username}</span>
                                  {domainAdminState.canEdit ? (
                                    <button
                                      type="button"
                                      className="btn btn-small btn-danger"
                                      onClick={() => removeDomainAdmin(adminUser._id)}
                                      disabled={removingAdminId === adminUser._id}
                                    >
                                      {removingAdminId === adminUser._id ? '移除中...' : '移除'}
                                    </button>
                                  ) : (
                                    <span className="domain-admin-badge readonly">仅查看</span>
                                  )}
                                </div>
                              ))}
                              {domainAdminState.canEdit && (domainAdminState.pendingInvites || []).map((pendingItem) => (
                                <div key={pendingItem.notificationId} className="domain-admin-row pending">
                                  <span className="domain-admin-name pending">{pendingItem.username}</span>
                                  <div className="domain-admin-pending-actions">
                                    <span className="domain-admin-badge pending">邀请中</span>
                                    <button
                                      type="button"
                                      className="btn btn-small btn-secondary"
                                      onClick={() => revokeDomainAdminInvite(pendingItem.notificationId)}
                                      disabled={revokingInviteId === pendingItem.notificationId}
                                    >
                                      {revokingInviteId === pendingItem.notificationId ? '撤销中...' : '撤销邀请'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {domainAdminState.canEdit && (domainAdminState.pendingInvites || []).length > 0 && (
                            <div className="domain-manage-tip">灰色名称为内部待确认邀请，仅域主可见。</div>
                          )}
                        </div>

                        {domainAdminState.canEdit ? (
                          <div className="domain-admin-invite">
                            <div className="domain-admins-subtitle">邀请普通用户成为域相</div>
                            <input
                              type="text"
                              className="domain-admin-search-input"
                              placeholder="输入用户名自动搜索"
                              value={searchKeyword}
                              onChange={(e) => {
                                setSearchKeyword(e.target.value);
                                setManageFeedback('');
                              }}
                            />
                            {isSearchingUsers && <div className="domain-manage-tip">搜索中...</div>}
                            {!isSearchingUsers && searchKeyword.trim() && (
                              <div className="domain-search-results">
                                {searchResults.length > 0 ? (
                                  searchResults.map((userItem) => (
                                    <div key={userItem._id} className="domain-search-row">
                                      <span className="domain-admin-name">{userItem.username}</span>
                                      <button
                                        type="button"
                                        className="btn btn-small btn-success"
                                        onClick={() => inviteDomainAdmin(userItem.username)}
                                        disabled={invitingUsername === userItem.username}
                                      >
                                        {invitingUsername === userItem.username ? '邀请中...' : '邀请'}
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <div className="domain-manage-tip">没有匹配的普通用户</div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="domain-admin-invite">
                            <div className="domain-manage-tip">
                              {domainAdminState.isSystemAdmin
                                ? '你是系统管理员，可查看但不可编辑域相名单'
                                : '你当前可查看域相名单，编辑权限仅域主拥有'}
                            </div>
                            {domainAdminState.canResign && (
                              <button
                                type="button"
                                className="btn btn-small btn-warning"
                                onClick={applyResignDomainAdmin}
                                disabled={isSubmittingResign || domainAdminState.resignPending}
                              >
                                {domainAdminState.resignPending
                                  ? '卸任申请待处理'
                                  : (isSubmittingResign ? '提交中...' : '申请卸任域相')}
                              </button>
                            )}
                            {domainAdminState.resignPending && (
                              <div className="domain-manage-tip">已提交卸任申请，等待域主处理（3天超时自动同意）</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {activeManageSidePanel === 'distribution' && (
                      <div className="manage-edge-panel-body">
                        <div className="domain-distribution-section">
                  <div className="domain-admins-subtitle">知识点分发规则</div>
                  {distributionState.loading && <div className="domain-manage-tip">加载分发规则中...</div>}
                  {!distributionState.loading && distributionState.error && (
                    <div className="domain-manage-error">{distributionState.error}</div>
                  )}
                  {!distributionState.loading && !distributionState.error && (
                    <>
                      {(distributionState.feedback || distributionState.isRuleLocked) && (
                        <div className="domain-manage-feedback">
                          {distributionState.feedback || '当前存在已发布分发计划：发布后不可撤回，本次分发使用发布时快照规则。'}
                        </div>
                      )}
                      <div className="distribution-summary-grid">
                        <div className="distribution-summary-item">
                          <span>盟贡献同步比例</span>
                          <strong>{distributionState.allianceContributionPercent.toFixed(2)}%</strong>
                        </div>
                        <div className="distribution-summary-item">
                          <span>总比例</span>
                          <strong className={currentPercentSummary.total > 100 ? 'distribution-over-limit' : ''}>
                            {currentPercentSummary.total.toFixed(2)}%
                          </strong>
                        </div>
                      </div>
                      <div className="domain-manage-tip">
                        比例汇总：域主 {currentPercentSummary.x}% / 域内成员总池 {currentPercentSummary.y}% / 盟贡献 {currentPercentSummary.z}% /
                        指定用户 {currentPercentSummary.b}% / 非敌对熵盟总池 {currentPercentSummary.d}% / 指定熵盟总池 {currentPercentSummary.e}% /
                        无熵盟用户总池 {currentPercentSummary.f}%
                      </div>
                      <div className="domain-manage-tip">
                        {distributionState.masterAllianceName
                          ? `域主所在熵盟：${distributionState.masterAllianceName}`
                          : '域主当前不在熵盟，盟贡献同步比例固定为 0'}
                      </div>

                      {distributionState.canEdit ? (
                        <div className="distribution-editor">
                          <div className="distribution-rule-toolbar">
                            <div className="domain-manage-tip">
                              当前编辑规则：{activeDistributionProfile?.name || '默认规则'}（共 {distributionProfiles.length} 套）
                            </div>
                              <button
                                type="button"
                                className="btn btn-small btn-primary"
                                onClick={() => setIsDistributionRuleModalOpen(true)}
                                disabled={hasLockedPlan}
                              >
                                {hasLockedPlan ? '规则锁定中' : '打开分发规则工作台'}
                              </button>
                          </div>

                          <div className="distribution-subblock distribution-publish-panel">
                            <div className="distribution-subtitle">分发发布流程：选规则 -> 设时间 -> 发布（发布后不可撤回）</div>
                            <div className="distribution-publish-row">
                              <label>发布规则</label>
                              <select
                                value={publishDistributionRuleId}
                                onChange={(e) => setDistributionState((prev) => ({
                                  ...prev,
                                  publishRuleId: e.target.value,
                                  feedback: ''
                                }))}
                                disabled={hasLockedPlan || distributionState.publishing}
                              >
                                {distributionProfiles.map((profile) => (
                                  <option key={profile.profileId} value={profile.profileId}>{profile.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="distribution-publish-row">
                              <label>执行时间（整点）</label>
                              <input
                                type="datetime-local"
                                step="3600"
                                value={distributionState.publishExecuteAt || ''}
                                onChange={(e) => setDistributionState((prev) => ({
                                  ...prev,
                                  publishExecuteAt: e.target.value,
                                  feedback: ''
                                }))}
                                disabled={hasLockedPlan || distributionState.publishing}
                              />
                            </div>
                            <div className="distribution-publish-actions">
                              <button
                                type="button"
                                className="btn btn-small btn-success"
                                onClick={publishDistributionPlan}
                                disabled={hasLockedPlan || distributionState.publishing}
                              >
                                {distributionState.publishing ? '发布中...' : '发布分发计划'}
                              </button>
                              {publishDistributionProfile && (
                                <div className="domain-manage-tip">
                                  选中规则：{publishDistributionProfile.name}
                                </div>
                              )}
                            </div>
                            {hasUpcomingPublishedPlan ? (
                              <div className="distribution-countdown">
                                <strong>
                                  距离执行：{formatCountdown(countdownSeconds)}
                                </strong>
                                <span>
                                  执行时刻：{new Date(lockedExecuteMs).toLocaleString('zh-CN', { hour12: false })}
                                </span>
                                <span>执行时按当刻知识点总池结算（规则仅定义比例，不预显示点数）</span>
                              </div>
                            ) : hasLockedPlan ? (
                              <div className="domain-manage-tip">分发计划已到执行时刻，正在等待系统结算。</div>
                            ) : (
                              <div className="domain-manage-tip">当前未发布分发计划，可设置执行时刻后发布。</div>
                            )}
                          </div>

                          <div className="distribution-summary-grid distribution-summary-grid-wide">
                            <div className="distribution-summary-item">
                              <span>分发范围</span>
                              <strong>{distributionRule.distributionScope === 'partial' ? `部分 ${scopePercent.toFixed(2)}%` : '全部 100%'}</strong>
                            </div>
                            <div className="distribution-summary-item">
                              <span>未分配比例</span>
                              <strong>{unallocatedPercent.toFixed(2)}%</strong>
                            </div>
                            <div className="distribution-summary-item">
                              <span>结转规则</span>
                              <strong>未分配比例自动结转</strong>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="domain-manage-tip">你可以查看分发汇总，但仅域主可编辑分发规则。</div>
                      )}
                    </>
                  )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        </div>
        <button
          type="button"
          className="domain-right-dock-toggle"
          onClick={() => setIsDomainInfoDockExpanded((prev) => !prev)}
          aria-label={isDomainInfoDockExpanded ? '收起知识域面板' : '展开知识域面板'}
          title={isDomainInfoDockExpanded ? '收起知识域面板' : '展开知识域面板'}
        >
          <Info size={16} />
          <span className="domain-right-dock-label">知识域</span>
          {isDomainInfoDockExpanded ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {isDistributionRuleModalOpen && distributionState.canEdit && createPortal(
          <div
            className="distribution-rule-modal-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setIsDistributionRuleModalOpen(false);
              }
            }}
          >
            <div className="distribution-rule-modal">
              <div className="distribution-rule-modal-header">
                <strong>知识域知识点分发规则工作台</strong>
                <div className="distribution-modal-header-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    onClick={saveDistributionSettings}
                    disabled={distributionState.saving}
                  >
                    {distributionState.saving ? '保存中...' : '保存规则配置'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => setIsDistributionRuleModalOpen(false)}
                  >
                    关闭
                  </button>
                </div>
              </div>
              <div className="distribution-rule-modal-body">
                <div className="distribution-rule-sidebar">
                  <div className="distribution-subtitle">规则列表</div>
                  <div className="distribution-rule-list">
                    {distributionProfiles.map((profile) => (
                      <button
                        key={profile.profileId}
                        type="button"
                        className={`distribution-rule-list-item ${profile.profileId === activeDistributionRuleId ? 'active' : ''}`}
                        onClick={() => setActiveDistributionRule(profile.profileId)}
                      >
                        <span>{profile.name}</span>
                        {profile.profileId === activeDistributionRuleId ? <em>当前编辑</em> : null}
                      </button>
                    ))}
                  </div>
                  <div className="distribution-rule-create">
                    <input
                      type="text"
                      className="domain-admin-search-input"
                      placeholder="输入新规则名称"
                      value={newDistributionRuleName}
                      onChange={(e) => setNewDistributionRuleName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-small btn-success"
                      onClick={createDistributionRuleProfileItem}
                    >
                      新建规则
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={removeActiveDistributionRule}
                      disabled={distributionProfiles.length <= 1}
                    >
                      删除当前规则
                    </button>
                  </div>
                </div>

                <div className="distribution-rule-main">

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">分发范围</div>
                    <div className="distribution-input-row">
                      <span>范围模式</span>
                      <select
                        value={distributionRule.distributionScope === 'partial' ? 'partial' : 'all'}
                        onChange={(e) => updateDistributionRule((prev) => ({
                          ...prev,
                          distributionScope: e.target.value === 'partial' ? 'partial' : 'all'
                        }))}
                      >
                        {DISTRIBUTION_SCOPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    {distributionRule.distributionScope === 'partial' && (
                      <div className="distribution-input-row">
                        <span>部分分发比例</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={scopePercent}
                          onChange={(e) => updateDistributionRule((prev) => ({
                            ...prev,
                            distributionPercent: clampPercent(e.target.value, 100)
                          }))}
                        />
                      </div>
                    )}
                    <div className="distribution-progress-wrap">
                      <div className="distribution-progress-track">
                        <div
                          className="distribution-progress-fill scope"
                          style={{ width: `${Math.max(0, Math.min(100, scopePercent))}%` }}
                        />
                      </div>
                      <span>{`本次参与分发比例：${scopePercent.toFixed(2)}%`}</span>
                    </div>
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">规则名称</div>
                    <div className="distribution-input-row">
                      <span>规则名称</span>
                      <input
                        type="text"
                        value={activeDistributionProfile?.name || ''}
                        onChange={(e) => updateActiveDistributionRuleName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="distribution-input-row">
                    <span>域主分配比例</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={distributionRule.masterPercent}
                      onChange={(e) => updateDistributionRule((prev) => ({ ...prev, masterPercent: clampPercent(e.target.value, 10) }))}
                    />
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">固定规则说明</div>
                    <div className="distribution-fixed-row">
                      <span>固定规则：盟贡献同步比例</span>
                      <strong>{distributionState.allianceContributionPercent.toFixed(2)}%</strong>
                      <em>{hasMasterAlliance ? `同步自熵盟「${distributionState.masterAllianceName}」` : '域主未加入熵盟，固定为 0'}</em>
                    </div>
                    <div className="distribution-fixed-row danger">
                      <span>规则 4：敌对熵盟成员</span>
                      <strong>0%</strong>
                      <em>{hasMasterAlliance ? '系统自动判定，优先级最高，不可更改' : '无熵盟时不触发敌对判定'}</em>
                    </div>
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">域内成员分配总池（当前 {currentPercentSummary.y.toFixed(2)}%）</div>
                    {effectiveAdminPercents.length === 0 ? (
                      <div className="domain-manage-tip">当前无域相可配置</div>
                    ) : effectiveAdminPercents.map((adminItem) => (
                      <div key={adminItem.userId} className="distribution-input-row">
                        <span>{adminItem.username}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={adminItem.percent}
                          onChange={(e) => {
                            const nextPercent = clampPercent(e.target.value, 0);
                            updateDistributionRule((prev) => {
                              const nextList = (prev.adminPercents || []).filter((item) => item.userId !== adminItem.userId);
                              if (nextPercent > 0) {
                                nextList.push({
                                  userId: adminItem.userId,
                                  username: adminItem.username,
                                  percent: nextPercent
                                });
                              }
                              return { ...prev, adminPercents: nextList };
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">指定用户分配比例与用户黑名单</div>
                    <div className="domain-manage-tip">黑名单跟随域主，域主变更时会自动重置</div>
                    <input
                      type="text"
                      className="domain-admin-search-input"
                      placeholder="搜索用户后加入指定比例或黑名单"
                      value={distributionUserKeyword}
                      onChange={(e) => setDistributionUserKeyword(e.target.value)}
                    />
                    {distributionUserSearching && <div className="domain-manage-tip">搜索中...</div>}
                    {!distributionUserSearching && distributionUserKeyword.trim() && (
                      <div className="domain-search-results">
                        {distributionUserResults.length === 0 ? (
                          <div className="domain-manage-tip">没有匹配用户</div>
                        ) : distributionUserResults.map((userItem) => (
                          <div key={userItem._id} className="domain-search-row">
                            <span className="domain-admin-name">{userItem.username}</span>
                            <div className="distribution-row-actions">
                              <button
                                type="button"
                                className="btn btn-small btn-success"
                                onClick={() => updateDistributionRule((prev) => {
                                  if ((prev.customUserPercents || []).some((item) => item.userId === userItem._id)) {
                                    return prev;
                                  }
                                  return {
                                    ...prev,
                                    customUserPercents: [...(prev.customUserPercents || []), {
                                      userId: userItem._id,
                                      username: userItem.username,
                                      percent: 0
                                    }]
                                  };
                                })}
                              >
                                加入指定用户池
                              </button>
                              <button
                                type="button"
                                className="btn btn-small btn-danger"
                                onClick={() => updateDistributionRule((prev) => {
                                  if ((prev.blacklistUsers || []).some((item) => item.userId === userItem._id)) {
                                    return prev;
                                  }
                                  return {
                                    ...prev,
                                    blacklistUsers: [...(prev.blacklistUsers || []), {
                                      userId: userItem._id,
                                      username: userItem.username
                                    }]
                                  };
                                })}
                              >
                                加黑
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(distributionRule.customUserPercents || []).map((item) => (
                      <div key={item.userId} className="distribution-input-row">
                        <span>{item.username || item.userId}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={item.percent}
                          onChange={(e) => {
                            const nextPercent = clampPercent(e.target.value, 0);
                            updateDistributionRule((prev) => ({
                              ...prev,
                              customUserPercents: (prev.customUserPercents || []).map((row) => (
                                row.userId === item.userId ? { ...row, percent: nextPercent } : row
                              ))
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            customUserPercents: (prev.customUserPercents || []).filter((row) => row.userId !== item.userId)
                          }))}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    {(distributionRule.blacklistUsers || []).map((item) => (
                      <div key={item.userId} className="distribution-tag-row danger">
                        <span>{item.username || item.userId}</span>
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            blacklistUsers: (prev.blacklistUsers || []).filter((row) => row.userId !== item.userId)
                          }))}
                        >
                          取消黑名单
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-input-row">
                      <span>非敌对熵盟成员分配总池</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={distributionRule.nonHostileAlliancePercent}
                        disabled={!hasMasterAlliance}
                        onChange={(e) => updateDistributionRule((prev) => ({ ...prev, nonHostileAlliancePercent: clampPercent(e.target.value, 0) }))}
                      />
                    </div>
                    {!hasMasterAlliance && (
                      <div className="domain-manage-tip">域主未加入熵盟，非敌对熵盟相关分配已禁用</div>
                    )}
                    <div className="distribution-input-row">
                      <span>无熵盟用户分配总池</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={distributionRule.noAlliancePercent}
                        onChange={(e) => updateDistributionRule((prev) => ({ ...prev, noAlliancePercent: clampPercent(e.target.value, 0) }))}
                      />
                    </div>
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">指定熵盟成员分配池与熵盟黑名单</div>
                    <div className="domain-manage-tip">熵盟黑名单同样跟随域主，和允许池冲突时按“禁止”优先</div>
                    {hasMasterAlliance ? (
                      <>
                        <input
                          type="text"
                          className="domain-admin-search-input"
                          placeholder="搜索熵盟后加入指定比例或黑名单"
                          value={distributionAllianceKeyword}
                          onChange={(e) => setDistributionAllianceKeyword(e.target.value)}
                        />
                        {distributionAllianceSearching && <div className="domain-manage-tip">搜索中...</div>}
                        {!distributionAllianceSearching && distributionAllianceKeyword.trim() && (
                          <div className="domain-search-results">
                            {distributionAllianceResults.length === 0 ? (
                              <div className="domain-manage-tip">没有匹配熵盟</div>
                            ) : distributionAllianceResults.map((allianceItem) => (
                              <div key={allianceItem._id} className="domain-search-row">
                                <span className="domain-admin-name">{allianceItem.name}</span>
                                <div className="distribution-row-actions">
                                  <button
                                    type="button"
                                    className="btn btn-small btn-success"
                                    onClick={() => updateDistributionRule((prev) => {
                                      if ((prev.specificAlliancePercents || []).some((item) => item.allianceId === allianceItem._id)) {
                                        return prev;
                                      }
                                      return {
                                        ...prev,
                                        specificAlliancePercents: [...(prev.specificAlliancePercents || []), {
                                          allianceId: allianceItem._id,
                                          allianceName: allianceItem.name,
                                          percent: 0
                                        }]
                                      };
                                    })}
                                  >
                                    加入指定熵盟池
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-small btn-danger"
                                    onClick={() => updateDistributionRule((prev) => {
                                      if ((prev.blacklistAlliances || []).some((item) => item.allianceId === allianceItem._id)) {
                                        return prev;
                                      }
                                      return {
                                        ...prev,
                                        blacklistAlliances: [...(prev.blacklistAlliances || []), {
                                          allianceId: allianceItem._id,
                                          allianceName: allianceItem.name
                                        }]
                                      };
                                    })}
                                  >
                                    加黑
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="domain-manage-tip">域主未加入熵盟，指定熵盟分配池自动禁用</div>
                    )}

                    {hasMasterAlliance && (distributionRule.specificAlliancePercents || []).map((item) => (
                      <div key={item.allianceId} className="distribution-input-row">
                        <span>{item.allianceName || item.allianceId}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={item.percent}
                          onChange={(e) => {
                            const nextPercent = clampPercent(e.target.value, 0);
                            updateDistributionRule((prev) => ({
                              ...prev,
                              specificAlliancePercents: (prev.specificAlliancePercents || []).map((row) => (
                                row.allianceId === item.allianceId ? { ...row, percent: nextPercent } : row
                              ))
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            specificAlliancePercents: (prev.specificAlliancePercents || []).filter((row) => row.allianceId !== item.allianceId)
                          }))}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    {(distributionRule.blacklistAlliances || []).map((item) => (
                      <div key={item.allianceId} className="distribution-tag-row danger">
                        <span>{item.allianceName || item.allianceId}</span>
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            blacklistAlliances: (prev.blacklistAlliances || []).filter((row) => row.allianceId !== item.allianceId)
                          }))}
                        >
                          取消黑名单
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">规则结果可视化与冲突解释</div>
                    <div className="distribution-progress-wrap">
                      <div className="distribution-progress-track">
                        <div
                          className={`distribution-progress-fill ${currentPercentSummary.total > 100 ? 'over' : ''}`}
                          style={{ width: `${Math.max(0, Math.min(100, currentPercentSummary.total))}%` }}
                        />
                      </div>
                      <span>{`分配占比 ${currentPercentSummary.total.toFixed(2)}%，未分配 ${unallocatedPercent.toFixed(2)}% 将结转`}</span>
                    </div>
                    <div className="distribution-visual-metrics">
                      <div className="distribution-metric-card">
                        <span>分发范围比例</span>
                        <strong>{scopePercent.toFixed(2)}%</strong>
                      </div>
                      <div className="distribution-metric-card">
                        <span>总分配占比</span>
                        <strong>{currentPercentSummary.total.toFixed(2)}%</strong>
                      </div>
                      <div className="distribution-metric-card">
                        <span>未分配比例</span>
                        <strong>{unallocatedPercent.toFixed(2)}%</strong>
                      </div>
                    </div>
                    <div className="distribution-notes">
                      {blockedRuleNotes.map((note) => (
                        <div key={note} className="domain-manage-tip">{note}</div>
                      ))}
                      {conflictMessages.length === 0 ? (
                        <div className="domain-manage-tip">当前未发现允许/禁止规则冲突</div>
                      ) : conflictMessages.map((message) => (
                        <div key={message} className="domain-manage-error">{message}</div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveDistributionSettings}
                    disabled={distributionState.saving}
                  >
                    {distributionState.saving ? '保存中...' : '保存当前规则'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        <button className="exit-domain-btn" onClick={onExit}>
          离开知识域
        </button>
    </div>
  );
};

export default KnowledgeDomainScene;
