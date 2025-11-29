import React, { useState } from 'react';
import './Login.css';

const Login = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleLogin = async (isRegister = false) => {
        try {
            const response = await fetch(`http://localhost:5000/api/${isRegister ? 'register' : 'login'}`, {
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

    return (
        <div className="login-container">
            <div className="login-box">
                <div className="login-header">
                    <h1 className="login-title">NeuroWar</h1>
                    <p className="login-subtitle">Neural Network Strategy Game</p>
                </div>
                <div className="login-form">
                    <input
                        type="text"
                        placeholder="用户名"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="login-input"
                    />
                    <input
                        type="password"
                        placeholder="密码"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="login-input"
                        onKeyPress={(e) => e.key === 'Enter' && handleLogin(false)}
                    />
                    <div className="login-buttons">
                        <button 
                            onClick={() => handleLogin(false)}
                            className="btn btn-primary btn-green"
                            style={{flex: 1}}
                        >
                            登录
                        </button>
                        <button 
                            onClick={() => handleLogin(true)}
                            className="btn btn-secondary btn-blue"
                            style={{flex: 1}}
                        >
                            注册
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
