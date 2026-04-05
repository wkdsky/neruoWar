import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  createKnowledgeBrocade,
  deleteKnowledgeBrocade,
  listKnowledgeBrocades,
  updateKnowledgeBrocade
} from './knowledgeBrocadeApi';
import './KnowledgeBrocadeDockPanel.css';

const formatTime = (value) => {
  if (!value) return '刚刚更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const KnowledgeBrocadeDockPanel = ({
  isOpen = false,
  activeBrocadeId = '',
  onClose,
  onOpenWorkspace,
  onBrocadeDeleted,
  onBrocadeMetaChange
}) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [creatingName, setCreatingName] = useState('');
  const [actionId, setActionId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');

  const loadItems = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setErrorText('');
    try {
      const data = await listKnowledgeBrocades();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      setErrorText(error.message || '加载知识锦失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadItems();
  }, [isOpen, loadItems]);

  const canCreate = creatingName.trim().length > 0 && !actionId;

  const sortedItems = useMemo(() => (
    [...items].sort((left, right) => new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime())
  ), [items]);

  const handleCreate = async () => {
    const name = creatingName.trim();
    if (!name) return;
    setActionId('create');
    setErrorText('');
    try {
      const data = await createKnowledgeBrocade({ name });
      const nextItem = data?.brocade || null;
      if (nextItem?._id) {
        setItems((prev) => [nextItem, ...prev.filter((item) => item?._id !== nextItem._id)]);
        setCreatingName('');
      }
    } catch (error) {
      setErrorText(error.message || '创建知识锦失败');
    } finally {
      setActionId('');
    }
  };

  const handleDelete = async (item) => {
    if (!item?._id) return;
    const confirmed = window.confirm(`确认删除知识锦「${item.name || '未命名知识锦'}」？这会一并删除其中的全部节点。`);
    if (!confirmed) return;
    setActionId(`delete:${item._id}`);
    setErrorText('');
    try {
      await deleteKnowledgeBrocade(item._id);
      setItems((prev) => prev.filter((row) => row?._id !== item._id));
      onBrocadeDeleted?.(item._id);
    } catch (error) {
      setErrorText(error.message || '删除知识锦失败');
    } finally {
      setActionId('');
    }
  };

  const handleRenameStart = (item) => {
    setEditingId(item?._id || '');
    setEditingName(item?.name || '');
  };

  const handleRenameSave = async (item) => {
    const nextName = editingName.trim();
    if (!item?._id || !nextName) return;
    setActionId(`rename:${item._id}`);
    setErrorText('');
    try {
      const data = await updateKnowledgeBrocade(item._id, { name: nextName });
      const nextItem = data?.brocade || null;
      if (nextItem?._id) {
        setItems((prev) => prev.map((row) => (row?._id === nextItem._id ? nextItem : row)));
        onBrocadeMetaChange?.(nextItem);
      }
      setEditingId('');
      setEditingName('');
    } catch (error) {
      setErrorText(error.message || '重命名知识锦失败');
    } finally {
      setActionId('');
    }
  };

  return (
    <section className="jinzhi-dock-panel" aria-label="知识锦">
      <header className="jinzhi-dock-panel__header">
        <div>
          <div className="jinzhi-dock-panel__eyebrow">Brocade Library</div>
          <h3>知识锦</h3>
          <p>个人知识整理空间，按树状图谱管理你的知识锦。</p>
        </div>
        <div className="jinzhi-dock-panel__actions">
          <button
            type="button"
            className="jinzhi-dock-icon-btn"
            onClick={() => loadItems()}
            aria-label="刷新知识锦列表"
            title="刷新"
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="jinzhi-dock-icon-btn"
            onClick={onClose}
            aria-label="关闭知识锦"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="jinzhi-dock-panel__create">
        <input
          type="text"
          value={creatingName}
          maxLength={80}
          placeholder="输入新的知识锦名称"
          onChange={(event) => setCreatingName(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          <Plus size={15} />
          新建
        </button>
      </div>

      {errorText ? <div className="jinzhi-dock-panel__error">{errorText}</div> : null}

      <div className="jinzhi-dock-panel__body">
        {loading ? <div className="jinzhi-dock-panel__empty">正在加载知识锦...</div> : null}
        {!loading && sortedItems.length < 1 ? (
          <div className="jinzhi-dock-panel__empty">还没有知识锦。先创建一个，然后从根节点开始扩展。</div>
        ) : null}

        {!loading && sortedItems.length > 0 ? (
          <div className="jinzhi-dock-panel__list">
            {sortedItems.map((item) => {
              const isEditing = editingId === item?._id;
              const isBusy = actionId.startsWith(`rename:${item?._id}`) || actionId.startsWith(`delete:${item?._id}`);
              return (
                <article key={item?._id || item?.name} className={`jinzhi-dock-card${activeBrocadeId === item?._id ? ' is-active' : ''}`}>
                  {isEditing ? (
                    <div className="jinzhi-dock-card__rename">
                      <input
                        type="text"
                        value={editingName}
                        maxLength={80}
                        onChange={(event) => setEditingName(event.target.value)}
                      />
                      <div className="jinzhi-dock-card__rename-actions">
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          onClick={() => handleRenameSave(item)}
                          disabled={!editingName.trim() || isBusy}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => {
                            setEditingId('');
                            setEditingName('');
                          }}
                          disabled={isBusy}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="jinzhi-dock-card__main">
                        <div className="jinzhi-dock-card__title">{item?.name || '未命名知识锦'}</div>
                        <div className="jinzhi-dock-card__meta">
                          <span>{`节点 ${Math.max(1, Number(item?.nodeCount) || 1)}`}</span>
                          <span>{formatTime(item?.updatedAt)}</span>
                        </div>
                      </div>
                      <div className="jinzhi-dock-card__actions">
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          onClick={() => onOpenWorkspace?.(item)}
                        >
                          打开
                        </button>
                        <button
                          type="button"
                          className="jinzhi-dock-icon-btn"
                          onClick={() => handleRenameStart(item)}
                          aria-label="重命名知识锦"
                          title="重命名"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="jinzhi-dock-icon-btn is-danger"
                          onClick={() => handleDelete(item)}
                          aria-label="删除知识锦"
                          title="删除"
                          disabled={isBusy}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default KnowledgeBrocadeDockPanel;
