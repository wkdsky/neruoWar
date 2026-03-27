import React from 'react';
import { Plus } from 'lucide-react';

const AdminNodesTab = ({
    adminDomainPagination,
    adminDomainPageSize,
    pageSizeOptions,
    isAdminDomainLoading,
    adminDomainSearchInput,
    adminDomainSearchKeyword,
    hierarchicalNodeList,
    editingSenseToken,
    editingSenseForm,
    editingSenseActionToken,
    setAdminDomainSearchInput,
    setEditingSenseForm,
    getSenseEditToken,
    getEditableSenseAssociationCount,
    onCreateNode,
    onAdminDomainPageSizeChange,
    onSubmitAdminDomainSearch,
    onClearAdminDomainSearch,
    onRefreshAdminDomainLatest,
    onOpenChangeMasterModal,
    onToggleFeaturedNode,
    onStartEditNode,
    onOpenAddSenseModal,
    onOpenDeleteNodeConfirmModal,
    onSaveSenseTextEdit,
    onCancelEditSenseText,
    onStartEditSenseText,
    onOpenEditAssociationModal,
    onOpenDeleteSenseModal,
    onPrevPage,
    onNextPage
}) => (
    <div className="nodes-table-container">
        <div className="table-info admin-list-toolbar">
            <p>总知识域数: <strong>{adminDomainPagination.total}</strong></p>
            <div className="admin-toolbar-center">
                <label htmlFor="adminDomainPageSizeSelect">每页显示</label>
                <select
                    id="adminDomainPageSizeSelect"
                    className="admin-page-size-select"
                    value={adminDomainPageSize}
                    onChange={(e) => onAdminDomainPageSizeChange(e.target.value)}
                    disabled={isAdminDomainLoading}
                >
                    {pageSizeOptions.map((option) => (
                        <option key={`domain_page_size_${option}`} value={option}>{option}</option>
                    ))}
                </select>
            </div>
            <div className="admin-toolbar-right">
                <button
                    type="button"
                    className="btn btn-success create-node-btn"
                    onClick={() => {
                        if (typeof onCreateNode === 'function') {
                            onCreateNode();
                        }
                    }}
                >
                    <Plus className="icon-small" />
                    新增知识域
                </button>
                <div className="admin-search-group">
                    <div className="admin-search-input-wrap">
                        <input
                            type="text"
                            value={adminDomainSearchInput}
                            onChange={(e) => setAdminDomainSearchInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onSubmitAdminDomainSearch();
                                }
                            }}
                            placeholder="搜索标题/概述（回车确认）"
                            className="admin-search-input"
                        />
                        {adminDomainSearchKeyword && (
                            <button
                                type="button"
                                className="admin-search-clear-btn"
                                onClick={onClearAdminDomainSearch}
                                title="清空搜索"
                                aria-label="清空搜索"
                                disabled={isAdminDomainLoading}
                            >
                                X
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onSubmitAdminDomainSearch}
                        disabled={isAdminDomainLoading}
                    >
                        搜索
                    </button>
                </div>
                <button
                    onClick={onRefreshAdminDomainLatest}
                    className="btn btn-primary"
                    disabled={isAdminDomainLoading}
                >
                    {isAdminDomainLoading ? '刷新中...' : '刷新列表'}
                </button>
            </div>
        </div>

        <div className="admin-domain-list">
            {hierarchicalNodeList.map((node) => (
                <div key={node._id} className="admin-domain-card">
                    <div className="admin-domain-title-row">
                        <div className="admin-domain-title-main">
                            <h3 className="admin-domain-title">{node.name}</h3>
                        </div>

                        <div className="admin-domain-title-meta">
                            <span className={`status-badge status-${node.status}`}>
                                {node.status === 'pending' ? '待审批' :
                                    node.status === 'approved' ? '已通过' : '已拒绝'}
                            </span>
                            <span className="admin-domain-meta-item">创建者：{node.owner?.username || '系统'}</span>
                            <span className="admin-domain-meta-item">域主：{node.domainMaster?.username || '(未设置)'}</span>
                            <span className="admin-domain-meta-item">创建时间：{new Date(node.createdAt).toLocaleString('zh-CN')}</span>
                            <span className="admin-domain-meta-item">知识点：{(node.knowledgePoint?.value || 0).toFixed(2)}</span>
                            <span className="admin-domain-meta-item">释义数：{node.senses.length}</span>
                            <span className="admin-domain-meta-item">繁荣度：{Math.round(node.prosperity || 0)}</span>
                            <span className="admin-domain-meta-item">内容分数：{node.contentScore || 1}</span>
                        </div>
                    </div>

                    <div className="admin-domain-title-actions">
                        <button
                            onClick={() => onOpenChangeMasterModal(node)}
                            className="btn-action btn-primary-small"
                            title="更换域主"
                        >
                            更换域主
                        </button>
                        <button
                            onClick={() => onToggleFeaturedNode(node._id, node.isFeatured)}
                            className={`btn-action ${node.isFeatured ? 'btn-featured-active' : 'btn-featured'}`}
                        >
                            {node.isFeatured ? '取消热门' : '设为热门'}
                        </button>
                        {node.isFeatured && (
                            <span className="featured-badge-small">热门排序：{node.featuredOrder || 0}</span>
                        )}
                        <button
                            onClick={() => onStartEditNode(node)}
                            className="btn-action btn-edit"
                        >
                            编辑标题
                        </button>
                        <button
                            onClick={() => onOpenAddSenseModal(node)}
                            className="btn-action btn-primary-small"
                        >
                            新增释义
                        </button>
                        <button
                            onClick={() => onOpenDeleteNodeConfirmModal(node)}
                            className="btn-action btn-delete"
                        >
                            删除标题
                        </button>
                    </div>

                    <div className="admin-domain-sense-list">
                        {node.senses.map((sense) => (
                            <div
                                key={`${node._id}_${sense.senseId}`}
                                className={`admin-domain-sense-item ${editingSenseToken === getSenseEditToken(node._id, sense.senseId) ? 'is-editing' : ''}`}
                            >
                                <div className="admin-domain-sense-main">
                                    <div className="admin-domain-sense-title-row">
                                        {editingSenseToken === getSenseEditToken(node._id, sense.senseId) ? (
                                            <div className="admin-field-with-error">
                                                <input
                                                    type="text"
                                                    className="edit-input"
                                                    value={editingSenseForm.title}
                                                    onChange={(e) => setEditingSenseForm((prev) => ({
                                                        ...prev,
                                                        title: e.target.value
                                                    }))}
                                                    placeholder="释义题目"
                                                />
                                                {String(editingSenseForm.title || '').trim() === '' && (
                                                    <span className="error-text inline-field-error">释义题目不能为空</span>
                                                )}
                                            </div>
                                        ) : (
                                            <h4 className="admin-domain-sense-title">{sense.title}</h4>
                                        )}
                                        <span className="admin-domain-sense-count">
                                            关联 {getEditableSenseAssociationCount(node, sense.senseId)}
                                        </span>
                                    </div>
                                </div>

                                <div className="admin-domain-sense-actions">
                                    {editingSenseToken === getSenseEditToken(node._id, sense.senseId) ? (
                                        <>
                                            <button
                                                onClick={() => onSaveSenseTextEdit(node, sense)}
                                                className="btn-action btn-save"
                                                disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                            >
                                                {editingSenseActionToken === getSenseEditToken(node._id, sense.senseId) ? '保存中...' : '保存题目'}
                                            </button>
                                            <button
                                                onClick={onCancelEditSenseText}
                                                className="btn-action btn-cancel"
                                                disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                            >
                                                取消
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => onStartEditSenseText(node, sense)}
                                            className="btn-action btn-edit"
                                        >
                                            编辑释义题目
                                        </button>
                                    )}
                                    <button
                                        onClick={() => onOpenEditAssociationModal(node, sense)}
                                        className="btn-action btn-edit"
                                        disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                    >
                                        关联管理
                                    </button>
                                    <button
                                        onClick={() => onOpenDeleteSenseModal(node, sense)}
                                        className="btn-action btn-delete"
                                        disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                    >
                                        删除释义
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
        <div className="admin-list-pagination">
            <div className="admin-list-page-info">
                {isAdminDomainLoading
                    ? '加载中...'
                    : `第 ${adminDomainPagination.page} / ${Math.max(1, adminDomainPagination.totalPages || 1)} 页`}
            </div>
            <div className="admin-list-page-actions">
                <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={onPrevPage}
                    disabled={isAdminDomainLoading || adminDomainPagination.page <= 1}
                >
                    上一页
                </button>
                <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={onNextPage}
                    disabled={isAdminDomainLoading || (adminDomainPagination.totalPages > 0 && adminDomainPagination.page >= adminDomainPagination.totalPages)}
                >
                    下一页
                </button>
            </div>
        </div>
    </div>
);

export default AdminNodesTab;
