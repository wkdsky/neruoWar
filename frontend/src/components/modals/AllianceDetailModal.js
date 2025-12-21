import React from 'react';
import { Users, Zap, X } from 'lucide-react';
import './AllianceDetailModal.css';

const AllianceDetailModal = ({ 
    isOpen, 
    onClose, 
    selectedAlliance, 
    userAlliance, 
    onJoin, 
    onLeave, 
    isAdmin 
}) => {
    if (!isOpen || !selectedAlliance) return null;

    const { alliance, members, domains } = selectedAlliance;

    // Handler for stopping propagation of clicks to the backdrop
    const handleContentClick = (e) => {
        e.stopPropagation();
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
                                <span>创始人: {alliance.founder?.username || '未知'}
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

                    {/* Member List */}
                    <div className="alliance-section-detail">
                        <h3>成员列表 ({members.length}人)</h3>
                        <div className="members-list">
                            {members.map((member) => (
                                <div key={member._id} className="member-item">
                                    <Users className="icon-small" />
                                    <span className="member-name">
                                        {member.username}
                                        {member.profession && ` 【${member.profession}】`}
                                    </span>
                                    <span className="member-level">Lv.{member.level}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Domain List */}
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
                </div>

                <div className="modal-footer">
                    {!isAdmin && (
                        <>
                            {userAlliance && userAlliance._id === alliance._id ? (
                                <button className="btn btn-danger" onClick={onLeave}>退出熵盟</button>
                            ) : !userAlliance ? (
                                <button className="btn btn-primary" onClick={() => onJoin(alliance._id)}>加入熵盟</button>
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
