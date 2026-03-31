import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronLeft, Home, Layers, MapPin, MessagesSquare, Shield, Star, User, Users, X } from 'lucide-react';
import './AppShell.css';
import {
    avatarMap,
    formatCountdownText,
    getNodeDisplayName,
    hexToRgba,
    isKnowledgeDetailView,
    isTitleBattleView,
    readIsMobileViewport,
    normalizeObjectId,
    resolveAvatarSrc
} from '../../app/appShared';
import {
    SENSE_ARTICLE_ENTRY_SHORT_LABEL,
    getSenseArticleEntryActionLabel
} from '../senseArticle/senseArticleUi';
import ChatDockPanel from '../chat/ChatDockPanel';
import CurrentDomainPanel from '../game/CurrentDomainPanel';
import MessageDockPanel from '../game/MessageDockPanel';
import RightUtilityDock from '../game/RightUtilityDock';
import { useUserCard } from '../social/UserCardContext';

const readIsMobileShell = () => readIsMobileViewport();
const SENSE_SELECTOR_EDGE_MARGIN = 24;
const SENSE_SELECTOR_DESKTOP_GAP = 28;
const DEFAULT_DESKTOP_PANEL_SIZE = { width: 680, height: 560 };
const readViewportSize = () => ({
    width: Math.max(320, Math.round(window.visualViewport?.width || window.innerWidth || 1280)),
    height: Math.max(320, Math.round(window.visualViewport?.height || window.innerHeight || 720))
});

