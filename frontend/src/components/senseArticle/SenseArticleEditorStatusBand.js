import React from 'react';
import { AlertTriangle } from 'lucide-react';

const SenseArticleEditorStatusBand = ({
  scopedLabel = '',
  notices = []
}) => {
  if (!scopedLabel && notices.length === 0) return null;

  return (
    <section className="sense-editor-status-band" aria-label="编辑状态与辅助信息">
      <div className="sense-editor-status-grid">
        {scopedLabel ? (
          <article className="sense-editor-status-card subtle">
            <span className="sense-editor-status-kicker">Scoped 修订</span>
            <strong>{scopedLabel}</strong>
            <span className="sense-editor-status-meta">当前自动定位并高亮修订范围对应块。</span>
          </article>
        ) : null}
      </div>

      {notices.length > 0 ? (
        <div className="sense-editor-notice-list" role="status" aria-live="polite">
          {notices.map((notice) => (
            <div key={notice.id} className={`sense-editor-warning ${notice.tone || 'subtle'}`}>
              <AlertTriangle size={16} />
              <div className="sense-editor-warning-copy">
                <strong>{notice.title}</strong>
                <span>{notice.message}</span>
              </div>
              {notice.actions?.length ? (
                <div className="sense-inline-action-row">
                  {notice.actions.map((action) => (
                    <button key={action.label} type="button" className="btn btn-small btn-secondary" onClick={action.onClick}>
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default SenseArticleEditorStatusBand;
