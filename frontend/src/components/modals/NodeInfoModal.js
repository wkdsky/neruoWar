import React, { useEffect, useState } from 'react';
import { X, Compass } from 'lucide-react';
import './NodeInfoModal.css';
import defaultMale1 from '../../assets/avatars/default_male_1.svg';
import defaultMale2 from '../../assets/avatars/default_male_2.svg';
import defaultMale3 from '../../assets/avatars/default_male_3.svg';
import defaultFemale1 from '../../assets/avatars/default_female_1.svg';
import defaultFemale2 from '../../assets/avatars/default_female_2.svg';
import defaultFemale3 from '../../assets/avatars/default_female_3.svg';

const avatarMap = {
    default_male_1: defaultMale1,
    default_male_2: defaultMale2,
    default_male_3: defaultMale3,
    default_female_1: defaultFemale1,
    default_female_2: defaultFemale2,
    default_female_3: defaultFemale3
};

const getUserId = (user) => {
    if (!user) return '';
    return user._id?.toString?.() || user._id || user.id || '';
};

const formatCreatedAt = (createdAt) => {
    if (!createdAt) return '未知';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return '未知';
    return date.toLocaleString('zh-CN', { hour12: false });
};

const getUserAlliance = (user) => {
    const alliance = user?.alliance || user?.allianceId;
    if (!alliance || typeof alliance !== 'object') return null;
    const name = typeof alliance.name === 'string' ? alliance.name.trim() : '';
    const flag = typeof alliance.flag === 'string' ? alliance.flag.trim() : '';
    if (!name && !flag) return null;
    return { name, flag };
};

const UserAvatar = ({ user, isMaster = false, fallbackKey = '' }) => {
    const username = user?.username || '未知用户';
    const alliance = getUserAlliance(user);
    const tooltip = alliance?.name ? `【${alliance.name}】${username}` : username;
    return (
        <div
            key={getUserId(user) || fallbackKey}
            className={`user-avatar-item ${isMaster ? 'is-master' : ''}`}
            title={tooltip}
        >
            <img
                src={avatarMap[user.avatar] || defaultMale1}
                alt={tooltip}
                className="user-avatar-img"
            />
            {alliance?.flag && (
                <span
                    className="user-avatar-alliance-flag"
                    style={{ backgroundColor: alliance.flag }}
                    aria-label={alliance.name ? `熵盟：${alliance.name}` : '熵盟旗帜'}
                />
            )}
            <span className="user-avatar-tooltip">{tooltip}</span>
        </div>
    );
};

const NodeInfoModal = ({
    isOpen,
    onClose,
    nodeDetail,
    onEnterKnowledgeDomain,
    canApplyDomainMaster = false,
    isApplyingDomainMaster = false,
    onApplyDomainMaster
}) => {
    const [showApplyForm, setShowApplyForm] = useState(false);
    const [applyReason, setApplyReason] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setShowApplyForm(false);
            setApplyReason('');
        }
    }, [isOpen, nodeDetail?._id]);

    if (!isOpen || !nodeDetail) return null;

    const creator = nodeDetail.owner || null;
    const domainMaster = nodeDetail.domainMaster ? [nodeDetail.domainMaster] : [];
    const domainMasterId = getUserId(nodeDetail.domainMaster);
    const admins = Array.isArray(nodeDetail.domainAdmins)
        ? nodeDetail.domainAdmins
            .filter(Boolean)
            .filter((admin, index, arr) => {
                const adminId = getUserId(admin);
                if (!adminId) return true;
                if (adminId === domainMasterId) return false;
                return arr.findIndex((candidate) => getUserId(candidate) === adminId) === index;
            })
        : [];

    const handleSubmitApply = async () => {
        const reason = applyReason.trim();
        if (!reason) {
            window.alert('请填写申请理由');
            return;
        }
        if (!onApplyDomainMaster) return;

        const success = await onApplyDomainMaster(reason);
        if (success) {
            setShowApplyForm(false);
            setApplyReason('');
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content node-info-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>知识域详细信息</h2>
                    <button
                        className="btn-close"
                        onClick={onClose}
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="node-info-section">
                        <h3 className="info-section-title">{nodeDetail.name}</h3>
                        <p className="info-section-desc">{nodeDetail.description}</p>
                    </div>

                    <div className="node-user-sections">
                        <div className="user-group-section">
                            <h4 className="user-group-title">创建者</h4>
                            <div className="creator-row">
                                {creator ? (
                                    <div className="user-avatar-list">
                                        <UserAvatar user={creator} fallbackKey="creator" />
                                    </div>
                                ) : (
                                    <div className="user-group-empty">暂无</div>
                                )}
                                <div className="creator-meta">
                                    <span className="creator-meta-label">创建时间：</span>
                                    <span className="creator-meta-value">{formatCreatedAt(nodeDetail.createdAt)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="user-group-section">
                            <h4 className="user-group-title">管理者</h4>
                            {domainMaster.length > 0 || admins.length > 0 ? (
                                <div className="user-avatar-list manager-avatar-list">
                                    {domainMaster.length > 0 && (
                                        <UserAvatar user={domainMaster[0]} isMaster fallbackKey="domain-master" />
                                    )}
                                    {admins.map((admin, index) => (
                                        <UserAvatar
                                            key={getUserId(admin) || `admin-${index}`}
                                            user={admin}
                                            fallbackKey={`admin-${index}`}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="user-group-empty">暂无管理者</div>
                            )}
                        </div>
                    </div>

                    {canApplyDomainMaster && (
                        <div className="domain-master-apply-section">
                            {!showApplyForm ? (
                                <button
                                    type="button"
                                    className="btn btn-blue domain-master-apply-open-btn"
                                    onClick={() => setShowApplyForm(true)}
                                >
                                    申请成为域主
                                </button>
                            ) : (
                                <div className="domain-master-apply-form">
                                    <label className="domain-master-apply-label">申请理由</label>
                                    <textarea
                                        className="domain-master-apply-textarea"
                                        value={applyReason}
                                        maxLength={300}
                                        placeholder="请填写你申请成为该知识域域主的理由（最多300字）"
                                        onChange={(event) => setApplyReason(event.target.value)}
                                    />
                                    <div className="domain-master-apply-counter">
                                        {applyReason.trim().length}/300
                                    </div>
                                    <div className="domain-master-apply-actions">
                                        <button
                                            type="button"
                                            className="btn btn-small btn-success"
                                            onClick={handleSubmitApply}
                                            disabled={isApplyingDomainMaster}
                                        >
                                            {isApplyingDomainMaster ? '提交中...' : '提交申请'}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-small btn-secondary"
                                            onClick={() => setShowApplyForm(false)}
                                            disabled={isApplyingDomainMaster}
                                        >
                                            取消
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button
                        className="btn btn-primary enter-domain-btn"
                        onClick={() => onEnterKnowledgeDomain && onEnterKnowledgeDomain(nodeDetail)}
                    >
                        <Compass size={18} />
                        进入知识域
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={onClose}
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NodeInfoModal;
