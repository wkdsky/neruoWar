import React from 'react';

const AdminSettingsTab = ({
    travelUnitInput,
    distributionLeadInput,
    starMapNodeLimitInput,
    travelUnitSeconds,
    distributionAnnouncementLeadHours,
    starMapNodeLimit,
    onTravelUnitInputChange,
    onDistributionLeadInputChange,
    onStarMapNodeLimitInputChange,
    onSaveAdminSettings,
    onReloadAdminSettings
}) => (
    <div className="admin-settings-container">
        <div className="admin-settings-card">
            <h3>移动参数设置</h3>
            <p className="admin-settings-desc">
                设置普通用户在节点图上移动时，每经过 1 个相邻节点边所需的时间。
            </p>
            <div className="admin-settings-row">
                <label htmlFor="travelUnitSeconds">每单位移动耗时（秒）</label>
                <input
                    id="travelUnitSeconds"
                    type="number"
                    min="1"
                    max="86400"
                    value={travelUnitInput}
                    onChange={(e) => onTravelUnitInputChange(e.target.value)}
                    className="edit-input-small"
                />
            </div>
            <div className="admin-settings-row">
                <label htmlFor="distributionAnnouncementLeadHours">分发公告提前时长（小时）</label>
                <input
                    id="distributionAnnouncementLeadHours"
                    type="number"
                    min="1"
                    max="168"
                    value={distributionLeadInput}
                    onChange={(e) => onDistributionLeadInputChange(e.target.value)}
                    className="edit-input-small"
                />
            </div>
            <div className="admin-settings-row">
                <label htmlFor="starMapNodeLimit">星盘节点上限</label>
                <input
                    id="starMapNodeLimit"
                    type="number"
                    min="10"
                    max="200"
                    value={starMapNodeLimitInput}
                    onChange={(e) => onStarMapNodeLimitInputChange(e.target.value)}
                    className="edit-input-small"
                />
            </div>
            <div className="admin-settings-current">
                当前生效值: <strong>{travelUnitSeconds}</strong> 秒 / 单位，
                分发公告提前 <strong>{distributionAnnouncementLeadHours}</strong> 小时，
                星盘上限 <strong>{starMapNodeLimit}</strong> 个节点
            </div>
            <div className="admin-settings-actions">
                <button onClick={onSaveAdminSettings} className="btn btn-primary">保存设置</button>
                <button onClick={onReloadAdminSettings} className="btn btn-secondary">重新读取</button>
            </div>
        </div>
    </div>
);

export default AdminSettingsTab;
