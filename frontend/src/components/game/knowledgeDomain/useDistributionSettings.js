import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../../runtimeConfig';
import { getApiError, parseApiResponse } from './api';
import {
  buildDistributionRulePayload,
  computePercentSummary,
  createDefaultDistributionRule,
  createDefaultDistributionState,
  createDistributionRuleProfile,
  createDistributionRuleProfileId,
  getDefaultPublishExecuteAtInput,
  getDistributionScopePercent,
  normalizeDistributionProfiles,
  parseHourInputToDate,
  toHourInputValue
} from './shared';

const createDefaultDistributionToast = () => ({
  visible: false,
  message: '',
  type: 'info'
});

const useDistributionSettings = ({
  nodeId,
  isVisible,
  activeTab
}) => {
  const [distributionState, setDistributionState] = useState(createDefaultDistributionState);
  const [distributionUserKeyword, setDistributionUserKeyword] = useState('');
  const [distributionUserResults, setDistributionUserResults] = useState([]);
  const [distributionUserSearching, setDistributionUserSearching] = useState(false);
  const [distributionAllianceKeyword, setDistributionAllianceKeyword] = useState('');
  const [distributionAllianceResults, setDistributionAllianceResults] = useState([]);
  const [distributionAllianceSearching, setDistributionAllianceSearching] = useState(false);
  const [isDistributionRuleModalOpen, setIsDistributionRuleModalOpen] = useState(false);
  const [newDistributionRuleName, setNewDistributionRuleName] = useState('');
  const [distributionClockMs, setDistributionClockMs] = useState(Date.now());
  const [hasUnsavedDistributionDraft, setHasUnsavedDistributionDraft] = useState(false);
  const [distributionToast, setDistributionToast] = useState(createDefaultDistributionToast);
  const distributionToastTimerRef = useRef(null);

  const clearDistributionToastTimer = useCallback(() => {
    if (distributionToastTimerRef.current) {
      clearTimeout(distributionToastTimerRef.current);
      distributionToastTimerRef.current = null;
    }
  }, []);

  const resetDistributionSettings = useCallback(() => {
    clearDistributionToastTimer();
    setDistributionUserKeyword('');
    setDistributionUserResults([]);
    setDistributionUserSearching(false);
    setDistributionAllianceKeyword('');
    setDistributionAllianceResults([]);
    setDistributionAllianceSearching(false);
    setIsDistributionRuleModalOpen(false);
    setNewDistributionRuleName('');
    setDistributionClockMs(Date.now());
    setHasUnsavedDistributionDraft(false);
    setDistributionToast(createDefaultDistributionToast());
    setDistributionState(createDefaultDistributionState());
  }, [clearDistributionToastTimer]);

  const updateDistributionRule = useCallback((updater) => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextProfiles = [...normalized.profiles];
      const targetIndex = nextProfiles.findIndex((item) => item.profileId === normalized.activeRuleId);
      const currentRule = nextProfiles[targetIndex]?.rule || createDefaultDistributionRule();
      const nextRule = typeof updater === 'function' ? updater(currentRule) : updater;
      const nextSummary = computePercentSummary(nextRule, prev.allianceContributionPercent);
      nextProfiles[targetIndex] = {
        ...nextProfiles[targetIndex],
        rule: nextRule,
        percentSummary: nextSummary
      };

      return {
        ...prev,
        ruleProfiles: nextProfiles,
        activeRuleId: normalized.activeRuleId,
        percentSummary: nextSummary,
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  }, []);

  const updateActiveDistributionRuleName = useCallback((name) => {
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : '未命名规则';
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      return {
        ...prev,
        ruleProfiles: normalized.profiles.map((profile) => (
          profile.profileId === normalized.activeRuleId
            ? { ...profile, name: nextName }
            : profile
        )),
        activeRuleId: normalized.activeRuleId,
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  }, []);

  const setActiveDistributionRule = useCallback((profileId) => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextActiveRuleId = normalized.profiles.some((profile) => profile.profileId === profileId)
        ? profileId
        : normalized.activeRuleId;
      const activeProfile = normalized.profiles.find((profile) => profile.profileId === nextActiveRuleId) || normalized.profiles[0];
      return {
        ...prev,
        ruleProfiles: normalized.profiles,
        activeRuleId: nextActiveRuleId,
        percentSummary: computePercentSummary(activeProfile?.rule || createDefaultDistributionRule(), prev.allianceContributionPercent),
        feedback: ''
      };
    });
  }, []);

  const createDistributionRuleProfileItem = useCallback(() => {
    const trimmedName = newDistributionRuleName.trim();
    setDistributionState((prev) => {
      const nextName = trimmedName || `规则${(prev.ruleProfiles || []).length + 1}`;
      const nextId = createDistributionRuleProfileId();
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextProfiles = [
        ...normalized.profiles,
        {
          ...createDistributionRuleProfile(nextId, nextName),
          percentSummary: computePercentSummary(createDefaultDistributionRule(), prev.allianceContributionPercent)
        }
      ];
      return {
        ...prev,
        ruleProfiles: nextProfiles,
        activeRuleId: nextId,
        percentSummary: computePercentSummary(createDefaultDistributionRule(), prev.allianceContributionPercent),
        feedback: ''
      };
    });
    setNewDistributionRuleName('');
    setHasUnsavedDistributionDraft(true);
  }, [newDistributionRuleName]);

  const removeActiveDistributionRule = useCallback(() => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      if (normalized.profiles.length <= 1) {
        return {
          ...prev,
          feedback: '至少保留一套分发规则'
        };
      }
      const filtered = normalized.profiles.filter((profile) => profile.profileId !== normalized.activeRuleId);
      const nextActive = filtered[0];
      return {
        ...prev,
        ruleProfiles: filtered,
        activeRuleId: nextActive.profileId,
        percentSummary: computePercentSummary(nextActive.rule, prev.allianceContributionPercent),
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  }, []);

  const fetchDistributionSettings = useCallback(async (silent = true, forceApplyRules = false, options = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return;
    const preserveFeedback = options?.preserveFeedback === true;

    if (!silent) {
      setDistributionState((prev) => ({ ...prev, loading: true, error: '', feedback: '' }));
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/distribution-settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        if (response.status === 403) {
          setDistributionState((prev) => ({ ...prev, loading: false, canView: false, canEdit: false, error: '' }));
          return;
        }
        setDistributionState((prev) => ({
          ...prev,
          loading: false,
          canView: false,
          canEdit: false,
          error: getApiError(parsed, '获取分发规则失败')
        }));
        return;
      }

      const allianceContributionPercent = Number(data.allianceContributionPercent || 0);
      const hasAlliance = !!data.masterAllianceName;
      const rawProfiles = Array.isArray(data.ruleProfiles) && data.ruleProfiles.length > 0
        ? data.ruleProfiles
        : [{ profileId: data.activeRuleId || 'default', name: '默认规则', rule: data.rule || {} }];
      const normalized = normalizeDistributionProfiles(rawProfiles, data.activeRuleId || '', allianceContributionPercent);
      const normalizedProfiles = hasAlliance
        ? normalized.profiles
        : normalized.profiles.map((profile) => ({
            ...profile,
            rule: {
              ...profile.rule,
              nonHostileAlliancePercent: 0,
              specificAlliancePercents: []
            },
            percentSummary: computePercentSummary({
              ...profile.rule,
              nonHostileAlliancePercent: 0,
              specificAlliancePercents: []
            }, allianceContributionPercent)
          }));
      const activeProfile = normalizedProfiles.find((profile) => profile.profileId === normalized.activeRuleId) || normalizedProfiles[0];
      const nextLocked = data.locked || null;
      const publishRuleId = nextLocked?.ruleProfileId
        || (normalizedProfiles.some((profile) => profile.profileId === data.activeRuleId) ? data.activeRuleId : activeProfile?.profileId || 'default');
      const publishExecuteAt = nextLocked?.executeAt
        ? toHourInputValue(nextLocked.executeAt)
        : getDefaultPublishExecuteAtInput();
      const shouldPreserveLocalDraft = silent && hasUnsavedDistributionDraft && !forceApplyRules;

      setDistributionState((prev) => {
        const appliedRuleState = shouldPreserveLocalDraft
          ? (() => {
              const localNormalized = normalizeDistributionProfiles(
                prev.ruleProfiles,
                prev.activeRuleId,
                allianceContributionPercent
              );
              const localProfiles = hasAlliance
                ? localNormalized.profiles
                : localNormalized.profiles.map((profile) => ({
                    ...profile,
                    rule: {
                      ...profile.rule,
                      nonHostileAlliancePercent: 0,
                      specificAlliancePercents: []
                    },
                    percentSummary: computePercentSummary({
                      ...profile.rule,
                      nonHostileAlliancePercent: 0,
                      specificAlliancePercents: []
                    }, allianceContributionPercent)
                  }));
              const localActiveProfile = localProfiles.find((profile) => profile.profileId === localNormalized.activeRuleId) || localProfiles[0];
              return {
                activeRuleId: localNormalized.activeRuleId,
                ruleProfiles: localProfiles,
                percentSummary: computePercentSummary(localActiveProfile?.rule || createDefaultDistributionRule(), allianceContributionPercent)
              };
            })()
          : {
              activeRuleId: normalized.activeRuleId,
              ruleProfiles: normalizedProfiles,
              percentSummary: computePercentSummary(activeProfile?.rule || createDefaultDistributionRule(), allianceContributionPercent)
            };

        return {
          ...prev,
          ...appliedRuleState,
          loading: false,
          saving: false,
          publishing: false,
          error: '',
          feedback: (preserveFeedback || shouldPreserveLocalDraft) ? prev.feedback : '',
          canView: !!data.canView,
          canEdit: !!data.canEdit,
          isRuleLocked: !!data.isRuleLocked,
          allianceContributionPercent,
          masterAllianceName: data.masterAllianceName || '',
          carryoverValue: Number(data.carryoverValue || 0),
          knowledgePointValue: Number(data.knowledgePointValue || 0),
          lastSyncedAt: Date.now(),
          locked: nextLocked,
          publishRuleId,
          publishExecuteAt
        };
      });
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        loading: false,
        error: `获取分发规则失败: ${error.message}`
      }));
    }
  }, [hasUnsavedDistributionDraft, nodeId]);

  const saveDistributionSettings = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return;
    if (!distributionState.canEdit) return;
    if (distributionState.locked) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '当前分发计划已发布，采用规则锁定中，请等待本次分发结束后再修改规则'
      }));
      return;
    }

    const hasMasterAlliance = !!distributionState.masterAllianceName;
    const normalized = normalizeDistributionProfiles(
      distributionState.ruleProfiles,
      distributionState.activeRuleId,
      distributionState.allianceContributionPercent
    );
    const overLimitProfile = normalized.profiles.find((profile) => (
      computePercentSummary(profile.rule, distributionState.allianceContributionPercent).total > 100
    ));
    if (overLimitProfile) {
      const overTotal = computePercentSummary(overLimitProfile.rule, distributionState.allianceContributionPercent).total;
      setDistributionState((prev) => ({
        ...prev,
        feedback: `规则「${overLimitProfile.name}」总比例 ${overTotal}% 超过 100%，请调整`
      }));
      return;
    }

    setDistributionState((prev) => ({ ...prev, saving: true, feedback: '', error: '' }));
    try {
      const payload = {
        activeRuleId: normalized.activeRuleId,
        ruleProfiles: normalized.profiles.map((profile) => ({
          profileId: profile.profileId,
          name: profile.name,
          rule: (() => {
            const baseRule = {
              ...buildDistributionRulePayload(profile.rule),
              distributionScope: profile.rule?.distributionScope === 'partial' ? 'partial' : 'all',
              distributionPercent: getDistributionScopePercent(profile.rule)
            };
            if (!hasMasterAlliance) {
              baseRule.nonHostileAlliancePercent = 0;
              baseRule.specificAlliancePercents = [];
            }
            return baseRule;
          })()
        }))
      };

      const response = await fetch(`${API_BASE}/nodes/${nodeId}/distribution-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionState((prev) => ({
          ...prev,
          saving: false,
          error: getApiError(parsed, '保存分发规则失败')
        }));
        return;
      }

      setDistributionState((prev) => ({
        ...prev,
        saving: false,
        feedback: data.message || '分发规则已保存',
        isRuleLocked: !!data.isRuleLocked
      }));
      setHasUnsavedDistributionDraft(false);
      await fetchDistributionSettings(true, true, { preserveFeedback: true });
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        saving: false,
        error: `保存分发规则失败: ${error.message}`
      }));
    }
  }, [distributionState, fetchDistributionSettings, nodeId]);

  const publishDistributionPlan = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return;
    if (!distributionState.canEdit) return;

    if (distributionState.locked) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '当前已有已发布分发计划，发布后不可撤回，请等待本次分发执行后再发布'
      }));
      return;
    }

    const executeAtDate = parseHourInputToDate(distributionState.publishExecuteAt);
    if (!executeAtDate) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '请设置整点执行时间（例如 2026-02-16 16:00）'
      }));
      return;
    }
    if (executeAtDate.getTime() <= Date.now()) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '执行时间必须晚于当前时间'
      }));
      return;
    }

    const normalized = normalizeDistributionProfiles(
      distributionState.ruleProfiles,
      distributionState.activeRuleId,
      distributionState.allianceContributionPercent
    );
    const targetProfile = normalized.profiles.find((profile) => profile.profileId === distributionState.publishRuleId)
      || normalized.profiles.find((profile) => profile.profileId === normalized.activeRuleId)
      || normalized.profiles[0];

    if (!targetProfile) {
      setDistributionState((prev) => ({ ...prev, feedback: '未找到可发布的分发规则' }));
      return;
    }

    const targetSummary = computePercentSummary(targetProfile.rule, distributionState.allianceContributionPercent);
    if (targetSummary.total > 100) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: `规则「${targetProfile.name}」总比例 ${targetSummary.total}% 超过 100%，请先调整再发布`
      }));
      return;
    }

    setDistributionState((prev) => ({
      ...prev,
      publishing: true,
      feedback: '',
      error: ''
    }));

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/distribution-settings/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ruleProfileId: targetProfile.profileId,
          executeAt: executeAtDate.toISOString()
        })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionState((prev) => ({
          ...prev,
          publishing: false,
          error: getApiError(parsed, '发布分发计划失败')
        }));
        return;
      }

      setDistributionState((prev) => ({
        ...prev,
        publishing: false,
        feedback: data.message || '分发计划已发布并锁定，不可撤回'
      }));
      setHasUnsavedDistributionDraft(false);
      await fetchDistributionSettings(true, true, { preserveFeedback: true });
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        publishing: false,
        error: `发布分发计划失败: ${error.message}`
      }));
    }
  }, [distributionState, fetchDistributionSettings, nodeId]);

  useEffect(() => () => {
    clearDistributionToastTimer();
  }, [clearDistributionToastTimer]);

  useEffect(() => {
    if (!isDistributionRuleModalOpen) {
      clearDistributionToastTimer();
      setDistributionToast((prev) => ({ ...prev, visible: false }));
      return;
    }
    const openToast = (rawMessage, type = 'info') => {
      const normalizedMessage = typeof rawMessage === 'string' ? rawMessage.trim() : '';
      if (!normalizedMessage) return;
      clearDistributionToastTimer();
      setDistributionToast({
        visible: true,
        message: normalizedMessage,
        type: type === 'error' ? 'error' : (type === 'success' ? 'success' : 'info')
      });
      distributionToastTimerRef.current = setTimeout(() => {
        setDistributionToast((prev) => ({ ...prev, visible: false }));
        distributionToastTimerRef.current = null;
      }, 2200);
    };
    if (distributionState.error) {
      openToast(distributionState.error, 'error');
      return;
    }
    if (distributionState.feedback) {
      const isSuccessFeedback = /(已保存|已发布|成功|已提交)/.test(distributionState.feedback);
      openToast(distributionState.feedback, isSuccessFeedback ? 'success' : 'info');
    }
  }, [clearDistributionToastTimer, distributionState.error, distributionState.feedback, isDistributionRuleModalOpen]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage') return undefined;
    setDistributionClockMs(Date.now());
    const timerId = setInterval(() => {
      setDistributionClockMs(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [activeTab, isVisible]);

  useEffect(() => {
    if (
      !isVisible ||
      activeTab !== 'manage' ||
      !nodeId ||
      !distributionState.canView ||
      hasUnsavedDistributionDraft ||
      isDistributionRuleModalOpen
    ) return undefined;
    const timerId = setInterval(() => {
      fetchDistributionSettings(true);
    }, 15000);
    return () => clearInterval(timerId);
  }, [
    activeTab,
    distributionState.canView,
    fetchDistributionSettings,
    hasUnsavedDistributionDraft,
    isDistributionRuleModalOpen,
    isVisible,
    nodeId
  ]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !nodeId || !distributionState.canEdit) {
      setDistributionUserResults([]);
      return undefined;
    }
    const keyword = distributionUserKeyword.trim();
    if (!keyword) {
      setDistributionUserResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setDistributionUserSearching(true);
      try {
        const response = await fetch(
          `${API_BASE}/nodes/${nodeId}/distribution-settings/search-users?keyword=${encodeURIComponent(keyword)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setDistributionUserResults([]);
          return;
        }
        setDistributionUserResults(data.users || []);
      } catch (error) {
        setDistributionUserResults([]);
      } finally {
        setDistributionUserSearching(false);
      }
    }, 280);

    return () => clearTimeout(timerId);
  }, [activeTab, distributionState.canEdit, distributionUserKeyword, isVisible, nodeId]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !nodeId || !distributionState.canEdit) {
      setDistributionAllianceResults([]);
      return undefined;
    }
    const keyword = distributionAllianceKeyword.trim();
    if (!keyword) {
      setDistributionAllianceResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setDistributionAllianceSearching(true);
      try {
        const response = await fetch(
          `${API_BASE}/nodes/${nodeId}/distribution-settings/search-alliances?keyword=${encodeURIComponent(keyword)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setDistributionAllianceResults([]);
          return;
        }
        setDistributionAllianceResults(data.alliances || []);
      } catch (error) {
        setDistributionAllianceResults([]);
      } finally {
        setDistributionAllianceSearching(false);
      }
    }, 280);

    return () => clearTimeout(timerId);
  }, [activeTab, distributionAllianceKeyword, distributionState.canEdit, isVisible, nodeId]);

  const normalizedDistributionProfiles = normalizeDistributionProfiles(
    distributionState.ruleProfiles,
    distributionState.activeRuleId,
    distributionState.allianceContributionPercent
  );
  const distributionProfiles = normalizedDistributionProfiles.profiles;
  const activeDistributionRuleId = normalizedDistributionProfiles.activeRuleId;
  const activeDistributionProfile = distributionProfiles.find((profile) => profile.profileId === activeDistributionRuleId) || distributionProfiles[0];
  const publishDistributionProfile = distributionProfiles.find((profile) => profile.profileId === distributionState.publishRuleId)
    || activeDistributionProfile
    || distributionProfiles[0];
  const publishDistributionRuleId = distributionProfiles.some((profile) => profile.profileId === distributionState.publishRuleId)
    ? distributionState.publishRuleId
    : (publishDistributionProfile?.profileId || '');
  const distributionRule = activeDistributionProfile?.rule || createDefaultDistributionRule();
  const hasMasterAlliance = !!distributionState.masterAllianceName;
  const currentPercentSummary = computePercentSummary(distributionRule, distributionState.allianceContributionPercent);
  const scopePercent = getDistributionScopePercent(distributionRule);
  const unallocatedPercent = Math.max(0, 100 - currentPercentSummary.total);
  const lockedDistribution = distributionState.locked || null;
  const lockedExecuteMs = new Date(lockedDistribution?.executeAt || 0).getTime();
  const hasLockedPlan = !!lockedDistribution && Number.isFinite(lockedExecuteMs);
  const hasUpcomingPublishedPlan = hasLockedPlan && lockedExecuteMs > distributionClockMs;
  const countdownSeconds = hasUpcomingPublishedPlan
    ? Math.max(0, Math.floor((lockedExecuteMs - distributionClockMs) / 1000))
    : 0;

  const blockedRuleNotes = [];
  if (!hasMasterAlliance) {
    blockedRuleNotes.push('域主当前未加入熵盟，Z / D / E 与敌对判定已自动禁用');
  } else {
    blockedRuleNotes.push('敌对熵盟成员优先级最高，固定不可获取（0%）');
  }
  blockedRuleNotes.push('黑名单（用户/熵盟）跟随域主，域主变更时将自动重置');

  const conflictMessages = [];
  const blackUserSet = new Set((distributionRule.blacklistUsers || []).map((item) => item.userId).filter(Boolean));
  const blackAllianceSet = new Set((distributionRule.blacklistAlliances || []).map((item) => item.allianceId).filter(Boolean));
  const conflictUsers = (distributionRule.customUserPercents || []).filter((item) => blackUserSet.has(item.userId));
  const conflictAlliances = (distributionRule.specificAlliancePercents || []).filter((item) => blackAllianceSet.has(item.allianceId));
  if (conflictUsers.length > 0) {
    conflictMessages.push(`指定用户与黑名单冲突 ${conflictUsers.length} 项，最终按“禁止”处理`);
  }
  if (conflictAlliances.length > 0) {
    conflictMessages.push(`指定熵盟与黑名单冲突 ${conflictAlliances.length} 项，最终按“禁止”处理`);
  }
  if (currentPercentSummary.total > 100) {
    conflictMessages.push(`总比例超限 ${currentPercentSummary.total.toFixed(2)}%，超出部分不会被允许保存`);
  }

  return {
    distributionState,
    setDistributionState,
    distributionUserKeyword,
    setDistributionUserKeyword,
    distributionUserResults,
    distributionUserSearching,
    distributionAllianceKeyword,
    setDistributionAllianceKeyword,
    distributionAllianceResults,
    distributionAllianceSearching,
    isDistributionRuleModalOpen,
    setIsDistributionRuleModalOpen,
    newDistributionRuleName,
    setNewDistributionRuleName,
    hasUnsavedDistributionDraft,
    distributionToast,
    clearDistributionToastTimer,
    resetDistributionSettings,
    updateDistributionRule,
    updateActiveDistributionRuleName,
    setActiveDistributionRule,
    createDistributionRuleProfileItem,
    removeActiveDistributionRule,
    fetchDistributionSettings,
    saveDistributionSettings,
    publishDistributionPlan,
    distributionProfiles,
    activeDistributionRuleId,
    activeDistributionProfile,
    publishDistributionProfile,
    publishDistributionRuleId,
    distributionRule,
    hasMasterAlliance,
    currentPercentSummary,
    scopePercent,
    unallocatedPercent,
    lockedExecuteMs,
    hasLockedPlan,
    hasUpcomingPublishedPlan,
    countdownSeconds,
    blockedRuleNotes,
    conflictMessages
  };
};

export default useDistributionSettings;
