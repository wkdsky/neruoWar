import React from 'react';
import { Bell, Home, Layers, MapPin, MessagesSquare, Shield, Star, Users } from 'lucide-react';
import './AppShell.css';
import {
    avatarMap,
    formatCountdownText,
    getNodeDisplayName,
    hexToRgba,
    isKnowledgeDetailView,
    isSenseArticleNotification,
    isTitleBattleView,
    normalizeObjectId,
    resolveAvatarSrc
} from '../../app/appShared';
import {
    SENSE_ARTICLE_ENTRY_SHORT_LABEL,
    getSenseArticleEntryActionLabel
} from '../senseArticle/senseArticleUi';
import AnnouncementPanel from '../game/AnnouncementPanel';
import ChatDockPanel from '../chat/ChatDockPanel';
import CurrentDomainPanel from '../game/CurrentDomainPanel';
import RightUtilityDock from '../game/RightUtilityDock';
import { useUserCard } from '../social/UserCardContext';

export const GameHeader = ({
    headerRef,
    isKnowledgeDomainActive,
    isCompact,
    profession,
    username,
    userAvatar,
    headerLevel,
    headerExpProgress,
    headerExperience,
    headerExpTarget,
    headerArmyCount,
    headerKnowledgeBalance,
    onProfileClick,
    onLogout,
    notificationsWrapperRef,
    onToggleNotifications,
    notificationBadgeCount,
    notificationsPanel,
    relatedDomainsWrapperRef,
    onToggleRelatedDomains,
    relatedDomainCount,
    relatedDomainsPanel,
    onHomeClick,
    onAllianceClick,
    isAdmin,
    militaryMenuWrapperRef,
    onToggleMilitaryMenu,
    showMilitaryMenu,
    onOpenArmy,
    onOpenTrainingGround,
    onOpenEquipment,
    onOpenAdmin
}) => (
    <div ref={headerRef} className={`header ${isKnowledgeDomainActive ? 'header-knowledge-domain-active' : ''} ${isCompact ? 'header-compact' : ''}`.trim()}>
        <div className="header-content">
            <button
                type="button"
                className="header-title header-home-trigger"
                onClick={onHomeClick}
                aria-label="返回首页"
                title="返回首页"
            >
                <Home className="icon" />
                多节点策略系统
            </button>
            <div className="header-right">
                <div className="header-buttons">
                    <div className="header-action-shell">
                        <div className="user-identity-group">
                            <div
                                className="user-avatar-container"
                                onClick={onProfileClick}
                                title={profession ? `点击进入个人中心（${profession}）` : '点击进入个人中心'}
                            >
                                <img
                                    src={avatarMap[userAvatar] || avatarMap.default_male_1}
                                    alt="头像"
                                    className="user-avatar-small"
                                />
                                <div className="user-avatar-main">
                                    <div className="user-avatar-top-row">
                                        <span className="user-level-badge">{`Lv.${headerLevel}`}</span>
                                        <span className="user-avatar-username">{username}</span>
                                    </div>
                                    <div className="user-exp-row">
                                        <div className="user-exp-track">
                                            <div
                                                className="user-exp-fill"
                                                style={{ width: `${headerExpProgress}%` }}
                                            />
                                        </div>
                                        <span className="user-exp-text">{`${headerExperience}/${headerExpTarget}`}</span>
                                    </div>
                                    <div className="user-resource-row">
                                        <span className="user-resource-item">{`兵力 ${headerArmyCount}`}</span>
                                        <span className="user-resource-item">{`知识点 ${headerKnowledgeBalance.toFixed(2)}`}</span>
                                    </div>
                                </div>
                            </div>
                            <button type="button" onClick={onLogout} className="btn btn-logout">
                                退出
                            </button>
                        </div>
                    </div>
                    <div className="header-action-shell">
                        <div className="notifications-wrapper" ref={notificationsWrapperRef}>
                            <button
                                type="button"
                                className="btn btn-secondary notification-trigger-btn"
                                onClick={onToggleNotifications}
                            >
                                <Bell size={18} />
                                通知
                                {notificationBadgeCount > 0 && (
                                    <span className="notification-badge">
                                        {notificationBadgeCount > 99 ? '99+' : notificationBadgeCount}
                                    </span>
                                )}
                            </button>
                            {notificationsPanel}
                        </div>
                    </div>
                    <div className="header-action-shell">
                        <div className="related-domains-wrapper" ref={relatedDomainsWrapperRef}>
                            <button
                                type="button"
                                className="btn btn-secondary related-domains-trigger-btn"
                                onClick={onToggleRelatedDomains}
                            >
                                <Layers size={18} />
                                我的知识域
                                {relatedDomainCount > 0 && (
                                    <span className="notification-badge">
                                        {relatedDomainCount > 99 ? '99+' : relatedDomainCount}
                                    </span>
                                )}
                            </button>
                            {relatedDomainsPanel}
                        </div>
                    </div>
                    <div className="header-action-shell">
                        <button type="button" onClick={onAllianceClick} className="btn btn-secondary">
                            <Shield size={18} />
                            熵盟
                        </button>
                    </div>
                    {!isAdmin && (
                        <div className="header-action-shell">
                            <div className="military-menu-wrapper" ref={militaryMenuWrapperRef}>
                                <button
                                    type="button"
                                    className="btn btn-secondary military-menu-trigger"
                                    onClick={onToggleMilitaryMenu}
                                >
                                    <Users size={18} />
                                    军事
                                </button>
                                {showMilitaryMenu && (
                                    <div className="military-menu-panel">
                                        <button type="button" className="military-menu-item" onClick={onOpenArmy}>
                                            兵营
                                        </button>
                                        <button type="button" className="military-menu-item" onClick={onOpenTrainingGround}>
                                            训练场
                                        </button>
                                        <button type="button" className="military-menu-item" onClick={onOpenEquipment}>
                                            装备库
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {isAdmin && (
                        <div className="header-action-shell">
                            <button type="button" onClick={onOpenAdmin} className="btn btn-warning">
                                管理员面板
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
);

export const RelatedDomainsPanel = ({
    showRelatedDomainsPanel,
    relatedDomainsData,
    domainMasterDomains,
    domainAdminDomains,
    favoriteDomains,
    recentDomains,
    favoriteDomainSet,
    favoriteActionDomainId,
    onRefresh,
    onOpenDomain,
    onToggleFavorite,
    formatDomainKnowledgePoint
}) => {
    if (!showRelatedDomainsPanel) return null;

    const renderSection = (title, domainList, emptyText, sectionType = 'default') => (
        <div className="related-domain-section">
            <div className="related-domain-section-title">
                <span>{title}</span>
                <span className="related-domain-count">{domainList.length}</span>
            </div>
            {domainList.length === 0 ? (
                <div className="related-domain-empty">{emptyText}</div>
            ) : (
                <div className="related-domain-list">
                    {domainList.map((domain, index) => {
                        const domainId = normalizeObjectId(domain?._id);
                        const isFavorite = favoriteDomainSet.has(domainId);
                        const isUpdatingFavorite = favoriteActionDomainId === domainId;
                        const isTitleOnlySection = sectionType === 'master_title'
                            || sectionType === 'admin_title'
                            || sectionType === 'title_only';
                        const titleOnlyName = String(domain?.name || '').trim() || '未命名知识域';
                        const relatedDomainName = sectionType === 'recent'
                            ? ((typeof domain?.recentVisitDisplayName === 'string' && domain.recentVisitDisplayName.trim())
                                ? domain.recentVisitDisplayName.trim()
                                : getNodeDisplayName(domain))
                            : (isTitleOnlySection ? titleOnlyName : getNodeDisplayName(domain));
                        const domainKey = sectionType === 'recent'
                            ? `${title}-${domainId}-${domain?.recentVisitMode || 'title'}-${domain?.recentVisitSenseId || ''}-${domain?.visitedAt || index}`
                            : `${title}-${domainId}`;
                        return (
                            <div key={domainKey} className="related-domain-item">
                                <button
                                    type="button"
                                    className="related-domain-link"
                                    onClick={() => onOpenDomain(domain, sectionType)}
                                >
                                    <span className="related-domain-name">{relatedDomainName}</span>
                                    <span className="related-domain-meta">{formatDomainKnowledgePoint(domain)}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`related-domain-fav-btn ${isFavorite ? 'active' : ''}`}
                                    onClick={() => onToggleFavorite(domainId)}
                                    disabled={isUpdatingFavorite}
                                    title={isFavorite ? '取消收藏' : '加入收藏'}
                                >
                                    <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <div className="related-domains-panel">
            <div className="related-domains-header">
                <h3>与我相关的知识域</h3>
                <button
                    type="button"
                    className="related-domains-refresh-btn"
                    onClick={onRefresh}
                    disabled={relatedDomainsData.loading}
                >
                    {relatedDomainsData.loading ? '刷新中...' : '刷新'}
                </button>
            </div>
            <div className="related-domains-body">
                {relatedDomainsData.loading && <div className="related-domain-empty">加载中...</div>}
                {!relatedDomainsData.loading && relatedDomainsData.error && (
                    <div className="related-domains-error">{relatedDomainsData.error}</div>
                )}
                {renderSection('作为域主', domainMasterDomains, '当前没有作为域主的知识域', 'title_only')}
                {renderSection('作为域相', domainAdminDomains, '当前没有域相身份的知识域', 'title_only')}
                {renderSection('收藏的知识域', favoriteDomains, '暂无收藏，点击右侧星标可收藏')}
                {renderSection('最近访问的知识域', recentDomains, '暂无访问记录', 'recent')}
            </div>
        </div>
    );
};

export const UnifiedRightDock = ({
    showKnowledgeDomain,
    isTransitioningToDomain,
    view,
    currentTitleDetail,
    currentNodeDetail,
    isAnnouncementDockExpanded,
    setIsAnnouncementDockExpanded,
    announcementDockTab,
    setAnnouncementDockTab,
    isChatDockExpanded,
    setIsChatDockExpanded,
    chatBadgeCount,
    chatPanelProps,
    isMarkingAnnouncementsRead,
    announcementUnreadCount,
    markAnnouncementNotificationsRead,
    allianceAnnouncements,
    systemAnnouncements,
    handleHomeAnnouncementClick,
    isLocationDockExpanded,
    setIsLocationDockExpanded,
    travelStatus,
    currentLocationNodeDetail,
    userLocation,
    handleRefreshLocationNodeDetail,
    isRefreshingLocationDetail,
    formatTravelSeconds,
    handleOpenTravelNode,
    stopTravel,
    isStoppingTravel,
    siegeSupportStatuses,
    handleJumpToCurrentLocationView
}) => {
    const isKnowledgeDomainActive = showKnowledgeDomain || isTransitioningToDomain;
    const activeDetailNode = isTitleBattleView(view) ? currentTitleDetail : currentNodeDetail;
    const shouldHideDock = view === 'senseArticleEditor';
    if (shouldHideDock) return null;

    const closeAllDockPanels = () => {
        setIsAnnouncementDockExpanded(false);
        setIsChatDockExpanded(false);
        setIsLocationDockExpanded(false);
    };

    const shouldRenderLocationDock = !isKnowledgeDomainActive;

    const activeDockSectionId = isAnnouncementDockExpanded
        ? 'announcement'
        : isChatDockExpanded
            ? 'chat'
            : (shouldRenderLocationDock && isLocationDockExpanded ? 'domain' : '');

    const toggleExclusiveDock = (target) => {
        const isCurrentlyActive = activeDockSectionId === target;
        const nextAnnouncementOpen = target === 'announcement' && !isCurrentlyActive;
        const nextChatOpen = target === 'chat' && !isCurrentlyActive;
        const nextLocationOpen = target === 'domain' && !isCurrentlyActive;

        closeAllDockPanels();
        setIsAnnouncementDockExpanded(nextAnnouncementOpen);
        setIsChatDockExpanded(nextChatOpen);
        setIsLocationDockExpanded(nextLocationOpen);

        if (nextAnnouncementOpen) {
            markAnnouncementNotificationsRead();
        }
    };

    const canJumpToLocationView = Boolean(
        !travelStatus.isTraveling &&
        currentLocationNodeDetail &&
        userLocation &&
        !(isKnowledgeDetailView(view) && activeDetailNode?.name === userLocation)
    );
    const activeAnnouncements = announcementDockTab === 'alliance'
        ? allianceAnnouncements
        : systemAnnouncements;
    const locationParentLabels = (() => {
        const parentNodes = Array.isArray(currentLocationNodeDetail?.parentNodesInfo)
            ? currentLocationNodeDetail.parentNodesInfo
            : [];
        const labelsFromNodes = parentNodes
            .map((item) => (typeof item?.name === 'string' ? item.name.trim() : ''))
            .filter(Boolean);
        if (labelsFromNodes.length > 0) return labelsFromNodes;
        return (Array.isArray(currentLocationNodeDetail?.relatedParentDomains)
            ? currentLocationNodeDetail.relatedParentDomains
            : [])
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean);
    })();
    const locationChildLabels = (() => {
        const childNodes = Array.isArray(currentLocationNodeDetail?.childNodesInfo)
            ? currentLocationNodeDetail.childNodesInfo
            : [];
        const labelsFromNodes = childNodes
            .map((item) => (typeof item?.name === 'string' ? item.name.trim() : ''))
            .filter(Boolean);
        if (labelsFromNodes.length > 0) return labelsFromNodes;
        return (Array.isArray(currentLocationNodeDetail?.relatedChildDomains)
            ? currentLocationNodeDetail.relatedChildDomains
            : [])
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean);
    })();
    const locationDomainMaster = currentLocationNodeDetail?.domainMaster || null;
    const locationDomainMasterId = normalizeObjectId(locationDomainMaster?._id);
    const locationDomainAdmins = (Array.isArray(currentLocationNodeDetail?.domainAdmins)
        ? currentLocationNodeDetail.domainAdmins
        : [])
        .filter(Boolean)
        .filter((admin, index, list) => {
            const adminId = normalizeObjectId(admin?._id);
            if (!adminId) return true;
            if (adminId === locationDomainMasterId) return false;
            return list.findIndex((candidate) => normalizeObjectId(candidate?._id) === adminId) === index;
        });
    const locationDisplayMaster = (locationDomainMaster && (locationDomainMaster._id || locationDomainMaster.username))
        ? locationDomainMaster
        : null;
    const locationKnowledgePointValue = Number(currentLocationNodeDetail?.knowledgePoint?.value);
    const locationProsperityValue = Number(currentLocationNodeDetail?.prosperity);
    const locationContentScoreValue = Number(currentLocationNodeDetail?.contentScore);
    const locationFavoriteUserCountValue = Number(currentLocationNodeDetail?.favoriteUserCount);
    const locationStatItems = [
        {
            label: '知识点',
            value: Number.isFinite(locationKnowledgePointValue) ? locationKnowledgePointValue.toFixed(2) : '--'
        },
        {
            label: '繁荣度',
            value: Number.isFinite(locationProsperityValue) ? Math.round(locationProsperityValue) : '--'
        },
        {
            label: '内容分数',
            value: Number.isFinite(locationContentScoreValue) ? locationContentScoreValue.toFixed(2) : '--'
        },
        {
            label: '收藏人数',
            value: Number.isFinite(locationFavoriteUserCountValue) ? Math.max(0, Math.round(locationFavoriteUserCountValue)) : '--'
        }
    ];
    const locationTitle = currentLocationNodeDetail ? getNodeDisplayName(currentLocationNodeDetail) : '';
    const breadcrumb = locationTitle
        ? [...locationParentLabels, locationTitle]
        : [];
    const locationStatusChips = [
        { label: '已定位', tone: 'success' },
        canJumpToLocationView ? { label: '可进入', tone: 'accent' } : { label: '当前位置', tone: 'neutral' },
        { label: `父域 ${locationParentLabels.length}`, tone: 'neutral' },
        { label: `子域 ${locationChildLabels.length}`, tone: 'neutral' }
    ];
    const leaderEntries = [
        locationDisplayMaster ? {
            role: '域主',
            name: locationDisplayMaster.username || '未设置域主',
            user: locationDisplayMaster
        } : null,
        ...locationDomainAdmins.map((admin) => ({
            role: '域相',
            name: admin?.username || '未命名',
            user: admin
        }))
    ].filter(Boolean);

    // 首页与知识域详情共用同一套 utility dock 壳层，业务状态仍留在 AppShell 中管理。
    const dockSections = [
        {
            id: 'announcement',
            label: '公告',
            icon: Bell,
            badge: announcementUnreadCount > 0 ? 'dot' : null,
            active: activeDockSectionId === 'announcement',
            onToggle: () => toggleExclusiveDock('announcement'),
            panel: (
                <AnnouncementPanel
                    activeTab={announcementDockTab}
                    tabs={[
                        { id: 'system', label: '系统公告' },
                        { id: 'alliance', label: '频道公告' }
                    ]}
                    announcements={activeAnnouncements}
                    onTabChange={setAnnouncementDockTab}
                    onReadAll={() => markAnnouncementNotificationsRead()}
                    onClose={() => setIsAnnouncementDockExpanded(false)}
                    onItemClick={handleHomeAnnouncementClick}
                    readAllDisabled={isMarkingAnnouncementsRead || announcementUnreadCount <= 0}
                    isReadAllLoading={isMarkingAnnouncementsRead}
                />
            )
        },
        {
            id: 'chat',
            label: '社交',
            icon: MessagesSquare,
            badge: chatBadgeCount > 0 ? (chatBadgeCount > 99 ? '99+' : String(chatBadgeCount)) : null,
            active: activeDockSectionId === 'chat',
            panelWidth: 520,
            onToggle: () => toggleExclusiveDock('chat'),
            panel: (
                <ChatDockPanel
                    {...chatPanelProps}
                    onClose={() => setIsChatDockExpanded(false)}
                />
            )
        },
        {
            id: 'domain',
            label: travelStatus?.isTraveling ? '移动中' : '知识域',
            icon: MapPin,
            active: activeDockSectionId === 'domain',
            hidden: !shouldRenderLocationDock,
            onToggle: () => toggleExclusiveDock('domain'),
            panel: (
                <CurrentDomainPanel
                    isTraveling={Boolean(travelStatus?.isTraveling)}
                    panelTitle={travelStatus?.isTraveling ? '移动状态' : '当前位置'}
                    title={travelStatus?.isTraveling ? (travelStatus?.targetNode?.nodeName || '移动中') : locationTitle}
                    breadcrumb={breadcrumb}
                    summary={currentLocationNodeDetail?.description || ''}
                    statusChips={locationStatusChips}
                    stats={locationStatItems}
                    leaders={leaderEntries}
                    parentLabels={locationParentLabels}
                    childLabels={locationChildLabels}
                    supportStatuses={siegeSupportStatuses}
                    onOpenSupportNode={handleOpenTravelNode}
                    onClose={() => setIsLocationDockExpanded(false)}
                    onRefresh={handleRefreshLocationNodeDetail}
                    refreshDisabled={isRefreshingLocationDetail || !userLocation || userLocation === '任意' || travelStatus?.isTraveling}
                    refreshLabel={isRefreshingLocationDetail ? '刷新中...' : '刷新'}
                    primaryActionLabel={canJumpToLocationView ? '转到该知识域' : '当前所在位置'}
                    onPrimaryAction={handleJumpToCurrentLocationView}
                    primaryActionDisabled={!canJumpToLocationView}
                    emptyTitle="暂未定位到知识域"
                    emptyHint={
                        (userLocation && userLocation !== '任意')
                            ? `当前位于「${userLocation}」，可点击刷新同步上下文。`
                            : '当你进入某个知识域后，这里会展示上下文信息。'
                    }
                    travelStatus={travelStatus}
                    formatTravelSeconds={formatTravelSeconds}
                    onStopTravel={stopTravel}
                    isStoppingTravel={isStoppingTravel}
                />
            )
        }
    ];

    return <RightUtilityDock sections={dockSections} />;
};

export const DistributionParticipationPanel = ({
    view,
    showDistributionPanel,
    currentTitleDetail,
    distributionPanelState,
    closeDistributionPanel,
    userLocation,
    joinDistributionFromPanel,
    exitDistributionFromPanel
}) => {
    if (view !== 'titleDetail' || !showDistributionPanel || !currentTitleDetail) return null;

    const data = distributionPanelState.data;
    if (!data) return null;

    const activeNode = currentTitleDetail;
    const pool = data.pool || {};
    const phaseLabelMap = {
        entry_open: '可入场',
        entry_closed: '入场截止',
        settling: '结算中',
        ended: '已结束',
        none: '未开始'
    };
    const phaseLabel = phaseLabelMap[data.phase] || '进行中';
    const participationStatusText = data.joined
        ? '你已参与'
        : (data.phase === 'entry_open' ? '你未参与' : '已无法参与');
    const participationStatusClass = data.joined
        ? 'joined'
        : (data.phase === 'entry_open' ? 'not-joined' : 'locked');
    const rewardLabel = pool.rewardFrozen ? '实际获得知识点' : '当前可获得';
    const rewardText = (pool.rewardValue === null || pool.rewardValue === undefined)
        ? ''
        : Number(pool.rewardValue).toFixed(2);
    const poolUsers = Array.isArray(pool.users) ? pool.users : [];
    const canPromptMoveThenJoin = (
        !!data.requiresManualEntry &&
        !data.joined &&
        data.phase === 'entry_open' &&
        ((userLocation || '').trim() !== (activeNode?.name || '').trim())
    );
    const joinButtonDisabled = (!data.canJoin && !canPromptMoveThenJoin) || distributionPanelState.joining;

    return (
        <div className="distribution-panel-overlay">
            <div className="distribution-panel-modal">
                <button type="button" className="distribution-panel-close" onClick={closeDistributionPanel}>×</button>
                <div className="distribution-panel-title-row">
                    <h3>{`分发活动：${getNodeDisplayName(activeNode)}`}</h3>
                    <div className="distribution-panel-title-tags">
                        <span className={`distribution-panel-phase phase-${data.phase}`}>{phaseLabel}</span>
                        <span className={`distribution-panel-participation-status ${participationStatusClass}`}>{participationStatusText}</span>
                    </div>
                </div>

                {data.phase === 'entry_open' && (
                    <div className="distribution-panel-timer-row">
                        <span>{`入场截止：${formatCountdownText(data.secondsToEntryClose)}`}</span>
                        <span>{`执行倒计时：${formatCountdownText(data.secondsToExecute)}`}</span>
                    </div>
                )}
                {data.phase === 'entry_closed' && (
                    <div className="distribution-panel-timer-row">
                        <span>{`执行倒计时：${formatCountdownText(data.secondsToExecute)}`}</span>
                    </div>
                )}
                {data.phase === 'settling' && (
                    <div className="distribution-panel-timer-row">
                        <span>{`活动结束：${formatCountdownText(data.secondsToEnd)}`}</span>
                    </div>
                )}

                <div className="distribution-panel-grid">
                    <div className="distribution-panel-card"><span>参与总人数</span><strong>{data.participantTotal || 0}</strong></div>
                    <div className="distribution-panel-card"><span>本池总比例</span><strong>{Number(pool.poolPercent || 0).toFixed(2)}%</strong></div>
                    <div className="distribution-panel-card"><span>你的实际比例</span><strong>{Number(pool.userActualPercent || 0).toFixed(2)}%</strong></div>
                    <div className="distribution-panel-card"><span>{rewardLabel}</span><strong>{rewardText}</strong></div>
                    <div className="distribution-panel-card"><span>所在规则池</span><strong>{pool.label || '未命中规则池'}</strong></div>
                </div>

                {distributionPanelState.error && <div className="distribution-panel-error">{distributionPanelState.error}</div>}
                <div className="distribution-panel-pool-row">
                    <div className="distribution-panel-pool-row-title">
                        {`同池人数：${pool.participantCount || 0}`}
                    </div>
                    <div className="distribution-panel-pool-avatars">
                        {poolUsers.length > 0 ? poolUsers.map((item) => (
                            <div
                                key={item.userId || item.username}
                                className="distribution-panel-pool-avatar"
                                title={item.displayName || item.username || ''}
                            >
                                <img
                                    src={avatarMap[item.avatar] || avatarMap.default_male_1}
                                    alt={item.username || '用户'}
                                />
                            </div>
                        )) : (
                            <span className="distribution-panel-pool-empty">暂无</span>
                        )}
                    </div>
                </div>

                <div className="distribution-panel-actions">
                    <button
                        type="button"
                        className="btn btn-small btn-success"
                        onClick={joinDistributionFromPanel}
                        disabled={joinButtonDisabled}
                    >
                        {distributionPanelState.joining ? '参与中...' : '参与分发'}
                    </button>
                    {data.canExit && (
                        <button
                            type="button"
                            className="btn btn-small btn-danger"
                            onClick={exitDistributionFromPanel}
                            disabled={distributionPanelState.exiting}
                        >
                            {distributionPanelState.exiting ? '退出中...' : '退出分发活动'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export const AppShellChrome = ({
    headerRef,
    isKnowledgeDomainActive,
    isCompact,
    profession,
    username,
    userAvatar,
    headerLevel,
    headerExpProgress,
    headerExperience,
    headerExpTarget,
    headerArmyCount,
    headerKnowledgeBalance,
    handleLogout,
    notificationsWrapperRef,
    toggleNotificationsPanel,
    notificationBadgeCount,
    showNotificationsPanel,
    fetchNotifications,
    isAdmin,
    fetchAdminPendingNodeReminders,
    adminPendingNodes,
    pendingMasterApplyCount,
    notifications,
    markAllNotificationsRead,
    isNotificationsLoading,
    isMarkingAllRead,
    notificationUnreadCount,
    clearNotifications,
    isClearingNotifications,
    formatNotificationTime,
    setShowNotificationsPanel,
    openAdminPanel,
    notificationActionId,
    handleDistributionAnnouncementClick,
    handleArrivalNotificationClick,
    handleSenseArticleNotificationClick,
    markNotificationRead,
    respondDomainAdminInvite,
    relatedDomainsWrapperRef,
    toggleRelatedDomainsPanel,
    relatedDomainCount,
    showRelatedDomainsPanel,
    relatedDomainsData,
    domainMasterDomains,
    domainAdminDomains,
    favoriteDomains,
    recentDomains,
    favoriteDomainSet,
    favoriteActionDomainId,
    fetchRelatedDomains,
    handleOpenRelatedDomain,
    toggleFavoriteDomain,
    formatDomainKnowledgePoint,
    closeHeaderPanels,
    navigateToHomeWithDockCollapse,
    handleHeaderHomeNavigation,
    prepareForPrimaryNavigation,
    setView,
    militaryMenuWrapperRef,
    toggleMilitaryMenu,
    showMilitaryMenu,
    setShowMilitaryMenu,
    showKnowledgeDomain,
    isTransitioningToDomain,
    view,
    currentTitleDetail,
    currentNodeDetail,
    isAnnouncementDockExpanded,
    setIsAnnouncementDockExpanded,
    announcementDockTab,
    setAnnouncementDockTab,
    isChatDockExpanded,
    setIsChatDockExpanded,
    chatBadgeCount,
    chatPanelProps,
    isMarkingAnnouncementsRead,
    announcementUnreadCount,
    markAnnouncementNotificationsRead,
    allianceAnnouncements,
    systemAnnouncements,
    handleHomeAnnouncementClick,
    isLocationDockExpanded,
    setIsLocationDockExpanded,
    travelStatus,
    currentLocationNodeDetail,
    userLocation,
    handleRefreshLocationNodeDetail,
    isRefreshingLocationDetail,
    formatTravelSeconds,
    handleOpenTravelNode,
    stopTravel,
    isStoppingTravel,
    siegeSupportStatuses,
    handleJumpToCurrentLocationView,
    showDistributionPanel,
    distributionPanelState,
    closeDistributionPanel,
    joinDistributionFromPanel,
    exitDistributionFromPanel
}) => (
    <>
        <GameHeader
            headerRef={headerRef}
            isKnowledgeDomainActive={isKnowledgeDomainActive}
            isCompact={isCompact}
            profession={profession}
            username={username}
            userAvatar={userAvatar}
            headerLevel={headerLevel}
            headerExpProgress={headerExpProgress}
            headerExperience={headerExperience}
            headerExpTarget={headerExpTarget}
            headerArmyCount={headerArmyCount}
            headerKnowledgeBalance={headerKnowledgeBalance}
            onProfileClick={async () => {
                await prepareForPrimaryNavigation();
                setView('profile');
            }}
            onLogout={handleLogout}
            notificationsWrapperRef={notificationsWrapperRef}
            onToggleNotifications={toggleNotificationsPanel}
            notificationBadgeCount={notificationBadgeCount}
            notificationsPanel={(
                <NotificationsPanel
                    showNotificationsPanel={showNotificationsPanel}
                    fetchNotifications={fetchNotifications}
                    isAdmin={isAdmin}
                    fetchAdminPendingNodeReminders={fetchAdminPendingNodeReminders}
                    adminPendingNodes={adminPendingNodes}
                    pendingMasterApplyCount={pendingMasterApplyCount}
                    notifications={notifications}
                    markAllNotificationsRead={markAllNotificationsRead}
                    isNotificationsLoading={isNotificationsLoading}
                    isMarkingAllRead={isMarkingAllRead}
                    notificationUnreadCount={notificationUnreadCount}
                    clearNotifications={clearNotifications}
                    isClearingNotifications={isClearingNotifications}
                    formatNotificationTime={formatNotificationTime}
                    setShowNotificationsPanel={setShowNotificationsPanel}
                    openAdminPanel={openAdminPanel}
                    notificationActionId={notificationActionId}
                    handleDistributionAnnouncementClick={handleDistributionAnnouncementClick}
                    handleArrivalNotificationClick={handleArrivalNotificationClick}
                    handleSenseArticleNotificationClick={handleSenseArticleNotificationClick}
                    markNotificationRead={markNotificationRead}
                    respondDomainAdminInvite={respondDomainAdminInvite}
                />
            )}
            relatedDomainsWrapperRef={relatedDomainsWrapperRef}
            onToggleRelatedDomains={toggleRelatedDomainsPanel}
            relatedDomainCount={relatedDomainCount}
            relatedDomainsPanel={(
                <RelatedDomainsPanel
                    showRelatedDomainsPanel={showRelatedDomainsPanel}
                    relatedDomainsData={relatedDomainsData}
                    domainMasterDomains={domainMasterDomains}
                    domainAdminDomains={domainAdminDomains}
                    favoriteDomains={favoriteDomains}
                    recentDomains={recentDomains}
                    favoriteDomainSet={favoriteDomainSet}
                    favoriteActionDomainId={favoriteActionDomainId}
                    onRefresh={() => fetchRelatedDomains(false)}
                    onOpenDomain={handleOpenRelatedDomain}
                    onToggleFavorite={toggleFavoriteDomain}
                    formatDomainKnowledgePoint={formatDomainKnowledgePoint}
                />
            )}
            onHomeClick={async () => {
                closeHeaderPanels();
                await handleHeaderHomeNavigation();
            }}
            onAllianceClick={async () => {
                closeHeaderPanels();
                await prepareForPrimaryNavigation();
                setView('alliance');
            }}
            isAdmin={isAdmin}
            militaryMenuWrapperRef={militaryMenuWrapperRef}
            onToggleMilitaryMenu={toggleMilitaryMenu}
            showMilitaryMenu={showMilitaryMenu}
            onOpenArmy={async () => {
                setShowMilitaryMenu(false);
                await prepareForPrimaryNavigation();
                setView('army');
            }}
            onOpenTrainingGround={async () => {
                setShowMilitaryMenu(false);
                await prepareForPrimaryNavigation();
                setView('trainingGround');
            }}
            onOpenEquipment={async () => {
                setShowMilitaryMenu(false);
                await prepareForPrimaryNavigation();
                setView('equipment');
            }}
            onOpenAdmin={() => {
                setShowMilitaryMenu(false);
                openAdminPanel('users');
            }}
        />

        <UnifiedRightDock
            isAdmin={isAdmin}
            showKnowledgeDomain={showKnowledgeDomain}
            isTransitioningToDomain={isTransitioningToDomain}
            view={view}
            currentTitleDetail={currentTitleDetail}
            currentNodeDetail={currentNodeDetail}
            isAnnouncementDockExpanded={isAnnouncementDockExpanded}
            setIsAnnouncementDockExpanded={setIsAnnouncementDockExpanded}
            announcementDockTab={announcementDockTab}
            setAnnouncementDockTab={setAnnouncementDockTab}
            isChatDockExpanded={isChatDockExpanded}
            setIsChatDockExpanded={setIsChatDockExpanded}
            chatBadgeCount={chatBadgeCount}
            chatPanelProps={chatPanelProps}
            isMarkingAnnouncementsRead={isMarkingAnnouncementsRead}
            announcementUnreadCount={announcementUnreadCount}
            markAnnouncementNotificationsRead={markAnnouncementNotificationsRead}
            allianceAnnouncements={allianceAnnouncements}
            systemAnnouncements={systemAnnouncements}
            handleHomeAnnouncementClick={handleHomeAnnouncementClick}
            isLocationDockExpanded={isLocationDockExpanded}
            setIsLocationDockExpanded={setIsLocationDockExpanded}
            travelStatus={travelStatus}
            currentLocationNodeDetail={currentLocationNodeDetail}
            userLocation={userLocation}
            handleRefreshLocationNodeDetail={handleRefreshLocationNodeDetail}
            isRefreshingLocationDetail={isRefreshingLocationDetail}
            formatTravelSeconds={formatTravelSeconds}
            handleOpenTravelNode={handleOpenTravelNode}
            stopTravel={stopTravel}
            isStoppingTravel={isStoppingTravel}
            siegeSupportStatuses={siegeSupportStatuses}
            handleJumpToCurrentLocationView={handleJumpToCurrentLocationView}
        />

        <DistributionParticipationPanel
            view={view}
            showDistributionPanel={showDistributionPanel}
            currentTitleDetail={currentTitleDetail}
            distributionPanelState={distributionPanelState}
            closeDistributionPanel={closeDistributionPanel}
            userLocation={userLocation}
            joinDistributionFromPanel={joinDistributionFromPanel}
            exitDistributionFromPanel={exitDistributionFromPanel}
        />
    </>
);

export const NotificationsPanel = ({
    showNotificationsPanel,
    fetchNotifications,
    isAdmin,
    fetchAdminPendingNodeReminders,
    adminPendingNodes,
    pendingMasterApplyCount,
    notifications,
    markAllNotificationsRead,
    isNotificationsLoading,
    isMarkingAllRead,
    notificationUnreadCount,
    clearNotifications,
    isClearingNotifications,
    formatNotificationTime,
    setShowNotificationsPanel,
    openAdminPanel,
    notificationActionId,
    handleDistributionAnnouncementClick,
    handleArrivalNotificationClick,
    handleSenseArticleNotificationClick,
    markNotificationRead,
    respondDomainAdminInvite
}) => {
    if (!showNotificationsPanel) return null;

    const refreshNotifications = async () => {
        await fetchNotifications(false);
        if (isAdmin) {
            await fetchAdminPendingNodeReminders(false);
        }
    };

    if (isAdmin) {
        const latestPendingNode = [...adminPendingNodes]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
        const adminReminders = [];

        if (pendingMasterApplyCount > 0) {
            adminReminders.push({
                key: 'pending-master-apply',
                title: '有用户申请域主',
                message: `当前有 ${pendingMasterApplyCount} 条域主申请待处理。`,
                createdAt: notifications.find((item) => (
                    item.type === 'domain_master_apply' && item.status === 'pending'
                ))?.createdAt || null
            });
        }

        if (adminPendingNodes.length > 0) {
            adminReminders.push({
                key: 'pending-node-create',
                title: (adminPendingNodes.length === 1 && latestPendingNode?.name)
                    ? `有用户提交了「${latestPendingNode.name}」新知识域创建申请`
                    : '有用户提交了创建新知识域申请',
                message: `当前有 ${adminPendingNodes.length} 条创建新知识域申请待审批。`,
                createdAt: latestPendingNode?.createdAt || null
            });
        }

        return (
            <div className="notifications-panel">
                <div className="notifications-header">
                    <h3>通知中心</h3>
                    <button
                        type="button"
                        className="btn btn-small btn-blue"
                        onClick={markAllNotificationsRead}
                        disabled={isNotificationsLoading || isMarkingAllRead || notificationUnreadCount === 0}
                    >
                        {isMarkingAllRead ? '处理中...' : '全部已读'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={clearNotifications}
                        disabled={isNotificationsLoading || isClearingNotifications || notifications.length === 0}
                    >
                        {isClearingNotifications ? '清空中...' : '清空通知'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={refreshNotifications}
                        disabled={isNotificationsLoading}
                    >
                        {isNotificationsLoading ? '刷新中...' : '刷新'}
                    </button>
                </div>
                <div className="notifications-body">
                    {adminReminders.length === 0 ? (
                        <div className="no-notifications">暂无审批提醒</div>
                    ) : (
                        <div className="notifications-list">
                            {adminReminders.map((reminder) => (
                                <div key={reminder.key} className="notification-item unread">
                                    <div className="notification-item-title-row">
                                        <h4>{reminder.title}</h4>
                                        <span className="notification-dot" />
                                    </div>
                                    <div className="notification-item-message">{reminder.message}</div>
                                    <div className="notification-item-meta">
                                        {formatNotificationTime(reminder.createdAt)}
                                    </div>
                                    <div className="notification-actions">
                                        <button
                                            type="button"
                                            className="btn btn-small btn-warning"
                                            onClick={() => {
                                                setShowNotificationsPanel(false);
                                                openAdminPanel('pending');
                                            }}
                                        >
                                            前往待审批
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="notifications-panel">
            <div className="notifications-header">
                <h3>通知中心</h3>
                <button
                    type="button"
                    className="btn btn-small btn-blue"
                    onClick={markAllNotificationsRead}
                    disabled={isNotificationsLoading || isMarkingAllRead || notificationUnreadCount === 0}
                >
                    {isMarkingAllRead ? '处理中...' : '全部已读'}
                </button>
                <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={clearNotifications}
                    disabled={isNotificationsLoading || isClearingNotifications || notifications.length === 0}
                >
                    {isClearingNotifications ? '清空中...' : '清空通知'}
                </button>
                <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={refreshNotifications}
                    disabled={isNotificationsLoading}
                >
                    {isNotificationsLoading ? '刷新中...' : '刷新'}
                </button>
            </div>
            <div className="notifications-body">
                {notifications.length === 0 ? (
                    <div className="no-notifications">暂无通知</div>
                ) : (
                    <div className="notifications-list">
                        {notifications.map((notification) => {
                            const isInvitePending =
                                notification.type === 'domain_admin_invite' &&
                                notification.status === 'pending';
                            const isResignRequestPending =
                                notification.type === 'domain_admin_resign_request' &&
                                notification.status === 'pending';
                            const isMasterApplyPending =
                                notification.type === 'domain_master_apply' &&
                                notification.status === 'pending';
                            const isAllianceJoinApplyPending =
                                notification.type === 'alliance_join_apply' &&
                                notification.status === 'pending';
                            const isDistributionAnnouncement =
                                notification.type === 'domain_distribution_announcement';
                            const isArrivalNotification =
                                notification.type === 'info' &&
                                typeof notification.nodeName === 'string' &&
                                notification.nodeName.trim() !== '';
                            const currentActionKey = notificationActionId.split(':')[0];
                            const isActing = currentActionKey === notification._id;

                            return (
                                <div
                                    key={notification._id}
                                    className={`notification-item ${notification.read ? '' : 'unread'}`}
                                    onClick={(event) => {
                                        if (event.target.closest('.notification-actions')) {
                                            return;
                                        }
                                        if (isDistributionAnnouncement) {
                                            handleDistributionAnnouncementClick(notification);
                                            return;
                                        }
                                        if (isArrivalNotification) {
                                            handleArrivalNotificationClick(notification);
                                            return;
                                        }
                                        if (isSenseArticleNotification(notification)) {
                                            handleSenseArticleNotificationClick(notification);
                                            return;
                                        }
                                        if (!notification.read) {
                                            markNotificationRead(notification._id);
                                        }
                                    }}
                                >
                                    <div className="notification-item-title-row">
                                        <h4>{notification.title || '系统通知'}</h4>
                                        {!notification.read && <span className="notification-dot" />}
                                    </div>
                                    <div className="notification-item-message">{notification.message || ''}</div>
                                    <div className="notification-item-meta">
                                        {formatNotificationTime(notification.createdAt)}
                                    </div>
                                    {(notification.type === 'domain_admin_invite_result'
                                        || notification.type === 'domain_admin_resign_result'
                                        || notification.type === 'domain_master_apply_result'
                                        || notification.type === 'alliance_join_apply_result') && (
                                        <div className={`notification-result-tag ${notification.status === 'accepted' ? 'accepted' : 'rejected'}`}>
                                            {notification.status === 'accepted'
                                                ? (notification.type === 'domain_admin_resign_result'
                                                    ? '域主已同意卸任'
                                                    : notification.type === 'domain_master_apply_result'
                                                        ? '管理员已同意你成为域主'
                                                        : notification.type === 'alliance_join_apply_result'
                                                            ? '盟主已同意入盟'
                                                            : '对方已接受')
                                                : (notification.type === 'domain_admin_resign_result'
                                                    ? '域主已拒绝卸任'
                                                    : notification.type === 'domain_master_apply_result'
                                                        ? '管理员已拒绝你的域主申请'
                                                        : notification.type === 'alliance_join_apply_result'
                                                            ? '盟主已拒绝入盟'
                                                            : '对方已拒绝')}
                                        </div>
                                    )}

                                    {isInvitePending ? (
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="btn btn-small btn-success"
                                                onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                disabled={isActing}
                                            >
                                                接受
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-small btn-danger"
                                                onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                disabled={isActing}
                                            >
                                                拒绝
                                            </button>
                                        </div>
                                    ) : isResignRequestPending ? (
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="btn btn-small btn-success"
                                                onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                disabled={isActing}
                                            >
                                                同意卸任
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-small btn-danger"
                                                onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                disabled={isActing}
                                            >
                                                拒绝
                                            </button>
                                        </div>
                                    ) : isMasterApplyPending ? (
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="btn btn-small btn-warning"
                                                onClick={() => {
                                                    setShowNotificationsPanel(false);
                                                    openAdminPanel('pending');
                                                }}
                                            >
                                                前往待审批
                                            </button>
                                        </div>
                                    ) : isAllianceJoinApplyPending ? (
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="btn btn-small btn-success"
                                                onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                disabled={isActing}
                                            >
                                                同意加入
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-small btn-danger"
                                                onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                disabled={isActing}
                                            >
                                                拒绝
                                            </button>
                                        </div>
                                    ) : (isDistributionAnnouncement && notification.requiresArrival) ? (
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="btn btn-small btn-warning"
                                                onClick={() => handleDistributionAnnouncementClick(notification)}
                                            >
                                                点击前往
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export const SenseSelectorPanel = ({
    view,
    currentTitleDetail,
    currentNodeDetail,
    senseSelectorSourceNode,
    isSenseSelectorVisible,
    senseSelectorAnchor,
    panelRef,
    senseSelectorOverviewNode,
    senseSelectorOverviewLoading,
    senseSelectorOverviewError,
    senseArticleEntryStatusMap,
    handleSwitchTitleView,
    handleSwitchSenseView,
    openSenseArticleFromNode
}) => {
    const { openUserCard } = useUserCard();

    if (view !== 'home' && view !== 'nodeDetail' && view !== 'titleDetail') return null;

    const selectorNode = (() => {
        if (view === 'titleDetail' && currentTitleDetail) return currentTitleDetail;
        if (view === 'nodeDetail' && currentNodeDetail) return currentNodeDetail;
        return senseSelectorSourceNode || null;
    })();
    if (!selectorNode) return null;
    if (!isSenseSelectorVisible || !senseSelectorAnchor.visible) return null;

    const selectorNodeId = normalizeObjectId(selectorNode?._id);
    const overviewNode = normalizeObjectId(senseSelectorOverviewNode?._id) === selectorNodeId
        ? senseSelectorOverviewNode
        : selectorNode;
    const senses = Array.isArray(overviewNode?.synonymSenses) && overviewNode.synonymSenses.length > 0
        ? overviewNode.synonymSenses
        : [{
            senseId: overviewNode?.activeSenseId || 'sense_1',
            title: overviewNode?.activeSenseTitle || '基础释义',
            content: overviewNode?.activeSenseContent || overviewNode?.description || ''
        }];
    const activeSenseId = (
        view === 'nodeDetail'
        && normalizeObjectId(currentNodeDetail?._id) === selectorNodeId
    )
        ? (currentNodeDetail?.activeSenseId || '')
        : '';
    const style = overviewNode?.visualStyle || selectorNode?.visualStyle || {};
    const overviewName = typeof overviewNode?.name === 'string' && overviewNode.name.trim()
        ? overviewNode.name.trim()
        : (typeof selectorNode?.name === 'string' ? selectorNode.name.trim() : '');
    const overviewDescription = typeof overviewNode?.description === 'string'
        ? overviewNode.description.trim()
        : '';
    const showSenseRelations = view === 'nodeDetail';
    const relationNameFromItem = (item) => {
        if (typeof item === 'string') return item.trim();
        if (!item || typeof item !== 'object') return '';
        if (typeof item?.displayName === 'string' && item.displayName.trim()) return item.displayName.trim();
        const title = typeof item?.name === 'string' ? item.name.trim() : '';
        const senseTitle = typeof item?.activeSenseTitle === 'string'
            ? item.activeSenseTitle.trim()
            : (typeof item?.senseTitle === 'string' ? item.senseTitle.trim() : '');
        if (title && senseTitle) return `${title}-${senseTitle}`;
        if (title) return title;
        return '';
    };
    const uniqueRelationNames = (items = []) => Array.from(new Set(
        (Array.isArray(items) ? items : [])
            .map(relationNameFromItem)
            .filter(Boolean)
    ));
    const includes = showSenseRelations
        ? uniqueRelationNames(overviewNode?.childNodesInfo)
        : [];
    const extendsTo = showSenseRelations
        ? uniqueRelationNames(overviewNode?.parentNodesInfo)
        : [];
    const managerIdOf = (user) => normalizeObjectId(user?._id || user?.id || user);
    const domainMasterRaw = overviewNode?.domainMaster;
    const domainMaster = (
        domainMasterRaw
        && typeof domainMasterRaw === 'object'
        && managerIdOf(domainMasterRaw)
    ) ? domainMasterRaw : null;
    const masterId = managerIdOf(domainMaster);
    const domainAdmins = Array.isArray(overviewNode?.domainAdmins)
        ? overviewNode.domainAdmins
            .filter((admin) => admin && typeof admin === 'object')
            .filter((admin, index, arr) => {
                const adminId = managerIdOf(admin);
                if (!adminId) return true;
                if (adminId === masterId) return false;
                return arr.findIndex((item) => managerIdOf(item) === adminId) === index;
            })
        : [];
    const masterAllianceRaw = domainMaster?.alliance || domainMaster?.allianceId;
    const masterAllianceName = typeof masterAllianceRaw?.name === 'string'
        ? masterAllianceRaw.name.trim()
        : '';
    const allianceName = (
        typeof style?.allianceName === 'string' && style.allianceName.trim()
            ? style.allianceName.trim()
            : masterAllianceName
    ) || '';
    const allianceFlag = (
        typeof masterAllianceRaw?.flag === 'string' && masterAllianceRaw.flag.trim()
            ? masterAllianceRaw.flag.trim()
            : ''
    );
    const panelStyle = {
        left: `${senseSelectorAnchor.x}px`,
        top: `${senseSelectorAnchor.y}px`,
        background: `linear-gradient(120deg, ${hexToRgba(style.primaryColor || '#1e293b', 0.76)} 0%, ${hexToRgba(style.secondaryColor || '#334155', 0.68)} 100%)`,
        borderColor: hexToRgba(style.rimColor || style.primaryColor || '#a855f7', 0.74),
        color: style.textColor || '#f8fafc'
    };

    return (
        <div ref={panelRef} className="sense-selector-panel" style={panelStyle}>
            <div className="sense-selector-overview-header">
                <button
                    type="button"
                    className="sense-selector-title sense-selector-title-btn"
                    onClick={handleSwitchTitleView}
                >
                    {overviewName || '未命名知识域'}
                </button>
                <div className="sense-selector-overview-mode">
                    {view === 'titleDetail' ? '当前：标题主视角' : '点击标题切换到标题主视角'}
                </div>
            </div>

            <div className="sense-selector-overview-summary">
                <span className="sense-selector-overview-label">概述</span>
                <span className="sense-selector-overview-desc-content">
                    {overviewDescription || '暂无概述'}
                </span>
            </div>

            <div className="sense-selector-list-title">释义选择</div>
            <div className="sense-selector-list">
                {senses.map((sense) => {
                    const isActive = !!activeSenseId && sense?.senseId === activeSenseId;
                    const entryKey = `${normalizeObjectId(overviewNode?._id) || ''}:${typeof sense?.senseId === 'string' ? sense.senseId.trim() : ''}`;
                    const articleEntryState = senseArticleEntryStatusMap[entryKey] || null;
                    return (
                        <div key={sense?.senseId || sense?.title} className="sense-selector-item-row">
                            <button
                                type="button"
                                className={`sense-selector-item ${isActive ? 'active' : ''}`}
                                onClick={() => handleSwitchSenseView(sense?.senseId)}
                            >
                                {sense?.title || '未命名释义'}
                            </button>
                            <button
                                type="button"
                                className="sense-selector-item-article-btn"
                                onClick={() => openSenseArticleFromNode(overviewNode, { senseId: sense?.senseId })}
                                disabled={!!articleEntryState?.loading && !articleEntryState?.resolved}
                            >
                                {getSenseArticleEntryActionLabel({
                                    hasPublishedRevision: !!articleEntryState?.hasPublishedRevision,
                                    loading: !!articleEntryState?.loading && !articleEntryState?.resolved
                                }) || SENSE_ARTICLE_ENTRY_SHORT_LABEL}
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="sense-selector-overview-grid">
                <div className="sense-selector-overview-field alliance">
                    <span className="sense-selector-overview-label">所属熵盟</span>
                    <span className="sense-selector-overview-alliance">
                        {allianceFlag ? (
                            <span className="sense-selector-overview-alliance-flag" style={{ backgroundColor: allianceFlag }} />
                        ) : null}
                        <span className="sense-selector-overview-value">{allianceName}</span>
                    </span>
                </div>
            </div>

            <div className="sense-selector-overview-managers">
                <div className="sense-selector-overview-people-row">
                    <div className="sense-selector-overview-people-group">
                        <span className="sense-selector-overview-label">域主</span>
                        <div className="sense-selector-overview-people-list">
                            {domainMaster ? (
                                <button
                                    type="button"
                                    className="sense-selector-manager-chip master"
                                    title={`域主：${domainMaster.username || '未命名用户'}`}
                                    onClick={(event) => openUserCard(domainMaster, event)}
                                >
                                    <img
                                        src={resolveAvatarSrc(domainMaster.avatar)}
                                        alt={domainMaster.username || '域主'}
                                        className="sense-selector-manager-avatar"
                                    />
                                    <span className="sense-selector-manager-name">{domainMaster.username || '未设置域主'}</span>
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <div className="sense-selector-overview-people-group">
                        <span className="sense-selector-overview-label">域相</span>
                        <div className="sense-selector-overview-people-list">
                            {domainAdmins.length > 0 ? (
                                domainAdmins.map((admin, index) => (
                                    <button
                                        type="button"
                                        key={managerIdOf(admin) || `sense-selector-admin-${index}`}
                                        className="sense-selector-manager-chip"
                                        title={`域相：${admin?.username || '未命名用户'}`}
                                        onClick={(event) => openUserCard(admin, event)}
                                    >
                                        <img
                                            src={resolveAvatarSrc(admin?.avatar)}
                                            alt={admin?.username || '域相'}
                                            className="sense-selector-manager-avatar"
                                        />
                                        <span className="sense-selector-manager-name">{admin?.username || '未命名'}</span>
                                    </button>
                                ))
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>

            {showSenseRelations && (
                <div className="sense-selector-overview-relations">
                    <div className="sense-selector-overview-relation-block">
                        <div className="sense-selector-overview-label">包含</div>
                        <div className="sense-selector-overview-tag-list">
                            {includes.length > 0 ? includes.map((item) => (
                                <span key={`contain-${item}`} className="sense-selector-overview-tag">
                                    {item}
                                </span>
                            )) : null}
                        </div>
                    </div>
                    <div className="sense-selector-overview-relation-block">
                        <div className="sense-selector-overview-label">扩展</div>
                        <div className="sense-selector-overview-tag-list">
                            {extendsTo.length > 0 ? extendsTo.map((item) => (
                                <span key={`extend-${item}`} className="sense-selector-overview-tag">
                                    {item}
                                </span>
                            )) : null}
                        </div>
                    </div>
                </div>
            )}

            {senseSelectorOverviewLoading && (
                <div className="sense-selector-overview-hint">正在加载标题总览...</div>
            )}
            {!senseSelectorOverviewLoading && senseSelectorOverviewError && (
                <div className="sense-selector-overview-hint error">{senseSelectorOverviewError}</div>
            )}
        </div>
    );
};

export const TitleRelationInfoPanel = ({ view, titleRelationInfo, onClose }) => {
    if (view !== 'titleDetail' || !titleRelationInfo) return null;

    const edge = titleRelationInfo;
    const leftName = edge?.nodeAName || '未命名标题';
    const rightName = edge?.nodeBName || '未命名标题';
    const pairRows = Array.isArray(edge?.pairs) ? edge.pairs : [];
    const nodeAId = normalizeObjectId(edge?.nodeAId);
    const nodeBId = normalizeObjectId(edge?.nodeBId);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const estimateSenseComplexity = (text = '') => (
        Array.from(typeof text === 'string' ? text.trim() : '')
            .reduce((sum, ch) => {
                if (/\s/.test(ch)) return sum + 0.2;
                if (/[A-Za-z0-9]/.test(ch)) return sum + 0.55;
                return sum + 1;
            }, 0)
    );
    const resolveTitleByNodeId = (nodeId) => {
        const normalized = normalizeObjectId(nodeId);
        if (normalized && normalized === nodeAId) return leftName;
        if (normalized && normalized === nodeBId) return rightName;
        return '未命名标题';
    };
    const diagramMap = new Map();
    pairRows.forEach((item) => {
        const relationType = item?.relationType === 'contains' || item?.relationType === 'extends'
            ? item.relationType
            : '';
        if (!relationType) return;

        const sourceNodeId = normalizeObjectId(item?.sourceNodeId);
        const targetNodeId = normalizeObjectId(item?.targetNodeId);
        const sourceSenseId = typeof item?.sourceSenseId === 'string' ? item.sourceSenseId.trim() : '';
        const targetSenseId = typeof item?.targetSenseId === 'string' ? item.targetSenseId.trim() : '';
        const sourceTitleName = resolveTitleByNodeId(sourceNodeId);
        const targetTitleName = resolveTitleByNodeId(targetNodeId);
        const sourceSenseTitle = typeof item?.sourceSenseTitle === 'string' ? item.sourceSenseTitle.trim() : '';
        const targetSenseTitle = typeof item?.targetSenseTitle === 'string' ? item.targetSenseTitle.trim() : '';

        const upper = relationType === 'contains'
            ? {
                nodeId: sourceNodeId,
                senseId: sourceSenseId,
                titleName: sourceTitleName,
                senseTitle: sourceSenseTitle || '未命名释义'
            }
            : {
                nodeId: targetNodeId,
                senseId: targetSenseId,
                titleName: targetTitleName,
                senseTitle: targetSenseTitle || '未命名释义'
            };
        const lower = relationType === 'contains'
            ? {
                nodeId: targetNodeId,
                senseId: targetSenseId,
                titleName: targetTitleName,
                senseTitle: targetSenseTitle || '未命名释义'
            }
            : {
                nodeId: sourceNodeId,
                senseId: sourceSenseId,
                titleName: sourceTitleName,
                senseTitle: sourceSenseTitle || '未命名释义'
            };

        const mergeKey = `${upper.nodeId || 'u'}|${upper.senseId || 'us'}|${lower.nodeId || 'l'}|${lower.senseId || 'ls'}`;
        if (!diagramMap.has(mergeKey)) {
            diagramMap.set(mergeKey, {
                key: mergeKey,
                bigTitle: upper.titleName || '未命名标题',
                bigSense: upper.senseTitle || '未命名释义',
                smallTitle: lower.titleName || '未命名标题',
                smallSense: lower.senseTitle || '未命名释义'
            });
        }
    });
    const diagrams = Array.from(diagramMap.values()).map((item) => {
        const complexity = estimateSenseComplexity(item.bigSense);
        const overlapRatio = 0.8;
        const bigWidthPct = clamp(30 + complexity * 1.15, 30, 54);
        const smallWidthPct = clamp(bigWidthPct * 0.72, 24, 32);
        const bigLeftBase = 0;
        const smallLeftBase = bigWidthPct - smallWidthPct * overlapRatio;
        const groupLeftBase = Math.min(bigLeftBase, smallLeftBase);
        const groupRightBase = Math.max(bigLeftBase + bigWidthPct, smallLeftBase + smallWidthPct);
        const groupWidthPct = groupRightBase - groupLeftBase;
        const idealGroupLeftPct = 50 - groupWidthPct / 2;
        const minGroupLeftPct = 2 - groupLeftBase;
        const maxGroupLeftPct = 98 - groupRightBase;
        const groupLeftShiftPct = clamp(idealGroupLeftPct, minGroupLeftPct, maxGroupLeftPct);
        const bigLeftPct = groupLeftShiftPct + bigLeftBase;
        const smallLeftPct = groupLeftShiftPct + smallLeftBase;
        const overlapPct = smallWidthPct * overlapRatio;
        const bigTextSafePct = clamp(((bigWidthPct - overlapPct - 1.5) / bigWidthPct) * 100, 30, 58);
        return {
            ...item,
            bigWidthPct,
            bigLeftPct,
            smallWidthPct,
            smallLeftPct,
            bigTextSafePct
        };
    });

    return (
        <div className="title-relation-popup">
            <button
                type="button"
                className="title-relation-close"
                onClick={onClose}
            >
                ×
            </button>
            <div className="title-relation-diagram-list">
                {diagrams.length > 0 ? diagrams.map((item) => (
                    <div key={item.key} className="title-relation-diagram-item">
                        <div
                            className="title-relation-venn"
                            style={{
                                '--big-width': `${item.bigWidthPct}%`,
                                '--big-left': `${item.bigLeftPct}%`,
                                '--small-width': `${item.smallWidthPct}%`,
                                '--small-left': `${item.smallLeftPct}%`,
                                '--big-safe-width': `${item.bigTextSafePct}%`
                            }}
                        >
                            <div className="title-relation-ellipse-title large-title">{item.bigTitle}</div>
                            <div className="title-relation-ellipse-title small-title">{item.smallTitle}</div>
                            <div className="title-relation-ellipse large left">
                                <span className="title-relation-ellipse-text">{item.bigSense}</span>
                            </div>
                            <div className="title-relation-ellipse small right">
                                <span className="title-relation-ellipse-text">{item.smallSense}</span>
                            </div>
                        </div>
                    </div>
                )) : (
                    <div className="title-relation-empty">暂无可展示的释义关联图</div>
                )}
            </div>
        </div>
    );
};
