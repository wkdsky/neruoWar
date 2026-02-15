import React, { useState, useEffect } from 'react';
import { Shield, Users, Zap } from 'lucide-react';
import '../../App.css'; 
import AllianceDetailModal from '../modals/AllianceDetailModal';
import CreateAllianceModal from '../modals/CreateAllianceModal';

const AlliancePanel = ({ username, token, isAdmin }) => {
    const [alliances, setAlliances] = useState([]);
    const [userAlliance, setUserAlliance] = useState(null);
    const [selectedAlliance, setSelectedAlliance] = useState(null);
    const [showAllianceDetailModal, setShowAllianceDetailModal] = useState(false);
    const [showCreateAllianceModal, setShowCreateAllianceModal] = useState(false);

    useEffect(() => {
        fetchAlliances();
        fetchUserAlliance();
    }, []);

    const fetchAlliances = async () => {
        try {
            const response = await fetch('http://localhost:5000/api/alliances/list');
            if (response.ok) {
                const data = await response.json();
                setAlliances(data.alliances);
            }
        } catch (error) {
            console.error('获取熵盟列表失败:', error);
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

    const fetchAllianceDetail = async (allianceId, openModal = true) => {
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/${allianceId}`);
            if (response.ok) {
                const data = await response.json();
                setSelectedAlliance(data);
                if (openModal) {
                    setShowAllianceDetailModal(true);
                }
            }
        } catch (error) {
            console.error('获取熵盟详情失败:', error);
        }
    };

    const createAlliance = async (allianceData) => {
        const { name, flag, declaration } = allianceData;
        try {
            const response = await fetch('http://localhost:5000/api/alliances/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, flag, declaration })
            });
            const data = await response.json();
            if (response.ok) {
                alert('熵盟创建成功！');
                setShowCreateAllianceModal(false);
                fetchAlliances();
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
                fetchAlliances();
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
        if (!window.confirm('确定要退出当前熵盟吗？')) return;
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
                fetchAlliances();
                fetchUserAlliance();
            } else {
                alert(data.error || '退出失败');
            }
        } catch (error) {
            console.error('退出熵盟失败:', error);
            alert('退出失败');
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
                                onClick={() => fetchAllianceDetail(userAlliance._id)}
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
                            onClick={() => fetchAllianceDetail(alliance._id)}
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

            {/* 熵盟详情弹窗 */}
            <AllianceDetailModal
                isOpen={showAllianceDetailModal}
                onClose={() => setShowAllianceDetailModal(false)}
                selectedAlliance={selectedAlliance}
                userAlliance={userAlliance}
                onJoin={joinAlliance}
                onLeave={leaveAlliance}
                isAdmin={isAdmin}
                currentUsername={username}
                token={token}
                onRefreshAllianceDetail={(allianceId) => fetchAllianceDetail(allianceId, false)}
                onAllianceChanged={async (allianceId) => {
                    await fetchAlliances();
                    await fetchUserAlliance();
                    if (allianceId) {
                        await fetchAllianceDetail(allianceId, false);
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
