import { useCallback, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';

const UNIT_TYPE_ID_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;
const CATALOG_ID_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

const createEmptyUnitTypeForm = () => ({
    unitTypeId: '',
    name: '',
    roleTag: '近战',
    speed: '1',
    hp: '120',
    atk: '20',
    def: '10',
    range: '1',
    costKP: '10',
    level: '1',
    nextUnitTypeId: '',
    upgradeCostKP: '',
    sortOrder: '0'
});

const createEmptyBattlefieldItemForm = () => ({
    itemId: '',
    name: '',
    initialCount: '0',
    width: '69.333',
    depth: '16',
    height: '28',
    hp: '240',
    defense: '1.1',
    sortOrder: '0',
    enabled: true,
    styleText: '{}'
});

const createEmptyCityBuildingTypeForm = () => ({
    buildingTypeId: '',
    name: '',
    initialCount: '0',
    radius: '0.17',
    level: '1',
    nextUnitTypeId: '',
    upgradeCostKP: '',
    sortOrder: '0',
    enabled: true,
    styleText: '{}'
});

const useAdminCatalogFeature = () => {
    const [armyUnitTypes, setArmyUnitTypes] = useState([]);
    const [isCreatingUnitType, setIsCreatingUnitType] = useState(false);
    const [editingUnitTypeId, setEditingUnitTypeId] = useState('');
    const [unitTypeForm, setUnitTypeForm] = useState(createEmptyUnitTypeForm);
    const [unitTypeActionId, setUnitTypeActionId] = useState('');

    const [battlefieldItems, setBattlefieldItems] = useState([]);
    const [isCreatingBattlefieldItem, setIsCreatingBattlefieldItem] = useState(false);
    const [editingBattlefieldItemId, setEditingBattlefieldItemId] = useState('');
    const [battlefieldItemForm, setBattlefieldItemForm] = useState(createEmptyBattlefieldItemForm);
    const [battlefieldItemActionId, setBattlefieldItemActionId] = useState('');

    const [cityBuildingTypes, setCityBuildingTypes] = useState([]);
    const [isCreatingCityBuildingType, setIsCreatingCityBuildingType] = useState(false);
    const [editingCityBuildingTypeId, setEditingCityBuildingTypeId] = useState('');
    const [cityBuildingTypeForm, setCityBuildingTypeForm] = useState(createEmptyCityBuildingTypeForm);
    const [cityBuildingTypeActionId, setCityBuildingTypeActionId] = useState('');

    const fetchArmyUnitTypes = useCallback(async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/admin/army/unit-types`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            setArmyUnitTypes(Array.isArray(data.unitTypes) ? data.unitTypes : []);
        } catch (error) {
            console.error('获取兵种列表失败:', error);
        }
    }, []);

    const resetUnitTypeEditor = useCallback(() => {
        setIsCreatingUnitType(false);
        setEditingUnitTypeId('');
        setUnitTypeForm(createEmptyUnitTypeForm());
    }, []);

    const startCreateUnitType = useCallback(() => {
        setIsCreatingUnitType(true);
        setEditingUnitTypeId('');
        setUnitTypeForm(createEmptyUnitTypeForm());
    }, []);

    const startEditUnitType = useCallback((unitType) => {
        setIsCreatingUnitType(false);
        setEditingUnitTypeId(unitType.unitTypeId);
        setUnitTypeForm({
            unitTypeId: unitType.unitTypeId || '',
            name: unitType.name || '',
            roleTag: unitType.roleTag || '近战',
            speed: String(unitType.speed ?? 1),
            hp: String(unitType.hp ?? 120),
            atk: String(unitType.atk ?? 20),
            def: String(unitType.def ?? 10),
            range: String(unitType.range ?? 1),
            costKP: String(unitType.costKP ?? 10),
            level: String(unitType.level ?? 1),
            nextUnitTypeId: unitType.nextUnitTypeId || '',
            upgradeCostKP: unitType.upgradeCostKP === null || unitType.upgradeCostKP === undefined
                ? ''
                : String(unitType.upgradeCostKP),
            sortOrder: String(unitType.sortOrder ?? 0)
        });
    }, []);

    const buildUnitTypePayload = useCallback((form, includeUnitTypeId) => {
        const payload = {
            name: form.name.trim(),
            roleTag: form.roleTag,
            speed: Number(form.speed),
            hp: Number(form.hp),
            atk: Number(form.atk),
            def: Number(form.def),
            range: Number(form.range),
            costKP: Number(form.costKP),
            level: Number(form.level),
            nextUnitTypeId: form.nextUnitTypeId.trim() || null,
            upgradeCostKP: form.upgradeCostKP.trim() === '' ? null : Number(form.upgradeCostKP),
            sortOrder: Number(form.sortOrder)
        };

        if (includeUnitTypeId) {
            payload.unitTypeId = form.unitTypeId.trim();
        }
        return payload;
    }, []);

    const validateUnitTypeForm = useCallback((form, includeUnitTypeId) => {
        if (includeUnitTypeId && !UNIT_TYPE_ID_PATTERN.test(form.unitTypeId.trim())) {
            return '兵种ID格式不正确（2-64位字母/数字/下划线/中划线）';
        }
        if (!form.name.trim()) {
            return '兵种名称不能为空';
        }
        if (!['近战', '远程'].includes(form.roleTag)) {
            return 'roleTag 仅支持近战或远程';
        }

        const numericRules = [
            ['speed', 0, false],
            ['hp', 1, true],
            ['atk', 0, true],
            ['def', 0, true],
            ['range', 1, true],
            ['costKP', 1, true],
            ['level', 1, true]
        ];
        for (const [key, min, integer] of numericRules) {
            const value = Number(form[key]);
            if (!Number.isFinite(value)) return `${key} 必须为数字`;
            if (integer && !Number.isInteger(value)) return `${key} 必须为整数`;
            if (value < min) return `${key} 不能小于 ${min}`;
        }
        return '';
    }, []);

    const saveUnitType = useCallback(async () => {
        const token = localStorage.getItem('token');
        const isCreate = isCreatingUnitType;
        const validationError = validateUnitTypeForm(unitTypeForm, isCreate);
        if (validationError) {
            alert(validationError);
            return;
        }

        const payload = buildUnitTypePayload(unitTypeForm, isCreate);
        const actionId = isCreate ? '__create__' : editingUnitTypeId;
        setUnitTypeActionId(actionId);

        try {
            const response = await fetch(
                isCreate
                    ? `${API_BASE}/admin/army/unit-types`
                    : `${API_BASE}/admin/army/unit-types/${editingUnitTypeId}`,
                {
                    method: isCreate ? 'POST' : 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                }
            );
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '保存失败');
                return;
            }
            alert(isCreate ? '兵种创建成功' : '兵种更新成功');
            resetUnitTypeEditor();
            fetchArmyUnitTypes();
        } catch (error) {
            console.error('保存兵种失败:', error);
            alert('保存失败');
        } finally {
            setUnitTypeActionId('');
        }
    }, [
        buildUnitTypePayload,
        editingUnitTypeId,
        fetchArmyUnitTypes,
        isCreatingUnitType,
        resetUnitTypeEditor,
        unitTypeForm,
        validateUnitTypeForm
    ]);

    const deleteUnitType = useCallback(async (unitType) => {
        if (!window.confirm(`确定删除兵种「${unitType.name}」吗？`)) return;
        const token = localStorage.getItem('token');
        setUnitTypeActionId(unitType.unitTypeId);
        try {
            const response = await fetch(`${API_BASE}/admin/army/unit-types/${unitType.unitTypeId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '删除失败');
                return;
            }
            alert('兵种已删除');
            if (editingUnitTypeId === unitType.unitTypeId) {
                resetUnitTypeEditor();
            }
            fetchArmyUnitTypes();
        } catch (error) {
            console.error('删除兵种失败:', error);
            alert('删除失败');
        } finally {
            setUnitTypeActionId('');
        }
    }, [editingUnitTypeId, fetchArmyUnitTypes, resetUnitTypeEditor]);

    const parseStyleText = useCallback((styleTextRaw) => {
        const styleText = String(styleTextRaw || '').trim();
        if (!styleText) return {};
        try {
            const parsed = JSON.parse(styleText);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('style 必须是 JSON 对象');
            }
            return parsed;
        } catch (error) {
            throw new Error(`style 参数格式错误: ${error.message}`);
        }
    }, []);

    const fetchBattlefieldItemCatalog = useCallback(async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/admin/catalog/items`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            setBattlefieldItems(Array.isArray(data?.items) ? data.items : []);
        } catch (error) {
            console.error('获取物品目录失败:', error);
        }
    }, []);

    const resetBattlefieldItemEditor = useCallback(() => {
        setIsCreatingBattlefieldItem(false);
        setEditingBattlefieldItemId('');
        setBattlefieldItemForm(createEmptyBattlefieldItemForm());
    }, []);

    const startCreateBattlefieldItem = useCallback(() => {
        setIsCreatingBattlefieldItem(true);
        setEditingBattlefieldItemId('');
        setBattlefieldItemForm(createEmptyBattlefieldItemForm());
    }, []);

    const startEditBattlefieldItem = useCallback((item) => {
        setIsCreatingBattlefieldItem(false);
        setEditingBattlefieldItemId(item.itemId || '');
        setBattlefieldItemForm({
            itemId: item.itemId || '',
            name: item.name || '',
            initialCount: String(item.initialCount ?? 0),
            width: String(item.width ?? 69.333),
            depth: String(item.depth ?? 16),
            height: String(item.height ?? 28),
            hp: String(item.hp ?? 240),
            defense: String(item.defense ?? 1.1),
            sortOrder: String(item.sortOrder ?? 0),
            enabled: item.enabled !== false,
            styleText: JSON.stringify(item.style && typeof item.style === 'object' ? item.style : {}, null, 2)
        });
    }, []);

    const buildBattlefieldItemPayload = useCallback((form, includeItemId) => {
        const payload = {
            name: String(form.name || '').trim(),
            initialCount: Number(form.initialCount),
            width: Number(form.width),
            depth: Number(form.depth),
            height: Number(form.height),
            hp: Number(form.hp),
            defense: Number(form.defense),
            sortOrder: Number(form.sortOrder),
            enabled: form.enabled !== false,
            style: parseStyleText(form.styleText)
        };
        if (includeItemId) payload.itemId = String(form.itemId || '').trim();
        return payload;
    }, [parseStyleText]);

    const validateBattlefieldItemForm = useCallback((form, includeItemId) => {
        const itemId = String(form.itemId || '').trim();
        if (includeItemId && !CATALOG_ID_PATTERN.test(itemId)) {
            return '物品ID格式不正确（2-64位字母/数字/下划线/中划线）';
        }
        if (!String(form.name || '').trim()) return '物品名称不能为空';
        const numericChecks = [
            ['initialCount', 0, true],
            ['width', 12, false],
            ['depth', 12, false],
            ['height', 10, false],
            ['hp', 1, true],
            ['defense', 0.1, false],
            ['sortOrder', Number.NEGATIVE_INFINITY, true]
        ];
        for (const [key, min, integer] of numericChecks) {
            const value = Number(form[key]);
            if (!Number.isFinite(value)) return `${key} 必须为数字`;
            if (integer && !Number.isInteger(value)) return `${key} 必须为整数`;
            if (value < min) return `${key} 不能小于 ${min}`;
        }
        try {
            parseStyleText(form.styleText);
        } catch (error) {
            return error.message;
        }
        return '';
    }, [parseStyleText]);

    const saveBattlefieldItem = useCallback(async () => {
        const token = localStorage.getItem('token');
        const isCreate = isCreatingBattlefieldItem;
        const validationError = validateBattlefieldItemForm(battlefieldItemForm, isCreate);
        if (validationError) {
            alert(validationError);
            return;
        }
        const payload = buildBattlefieldItemPayload(battlefieldItemForm, isCreate);
        const actionId = isCreate ? '__create__' : editingBattlefieldItemId;
        setBattlefieldItemActionId(actionId);
        try {
            const response = await fetch(
                isCreate
                    ? `${API_BASE}/admin/catalog/items`
                    : `${API_BASE}/admin/catalog/items/${editingBattlefieldItemId}`,
                {
                    method: isCreate ? 'POST' : 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                }
            );
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '保存失败');
                return;
            }
            alert(isCreate ? '物品创建成功' : '物品更新成功');
            resetBattlefieldItemEditor();
            fetchBattlefieldItemCatalog();
        } catch (error) {
            console.error('保存物品失败:', error);
            alert('保存失败');
        } finally {
            setBattlefieldItemActionId('');
        }
    }, [
        battlefieldItemForm,
        buildBattlefieldItemPayload,
        editingBattlefieldItemId,
        fetchBattlefieldItemCatalog,
        isCreatingBattlefieldItem,
        resetBattlefieldItemEditor,
        validateBattlefieldItemForm
    ]);

    const deleteBattlefieldItem = useCallback(async (item) => {
        if (!window.confirm(`确定删除物品「${item.name}」吗？`)) return;
        const token = localStorage.getItem('token');
        setBattlefieldItemActionId(item.itemId);
        try {
            const response = await fetch(`${API_BASE}/admin/catalog/items/${item.itemId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '删除失败');
                return;
            }
            alert('物品已删除');
            if (editingBattlefieldItemId === item.itemId) {
                resetBattlefieldItemEditor();
            }
            fetchBattlefieldItemCatalog();
        } catch (error) {
            console.error('删除物品失败:', error);
            alert('删除失败');
        } finally {
            setBattlefieldItemActionId('');
        }
    }, [editingBattlefieldItemId, fetchBattlefieldItemCatalog, resetBattlefieldItemEditor]);

    const fetchCityBuildingTypeCatalog = useCallback(async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/admin/catalog/buildings`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            setCityBuildingTypes(Array.isArray(data?.buildings) ? data.buildings : []);
        } catch (error) {
            console.error('获取建筑目录失败:', error);
        }
    }, []);

    const resetCityBuildingTypeEditor = useCallback(() => {
        setIsCreatingCityBuildingType(false);
        setEditingCityBuildingTypeId('');
        setCityBuildingTypeForm(createEmptyCityBuildingTypeForm());
    }, []);

    const startCreateCityBuildingType = useCallback(() => {
        setIsCreatingCityBuildingType(true);
        setEditingCityBuildingTypeId('');
        setCityBuildingTypeForm(createEmptyCityBuildingTypeForm());
    }, []);

    const startEditCityBuildingType = useCallback((buildingType) => {
        setIsCreatingCityBuildingType(false);
        setEditingCityBuildingTypeId(buildingType.buildingTypeId || '');
        setCityBuildingTypeForm({
            buildingTypeId: buildingType.buildingTypeId || '',
            name: buildingType.name || '',
            initialCount: String(buildingType.initialCount ?? 0),
            radius: String(buildingType.radius ?? 0.17),
            level: String(buildingType.level ?? 1),
            nextUnitTypeId: buildingType.nextUnitTypeId || '',
            upgradeCostKP: buildingType.upgradeCostKP === null || buildingType.upgradeCostKP === undefined
                ? ''
                : String(buildingType.upgradeCostKP),
            sortOrder: String(buildingType.sortOrder ?? 0),
            enabled: buildingType.enabled !== false,
            styleText: JSON.stringify(buildingType.style && typeof buildingType.style === 'object' ? buildingType.style : {}, null, 2)
        });
    }, []);

    const buildCityBuildingTypePayload = useCallback((form, includeId) => {
        const payload = {
            name: String(form.name || '').trim(),
            initialCount: Number(form.initialCount),
            radius: Number(form.radius),
            level: Number(form.level),
            nextUnitTypeId: String(form.nextUnitTypeId || '').trim(),
            sortOrder: Number(form.sortOrder),
            enabled: form.enabled !== false,
            style: parseStyleText(form.styleText)
        };
        if (String(form.upgradeCostKP || '').trim() === '') {
            payload.upgradeCostKP = null;
        } else {
            payload.upgradeCostKP = Number(form.upgradeCostKP);
        }
        if (includeId) payload.buildingTypeId = String(form.buildingTypeId || '').trim();
        return payload;
    }, [parseStyleText]);

    const validateCityBuildingTypeForm = useCallback((form, includeId) => {
        const buildingTypeId = String(form.buildingTypeId || '').trim();
        if (includeId && !CATALOG_ID_PATTERN.test(buildingTypeId)) {
            return '建筑ID格式不正确（2-64位字母/数字/下划线/中划线）';
        }
        if (!String(form.name || '').trim()) return '建筑名称不能为空';
        const numericChecks = [
            ['initialCount', 0, true],
            ['radius', 0.1, false],
            ['level', 1, true],
            ['sortOrder', Number.NEGATIVE_INFINITY, true]
        ];
        for (const [key, min, integer] of numericChecks) {
            const value = Number(form[key]);
            if (!Number.isFinite(value)) return `${key} 必须为数字`;
            if (integer && !Number.isInteger(value)) return `${key} 必须为整数`;
            if (value < min) return `${key} 不能小于 ${min}`;
        }
        if (String(form.upgradeCostKP || '').trim() !== '') {
            const upgradeCostKP = Number(form.upgradeCostKP);
            if (!Number.isFinite(upgradeCostKP) || upgradeCostKP < 0) {
                return 'upgradeCostKP 必须为大于等于 0 的数字';
            }
        }
        try {
            parseStyleText(form.styleText);
        } catch (error) {
            return error.message;
        }
        return '';
    }, [parseStyleText]);

    const saveCityBuildingType = useCallback(async () => {
        const token = localStorage.getItem('token');
        const isCreate = isCreatingCityBuildingType;
        const validationError = validateCityBuildingTypeForm(cityBuildingTypeForm, isCreate);
        if (validationError) {
            alert(validationError);
            return;
        }
        const payload = buildCityBuildingTypePayload(cityBuildingTypeForm, isCreate);
        const actionId = isCreate ? '__create__' : editingCityBuildingTypeId;
        setCityBuildingTypeActionId(actionId);
        try {
            const response = await fetch(
                isCreate
                    ? `${API_BASE}/admin/catalog/buildings`
                    : `${API_BASE}/admin/catalog/buildings/${editingCityBuildingTypeId}`,
                {
                    method: isCreate ? 'POST' : 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                }
            );
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '保存失败');
                return;
            }
            alert(isCreate ? '建筑创建成功' : '建筑更新成功');
            resetCityBuildingTypeEditor();
            fetchCityBuildingTypeCatalog();
        } catch (error) {
            console.error('保存建筑失败:', error);
            alert('保存失败');
        } finally {
            setCityBuildingTypeActionId('');
        }
    }, [
        buildCityBuildingTypePayload,
        cityBuildingTypeForm,
        editingCityBuildingTypeId,
        fetchCityBuildingTypeCatalog,
        isCreatingCityBuildingType,
        resetCityBuildingTypeEditor,
        validateCityBuildingTypeForm
    ]);

    const deleteCityBuildingType = useCallback(async (buildingType) => {
        if (!window.confirm(`确定删除建筑「${buildingType.name}」吗？`)) return;
        const token = localStorage.getItem('token');
        setCityBuildingTypeActionId(buildingType.buildingTypeId);
        try {
            const response = await fetch(`${API_BASE}/admin/catalog/buildings/${buildingType.buildingTypeId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '删除失败');
                return;
            }
            alert('建筑已删除');
            if (editingCityBuildingTypeId === buildingType.buildingTypeId) {
                resetCityBuildingTypeEditor();
            }
            fetchCityBuildingTypeCatalog();
        } catch (error) {
            console.error('删除建筑失败:', error);
            alert('删除失败');
        } finally {
            setCityBuildingTypeActionId('');
        }
    }, [editingCityBuildingTypeId, fetchCityBuildingTypeCatalog, resetCityBuildingTypeEditor]);

    return {
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
    };
};

export default useAdminCatalogFeature;
