import React from 'react';
import AdminSettingsTab from './components/AdminSettingsTab';

const AdminSettingsFeature = ({ isActive, ...props }) => {
    if (!isActive) return null;
    return <AdminSettingsTab {...props} />;
};

export default AdminSettingsFeature;
