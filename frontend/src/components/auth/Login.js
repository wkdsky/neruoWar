import React, { useCallback, useMemo, useRef, useState } from 'react';
import './Login.css';
import { API_BASE } from '../../runtimeConfig';

const createClosedNoticeState = () => ({
    open: false,
    title: '提示',
    message: '',
    buttonText: '确定',
    onClose: null
});

const createUsernameCheckState = () => ({
    status: 'idle',
    message: '',
    available: null
});

const renderInlineHint = (hint) => (
    <div
        className={`login-inline-hint-slot${hint ? ` login-inline-hint-slot--${hint.tone}` : ''}`}
        aria-live="polite"
    >
        {hint ? hint.message : '\u00A0'}
    </div>
);

const parseJsonResponse = async (response) => {
    const rawText = await response.text();
    let data = null;
    let parseError = null;

    try {
        data = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
        parseError = error;
    }

    return { data, rawText, parseError };
};

const getResponseErrorMessage = (parsed, fallback) => {
    if (parsed?.data?.error) return parsed.data.error;
    if (parsed?.data?.message) return parsed.data.message;
    if (parsed?.parseError) {
        return '服务返回了非 JSON 响应，请检查公网反代 /api 或 CORS 配置';
    }
    return fallback;
};

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
    const [noticeState, setNoticeState] = useState(createClosedNoticeState);
    const [usernameCheckState, setUsernameCheckState] = useState(createUsernameCheckState);
    const [registerConfirmTouched, setRegisterConfirmTouched] = useState(false);
    const [resetConfirmTouched, setResetConfirmTouched] = useState(false);
    const usernameCheckRequestIdRef = useRef(0);

    const closeNotice = useCallback(() => {
        setNoticeState((current) => {
            if (typeof current.onClose === 'function') {
                current.onClose();
            }
            return createClosedNoticeState();
        });
    }, []);

    const openNotice = useCallback((message, options = {}) => {
        setNoticeState({
            open: true,
            title: options.title || '提示',
            message,
            buttonText: options.buttonText || '确定',
            onClose: typeof options.onClose === 'function' ? options.onClose : null
        });
    }, []);

    const normalizedUsername = username.trim();
    const registerPasswordMismatch = (
        mode === 'register' &&
        registerConfirmTouched &&
        confirmPassword.length > 0 &&
        password !== confirmPassword
    );
    const resetPasswordMismatch = (
        mode === 'reset' &&
        resetConfirmTouched &&
        confirmNewPassword.length > 0 &&
        newPassword !== confirmNewPassword
    );

    const usernameHint = useMemo(() => {
        if (mode !== 'register') return null;
        if (!username) return null;
        if (normalizedUsername.length < 3) {
            return {
                tone: 'error',
                message: '用户名至少3个字符'
            };
        }
        if (usernameCheckState.status === 'available') {
            return {
                tone: 'success',
                message: '用户名可用'
            };
        }
        if (usernameCheckState.status === 'taken' || usernameCheckState.status === 'error') {
            return {
                tone: 'error',
                message: usernameCheckState.message
            };
        }
        return null;
    }, [mode, normalizedUsername.length, username, usernameCheckState]);

    const runUsernameAvailabilityCheck = useCallback(async () => {
        if (mode !== 'register') return;

        if (!username) {
            setUsernameCheckState(createUsernameCheckState());
            return;
        }

        if (normalizedUsername.length < 3) {
            setUsernameCheckState({
                status: 'too_short',
                message: '用户名至少3个字符',
                available: null
            });
            return;
        }

        const requestId = usernameCheckRequestIdRef.current + 1;
        usernameCheckRequestIdRef.current = requestId;
        setUsernameCheckState({
            status: 'checking',
            message: '正在检查用户名...',
            available: null
        });

        try {
            const response = await fetch(`${API_BASE}/username-availability?username=${encodeURIComponent(normalizedUsername)}`);
            const parsed = await parseJsonResponse(response);
            const data = parsed.data;
            if (usernameCheckRequestIdRef.current !== requestId) return;
            if (!response.ok || !data) {
                setUsernameCheckState({
                    status: 'error',
                    message: getResponseErrorMessage(parsed, '用户名检查失败'),
                    available: null
                });
                return;
            }
            setUsernameCheckState({
                status: data.available ? 'available' : 'taken',
                message: data.available ? '用户名可用' : '用户名已存在',
                available: Boolean(data.available)
            });
        } catch (_error) {
            if (usernameCheckRequestIdRef.current !== requestId) return;
            setUsernameCheckState({
                status: 'error',
                message: '用户名检查失败',
                available: null
            });
        }
    }, [mode, normalizedUsername, username]);

    const handleLogin = async () => {
        try {
            const response = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const parsed = await parseJsonResponse(response);
            const data = parsed.data;
            if (response.ok && data) {
                onLogin(data);
            } else {
                openNotice(getResponseErrorMessage(parsed, '登录失败'), { title: '登录失败' });
            }
        } catch (error) {
            openNotice('连接失败: ' + error.message, { title: '登录失败' });
        }
    };

    const handleRegister = async () => {
        // 验证两次密码是否一致
        if (password !== confirmPassword) {
            return;
        }
        if (!password || password.length < 6) {
            openNotice('密码至少需要6个字符', { title: '注册失败' });
            return;
        }
        if (!normalizedUsername || normalizedUsername.length < 3) {
            return;
        }
        if (usernameCheckState.status === 'checking') {
            return;
        }
        if (usernameCheckState.available === false) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: normalizedUsername, password })
            });

            const parsed = await parseJsonResponse(response);
            const data = parsed.data;
            if (response.ok && data) {
                openNotice('注册成功！请登录', {
                    title: '注册成功',
                    onClose: () => {
                        setConfirmPassword('');
                        setMode('login');
                    }
                });
            } else {
                if (data?.error === '用户名已存在') {
                    setUsernameCheckState({
                        status: 'taken',
                        message: '用户名已存在',
                        available: false
                    });
                    return;
                }
                openNotice(getResponseErrorMessage(parsed, '注册失败'), { title: '注册失败' });
            }
        } catch (error) {
            openNotice('连接失败: ' + error.message, { title: '注册失败' });
        }
    };

    const handleResetPassword = async () => {
        // 验证新密码
        if (newPassword !== confirmNewPassword) {
            return;
        }
        if (!newPassword || newPassword.length < 6) {
            openNotice('新密码至少需要6个字符', { title: '修改失败' });
            return;
        }
        if (!username || !oldPassword) {
            openNotice('请输入用户名和原密码', { title: '修改失败' });
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    oldPassword,
                    newPassword
                })
            });

            const parsed = await parseJsonResponse(response);
            const data = parsed.data;
            if (response.ok && data) {
                openNotice('密码修改成功！请使用新密码登录', {
                    title: '修改成功',
                    onClose: () => {
                        setMode('login');
                        setOldPassword('');
                        setNewPassword('');
                        setConfirmNewPassword('');
                    }
                });
            } else {
                openNotice(getResponseErrorMessage(parsed, '密码修改失败'), { title: '修改失败' });
            }
        } catch (error) {
            openNotice('连接失败: ' + error.message, { title: '修改失败' });
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
                            onChange={(e) => {
                                setUsername(e.target.value);
                                setUsernameCheckState(createUsernameCheckState());
                            }}
                            onBlur={runUsernameAvailabilityCheck}
                            className="login-input"
                        />
                        {renderInlineHint(usernameHint)}
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
                                onBlur={() => setRegisterConfirmTouched(true)}
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
                        {renderInlineHint(
                            registerPasswordMismatch
                                ? { tone: 'error', message: '两次输入的密码不一致' }
                                : null
                        )}
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
                                onBlur={() => setResetConfirmTouched(true)}
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
                        {renderInlineHint(
                            resetPasswordMismatch
                                ? { tone: 'error', message: '两次输入的新密码不一致' }
                                : null
                        )}
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
            {noticeState.open && (
                <div className="auth-notice-backdrop" onClick={closeNotice}>
                    <div
                        className="auth-notice-modal"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="auth-notice-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="auth-notice-accent" aria-hidden="true" />
                        <div className="auth-notice-header">
                            <h3 id="auth-notice-title">{noticeState.title}</h3>
                        </div>
                        <div className="auth-notice-body">
                            <p className="auth-notice-message">{noticeState.message}</p>
                        </div>
                        <div className="auth-notice-actions">
                            <button type="button" className="btn btn-secondary auth-notice-button" onClick={closeNotice}>
                                {noticeState.buttonText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Login;
