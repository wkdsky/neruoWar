import React from 'react';
import { AlertTriangle, FolderTree, HelpCircle, History, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { formatAutosaveTime } from './hooks/useSenseArticleAutosave';

const SenseArticleEditorStatusBand = ({
  modeLabel = '',
  recoverableDraft = null,
  scopedLabel = '',
  validationSnapshot = null,
  mediaLibrary = null,
  onRestoreLocalDraft,
  onDiscardRecovery,
  onJumpToValidation,
  onJumpToMedia,
  onJumpToOutline,
  onOpenHelp,
  notices = []
}) => {
  const warningCount = Number(validationSnapshot?.warnings?.length || 0);
  const blockingCount = Number(validationSnapshot?.blocking?.length || 0);
  const referencedMediaCount = Number(mediaLibrary?.referencedAssets?.length || 0);

  return (
    <section className="sense-editor-status-band" aria-label="编辑状态与辅助信息">
      <div className="sense-editor-status-grid">
        <article className="sense-editor-status-card">
          <span className="sense-editor-status-kicker">当前模式</span>
          <strong>{modeLabel || '编辑富文本草稿'}</strong>
          <span className="sense-editor-status-meta">当前采用 revision 工作流外壳与 rich_html 编辑内核。</span>
        </article>

        <article className={`sense-editor-status-card ${blockingCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'success'}`}>
          <span className="sense-editor-status-kicker">发布前检查</span>
          <strong>{blockingCount > 0 ? `${blockingCount} 个阻塞问题` : warningCount > 0 ? `${warningCount} 个提醒` : '检查通过'}</strong>
          <button type="button" className="sense-inline-link-button" onClick={onJumpToValidation}>
            {blockingCount > 0 ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
            查看校验详情
          </button>
        </article>

        <article className="sense-editor-status-card">
          <span className="sense-editor-status-kicker">目录与媒体</span>
          <strong>{referencedMediaCount > 0 ? `已引用 ${referencedMediaCount} 个媒体` : '正文未引用媒体'}</strong>
          <div className="sense-inline-link-row">
            <button type="button" className="sense-inline-link-button" onClick={onJumpToOutline}>
              <FolderTree size={14} /> 打开目录导航
            </button>
            <button type="button" className="sense-inline-link-button" onClick={onJumpToMedia}>
              <History size={14} /> 查看媒体摘要
            </button>
          </div>
        </article>

        <article className={`sense-editor-status-card ${recoverableDraft ? 'warning' : 'subtle'}`}>
          <span className="sense-editor-status-kicker">本地恢复</span>
          <strong>{recoverableDraft ? '检测到未同步草稿' : '无可恢复本地缓存'}</strong>
          <span className="sense-editor-status-meta">{recoverableDraft?.savedAt ? `缓存时间：${formatAutosaveTime(recoverableDraft.savedAt)}` : '最近一次编辑内容已同步或未产生本地恢复点。'}</span>
          {recoverableDraft ? (
            <div className="sense-inline-link-row">
              <button type="button" className="sense-inline-link-button" onClick={onRestoreLocalDraft}>
                <RotateCcw size={14} /> 恢复内容
              </button>
              <button type="button" className="sense-inline-link-button" onClick={onDiscardRecovery}>
                丢弃缓存
              </button>
            </div>
          ) : null}
        </article>

        {scopedLabel ? (
          <article className="sense-editor-status-card subtle">
            <span className="sense-editor-status-kicker">Scoped 修订</span>
            <strong>{scopedLabel}</strong>
            <span className="sense-editor-status-meta">当前仍是整页编辑，但会自动定位并高亮修订范围对应块。</span>
          </article>
        ) : null}

        <article className="sense-editor-status-card subtle">
          <span className="sense-editor-status-kicker">帮助</span>
          <strong>查看编辑说明与演示路径</strong>
          <button type="button" className="sense-inline-link-button" onClick={onOpenHelp}>
            <HelpCircle size={14} /> 打开帮助
          </button>
        </article>
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
