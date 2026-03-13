import React, { useEffect, useMemo, useRef, useState } from 'react';
import FormulaPreviewView from '../FormulaPreviewView';

const FormulaSymbolPopover = ({
  open,
  anchorRef,
  group,
  onClose,
  onSelect
}) => {
  const popoverRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, minWidth: 280 });

  useEffect(() => {
    if (!open || !anchorRef?.current) return undefined;
    const updatePosition = () => {
      const rect = anchorRef.current.getBoundingClientRect();
      const minWidth = Math.max(280, rect.width + 48);
      const maxLeft = Math.max(12, window.innerWidth - minWidth - 12);
      setPosition({
        top: rect.bottom + 8,
        left: Math.min(rect.left, maxLeft),
        minWidth
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (popoverRef.current?.contains(event.target)) return;
      if (anchorRef?.current?.contains(event.target)) return;
      onClose && onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose && onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, onClose, open]);

  const items = useMemo(() => Array.isArray(group?.items) ? group.items : [], [group]);
  const compactMode = group?.key && group.key !== 'structure';

  if (!open || !group) return null;

  return (
    <div
      ref={popoverRef}
      className="sense-formula-symbol-popover"
      style={{ top: `${position.top}px`, left: `${position.left}px`, minWidth: `${position.minWidth}px` }}
    >
      <div className="sense-formula-symbol-popover-header">
        <strong>{group.label}</strong>
        <span>{group.key === 'structure' ? '插入模板后可继续在占位处编辑' : '点击符号即可插入到当前光标位置'}</span>
      </div>
      <div className={`sense-formula-symbol-grid${group.key === 'structure' ? ' templates' : ' compact'}`}>
        {items.map((item) => (
          <button
            key={`${group.key}-${item.label}-${item.insert}`}
            type="button"
            className={`sense-formula-symbol-item${compactMode ? ' compact' : ''}`}
            onClick={() => onSelect && onSelect(item)}
            title={item.insert}
            aria-label={item.label}
          >
            {!compactMode ? <span className="sense-formula-symbol-label">{item.label}</span> : null}
            <FormulaPreviewView
              source={item.preview || item.insert}
              displayMode={false}
              className={`sense-formula-symbol-preview${compactMode ? ' compact' : ''}`}
              placeholder={item.label}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export default FormulaSymbolPopover;
