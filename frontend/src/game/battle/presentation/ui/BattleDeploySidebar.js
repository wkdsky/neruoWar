import React from 'react';
import { normalizeTemplateUnits } from '../../screens/battleSceneUtils';

const BattleDeploySidebar = ({
  isTrainingMode = false,
  armyTemplatesLoading = false,
  armyTemplatesError = '',
  armyTemplates = [],
  attackerTeam = 'attacker',
  onCreateDeployGroup,
  onCreateTemplateGroup,
  onOpenTemplateFillPreview,
  disabled = false
}) => (
  <div className={`pve2-deploy-sidebar ${disabled ? 'is-disabled' : ''}`}>
    <section className="pve2-deploy-sidebar-section">
      <div className="pve2-deploy-sidebar-title">新建部队</div>
      <div className="pve2-deploy-sidebar-body">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled}
          onClick={() => {
            if (!disabled) onCreateDeployGroup?.(attackerTeam);
          }}
        >
          新建部队
        </button>
      </div>
    </section>

    <section className="pve2-deploy-sidebar-section">
      <div className="pve2-deploy-sidebar-title">部队模板</div>
      <div className="pve2-deploy-sidebar-body">
        {armyTemplatesLoading ? (
          <span className="pve2-hint">部队模板加载中...</span>
        ) : null}
        {!armyTemplatesLoading && armyTemplatesError ? (
          <span className="pve2-hint pve2-template-error">{armyTemplatesError}</span>
        ) : null}
        {!armyTemplatesLoading && !armyTemplatesError && armyTemplates.length <= 0 ? (
          <span className="pve2-hint">暂无部队模板，可在兵营里创建后回来使用</span>
        ) : null}
        {!armyTemplatesLoading && armyTemplates.length > 0 ? (
          <div className="pve2-template-list">
            {armyTemplates.map((template, index) => {
              const templateId = typeof template?.templateId === 'string' ? template.templateId : `idx_${index}`;
              const templateUnits = normalizeTemplateUnits(template?.units || []);
              const templateSummary = templateUnits
                .map((entry) => `${entry.unitName || entry.unitTypeId}x${entry.count}`)
                .join(' / ');
              const templateTotal = templateUnits.reduce((sum, item) => sum + item.count, 0);
              return (
                <div key={`tpl-${templateId}`} className="pve2-template-row">
                  <button
                    type="button"
                    className="pve2-template-row-main"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      if (isTrainingMode) {
                        onCreateTemplateGroup?.(template, attackerTeam);
                        return;
                      }
                      onOpenTemplateFillPreview?.(template, attackerTeam);
                    }}
                  >
                    <span className="pve2-template-meta">
                      <strong>{template?.name || '未命名模板'}</strong>
                      <span>{`模板兵力 ${Math.max(0, Math.floor(Number(template?.totalCount) || templateTotal))}`}</span>
                      <em>{templateSummary || '无兵种配置'}</em>
                    </span>
                    {!isTrainingMode ? (
                      <span className="pve2-template-direct">填充</span>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  </div>
);

export default BattleDeploySidebar;
