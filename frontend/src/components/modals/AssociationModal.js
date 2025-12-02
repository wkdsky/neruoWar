import React from 'react';
import { X } from 'lucide-react';
import './AssociationModal.css';

const AssociationModal = ({ isOpen, onClose, viewingAssociationNode }) => {
    if (!isOpen || !viewingAssociationNode) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content association-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>节点关联详情</h2>
                    <button
                        className="modal-close"
                        onClick={onClose}
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="association-info">
                        <h3 className="node-title">{viewingAssociationNode.name}</h3>
                        <p className="node-desc">{viewingAssociationNode.description}</p>
                    </div>

                    <div className="association-section">
                        <h4 className="section-title">
                            母域节点
                        </h4>
                        <p className="association-hint">当前节点拓展了以下节点（或者说，以下节点包含当前节点）</p>
                        <div className="association-list">
                            {viewingAssociationNode.relatedParentDomains &&
                                viewingAssociationNode.relatedParentDomains.length > 0 ? (
                                <ul>
                                    {viewingAssociationNode.relatedParentDomains.map((domain, index) => (
                                        <li key={index} className="domain-item parent-domain">
                                            <span className="domain-badge parent">⬆ 母域</span>
                                            {domain}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="empty-message">暂无母域节点</p>
                            )}
                        </div>
                    </div>

                    <div className="association-section">
                        <h4 className="section-title">
                            子域节点
                        </h4>
                        <p className="association-hint">以下节点拓展了当前节点（或者说，当前节点包含以下节点）</p>
                        <div className="association-list">
                            {viewingAssociationNode.relatedChildDomains &&
                                viewingAssociationNode.relatedChildDomains.length > 0 ? (
                                <ul>
                                    {viewingAssociationNode.relatedChildDomains.map((domain, index) => (
                                        <li key={index} className="domain-item child-domain">
                                            <span className="domain-badge child">⬇ 子域</span>
                                            {domain}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="empty-message">暂无子域节点</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
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

export default AssociationModal;
