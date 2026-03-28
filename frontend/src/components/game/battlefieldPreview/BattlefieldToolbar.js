import React from 'react';

const BattlefieldToolbar = ({
  wallsCount = 0,
  totalItemRemaining = 0,
  totalItemLimit = 0,
  totalDefenderPlaced = 0,
  maxStackLevel = 0,
  editMode = false,
  hasDraftChanges = false,
  cacheNeedsSync = false,
  savingLayout = false
}) => (
  <div className="battlefield-toolbar">
    <span>{`已放置物品 ${wallsCount}`}</span>
    <span>{`库存总计 ${totalItemRemaining}/${totalItemLimit}`}</span>
    <span>{`守军布置 ${totalDefenderPlaced}`}</span>
    <span>{`堆叠上限 ${maxStackLevel} 层`}</span>
    <span>{editMode && hasDraftChanges ? '布置中：有未保存改动' : (cacheNeedsSync ? '离线缓存待同步' : '已与服务端同步')}</span>
    <span>{savingLayout ? '保存中...' : '群组数值显示: 血量 / 防御'}</span>
  </div>
);

export default BattlefieldToolbar;
