import React from 'react';

const formatDefense = (value) => {
  const safeValue = Number(value) || 0;
  return Math.round(safeValue * 100) / 100;
};

const ItemDetailModal = ({
  item = null,
  stock = null,
  colliderPartCount = 0,
  socketCount = 0,
  interactionLabels = [],
  onClose
}) => {
  if (!item) return null;

  const stockText = stock ? `${stock.remaining}/${stock.limit}` : '-';
  const baseStatsText = `HP ${item.hp} / 防御 ${formatDefense(item.defense)}`;
  const styleText = `${item?.style?.shape || '-'} / ${item?.style?.material || '-'}`;
  const colliderText = `${item?.collider?.kind || '-'} (${colliderPartCount})`;
  const interactionText = interactionLabels.length > 0 ? interactionLabels.join(' / ') : '无';
  const snapPriority = Number.isFinite(Number(item?.snapPriority)) ? Number(item.snapPriority) : 0;

  return (
    <div
      className="battlefield-item-detail-overlay"
      onClick={onClose}
    >
      <div
        className="battlefield-item-detail-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="battlefield-item-detail-head">
          <div>
            <strong>{item.name || item.itemId}</strong>
            <span>{item.itemId}</span>
          </div>
          <button
            type="button"
            className="btn btn-small btn-secondary"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {item.description && (
          <div className="battlefield-item-detail-desc">{item.description}</div>
        )}
        <div className="battlefield-item-detail-grid">
          <div className="battlefield-item-detail-row">
            <span>尺寸</span>
            <em>{`${Math.round(item.width)} × ${Math.round(item.depth)} × ${Math.round(item.height)}`}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>基础属性</span>
            <em>{baseStatsText}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>库存</span>
            <em>{stockText}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>样式</span>
            <em>{styleText}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>碰撞体</span>
            <em>{colliderText}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>插槽数</span>
            <em>{socketCount}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>堆叠上限</span>
            <em>{item?.maxStack ?? '无限制'}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>需要支撑</span>
            <em>{item?.requiresSupport ? '是' : '否'}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>吸附优先级</span>
            <em>{snapPriority}</em>
          </div>
          <div className="battlefield-item-detail-row">
            <span>交互效果</span>
            <em>{interactionText}</em>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemDetailModal;
