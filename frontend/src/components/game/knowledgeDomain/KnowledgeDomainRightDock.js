import React from 'react';
import { Info, ChevronLeft, ChevronRight } from 'lucide-react';
import { resolveAvatarSrc } from '../../../app/appShared';

const DomainAdminPermissionModal = ({
  open,
  canEdit,
  closeDomainAdminPermissionModal,
  isSavingDomainAdminPermissions,
  domainAdminState,
  domainAdminPermissionDraftMap,
  toggleDomainAdminPermission,
  saveDomainAdminPermissions,
  domainAdminPermissionDirty
}) => {
  if (!open || !canEdit) return null;

  return (
    <div className="domain-admin-permission-modal-backdrop" onClick={closeDomainAdminPermissionModal}>
      <div className="domain-admin-permission-modal" onClick={(event) => event.stopPropagation()}>
        <div className="domain-admin-permission-modal-header">
          <div>
            <div className="domain-admins-subtitle">域相权限设置</div>
            <div className="domain-manage-tip">勾选后立即纳入对应能力；百科审核权限决定该域相是否参与百科共审。</div>
          </div>
          <button
            type="button"
            className="btn btn-small btn-secondary"
            onClick={closeDomainAdminPermissionModal}
            disabled={isSavingDomainAdminPermissions}
          >
            关闭
          </button>
        </div>
        <div className="domain-admin-permission-modal-body">
          {domainAdminState.domainAdmins.map((adminUser) => (
            <div key={`permission-${adminUser._id}`} className="domain-admin-permission-row">
              <div className="domain-admin-permission-user">{adminUser.username}</div>
              <div className="domain-admin-permission-grid">
                {(Array.isArray(domainAdminState.availablePermissions) ? domainAdminState.availablePermissions : []).map((permissionItem) => {
                  const permissionKey = typeof permissionItem?.key === 'string' ? permissionItem.key : '';
                  const currentKeys = Array.isArray(domainAdminPermissionDraftMap?.[adminUser._id]) ? domainAdminPermissionDraftMap[adminUser._id] : [];
                  return (
                    <label key={`${adminUser._id}-${permissionKey}`} className="domain-admin-permission-option">
                      <input
                        type="checkbox"
                        checked={currentKeys.includes(permissionKey)}
                        onChange={() => toggleDomainAdminPermission(adminUser._id, permissionKey)}
                      />
                      <span>{permissionItem?.label || permissionKey}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="domain-admin-permission-modal-actions">
          <button
            type="button"
            className="btn btn-small btn-secondary"
            onClick={closeDomainAdminPermissionModal}
            disabled={isSavingDomainAdminPermissions}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={saveDomainAdminPermissions}
            disabled={!domainAdminPermissionDirty || isSavingDomainAdminPermissions}
          >
            {isSavingDomainAdminPermissions ? '保存中...' : '保存权限'}
          </button>
        </div>
      </div>
    </div>
  );
};

const KnowledgeDomainRightDock = ({
  dock,
  infoPanel,
  defensePanel,
  adminPanel,
  distributionPanel
}) => {
  if (!dock.showRightDock) return null;

  const {
    activeTab,
    showManageTab,
    isDomainInfoDockExpanded,
    setActiveTab,
    setIsDomainInfoDockExpanded,
    refreshDomainInfoPanel,
    fetchDomainAdmins,
    fetchDistributionSettings
  } = dock;
  const {
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
  } = infoPanel;
  const {
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
  } = defensePanel;
  const {
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
  } = adminPanel;
  const {
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
  } = distributionPanel;

  return (
    <div className={`domain-right-dock ${isDomainInfoDockExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="domain-info-panel">
        <div className="domain-tabs">
          <button
            type="button"
            className={`domain-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('info');
              if (isDomainInfoDockExpanded) {
                refreshDomainInfoPanel(true);
              }
            }}
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
            <div className="domain-title-row">
              <h2 className="domain-title">{infoPanelDomainNode?.name || '未命名知识域'}</h2>
              <button
                type="button"
                className="btn btn-small btn-secondary domain-info-refresh-btn"
                onClick={() => refreshDomainInfoPanel(false)}
                disabled={isRefreshingInfoPanel}
              >
                {isRefreshingInfoPanel ? '刷新中...' : '刷新'}
              </button>
            </div>
            {infoPanelError && <div className="domain-manage-error">{infoPanelError}</div>}
            {infoPanelDomainNode?.description && <p className="domain-description">{`概述：${infoPanelDomainNode.description}`}</p>}
            <div className="domain-stats">
              <div className="stat-item">
                <span className="stat-label">知识点</span>
                <span className="stat-value">{Number.isFinite(infoKnowledgePointValue) ? infoKnowledgePointValue.toFixed(2) : '--'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">繁荣度</span>
                <span className="stat-value">{Number.isFinite(infoProsperityValue) ? Math.round(infoProsperityValue) : '--'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">内容分数</span>
                <span className="stat-value">{Number.isFinite(infoContentScoreValue) ? infoContentScoreValue.toFixed(2) : '--'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">收藏人数</span>
                <span className="stat-value">{Number.isFinite(infoFavoriteUserCountValue) ? Math.max(0, Math.round(infoFavoriteUserCountValue)) : '--'}</span>
              </div>
            </div>
            <div className="domain-managers-card">
              <div className="domain-manager-section">
                <div className="domain-admins-subtitle">域主</div>
                <div className="domain-manager-avatar-row">
                  {displayMaster ? (
                    <button
                      type="button"
                      className="domain-manager-avatar-item master"
                      title={`域主：${displayMaster.username || '未命名用户'}`}
                      onClick={(event) => openUserCard(displayMaster, event)}
                    >
                      <img
                        src={resolveAvatarSrc(displayMaster.avatar)}
                        alt={displayMaster.username || '域主'}
                        className="domain-manager-avatar-img"
                      />
                      <span className="domain-manager-name">{displayMaster.username || '未设置域主'}</span>
                    </button>
                  ) : (
                    <div className="domain-manage-tip">暂无域主信息</div>
                  )}
                </div>
              </div>
              <div className="domain-manager-section">
                <div className="domain-admins-subtitle">域相</div>
                <div className="domain-manager-avatar-row admins">
                  {displayAdmins.length > 0 ? displayAdmins.map((adminUser) => (
                    <button
                      type="button"
                      key={adminUser._id}
                      className="domain-manager-avatar-item"
                      title={`域相：${adminUser.username || '未命名用户'}`}
                      onClick={(event) => openUserCard(adminUser, event)}
                    >
                      <img
                        src={resolveAvatarSrc(adminUser.avatar)}
                        alt={adminUser.username || '域相'}
                        className="domain-manager-avatar-img"
                      />
                      <span className="domain-manager-name">{adminUser.username || '未命名'}</span>
                    </button>
                  )) : (
                    <div className="domain-manage-tip">暂无域相</div>
                  )}
                </div>
              </div>
            </div>

            {showDefenseManagerCard && (
              <div className="domain-defense-card">
                <div className="domain-admins-subtitle">城区守备建筑</div>
                {defenseLayoutState.loading && <div className="domain-manage-tip">加载城防配置中...</div>}
                {!defenseLayoutState.loading && (
                  <div className="domain-manage-tip">
                    当前建筑 {defenseBuildings.length} / {defenseLayoutState.maxBuildings}
                  </div>
                )}
                <div className="domain-manage-tip">
                  {defenseLayoutState.buildMode
                    ? '请先退出建造模式，再点击承口/启口进入战场布置。'
                    : '点击城区上方承口或下方启口，可直接进入战场布置。'}
                </div>
                {defenseLayoutState.error && <div className="domain-manage-error">{defenseLayoutState.error}</div>}
                {defenseLayoutState.feedback && <div className="domain-manage-feedback">{defenseLayoutState.feedback}</div>}
                {defenseLayoutState.buildMode && (
                  <div className="domain-manage-tip">
                    <label htmlFor="domainDefenseBuildingTypeSelect">
                      建筑类型：
                      <select
                        id="domainDefenseBuildingTypeSelect"
                        className="edit-input"
                        style={{ marginLeft: 8, minWidth: 180 }}
                        value={defenseLayoutState.selectedBuildingTypeId}
                        onChange={(event) => updateSelectedBuildingType(event.target.value)}
                      >
                        {buildingCatalog.length === 0 && <option value="">暂无可用建筑类型</option>}
                        {buildingCatalog.map((item) => {
                          const used = buildingTypeUsageMap.get(item.buildingTypeId) || 0;
                          return (
                            <option key={item.buildingTypeId} value={item.buildingTypeId}>
                              {`${item.name}（${used}/${item.initialCount}）`}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>
                )}
                <div className="domain-defense-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    onClick={toggleBuildMode}
                  >
                    {defenseLayoutState.buildMode ? '退出建造模式' : '建造'}
                  </button>
                  {defenseLayoutState.buildMode && (
                    <>
                      <button
                        type="button"
                        className="btn btn-small btn-success"
                        onClick={addDefenseBuilding}
                        disabled={!canAddDefenseBuilding}
                      >
                        新增建筑
                      </button>
                      <button
                        type="button"
                        className="btn btn-small btn-warning"
                        onClick={saveDefenseLayout}
                        disabled={defenseLayoutState.saving}
                      >
                        {defenseLayoutState.saving ? '保存中...' : '保存配置'}
                      </button>
                    </>
                  )}
                </div>

                {defenseLayoutState.buildMode && selectedDefenseBuilding && (
                  <div className="domain-defense-selected-card">
                    <div className="domain-manage-tip">
                      当前选中：{buildingTypeMap.get(selectedDefenseBuilding.buildingTypeId)?.name || selectedDefenseBuilding.name || '未命名建筑'}
                    </div>
                    <div className="domain-defense-actions">
                      <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={setIntelOnSelectedBuilding}
                      >
                        存放情报文件
                      </button>
                      <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={removeSelectedDefenseBuilding}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
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
                              {domainAdminState.domainAdmins.map((adminUser) => {
                                const permissionLabels = normalizePermissionLabels(adminUser);
                                return (
                                  <div key={adminUser._id} className="domain-admin-row">
                                    <div className="domain-admin-row-main">
                                      <span className="domain-admin-name">{adminUser.username}</span>
                                      <div className="domain-admin-permission-badges">
                                        {permissionLabels.length > 0 ? permissionLabels.map((label) => (
                                          <span key={`${adminUser._id}-${label}`} className="domain-admin-badge readonly">{label}</span>
                                        )) : (
                                          <span className="domain-admin-badge readonly">未授予额外权限</span>
                                        )}
                                      </div>
                                    </div>
                                    {domainAdminState.canEdit ? (
                                      <div className="domain-admin-row-actions">
                                        <button
                                          type="button"
                                          className="btn btn-small btn-danger"
                                          onClick={() => removeDomainAdmin(adminUser._id)}
                                          disabled={removingAdminId === adminUser._id}
                                        >
                                          {removingAdminId === adminUser._id ? '移除中...' : '移除'}
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
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
                          {domainAdminState.canEdit && domainAdminState.domainAdmins.length > 0 && (
                            <div className="domain-admin-permission-actions">
                              <div className="domain-manage-tip">域主可在权限弹窗中统一决定每个域相是否拥有“百科审核”“承口/启口查看”等权限。</div>
                              <button
                                type="button"
                                className="btn btn-small btn-primary"
                                onClick={openDomainAdminPermissionModal}
                              >
                                权限设置
                              </button>
                            </div>
                          )}
                        </div>

                        {domainAdminState.canEdit ? (
                          <div className="domain-admin-invite">
                            <div className="domain-admins-subtitle">邀请普通用户成为域相</div>
                            <div className="domain-admin-search-row">
                              <div className="domain-admin-search-input-wrap">
                                <input
                                  type="text"
                                  className={`domain-admin-search-input ${searchKeyword.trim() ? 'has-clear' : ''}`}
                                  placeholder="输入用户名后回车或点击搜索"
                                  value={searchKeyword}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setSearchKeyword(nextValue);
                                    setManageFeedback('');
                                    setHasSearchedAdminUsers(false);
                                    if (!nextValue.trim()) {
                                      setSearchResults([]);
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      searchDomainAdminUsers();
                                    }
                                  }}
                                />
                                {searchKeyword.trim() && (
                                  <button
                                    type="button"
                                    className="domain-admin-search-clear"
                                    onClick={clearDomainAdminSearch}
                                    disabled={isSearchingUsers}
                                    aria-label="清空搜索"
                                  >
                                    X
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                className="btn btn-small btn-secondary domain-admin-search-btn"
                                onClick={searchDomainAdminUsers}
                                disabled={isSearchingUsers || !searchKeyword.trim()}
                              >
                                {isSearchingUsers ? '搜索中...' : '搜索'}
                              </button>
                            </div>
                            {isSearchingUsers && <div className="domain-manage-tip">搜索中...</div>}
                            {!isSearchingUsers && hasSearchedAdminUsers && (
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

                    <DomainAdminPermissionModal
                      open={isDomainAdminPermissionModalOpen}
                      canEdit={domainAdminState.canEdit}
                      closeDomainAdminPermissionModal={closeDomainAdminPermissionModal}
                      isSavingDomainAdminPermissions={isSavingDomainAdminPermissions}
                      domainAdminState={domainAdminState}
                      domainAdminPermissionDraftMap={domainAdminPermissionDraftMap}
                      toggleDomainAdminPermission={toggleDomainAdminPermission}
                      saveDomainAdminPermissions={saveDomainAdminPermissions}
                      domainAdminPermissionDirty={domainAdminPermissionDirty}
                    />

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
                                    <div className="distribution-subtitle">分发发布流程：选规则 -&gt; 设时间 -&gt; 发布（发布后不可撤回）</div>
                                    <div className="distribution-publish-row">
                                      <label>发布规则</label>
                                      <select
                                        value={publishDistributionRuleId}
                                        onChange={(event) => setDistributionState((prev) => ({
                                          ...prev,
                                          publishRuleId: event.target.value,
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
                                        onChange={(event) => setDistributionState((prev) => ({
                                          ...prev,
                                          publishExecuteAt: event.target.value,
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
        onClick={() => {
          const nextExpanded = !isDomainInfoDockExpanded;
          setIsDomainInfoDockExpanded(nextExpanded);
          if (nextExpanded && activeTab === 'info') {
            refreshDomainInfoPanel(true);
          }
        }}
        aria-label={isDomainInfoDockExpanded ? '收起知识域面板' : '展开知识域面板'}
        title={isDomainInfoDockExpanded ? '收起知识域面板' : '展开知识域面板'}
      >
        <Info size={16} />
        <span className="domain-right-dock-label">知识域</span>
        {isDomainInfoDockExpanded ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </div>
  );
};

export default KnowledgeDomainRightDock;
