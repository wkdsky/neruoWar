import React, { useState, useEffect } from 'react';
import { Shield, Users, Zap } from 'lucide-react';
import '../../App.css'; 
import AllianceDetailModal from '../modals/AllianceDetailModal';
import CreateAllianceModal from '../modals/CreateAllianceModal';

const ALLIANCE_LIST_PAGE_SIZE = 20;
const ALLIANCE_DETAIL_MEMBER_PAGE_SIZE = 30;
const ALLIANCE_DETAIL_DOMAIN_PAGE_SIZE = 30;

const AlliancePanel = ({ username, token, isAdmin }) => {
    const [alliances, setAlliances] = useState([]);
    const [alliancesPage, setAlliancesPage] = useState(1);
    const [alliancesPagination, setAlliancesPagination] = useState({
        page: 1,
        pageSize: ALLIANCE_LIST_PAGE_SIZE,
        total: 0,
        totalPages: 0
    });
    const [isAlliancesLoading, setIsAlliancesLoading] = useState(false);
    const [userAlliance, setUserAlliance] = useState(null);
    const [allianceDetailQuery, setAllianceDetailQuery] = useState({
        memberPage: 1,
        memberPageSize: ALLIANCE_DETAIL_MEMBER_PAGE_SIZE,
        domainPage: 1,
        domainPageSize: ALLIANCE_DETAIL_DOMAIN_PAGE_SIZE
    });
    const [selectedAlliance, setSelectedAlliance] = useState(null);
    const [showAllianceDetailModal, setShowAllianceDetailModal] = useState(false);
    const [showCreateAllianceModal, setShowCreateAllianceModal] = useState(false);

    useEffect(() => {
        fetchAlliances({ page: 1 });
        fetchUserAlliance();
    }, []);

    const fetchAlliances = async ({ page = alliancesPage, pageSize = ALLIANCE_LIST_PAGE_SIZE } = {}) => {
        setIsAlliancesLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(Math.max(1, page)),
                pageSize: String(Math.max(1, pageSize))
            });
            const response = await fetch(`http://localhost:5000/api/alliances/list?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                const pagination = data?.pagination || {};
                const nextPage = Math.max(1, parseInt(pagination.page, 10) || Math.max(1, page));
                setAlliances(Array.isArray(data?.alliances) ? data.alliances : []);
                setAlliancesPagination({
                    page: nextPage,
                    pageSize: Math.max(1, parseInt(pagination.pageSize, 10) || pageSize),
                    total: Math.max(0, parseInt(pagination.total, 10) || 0),
                    totalPages: Math.max(0, parseInt(pagination.totalPages, 10) || 0)
                });
                setAlliancesPage(nextPage);
            }
        } catch (error) {
            console.error('获取熵盟列表失败:', error);
        } finally {
            setIsAlliancesLoading(false);
        }
    };

    const fetchUserAlliance = async () => {
        if (!token) return;
        try {
            const response = await fetch('http://localhost:5000/api/alliances/my/info', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                setUserAlliance(data.alliance);
            }
        } catch (error) {
            console.error('获取用户熵盟信息失败:', error);
        }
    };

    const fetchAllianceDetail = async (allianceId, {
        openModal = true,
        memberPage = allianceDetailQuery.memberPage,
        memberPageSize = allianceDetailQuery.memberPageSize,
        domainPage = allianceDetailQuery.domainPage,
        domainPageSize = allianceDetailQuery.domainPageSize
    } = {}) => {
        if (!allianceId) return;
        try {
            const params = new URLSearchParams({
                memberPage: String(Math.max(1, memberPage)),
                memberPageSize: String(Math.max(1, memberPageSize)),
                domainPage: String(Math.max(1, domainPage)),
                domainPageSize: String(Math.max(1, domainPageSize))
            });
            const response = await fetch(`http://localhost:5000/api/alliances/${allianceId}?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                setSelectedAlliance(data);
                setAllianceDetailQuery({
                    memberPage: Math.max(1, parseInt(data?.memberPagination?.page, 10) || memberPage),
                    memberPageSize: Math.max(1, parseInt(data?.memberPagination?.pageSize, 10) || memberPageSize),
                    domainPage: Math.max(1, parseInt(data?.domainPagination?.page, 10) || domainPage),
                    domainPageSize: Math.max(1, parseInt(data?.domainPagination?.pageSize, 10) || domainPageSize)
                });
                if (openModal) {
                    setShowAllianceDetailModal(true);
                }
            }
        } catch (error) {
            console.error('获取熵盟详情失败:', error);
        }
    };

    const createAlliance = async (allianceData) => {
        const { name, flag, declaration, visualStyle } = allianceData;
        try {
            const response = await fetch('http://localhost:5000/api/alliances/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, flag, declaration, visualStyle })
            });
            const data = await response.json();
            if (response.ok) {
                alert('熵盟创建成功！');
                setShowCreateAllianceModal(false);
                fetchAlliances({ page: alliancesPage });
                fetchUserAlliance();
            } else {
                alert(data.error || '创建失败');
            }
        } catch (error) {
            console.error('创建熵盟失败:', error);
            alert('创建失败');
        }
    };

    const joinAlliance = async (allianceId) => {
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/join/${allianceId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message || '申请已提交，等待盟主审核');
                setShowAllianceDetailModal(false);
                fetchAlliances({ page: alliancesPage });
                fetchUserAlliance();
            } else {
                alert(data.error || '加入失败');
            }
        } catch (error) {
            console.error('加入熵盟失败:', error);
            alert('加入失败');
        }
    };

    const leaveAlliance = async (newLeaderId = '') => {
        try {
            const response = await fetch('http://localhost:5000/api/alliances/leave', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(newLeaderId ? { newLeaderId } : {})
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                setShowAllianceDetailModal(false);
                fetchAlliances({ page: alliancesPage });
                fetchUserAlliance();
                return true;
            } else {
                alert(data.error || '退出失败');
                return false;
            }
        } catch (error) {
            console.error('退出熵盟失败:', error);
            alert('退出失败');
            return false;
        }
    };

    const transferAllianceLeadership = async (allianceId, newLeaderId) => {
        if (!allianceId || !newLeaderId) return false;
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/leader/${allianceId}/transfer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ newLeaderId })
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message || '盟主身份已转交');
                await fetchAlliances({ page: alliancesPage });
                await fetchUserAlliance();
                return true;
            }
            alert(data.error || '转交盟主失败');
            return false;
        } catch (error) {
            console.error('转交盟主失败:', error);
            alert('转交盟主失败');
            return false;
        }
    };

    return (
        <div className="alliance-section">
            <h2 className="section-title-large">
                <Shield className="icon" />
                熵盟系统
            </h2>

            {/* 用户当前熵盟状态 */}
            {!isAdmin && (
                <div className="user-alliance-status">
                    {userAlliance ? (
                        <div className="current-alliance-card">
                            <div className="alliance-flag" style={{ backgroundColor: userAlliance.flag }}></div>
                            <div className="alliance-info-compact">
                                <h3>{userAlliance.name}</h3>
                                <p>成员: {userAlliance.memberCount} | 管辖域: {userAlliance.domainCount}</p>
                            </div>
                            <button
                                onClick={() => fetchAllianceDetail(userAlliance._id, {
                                    openModal: true,
                                    memberPage: 1,
                                    domainPage: 1
                                })}
                                className="btn btn-secondary btn-small"
                            >
                                熵盟详情
                            </button>
                        </div>
                    ) : (
                        <div className="no-alliance-prompt">
                            <p>您还未加入任何熵盟</p>
                            <button
                                onClick={() => setShowCreateAllianceModal(true)}
                                className="btn btn-primary"
                            >
                                创立新熵盟
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* 熵盟列表 */}
            <div className="alliances-grid">
                {alliances.length === 0 ? (
                    <div className="empty-alliances">
                        <p>暂无熵盟，快来创建第一个熵盟吧！</p>
                    </div>
                ) : (
                    alliances.map((alliance) => (
                        <div
                            key={alliance._id}
                            className="alliance-card"
                            onClick={() => fetchAllianceDetail(alliance._id, {
                                openModal: true,
                                memberPage: 1,
                                domainPage: 1
                            })}
                        >
                            <div className="alliance-flag-large" style={{ backgroundColor: alliance.flag }}></div>
                            <div className="alliance-card-content">
                                <h3 className="alliance-name">{alliance.name}</h3>
                                <p className="alliance-declaration">{alliance.declaration}</p>
                                <div className="alliance-stats">
                                    <div className="stat-item">
                                        <Users className="icon-tiny" />
                                        <span>成员: {alliance.memberCount}</span>
                                    </div>
                                    <div className="stat-item">
                                        <Zap className="icon-tiny" />
                                        <span>管辖域: {alliance.domainCount}</span>
                                    </div>
                                </div>
                                <div className="alliance-founder">
                                    盟主: {alliance.founder?.username || '未知'}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
            <div className="alliance-list-pagination">
                <div className="alliance-list-page-info">
                    {isAlliancesLoading
                        ? '加载中...'
                        : `第 ${alliancesPagination.page} / ${Math.max(1, alliancesPagination.totalPages || 1)} 页，共 ${alliancesPagination.total} 个熵盟`}
                </div>
                <div className="alliance-list-page-actions">
                    <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={() => fetchAlliances({ page: alliancesPagination.page - 1 })}
                        disabled={isAlliancesLoading || alliancesPagination.page <= 1}
                    >
                        上一页
                    </button>
                    <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={() => fetchAlliances({ page: alliancesPagination.page + 1 })}
                        disabled={isAlliancesLoading || (alliancesPagination.totalPages > 0 && alliancesPagination.page >= alliancesPagination.totalPages)}
                    >
                        下一页
                    </button>
                </div>
            </div>

            {/* 熵盟详情弹窗 */}
            <AllianceDetailModal
                isOpen={showAllianceDetailModal}
                onClose={() => setShowAllianceDetailModal(false)}
                selectedAlliance={selectedAlliance}
                userAlliance={userAlliance}
                onJoin={joinAlliance}
                onLeave={leaveAlliance}
                onTransferLeadership={transferAllianceLeadership}
                isAdmin={isAdmin}
                currentUsername={username}
                token={token}
                onRefreshAllianceDetail={(allianceId, pagination = {}) => fetchAllianceDetail(allianceId, {
                    openModal: false,
                    ...pagination
                })}
                onAllianceChanged={async (allianceId, pagination = null) => {
                    await fetchAlliances({ page: alliancesPage });
                    await fetchUserAlliance();
                    if (allianceId) {
                        await fetchAllianceDetail(allianceId, {
                            openModal: false,
                            ...(pagination || allianceDetailQuery)
                        });
                    }
                }}
            />

            {/* 创建熵盟弹窗 */}
            <CreateAllianceModal
                isOpen={showCreateAllianceModal}
                onClose={() => setShowCreateAllianceModal(false)}
                onCreate={createAlliance}
            />
        </div>
    );
};

export default AlliancePanel;
