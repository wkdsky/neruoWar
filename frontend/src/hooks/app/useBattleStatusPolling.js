import { useEffect } from 'react';
import {
  isTitleBattleView,
  normalizeObjectId
} from '../../app/appShared';

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

    fetchDistributionParticipationStatus(targetNodeId, true);
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true);
    }, 4000);

    return () => clearInterval(timer);
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
    fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    }, 1000);
    return () => clearInterval(timer);
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

    fetchSiegeStatus(targetNodeId, { silent: true, preserveIntelView: siegeDialog.open });
    const timer = setInterval(() => {
      fetchSiegeStatus(targetNodeId, { silent: true, preserveIntelView: siegeDialog.open });
    }, siegeDialog.open ? 2000 : 4000);
    return () => clearInterval(timer);
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
