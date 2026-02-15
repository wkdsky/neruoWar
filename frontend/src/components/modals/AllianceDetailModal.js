import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Zap, X } from 'lucide-react';
import './AllianceDetailModal.css';

const EMPTY_ITEMS = [];

const AllianceDetailModal = ({ 
    isOpen, 
    onClose, 
    selectedAlliance, 
    userAlliance, 
    onJoin, 
    onLeave, 
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
    const isLeaderManager = !isAdmin && isCurrentUserFounder;
    const [activeTab, setActiveTab] = useState('overview');
    const [newLeaderId, setNewLeaderId] = useState('');
    const [pendingApplications, setPendingApplications] = useState([]);
    const [isManageLoading, setIsManageLoading] = useState(false);
    const [manageActionKey, setManageActionKey] = useState('');
    const [announcementDraft, setAnnouncementDraft] = useState('');
    const [declarationDraft, setDeclarationDraft] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setNewLeaderId('');
            setActiveTab('overview');
            setPendingApplications([]);
            return;
        }
        if (isCurrentUserFounder && successorCandidates.length > 0) {
            setNewLeaderId(successorCandidates[0]._id);
            return;
        }
        setNewLeaderId('');
    }, [isOpen, alliance?._id, isCurrentUserFounder, successorCandidates]);

    useEffect(() => {
        if (!isOpen || !alliance) return;
        setAnnouncementDraft(alliance.announcement || '');
        setDeclarationDraft(alliance.declaration || '');
    }, [isOpen, alliance?._id, alliance?.announcement, alliance?.declaration]);

    // Handler for stopping propagation of clicks to the backdrop
    const handleContentClick = (e) => {
        e.stopPropagation();
    };

    const handleLeaveClick = () => {
        if (isCurrentUserFounder && successorCandidates.length > 0 && !newLeaderId) {
            window.alert('请选择一位新盟主后再退出');
            return;
        }
        onLeave(isCurrentUserFounder ? newLeaderId : '');
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
        if (!token) return;
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
                return;
            }
            window.alert(data.message || '更新成功');
            if (typeof onAllianceChanged === 'function') {
                await onAllianceChanged(alliance._id);
            }
            if (typeof onRefreshAllianceDetail === 'function') {
                await onRefreshAllianceDetail(alliance._id);
            }
        } catch (error) {
            window.alert(`${fallbackError}: ${error.message}`);
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

                    {isCurrentUserFounder && successorCandidates.length > 0 && activeTab !== 'manage' && (
                        <div className="alliance-section-detail">
                            <h3>盟主交接</h3>
                            <select
                                className="form-input"
                                value={newLeaderId}
                                onChange={(event) => setNewLeaderId(event.target.value)}
                            >
                                {successorCandidates.map((member) => (
                                    <option key={member._id} value={member._id}>
                                        {member.username}
                                        {member.profession ? ` 【${member.profession}】` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    {!isAdmin && (
                        <>
                            {isCurrentAllianceMember ? (
                                <button className="btn btn-danger" onClick={handleLeaveClick}>
                                    {isCurrentUserFounder && successorCandidates.length > 0 ? '交接盟主并退出' : '退出熵盟'}
                                </button>
                            ) : !userAlliance ? (
                                <button className="btn btn-primary" onClick={() => onJoin(alliance._id)}>申请加入熵盟</button>
                            ) : null}
                        </>
                    )}
                    <button className="btn btn-secondary" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    );
};

export default AllianceDetailModal;
