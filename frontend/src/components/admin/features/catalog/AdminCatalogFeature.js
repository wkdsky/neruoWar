import React from 'react';
import {
    AdminBattlefieldItemsTab,
    AdminCityBuildingTypesTab,
    AdminUnitTypesTab
} from './components/AdminCatalogTabs';

const AdminCatalogFeature = ({
    activeTab,
    armyUnitTypes,
    isCreatingUnitType,
    editingUnitTypeId,
    unitTypeForm,
    unitTypeActionId,
    setUnitTypeForm,
    fetchArmyUnitTypes,
    startCreateUnitType,
    saveUnitType,
    resetUnitTypeEditor,
    startEditUnitType,
    deleteUnitType,
    battlefieldItems,
    isCreatingBattlefieldItem,
    editingBattlefieldItemId,
    battlefieldItemForm,
    battlefieldItemActionId,
    setBattlefieldItemForm,
    fetchBattlefieldItemCatalog,
    startCreateBattlefieldItem,
    saveBattlefieldItem,
    resetBattlefieldItemEditor,
    startEditBattlefieldItem,
    deleteBattlefieldItem,
    cityBuildingTypes,
    isCreatingCityBuildingType,
    editingCityBuildingTypeId,
    cityBuildingTypeForm,
    cityBuildingTypeActionId,
    setCityBuildingTypeForm,
    fetchCityBuildingTypeCatalog,
    startCreateCityBuildingType,
    saveCityBuildingType,
    resetCityBuildingTypeEditor,
    startEditCityBuildingType,
    deleteCityBuildingType
}) => (
    <>
        {activeTab === 'unitTypes' && (
            <AdminUnitTypesTab
                armyUnitTypes={armyUnitTypes}
                isCreatingUnitType={isCreatingUnitType}
                editingUnitTypeId={editingUnitTypeId}
                unitTypeForm={unitTypeForm}
                unitTypeActionId={unitTypeActionId}
                setUnitTypeForm={setUnitTypeForm}
                onFetchArmyUnitTypes={fetchArmyUnitTypes}
                onStartCreateUnitType={startCreateUnitType}
                onSaveUnitType={saveUnitType}
                onResetUnitTypeEditor={resetUnitTypeEditor}
                onStartEditUnitType={startEditUnitType}
                onDeleteUnitType={deleteUnitType}
            />
        )}
        {activeTab === 'battlefieldItems' && (
            <AdminBattlefieldItemsTab
                battlefieldItems={battlefieldItems}
                isCreatingBattlefieldItem={isCreatingBattlefieldItem}
                editingBattlefieldItemId={editingBattlefieldItemId}
                battlefieldItemForm={battlefieldItemForm}
                battlefieldItemActionId={battlefieldItemActionId}
                setBattlefieldItemForm={setBattlefieldItemForm}
                onFetchBattlefieldItemCatalog={fetchBattlefieldItemCatalog}
                onStartCreateBattlefieldItem={startCreateBattlefieldItem}
                onSaveBattlefieldItem={saveBattlefieldItem}
                onResetBattlefieldItemEditor={resetBattlefieldItemEditor}
                onStartEditBattlefieldItem={startEditBattlefieldItem}
                onDeleteBattlefieldItem={deleteBattlefieldItem}
            />
        )}
        {activeTab === 'cityBuildingTypes' && (
            <AdminCityBuildingTypesTab
                cityBuildingTypes={cityBuildingTypes}
                isCreatingCityBuildingType={isCreatingCityBuildingType}
                editingCityBuildingTypeId={editingCityBuildingTypeId}
                cityBuildingTypeForm={cityBuildingTypeForm}
                cityBuildingTypeActionId={cityBuildingTypeActionId}
                setCityBuildingTypeForm={setCityBuildingTypeForm}
                onFetchCityBuildingTypeCatalog={fetchCityBuildingTypeCatalog}
                onStartCreateCityBuildingType={startCreateCityBuildingType}
                onSaveCityBuildingType={saveCityBuildingType}
                onResetCityBuildingTypeEditor={resetCityBuildingTypeEditor}
                onStartEditCityBuildingType={startEditCityBuildingType}
                onDeleteCityBuildingType={deleteCityBuildingType}
            />
        )}
    </>
);

export default AdminCatalogFeature;
