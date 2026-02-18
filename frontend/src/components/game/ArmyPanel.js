import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './ArmyPanel.css';

const API_BASE = 'http://localhost:5000';
const QUICK_QTY_STEPS = [10, 50, 100, 500, 1000];

const parseApiResponse = async (response) => {
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    data = null;
  }
  return { response, data, rawText };
};

const getApiErrorMessage = (parsed, fallback) => {
  if (parsed?.data?.error) return parsed.data.error;
  if (parsed?.data?.message) return parsed.data.message;
  return fallback;
};

const getUnitId = (unit) => {
  const id = typeof unit?.id === 'string' ? unit.id.trim() : '';
  if (id) return id;
  return typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
};

const normalizeInteger = (value, fallback = 0, min = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.floor(num));
};

const ArmyPanel = () => {
  const [unitTypes, setUnitTypes] = useState([]);
  const [knowledgeBalance, setKnowledgeBalance] = useState(0);
  const [roster, setRoster] = useState([]);
  const [draftByUnit, setDraftByUnit] = useState({});
  const [cartByUnit, setCartByUnit] = useState({});
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState('');

  const token = localStorage.getItem('token');

  const unitTypeMap = useMemo(() => {
    return unitTypes.reduce((acc, unit) => {
      const unitId = getUnitId(unit);
      if (unitId) {
        acc[unitId] = unit;
      }
      return acc;
    }, {});
  }, [unitTypes]);

  const rosterByUnitId = useMemo(() => roster.reduce((acc, item) => {
    const key = typeof item?.unitTypeId === 'string' ? item.unitTypeId : '';
    if (!key) return acc;
    acc[key] = item;
    return acc;
  }, {}), [roster]);

  const unitsWithCount = useMemo(() => unitTypes.map((unit) => {
    const unitId = getUnitId(unit);
    return {
      ...unit,
      id: unitId,
      count: Number.isFinite(rosterByUnitId[unitId]?.count) ? rosterByUnitId[unitId].count : 0
    };
  }), [unitTypes, rosterByUnitId]);

  const cartItems = useMemo(() => {
    return Object.entries(cartByUnit)
      .map(([unitTypeId, qty]) => {
        const normalizedQty = normalizeInteger(qty, 0, 0);
        if (normalizedQty <= 0) return null;
        const unit = unitTypeMap[unitTypeId];
        if (!unit) return null;
        const costKP = Number(unit.costKP) || 0;
        return {
          unitTypeId,
          unit,
          qty: normalizedQty,
          subtotalCost: costKP * normalizedQty
        };
      })
      .filter(Boolean);
  }, [cartByUnit, unitTypeMap]);

  const totalCost = useMemo(() => cartItems.reduce((sum, item) => sum + item.subtotalCost, 0), [cartItems]);
  const remainBalance = knowledgeBalance - totalCost;
  const isInsufficient = remainBalance < 0;

  const fetchArmyData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('未登录，无法加载军团数据');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [unitTypesResponse, meResponse] = await Promise.all([
        fetch(`${API_BASE}/api/army/unit-types`),
        fetch(`${API_BASE}/api/army/me`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
      ]);

      const unitTypesParsed = await parseApiResponse(unitTypesResponse);
      const meParsed = await parseApiResponse(meResponse);

      if (!unitTypesResponse.ok) {
        setError(getApiErrorMessage(unitTypesParsed, '加载兵种列表失败'));
        setLoading(false);
        return;
      }

      if (!meResponse.ok) {
        setError(getApiErrorMessage(meParsed, '加载军团信息失败'));
        setLoading(false);
        return;
      }

      const nextUnitTypes = Array.isArray(unitTypesParsed.data?.unitTypes) ? unitTypesParsed.data.unitTypes : [];
      const nextRoster = Array.isArray(meParsed.data?.roster) ? meParsed.data.roster : [];
      const nextBalance = Number.isFinite(meParsed.data?.knowledgeBalance) ? meParsed.data.knowledgeBalance : 0;

      setUnitTypes(nextUnitTypes);
      setRoster(nextRoster);
      setKnowledgeBalance(nextBalance);

      setDraftByUnit((prev) => {
        const next = { ...prev };
        nextUnitTypes.forEach((unit) => {
          const unitId = getUnitId(unit);
          if (unitId && !Object.prototype.hasOwnProperty.call(next, unitId)) {
            next[unitId] = '0';
          }
        });
        return next;
      });
    } catch (requestError) {
      setError(`加载军团信息失败: ${requestError.message}`);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchArmyData();
  }, [fetchArmyData]);

  const getDraftQty = (unitTypeId) => normalizeInteger(draftByUnit[unitTypeId], 0, 0);

  const updateDraftByDelta = (unitTypeId, delta) => {
    setDraftByUnit((prev) => {
      const current = normalizeInteger(prev[unitTypeId], 0, 0);
      const nextQty = Math.max(0, current + delta);
      return {
        ...prev,
        [unitTypeId]: String(nextQty)
      };
    });
  };

  const addDraftToCart = (unit) => {
    const unitTypeId = unit.id;
    const draftQty = getDraftQty(unitTypeId);
    if (draftQty <= 0) {
      setError('请先设置大于 0 的征召数量');
      return;
    }

    setCartByUnit((prev) => ({
      ...prev,
      [unitTypeId]: normalizeInteger(prev[unitTypeId], 0, 0) + draftQty
    }));

    setDraftByUnit((prev) => ({
      ...prev,
      [unitTypeId]: '0'
    }));
    setError('');
  };

  const updateCartQty = (unitTypeId, nextQtyRaw) => {
    const nextQty = normalizeInteger(nextQtyRaw, 0, 0);
    setCartByUnit((prev) => {
      const next = { ...prev };
      if (nextQty <= 0) {
        delete next[unitTypeId];
      } else {
        next[unitTypeId] = nextQty;
      }
      return next;
    });
  };

  const removeCartItem = (unitTypeId) => {
    setCartByUnit((prev) => {
      const next = { ...prev };
      delete next[unitTypeId];
      return next;
    });
  };

  const handleCheckout = async () => {
    if (!token) {
      setError('未登录，无法结算');
      return;
    }
    if (cartItems.length === 0) {
      setError('征召预览为空，请先添加兵种');
      return;
    }
    if (isInsufficient) {
      setError('知识点不足，无法结算');
      return;
    }

    setCheckingOut(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/army/recruit/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          items: cartItems.map((item) => ({
            unitTypeId: item.unitTypeId,
            qty: item.qty
          }))
        })
      });

      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        setError(getApiErrorMessage(parsed, '结算失败'));
        return;
      }

      const nextRoster = Array.isArray(parsed.data?.roster) ? parsed.data.roster : [];
      const nextBalance = Number.isFinite(parsed.data?.knowledgeBalance)
        ? parsed.data.knowledgeBalance
        : knowledgeBalance;

      setRoster(nextRoster);
      setKnowledgeBalance(nextBalance);
      setCartByUnit({});
    } catch (requestError) {
      setError(`结算失败: ${requestError.message}`);
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="army-panel">
      <div className="army-panel-header">
        <h2>军团编制</h2>
        <div className="army-balance">知识点余额：<strong>{knowledgeBalance}</strong></div>
      </div>

      {error && <div className="army-message army-message-error">{error}</div>}

      {loading ? (
        <div className="army-loading">加载中...</div>
      ) : (
        <div className="army-content">
          <div className="army-unit-grid">
            {unitsWithCount.map((unit) => {
              const unitId = unit.id;
              const draftQty = getDraftQty(unitId);
              const draftCost = draftQty * (Number(unit.costKP) || 0);

              return (
                <article className="army-unit-card" key={unitId}>
                  <div className="army-unit-head">
                    <h3>{unit.name}</h3>
                    <span>{unit.roleTag}</span>
                  </div>
                  <div className="army-unit-stats">
                    <span>速度 {unit.speed}</span>
                    <span>生命 {unit.hp}</span>
                    <span>攻击 {unit.atk}</span>
                    <span>防御 {unit.def}</span>
                    <span>射程 {unit.range}</span>
                  </div>
                  <div className="army-unit-cost">单价：{unit.costKP} 知识点</div>

                  <div className="army-unit-actions">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={draftByUnit[unitId] ?? '0'}
                      onChange={(event) => {
                        const nextQty = normalizeInteger(event.target.value, 0, 0);
                        setDraftByUnit((prev) => ({
                          ...prev,
                          [unitId]: String(nextQty)
                        }));
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={draftQty <= 0}
                      onClick={() => addDraftToCart(unit)}
                    >
                      征召
                    </button>
                  </div>

                  <div className="army-step-group">
                    <div className="army-step-row plus">
                      {QUICK_QTY_STEPS.map((step) => (
                        <button
                          key={`plus-${unitId}-${step}`}
                          type="button"
                          className="army-step-btn"
                          onClick={() => updateDraftByDelta(unitId, step)}
                        >
                          +{step}
                        </button>
                      ))}
                    </div>
                    <div className="army-step-row minus">
                      {QUICK_QTY_STEPS.map((step) => (
                        <button
                          key={`minus-${unitId}-${step}`}
                          type="button"
                          className="army-step-btn"
                          onClick={() => updateDraftByDelta(unitId, -step)}
                        >
                          -{step}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="army-unit-foot">
                    <span>当前待征召：{draftQty}</span>
                    <span>预计消耗：{draftCost}</span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="army-side-panel">
            <aside className="army-preview-card">
              <h3>征召预览</h3>
              {cartItems.length === 0 ? (
                <div className="army-preview-empty">预览为空，请先点击各兵种的“征召”</div>
              ) : (
                <>
                  <div className="army-preview-list">
                    {cartItems.map((item) => (
                      <div className="army-preview-row" key={`preview-${item.unitTypeId}`}>
                        <span className="army-preview-name">{item.unit.name}</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={item.qty}
                          onChange={(event) => updateCartQty(item.unitTypeId, event.target.value)}
                        />
                        <span className="army-preview-cost">{item.subtotalCost}</span>
                        <button
                          type="button"
                          className="btn-action btn-delete"
                          onClick={() => removeCartItem(item.unitTypeId)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="army-preview-summary">
                    <div>总花费：<strong>{totalCost}</strong> 知识点</div>
                    <div className={isInsufficient ? 'army-insufficient' : ''}>
                      结算后剩余：<strong>{remainBalance}</strong> 知识点
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={checkingOut || cartItems.length === 0 || isInsufficient}
                    onClick={handleCheckout}
                  >
                    {checkingOut ? '结算中...' : '结算'}
                  </button>
                </>
              )}
            </aside>

            <aside className="army-roster-card">
              <h3>我的军团</h3>
              <div className="army-roster-list">
                {unitsWithCount.map((unit) => (
                  <div className="army-roster-row" key={`roster-${unit.id}`}>
                    <span>{unit.name}</span>
                    <strong>{unit.count}</strong>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArmyPanel;
