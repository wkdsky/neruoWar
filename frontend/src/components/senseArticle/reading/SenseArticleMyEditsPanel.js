import React from 'react';
import { RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import SenseArticleStateView from '../SenseArticleStateView';
import {
  getRevisionListLabel,
  getRevisionStatusLabel,
  getSourceModeLabel,
  isEditableSenseArticleStatus
} from '../senseArticleUi';
import { getMyEditBadgeLabel, getMyEditResumeLabel } from './senseArticleReadingUi';

const SenseArticleMyEditsPanel = ({
  open,
  style,
  onClose,
  onRefresh,
  loading,
  error,
  myEdits,
  activeFullDraftId,
  pageTitle,
  onResumeEdit,
  onOpenReview,
  onAbandon,
  abandoningRevisionId
}) => {
  if (!open) return null;

  return (
    <div className="sense-floating-backdrop" onClick={onClose}>
      <div
        className="sense-floating-panel sense-my-edits-panel"
        style={style || undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sense-floating-panel-header">
          <div>
            <div className="sense-side-card-title"><Sparkles size={16} /> 我的编辑</div>
            <div className="sense-floating-panel-subtitle">这里显示你当前的草稿，以及你已提交但仍在待审核中的修订。</div>
          </div>
          <div className="sense-floating-panel-actions">
            <button
              type="button"
              className={`sense-icon-action-button${loading ? ' spinning' : ''}`}
              onClick={onRefresh}
              disabled={loading}
              aria-label={loading ? '刷新中' : '刷新我的编辑'}
              title={loading ? '刷新中' : '刷新'}
            >
              <RefreshCw size={16} />
            </button>
            <button type="button" className="btn btn-small btn-secondary" onClick={onClose}>关闭</button>
          </div>
        </div>
        {loading ? <SenseArticleStateView compact kind="loading" title="正在读取我的编辑" description="正在加载你自己的草稿和待审核修订。" /> : null}
        {!loading && error ? <SenseArticleStateView compact kind="error" title="我的编辑加载失败" description={error} /> : null}
        {!loading && !error ? (
          <div className="sense-floating-panel-body">
            {myEdits.length === 0 ? <SenseArticleStateView compact kind="empty" title="暂无我的编辑" description="这里会显示你自己的草稿，以及你已提交但仍待审核的修订。" /> : myEdits.map((item) => (
              <div key={item._id} className="sense-annotation-card sense-my-edit-card">
                <div className="sense-annotation-card-head">
                  <strong>{getRevisionListLabel(item, pageTitle)}</strong>
                  <span className="sense-my-edit-badge">{getMyEditBadgeLabel(item, activeFullDraftId)}</span>
                </div>
                <div className="sense-annotation-card-meta">{item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '--'} · {getRevisionStatusLabel(item.status || 'draft')}</div>
                <div className="sense-review-note">修订范围：{getSourceModeLabel(item?.sourceMode || 'full')}</div>
                {item.proposedSenseTitle && item.proposedSenseTitle !== pageTitle ? <div className="sense-annotation-card-body">待生效释义名：{item.proposedSenseTitle}</div> : null}
                <div className="sense-floating-panel-actions">
                  {isEditableSenseArticleStatus(item?.status) ? (
                    <>
                      <button type="button" className="btn btn-small btn-primary" onClick={() => onResumeEdit(item)} disabled={abandoningRevisionId === String(item?._id || '')}>
                        {getMyEditResumeLabel(item)}
                      </button>
                      <button
                        type="button"
                        className={`sense-icon-action-button danger${abandoningRevisionId === String(item?._id || '') ? ' spinning' : ''}`}
                        onClick={() => onAbandon(item._id)}
                        disabled={abandoningRevisionId === String(item?._id || '')}
                        aria-label={abandoningRevisionId === String(item?._id || '') ? '放弃中' : '放弃修订'}
                        title={abandoningRevisionId === String(item?._id || '') ? '放弃中' : '放弃修订'}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => onOpenReview(item)}>
                      查看审核状态
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SenseArticleMyEditsPanel;
