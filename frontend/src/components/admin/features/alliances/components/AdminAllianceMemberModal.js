import React from 'react';
import { Search, X } from 'lucide-react';

const AdminAllianceMemberModal = ({
    editingAlliance,
    allianceMemberDraft,
    isAllianceMemberLoading,
    allianceMemberSearchKeyword,
    hasAllianceMemberSearchTriggered,
    allianceMemberSearchResults,
    isAllianceMemberSearchLoading,
    onClose,
    onSearchKeywordChange,
    onSearchSubmit,
    onAddAllianceMemberDraftUser,
    onRemoveAllianceMemberDraftUser,
    onConfirmAllianceMemberDraft
}) => {
    if (!editingAlliance) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content alliance-member-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>成员编辑：{editingAlliance.name}</h3>
                    <button className="btn-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="alliance-member-modal-section">
                        <label>已选成员（{allianceMemberDraft.length}）</label>
                        <div className="alliance-member-selected-list">
                            {allianceMemberDraft.length > 0 ? (
                                allianceMemberDraft.map((member) => (
                                    <div key={`alliance_member_draft_${member._id}`} className="alliance-member-selected-item">
                                        <div className="alliance-member-selected-main">
                                            <span className="alliance-member-selected-name">
                                                {member.username || '未知成员'}
                                                {member.isFounder ? '（盟主）' : ''}
                                            </span>
                                            <span className="alliance-member-selected-meta">
                                                Lv.{Number.isFinite(Number(member.level)) ? Number(member.level) : 0}
                                                {member.profession ? ` · ${member.profession}` : ''}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-small btn-secondary"
                                            onClick={() => onRemoveAllianceMemberDraftUser(member._id)}
                                            disabled={member.isFounder}
                                        >
                                            移除
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <div className="alliance-member-empty">暂无成员</div>
                            )}
                        </div>
                    </div>

                    <div className="alliance-member-modal-section">
                        <label>搜索添加成员</label>
                        <div className="search-input-group">
                            <input
                                type="text"
                                className="form-input"
                                placeholder="输入用户名/职业（回车搜索）"
                                value={allianceMemberSearchKeyword}
                                onChange={(e) => onSearchKeywordChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        onSearchSubmit(allianceMemberSearchKeyword);
                                    }
                                }}
                            />
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => onSearchSubmit(allianceMemberSearchKeyword)}
                                disabled={!allianceMemberSearchKeyword.trim()}
                            >
                                <Search size={16} />
                            </button>
                        </div>
                        {(isAllianceMemberSearchLoading || hasAllianceMemberSearchTriggered) && (
                            <div className="alliance-member-search-results">
                                {isAllianceMemberSearchLoading ? (
                                    <div className="alliance-member-search-status">搜索中...</div>
                                ) : allianceMemberSearchResults.length > 0 ? (
                                    allianceMemberSearchResults.map((user) => {
                                        const isSelected = allianceMemberDraft.some((item) => item._id === user._id);
                                        return (
                                            <div key={`alliance_member_search_${user._id}`} className="alliance-member-search-item">
                                                <div className="alliance-member-search-main">
                                                    <span className="alliance-member-search-name">{user.username || '未知成员'}</span>
                                                    <span className="alliance-member-search-meta">
                                                        Lv.{Number.isFinite(Number(user.level)) ? Number(user.level) : 0}
                                                        {user.profession ? ` · ${user.profession}` : ''}
                                                        {user.allianceName ? ` · 当前熵盟: ${user.allianceName}` : ''}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-secondary"
                                                    onClick={() => onAddAllianceMemberDraftUser(user)}
                                                    disabled={isSelected}
                                                >
                                                    {isSelected ? '已添加' : '添加'}
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="alliance-member-search-status">未找到匹配成员</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        取消
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={onConfirmAllianceMemberDraft}
                        disabled={allianceMemberDraft.length === 0 || isAllianceMemberLoading}
                    >
                        确认成员变更
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminAllianceMemberModal;
