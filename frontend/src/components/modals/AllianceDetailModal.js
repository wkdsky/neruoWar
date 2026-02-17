import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Zap, X } from 'lucide-react';
import './AllianceDetailModal.css';
import AllianceStylePreview from './AllianceStylePreview';
import {
    ALLIANCE_PATTERN_OPTIONS,
    DEFAULT_ALLIANCE_VISUAL_STYLE,
    getActiveAllianceVisualStyle,
    normalizeAllianceVisualStyle
} from '../../utils/allianceVisualStyle';

const EMPTY_ITEMS = [];

const AllianceDetailModal = ({ 
    isOpen, 
    onClose, 
    selectedAlliance, 
    userAlliance, 
    onJoin, 
    onLeave, 
    onTransferLeadership,
    isAdmin,
    currentUsername,
    token,
    onRefreshAllianceDetail,
    onAllianceChanged
}) => {
    const alliance = selectedAlliance?.alliance || null;
    const members = selectedAlliance?.members || EMPTY_ITEMS;
    const domains = selectedAlliance?.domains || EMPTY_ITEMS;
    const isCurrentAllianceMember = Boolean(userAlliance && userAlliance._id === alliance?._id);
    const isCurrentUserFounder = Boolean(
        isCurrentAllianceMember &&
        alliance?.founder?.username &&
        currentUsername &&
        alliance.founder.username === currentUsername
    );
    const successorCandidates = useMemo(
        () => (members || []).filter((member) => member.username !== currentUsername),
        [members, currentUsername]
    );
    const removableMembers = useMemo(
        () => members.filter((member) => member.username !== currentUsername),
        [members, currentUsername]
    );
    const [handoverKeyword, setHandoverKeyword] = useState('');
    const [selectedSuccessorId, setSelectedSuccessorId] = useState('');
    const [handoverMode, setHandoverMode] = useState('');
    const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
    const [handoverError, setHandoverError] = useState('');
    const [handoverSubmitting, setHandoverSubmitting] = useState(false);
    const [confirmState, setConfirmState] = useState({
        open: false,
        title: '',
        message: '',
        confirmText: '',
        action: ''
    });
    const isLeaderManager = !isAdmin && isCurrentUserFounder;
    const [activeTab, setActiveTab] = useState('overview');
    const [pendingApplications, setPendingApplications] = useState([]);
    const [isManageLoading, setIsManageLoading] = useState(false);
    const [manageActionKey, setManageActionKey] = useState('');
    const [announcementDraft, setAnnouncementDraft] = useState('');
    const [declarationDraft, setDeclarationDraft] = useState('');
    const [knowledgeContributionDraft, setKnowledgeContributionDraft] = useState('10');
    const [styleDraft, setStyleDraft] = useState(DEFAULT_ALLIANCE_VISUAL_STYLE);
    const [isStyleCreatorOpen, setIsStyleCreatorOpen] = useState(false);
    const activeVisualStyle = useMemo(
        () => getActiveAllianceVisualStyle(alliance),
        [alliance]
    );

    useEffect(() => {
        if (!isOpen) {
            setActiveTab('overview');
            setPendingApplications([]);
            setIsStyleCreatorOpen(false);
            setIsHandoverModalOpen(false);
            setHandoverMode('');
            setHandoverKeyword('');
            setSelectedSuccessorId('');
            setHandoverError('');
            setHandoverSubmitting(false);
            setConfirmState({
                open: false,
                title: '',
                message: '',
                confirmText: '',
                action: ''
            });
            return;
        }
        if (!isCurrentUserFounder) {
            setSelectedSuccessorId('');
            return;
        }
        setSelectedSuccessorId((prev) => (
            successorCandidates.some((member) => member._id === prev) ? prev : ''
        ));
    }, [isOpen, alliance?._id, isCurrentUserFounder, successorCandidates]);

    useEffect(() => {
        if (!isOpen || !alliance) return;
        setAnnouncementDraft(alliance.announcement || '');
        setDeclarationDraft(alliance.declaration || '');
        setKnowledgeContributionDraft(String(alliance.knowledgeContributionPercent ?? 10));
        setStyleDraft(normalizeAllianceVisualStyle({
            ...activeVisualStyle,
            name: `${alliance.name || '熵盟'}风格${(alliance.visualStyles || []).length + 1}`
        }, `风格${(alliance.visualStyles || []).length + 1}`));
    }, [isOpen, alliance?._id, alliance?.announcement, alliance?.declaration, alliance?.name, alliance?.visualStyles, alliance?.knowledgeContributionPercent, activeVisualStyle]);

    // Handler for stopping propagation of clicks to the backdrop
    const handleContentClick = (e) => {
        e.stopPropagation();
    };

    const filteredSuccessorCandidates = useMemo(() => {
        const keyword = handoverKeyword.trim().toLowerCase();
        if (!keyword) return successorCandidates;
        return successorCandidates.filter((member) => {
            const username = (member.username || '').toLowerCase();
            const profession = (member.profession || '').toLowerCase();
            return username.includes(keyword) || profession.includes(keyword);
        });
    }, [successorCandidates, handoverKeyword]);

    const closeHandoverModal = () => {
        setIsHandoverModalOpen(false);
        setHandoverMode('');
        setHandoverKeyword('');
        setSelectedSuccessorId('');
        setHandoverError('');
    };

    const openHandoverModal = (mode) => {
        if (!isCurrentUserFounder) return;
        setHandoverMode(mode);
        setIsHandoverModalOpen(true);
        setHandoverKeyword('');
        setHandoverError('');
        setSelectedSuccessorId((prev) => (
            successorCandidates.some((item) => item._id === prev) ? prev : ''
        ));
    };

    const closeConfirmModal = () => {
        setConfirmState({
            open: false,
            title: '',
            message: '',
            confirmText: '',
            action: ''
        });
    };

    const fetchPendingApplications = useCallback(async (silent = false) => {
        if (!token || !isLeaderManager || !alliance?._id) {
            setPendingApplications([]);
            return;
        }

        setIsManageLoading(true);
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/leader/${alliance._id}/pending-applications`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const raw = await response.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (parseError) {
                if (!silent) {
                    window.alert('获取入盟申请失败：返回格式异常');
                }
                setPendingApplications([]);
                return;
            }
            if (response.ok) {
                setPendingApplications(data.applications || []);
            } else {
                setPendingApplications([]);
                if (!silent) {
                    window.alert(data.error || '获取入盟申请失败');
                }
            }
        } catch (error) {
            if (!silent) {
                window.alert(`获取入盟申请失败: ${error.message}`);
            }
        } finally {
            setIsManageLoading(false);
        }
    }, [token, isLeaderManager, alliance?._id]);

    useEffect(() => {
        if (isOpen && isLeaderManager) {
            fetchPendingApplications(true);
        }
    }, [isOpen, isLeaderManager, alliance?._id, fetchPendingApplications]);

    useEffect(() => {
        if (isOpen && activeTab === 'manage' && isLeaderManager) {
            fetchPendingApplications(false);
        }
    }, [isOpen, activeTab, isLeaderManager, alliance?._id, fetchPendingApplications]);

    const handleApplicationDecision = async (notificationId, action) => {
        if (!token || !notificationId) return;

        const actionKey = `${notificationId}:${action}`;
        setManageActionKey(actionKey);
        try {
            const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/respond`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ action })
            });
            const data = await response.json();
            if (!response.ok) {
                window.alert(data.error || '处理入盟申请失败');
                return;
            }
            window.alert(data.message || '处理完成');
            await fetchPendingApplications();
            if (typeof onAllianceChanged === 'function') {
                await onAllianceChanged(alliance._id);
            }
        } catch (error) {
            window.alert(`处理入盟申请失败: ${error.message}`);
        } finally {
            setManageActionKey('');
        }
    };

    const handleRemoveMember = async (member) => {
        if (!token || !member?._id) return;
        if (!window.confirm(`确定将 ${member.username} 移出熵盟吗？`)) return;

        const actionKey = `kick:${member._id}`;
        setManageActionKey(actionKey);
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/leader/${alliance._id}/remove-member`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ memberId: member._id })
            });
            const data = await response.json();
            if (!response.ok) {
                window.alert(data.error || '移除成员失败');
                return;
            }
            window.alert(data.message || '成员已移除');
            const dissolved = (data.message || '').includes('自动解散');
            if (typeof onAllianceChanged === 'function') {
                await onAllianceChanged(dissolved ? '' : alliance._id);
            }
            if (dissolved) {
                onClose();
                return;
            }
            if (typeof onRefreshAllianceDetail === 'function') {
                await onRefreshAllianceDetail(alliance._id);
            }
        } catch (error) {
            window.alert(`移除成员失败: ${error.message}`);
        } finally {
            setManageActionKey('');
        }
    };

    const handleSaveManageContent = async (payload, fallbackError) => {
        if (!token) return false;
        setManageActionKey('save:manage');
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/leader/${alliance._id}/manage`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok) {
                window.alert(data.error || fallbackError);
                return false;
            }
            window.alert(data.message || '更新成功');
            if (typeof onAllianceChanged === 'function') {
                await onAllianceChanged(alliance._id);
            }
            if (typeof onRefreshAllianceDetail === 'function') {
                await onRefreshAllianceDetail(alliance._id);
            }
            return true;
        } catch (error) {
            window.alert(`${fallbackError}: ${error.message}`);
            return false;
        } finally {
            setManageActionKey('');
        }
    };

    const handlePublishAnnouncement = async () => {
        await handleSaveManageContent(
            { announcement: announcementDraft },
            '发布盟公告失败'
        );
    };

    const handleUpdateDeclaration = async () => {
        await handleSaveManageContent(
            { declaration: declarationDraft },
            '更新盟宣言失败'
        );
    };

    const handleUpdateKnowledgeContribution = async () => {
        const parsed = parseFloat(knowledgeContributionDraft);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
            window.alert('知识贡献比例必须在 0-100 之间');
            return;
        }
        await handleSaveManageContent(
            { knowledgeContributionPercent: parsed },
            '更新知识贡献比例失败'
        );
    };

    const handleCreateVisualStyle = async () => {
        const normalizedStyle = normalizeAllianceVisualStyle(styleDraft, `风格${(alliance?.visualStyles || []).length + 1}`);
        if (!normalizedStyle.name) {
            window.alert('样式名称不能为空');
            return false;
        }
        const ok = await handleSaveManageContent(
            { createVisualStyle: normalizedStyle },
            '新建视觉样式失败'
        );
        return ok;
    };

    const handleActivateVisualStyle = async (styleId) => {
        if (!styleId) return;
        await handleSaveManageContent(
            { activateVisualStyleId: styleId },
            '启用视觉样式失败'
        );
    };

    const handleDeleteVisualStyle = async (styleId, styleName) => {
        if (!styleId) return;
        if (!window.confirm(`确定删除视觉样式「${styleName || '未命名'}」吗？`)) return;
        await handleSaveManageContent(
            { deleteVisualStyleId: styleId },
            '删除视觉样式失败'
        );
    };

    const handleOpenHandoverConfirm = () => {
        if (!isCurrentUserFounder) return;
        const hasCandidates = successorCandidates.length > 0;
        if (!hasCandidates && handoverMode === 'transfer') {
            setHandoverError('当前没有可交接的其他成员，无法转交盟主');
            return;
        }
        if (hasCandidates && !selectedSuccessorId) {
            setHandoverError('请先选择一位新盟主');
            return;
        }
        setHandoverError('');
        if (handoverMode === 'leave') {
            setConfirmState({
                open: true,
                title: '确认退盟',
                message: hasCandidates
                    ? '盟主身份将先转交给所选成员，然后你将退出熵盟。该操作无法撤回，是否继续？'
                    : '当前没有其他成员可交接，退盟后熵盟可能解散。该操作无法撤回，是否继续？',
                confirmText: '确认退盟',
                action: 'leader_leave'
            });
            return;
        }
        setConfirmState({
            open: true,
            title: '确认转交盟主',
            message: '你将卸任盟主并保留普通成员身份。该操作无法撤回，是否继续？',
            confirmText: '确认转交',
            action: 'leader_transfer'
        });
    };

    const executeLeaderAction = async () => {
        if (!confirmState.action || handoverSubmitting) return;
        setHandoverSubmitting(true);
        try {
            if (confirmState.action === 'member_leave') {
                const ok = await onLeave('');
                if (ok) {
                    closeConfirmModal();
                }
                return;
            }
            if (confirmState.action === 'leader_leave') {
                const nextLeaderId = successorCandidates.length > 0 ? selectedSuccessorId : '';
                const ok = await onLeave(nextLeaderId);
                if (ok) {
                    closeConfirmModal();
                    closeHandoverModal();
                }
                return;
            }
            if (confirmState.action === 'leader_transfer') {
                if (!selectedSuccessorId) {
                    setHandoverError('请先选择一位新盟主');
                    closeConfirmModal();
                    return;
                }
                const ok = await onTransferLeadership?.(alliance._id, selectedSuccessorId);
                if (ok) {
                    closeConfirmModal();
                    closeHandoverModal();
                    if (typeof onAllianceChanged === 'function') {
                        await onAllianceChanged(alliance._id);
                    }
                    if (typeof onRefreshAllianceDetail === 'function') {
                        await onRefreshAllianceDetail(alliance._id);
                    }
                }
            }
        } finally {
            setHandoverSubmitting(false);
        }
    };

    if (!isOpen || !selectedAlliance || !alliance) return null;

    const renderMemberGrid = (withManageActions = false) => (
        <div className="members-list">
            {members.map((member) => (
                <div key={member._id} className="member-item">
                    <Users className="icon-small" />
                    <span className="member-name">
                        {member.username}
                        {member.profession && ` 【${member.profession}】`}
                    </span>
                    <span className="member-level">Lv.{member.level}</span>
                    {withManageActions && member.username !== currentUsername && (
                        <button
                            type="button"
                            className="btn btn-small btn-danger"
                            onClick={() => handleRemoveMember(member)}
                            disabled={manageActionKey === `kick:${member._id}`}
                        >
                            移出熵盟
                        </button>
                    )}
                </div>
            ))}
        </div>
    );

    const renderMembersList = (withManageActions = false) => (
        <div className="alliance-section-detail">
            <h3>成员列表 ({members.length}人)</h3>
            {renderMemberGrid(withManageActions)}
        </div>
    );

    const renderDomainsList = () => (
        <div className="alliance-section-detail">
            <h3>管辖知识域 ({domains.length}个)</h3>
            <div className="domains-list">
                {domains.length > 0 ? (
                    domains.map((domain) => (
                        <div key={domain._id} className="domain-item">
                            <Zap className="icon-small" />
                            <div className="domain-info">
                                <span className="domain-name">{domain.name}</span>
                                <span className="domain-master">
                                    域主: {domain.domainMaster?.username || '暂无'}
                                    {domain.domainMaster?.profession && ` 【${domain.domainMaster.profession}】`}
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <p className="empty-message">该熵盟暂无管辖知识域</p>
                )}
            </div>
        </div>
    );

    const renderOverviewTab = () => (
        <>
            <div className="alliance-section-detail">
                <h3>盟公告</h3>
                {alliance.announcement ? (
                    <div className="alliance-announcement-content">{alliance.announcement}</div>
                ) : (
                    <p className="empty-message">暂无盟公告</p>
                )}
                {alliance.announcementUpdatedAt && (
                    <div className="alliance-announcement-time">
                        最近发布: {new Date(alliance.announcementUpdatedAt).toLocaleString('zh-CN')}
                    </div>
                )}
            </div>
            {renderMembersList(false)}
            {renderDomainsList()}
        </>
    );

    const renderManageTab = () => (
        <>
            <div className="alliance-section-detail">
                <h3>入盟申请</h3>
                {isManageLoading ? (
                    <p className="empty-message">加载中...</p>
                ) : pendingApplications.length === 0 ? (
                    <p className="empty-message">当前没有待处理入盟申请</p>
                ) : (
                    <div className="alliance-apply-list">
                        {pendingApplications.map((item) => {
                            const acceptKey = `${item.notificationId}:accept`;
                            const rejectKey = `${item.notificationId}:reject`;
                            return (
                                <div key={item.notificationId} className="alliance-apply-item">
                                    <div className="alliance-apply-main">
                                        <strong>{item.applicantUsername}</strong>
                                        <span>{item.message || '申请加入熵盟'}</span>
                                    </div>
                                    <div className="alliance-apply-meta">
                                        {item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : ''}
                                    </div>
                                    <div className="alliance-apply-actions">
                                        <button
                                            type="button"
                                            className="btn btn-small btn-success"
                                            onClick={() => handleApplicationDecision(item.notificationId, 'accept')}
                                            disabled={manageActionKey === acceptKey || manageActionKey === rejectKey}
                                        >
                                            同意
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-small btn-danger"
                                            onClick={() => handleApplicationDecision(item.notificationId, 'reject')}
                                            disabled={manageActionKey === acceptKey || manageActionKey === rejectKey}
                                        >
                                            拒绝
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="alliance-section-detail">
                <h3>成员管理</h3>
                {removableMembers.length === 0 ? (
                    <p className="empty-message">当前没有可移除成员</p>
                ) : renderMemberGrid(true)}
            </div>

            <div className="alliance-section-detail">
                <h3>知识贡献比例（Z%）</h3>
                <div className="alliance-manage-inline">
                    <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        className="form-input"
                        value={knowledgeContributionDraft}
                        onChange={(event) => setKnowledgeContributionDraft(event.target.value)}
                    />
                    <button
                        type="button"
                        className="btn btn-small btn-primary"
                        onClick={handleUpdateKnowledgeContribution}
                        disabled={manageActionKey === 'save:manage'}
                    >
                        保存比例
                    </button>
                </div>
                <p className="empty-message">该比例用于域主知识点分发时贡献给熵盟的固定占比（Z%）。</p>
            </div>

            <div className="alliance-section-detail">
                <h3>知识域视觉样式</h3>
                <div className="alliance-style-list">
                    {(alliance.visualStyles || []).map((styleItem) => {
                        const styleId = (styleItem?._id || '').toString();
                        const isActive = (alliance.activeVisualStyleId || '').toString() === styleId;
                        return (
                            <div key={styleId || styleItem.name} className={`alliance-style-item ${isActive ? 'active' : ''}`}>
                                <div className="alliance-style-item-header">
                                    <strong>{styleItem.name || '未命名风格'}</strong>
                                    {isActive && <span className="alliance-style-active-badge">启用中</span>}
                                </div>
                                <AllianceStylePreview styleConfig={styleItem} label="示例" className="compact" />
                                <div className="alliance-style-item-actions">
                                    {!isActive && (
                                        <button
                                            type="button"
                                            className="btn btn-small btn-success"
                                            onClick={() => handleActivateVisualStyle(styleId)}
                                            disabled={manageActionKey === 'save:manage'}
                                        >
                                            启用
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="btn btn-small btn-danger"
                                        onClick={() => handleDeleteVisualStyle(styleId, styleItem.name)}
                                        disabled={manageActionKey === 'save:manage' || (alliance.visualStyles || []).length <= 1}
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="alliance-style-create-entry">
                    <button
                        type="button"
                        className="btn btn-small btn-primary"
                        onClick={() => {
                            const nextIndex = (alliance?.visualStyles || []).length + 1;
                            setStyleDraft(normalizeAllianceVisualStyle({
                                ...activeVisualStyle,
                                name: `${alliance?.name || '熵盟'}风格${nextIndex}`
                            }, `风格${nextIndex}`));
                            setIsStyleCreatorOpen(true);
                        }}
                        disabled={manageActionKey === 'save:manage'}
                    >
                        新建样式
                    </button>
                </div>
            </div>

            <div className="alliance-section-detail">
                <h3>盟公告发布</h3>
                <textarea
                    className="form-textarea"
                    rows={4}
                    value={announcementDraft}
                    onChange={(event) => setAnnouncementDraft(event.target.value)}
                    placeholder="输入最新盟公告（可清空）"
                />
                <div className="alliance-manage-actions">
                    <button
                        type="button"
                        className="btn btn-small btn-primary"
                        onClick={handlePublishAnnouncement}
                        disabled={manageActionKey === 'save:manage'}
                    >
                        发布盟公告
                    </button>
                </div>
            </div>

            <div className="alliance-section-detail">
                <h3>盟宣言维护</h3>
                <textarea
                    className="form-textarea"
                    rows={4}
                    value={declarationDraft}
                    onChange={(event) => setDeclarationDraft(event.target.value)}
                    placeholder="输入盟宣言"
                />
                <div className="alliance-manage-actions">
                    <button
                        type="button"
                        className="btn btn-small btn-warning"
                        onClick={handleUpdateDeclaration}
                        disabled={manageActionKey === 'save:manage'}
                    >
                        更新盟宣言
                    </button>
                </div>
            </div>
        </>
    );

    const renderStyleCreatorModal = () => {
        if (!isStyleCreatorOpen) return null;
        return (
            <div
                className="alliance-style-creator-backdrop"
                onClick={(event) => {
                    event.stopPropagation();
                    setIsStyleCreatorOpen(false);
                }}
            >
                <div className="alliance-style-creator-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="alliance-style-creator-header">
                        <h4>新建视觉样式</h4>
                        <button
                            type="button"
                            className="modal-close"
                            onClick={() => setIsStyleCreatorOpen(false)}
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <div className="alliance-style-creator-content">
                        <div className="alliance-style-creator-left">
                            <div className="alliance-style-form-grid">
                                <label className="mini-field">
                                    <span>样式名称</span>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={styleDraft.name}
                                        onChange={(event) => setStyleDraft((prev) => ({ ...prev, name: event.target.value }))}
                                        placeholder="输入新样式名称"
                                    />
                                </label>
                                <label className="mini-field">
                                    <span>底纹类型</span>
                                    <select
                                        className="form-input alliance-style-select"
                                        value={styleDraft.patternType}
                                        onChange={(event) => setStyleDraft((prev) => ({ ...prev, patternType: event.target.value }))}
                                    >
                                        {ALLIANCE_PATTERN_OPTIONS.map((item) => (
                                            <option key={item.value} value={item.value}>{item.label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <div className="alliance-style-color-stack">
                                <label className="alliance-style-color-line">
                                    <span>主色</span>
                                    <input
                                        type="color"
                                        className="color-picker"
                                        value={styleDraft.primaryColor}
                                        onChange={(event) => setStyleDraft((prev) => ({ ...prev, primaryColor: event.target.value }))}
                                    />
                                </label>
                                <label className="alliance-style-color-line">
                                    <span>辅色</span>
                                    <input
                                        type="color"
                                        className="color-picker"
                                        value={styleDraft.secondaryColor}
                                        onChange={(event) => setStyleDraft((prev) => ({ ...prev, secondaryColor: event.target.value }))}
                                    />
                                </label>
                                <label className="alliance-style-color-line">
                                    <span>发光</span>
                                    <input
                                        type="color"
                                        className="color-picker"
                                        value={styleDraft.glowColor}
                                        onChange={(event) => setStyleDraft((prev) => ({ ...prev, glowColor: event.target.value }))}
                                    />
                                </label>
                                <label className="alliance-style-color-line">
                                    <span>高光边</span>
                                    <input
                                        type="color"
                                        className="color-picker"
                                        value={styleDraft.rimColor}
                                        onChange={(event) => setStyleDraft((prev) => ({ ...prev, rimColor: event.target.value }))}
                                    />
                                </label>
                                <label className="alliance-style-color-line">
                                    <span>字体色</span>
                                    <input
                                        type="color"
                                        className="color-picker"
                                        value={styleDraft.textColor}
                                        onChange={(event) => setStyleDraft((prev) => ({ ...prev, textColor: event.target.value }))}
                                    />
                                </label>
                            </div>
                            <div className="alliance-manage-actions">
                                <button
                                    type="button"
                                    className="btn btn-small btn-secondary"
                                    onClick={() => setIsStyleCreatorOpen(false)}
                                >
                                    取消
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-small btn-primary"
                                    onClick={async () => {
                                        const ok = await handleCreateVisualStyle();
                                        if (ok) {
                                            setIsStyleCreatorOpen(false);
                                        }
                                    }}
                                    disabled={manageActionKey === 'save:manage' || !styleDraft.name.trim()}
                                >
                                    创建样式
                                </button>
                            </div>
                        </div>
                        <div className="alliance-style-creator-right">
                            <AllianceStylePreview styleConfig={styleDraft} label="示例" />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content alliance-detail-modal" onClick={handleContentClick}>
                <div className="modal-header">
                    <h2>熵盟详情</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>
                <div className="modal-body">
                    {/* Basic Alliance Info */}
                    <div className="alliance-detail-header">
                        <div className="alliance-flag-huge" style={{ backgroundColor: alliance.flag }}></div>
                        <div className="alliance-main-info">
                            <h2>{alliance.name}</h2>
                            <p className="declaration-text">{alliance.declaration}</p>
                            <div className="alliance-meta">
                                <span>盟主: {alliance.founder?.username || '未知'}
                                    {alliance.founder?.profession && ` 【${alliance.founder.profession}】`}
                                </span>
                                <span>成立时间: {new Date(alliance.createdAt).toLocaleDateString('zh-CN')}</span>
                            </div>
                            <div className="alliance-stats-large">
                                <div className="stat-box">
                                    <Users className="icon" />
                                    <div>
                                        <span className="stat-number">{alliance.memberCount}</span>
                                        <span className="stat-label">成员</span>
                                    </div>
                                </div>
                                <div className="stat-box">
                                    <Zap className="icon" />
                                    <div>
                                        <span className="stat-number">{alliance.domainCount}</span>
                                        <span className="stat-label">管辖域</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="alliance-tab-bar">
                        <button
                            type="button"
                            className={`alliance-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                            onClick={() => setActiveTab('overview')}
                        >
                            概览
                        </button>
                        <button
                            type="button"
                            className={`alliance-tab-btn ${activeTab === 'members' ? 'active' : ''}`}
                            onClick={() => setActiveTab('members')}
                        >
                            成员
                        </button>
                        <button
                            type="button"
                            className={`alliance-tab-btn ${activeTab === 'domains' ? 'active' : ''}`}
                            onClick={() => setActiveTab('domains')}
                        >
                            管辖域
                        </button>
                        {isLeaderManager && (
                            <button
                                type="button"
                                className={`alliance-tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
                                onClick={() => setActiveTab('manage')}
                            >
                                盟主管理
                                {pendingApplications.length > 0 && (
                                    <span className="alliance-tab-badge">
                                        {pendingApplications.length > 99 ? '99+' : pendingApplications.length}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>

                    {activeTab === 'overview' && renderOverviewTab()}
                    {activeTab === 'members' && renderMembersList(false)}
                    {activeTab === 'domains' && renderDomainsList()}
                    {activeTab === 'manage' && isLeaderManager && renderManageTab()}
                </div>

                <div className="modal-footer">
                    {!isAdmin && (
                        <>
                            {isCurrentAllianceMember ? (
                                isCurrentUserFounder ? (
                                    <div className="alliance-leader-footer-actions">
                                        <button
                                            type="button"
                                            className="btn btn-danger"
                                            onClick={() => openHandoverModal('leave')}
                                        >
                                            退盟
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-warning"
                                            onClick={() => openHandoverModal('transfer')}
                                            disabled={successorCandidates.length === 0}
                                            title={successorCandidates.length === 0 ? '暂无其他成员可转交盟主' : '卸任并转交盟主'}
                                        >
                                            卸任
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        className="btn btn-danger"
                                        onClick={() => setConfirmState({
                                            open: true,
                                            title: '确认退盟',
                                            message: '你将退出当前熵盟，是否继续？',
                                            confirmText: '确认退盟',
                                            action: 'member_leave'
                                        })}
                                    >
                                        退出熵盟
                                    </button>
                                )
                            ) : !userAlliance ? (
                                <button className="btn btn-primary" onClick={() => onJoin(alliance._id)}>申请加入熵盟</button>
                            ) : null}
                        </>
                    )}
                    <button className="btn btn-secondary" onClick={onClose}>关闭</button>
                </div>
            </div>
            {isHandoverModalOpen && (
                <div className="alliance-handover-backdrop" onClick={closeHandoverModal}>
                    <div className="alliance-handover-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="alliance-handover-header">
                            <h4>{handoverMode === 'transfer' ? '转交盟主' : '退盟交接'}</h4>
                            <button type="button" className="modal-close" onClick={closeHandoverModal}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="alliance-handover-body">
                            <input
                                type="text"
                                className="form-input"
                                placeholder="搜索成员用户名/职业"
                                value={handoverKeyword}
                                onChange={(event) => setHandoverKeyword(event.target.value)}
                            />
                            <div className="alliance-handover-list">
                                {filteredSuccessorCandidates.length === 0 ? (
                                    <div className="empty-message">没有匹配的成员</div>
                                ) : (
                                    filteredSuccessorCandidates.map((member) => (
                                        <button
                                            key={member._id}
                                            type="button"
                                            className={`alliance-handover-item ${selectedSuccessorId === member._id ? 'active' : ''}`}
                                            onClick={() => {
                                                setSelectedSuccessorId(member._id);
                                                setHandoverError('');
                                            }}
                                        >
                                            <span>{member.username}{member.profession ? ` 【${member.profession}】` : ''}</span>
                                            {selectedSuccessorId === member._id && <span>已选中</span>}
                                        </button>
                                    ))
                                )}
                            </div>
                            {handoverError && <div className="alliance-handover-error">{handoverError}</div>}
                        </div>
                        <div className="alliance-handover-footer">
                            <button type="button" className="btn btn-secondary" onClick={closeHandoverModal}>取消</button>
                            <button
                                type="button"
                                className={handoverMode === 'transfer' ? 'btn btn-warning' : 'btn btn-danger'}
                                onClick={handleOpenHandoverConfirm}
                                disabled={handoverSubmitting || (handoverMode === 'transfer' && successorCandidates.length === 0)}
                            >
                                {handoverMode === 'transfer' ? '转交盟主' : '退盟'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {confirmState.open && (
                <div className="alliance-confirm-backdrop" onClick={closeConfirmModal}>
                    <div className="alliance-confirm-modal" onClick={(event) => event.stopPropagation()}>
                        <h4>{confirmState.title}</h4>
                        <p>{confirmState.message}</p>
                        <div className="alliance-confirm-actions">
                            <button type="button" className="btn btn-secondary" onClick={closeConfirmModal}>取消</button>
                            <button
                                type="button"
                                className={`btn ${confirmState.action === 'leader_transfer' ? 'btn-warning' : 'btn-danger'}`}
                                onClick={executeLeaderAction}
                                disabled={handoverSubmitting}
                            >
                                {handoverSubmitting ? '处理中...' : confirmState.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {renderStyleCreatorModal()}
        </div>
    );
};

export default AllianceDetailModal;
