import React from 'react';

const AdminAlliancesTab = ({
    adminAlliancePagination,
    isAdminAllianceLoading,
    adminAlliances,
    editingAlliance,
    editAllianceForm,
    editAllianceMembers,
    isAllianceMemberLoading,
    onRefreshAdminAlliances,
    onAllianceFieldChange,
    onOpenAllianceMemberModal,
    onSaveAllianceEdit,
    onCancelEditAlliance,
    onStartEditAlliance,
    onDeleteAlliance,
    onPrevPage,
    onNextPage
}) => (
    <div className="alliances-admin-container">
        <div className="table-info alliances-admin-toolbar">
            <p>总熵盟数: <strong>{adminAlliancePagination.total}</strong></p>
            <button
                onClick={onRefreshAdminAlliances}
                className="btn btn-primary"
                style={{ marginLeft: '1rem' }}
                disabled={isAdminAllianceLoading}
            >
                刷新数据
            </button>
        </div>

        <div className="alliances-admin-grid">
            {adminAlliances.map((alliance) => (
                <div key={alliance._id} className="alliance-admin-card">
                    {editingAlliance && editingAlliance._id === alliance._id ? (
                        <div className="alliance-edit-form">
                            <div className="form-group">
                                <label>熵盟名称</label>
                                <input
                                    type="text"
                                    value={editAllianceForm.name}
                                    onChange={(e) => onAllianceFieldChange('name', e.target.value)}
                                    className="form-input"
                                />
                            </div>

                            <div className="form-group">
                                <label>旗帜颜色</label>
                                <div className="color-picker-group">
                                    <input
                                        type="color"
                                        value={editAllianceForm.flag}
                                        onChange={(e) => onAllianceFieldChange('flag', e.target.value)}
                                        className="color-picker"
                                    />
                                    <div className="flag-preview-small" style={{ backgroundColor: editAllianceForm.flag }} />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>熵盟号召</label>
                                <textarea
                                    value={editAllianceForm.declaration}
                                    onChange={(e) => onAllianceFieldChange('declaration', e.target.value)}
                                    className="form-textarea"
                                    rows="3"
                                />
                            </div>

                            <div className="form-group">
                                <label>知识点储备</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={editAllianceForm.knowledgeReserve}
                                    onChange={(e) => onAllianceFieldChange('knowledgeReserve', e.target.value)}
                                    className="form-input"
                                />
                            </div>

                            <div className="form-group">
                                <label>成员编辑</label>
                                <div className="alliance-member-edit-row">
                                    <span className="alliance-member-edit-count">
                                        当前成员: {editAllianceMembers.length}
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-small"
                                        onClick={onOpenAllianceMemberModal}
                                        disabled={isAllianceMemberLoading}
                                    >
                                        {isAllianceMemberLoading ? '成员加载中...' : '成员编辑'}
                                    </button>
                                </div>
                                {editAllianceMembers.length > 0 && (
                                    <div className="alliance-member-edit-list">
                                        {editAllianceMembers.map((member) => (
                                            <span key={`alliance_member_edit_${member._id}`} className={`alliance-member-edit-chip ${member.isFounder ? 'is-founder' : ''}`}>
                                                {member.username || '未知成员'}
                                                {member.isFounder ? '（盟主）' : ''}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="alliance-edit-actions">
                                <button onClick={onSaveAllianceEdit} className="btn btn-success" disabled={isAllianceMemberLoading}>
                                    {isAllianceMemberLoading ? '成员加载中...' : '保存'}
                                </button>
                                <button onClick={onCancelEditAlliance} className="btn btn-secondary">
                                    取消
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="alliance-admin-header">
                                <div className="alliance-flag-medium" style={{ backgroundColor: alliance.flag }} />
                                <div className="alliance-admin-info">
                                    <h3>{alliance.name}</h3>
                                    <p className="alliance-id">ID: {alliance._id}</p>
                                </div>
                            </div>

                            <div className="alliance-admin-details">
                                <div className="detail-row">
                                    <span className="detail-label">号召:</span>
                                    <span className="detail-value">{alliance.declaration}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">创始人:</span>
                                    <span className="detail-value">{alliance.founder?.username || '未知'}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">成员数:</span>
                                    <span className="detail-value">{alliance.memberCount}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">知识点:</span>
                                    <span className="detail-value">{Number(alliance.knowledgeReserve || 0)}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">管辖域:</span>
                                    <span className="detail-value">{alliance.domainCount}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">创建时间:</span>
                                    <span className="detail-value">{new Date(alliance.createdAt).toLocaleString('zh-CN')}</span>
                                </div>
                            </div>

                            <div className="alliance-admin-actions">
                                <button
                                    onClick={() => onStartEditAlliance(alliance)}
                                    className="btn btn-primary"
                                >
                                    编辑
                                </button>
                                <button
                                    onClick={() => onDeleteAlliance(alliance._id, alliance.name)}
                                    className="btn btn-danger"
                                >
                                    删除
                                </button>
                            </div>
                        </>
                    )}
                </div>
            ))}

            {adminAlliances.length === 0 && (
                <div className="empty-alliances-admin">
                    <p>{isAdminAllianceLoading ? '加载中...' : '暂无熵盟'}</p>
                </div>
            )}
        </div>
        <div className="alliances-admin-pagination">
            <div className="alliances-admin-page-info">
                {isAdminAllianceLoading
                    ? '加载中...'
                    : `第 ${adminAlliancePagination.page} / ${Math.max(1, adminAlliancePagination.totalPages || 1)} 页`}
            </div>
            <div className="alliances-admin-page-actions">
                <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={onPrevPage}
                    disabled={isAdminAllianceLoading || adminAlliancePagination.page <= 1}
                >
                    上一页
                </button>
                <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={onNextPage}
                    disabled={isAdminAllianceLoading || (adminAlliancePagination.totalPages > 0 && adminAlliancePagination.page >= adminAlliancePagination.totalPages)}
                >
                    下一页
                </button>
            </div>
        </div>
    </div>
);

export default AdminAlliancesTab;
