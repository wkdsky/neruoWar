import React from 'react';
import { BattleSceneModal } from '../../game/battle';
import BattlefieldPreviewModal from '../game/BattlefieldPreviewModal';
import AssociationModal from '../modals/AssociationModal';
import NodeInfoModal from '../modals/NodeInfoModal';
import CreateNodeModal from '../modals/CreateNodeModal';
import { CITY_GATE_LABEL_MAP } from '../../app/appShared';

const renderGateDefenseEntries = (entries = []) => (
  entries.length > 0 ? (
    entries.map((entry) => (
      <div key={entry.unitTypeId} className="intel-heist-gate-row">
        <span>{entry.unitName || entry.unitTypeId}</span>
        <em>{entry.count}</em>
      </div>
    ))
  ) : (
    <div className="intel-heist-tip">无驻防</div>
  )
);

const AppOverlays = ({
  intelHeistDialog,
  closeIntelHeistDialog,
  formatDateTimeText,
  getElapsedMinutesText,
  intelHeistStatus,
  startIntelHeistMiniGame,
  currentTitleDetail,
  currentNodeDetail,
  siegeDialog,
  resetSiegeDialog,
  isSiegeDomainMasterViewer,
  isSiegeDomainAdminViewer,
  siegeStatus,
  siegeActiveGateRows,
  requestSiegeSupport,
  siegeBattlefieldPreviewState,
  canPreviewSiegeBattlefield,
  handleOpenSiegeBattlefieldPreview,
  siegeSupportDraft,
  setSiegeSupportDraft,
  submitSiegeSupport,
  startSiege,
  isSiegeReadonlyViewer,
  canLaunchSiegePveBattle,
  handleOpenSiegePveBattle,
  retreatSiege,
  pveBattleState,
  closeSiegePveBattle,
  handlePveBattleFinished,
  closeSiegeBattlefieldPreview,
  showAssociationModal,
  closeAssociationModal,
  viewingAssociationNode,
  showNodeInfoModal,
  closeNodeInfoModal,
  nodeInfoModalTarget,
  handleEnterKnowledgeDomain,
  openSenseArticleFromNode,
  canApplyDomainMaster,
  isApplyingDomainMaster,
  handleApplyDomainMaster,
  showCreateNodeModal,
  closeCreateNodeModal,
  username,
  isAdmin,
  nodes,
  sceneManager,
  handleCreateNodeSuccess
}) => (
  <>
    {intelHeistDialog.open && (
      <div className="modal-overlay" onClick={closeIntelHeistDialog}>
        <div className="modal-content intel-heist-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h3>{`情报窃取：${intelHeistDialog.node?.name || currentTitleDetail?.name || currentNodeDetail?.name || '知识域'}`}</h3>
            <button type="button" className="btn-close" onClick={closeIntelHeistDialog}>
              ×
            </button>
          </div>
          <div className="modal-body intel-heist-modal-body">
            {intelHeistDialog.loading && (
              <div className="intel-heist-tip">读取情报状态中...</div>
            )}
            {!intelHeistDialog.loading && intelHeistDialog.error && (
              <div className="intel-heist-error">{intelHeistDialog.error}</div>
            )}
            {!intelHeistDialog.loading && intelHeistDialog.snapshot && (
              <div className="intel-heist-snapshot">
                <div className="intel-heist-tip">
                  上次快照时间：{formatDateTimeText(intelHeistDialog.snapshot.capturedAt)}
                </div>
                <div className="intel-heist-tip">
                  部署执行时间：{formatDateTimeText(intelHeistDialog.snapshot.deploymentUpdatedAt)}
                  {`（${getElapsedMinutesText(intelHeistDialog.snapshot.deploymentUpdatedAt) || '未知时刻'}）`}
                </div>
                <div className="intel-heist-gate-block">
                  <strong>承口驻防</strong>
                  {renderGateDefenseEntries(intelHeistDialog.snapshot?.gateDefense?.cheng || [])}
                </div>
                <div className="intel-heist-gate-block">
                  <strong>启口驻防</strong>
                  {renderGateDefenseEntries(intelHeistDialog.snapshot?.gateDefense?.qi || [])}
                </div>
              </div>
            )}
            {!intelHeistDialog.loading && !intelHeistDialog.snapshot && !intelHeistDialog.error && (
              <div className="intel-heist-tip">当前没有该知识域的情报快照，可直接执行窃取。</div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={closeIntelHeistDialog}>
              关闭
            </button>
            {!intelHeistDialog.loading && intelHeistStatus.canSteal && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => startIntelHeistMiniGame(intelHeistDialog.node || currentTitleDetail || currentNodeDetail)}
              >
                {intelHeistDialog.snapshot ? '再次窃取' : '开始窃取'}
              </button>
            )}
          </div>
        </div>
      </div>
    )}

    {siegeDialog.open && (
      <div className="modal-overlay" onClick={resetSiegeDialog}>
        <div className="modal-content siege-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h3>
              {isSiegeDomainMasterViewer
                ? '你的知识域正被攻击！'
                : (isSiegeDomainAdminViewer
                  ? '你管理的知识域正被攻击！'
                  : `攻占知识域：${siegeDialog.node?.name || currentTitleDetail?.name || currentNodeDetail?.name || siegeStatus.nodeName || '知识域'}`)}
            </h3>
            <button type="button" className="btn-close" onClick={resetSiegeDialog}>
              ×
            </button>
          </div>
          <div className="modal-body siege-modal-body">
            {siegeDialog.loading ? (
              <div className="intel-heist-tip">读取围城状态中...</div>
            ) : (
              <>
                {siegeDialog.error && <div className="siege-error">{siegeDialog.error}</div>}
                {siegeDialog.message && <div className="siege-message">{siegeDialog.message}</div>}

                {isSiegeDomainAdminViewer ? (
                  <div className="siege-support-panel">
                    <strong>围城预警</strong>
                    {siegeActiveGateRows.length > 0 ? (
                      siegeActiveGateRows.map((gate) => (
                        <div key={gate.gateKey} className="siege-defender-gate">
                          <div className="siege-defender-gate-title">
                            <span>{gate.gateLabel || CITY_GATE_LABEL_MAP[gate.gateKey] || gate.gateKey}</span>
                            <em>{`${gate.attackers.length}人`}</em>
                          </div>
                          {gate.attackers.length > 0 ? (
                            gate.attackers.map((attacker) => (
                              <div key={attacker.userId || attacker.username} className="siege-force-row">
                                <span>{attacker.username || '未知成员'}</span>
                                <em>{attacker.statusLabel || attacker.status || '-'}</em>
                              </div>
                            ))
                          ) : (
                            <div className="intel-heist-tip">暂无可见攻击用户</div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="intel-heist-tip">当前没有进行中的围城</div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="siege-vs-block">
                      <div className="siege-force-card attacker">
                        <strong>我方兵力</strong>
                        <div className="siege-force-total">{siegeStatus.compare?.attacker?.totalCount || 0}</div>
                        {(siegeStatus.compare?.attacker?.units || []).length > 0 ? (
                          <div className="siege-force-list">
                            {(siegeStatus.compare.attacker.units || []).map((entry) => (
                              <div key={entry.unitTypeId} className="siege-force-row">
                                <span>{entry.unitName || entry.unitTypeId}</span>
                                <em>{entry.count}</em>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="intel-heist-tip">无兵力</div>
                        )}
                        {siegeStatus.hasActiveSiege && siegeStatus.canRequestSupport && (
                          <button
                            type="button"
                            className="btn btn-warning siege-request-support-btn"
                            onClick={requestSiegeSupport}
                            disabled={siegeDialog.submitting}
                          >
                            {siegeDialog.submitting ? '呼叫中...' : '呼叫熵盟支援'}
                          </button>
                        )}
                      </div>
                      <div className="siege-vs-label">VS</div>
                      <div className="siege-force-card defender">
                        <strong>守方兵力</strong>
                        <div className="siege-force-total">
                          {siegeStatus.compare?.defender?.source === 'intel'
                            ? (siegeStatus.compare?.defender?.totalCount || 0)
                            : '未知'}
                        </div>
                        <div className="siege-force-source">
                          {siegeStatus.compare?.defender?.source === 'intel'
                            ? (isSiegeDomainMasterViewer ? '守备视图' : '情报视图')
                            : '无情报'}
                        </div>
                        {siegeStatus.compare?.defender?.source === 'intel' && siegeStatus.intelDeploymentUpdatedAt && (
                          <div className="siege-force-source">
                            部署时间：{formatDateTimeText(siegeStatus.intelDeploymentUpdatedAt)}
                            {`（${getElapsedMinutesText(siegeStatus.intelDeploymentUpdatedAt) || '未知时刻'}）`}
                          </div>
                        )}
                        {siegeStatus.compare?.defender?.source === 'intel' && siegeStatus.hasActiveSiege && (
                          <div className="siege-support-panel">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleOpenSiegeBattlefieldPreview}
                              disabled={!canPreviewSiegeBattlefield || siegeBattlefieldPreviewState.loading}
                              title={canPreviewSiegeBattlefield ? '' : '当前门位无可预览战场'}
                            >
                              {siegeBattlefieldPreviewState.loading ? '预览加载中...' : '预览战场'}
                            </button>
                            {siegeBattlefieldPreviewState.error && (
                              <div className="intel-heist-tip">{siegeBattlefieldPreviewState.error}</div>
                            )}
                          </div>
                        )}
                        {siegeStatus.compare?.defender?.source === 'intel' ? (
                          <details className="siege-force-gates" open>
                            <summary className="siege-force-source">展开驻防信息</summary>
                            {(siegeStatus.compare?.defender?.gates || []).length > 0 ? (
                              (siegeStatus.compare?.defender?.gates || []).map((gate) => (
                                <div key={gate.gateKey} className={`siege-defender-gate ${gate.highlight ? 'highlight' : ''}`}>
                                  <div className="siege-defender-gate-title">
                                    <span>{gate.gateLabel || CITY_GATE_LABEL_MAP[gate.gateKey] || gate.gateKey}</span>
                                    <em>{gate.totalCount || 0}</em>
                                  </div>
                                  {(gate.entries || []).length > 0 ? (
                                    (gate.entries || []).map((entry) => (
                                      <div key={entry.unitTypeId} className="siege-force-row">
                                        <span>{entry.unitName || entry.unitTypeId}</span>
                                        <em>{entry.count}</em>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="intel-heist-tip">无驻防</div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="intel-heist-tip">当前门位无驻防信息</div>
                            )}
                          </details>
                        ) : (
                          <div className="intel-heist-tip">暂无情报文件，无法查看守方驻防信息</div>
                        )}
                      </div>
                    </div>

                    {siegeStatus.hasActiveSiege && (siegeStatus.compare?.attacker?.supporters || []).length > 0 && (
                      <div className="siege-supporter-list">
                        <strong>攻方参战成员</strong>
                        {(siegeStatus.compare.attacker.supporters || []).map((item) => (
                          <div key={item.userId || item.username} className="siege-supporter-row">
                            <span>{item.username || '未知成员'}</span>
                            <span>{item.statusLabel || item.status || '-'}</span>
                            <em>{item.totalCount || 0}</em>
                          </div>
                        ))}
                      </div>
                    )}

                    {siegeStatus.hasActiveSiege && (
                      <div className="siege-support-panel">
                        <strong>同战场支援</strong>
                        {siegeStatus.canSupportSameBattlefield ? (
                          <>
                            <div className="siege-support-meta">
                              <label>目标战场</label>
                              <select
                                value={siegeSupportDraft.gateKey || siegeStatus.supportGate || ''}
                                onChange={(event) => setSiegeSupportDraft((prev) => ({
                                  ...prev,
                                  gateKey: event.target.value
                                }))}
                              >
                                {(siegeStatus.activeGateKeys || []).map((gateKey) => (
                                  <option key={gateKey} value={gateKey}>
                                    {CITY_GATE_LABEL_MAP[gateKey] || gateKey}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="siege-support-meta">
                              <label>自动撤出阈值</label>
                              <div className="siege-support-retreat">
                                <input
                                  type="range"
                                  min="1"
                                  max="99"
                                  value={Math.max(1, Math.min(99, Number(siegeSupportDraft.autoRetreatPercent) || 40))}
                                  onChange={(event) => setSiegeSupportDraft((prev) => ({
                                    ...prev,
                                    autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(event.target.value) || 40)))
                                  }))}
                                />
                                <input
                                  type="number"
                                  min="1"
                                  max="99"
                                  value={Math.max(1, Math.min(99, Number(siegeSupportDraft.autoRetreatPercent) || 40))}
                                  onChange={(event) => setSiegeSupportDraft((prev) => ({
                                    ...prev,
                                    autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(event.target.value) || 40)))
                                  }))}
                                />
                                <span>%</span>
                              </div>
                            </div>
                            <div className="siege-support-unit-list">
                              {(siegeStatus.ownRoster?.units || []).map((entry) => (
                                <div key={entry.unitTypeId} className="siege-support-unit-row">
                                  <span>{entry.unitName || entry.unitTypeId}</span>
                                  <small>可用 {entry.count}</small>
                                  <input
                                    type="number"
                                    min="0"
                                    max={entry.count}
                                    value={Math.max(0, Math.floor(Number(siegeSupportDraft.units?.[entry.unitTypeId]) || 0))}
                                    onChange={(event) => {
                                      const nextQty = Math.max(0, Math.min(entry.count, Math.floor(Number(event.target.value) || 0)));
                                      setSiegeSupportDraft((prev) => ({
                                        ...prev,
                                        units: {
                                          ...(prev.units || {}),
                                          [entry.unitTypeId]: nextQty
                                        }
                                      }));
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={submitSiegeSupport}
                              disabled={siegeDialog.supportSubmitting}
                            >
                              {siegeDialog.supportSubmitting ? '派遣中...' : '派遣支援'}
                            </button>
                          </>
                        ) : (
                          <div className="intel-heist-tip">
                            {siegeStatus.supportDisabledReason || '当前不可支援该战场'}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={resetSiegeDialog}>
              {siegeStatus.hasActiveSiege ? '关闭' : '取消'}
            </button>
            {!siegeDialog.loading && !siegeStatus.hasActiveSiege && !isSiegeReadonlyViewer && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={startSiege}
                disabled={!siegeStatus.canStartSiege || siegeDialog.submitting}
              >
                {siegeDialog.submitting ? '开始中...' : '开始围城'}
              </button>
            )}
            {!siegeDialog.loading && siegeStatus.hasActiveSiege && !isSiegeReadonlyViewer && (
              <>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={handleOpenSiegePveBattle}
                  disabled={!canLaunchSiegePveBattle}
                  title={canLaunchSiegePveBattle ? '' : '仅当前门向参战攻方可进入战斗'}
                >
                  进攻
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={retreatSiege}
                  disabled={!siegeStatus.canRetreat || siegeDialog.submitting}
                  title={siegeStatus.canRetreat ? '' : (siegeStatus.retreatDisabledReason || '当前不可撤退')}
                >
                  {siegeDialog.submitting ? '撤退中...' : '撤退'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )}

    <BattleSceneModal
      open={pveBattleState.open}
      loading={pveBattleState.loading}
      error={pveBattleState.error}
      battleInitData={pveBattleState.data}
      mode="siege"
      startLabel="开战"
      requireResultReport
      onClose={closeSiegePveBattle}
      onBattleFinished={handlePveBattleFinished}
    />

    <BattlefieldPreviewModal
      open={siegeBattlefieldPreviewState.open}
      nodeId={siegeBattlefieldPreviewState.nodeId}
      gateKey={siegeBattlefieldPreviewState.gateKey || 'cheng'}
      gateLabel={siegeBattlefieldPreviewState.gateLabel}
      canEdit={false}
      layoutBundleOverride={siegeBattlefieldPreviewState.layoutBundle}
      onClose={closeSiegeBattlefieldPreview}
    />

    <AssociationModal
      isOpen={showAssociationModal}
      onClose={closeAssociationModal}
      viewingAssociationNode={viewingAssociationNode}
    />

    <NodeInfoModal
      isOpen={showNodeInfoModal}
      onClose={closeNodeInfoModal}
      nodeDetail={nodeInfoModalTarget}
      onEnterKnowledgeDomain={handleEnterKnowledgeDomain}
      onOpenSenseArticle={openSenseArticleFromNode}
      simpleOnly
      canApplyDomainMaster={canApplyDomainMaster}
      isApplyingDomainMaster={isApplyingDomainMaster}
      onApplyDomainMaster={handleApplyDomainMaster}
    />

    {showCreateNodeModal && (
      <CreateNodeModal
        isOpen={showCreateNodeModal}
        onClose={closeCreateNodeModal}
        username={username}
        isAdmin={isAdmin}
        existingNodes={nodes}
        sceneManager={sceneManager}
        onSuccess={handleCreateNodeSuccess}
      />
    )}
  </>
);

export default AppOverlays;
