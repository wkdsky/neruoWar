import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

const AdminPendingTab = ({
    pendingApprovalCount,
    pendingNodes,
    pendingMasterApplications,
    groupedPendingNodes,
    groupedPendingMasterApplications,
    pendingNodeActionId,
    pendingNodeActionGroupName,
    pendingNodeSelectedSenseByNodeId,
    masterApplyActionId,
    normalizeNodeSenses,
    getPendingSenseAssociations,
    selectPendingNodeSense,
    approveNode,
    rejectNode,
    reviewMasterApplication,
    refreshPendingApprovals
}) => (
    <div className="pending-nodes-container">
        <div className="table-info">
            <p>待审批总数: <strong>{pendingApprovalCount}</strong></p>
            <span className="pending-summary-tag node">创建新知识域申请: {pendingNodes.length}</span>
            <span className="pending-summary-tag master">域主申请: {pendingMasterApplications.length}</span>
            {groupedPendingNodes.some((group) => group.hasConflict) && (
                <span className="conflict-warning">
                    <AlertTriangle className="icon-small" />
                    存在同名申请竞争
                </span>
            )}
            {groupedPendingMasterApplications.some((group) => group.hasConflict) && (
                <span className="conflict-warning master">
                    <AlertTriangle className="icon-small" />
                    存在同域申请竞争
                </span>
            )}
            <button
                onClick={refreshPendingApprovals}
                className="btn btn-primary"
                style={{ marginLeft: '1rem' }}
            >
                刷新数据
            </button>
        </div>

        {pendingApprovalCount === 0 ? (
            <div className="no-pending-nodes">
                <p>暂无待审批申请</p>
            </div>
        ) : (
            <div className="pending-approval-sections">
                {pendingNodes.length > 0 && (
                    <div className="pending-approval-section node">
                        <div className="pending-approval-section-header">
                            <h3>新知识域创建审批</h3>
                            <span className="pending-section-count">{pendingNodes.length}</span>
                        </div>
                        <div className="pending-nodes-list admin">
                            {groupedPendingNodes.map((group) => (
                                <div key={group.name} className={`pending-group ${group.hasConflict ? 'has-conflict' : ''}`}>
                                    {group.hasConflict && (
                                        <div className="conflict-group-header">
                                            <AlertTriangle className="icon-small" />
                                            <span>同名申请竞争: "{group.name}" ({group.nodes.length} 个申请)</span>
                                            <span className="conflict-hint">请对比后选择一个通过，其他将自动拒绝</span>
                                        </div>
                                    )}

                                    <div className={`pending-nodes-grid ${group.hasConflict ? 'conflict-grid' : ''}`}>
                                        {group.nodes.map((node, index) => {
                                            const isNodeActing = pendingNodeActionId === node._id;
                                            const isGroupActing = Boolean(group.hasConflict && pendingNodeActionGroupName === group.name && pendingNodeActionId);
                                            const disableActions = isNodeActing || isGroupActing;
                                            const pendingSenseList = normalizeNodeSenses(node);
                                            const selectedSenseCandidate = pendingNodeSelectedSenseByNodeId[node._id];
                                            const selectedSenseId = pendingSenseList.some((sense) => sense.senseId === selectedSenseCandidate)
                                                ? selectedSenseCandidate
                                                : (pendingSenseList[0]?.senseId || '');
                                            const senseAssociationMap = new Map(
                                                pendingSenseList.map((sense) => [sense.senseId, getPendingSenseAssociations(node, sense.senseId)])
                                            );
                                            const selectedSense = pendingSenseList.find((sense) => sense.senseId === selectedSenseId) || null;
                                            const selectedSenseAssociations = selectedSense
                                                ? (senseAssociationMap.get(selectedSense.senseId) || [])
                                                : [];

                                            return (
                                                <div key={node._id} className={`pending-node-card pending-review-card pending-review-card-node ${group.hasConflict ? 'conflict-card' : ''}`}>
                                                    {group.hasConflict && (
                                                        <div className="conflict-badge">申请 #{index + 1}</div>
                                                    )}
                                                    <div className="node-header">
                                                        <div className="pending-node-title-row">
                                                            <h3 className="node-title">{node.name}</h3>
                                                            {node.description ? (
                                                                <span className="pending-node-overview-inline" title={node.description}>
                                                                    {node.description}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className="pending-card-badges">
                                                            <span className="pending-card-type pending-card-type-node">创建新知识域申请</span>
                                                            <span className={`status-badge status-${node.status}`}>
                                                                {node.status === 'pending' ? '待审批' :
                                                                    node.status === 'approved' ? '已通过' : '已拒绝'}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="node-details">
                                                        <div className="node-meta">
                                                            <div className="meta-item pending-meta-inline">
                                                                <strong>创建者:</strong> {node.owner?.username || '未知用户'}
                                                                {node.owner?.profession && (
                                                                    <span className="user-profession">【{node.owner.profession}】</span>
                                                                )}
                                                                <span className="pending-meta-divider">·</span>
                                                                <strong>提交时间:</strong> {new Date(node.createdAt).toLocaleString('zh-CN')}
                                                            </div>
                                                        </div>

                                                        <div className="pending-sense-review-section">
                                                            <h4>新建释义（{pendingSenseList.length} 个）</h4>
                                                            <div className="pending-sense-chip-list">
                                                                {pendingSenseList.map((sense) => {
                                                                    const isActive = selectedSenseId === sense.senseId;
                                                                    return (
                                                                        <button
                                                                            key={sense.senseId}
                                                                            type="button"
                                                                            className={`pending-sense-chip ${isActive ? 'active' : ''}`}
                                                                            onClick={() => selectPendingNodeSense(node._id, sense.senseId)}
                                                                            title={sense.title || sense.senseId}
                                                                        >
                                                                            <span className="pending-sense-chip-title">{sense.title || sense.senseId}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>

                                                            {selectedSense && (
                                                                <div className="pending-sense-detail-panel">
                                                                    <div className="pending-sense-detail-header">
                                                                        <h5>{selectedSense.title || selectedSense.senseId}</h5>
                                                                    </div>
                                                                    <div className="pending-sense-relation-list">
                                                                        {selectedSenseAssociations.length > 0 ? (
                                                                            selectedSenseAssociations.map((relationItem) => (
                                                                                <div
                                                                                    key={relationItem.id}
                                                                                    className="pending-sense-relation-item"
                                                                                    title={relationItem.displayText}
                                                                                >
                                                                                    <span className="pending-sense-relation-text">{relationItem.displayText}</span>
                                                                                    <span className={`admin-relation-badge ${relationItem.relationClassName}`}>
                                                                                        {relationItem.relationLabel}
                                                                                    </span>
                                                                                </div>
                                                                            ))
                                                                        ) : (
                                                                            <p className="pending-sense-empty">该释义暂无关联关系</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="node-actions">
                                                        <button
                                                            onClick={() => approveNode(node._id, node.name)}
                                                            className="btn btn-success"
                                                            disabled={disableActions}
                                                        >
                                                            <Check className="icon-small" />
                                                            {isNodeActing ? '处理中...' : (group.hasConflict ? '选择此申请' : '通过')}
                                                        </button>
                                                        <button
                                                            onClick={() => rejectNode(node._id)}
                                                            className="btn btn-danger"
                                                            disabled={disableActions}
                                                        >
                                                            <X className="icon-small" />
                                                            {isNodeActing ? '处理中...' : '拒绝'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {pendingMasterApplications.length > 0 && (
                    <div className="pending-approval-section master">
                        <div className="pending-approval-section-header">
                            <h3>域主申请审批</h3>
                            <span className="pending-section-count">{pendingMasterApplications.length}</span>
                        </div>
                        <div className="pending-nodes-list admin">
                            {groupedPendingMasterApplications.map((group) => (
                                <div key={group.nodeId} className={`pending-group ${group.hasConflict ? 'has-conflict master-has-conflict' : ''}`}>
                                    {group.hasConflict && (
                                        <div className="conflict-group-header master-apply-group-header">
                                            <AlertTriangle className="icon-small" />
                                            <span>同域申请竞争: "{group.nodeName}" ({group.applications.length} 个申请)</span>
                                            <span className="conflict-hint">请择优同意一个申请</span>
                                        </div>
                                    )}

                                    <div className={`pending-nodes-grid ${group.hasConflict ? 'conflict-grid' : ''}`}>
                                        {group.applications.map((application, index) => {
                                            const actionKey = masterApplyActionId.split(':')[0];
                                            const isActing = actionKey === application._id;
                                            const applicantName = application.inviteeUsername || application.inviterUsername || '未知用户';
                                            return (
                                                <div key={application._id} className={`pending-node-card pending-review-card pending-review-card-master ${group.hasConflict ? 'conflict-card master-conflict-card' : ''}`}>
                                                    {group.hasConflict && (
                                                        <div className="conflict-badge master-conflict-badge">申请 #{index + 1}</div>
                                                    )}
                                                    <div className="node-header">
                                                        <h3 className="node-title">{group.nodeName}</h3>
                                                        <div className="pending-card-badges">
                                                            <span className="pending-card-type pending-card-type-master">域主申请</span>
                                                            <span className="status-badge status-pending">待审批</span>
                                                        </div>
                                                    </div>

                                                    <div className="node-details">
                                                        <p className="node-description">{`${applicantName} 申请成为该知识域域主`}</p>

                                                        <div className="node-meta">
                                                            <div className="meta-item">
                                                                <strong>申请人:</strong> {applicantName}
                                                            </div>
                                                            <div className="meta-item">
                                                                <strong>申请理由:</strong> {application.applicationReason || '（未填写）'}
                                                            </div>
                                                            <div className="meta-item">
                                                                <strong>提交时间:</strong> {new Date(application.createdAt).toLocaleString('zh-CN')}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="node-actions">
                                                        <button
                                                            onClick={() => reviewMasterApplication(application._id, 'accept')}
                                                            className="btn pending-master-approve-btn"
                                                            disabled={isActing}
                                                        >
                                                            <Check className="icon-small" />
                                                            同意成为域主
                                                        </button>
                                                        <button
                                                            onClick={() => reviewMasterApplication(application._id, 'reject')}
                                                            className="btn pending-master-reject-btn"
                                                            disabled={isActing}
                                                        >
                                                            <X className="icon-small" />
                                                            拒绝
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}
    </div>
);

export default AdminPendingTab;
