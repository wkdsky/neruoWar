import React from 'react';
import { Bell, Settings, Shield, Users, Zap } from 'lucide-react';

const TAB_ITEMS = [
    { key: 'users', label: '用户管理', icon: Users },
    { key: 'nodes', label: '知识域管理', icon: Zap },
    { key: 'pending', label: '待审批', icon: Bell, showBadge: true },
    { key: 'alliances', label: '熵盟管理', icon: Shield },
    { key: 'settings', label: '系统设置', icon: Settings },
    { key: 'unitTypes', label: '兵种管理', icon: Shield },
    { key: 'battlefieldItems', label: '物品管理', icon: Settings },
    { key: 'cityBuildingTypes', label: '建筑管理', icon: Settings }
];

const AdminTabNavigation = ({ adminTab, pendingApprovalCount = 0, onSelectTab }) => (
    <div className="admin-tabs">
        {TAB_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = adminTab === item.key;
            return (
                <button
                    key={item.key}
                    type="button"
                    onClick={() => onSelectTab(item.key)}
                    className={`admin-tab ${isActive ? 'active' : ''}`}
                >
                    <Icon className="icon-small" />
                    {item.label}
                    {item.showBadge && pendingApprovalCount > 0 && (
                        <span className="notification-badge">{pendingApprovalCount}</span>
                    )}
                </button>
            );
        })}
    </div>
);

export default AdminTabNavigation;
