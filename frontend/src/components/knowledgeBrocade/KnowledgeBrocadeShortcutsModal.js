import React from 'react';
import { X } from 'lucide-react';

const SHORTCUTS = [
  { category: '导航', items: [
    { keys: ['Ctrl', 'F'], description: '打开搜索' },
    { keys: ['鼠标单击'], description: '大纲视图选择节点并切换右侧内容' },
    { keys: ['单击标题'], description: '直接修改大纲节点标题' },
    { keys: ['↑', '↓'], description: '大纲视图切换上一个 / 下一个节点' },
    { keys: ['长按拖动'], description: '大纲视图框选多个节点' },
    { keys: ['Esc'], description: '关闭弹窗 / 取消选择' }
  ]},
  { category: '节点操作', items: [
    { keys: ['Tab'], description: '树视图添加子节点；大纲视图缩进' },
    { keys: ['Shift', 'Tab'], description: '大纲视图提升层级' },
    { keys: ['Enter'], description: '树视图添加子节点；大纲视图新建兄弟' },
    { keys: ['E'], description: '编辑选中节点' },
    { keys: ['Space'], description: '折叠 / 展开节点' },
    { keys: ['Delete'], description: '删除选中节点' }
  ]},
  { category: '编辑', items: [
    { keys: ['Ctrl', 'Z'], description: '撤销' },
    { keys: ['Ctrl', 'Shift', 'Z'], description: '重做' },
    { keys: ['Ctrl', 'Y'], description: '重做' }
  ]}
];

const ShortcutsModal = ({
  open = false,
  onClose
}) => {
  if (!open) return null;

  return (
    <div
      className="jinzhi-shortcuts-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="jinzhi-shortcuts-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="快捷键帮助"
      >
        <div className="jinzhi-shortcuts-modal__header">
          <div>
            <div className="jinzhi-shortcuts-modal__eyebrow">
              <span className="jinzhi-shortcuts-modal__icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M6 16h12"/>
                </svg>
              </span>
              Keyboard Shortcuts
            </div>
            <h3>快捷键</h3>
          </div>
          <button
            type="button"
            className="jinzhi-shortcuts-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="jinzhi-shortcuts-modal__body">
          {SHORTCUTS.map((section) => (
            <div key={section.category} className="jinzhi-shortcuts-section">
              <h4 className="jinzhi-shortcuts-section__title">{section.category}</h4>
              <div className="jinzhi-shortcuts-section__list">
                {section.items.map((shortcut, index) => (
                  <div key={index} className="jinzhi-shortcut-item">
                    <div className="jinzhi-shortcut-item__keys">
                      {shortcut.keys.map((key, keyIndex) => (
                        <React.Fragment key={keyIndex}>
                          <kbd className="jinzhi-shortcut-key">{key}</kbd>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="jinzhi-shortcut-key__plus">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    <span className="jinzhi-shortcut-item__desc">{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ShortcutsModal;
