const ScheduledTask = require('../models/ScheduledTask');
const AllianceBroadcastEvent = require('../models/AllianceBroadcastEvent');
const DistributionResult = require('../models/DistributionResult');
const SiegeParticipant = require('../models/SiegeParticipant');
const { pruneExpiredTemporaryMediaAssets } = require('./senseArticleMediaService');

const TASK_RETENTION_DAYS = Math.max(1, parseInt(process.env.TASK_RETENTION_DAYS, 10) || 7);
const BROADCAST_RETENTION_DAYS = Math.max(1, parseInt(process.env.BROADCAST_RETENTION_DAYS, 10) || 30);
const DISTRIBUTION_RESULT_RETENTION_DAYS = Math.max(1, parseInt(process.env.DISTRIBUTION_RESULT_RETENTION_DAYS, 10) || 90);
const SIEGE_PARTICIPANT_RETENTION_DAYS = Math.max(1, parseInt(process.env.SIEGE_PARTICIPANT_RETENTION_DAYS, 10) || 14);

const computeCutoff = (now = new Date(), days = 7) => {
  const safeNow = now instanceof Date ? now : new Date(now);
  return new Date(safeNow.getTime() - (Math.max(1, days) * 24 * 60 * 60 * 1000));
};

const runMaintenanceCleanup = async ({ now = new Date() } = {}) => {
  const safeNow = now instanceof Date ? now : new Date(now);
  const taskCutoff = computeCutoff(safeNow, TASK_RETENTION_DAYS);
  const broadcastCutoff = computeCutoff(safeNow, BROADCAST_RETENTION_DAYS);
  const distributionCutoff = computeCutoff(safeNow, DISTRIBUTION_RESULT_RETENTION_DAYS);
  const siegeCutoff = computeCutoff(safeNow, SIEGE_PARTICIPANT_RETENTION_DAYS);

  const [taskResult, eventResult, distributionResult, siegeResult, tempMediaResult] = await Promise.all([
    ScheduledTask.deleteMany({
      status: { $in: ['done', 'failed'] },
      updatedAt: { $lt: taskCutoff }
    }),
    AllianceBroadcastEvent.deleteMany({
      createdAt: { $lt: broadcastCutoff }
    }),
    DistributionResult.deleteMany({
      createdAt: { $lt: distributionCutoff }
    }),
    SiegeParticipant.deleteMany({
      status: { $nin: ['moving', 'sieging'] },
      updatedAt: { $lt: siegeCutoff }
    }),
    pruneExpiredTemporaryMediaAssets({ now: safeNow })
  ]);

  return {
    now: safeNow,
    retentionDays: {
      taskRetentionDays: TASK_RETENTION_DAYS,
      broadcastRetentionDays: BROADCAST_RETENTION_DAYS,
      distributionResultRetentionDays: DISTRIBUTION_RESULT_RETENTION_DAYS,
      siegeParticipantRetentionDays: SIEGE_PARTICIPANT_RETENTION_DAYS
    },
    cutoffs: {
      taskCutoff,
      broadcastCutoff,
      distributionCutoff,
      siegeCutoff
    },
    deleted: {
      scheduledTasks: taskResult?.deletedCount || 0,
      allianceBroadcastEvents: eventResult?.deletedCount || 0,
      distributionResults: distributionResult?.deletedCount || 0,
      siegeParticipants: siegeResult?.deletedCount || 0,
      temporarySenseArticleMediaAssets: tempMediaResult?.deletedAssetCount || 0,
      temporarySenseArticleMediaFiles: tempMediaResult?.deletedFileCount || 0
    }
  };
};

module.exports = {
  TASK_RETENTION_DAYS,
  BROADCAST_RETENTION_DAYS,
  DISTRIBUTION_RESULT_RETENTION_DAYS,
  SIEGE_PARTICIPANT_RETENTION_DAYS,
  runMaintenanceCleanup
};