export const GameHeader = ({
    headerRef,
    isKnowledgeDomainActive,
    isCompact,
    isMobileLayout,
    isMobileSuppressed,
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
    <div
        ref={headerRef}
        className={`header ${isKnowledgeDomainActive ? 'header-knowledge-domain-active' : ''} ${isCompact ? 'header-compact' : ''} ${isMobileLayout ? 'header-mobile' : ''} ${isMobileSuppressed ? 'header-mobile-suppressed' : ''}`.trim()}
    >
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
            {!isMobileLayout ? (
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
            ) : null}
        </div>
    </div>
);

const MobileBottomBar = ({
    relatedDomainsWrapperRef,
    militaryMenuWrapperRef,
    relatedDomainCount,
    relatedDomainsPanel,
    showMilitaryMenu,
    militaryMenuPanel,
    isAdmin,
    activeView,
    onHomeClick,
    onToggleRelatedDomains,
    onAllianceClick,
    onToggleMilitaryMenu,
    onOpenAdmin,
    onProfileClick
}) => (
    <div className="mobile-bottom-bar" aria-label="移动端主导航">
        <div className="mobile-bottom-bar__shell">
            <button
                type="button"
                className={`mobile-bottom-bar__btn${activeView === 'home' ? ' is-active' : ''}`}
                onClick={onHomeClick}
            >
                <span className="mobile-bottom-bar__icon"><Home size={17} /></span>
                <span className="mobile-bottom-bar__label">首页</span>
            </button>

            <div className="mobile-bottom-bar__slot" ref={relatedDomainsWrapperRef}>
                <button
                    type="button"
                    className={`mobile-bottom-bar__btn${activeView === 'related' ? ' is-active' : ''}`}
                    onClick={onToggleRelatedDomains}
                >
                    <span className="mobile-bottom-bar__icon"><Layers size={17} /></span>
                    <span className="mobile-bottom-bar__label">我的域</span>
                    {relatedDomainCount > 0 ? (
                        <span className="mobile-bottom-bar__badge">
                            {relatedDomainCount > 99 ? '99+' : relatedDomainCount}
                        </span>
                    ) : null}
                </button>
                {relatedDomainsPanel}
            </div>

            <button
                type="button"
                className={`mobile-bottom-bar__btn${activeView === 'alliance' ? ' is-active' : ''}`}
                onClick={onAllianceClick}
            >
                <span className="mobile-bottom-bar__icon"><Shield size={17} /></span>
                <span className="mobile-bottom-bar__label">熵盟</span>
            </button>

            <div className="mobile-bottom-bar__slot" ref={militaryMenuWrapperRef}>
                <button
                    type="button"
                    className={`mobile-bottom-bar__btn${(isAdmin ? activeView === 'admin' : activeView === 'military') ? ' is-active' : ''}`}
                    onClick={isAdmin ? onOpenAdmin : onToggleMilitaryMenu}
                >
                    <span className="mobile-bottom-bar__icon"><Users size={17} /></span>
                    <span className="mobile-bottom-bar__label">{isAdmin ? '管理' : '军事'}</span>
                </button>
                {!isAdmin && showMilitaryMenu ? militaryMenuPanel : null}
            </div>

            <button
                type="button"
                className={`mobile-bottom-bar__btn${activeView === 'profile' ? ' is-active' : ''}`}
                onClick={onProfileClick}
            >
                <span className="mobile-bottom-bar__icon"><User size={17} /></span>
                <span className="mobile-bottom-bar__label">我的</span>
            </button>
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
    isAdmin,
    showKnowledgeDomain,
    isTransitioningToDomain,
    view,
    currentTitleDetail,
    currentNodeDetail,
    isAnnouncementDockExpanded,
    setIsAnnouncementDockExpanded,
    messageDockTab,
    setMessageDockTab,
    notifications,
    notificationUnreadCount,
    isNotificationsLoading,
    isMarkingAllRead,
    clearNotifications,
    isClearingNotifications,
    notificationActionId,
    adminPendingNodes,
    fetchNotifications,
    fetchAdminPendingNodeReminders,
    markNotificationRead,
    markAllNotificationsRead,
    respondDomainAdminInvite,
    handleDistributionAnnouncementClick,
    handleArrivalNotificationClick,
    handleSenseArticleNotificationClick,
    openAdminPanel,
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
        ? 'message'
        : isChatDockExpanded
            ? 'chat'
            : (shouldRenderLocationDock && isLocationDockExpanded ? 'domain' : '');

    const toggleExclusiveDock = (target) => {
        const isCurrentlyActive = activeDockSectionId === target;
        const nextAnnouncementOpen = target === 'message' && !isCurrentlyActive;
        const nextChatOpen = target === 'chat' && !isCurrentlyActive;
        const nextLocationOpen = target === 'domain' && !isCurrentlyActive;

        closeAllDockPanels();
        setIsAnnouncementDockExpanded(nextAnnouncementOpen);
        setIsChatDockExpanded(nextChatOpen);
        setIsLocationDockExpanded(nextLocationOpen);
    };

    const canJumpToLocationView = Boolean(
        !travelStatus.isTraveling &&
        currentLocationNodeDetail &&
        userLocation &&
        !(isKnowledgeDetailView(view) && activeDetailNode?.name === userLocation)
    );
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
            id: 'message',
            label: '消息',
            icon: Bell,
            badge: (notificationUnreadCount > 0 || (isAdmin && adminPendingNodes.length > 0))
                ? String(Math.min(99, notificationUnreadCount + (isAdmin ? adminPendingNodes.length : 0)))
                : null,
            active: activeDockSectionId === 'message',
            panelWidth: 520,
            onToggle: () => toggleExclusiveDock('message'),
            panel: (
                <MessageDockPanel
                    activeTab={messageDockTab}
                    onTabChange={setMessageDockTab}
                    onClose={() => setIsAnnouncementDockExpanded(false)}
                    isAdmin={isAdmin}
                    notifications={notifications}
                    systemAnnouncements={systemAnnouncements}
                    allianceAnnouncements={allianceAnnouncements}
                    adminPendingNodes={adminPendingNodes}
                    notificationUnreadCount={notificationUnreadCount}
                    announcementUnreadCount={announcementUnreadCount}
                    isNotificationsLoading={isNotificationsLoading}
                    isMarkingAllRead={isMarkingAllRead}
                    isMarkingAnnouncementsRead={isMarkingAnnouncementsRead}
                    isClearingNotifications={isClearingNotifications}
                    notificationActionId={notificationActionId}
                    onRefresh={async () => {
                        await fetchNotifications(false);
                        if (isAdmin) {
                            await fetchAdminPendingNodeReminders(false);
                        }
                    }}
                    onMarkAllNotificationsRead={markAllNotificationsRead}
                    onMarkAnnouncementNotificationsRead={markAnnouncementNotificationsRead}
                    onClearNotifications={clearNotifications}
                    onOpenAdminPending={() => openAdminPanel('pending')}
                    onMarkNotificationRead={markNotificationRead}
                    onRespondNotification={respondDomainAdminInvite}
                    onOpenDistributionNotification={handleDistributionAnnouncementClick}
                    onOpenArrivalNotification={handleArrivalNotificationClick}
                    onOpenSenseArticleNotification={handleSenseArticleNotificationClick}
                    onOpenAnnouncement={handleHomeAnnouncementClick}
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
    fetchNotifications,
    isAdmin,
    fetchAdminPendingNodeReminders,
    openAdminPanel,
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
    messageDockTab,
    setMessageDockTab,
    notifications,
    adminPendingNodes,
    notificationUnreadCount,
    isNotificationsLoading,
    isMarkingAllRead,
    clearNotifications,
    isClearingNotifications,
    notificationActionId,
    handleDistributionAnnouncementClick,
    handleArrivalNotificationClick,
    handleSenseArticleNotificationClick,
    markNotificationRead,
    markAllNotificationsRead,
    respondDomainAdminInvite,
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
}) => {
    const [isMobileLayout, setIsMobileLayout] = useState(readIsMobileShell);
    const shouldPromoteSceneTopPanel = isMobileLayout && (view === 'home' || view === 'nodeDetail' || view === 'titleDetail');

    useEffect(() => {
        const handleResize = () => setIsMobileLayout(readIsMobileShell());
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const relatedDomainsPanelNode = (
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
    );

    const onOpenArmy = async () => {
        setShowMilitaryMenu(false);
        await prepareForPrimaryNavigation();
        setView('army');
    };

    const onOpenTrainingGround = async () => {
        setShowMilitaryMenu(false);
        await prepareForPrimaryNavigation();
        setView('trainingGround');
    };

    const onOpenEquipment = async () => {
        setShowMilitaryMenu(false);
        await prepareForPrimaryNavigation();
        setView('equipment');
    };

    const onOpenAdmin = () => {
        setShowMilitaryMenu(false);
        openAdminPanel('users');
    };

    const militaryMenuPanelNode = (
        <div className="military-menu-panel">
            {!isAdmin ? (
                <>
                    <button type="button" className="military-menu-item" onClick={onOpenArmy}>
                        兵营
                    </button>
                    <button type="button" className="military-menu-item" onClick={onOpenTrainingGround}>
                        训练场
                    </button>
                    <button type="button" className="military-menu-item" onClick={onOpenEquipment}>
                        装备库
                    </button>
                </>
            ) : (
                <button type="button" className="military-menu-item" onClick={onOpenAdmin}>
                    管理员面板
                </button>
            )}
        </div>
    );

    return (
    <>
        <GameHeader
            headerRef={headerRef}
            isKnowledgeDomainActive={isKnowledgeDomainActive}
            isCompact={isCompact}
            isMobileLayout={isMobileLayout}
            isMobileSuppressed={shouldPromoteSceneTopPanel}
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
            relatedDomainsWrapperRef={relatedDomainsWrapperRef}
            onToggleRelatedDomains={toggleRelatedDomainsPanel}
            relatedDomainCount={relatedDomainCount}
            relatedDomainsPanel={isMobileLayout ? null : relatedDomainsPanelNode}
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
            onOpenArmy={onOpenArmy}
            onOpenTrainingGround={onOpenTrainingGround}
            onOpenEquipment={onOpenEquipment}
            onOpenAdmin={onOpenAdmin}
        />

        {isMobileLayout ? (
            <MobileBottomBar
                relatedDomainsWrapperRef={relatedDomainsWrapperRef}
                militaryMenuWrapperRef={militaryMenuWrapperRef}
                relatedDomainCount={relatedDomainCount}
                relatedDomainsPanel={relatedDomainsPanelNode}
                showMilitaryMenu={showMilitaryMenu}
                militaryMenuPanel={militaryMenuPanelNode}
                isAdmin={isAdmin}
                activeView={
                    showRelatedDomainsPanel
                        ? 'related'
                        : view === 'admin'
                            ? 'admin'
                            : showMilitaryMenu
                            ? 'military'
                            : view
                }
                onHomeClick={async () => {
                    closeHeaderPanels();
                    await handleHeaderHomeNavigation();
                }}
                onToggleRelatedDomains={toggleRelatedDomainsPanel}
                onAllianceClick={async () => {
                    closeHeaderPanels();
                    await prepareForPrimaryNavigation();
                    setView('alliance');
                }}
                onToggleMilitaryMenu={toggleMilitaryMenu}
                onOpenAdmin={onOpenAdmin}
                onProfileClick={async () => {
                    closeHeaderPanels();
                    await prepareForPrimaryNavigation();
                    setView('profile');
                }}
            />
        ) : null}

        <UnifiedRightDock
            isAdmin={isAdmin}
            showKnowledgeDomain={showKnowledgeDomain}
            isTransitioningToDomain={isTransitioningToDomain}
            view={view}
            currentTitleDetail={currentTitleDetail}
            currentNodeDetail={currentNodeDetail}
            isAnnouncementDockExpanded={isAnnouncementDockExpanded}
            setIsAnnouncementDockExpanded={setIsAnnouncementDockExpanded}
            messageDockTab={messageDockTab}
            setMessageDockTab={setMessageDockTab}
            notifications={notifications}
            adminPendingNodes={adminPendingNodes}
            fetchNotifications={fetchNotifications}
            fetchAdminPendingNodeReminders={fetchAdminPendingNodeReminders}
            notificationUnreadCount={notificationUnreadCount}
            isNotificationsLoading={isNotificationsLoading}
            isMarkingAllRead={isMarkingAllRead}
            clearNotifications={clearNotifications}
            isClearingNotifications={isClearingNotifications}
            notificationActionId={notificationActionId}
            handleDistributionAnnouncementClick={handleDistributionAnnouncementClick}
            handleArrivalNotificationClick={handleArrivalNotificationClick}
            handleSenseArticleNotificationClick={handleSenseArticleNotificationClick}
            markNotificationRead={markNotificationRead}
            markAllNotificationsRead={markAllNotificationsRead}
            respondDomainAdminInvite={respondDomainAdminInvite}
            openAdminPanel={openAdminPanel}
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
    openSenseArticleFromNode,
    onClose
}) => {
    const { openUserCard } = useUserCard();
    const [isMobileLayout, setIsMobileLayout] = useState(readIsMobileShell);
    const [latchedSelectorNode, setLatchedSelectorNode] = useState(null);
    const [latchedAnchor, setLatchedAnchor] = useState({ x: 0, y: 0, visible: false });
    const [viewportSize, setViewportSize] = useState(readViewportSize);
    const [desktopPanelSize, setDesktopPanelSize] = useState(DEFAULT_DESKTOP_PANEL_SIZE);
    const openedAtRef = useRef(0);
    const isSupportedView = view === 'home' || view === 'nodeDetail' || view === 'titleDetail';

    useEffect(() => {
        const handleResize = () => {
            setIsMobileLayout(readIsMobileShell());
            setViewportSize(readViewportSize());
        };
        window.addEventListener('resize', handleResize);
        window.visualViewport?.addEventListener('resize', handleResize);
        window.visualViewport?.addEventListener('scroll', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            window.visualViewport?.removeEventListener('resize', handleResize);
            window.visualViewport?.removeEventListener('scroll', handleResize);
        };
    }, []);

    const liveSelectorNode = (() => {
        if (view === 'titleDetail' && currentTitleDetail) return currentTitleDetail;
        if (view === 'nodeDetail' && currentNodeDetail) return currentNodeDetail;
        return senseSelectorSourceNode || null;
    })();

    useEffect(() => {
        if (!isSenseSelectorVisible) {
            setLatchedSelectorNode(null);
            return;
        }
        if (liveSelectorNode) {
            setLatchedSelectorNode((prev) => (
                normalizeObjectId(prev?._id) === normalizeObjectId(liveSelectorNode?._id)
                    ? prev
                    : liveSelectorNode
            ));
        }
    }, [isSenseSelectorVisible, liveSelectorNode]);

    useEffect(() => {
        if (!isSenseSelectorVisible) {
            setLatchedAnchor({ x: 0, y: 0, visible: false });
            return;
        }
        if (senseSelectorAnchor?.visible) {
            setLatchedAnchor(senseSelectorAnchor);
        }
    }, [isSenseSelectorVisible, senseSelectorAnchor]);

    useEffect(() => {
        if (isSenseSelectorVisible) {
            openedAtRef.current = Date.now();
        }
    }, [isSenseSelectorVisible]);

    useEffect(() => {
        if (!isSenseSelectorVisible || !panelRef?.current || isMobileLayout) return undefined;
        const panelElement = panelRef.current;
        const updatePanelSize = () => {
            const rect = panelElement.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            setDesktopPanelSize({
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            });
        };
        updatePanelSize();
        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => updatePanelSize())
            : null;
        resizeObserver?.observe(panelElement);
        window.addEventListener('resize', updatePanelSize);
        window.visualViewport?.addEventListener('resize', updatePanelSize);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updatePanelSize);
            window.visualViewport?.removeEventListener('resize', updatePanelSize);
        };
    }, [isMobileLayout, isSenseSelectorVisible, panelRef]);

    useEffect(() => {
        if (!isSenseSelectorVisible) return undefined;
        const handlePointerDown = (event) => {
            if (Date.now() - openedAtRef.current < 180) return;
            const panelElement = panelRef?.current;
            if (panelElement && panelElement.contains(event.target)) return;
            onClose?.();
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [isSenseSelectorVisible, onClose, panelRef]);

    const selectorNode = liveSelectorNode || latchedSelectorNode || null;
    const effectiveAnchor = (!isMobileLayout && senseSelectorAnchor?.visible)
        ? senseSelectorAnchor
        : latchedAnchor;

    if (!isSupportedView) return null;
    if (!selectorNode) return null;
    if (!isSenseSelectorVisible || (!isMobileLayout && !effectiveAnchor.visible)) return null;

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
    const panelThemeStyle = {
        background: `linear-gradient(120deg, ${hexToRgba(style.primaryColor || '#1e293b', 0.76)} 0%, ${hexToRgba(style.secondaryColor || '#334155', 0.68)} 100%)`,
        borderColor: hexToRgba(style.rimColor || style.primaryColor || '#a855f7', 0.74),
        color: style.textColor || '#f8fafc'
    };
    const desktopPanelStyle = (() => {
        const viewportWidth = viewportSize.width;
        const viewportHeight = viewportSize.height;
        const panelWidth = Math.min(Math.max(420, Math.round(viewportWidth * 0.76)), Math.max(420, desktopPanelSize.width));
        const panelHeight = Math.max(360, desktopPanelSize.height);
        const minCenterX = SENSE_SELECTOR_EDGE_MARGIN + panelWidth / 2;
        const maxCenterX = viewportWidth - SENSE_SELECTOR_EDGE_MARGIN - panelWidth / 2;
        const minCenterY = SENSE_SELECTOR_EDGE_MARGIN + panelHeight / 2;
        const maxCenterY = viewportHeight - SENSE_SELECTOR_EDGE_MARGIN - panelHeight / 2;
        const preferredRightCenterX = effectiveAnchor.x + SENSE_SELECTOR_DESKTOP_GAP + panelWidth / 2;
        const preferredLeftCenterX = effectiveAnchor.x - SENSE_SELECTOR_DESKTOP_GAP - panelWidth / 2;
        let left = preferredRightCenterX;
        if (preferredRightCenterX > maxCenterX) {
            left = preferredLeftCenterX >= minCenterX
                ? preferredLeftCenterX
                : Math.min(maxCenterX, Math.max(minCenterX, effectiveAnchor.x));
        }
        const top = Math.min(maxCenterY, Math.max(minCenterY, effectiveAnchor.y));
        return {
            ...panelThemeStyle,
            left: `${Math.round(left)}px`,
            top: `${Math.round(top)}px`
        };
    })();

    const detailContent = (
        <>
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
        </>
    );

    if (isMobileLayout) {
        return (
            <div
                className="sense-selector-overlay is-mobile"
                onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                        onClose?.();
                    }
                }}
            >
                <section
                    ref={panelRef}
                    className="sense-selector-mobile-page"
                    style={panelThemeStyle}
                >
                    <div className="sense-selector-mobile-bar">
                        <button
                            type="button"
                            className="sense-selector-mobile-back"
                            onClick={onClose}
                            aria-label="返回"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <div className="sense-selector-mobile-bar-text">节点信息</div>
                    </div>
                    <div className="sense-selector-mobile-page__body">
                        {detailContent}
                    </div>
                </section>
            </div>
        );
    }

    return (
        <div
            ref={panelRef}
            className="sense-selector-panel sense-selector-panel--desktop"
            style={desktopPanelStyle}
        >
            <button
                type="button"
                className="sense-selector-desktop-close"
                onClick={onClose}
                aria-label="关闭"
            >
                <X size={16} />
            </button>
            {detailContent}
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
