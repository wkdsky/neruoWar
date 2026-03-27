import React from 'react';
import { PRESET_AVATAR_OPTIONS, resolveAvatarSrc } from '../../../../../app/appShared';

const AdminUsersTab = ({
    adminUserPagination,
    adminUserPageSize,
    pageSizeOptions,
    isAdminUserLoading,
    adminUserSearchInput,
    adminUserSearchKeyword,
    adminUserActionFeedback,
    allUsers,
    editingUser,
    editForm,
    setEditForm,
    setEditingUser,
    onAdminUserSearchInputChange,
    onAdminUserSearchSubmit,
    onAdminUserSearchClear,
    onAdminUserPageSizeChange,
    onRefreshUsers,
    onSaveUserEdit,
    onStartEditUser,
    onDeleteUser,
    onOpenUserCard,
    onPrevPage,
    onNextPage
}) => (
    <div className="users-table-container">
        <div className="table-info admin-list-toolbar">
            <p>总用户数: <strong>{adminUserPagination.total}</strong></p>
            <div className="admin-toolbar-center">
                <label htmlFor="adminUserPageSizeSelect">每页显示</label>
                <select
                    id="adminUserPageSizeSelect"
                    className="admin-page-size-select"
                    value={adminUserPageSize}
                    onChange={(e) => onAdminUserPageSizeChange(e.target.value)}
                    disabled={isAdminUserLoading}
                >
                    {pageSizeOptions.map((option) => (
                        <option key={`user_page_size_${option}`} value={option}>{option}</option>
                    ))}
                </select>
            </div>
            <div className="admin-toolbar-right">
                <div className="admin-search-group">
                    <div className="admin-search-input-wrap">
                        <input
                            type="text"
                            value={adminUserSearchInput}
                            onChange={(e) => onAdminUserSearchInputChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onAdminUserSearchSubmit();
                                }
                            }}
                            placeholder="搜索用户名/职业/公开ID（回车确认）"
                            className="admin-search-input"
                        />
                        {adminUserSearchKeyword && (
                            <button
                                type="button"
                                className="admin-search-clear-btn"
                                onClick={onAdminUserSearchClear}
                                title="清空搜索"
                                aria-label="清空搜索"
                                disabled={isAdminUserLoading}
                            >
                                X
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onAdminUserSearchSubmit}
                        disabled={isAdminUserLoading}
                    >
                        搜索
                    </button>
                </div>
                <button
                    type="button"
                    onClick={onRefreshUsers}
                    className="btn btn-primary"
                    disabled={isAdminUserLoading}
                >
                    刷新数据
                </button>
            </div>
        </div>
        {adminUserActionFeedback.message && (
            <div
                className={`admin-user-action-feedback ${adminUserActionFeedback.type === 'error' ? 'error' : 'success'}`}
                role="status"
                aria-live="polite"
            >
                {adminUserActionFeedback.message}
            </div>
        )}

        <div className="table-responsive">
            <table className="users-table">
                <thead>
                    <tr>
                        <th>头像 + ID</th>
                        <th>用户名</th>
                        <th>密码（明文）</th>
                        <th>等级</th>
                        <th>经验值</th>
                        <th>知识点余额</th>
                        <th>创建时间</th>
                        <th>更新时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {allUsers.map((user) => (
                        <tr
                            key={user._id}
                            className={editingUser === user._id ? '' : 'is-clickable'}
                            onClick={editingUser === user._id ? undefined : (event) => onOpenUserCard?.(user, event)}
                        >
                            <td>
                                {editingUser === user._id ? (
                                    <div className="admin-user-id-editor" onClick={(event) => event.stopPropagation()}>
                                        <div className="admin-user-id-editor__avatar-row">
                                            <img
                                                src={resolveAvatarSrc(editForm.avatar)}
                                                alt={editForm.username || '用户头像'}
                                                className="admin-user-id-cell__avatar"
                                            />
                                            <select
                                                value={editForm.avatar}
                                                onChange={(e) => setEditForm({
                                                    ...editForm,
                                                    avatar: e.target.value
                                                })}
                                                className="edit-input"
                                            >
                                                {PRESET_AVATAR_OPTIONS.map((option) => (
                                                    <option key={option.id} value={option.id}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <input
                                            type="text"
                                            value={editForm.publicId}
                                            onChange={(e) => setEditForm({
                                                ...editForm,
                                                publicId: e.target.value
                                            })}
                                            placeholder="公开ID，留空则显示系统ID"
                                            className="edit-input"
                                        />
                                        <span className="admin-user-id-cell__hint">{user._id}</span>
                                    </div>
                                ) : (
                                    <div className="admin-user-id-cell">
                                        <img
                                            src={resolveAvatarSrc(user.avatar)}
                                            alt={user.username || '用户头像'}
                                            className="admin-user-id-cell__avatar"
                                        />
                                        <div className="admin-user-id-cell__meta">
                                            <span className="admin-user-id-cell__value">{user.publicId || user._id}</span>
                                            <span className="admin-user-id-cell__hint">{user._id}</span>
                                        </div>
                                    </div>
                                )}
                            </td>
                            <td>
                                {editingUser === user._id ? (
                                    <input
                                        type="text"
                                        value={editForm.username}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            username: e.target.value
                                        })}
                                        className="edit-input"
                                        onClick={(event) => event.stopPropagation()}
                                    />
                                ) : (
                                    <span className="username-cell">
                                        {user.username}
                                        {user.profession && <span className="user-profession">【{user.profession}】</span>}
                                    </span>
                                )}
                            </td>
                            <td>
                                {editingUser === user._id ? (
                                    <input
                                        type="text"
                                        value={editForm.password}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            password: e.target.value
                                        })}
                                        placeholder="留空表示不修改密码"
                                        className="edit-input"
                                        onClick={(event) => event.stopPropagation()}
                                    />
                                ) : (
                                    <span className="password-cell">{user.password || '未保存'}</span>
                                )}
                            </td>
                            <td>
                                {editingUser === user._id ? (
                                    <input
                                        type="number"
                                        value={editForm.level}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            level: parseInt(e.target.value, 10)
                                        })}
                                        className="edit-input-small"
                                        onClick={(event) => event.stopPropagation()}
                                    />
                                ) : (
                                    user.level
                                )}
                            </td>
                            <td>
                                {editingUser === user._id ? (
                                    <input
                                        type="number"
                                        value={editForm.experience}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            experience: parseInt(e.target.value, 10)
                                        })}
                                        className="edit-input-small"
                                        onClick={(event) => event.stopPropagation()}
                                    />
                                ) : (
                                    user.experience
                                )}
                            </td>
                            <td>
                                {editingUser === user._id ? (
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={editForm.knowledgeBalance}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            knowledgeBalance: e.target.value
                                        })}
                                        className="edit-input-small"
                                        onClick={(event) => event.stopPropagation()}
                                    />
                                ) : (
                                    Number.isFinite(Number(user.knowledgeBalance))
                                        ? Number(user.knowledgeBalance).toFixed(2)
                                        : '0.00'
                                )}
                            </td>
                            <td>{new Date(user.createdAt).toLocaleString('zh-CN')}</td>
                            <td>{new Date(user.updatedAt).toLocaleString('zh-CN')}</td>
                            <td className="action-cell">
                                {editingUser === user._id ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onSaveUserEdit(user._id);
                                            }}
                                            className="btn-action btn-save"
                                        >
                                            保存
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setEditingUser(null);
                                            }}
                                            className="btn-action btn-cancel"
                                        >
                                            取消
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onStartEditUser(user);
                                            }}
                                            className="btn-action btn-edit"
                                        >
                                            编辑
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onDeleteUser(user._id, user.username);
                                            }}
                                            className="btn-action btn-delete"
                                        >
                                            删除
                                        </button>
                                    </>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        <div className="admin-list-pagination">
            <div className="admin-list-page-info">
                {isAdminUserLoading
                    ? '加载中...'
                    : `第 ${adminUserPagination.page} / ${Math.max(1, adminUserPagination.totalPages || 1)} 页`}
            </div>
            <div className="admin-list-page-actions">
                <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={onPrevPage}
                    disabled={isAdminUserLoading || adminUserPagination.page <= 1}
                >
                    上一页
                </button>
                <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={onNextPage}
                    disabled={isAdminUserLoading || (adminUserPagination.totalPages > 0 && adminUserPagination.page >= adminUserPagination.totalPages)}
                >
                    下一页
                </button>
            </div>
        </div>
    </div>
);

export default AdminUsersTab;
