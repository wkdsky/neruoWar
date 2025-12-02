import React, { useState } from 'react';
import './Login.css';

const Login = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [mode, setMode] = useState('login'); // 'login', 'register', 'reset'
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');

    // 密码可见性状态
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

    const handleLogin = async () => {
        try {
            const response = await fetch('http://localhost:5000/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            if (response.ok) {
                onLogin(data);
            } else {
                window.alert(data.error);
            }
        } catch (error) {
            window.alert('连接失败: ' + error.message);
        }
    };

    const handleRegister = async () => {
        // 验证两次密码是否一致
        if (password !== confirmPassword) {
            window.alert('两次输入的密码不一致');
            return;
        }
        if (!password || password.length < 6) {
            window.alert('密码至少需要6个字符');
            return;
        }
        if (!username || username.length < 3) {
            window.alert('用户名至少需要3个字符');
            return;
        }

        try {
            const response = await fetch('http://localhost:5000/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            if (response.ok) {
                window.alert('注册成功！请登录');
                // 清空确认密码，切换回登录模式
                setConfirmPassword('');
                setMode('login');
            } else {
                window.alert(data.error);
            }
        } catch (error) {
            window.alert('连接失败: ' + error.message);
        }
    };

    const handleResetPassword = async () => {
        // 验证新密码
        if (newPassword !== confirmNewPassword) {
            window.alert('两次输入的新密码不一致');
            return;
        }
        if (!newPassword || newPassword.length < 6) {
            window.alert('新密码至少需要6个字符');
            return;
        }
        if (!username || !oldPassword) {
            window.alert('请输入用户名和原密码');
            return;
        }

        try {
            const response = await fetch('http://localhost:5000/api/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    oldPassword,
                    newPassword
                })
            });

            const data = await response.json();
            if (response.ok) {
                window.alert('密码修改成功！请使用新密码登录');
                setMode('login');
                setOldPassword('');
                setNewPassword('');
                setConfirmNewPassword('');
            } else {
                window.alert(data.error);
            }
        } catch (error) {
            window.alert('连接失败: ' + error.message);
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <div className="login-header">
                    <h1 className="login-title">NeuroWar</h1>
                    <p className="login-subtitle">Neural Network Strategy Game</p>
                </div>

                {mode === 'login' && (
                    <div className="login-form">
                        <input
                            type="text"
                            placeholder="用户名"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="login-input"
                        />
                        <div style={{position: 'relative'}}>
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="密码"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="login-input"
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                style={{paddingRight: '45px'}}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#64b5f6',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                {showPassword ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                        <div className="login-buttons">
                            <button
                                onClick={handleLogin}
                                className="btn btn-primary btn-green"
                                style={{flex: 1}}
                            >
                                登录
                            </button>
                            <button
                                onClick={() => setMode('register')}
                                className="btn btn-secondary btn-blue"
                                style={{flex: 1}}
                            >
                                注册
                            </button>
                        </div>
                        <div style={{textAlign: 'center', marginTop: '15px'}}>
                            <button
                                onClick={() => setMode('reset')}
                                className="reset-password-link"
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#64b5f6',
                                    cursor: 'pointer',
                                    textDecoration: 'underline',
                                    fontSize: '14px'
                                }}
                            >
                                忘记密码？
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'register' && (
                    <div className="login-form">
                        <h3 style={{color: 'white', marginBottom: '20px', textAlign: 'center'}}>注册新账号</h3>
                        <input
                            type="text"
                            placeholder="用户名（至少3个字符，需唯一）"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="login-input"
                        />
                        <div style={{position: 'relative'}}>
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="密码（至少6个字符）"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="login-input"
                                style={{paddingRight: '45px'}}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#64b5f6',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                {showPassword ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                        <div style={{position: 'relative'}}>
                            <input
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="确认密码"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="login-input"
                                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                                style={{paddingRight: '45px'}}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#64b5f6',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                {showConfirmPassword ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                        <div className="login-buttons">
                            <button
                                onClick={() => setMode('login')}
                                className="btn btn-secondary"
                                style={{flex: 1}}
                            >
                                返回
                            </button>
                            <button
                                onClick={handleRegister}
                                className="btn btn-primary btn-green"
                                style={{flex: 1}}
                            >
                                确认注册
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'reset' && (
                    <div className="login-form">
                        <h3 style={{color: 'white', marginBottom: '20px', textAlign: 'center'}}>找回密码</h3>
                        <input
                            type="text"
                            placeholder="用户名"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="login-input"
                        />
                        <div style={{position: 'relative'}}>
                            <input
                                type={showOldPassword ? "text" : "password"}
                                placeholder="原密码"
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                                className="login-input"
                                style={{paddingRight: '45px'}}
                            />
                            <button
                                type="button"
                                onClick={() => setShowOldPassword(!showOldPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#64b5f6',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                {showOldPassword ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                        <div style={{position: 'relative'}}>
                            <input
                                type={showNewPassword ? "text" : "password"}
                                placeholder="新密码（至少6个字符）"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="login-input"
                                style={{paddingRight: '45px'}}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#64b5f6',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                {showNewPassword ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                        <div style={{position: 'relative'}}>
                            <input
                                type={showConfirmNewPassword ? "text" : "password"}
                                placeholder="确认新密码"
                                value={confirmNewPassword}
                                onChange={(e) => setConfirmNewPassword(e.target.value)}
                                className="login-input"
                                onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                                style={{paddingRight: '45px'}}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#64b5f6',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                {showConfirmNewPassword ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                        <div className="login-buttons">
                            <button
                                onClick={() => setMode('login')}
                                className="btn btn-secondary"
                                style={{flex: 1}}
                            >
                                返回
                            </button>
                            <button
                                onClick={handleResetPassword}
                                className="btn btn-primary btn-green"
                                style={{flex: 1}}
                            >
                                确认修改
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Login;
