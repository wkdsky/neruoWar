import React from 'react';
import AdminUsersTab from './components/AdminUsersTab';

const AdminUsersFeature = ({ isActive, ...props }) => {
    if (!isActive) return null;
    return <AdminUsersTab {...props} />;
};

export default AdminUsersFeature;
