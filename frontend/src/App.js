import React, { Suspense, lazy, useCallback, useState } from 'react';
import Login from './components/auth/Login';

const GameApp = lazy(() => import('./GameApp'));

const hasStoredSession = () => {
    if (typeof localStorage === 'undefined') return false;
    return Boolean(localStorage.getItem('token') && localStorage.getItem('username'));
};

const persistLoginState = (data = {}) => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('token', data.token || '');
    localStorage.setItem('userId', data.userId || '');
    localStorage.setItem('username', data.username || '');
    localStorage.setItem('userLocation', data.location || '');
    localStorage.setItem('profession', data.profession || '求知');
    localStorage.setItem('userAvatar', data.avatar || 'default_male_1');
    localStorage.setItem('userRole', data.role || '');
};

const LoginFallback = () => (
    <div className="login-container">
        <div className="login-box">
            <div className="login-header">
                <h1 className="login-title">NeuroWar</h1>
                <p className="login-subtitle">正在载入主界面...</p>
            </div>
        </div>
    </div>
);

const App = () => {
    const [shouldLoadGameApp, setShouldLoadGameApp] = useState(() => hasStoredSession());

    const handleLoginSuccess = useCallback((data) => {
        persistLoginState(data);
        setShouldLoadGameApp(true);
    }, []);

    if (!shouldLoadGameApp) {
        return <Login onLogin={handleLoginSuccess} />;
    }

    return (
        <Suspense fallback={<LoginFallback />}>
            <GameApp />
        </Suspense>
    );
};

export default App;
