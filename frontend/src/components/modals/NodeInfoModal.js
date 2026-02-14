import React from 'react';
import { X, Compass } from 'lucide-react';
import './NodeInfoModal.css';

const NodeInfoModal = ({ isOpen, onClose, nodeDetail, onEnterKnowledgeDomain }) => {
    if (!isOpen || !nodeDetail) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content node-info-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>节点详细信息</h2>
                    <button
                        className="btn-close"
                        onClick={onClose}
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="node-info-section">
                        <h3 className="info-section-title">{nodeDetail.name}</h3>
                        <p className="info-section-desc">{nodeDetail.description}</p>
                    </div>

                    <div className="node-info-grid">
                        <div className="info-item">
                            <span className="info-label">创建者</span>
                            <span className="info-value">
                                {nodeDetail.owner?.username || '系统'}
                                {nodeDetail.owner?.profession && ` 【${nodeDetail.owner.profession}】`}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">创建时间</span>
                            <span className="info-value">
                                {new Date(nodeDetail.createdAt).toLocaleString('zh-CN')}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">内容分数</span>
                            <span className="info-value highlight">{nodeDetail.contentScore || 1} 点/分钟</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">知识点存量</span>
                            <span className="info-value highlight">
                                {(nodeDetail.knowledgePoint?.value || 0).toFixed(2)} 点
                            </span>
                        </div>
                    </div>

                    <div className="node-info-section">
                        <h4 className="info-section-subtitle">关联域</h4>
                        <div className="domain-summary">
                            <div className="domain-summary-item">
                                <span className="domain-summary-label">母域节点：</span>
                                <span className="domain-summary-value">
                                    {nodeDetail.relatedParentDomains?.length || 0} 个
                                </span>
                            </div>
                            <div className="domain-summary-item">
                                <span className="domain-summary-label">子域节点：</span>
                                <span className="domain-summary-value">
                                    {nodeDetail.relatedChildDomains?.length || 0} 个
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        className="btn btn-primary enter-domain-btn"
                        onClick={() => onEnterKnowledgeDomain && onEnterKnowledgeDomain(nodeDetail)}
                    >
                        <Compass size={18} />
                        进入知识域
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={onClose}
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NodeInfoModal;
