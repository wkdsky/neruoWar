import React from 'react';
import {
  QUICK_DEPLOY_STANDARD_PRESETS,
  QUICK_DEPLOY_TEAM_SHORTCUTS,
  QUICK_DEPLOY_TOTAL_SHORTCUTS
} from '../../screens/battleSceneConstants';

const BattleQuickDeployModal = ({
  open = false,
  quickDeployTab = 'standard',
  quickDeployApplying = false,
  quickDeployError = '',
  quickDeployRandomForm = null,
  quickParsedAttackerTeams = NaN,
  quickParsedDefenderTeams = NaN,
  quickParsedAttackerTotal = NaN,
  quickParsedDefenderTotal = NaN,
  onClose,
  onTabChange,
  onChangeRandomForm,
  onApplyStandardPreset,
  onApplyRandom
}) => {
  if (!open) return null;

  return (
    <div
      className="pve2-quick-deploy-backdrop"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClose?.();
      }}
    >
      <div
        className="pve2-quick-deploy-panel"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pve2-quick-deploy-head">
          <h4>一键布置</h4>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => onClose?.()}
          >
            关闭
          </button>
        </div>
        <div className="pve2-quick-deploy-tabs">
          <button
            type="button"
            className={`pve2-quick-tab ${quickDeployTab === 'standard' ? 'active' : ''}`}
            onClick={() => onTabChange?.('standard')}
          >
            标准配置
          </button>
          <button
            type="button"
            className={`pve2-quick-tab ${quickDeployTab === 'random' ? 'active' : ''}`}
            onClick={() => onTabChange?.('random')}
          >
            随机配置
          </button>
        </div>

        {quickDeployTab === 'standard' ? (
          <div className="pve2-quick-standard-list">
            {QUICK_DEPLOY_STANDARD_PRESETS.map((preset) => (
              <div key={preset.id} className="pve2-quick-standard-item">
                <div className="pve2-quick-standard-meta">
                  <strong>{preset.label}</strong>
                  <span>{preset.desc}</span>
                  <em>{`我方 ${preset.attackerTeamCount} 支 / ${preset.attackerTotal} 人 ｜ 敌方 ${preset.defenderTeamCount} 支 / ${preset.defenderTotal} 人`}</em>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={quickDeployApplying}
                  onClick={() => onApplyStandardPreset?.(preset)}
                >
                  应用
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="pve2-quick-random-form">
            <div className="pve2-quick-form-block">
              <h5>我方</h5>
              <label>
                <span>部队数</span>
                <div className="pve2-quick-input-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={quickDeployRandomForm?.attackerTeamCount || ''}
                    onChange={(event) => onChangeRandomForm?.('attackerTeamCount', event.target.value || '')}
                    placeholder="输入我方部队数"
                  />
                </div>
                <div className="pve2-quick-shortcuts">
                  {QUICK_DEPLOY_TEAM_SHORTCUTS.map((value) => (
                    <button
                      key={`atk-team-${value}`}
                      type="button"
                      className={`pve2-quick-chip ${quickParsedAttackerTeams === value ? 'active' : ''}`}
                      onClick={() => onChangeRandomForm?.('attackerTeamCount', String(value))}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>总人数</span>
                <div className="pve2-quick-input-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={quickDeployRandomForm?.attackerTotal || ''}
                    onChange={(event) => onChangeRandomForm?.('attackerTotal', event.target.value || '')}
                    placeholder="输入我方总人数"
                  />
                </div>
                <div className="pve2-quick-shortcuts">
                  {QUICK_DEPLOY_TOTAL_SHORTCUTS.map((shortcut) => (
                    <button
                      key={`atk-total-${shortcut.value}`}
                      type="button"
                      className={`pve2-quick-chip ${quickParsedAttackerTotal === shortcut.value ? 'active' : ''}`}
                      onClick={() => onChangeRandomForm?.('attackerTotal', String(shortcut.value))}
                    >
                      {shortcut.label}
                    </button>
                  ))}
                </div>
              </label>
            </div>

            <div className="pve2-quick-form-block">
              <h5>敌方</h5>
              <label>
                <span>部队数</span>
                <div className="pve2-quick-input-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={quickDeployRandomForm?.defenderTeamCount || ''}
                    onChange={(event) => onChangeRandomForm?.('defenderTeamCount', event.target.value || '')}
                    placeholder="输入敌方部队数"
                  />
                </div>
                <div className="pve2-quick-shortcuts">
                  {QUICK_DEPLOY_TEAM_SHORTCUTS.map((value) => (
                    <button
                      key={`def-team-${value}`}
                      type="button"
                      className={`pve2-quick-chip ${quickParsedDefenderTeams === value ? 'active' : ''}`}
                      onClick={() => onChangeRandomForm?.('defenderTeamCount', String(value))}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>总人数</span>
                <div className="pve2-quick-input-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={quickDeployRandomForm?.defenderTotal || ''}
                    onChange={(event) => onChangeRandomForm?.('defenderTotal', event.target.value || '')}
                    placeholder="输入敌方总人数"
                  />
                </div>
                <div className="pve2-quick-shortcuts">
                  {QUICK_DEPLOY_TOTAL_SHORTCUTS.map((shortcut) => (
                    <button
                      key={`def-total-${shortcut.value}`}
                      type="button"
                      className={`pve2-quick-chip ${quickParsedDefenderTotal === shortcut.value ? 'active' : ''}`}
                      onClick={() => onChangeRandomForm?.('defenderTotal', String(shortcut.value))}
                    >
                      {shortcut.label}
                    </button>
                  ))}
                </div>
              </label>
            </div>
          </div>
        )}

        {quickDeployError ? <p className="pve2-quick-error">{quickDeployError}</p> : null}

        <div className="pve2-quick-deploy-actions">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => onClose?.()}
            disabled={quickDeployApplying}
          >
            取消
          </button>
          {quickDeployTab === 'random' ? (
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => onApplyRandom?.()}
              disabled={quickDeployApplying}
            >
              {quickDeployApplying ? '生成中...' : '生成并布置'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default BattleQuickDeployModal;
