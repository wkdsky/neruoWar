import React from 'react';
import { createPortal } from 'react-dom';
import {
  DISTRIBUTION_SCOPE_OPTIONS,
  clampPercent
} from './shared';

const KnowledgeDomainDistributionRuleModal = ({
  open,
  canEdit,
  distributionState,
  distributionToast,
  onClose,
  saveDistributionSettings,
  distributionProfiles,
  activeDistributionRuleId,
  setActiveDistributionRule,
  newDistributionRuleName,
  setNewDistributionRuleName,
  createDistributionRuleProfileItem,
  removeActiveDistributionRule,
  distributionRule,
  updateDistributionRule,
  scopePercent,
  activeDistributionProfile,
  updateActiveDistributionRuleName,
  hasMasterAlliance,
  currentPercentSummary,
  effectiveAdminPercents,
  distributionUserKeyword,
  setDistributionUserKeyword,
  distributionUserSearching,
  distributionUserResults,
  distributionAllianceKeyword,
  setDistributionAllianceKeyword,
  distributionAllianceSearching,
  distributionAllianceResults,
  blockedRuleNotes,
  conflictMessages,
  unallocatedPercent
}) => {
  if (!open || !canEdit) return null;

  return createPortal(
    <div
      className="distribution-rule-modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="distribution-rule-modal">
        <div className="distribution-rule-modal-header">
          <strong>知识域知识点分发规则工作台</strong>
          <div className="distribution-modal-header-actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={saveDistributionSettings}
              disabled={distributionState.saving}
            >
              {distributionState.saving ? '保存中...' : '保存规则配置'}
            </button>
            <button
              type="button"
              className="btn btn-small btn-secondary"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        {distributionToast.visible && (
          <div className={`distribution-light-toast ${distributionToast.type}`}>
            {distributionToast.message}
          </div>
        )}
        <div className="distribution-rule-modal-body">
          <div className="distribution-rule-sidebar">
            <div className="distribution-subtitle">规则列表</div>
            <div className="distribution-rule-list">
              {distributionProfiles.map((profile) => (
                <button
                  key={profile.profileId}
                  type="button"
                  className={`distribution-rule-list-item ${profile.profileId === activeDistributionRuleId ? 'active' : ''}`}
                  onClick={() => setActiveDistributionRule(profile.profileId)}
                >
                  <span>{profile.name}</span>
                  {profile.profileId === activeDistributionRuleId ? <em>当前编辑</em> : null}
                </button>
              ))}
            </div>
            <div className="distribution-rule-create">
              <input
                type="text"
                className="domain-admin-search-input"
                placeholder="输入新规则名称"
                value={newDistributionRuleName}
                onChange={(event) => setNewDistributionRuleName(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-small btn-success"
                onClick={createDistributionRuleProfileItem}
              >
                新建规则
              </button>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={removeActiveDistributionRule}
                disabled={distributionProfiles.length <= 1}
              >
                删除当前规则
              </button>
            </div>
          </div>

          <div className="distribution-rule-main">
            <div className="distribution-subblock">
              <div className="distribution-subtitle">分发范围</div>
              <div className="distribution-input-row">
                <span>范围模式</span>
                <select
                  value={distributionRule.distributionScope === 'partial' ? 'partial' : 'all'}
                  onChange={(event) => updateDistributionRule((prev) => ({
                    ...prev,
                    distributionScope: event.target.value === 'partial' ? 'partial' : 'all'
                  }))}
                >
                  {DISTRIBUTION_SCOPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              {distributionRule.distributionScope === 'partial' && (
                <div className="distribution-input-row">
                  <span>部分分发比例</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={scopePercent}
                    onChange={(event) => updateDistributionRule((prev) => ({
                      ...prev,
                      distributionPercent: clampPercent(event.target.value, 100)
                    }))}
                  />
                </div>
              )}
              <div className="distribution-progress-wrap">
                <div className="distribution-progress-track">
                  <div
                    className="distribution-progress-fill scope"
                    style={{ width: `${Math.max(0, Math.min(100, scopePercent))}%` }}
                  />
                </div>
                <span>{`本次参与分发比例：${scopePercent.toFixed(2)}%`}</span>
              </div>
            </div>

            <div className="distribution-subblock">
              <div className="distribution-subtitle">规则名称</div>
              <div className="distribution-input-row">
                <span>规则名称</span>
                <input
                  type="text"
                  value={activeDistributionProfile?.name || ''}
                  onChange={(event) => updateActiveDistributionRuleName(event.target.value)}
                />
              </div>
            </div>

            <div className="distribution-input-row">
              <span>域主分配比例</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={distributionRule.masterPercent}
                onChange={(event) => updateDistributionRule((prev) => ({
                  ...prev,
                  masterPercent: clampPercent(event.target.value, 10)
                }))}
              />
            </div>

            <div className="distribution-subblock">
              <div className="distribution-subtitle">固定规则说明</div>
              <div className="distribution-fixed-row">
                <span>固定规则：盟贡献同步比例</span>
                <strong>{distributionState.allianceContributionPercent.toFixed(2)}%</strong>
                <em>{hasMasterAlliance ? `同步自熵盟「${distributionState.masterAllianceName}」` : '域主未加入熵盟，固定为 0'}</em>
              </div>
              <div className="distribution-fixed-row danger">
                <span>规则 4：敌对熵盟成员</span>
                <strong>0%</strong>
                <em>{hasMasterAlliance ? '系统自动判定，优先级最高，不可更改' : '无熵盟时不触发敌对判定'}</em>
              </div>
            </div>

            <div className="distribution-subblock">
              <div className="distribution-subtitle">域内成员分配总池（当前 {currentPercentSummary.y.toFixed(2)}%）</div>
              {effectiveAdminPercents.length === 0 ? (
                <div className="domain-manage-tip">当前无域相可配置</div>
              ) : effectiveAdminPercents.map((adminItem) => (
                <div key={adminItem.userId} className="distribution-input-row">
                  <span>{adminItem.username}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={adminItem.percent}
                    onChange={(event) => {
                      const nextPercent = clampPercent(event.target.value, 0);
                      updateDistributionRule((prev) => {
                        const nextList = (prev.adminPercents || []).filter((item) => item.userId !== adminItem.userId);
                        if (nextPercent > 0) {
                          nextList.push({
                            userId: adminItem.userId,
                            username: adminItem.username,
                            percent: nextPercent
                          });
                        }
                        return { ...prev, adminPercents: nextList };
                      });
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="distribution-subblock">
              <div className="distribution-subtitle">指定用户分配比例与用户黑名单</div>
              <div className="domain-manage-tip">黑名单跟随域主，域主变更时会自动重置</div>
              <input
                type="text"
                className="domain-admin-search-input"
                placeholder="搜索用户后加入指定比例或黑名单"
                value={distributionUserKeyword}
                onChange={(event) => setDistributionUserKeyword(event.target.value)}
              />
              {distributionUserSearching && <div className="domain-manage-tip">搜索中...</div>}
              {!distributionUserSearching && distributionUserKeyword.trim() && (
                <div className="domain-search-results">
                  {distributionUserResults.length === 0 ? (
                    <div className="domain-manage-tip">没有匹配用户</div>
                  ) : distributionUserResults.map((userItem) => (
                    <div key={userItem._id} className="domain-search-row">
                      <span className="domain-admin-name">{userItem.username}</span>
                      <div className="distribution-row-actions">
                        <button
                          type="button"
                          className="btn btn-small btn-success"
                          onClick={() => updateDistributionRule((prev) => {
                            if ((prev.customUserPercents || []).some((item) => item.userId === userItem._id)) {
                              return prev;
                            }
                            return {
                              ...prev,
                              customUserPercents: [...(prev.customUserPercents || []), {
                                userId: userItem._id,
                                username: userItem.username,
                                percent: 0
                              }]
                            };
                          })}
                        >
                          加入指定用户池
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => updateDistributionRule((prev) => {
                            if ((prev.blacklistUsers || []).some((item) => item.userId === userItem._id)) {
                              return prev;
                            }
                            return {
                              ...prev,
                              blacklistUsers: [...(prev.blacklistUsers || []), {
                                userId: userItem._id,
                                username: userItem.username
                              }]
                            };
                          })}
                        >
                          加黑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(distributionRule.customUserPercents || []).map((item) => (
                <div key={item.userId} className="distribution-input-row">
                  <span>{item.username || item.userId}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={item.percent}
                    onChange={(event) => {
                      const nextPercent = clampPercent(event.target.value, 0);
                      updateDistributionRule((prev) => ({
                        ...prev,
                        customUserPercents: (prev.customUserPercents || []).map((row) => (
                          row.userId === item.userId ? { ...row, percent: nextPercent } : row
                        ))
                      }));
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => updateDistributionRule((prev) => ({
                      ...prev,
                      customUserPercents: (prev.customUserPercents || []).filter((row) => row.userId !== item.userId)
                    }))}
                  >
                    移除
                  </button>
                </div>
              ))}
              {(distributionRule.blacklistUsers || []).map((item) => (
                <div key={item.userId} className="distribution-tag-row danger">
                  <span>{item.username || item.userId}</span>
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => updateDistributionRule((prev) => ({
                      ...prev,
                      blacklistUsers: (prev.blacklistUsers || []).filter((row) => row.userId !== item.userId)
                    }))}
                  >
                    取消黑名单
                  </button>
                </div>
              ))}
            </div>

            <div className="distribution-subblock">
              <div className="distribution-input-row">
                <span>非敌对熵盟成员分配总池</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={distributionRule.nonHostileAlliancePercent}
                  disabled={!hasMasterAlliance}
                  onChange={(event) => updateDistributionRule((prev) => ({
                    ...prev,
                    nonHostileAlliancePercent: clampPercent(event.target.value, 0)
                  }))}
                />
              </div>
              {!hasMasterAlliance && (
                <div className="domain-manage-tip">域主未加入熵盟，非敌对熵盟相关分配已禁用</div>
              )}
              <div className="distribution-input-row">
                <span>无熵盟用户分配总池</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={distributionRule.noAlliancePercent}
                  onChange={(event) => updateDistributionRule((prev) => ({
                    ...prev,
                    noAlliancePercent: clampPercent(event.target.value, 0)
                  }))}
                />
              </div>
            </div>

            <div className="distribution-subblock">
              <div className="distribution-subtitle">指定熵盟成员分配池与熵盟黑名单</div>
              <div className="domain-manage-tip">熵盟黑名单同样跟随域主，和允许池冲突时按“禁止”优先</div>
              {hasMasterAlliance ? (
                <>
                  <input
                    type="text"
                    className="domain-admin-search-input"
                    placeholder="搜索熵盟后加入指定比例或黑名单"
                    value={distributionAllianceKeyword}
                    onChange={(event) => setDistributionAllianceKeyword(event.target.value)}
                  />
                  {distributionAllianceSearching && <div className="domain-manage-tip">搜索中...</div>}
                  {!distributionAllianceSearching && distributionAllianceKeyword.trim() && (
                    <div className="domain-search-results">
                      {distributionAllianceResults.length === 0 ? (
                        <div className="domain-manage-tip">没有匹配熵盟</div>
                      ) : distributionAllianceResults.map((allianceItem) => (
                        <div key={allianceItem._id} className="domain-search-row">
                          <span className="domain-admin-name">{allianceItem.name}</span>
                          <div className="distribution-row-actions">
                            <button
                              type="button"
                              className="btn btn-small btn-success"
                              onClick={() => updateDistributionRule((prev) => {
                                if ((prev.specificAlliancePercents || []).some((item) => item.allianceId === allianceItem._id)) {
                                  return prev;
                                }
                                return {
                                  ...prev,
                                  specificAlliancePercents: [...(prev.specificAlliancePercents || []), {
                                    allianceId: allianceItem._id,
                                    allianceName: allianceItem.name,
                                    percent: 0
                                  }]
                                };
                              })}
                            >
                              加入指定熵盟池
                            </button>
                            <button
                              type="button"
                              className="btn btn-small btn-danger"
                              onClick={() => updateDistributionRule((prev) => {
                                if ((prev.blacklistAlliances || []).some((item) => item.allianceId === allianceItem._id)) {
                                  return prev;
                                }
                                return {
                                  ...prev,
                                  blacklistAlliances: [...(prev.blacklistAlliances || []), {
                                    allianceId: allianceItem._id,
                                    allianceName: allianceItem.name
                                  }]
                                };
                              })}
                            >
                              加黑
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="domain-manage-tip">域主未加入熵盟，指定熵盟分配池自动禁用</div>
              )}

              {hasMasterAlliance && (distributionRule.specificAlliancePercents || []).map((item) => (
                <div key={item.allianceId} className="distribution-input-row">
                  <span>{item.allianceName || item.allianceId}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={item.percent}
                    onChange={(event) => {
                      const nextPercent = clampPercent(event.target.value, 0);
                      updateDistributionRule((prev) => ({
                        ...prev,
                        specificAlliancePercents: (prev.specificAlliancePercents || []).map((row) => (
                          row.allianceId === item.allianceId ? { ...row, percent: nextPercent } : row
                        ))
                      }));
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => updateDistributionRule((prev) => ({
                      ...prev,
                      specificAlliancePercents: (prev.specificAlliancePercents || []).filter((row) => row.allianceId !== item.allianceId)
                    }))}
                  >
                    移除
                  </button>
                </div>
              ))}
              {(distributionRule.blacklistAlliances || []).map((item) => (
                <div key={item.allianceId} className="distribution-tag-row danger">
                  <span>{item.allianceName || item.allianceId}</span>
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => updateDistributionRule((prev) => ({
                      ...prev,
                      blacklistAlliances: (prev.blacklistAlliances || []).filter((row) => row.allianceId !== item.allianceId)
                    }))}
                  >
                    取消黑名单
                  </button>
                </div>
              ))}
            </div>

            <div className="distribution-subblock">
              <div className="distribution-subtitle">规则结果可视化与冲突解释</div>
              <div className="distribution-progress-wrap">
                <div className="distribution-progress-track">
                  <div
                    className={`distribution-progress-fill ${currentPercentSummary.total > 100 ? 'over' : ''}`}
                    style={{ width: `${Math.max(0, Math.min(100, currentPercentSummary.total))}%` }}
                  />
                </div>
                <span>{`分配占比 ${currentPercentSummary.total.toFixed(2)}%，未分配 ${unallocatedPercent.toFixed(2)}% 将结转`}</span>
              </div>
              <div className="distribution-visual-metrics">
                <div className="distribution-metric-card">
                  <span>分发范围比例</span>
                  <strong>{scopePercent.toFixed(2)}%</strong>
                </div>
                <div className="distribution-metric-card">
                  <span>总分配占比</span>
                  <strong>{currentPercentSummary.total.toFixed(2)}%</strong>
                </div>
                <div className="distribution-metric-card">
                  <span>未分配比例</span>
                  <strong>{unallocatedPercent.toFixed(2)}%</strong>
                </div>
              </div>
              <div className="distribution-notes">
                {blockedRuleNotes.map((note) => (
                  <div key={note} className="domain-manage-tip">{note}</div>
                ))}
                {conflictMessages.length === 0 ? (
                  <div className="domain-manage-tip">当前未发现允许/禁止规则冲突</div>
                ) : conflictMessages.map((message) => (
                  <div key={message} className="domain-manage-error">{message}</div>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={saveDistributionSettings}
              disabled={distributionState.saving}
            >
              {distributionState.saving ? '保存中...' : '保存当前规则'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default KnowledgeDomainDistributionRuleModal;
