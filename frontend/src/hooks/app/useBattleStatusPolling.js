import { useEffect } from 'react';
import {
  isTitleBattleView,
  normalizeObjectId
} from '../../app/appShared';
import {
  isDocumentVisible,
  subscribeToVisibleInterval
} from './visibilityPolling';

const useBattleStatusPolling = ({
  authenticated,
  isAdmin,
  view,
  currentTitleDetail,
  userLocation,
  travelStatus,
  showDistributionPanel,
  siegeDialog,
  fetchDistributionParticipationStatus,
  resetDistributionState,
  closeDistributionPanel,
  fetchSiegeStatus,
  clearSiegeStatus
}) => {
  useEffect(() => {
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!authenticated || isAdmin || !isTitleBattleView(view) || !targetNodeId) {
      resetDistributionState();
      return undefined;
    }

    if (isDocumentVisible()) {
      fetchDistributionParticipationStatus(targetNodeId, true);
    }
    const unsubscribe = subscribeToVisibleInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true);
    }, 4000);

    return unsubscribe;
  }, [
    authenticated,
    currentTitleDetail?._id,
    fetchDistributionParticipationStatus,
    isAdmin,
    resetDistributionState,
    travelStatus.isTraveling,
    userLocation,
    view
  ]);

  useEffect(() => {
    if (!showDistributionPanel) return undefined;
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!targetNodeId || !isTitleBattleView(view)) {
      closeDistributionPanel();
      return undefined;
    }
    if (isDocumentVisible()) {
      fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    }
    const unsubscribe = subscribeToVisibleInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    }, 1000);
    return unsubscribe;
  }, [
    closeDistributionPanel,
    currentTitleDetail?._id,
    fetchDistributionParticipationStatus,
    showDistributionPanel,
    view
  ]);

  useEffect(() => {
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!authenticated || isAdmin || !isTitleBattleView(view) || !targetNodeId) {
      clearSiegeStatus();
      return undefined;
    }

    const sync = () => {
      fetchSiegeStatus(targetNodeId, { silent: true, preserveIntelView: siegeDialog.open });
    };
    if (isDocumentVisible()) sync();
    return subscribeToVisibleInterval(sync, siegeDialog.open ? 2000 : 4000);
  }, [
    authenticated,
    clearSiegeStatus,
    currentTitleDetail?._id,
    fetchSiegeStatus,
    isAdmin,
    siegeDialog.open,
    travelStatus.isTraveling,
    userLocation,
    view
  ]);
};

export default useBattleStatusPolling;
