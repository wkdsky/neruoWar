const os = require('os');

const connectDB = require('./config/database');
const schedulerService = require('./services/schedulerService');
const KnowledgeDistributionService = require('./services/KnowledgeDistributionService');
const { processExpiredDomainAdminResignRequests } = require('./services/domainAdminResignService');
const {
  publishAllianceAnnouncement,
  publishSiegeSupportRequest
} = require('./services/allianceBroadcastService');
const { runMaintenanceCleanup } = require('./services/maintenanceCleanupService');
const {
  materializeNodeSensesToEmbedded,
  backfillNodeSenseCollectionFromEmbedded
} = require('./services/nodeSenseStore');
const { pruneExpiredTemporaryMediaAssets } = require('./services/senseArticleMediaService');

const WORKER_CONCURRENCY = Math.max(1, Math.min(32, parseInt(process.env.WORKER_CONCURRENCY, 10) || 1));
const WORKER_LOCK_MS = Math.max(1000, parseInt(process.env.WORKER_LOCK_MS, 10) || 90 * 1000);
const WORKER_POLL_MS = Math.max(200, parseInt(process.env.WORKER_POLL_MS, 10) || 1000);
const WORKER_BACKOFF_MS = Math.max(500, parseInt(process.env.WORKER_BACKOFF_MS, 10) || 2000);
const WORKER_MAX_ATTEMPTS = Math.max(1, Math.min(100, parseInt(process.env.WORKER_MAX_ATTEMPTS, 10) || 8));
const WORKER_RECOVER_INTERVAL_MS = Math.max(2000, parseInt(process.env.WORKER_RECOVER_INTERVAL_MS, 10) || 30 * 1000);
const WORKER_OWNER_ID = (process.env.WORKER_OWNER_ID || `${os.hostname()}-${process.pid}`).trim();
const KNOWLEDGE_DISTRIBUTION_MAX_ITEMS_PER_TICK = Math.max(
  1,
  parseInt(process.env.KNOWLEDGE_DISTRIBUTION_MAX_ITEMS_PER_TICK, 10) || 50
);
const DOMAIN_ADMIN_RESIGN_MAX_ITEMS_PER_TICK = Math.max(
  1,
  parseInt(process.env.DOMAIN_ADMIN_RESIGN_MAX_ITEMS_PER_TICK, 10) || 200
);
const TICK_FOLLOWUP_BUCKET_MS = Math.max(
  1000,
  parseInt(process.env.TICK_FOLLOWUP_BUCKET_MS, 10) || 5000
);
const ENABLE_MAINTENANCE_CLEANUP = process.env.ENABLE_MAINTENANCE_CLEANUP !== 'false';
const WORKER_HEARTBEAT_ENABLE = process.env.WORKER_HEARTBEAT_ENABLE !== 'false';
const WORKER_HEARTBEAT_INTERVAL_MS = (() => {
  const configured = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS, 10);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1000, Math.min(30 * 1000, configured));
  }
  return Math.min(30 * 1000, Math.max(1000, Math.floor(WORKER_LOCK_MS / 3)));
})();

let stopping = false;
let lastRecoverAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const enqueueFollowupTick = async (type, payload = {}) => {
  const bucket = Math.floor(Date.now() / TICK_FOLLOWUP_BUCKET_MS);
  await schedulerService.enqueue({
    type,
    runAt: new Date(),
    payload,
    dedupeKey: `${type}_followup:${bucket}`
  });
};

