import React from 'react';
import { Check, Search, X } from 'lucide-react';

const AdminChangeMasterModal = ({
    changingMasterNode,
    masterSearchKeyword,
    masterSearchResults,
    isMasterSearchLoading,
    hasMasterSearchTriggered,
    selectedNewMaster,
    setMasterSearchKeyword,
    setMasterSearchResults,
    setHasMasterSearchTriggered,
    setSelectedNewMaster,
    searchUsersForMaster,
    confirmChangeMaster,
    onClose
}) => {
    if (!changingMasterNode) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content change-master-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>更换域主: {changingMasterNode.name}</h3>
                    <button className="btn-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>当前域主: {changingMasterNode.domainMaster?.username || '无'}</label>
                    </div>
                    <div className="form-group">
                        <label>搜索新域主:</label>
                        <div className="change-master-search-wrap">
                            <div className="search-input-group">
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="输入用户名..."
                                    value={masterSearchKeyword}
                                    onChange={(e) => {
                                        const nextKeyword = e.target.value;
                                        setMasterSearchKeyword(nextKeyword);
                                        setMasterSearchResults([]);
                                        setHasMasterSearchTriggered(false);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            searchUsersForMaster(masterSearchKeyword);
                                        }
                                    }}
                                />
                                <button
                                    className="btn btn-primary"
                                    onClick={() => searchUsersForMaster(masterSearchKeyword)}
                                    disabled={!masterSearchKeyword.trim()}
                                >
                                    <Search size={16} />
                                </button>
                            </div>
                            {(isMasterSearchLoading || masterSearchResults.length > 0 || hasMasterSearchTriggered) && (
                                <div className="change-master-search-dropdown">
                                    {isMasterSearchLoading ? (
                                        <div className="change-master-search-status">搜索中...</div>
                                    ) : masterSearchResults.length > 0 ? (
                                        masterSearchResults.map((user) => (
                                            <div
                                                key={user._id}
                                                className={`search-result-item ${selectedNewMaster?._id === user._id ? 'selected' : ''}`}
                                                onClick={() => setSelectedNewMaster(user)}
                                            >
                                                <span>{user.username}</span>
                                                {selectedNewMaster?._id === user._id && <Check size={16} className="text-green-500" />}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="change-master-search-status">未找到匹配用户</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="form-group">
                        <label>已选择: {selectedNewMaster ? selectedNewMaster.username : '未选择 (将清除域主)'}</label>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>取消</button>
                    <button className="btn btn-primary" onClick={confirmChangeMaster}>确认更换</button>
                </div>
            </div>
        </div>
    );
};

export default AdminChangeMasterModal;
