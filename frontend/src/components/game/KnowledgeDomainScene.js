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
  const [activeTab, setActiveTab] = useState('info');
  const [domainAdminState, setDomainAdminState] = useState({
    loading: false,
    error: '',
    canView: false,
    canEdit: false,
    canResign: false,
    resignPending: false,
    domainMaster: null,
    domainAdmins: []
  });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [invitingUsername, setInvitingUsername] = useState('');
  const [removingAdminId, setRemovingAdminId] = useState('');
  const [isSubmittingResign, setIsSubmittingResign] = useState(false);
  const [manageFeedback, setManageFeedback] = useState('');

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
        setDomainAdminState((prev) => ({
          ...prev,
          loading: false,
          canView: false,
          canEdit: false,
          canResign: false,
          resignPending: false,
          error: getApiError(parsed, '获取管理员列表失败')
        }));
        return;
      }

      setDomainAdminState({
        loading: false,
        error: '',
        canView: !!data.canView,
        canEdit: !!data.canEdit,
        canResign: !!data.canResign,
        resignPending: !!data.resignPending,
        domainMaster: data.domainMaster || null,
        domainAdmins: data.domainAdmins || []
      });
    } catch (error) {
      setDomainAdminState((prev) => ({
        ...prev,
        loading: false,
        canResign: false,
        resignPending: false,
        error: `获取管理员列表失败: ${error.message}`
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
    } catch (error) {
      setManageFeedback(`移除管理员失败: ${error.message}`);
    } finally {
      setRemovingAdminId('');
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
    fetchDomainAdmins(true);
  }, [isVisible, node?._id]);

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

      <div
        className="domain-info-panel"
        style={{
          opacity: displayOpacity,
          transform: `translateY(${(1 - displayOpacity) * -20}px)`
        }}
      >
        <div className="domain-tabs">
          <button
            type="button"
            className={`domain-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => setActiveTab('info')}
          >
            知识域信息
          </button>
          <button
            type="button"
            className={`domain-tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('manage');
              fetchDomainAdmins(false);
            }}
          >
            管理知识域
          </button>
        </div>

        {activeTab === 'info' ? (
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
            <h3 className="domain-manage-title">知识域管理员</h3>

            {domainAdminState.loading && <div className="domain-manage-tip">加载中...</div>}
            {!domainAdminState.loading && domainAdminState.error && (
              <div className="domain-manage-error">{domainAdminState.error}</div>
            )}

            {!domainAdminState.loading && !domainAdminState.error && !domainAdminState.canView && (
              <div className="domain-manage-tip">你没有权限查看该知识域管理员列表</div>
            )}

            {domainAdminState.canView && (
              <>
                {manageFeedback && <div className="domain-manage-feedback">{manageFeedback}</div>}

                <div className="domain-admins-section">
                  <div className="domain-admins-subtitle">域主</div>
                  <div className="domain-admin-row domain-master-row">
                    <span className="domain-admin-name">{domainAdminState.domainMaster?.username || '未设置'}</span>
                    <span className="domain-admin-badge master">域主</span>
                  </div>
                </div>

                <div className="domain-admins-section">
                  <div className="domain-admins-subtitle">管理员列表</div>
                  {domainAdminState.domainAdmins.length === 0 ? (
                    <div className="domain-manage-tip">当前暂无其他管理员</div>
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
                    </div>
                  )}
                </div>

                {domainAdminState.canEdit ? (
                  <div className="domain-admin-invite">
                    <div className="domain-admins-subtitle">邀请普通用户成为管理员</div>
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
                    <div className="domain-manage-tip">你是该知识域管理员，可查看但不可编辑管理员名单</div>
                    {domainAdminState.canResign && (
                      <button
                        type="button"
                        className="btn btn-small btn-warning"
                        onClick={applyResignDomainAdmin}
                        disabled={isSubmittingResign || domainAdminState.resignPending}
                      >
                        {domainAdminState.resignPending
                          ? '卸任申请待处理'
                          : (isSubmittingResign ? '提交中...' : '申请卸任管理员')}
                      </button>
                    )}
                    {domainAdminState.resignPending && (
                      <div className="domain-manage-tip">已提交卸任申请，等待域主处理（3天超时自动同意）</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button className="exit-domain-btn" onClick={onExit}>
          离开知识域
        </button>
      </div>
    </div>
  );
};

export default KnowledgeDomainScene;
