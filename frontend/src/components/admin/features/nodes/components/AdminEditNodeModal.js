import React from 'react';
import { X } from 'lucide-react';

const AdminEditNodeModal = ({
    editingNode,
    editNodeForm,
    isSavingNodeEdit,
    setEditNodeForm,
    onClose,
    onSave
}) => {
    if (!editingNode) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content admin-edit-domain-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>编辑知识域标题</h3>
                    <button className="btn-close" onClick={onClose} disabled={isSavingNodeEdit}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>标题</label>
                        <input
                            type="text"
                            className="form-input"
                            value={editNodeForm.name}
                            onChange={(e) => setEditNodeForm((prev) => ({ ...prev, name: e.target.value }))}
                        />
                    </div>
                    <div className="form-group">
                        <label>概述</label>
                        <textarea
                            className="form-textarea"
                            rows={4}
                            value={editNodeForm.description}
                            onChange={(e) => setEditNodeForm((prev) => ({ ...prev, description: e.target.value }))}
                        />
                    </div>
                    <div className="admin-modal-grid-fields">
                        <label>
                            知识点
                            <input
                                type="number"
                                className="edit-input"
                                value={editNodeForm.knowledgePoint}
                                onChange={(e) => setEditNodeForm((prev) => ({ ...prev, knowledgePoint: e.target.value }))}
                            />
                        </label>
                        <label>
                            繁荣度
                            <input
                                type="number"
                                className="edit-input"
                                value={editNodeForm.prosperity}
                                onChange={(e) => setEditNodeForm((prev) => ({ ...prev, prosperity: e.target.value }))}
                            />
                        </label>
                        <label>
                            内容分数
                            <input
                                type="number"
                                className="edit-input"
                                value={editNodeForm.contentScore}
                                onChange={(e) => setEditNodeForm((prev) => ({ ...prev, contentScore: e.target.value }))}
                            />
                        </label>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={isSavingNodeEdit}>取消</button>
                    <button className="btn btn-primary" onClick={onSave} disabled={isSavingNodeEdit}>
                        {isSavingNodeEdit ? '保存中...' : '保存标题'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminEditNodeModal;