const handlers = {
  domain_admin_resign_timeout_tick: async () => {
    const result = await processExpiredDomainAdminResignRequests(new Date(), {
      maxItems: DOMAIN_ADMIN_RESIGN_MAX_ITEMS_PER_TICK
    });
    if (result?.hasMore) {
      await enqueueFollowupTick('domain_admin_resign_timeout_tick');
    }
  },
  knowledge_distribution_tick: async () => {
    const result = await KnowledgeDistributionService.processTick({
      maxItems: KNOWLEDGE_DISTRIBUTION_MAX_ITEMS_PER_TICK
    });
    if (result?.hasMore) {
      await enqueueFollowupTick('knowledge_distribution_tick');
    }
  },
  alliance_announcement_broadcast_job: async (payload = {}) => {
    await publishAllianceAnnouncement(payload);
  },
  siege_support_broadcast_job: async (payload = {}) => {
    await publishSiegeSupportRequest(payload);
  },
  node_sense_materialize_job: async (payload = {}) => {
    await materializeNodeSensesToEmbedded({
      nodeId: payload?.nodeId,
      expectedWatermark: payload?.expectedWatermark,
      expectedVersion: payload?.expectedVersion
    });
  },
  node_sense_backfill_job: async (payload = {}) => {
    await backfillNodeSenseCollectionFromEmbedded({
      nodeId: payload?.nodeId,
      actorUserId: payload?.actorUserId || null
    });
  },
  sleep_test_job: async (payload = {}) => {
    const requestedMs = Math.max(0, parseInt(payload?.ms, 10) || 0);
    const sleepMs = Math.min(15 * 60 * 1000, requestedMs);
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  },
  maintenance_cleanup_tick: async () => {
    if (!ENABLE_MAINTENANCE_CLEANUP) return;
    const result = await runMaintenanceCleanup({ now: new Date() });
    console.log('[worker] maintenance cleanup:', JSON.stringify(result.deleted));
  },
  sense_article_temp_media_cleanup_tick: async () => {
    const result = await pruneExpiredTemporaryMediaAssets({ now: new Date() });
    console.log('[worker] temp media cleanup:', JSON.stringify(result));
  }
};

const startTaskHeartbeat = (task) => {
  if (!WORKER_HEARTBEAT_ENABLE) return { stop: () => {} };
  const taskId = task?._id;
  if (!taskId) return { stop: () => {} };

  let stopped = false;
  let inFlight = false;
  const timer = setInterval(async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const result = await schedulerService.extendLock({
        taskId,
        ownerId: WORKER_OWNER_ID,
        lockMs: WORKER_LOCK_MS
      });
      if ((result?.matchedCount || 0) === 0) {
        console.warn(`[worker] heartbeat extendLock skipped task=${taskId} owner=${WORKER_OWNER_ID}`);
      }
    } catch (error) {
      console.error('[worker] heartbeat extendLock error:', error?.stack || error?.message || error);
    } finally {
      inFlight = false;
    }
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  if (typeof timer?.unref === 'function') {
    timer.unref();
  }

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
};

const runTask = async (task) => {
  const type = typeof task?.type === 'string' ? task.type.trim() : '';
  const handler = handlers[type];
  const heartbeat = startTaskHeartbeat(task);

  if (!handler) {
    heartbeat.stop();
    await schedulerService.fail(task._id, new Error(`Unknown task type: ${type}`), { retry: false });
    return;
  }

  try {
    await handler(task.payload || {}, task);
    await schedulerService.complete(task._id);
  } catch (error) {
    const attempts = Math.max(0, parseInt(task?.attempts, 10) || 0);
    const retry = attempts < WORKER_MAX_ATTEMPTS;
    await schedulerService.fail(task._id, error, {
      retry,
      backoffMs: WORKER_BACKOFF_MS
    });
  } finally {
    heartbeat.stop();
  }
};

const maybeRecoverExpiredLocks = async () => {
  const nowMs = Date.now();
  if ((nowMs - lastRecoverAt) < WORKER_RECOVER_INTERVAL_MS) return;
  lastRecoverAt = nowMs;
  await schedulerService.recoverExpiredLocks({ now: new Date(nowMs) });
};

const start = async () => {
  await connectDB();
  console.log(
    `[worker] started owner=${WORKER_OWNER_ID} concurrency=${WORKER_CONCURRENCY} heartbeat=${WORKER_HEARTBEAT_ENABLE ? 'on' : 'off'} intervalMs=${WORKER_HEARTBEAT_INTERVAL_MS}`
  );

  while (!stopping) {
    try {
      await maybeRecoverExpiredLocks();
      const tasks = await schedulerService.claimNext({
        limit: WORKER_CONCURRENCY,
        lockMs: WORKER_LOCK_MS,
        ownerId: WORKER_OWNER_ID
      });

      if (!Array.isArray(tasks) || tasks.length === 0) {
        await sleep(WORKER_POLL_MS);
        continue;
      }

      await Promise.all(tasks.map((task) => runTask(task)));
    } catch (error) {
      console.error('[worker] loop error:', error?.stack || error?.message || error);
      await sleep(WORKER_POLL_MS);
    }
  }

  console.log('[worker] stopped');
  process.exit(0);
};

process.on('SIGINT', () => {
  stopping = true;
});

process.on('SIGTERM', () => {
  stopping = true;
});

start().catch((error) => {
  console.error('[worker] fatal error:', error?.stack || error?.message || error);
  process.exit(1);
});
