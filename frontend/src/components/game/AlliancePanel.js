import React, { useState, useEffect } from 'react';
import { Users, Zap, Shield, X } from 'lucide-react';
import '../../App.css'; 

const AlliancePanel = ({ username, token, isAdmin }) => {
    const [alliances, setAlliances] = useState([]);
    const [userAlliance, setUserAlliance] = useState(null);
    const [selectedAlliance, setSelectedAlliance] = useState(null);
    const [showAllianceDetailModal, setShowAllianceDetailModal] = useState(false);
    const [showCreateAllianceModal, setShowCreateAllianceModal] = useState(false);
    const [newAllianceData, setNewAllianceData] = useState({
        name: '',
        flag: '#7c3aed',
        declaration: ''
    });

    useEffect(() => {
        fetchAlliances();
        fetchUserAlliance();
    }, []);

    const fetchAlliances = async () => {
        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/list');
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
            const response = await fetch('http://192.168.1.96:5000/api/alliances/my/info', {
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

    const fetchAllianceDetail = async (allianceId) => {
        try {
            const response = await fetch(`http://192.168.1.96:5000/api/alliances/${allianceId}`);
            if (response.ok) {
                const data = await response.json();
                setSelectedAlliance(data);
                setShowAllianceDetailModal(true);
            }
        } catch (error) {
            console.error('获取熵盟详情失败:', error);
        }
    };

    const createAlliance = async () => {
        const { name, flag, declaration } = newAllianceData;
        if (!name.trim() || !declaration.trim()) {
            alert('请填写所有必填字段');
            return;
        }
        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/create', {
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
                setNewAllianceData({ name: '', flag: '#7c3aed', declaration: '' });
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
            const response = await fetch(`http://192.168.1.96:5000/api/alliances/join/${allianceId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (response.ok) {
                alert('成功加入熵盟！');
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

    const leaveAlliance = async () => {
        if (!window.confirm('确定要退出当前熵盟吗？')) return;
        try {
            const response = await fetch('http://192.168.1.96:5000/api/alliances/leave', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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
                            <button onClick={leaveAlliance} className="btn btn-danger btn-small">
                                退出熵盟
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
                                    创始人: {alliance.founder?.username || '未知'}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* 熵盟详情弹窗 */}
            {showAllianceDetailModal && selectedAlliance && (
                <div className="modal-backdrop" onClick={() => setShowAllianceDetailModal(false)}>
                    <div className="modal-content alliance-detail-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>熵盟详情</h2>
                            <button className="modal-close" onClick={() => setShowAllianceDetailModal(false)}>
                                <X size={24} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="alliance-detail-header">
                                <div className="alliance-flag-huge" style={{ backgroundColor: selectedAlliance.alliance.flag }}></div>
                                <div className="alliance-main-info">
                                    <h2>{selectedAlliance.alliance.name}</h2>
                                    <p className="declaration-text">{selectedAlliance.alliance.declaration}</p>
                                    <div className="alliance-meta">
                                        <span>创始人: {selectedAlliance.alliance.founder?.username || '未知'}</span>
                                        <span>成立时间: {new Date(selectedAlliance.alliance.createdAt).toLocaleDateString('zh-CN')}</span>
                                    </div>
                                    <div className="alliance-stats-large">
                                        <div className="stat-box">
                                            <Users className="icon" />
                                            <div>
                                                <span className="stat-number">{selectedAlliance.alliance.memberCount}</span>
                                                <span className="stat-label">成员</span>
                                            </div>
                                        </div>
                                        <div className="stat-box">
                                            <Zap className="icon" />
                                            <div>
                                                <span className="stat-number">{selectedAlliance.alliance.domainCount}</span>
                                                <span className="stat-label">管辖域</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="alliance-section-detail">
                                <h3>成员列表 ({selectedAlliance.members.length}人)</h3>
                                <div className="members-list">
                                    {selectedAlliance.members.map((member) => (
                                        <div key={member._id} className="member-item">
                                            <Users className="icon-small" />
                                            <span className="member-name">{member.username}</span>
                                            <span className="member-level">Lv.{member.level}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="alliance-section-detail">
                                <h3>管辖知识域 ({selectedAlliance.domains.length}个)</h3>
                                <div className="domains-list">
                                    {selectedAlliance.domains.length > 0 ? (
                                        selectedAlliance.domains.map((domain) => (
                                            <div key={domain._id} className="domain-item">
                                                <Zap className="icon-small" />
                                                <div className="domain-info">
                                                    <span className="domain-name">{domain.name}</span>
                                                    <span className="domain-master">域主: {domain.domainMaster?.username || '暂无'}</span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="empty-message">该熵盟暂无管辖知识域</p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            {!isAdmin && (
                                <>
                                    {userAlliance && userAlliance._id === selectedAlliance.alliance._id ? (
                                        <button className="btn btn-danger" onClick={leaveAlliance}>退出熵盟</button>
                                    ) : !userAlliance ? (
                                        <button className="btn btn-primary" onClick={() => joinAlliance(selectedAlliance.alliance._id)}>加入熵盟</button>
                                    ) : null}
                                </>
                            )}
                            <button className="btn btn-secondary" onClick={() => setShowAllianceDetailModal(false)}>关闭</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 创建熵盟弹窗 */}
            {showCreateAllianceModal && (
                <div className="modal-backdrop" onClick={() => setShowCreateAllianceModal(false)}>
                    <div className="modal-content create-alliance-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>创立新熵盟</h2>
                            <button className="modal-close" onClick={() => setShowCreateAllianceModal(false)}>
                                <X size={24} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>熵盟名称 *</label>
                                <input
                                    type="text"
                                    value={newAllianceData.name}
                                    onChange={(e) => setNewAllianceData({ ...newAllianceData, name: e.target.value })}
                                    placeholder="输入熵盟名称"
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>熵盟旗帜（颜色） *</label>
                                <div className="color-picker-group">
                                    <input
                                        type="color"
                                        value={newAllianceData.flag}
                                        onChange={(e) => setNewAllianceData({ ...newAllianceData, flag: e.target.value })}
                                        className="color-picker"
                                    />
                                    <div className="flag-preview" style={{ backgroundColor: newAllianceData.flag }}>
                                        <span>预览</span>
                                    </div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>熵盟号召（势力宣言） *</label>
                                <textarea
                                    value={newAllianceData.declaration}
                                    onChange={(e) => setNewAllianceData({ ...newAllianceData, declaration: e.target.value })}
                                    placeholder="输入熵盟的号召或宣言..."
                                    rows="4"
                                    className="form-textarea"
                                />
                            </div>
                            <div className="create-alliance-info">
                                <p><strong>注意：</strong></p>
                                <ul>
                                    <li>创建熵盟需要至少是一个知识域的域主</li>
                                    <li>创建成功后，您将自动成为该熵盟的成员</li>
                                    <li>每个用户只能属于一个熵盟</li>
                                </ul>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowCreateAllianceModal(false)}>取消</button>
                            <button
                                className="btn btn-primary"
                                onClick={createAlliance}
                                disabled={!newAllianceData.name.trim() || !newAllianceData.declaration.trim()}
                            >
                                创立熵盟
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AlliancePanel;
