import React, { useState, useEffect } from 'react';
import { User, Camera, Lock, Save, X, Check } from 'lucide-react';
import './ProfilePanel.css';

// 导入头像
import defaultMale1 from '../../assets/avatars/default_male_1.svg';
import defaultMale2 from '../../assets/avatars/default_male_2.svg';
import defaultMale3 from '../../assets/avatars/default_male_3.svg';
import defaultFemale1 from '../../assets/avatars/default_female_1.svg';
import defaultFemale2 from '../../assets/avatars/default_female_2.svg';
import defaultFemale3 from '../../assets/avatars/default_female_3.svg';

// 头像映射
const avatarMap = {
    default_male_1: defaultMale1,
    default_male_2: defaultMale2,
    default_male_3: defaultMale3,
    default_female_1: defaultFemale1,
    default_female_2: defaultFemale2,
    default_female_3: defaultFemale3
};

// 头像列表
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

const ProfilePanel = ({ username, onAvatarChange }) => {
    const [userInfo, setUserInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('info'); // 'info', 'avatar', 'password'

    // 头像选择相关
    const [selectedAvatar, setSelectedAvatar] = useState(null);
    const [savingAvatar, setSavingAvatar] = useState(false);

    // 密码修改相关
    const [passwordForm, setPasswordForm] = useState({
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);

    // 获取用户信息
    useEffect(() => {
        fetchUserInfo();
    }, []);

    const fetchUserInfo = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/profile', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                setUserInfo(data);
                setSelectedAvatar(data.avatar);
            }
        } catch (error) {
            console.error('获取用户信息失败:', error);
        } finally {
            setLoading(false);
        }
    };

    // 保存头像
    const handleSaveAvatar = async () => {
        if (!selectedAvatar || selectedAvatar === userInfo?.avatar) return;

        setSavingAvatar(true);
        const token = localStorage.getItem('token');

        try {
            const response = await fetch('http://localhost:5000/api/profile/avatar', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ avatar: selectedAvatar })
            });

            if (response.ok) {
                const data = await response.json();
                setUserInfo(prev => ({ ...prev, avatar: data.avatar }));
                localStorage.setItem('userAvatar', data.avatar);
                if (onAvatarChange) {
                    onAvatarChange(data.avatar);
                }
                alert('头像修改成功！');
            } else {
                const error = await response.json();
                alert(error.error || '修改失败');
            }
        } catch (error) {
            console.error('修改头像失败:', error);
            alert('网络错误');
        } finally {
            setSavingAvatar(false);
        }
    };

    // 修改密码
    const handleChangePassword = async (e) => {
        e.preventDefault();
        setPasswordError('');
        setPasswordSuccess('');

        // 验证
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
            const response = await fetch('http://localhost:5000/api/profile/password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    oldPassword: passwordForm.oldPassword,
                    newPassword: passwordForm.newPassword
                })
            });

            if (response.ok) {
                setPasswordSuccess('密码修改成功！');
                setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
            } else {
                const error = await response.json();
                setPasswordError(error.error || '修改失败');
            }
        } catch (error) {
            console.error('修改密码失败:', error);
            setPasswordError('网络错误');
        } finally {
            setSavingPassword(false);
        }
    };

    // 格式化日期
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    // 获取角色显示名称
    const getRoleDisplay = (role) => {
        return role === 'admin' ? '管理员' : '普通用户';
    };

    if (loading) {
        return (
            <div className="profile-panel">
                <div className="profile-loading">加载中...</div>
            </div>
        );
    }

    return (
        <div className="profile-panel">
            <div className="profile-header">
                <div className="profile-avatar-display">
                    <img
                        src={avatarMap[userInfo?.avatar] || defaultMale1}
                        alt="用户头像"
                        className="profile-avatar-large"
                    />
                </div>
                <div className="profile-header-info">
                    <h2 className="profile-username">{userInfo?.username}</h2>
                    <span className="profile-role">{getRoleDisplay(userInfo?.role)}</span>
                    <span className="profile-profession">【{userInfo?.profession}】</span>
                </div>
            </div>

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

            <div className="profile-content">
                {/* 个人信息 */}
                {activeTab === 'info' && (
                    <div className="profile-info-section">
                        <div className="info-grid">
                            <div className="info-item">
                                <span className="info-label">用户名</span>
                                <span className="info-value">{userInfo?.username}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">等级</span>
                                <span className="info-value">Lv.{userInfo?.level || 1}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">经验值</span>
                                <span className="info-value">{userInfo?.experience || 0}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">职业</span>
                                <span className="info-value">{userInfo?.profession}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">降临位置</span>
                                <span className="info-value">{userInfo?.location || '未设置'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">拥有节点</span>
                                <span className="info-value">{userInfo?.ownedNodes?.length || 0} 个</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">注册时间</span>
                                <span className="info-value">{formatDate(userInfo?.createdAt)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 修改头像 */}
                {activeTab === 'avatar' && (
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
                                {maleAvatars.map(avatar => (
                                    <div
                                        key={avatar.id}
                                        className={`avatar-option ${selectedAvatar === avatar.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedAvatar(avatar.id)}
                                    >
                                        <img src={avatar.src} alt={avatar.label} />
                                        <span className="avatar-label">{avatar.label}</span>
                                        {selectedAvatar === avatar.id && (
                                            <div className="avatar-check">
                                                <Check size={16} />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="avatar-category">
                            <h4 className="avatar-category-title">女生头像</h4>
                            <div className="avatar-grid">
                                {femaleAvatars.map(avatar => (
                                    <div
                                        key={avatar.id}
                                        className={`avatar-option ${selectedAvatar === avatar.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedAvatar(avatar.id)}
                                    >
                                        <img src={avatar.src} alt={avatar.label} />
                                        <span className="avatar-label">{avatar.label}</span>
                                        {selectedAvatar === avatar.id && (
                                            <div className="avatar-check">
                                                <Check size={16} />
                                            </div>
                                        )}
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

                {/* 修改密码 */}
                {activeTab === 'password' && (
                    <div className="profile-password-section">
                        <form onSubmit={handleChangePassword} className="password-form">
                            <div className="form-group">
                                <label>原密码</label>
                                <input
                                    type="password"
                                    value={passwordForm.oldPassword}
                                    onChange={(e) => setPasswordForm(prev => ({ ...prev, oldPassword: e.target.value }))}
                                    placeholder="请输入原密码"
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>新密码</label>
                                <input
                                    type="password"
                                    value={passwordForm.newPassword}
                                    onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                                    placeholder="请输入新密码（至少6个字符）"
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>确认新密码</label>
                                <input
                                    type="password"
                                    value={passwordForm.confirmPassword}
                                    onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                                    placeholder="请再次输入新密码"
                                    className="form-input"
                                />
                            </div>

                            {passwordError && (
                                <div className="password-error">
                                    <X size={16} />
                                    {passwordError}
                                </div>
                            )}

                            {passwordSuccess && (
                                <div className="password-success">
                                    <Check size={16} />
                                    {passwordSuccess}
                                </div>
                            )}

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
