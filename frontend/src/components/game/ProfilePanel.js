import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Camera, Check, Lock, Save, User, X } from 'lucide-react';
import './ProfilePanel.css';
import { API_BASE } from '../../runtimeConfig';

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

const maleAvatars = [
    { id: 'default_male_1', src: defaultMale1, label: '方块战士' },
    { id: 'default_male_2', src: defaultMale2, label: '森林守护' },
    { id: 'default_male_3', src: defaultMale3, label: '暗夜魔法' }
];

const femaleAvatars = [
    { id: 'default_female_1', src: defaultFemale1, label: '粉色幻梦' },
    { id: 'default_female_2', src: defaultFemale2, label: '阳光少女' },
    { id: 'default_female_3', src: defaultFemale3, label: '海洋之心' }
];

const readJsonSafe = async (response) => {
    try {
        return await response.json();
    } catch (_error) {
        return {};
    }
};

const ProfilePanel = ({
    currentUserId = '',
    profileUserId = '',
    onAvatarChange,
    onLogout,
    onViewOwnProfile
}) => {
    const normalizedCurrentUserId = String(currentUserId || '').trim();
    const normalizedProfileUserId = String(profileUserId || '').trim();
    const isViewingOtherUser = Boolean(normalizedProfileUserId) && normalizedProfileUserId !== normalizedCurrentUserId;
    const [userInfo, setUserInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [requestError, setRequestError] = useState('');
    const [activeTab, setActiveTab] = useState('info');
    const [selectedAvatar, setSelectedAvatar] = useState(null);
    const [savingAvatar, setSavingAvatar] = useState(false);
    const [passwordForm, setPasswordForm] = useState({
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);

    const profileEndpoint = useMemo(() => (
        isViewingOtherUser
            ? `${API_BASE}/social/users/${normalizedProfileUserId}/profile`
            : `${API_BASE}/profile`
    ), [isViewingOtherUser, normalizedProfileUserId]);

    useEffect(() => {
        if (isViewingOtherUser) {
            setActiveTab('info');
        }
    }, [isViewingOtherUser]);

    useEffect(() => {
        let cancelled = false;

        const fetchUserInfo = async () => {
            const token = localStorage.getItem('token');
            if (!token) {
                if (!cancelled) {
                    setRequestError('未检测到登录凭证');
                    setLoading(false);
                }
                return;
            }

            setLoading(true);
            setRequestError('');
            setPasswordError('');
            setPasswordSuccess('');

            try {
                const response = await fetch(profileEndpoint, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });
                const data = await readJsonSafe(response);
                if (!response.ok) {
                    throw new Error(data?.error || '获取用户信息失败');
                }
                if (cancelled) return;
                setUserInfo(data);
                setSelectedAvatar(data?.avatar || null);
            } catch (error) {
                if (cancelled) return;
                console.error('获取用户信息失败:', error);
                setUserInfo(null);
                setRequestError(error.message || '获取用户信息失败');
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchUserInfo();
        return () => {
            cancelled = true;
        };
    }, [profileEndpoint]);

    const handleSaveAvatar = async () => {
        if (isViewingOtherUser || !selectedAvatar || selectedAvatar === userInfo?.avatar) return;

        setSavingAvatar(true);
        const token = localStorage.getItem('token');

        try {
            const response = await fetch(`${API_BASE}/profile/avatar`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ avatar: selectedAvatar })
            });
            const data = await readJsonSafe(response);

            if (!response.ok) {
                throw new Error(data?.error || '修改失败');
            }

            setUserInfo((prev) => ({ ...prev, avatar: data.avatar }));
            localStorage.setItem('userAvatar', data.avatar);
            if (typeof onAvatarChange === 'function') {
                onAvatarChange(data.avatar);
            }
            window.alert('头像修改成功！');
        } catch (error) {
            console.error('修改头像失败:', error);
            window.alert(error.message || '网络错误');
        } finally {
            setSavingAvatar(false);
        }
    };

    const handleChangePassword = async (event) => {
        event.preventDefault();
        setPasswordError('');
        setPasswordSuccess('');

        if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
            setPasswordError('请填写所有字段');
            return;
        }
        if (passwordForm.newPassword.length < 6) {
            setPasswordError('新密码至少6个字符');
            return;
        }
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setPasswordError('两次输入的新密码不一致');
            return;
        }

        setSavingPassword(true);
        const token = localStorage.getItem('token');

        try {
            const response = await fetch(`${API_BASE}/profile/password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    oldPassword: passwordForm.oldPassword,
                    newPassword: passwordForm.newPassword
                })
            });
            const data = await readJsonSafe(response);

            if (!response.ok) {
                throw new Error(data?.error || '修改失败');
            }

            setPasswordSuccess('密码修改成功！');
            setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
        } catch (error) {
            console.error('修改密码失败:', error);
            setPasswordError(error.message || '网络错误');
        } finally {
            setSavingPassword(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const getRoleDisplay = (role) => (role === 'admin' ? '管理员' : '普通用户');
    const allianceText = userInfo?.allianceName || (userInfo?.allianceId ? '已加入熵盟' : '未加入熵盟');

    if (loading) {
        return (
            <div className="profile-panel">
                <div className="profile-loading">加载中...</div>
            </div>
        );
    }

    if (!userInfo) {
        return (
            <div className="profile-panel">
                <div className="profile-error">
                    <X size={16} />
                    {requestError || '用户信息加载失败'}
                </div>
            </div>
        );
    }

    return (
        <div className="profile-panel">
            <div className="profile-header">
                <div className="profile-avatar-display">
                    <img
                        src={avatarMap[userInfo?.avatar] || defaultMale1}
                        alt={userInfo?.username || '用户头像'}
                        className="profile-avatar-large"
                    />
                </div>
                <div className="profile-header-info">
                    <span className="profile-mode-badge">{isViewingOtherUser ? '用户信息' : '个人中心'}</span>
                    <h2 className="profile-username">{userInfo?.username}</h2>
                    <span className="profile-role">{getRoleDisplay(userInfo?.role)}</span>
                    <span className="profile-profession">【{userInfo?.profession || '未设职业'}】</span>
                </div>
                <div className="profile-header-actions">
                    {isViewingOtherUser && typeof onViewOwnProfile === 'function' ? (
                        <button
                            type="button"
                            className="profile-secondary-btn"
                            onClick={() => {
                                void onViewOwnProfile();
                            }}
                        >
                            <ArrowLeft size={16} />
                            我的资料
                        </button>
                    ) : null}
                    {!isViewingOtherUser && typeof onLogout === 'function' ? (
                        <button
                            type="button"
                            className="profile-logout-btn"
                            onClick={onLogout}
                        >
                            退出登录
                        </button>
                    ) : null}
                </div>
            </div>

            {requestError ? (
                <div className="profile-error">
                    <X size={16} />
                    {requestError}
                </div>
            ) : null}

            {!isViewingOtherUser ? (
                <div className="profile-tabs">
                    <button
                        className={`profile-tab ${activeTab === 'info' ? 'active' : ''}`}
                        onClick={() => setActiveTab('info')}
                    >
                        <User size={18} />
                        个人信息
                    </button>
                    <button
                        className={`profile-tab ${activeTab === 'avatar' ? 'active' : ''}`}
                        onClick={() => setActiveTab('avatar')}
                    >
                        <Camera size={18} />
                        修改头像
                    </button>
                    <button
                        className={`profile-tab ${activeTab === 'password' ? 'active' : ''}`}
                        onClick={() => setActiveTab('password')}
                    >
                        <Lock size={18} />
                        修改密码
                    </button>
                </div>
            ) : null}

            <div className="profile-content">
                {(isViewingOtherUser || activeTab === 'info') && (
                    <div className="profile-info-section">
                        <div className="info-grid">
                            <div className="info-item">
                                <span className="info-label">用户名</span>
                                <span className="info-value">{userInfo?.username || '-'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">等级</span>
                                <span className="info-value">Lv.{userInfo?.level ?? 0}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">经验值</span>
                                <span className="info-value">{userInfo?.experience || 0}</span>
                            </div>
                            {!isViewingOtherUser ? (
                                <div className="info-item">
                                    <span className="info-label">账户知识点</span>
                                    <span className="info-value">{Number(userInfo?.knowledgeBalance || 0).toFixed(2)}</span>
                                </div>
                            ) : null}
                            <div className="info-item">
                                <span className="info-label">职业</span>
                                <span className="info-value">{userInfo?.profession || '未设置'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">降临位置</span>
                                <span className="info-value">{userInfo?.location || '未设置'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">熵盟</span>
                                <span className="info-value">{allianceText}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">{isViewingOtherUser ? '好友数' : '拥有节点'}</span>
                                <span className="info-value">
                                    {isViewingOtherUser
                                        ? `${userInfo?.friendCount || 0} 人`
                                        : `${userInfo?.ownedNodeCount ?? userInfo?.ownedNodes?.length ?? 0} 个`}
                                </span>
                            </div>
                            {userInfo?.publicId ? (
                                <div className="info-item">
                                    <span className="info-label">公开编号</span>
                                    <span className="info-value">{userInfo.publicId}</span>
                                </div>
                            ) : null}
                            <div className="info-item">
                                <span className="info-label">注册时间</span>
                                <span className="info-value">{formatDate(userInfo?.createdAt)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {!isViewingOtherUser && activeTab === 'avatar' && (
                    <div className="profile-avatar-section">
                        <div className="avatar-preview">
                            <img
                                src={avatarMap[selectedAvatar] || defaultMale1}
                                alt="预览"
                                className="avatar-preview-img"
                            />
                            <span className="avatar-preview-label">当前选择</span>
                        </div>

                        <div className="avatar-category">
                            <h4 className="avatar-category-title">男生头像</h4>
                            <div className="avatar-grid">
                                {maleAvatars.map((avatar) => (
                                    <div
                                        key={avatar.id}
                                        className={`avatar-option ${selectedAvatar === avatar.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedAvatar(avatar.id)}
                                    >
                                        <img src={avatar.src} alt={avatar.label} />
                                        <span className="avatar-label">{avatar.label}</span>
                                        {selectedAvatar === avatar.id ? (
                                            <div className="avatar-check">
                                                <Check size={16} />
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="avatar-category">
                            <h4 className="avatar-category-title">女生头像</h4>
                            <div className="avatar-grid">
                                {femaleAvatars.map((avatar) => (
                                    <div
                                        key={avatar.id}
                                        className={`avatar-option ${selectedAvatar === avatar.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedAvatar(avatar.id)}
                                    >
                                        <img src={avatar.src} alt={avatar.label} />
                                        <span className="avatar-label">{avatar.label}</span>
                                        {selectedAvatar === avatar.id ? (
                                            <div className="avatar-check">
                                                <Check size={16} />
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button
                            className="btn btn-primary save-avatar-btn"
                            onClick={handleSaveAvatar}
                            disabled={savingAvatar || selectedAvatar === userInfo?.avatar}
                        >
                            <Save size={18} />
                            {savingAvatar ? '保存中...' : '保存头像'}
                        </button>
                    </div>
                )}

                {!isViewingOtherUser && activeTab === 'password' && (
                    <div className="profile-password-section">
                        <form onSubmit={handleChangePassword} className="password-form">
                            <div className="form-group">
                                <label>原密码</label>
                                <input
                                    type="password"
                                    value={passwordForm.oldPassword}
                                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, oldPassword: event.target.value }))}
                                    placeholder="请输入原密码"
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>新密码</label>
                                <input
                                    type="password"
                                    value={passwordForm.newPassword}
                                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                                    placeholder="请输入新密码（至少6个字符）"
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>确认新密码</label>
                                <input
                                    type="password"
                                    value={passwordForm.confirmPassword}
                                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                                    placeholder="请再次输入新密码"
                                    className="form-input"
                                />
                            </div>

                            {passwordError ? (
                                <div className="password-error">
                                    <X size={16} />
                                    {passwordError}
                                </div>
                            ) : null}

                            {passwordSuccess ? (
                                <div className="password-success">
                                    <Check size={16} />
                                    {passwordSuccess}
                                </div>
                            ) : null}

                            <button
                                type="submit"
                                className="btn btn-primary change-password-btn"
                                disabled={savingPassword}
                            >
                                <Lock size={18} />
                                {savingPassword ? '修改中...' : '修改密码'}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProfilePanel;
