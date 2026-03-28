import React from 'react';

const formatDefense = (value) => {
  const safeValue = Number(value) || 0;
  return Math.round(safeValue * 100) / 100;
};

const BattlefieldSidebar = ({
  sidebarTab = 'items',
  normalizedItemCatalog = [],
  itemStockMetaMap = new Map(),
  effectiveCanEdit = false,
  editMode = false,
  selectedPaletteItem = '',
  ghostActive = false,
  defenderStockRows = [],
  defenderDeploymentRows = [],
  selectedDeploymentId = '',
  selectedDefenderDeployment = null,
  onChangeTab,
  onPickItem,
  onOpenItemDetail,
  onOpenDefenderEditor,
  onSelectDeployment,
  onEditDeployment,
  onRemoveDeployment
}) => (
  <aside className="battlefield-sidebar">
    <div className="battlefield-sidebar-tabs">
      <button
        type="button"
        className={`battlefield-sidebar-tab ${sidebarTab === 'items' ? 'active' : ''}`}
        onClick={() => onChangeTab('items')}
      >
        物品
      </button>
      <button
        type="button"
        className={`battlefield-sidebar-tab ${sidebarTab === 'defender' ? 'active' : ''}`}
        onClick={() => onChangeTab('defender')}
      >
        守军部队
      </button>
    </div>

    <div className="battlefield-sidebar-content">
      {sidebarTab === 'items' && (
        <>
          <div className="battlefield-sidebar-title">战场物品</div>
          {normalizedItemCatalog.length === 0 && (
            <div className="battlefield-sidebar-tip">暂无可用战场物品，请先在管理员面板配置物品目录。</div>
          )}
          {normalizedItemCatalog.map((item) => {
            const stockMeta = itemStockMetaMap.get(item.itemId) || { used: 0, limit: 0, remaining: 0 };
            const canPickItem = !!(effectiveCanEdit && editMode && stockMeta.remaining > 0);
            return (
              <article
                key={item.itemId}
                className={`battlefield-item-card ${selectedPaletteItem === item.itemId && ghostActive ? 'selected' : ''} ${canPickItem ? '' : 'is-disabled'}`}
                onClick={() => {
                  if (canPickItem) onPickItem(item.itemId);
                }}
              >
                <div className="battlefield-item-card-head">
                  <strong>{item.name || item.itemId}</strong>
                  <button
                    type="button"
                    className="battlefield-item-detail-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenItemDetail(item.itemId);
                    }}
                  >
                    详情
                  </button>
                </div>
                <button
                  type="button"
                  className="battlefield-item-card-main"
                  disabled={!canPickItem}
                >
                  <span>{`库存 ${stockMeta.remaining}/${stockMeta.limit}`}</span>
                  <span>{`属性 ${item.hp} / ${formatDefense(item.defense)}`}</span>
                </button>
              </article>
            );
          })}
          <div className="battlefield-sidebar-tip">
            {!effectiveCanEdit
              ? '当前仅预览'
              : (!editMode ? '点击“布置战场”后可选择物品' : '点已放置物品会出现“移动/回收(X)”图标；点选物品后左键放置')}
          </div>
        </>
      )}

      {sidebarTab === 'defender' && (
        <>
          <div className="battlefield-sidebar-row">
            <div className="battlefield-sidebar-title">守军部队</div>
            <button
              type="button"
              className="btn btn-small btn-secondary"
              disabled={!effectiveCanEdit || defenderStockRows.length <= 0}
              onClick={onOpenDefenderEditor}
            >
              新建部队
            </button>
          </div>
          {defenderDeploymentRows.length === 0 && (
            <div className="battlefield-sidebar-tip">当前未创建守军部队，请先点击“新建部队”。</div>
          )}
          {defenderDeploymentRows.map((item) => (
            <article
              key={`def-deploy-${item.deployId}`}
              className={`battlefield-item-card battlefield-defender-card ${selectedDeploymentId === item.deployId ? 'selected' : ''}`}
              onClick={() => onSelectDeployment(item)}
              onDoubleClick={() => onEditDeployment(item.deployId)}
            >
              <div className="battlefield-defender-card-head">
                <strong>{`${item.teamName} · #${item.sortOrder}`}</strong>
                <div className="battlefield-defender-card-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    disabled={!effectiveCanEdit}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditDeployment(item.deployId);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-warning"
                    disabled={!effectiveCanEdit}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveDeployment(item.deployId);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <span>{`总兵力 ${item.totalCount}`}</span>
              <span>{item.unitSummary || '未配置兵种'}</span>
              <span>{item.placed !== false ? '状态 已部署' : '状态 未部署'}</span>
              <span>{item.placed !== false ? `坐标 (${Math.round(item.x)}, ${Math.round(item.y)})` : '坐标 -'}</span>
            </article>
          ))}

          <div className="battlefield-sidebar-meta">
            {defenderStockRows.map((item) => (
              <div key={`def-stock-${item.unitTypeId}`} className="battlefield-sidebar-meta-row">
                <span>{item.unitName || item.unitTypeId}</span>
                <em>{`${item.used}/${item.count}`}</em>
              </div>
            ))}
          </div>

          <div className="battlefield-sidebar-tip">
            {selectedDefenderDeployment
              ? (
                editMode
                  ? (
                    selectedDefenderDeployment.placed !== false
                      ? `已选中：${selectedDefenderDeployment.teamName}（#${selectedDefenderDeployment.sortOrder}）。点击卡片即可拾取，鼠标左键在右侧蓝色区域放置。`
                      : `已选中：${selectedDefenderDeployment.teamName}（未部署）。点击卡片拾取后，鼠标左键在右侧蓝色区域放置。`
                  )
                  : `已选中：${selectedDefenderDeployment.teamName}。请先点击“布置战场”后再部署到地图。`
              )
              : (editMode ? '先新建守军部队，再点击部队卡片拾取并放置到右侧蓝色守方区域' : '先新建守军部队；进入“布置战场”后可点击部队卡片进行部署')}
          </div>
        </>
      )}
    </div>
  </aside>
);

export default BattlefieldSidebar;
