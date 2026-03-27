import React from 'react';
import { Plus } from 'lucide-react';

export const AdminUnitTypesTab = ({
    armyUnitTypes,
    isCreatingUnitType,
    editingUnitTypeId,
    unitTypeForm,
    unitTypeActionId,
    setUnitTypeForm,
    onFetchArmyUnitTypes,
    onStartCreateUnitType,
    onSaveUnitType,
    onResetUnitTypeEditor,
    onStartEditUnitType,
    onDeleteUnitType
}) => (
    <div className="users-table-container">
        <div className="table-info">
            <p>兵种数量: <strong>{armyUnitTypes.length}</strong></p>
            <button
                onClick={onFetchArmyUnitTypes}
                className="btn btn-primary"
                style={{ marginLeft: '1rem' }}
            >
                刷新数据
            </button>
            <button
                onClick={onStartCreateUnitType}
                className="btn btn-secondary"
                style={{ marginLeft: '0.5rem' }}
            >
                <Plus className="icon-small" />
                新增兵种
            </button>
        </div>

        {(isCreatingUnitType || editingUnitTypeId) && (
            <div className="unit-type-editor-card">
                <h3>{isCreatingUnitType ? '新增兵种' : `编辑兵种：${unitTypeForm.name || editingUnitTypeId}`}</h3>
                <div className="unit-type-form-grid">
                    <label>
                        兵种ID
                        <input
                            type="text"
                            value={unitTypeForm.unitTypeId}
                            disabled={!isCreatingUnitType}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, unitTypeId: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        名称
                        <input
                            type="text"
                            value={unitTypeForm.name}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, name: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        角色
                        <select
                            value={unitTypeForm.roleTag}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, roleTag: e.target.value }))}
                            className="edit-input"
                        >
                            <option value="近战">近战</option>
                            <option value="远程">远程</option>
                        </select>
                    </label>
                    <label>
                        速度
                        <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={unitTypeForm.speed}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, speed: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        生命
                        <input
                            type="number"
                            min="1"
                            value={unitTypeForm.hp}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, hp: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        攻击
                        <input
                            type="number"
                            min="0"
                            value={unitTypeForm.atk}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, atk: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        防御
                        <input
                            type="number"
                            min="0"
                            value={unitTypeForm.def}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, def: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        射程
                        <input
                            type="number"
                            min="1"
                            value={unitTypeForm.range}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, range: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        单价（知识点）
                        <input
                            type="number"
                            min="1"
                            value={unitTypeForm.costKP}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, costKP: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        等级
                        <input
                            type="number"
                            min="1"
                            value={unitTypeForm.level}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, level: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        进阶指向ID
                        <input
                            type="text"
                            value={unitTypeForm.nextUnitTypeId}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, nextUnitTypeId: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        进阶成本（知识点）
                        <input
                            type="number"
                            min="0"
                            value={unitTypeForm.upgradeCostKP}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, upgradeCostKP: e.target.value }))}
                            className="edit-input"
                            placeholder="留空表示未配置"
                        />
                    </label>
                    <label>
                        排序
                        <input
                            type="number"
                            value={unitTypeForm.sortOrder}
                            onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                </div>
                <div className="unit-type-form-actions">
                    <button onClick={onSaveUnitType} className="btn btn-primary" disabled={Boolean(unitTypeActionId)}>
                        {unitTypeActionId ? '提交中...' : '保存'}
                    </button>
                    <button onClick={onResetUnitTypeEditor} className="btn btn-secondary" disabled={Boolean(unitTypeActionId)}>
                        取消
                    </button>
                </div>
            </div>
        )}

        <div className="table-responsive">
            <table className="users-table">
                <thead>
                    <tr>
                        <th>兵种ID</th>
                        <th>名称</th>
                        <th>定位</th>
                        <th>速度</th>
                        <th>生命</th>
                        <th>攻击</th>
                        <th>防御</th>
                        <th>射程</th>
                        <th>单价</th>
                        <th>排序</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {armyUnitTypes.map((unitType) => {
                        const rowBusy = unitTypeActionId === unitType.unitTypeId || unitTypeActionId === '__create__';
                        return (
                            <tr key={unitType.unitTypeId}>
                                <td className="id-cell">{unitType.unitTypeId}</td>
                                <td className="username-cell">{unitType.name}</td>
                                <td>{unitType.roleTag}</td>
                                <td>{unitType.speed}</td>
                                <td>{unitType.hp}</td>
                                <td>{unitType.atk}</td>
                                <td>{unitType.def}</td>
                                <td>{unitType.range}</td>
                                <td>{unitType.costKP}</td>
                                <td>{unitType.sortOrder}</td>
                                <td className="action-cell">
                                    <button
                                        onClick={() => onStartEditUnitType(unitType)}
                                        className="btn-action btn-edit"
                                        disabled={rowBusy}
                                    >
                                        编辑
                                    </button>
                                    <button
                                        onClick={() => onDeleteUnitType(unitType)}
                                        className="btn-action btn-delete"
                                        disabled={rowBusy}
                                    >
                                        删除
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    </div>
);

export const AdminBattlefieldItemsTab = ({
    battlefieldItems,
    isCreatingBattlefieldItem,
    editingBattlefieldItemId,
    battlefieldItemForm,
    battlefieldItemActionId,
    setBattlefieldItemForm,
    onFetchBattlefieldItemCatalog,
    onStartCreateBattlefieldItem,
    onSaveBattlefieldItem,
    onResetBattlefieldItemEditor,
    onStartEditBattlefieldItem,
    onDeleteBattlefieldItem
}) => (
    <div className="users-table-container">
        <div className="table-info">
            <p>物品数量: <strong>{battlefieldItems.length}</strong></p>
            <button
                type="button"
                className="btn btn-primary"
                onClick={onFetchBattlefieldItemCatalog}
                style={{ marginLeft: '1rem' }}
            >
                刷新数据
            </button>
            <button
                type="button"
                className="btn btn-success"
                onClick={onStartCreateBattlefieldItem}
                style={{ marginLeft: '0.5rem' }}
            >
                <Plus className="icon-small" />
                新增物品
            </button>
        </div>

        {(isCreatingBattlefieldItem || editingBattlefieldItemId) && (
            <div className="unit-type-editor-card">
                <h3>{isCreatingBattlefieldItem ? '新增物品' : `编辑物品：${battlefieldItemForm.name || editingBattlefieldItemId}`}</h3>
                <div className="unit-type-form-grid">
                    <label>
                        物品ID
                        <input
                            type="text"
                            value={battlefieldItemForm.itemId}
                            disabled={!isCreatingBattlefieldItem}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, itemId: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        名称
                        <input
                            type="text"
                            value={battlefieldItemForm.name}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, name: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        初始数量
                        <input
                            type="number"
                            min="0"
                            value={battlefieldItemForm.initialCount}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, initialCount: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        宽度
                        <input
                            type="number"
                            min="12"
                            value={battlefieldItemForm.width}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, width: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        深度
                        <input
                            type="number"
                            min="12"
                            value={battlefieldItemForm.depth}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, depth: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        高度
                        <input
                            type="number"
                            min="10"
                            value={battlefieldItemForm.height}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, height: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        生命
                        <input
                            type="number"
                            min="1"
                            value={battlefieldItemForm.hp}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, hp: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        防御
                        <input
                            type="number"
                            min="0.1"
                            step="0.01"
                            value={battlefieldItemForm.defense}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, defense: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        排序
                        <input
                            type="number"
                            value={battlefieldItemForm.sortOrder}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                            type="checkbox"
                            checked={battlefieldItemForm.enabled}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                        />
                        启用
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                        样式参数（JSON）
                        <textarea
                            value={battlefieldItemForm.styleText}
                            onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, styleText: e.target.value }))}
                            className="edit-input"
                            rows={5}
                        />
                    </label>
                </div>
                <div className="unit-type-form-actions">
                    <button onClick={onSaveBattlefieldItem} className="btn btn-primary" disabled={Boolean(battlefieldItemActionId)}>
                        {battlefieldItemActionId ? '提交中...' : '保存'}
                    </button>
                    <button onClick={onResetBattlefieldItemEditor} className="btn btn-secondary" disabled={Boolean(battlefieldItemActionId)}>
                        取消
                    </button>
                </div>
            </div>
        )}

        <div className="table-responsive">
            <table className="users-table">
                <thead>
                    <tr>
                        <th>物品ID</th>
                        <th>名称</th>
                        <th>初始数量</th>
                        <th>尺寸（宽/深/高）</th>
                        <th>生命/防御</th>
                        <th>排序</th>
                        <th>状态</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {battlefieldItems.map((item) => {
                        const rowBusy = battlefieldItemActionId === item.itemId || battlefieldItemActionId === '__create__';
                        return (
                            <tr key={item.itemId}>
                                <td className="id-cell">{item.itemId}</td>
                                <td className="username-cell">{item.name}</td>
                                <td>{item.initialCount}</td>
                                <td>{`${item.width} / ${item.depth} / ${item.height}`}</td>
                                <td>{`${item.hp} / ${item.defense}`}</td>
                                <td>{item.sortOrder}</td>
                                <td>{item.enabled === false ? '停用' : '启用'}</td>
                                <td className="action-cell">
                                    <button
                                        onClick={() => onStartEditBattlefieldItem(item)}
                                        className="btn-action btn-edit"
                                        disabled={rowBusy}
                                    >
                                        编辑
                                    </button>
                                    <button
                                        onClick={() => onDeleteBattlefieldItem(item)}
                                        className="btn-action btn-delete"
                                        disabled={rowBusy}
                                    >
                                        删除
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    </div>
);

export const AdminCityBuildingTypesTab = ({
    cityBuildingTypes,
    isCreatingCityBuildingType,
    editingCityBuildingTypeId,
    cityBuildingTypeForm,
    cityBuildingTypeActionId,
    setCityBuildingTypeForm,
    onFetchCityBuildingTypeCatalog,
    onStartCreateCityBuildingType,
    onSaveCityBuildingType,
    onResetCityBuildingTypeEditor,
    onStartEditCityBuildingType,
    onDeleteCityBuildingType
}) => (
    <div className="users-table-container">
        <div className="table-info">
            <p>建筑数量: <strong>{cityBuildingTypes.length}</strong></p>
            <button
                type="button"
                className="btn btn-primary"
                onClick={onFetchCityBuildingTypeCatalog}
                style={{ marginLeft: '1rem' }}
            >
                刷新数据
            </button>
            <button
                type="button"
                className="btn btn-success"
                onClick={onStartCreateCityBuildingType}
                style={{ marginLeft: '0.5rem' }}
            >
                <Plus className="icon-small" />
                新增建筑
            </button>
        </div>

        {(isCreatingCityBuildingType || editingCityBuildingTypeId) && (
            <div className="unit-type-editor-card">
                <h3>{isCreatingCityBuildingType ? '新增建筑' : `编辑建筑：${cityBuildingTypeForm.name || editingCityBuildingTypeId}`}</h3>
                <div className="unit-type-form-grid">
                    <label>
                        建筑ID
                        <input
                            type="text"
                            value={cityBuildingTypeForm.buildingTypeId}
                            disabled={!isCreatingCityBuildingType}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, buildingTypeId: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        名称
                        <input
                            type="text"
                            value={cityBuildingTypeForm.name}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, name: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        初始数量
                        <input
                            type="number"
                            min="0"
                            value={cityBuildingTypeForm.initialCount}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, initialCount: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        半径
                        <input
                            type="number"
                            min="0.1"
                            step="0.01"
                            value={cityBuildingTypeForm.radius}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, radius: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        等级
                        <input
                            type="number"
                            min="1"
                            value={cityBuildingTypeForm.level}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, level: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        下一级兵种ID
                        <input
                            type="text"
                            value={cityBuildingTypeForm.nextUnitTypeId}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, nextUnitTypeId: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label>
                        升级成本（KP）
                        <input
                            type="number"
                            min="0"
                            value={cityBuildingTypeForm.upgradeCostKP}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, upgradeCostKP: e.target.value }))}
                            className="edit-input"
                            placeholder="留空表示未配置"
                        />
                    </label>
                    <label>
                        排序
                        <input
                            type="number"
                            value={cityBuildingTypeForm.sortOrder}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                            className="edit-input"
                        />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                            type="checkbox"
                            checked={cityBuildingTypeForm.enabled}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                        />
                        启用
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                        样式参数（JSON）
                        <textarea
                            value={cityBuildingTypeForm.styleText}
                            onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, styleText: e.target.value }))}
                            className="edit-input"
                            rows={5}
                        />
                    </label>
                </div>
                <div className="unit-type-form-actions">
                    <button onClick={onSaveCityBuildingType} className="btn btn-primary" disabled={Boolean(cityBuildingTypeActionId)}>
                        {cityBuildingTypeActionId ? '提交中...' : '保存'}
                    </button>
                    <button onClick={onResetCityBuildingTypeEditor} className="btn btn-secondary" disabled={Boolean(cityBuildingTypeActionId)}>
                        取消
                    </button>
                </div>
            </div>
        )}

        <div className="table-responsive">
            <table className="users-table">
                <thead>
                    <tr>
                        <th>建筑ID</th>
                        <th>名称</th>
                        <th>初始数量</th>
                        <th>半径</th>
                        <th>等级</th>
                        <th>下一级兵种</th>
                        <th>升级成本</th>
                        <th>排序</th>
                        <th>状态</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {cityBuildingTypes.map((buildingType) => {
                        const rowBusy = cityBuildingTypeActionId === buildingType.buildingTypeId || cityBuildingTypeActionId === '__create__';
                        return (
                            <tr key={buildingType.buildingTypeId}>
                                <td className="id-cell">{buildingType.buildingTypeId}</td>
                                <td className="username-cell">{buildingType.name}</td>
                                <td>{buildingType.initialCount}</td>
                                <td>{buildingType.radius}</td>
                                <td>{buildingType.level}</td>
                                <td>{buildingType.nextUnitTypeId || '-'}</td>
                                <td>{buildingType.upgradeCostKP ?? '-'}</td>
                                <td>{buildingType.sortOrder}</td>
                                <td>{buildingType.enabled === false ? '停用' : '启用'}</td>
                                <td className="action-cell">
                                    <button
                                        onClick={() => onStartEditCityBuildingType(buildingType)}
                                        className="btn-action btn-edit"
                                        disabled={rowBusy}
                                    >
                                        编辑
                                    </button>
                                    <button
                                        onClick={() => onDeleteCityBuildingType(buildingType)}
                                        className="btn-action btn-delete"
                                        disabled={rowBusy}
                                    >
                                        删除
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    </div>
);
