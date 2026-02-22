const os = require('os');

const connectDB = require('./config/database');
const schedulerService = require('./services/schedulerService');
const KnowledgeDistributionService = require('./services/KnowledgeDistributionService');
const { processExpiredDomainAdminResignRequests } = require('./services/domainAdminResignService');
const {
  publishAllianceAnnouncement,
  publishSiegeSupportRequest
} = require('./services/allianceBroadcastService');

const WORKER_CONCURRENCY = Math.max(1, Math.min(32, parseInt(process.env.WORKER_CONCURRENCY, 10) || 1));
const WORKER_LOCK_MS = Math.max(10 * 1000, parseInt(process.env.WORKER_LOCK_MS, 10) || 90 * 1000);
const WORKER_POLL_MS = Math.max(200, parseInt(process.env.WORKER_POLL_MS, 10) || 1000);
const WORKER_BACKOFF_MS = Math.max(500, parseInt(process.env.WORKER_BACKOFF_MS, 10) || 2000);
const WORKER_MAX_ATTEMPTS = Math.max(1, Math.min(100, parseInt(process.env.WORKER_MAX_ATTEMPTS, 10) || 8));
const WORKER_RECOVER_INTERVAL_MS = Math.max(2000, parseInt(process.env.WORKER_RECOVER_INTERVAL_MS, 10) || 30 * 1000);
const WORKER_OWNER_ID = (process.env.WORKER_OWNER_ID || `${os.hostname()}-${process.pid}`).trim();

let stopping = false;
let lastRecoverAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handlers = {
  domain_admin_resign_timeout_tick: async () => {
    await processExpiredDomainAdminResignRequests(new Date());
  },
  knowledge_distribution_tick: async () => {
    await KnowledgeDistributionService.processTick();
  },
  alliance_announcement_broadcast_job: async (payload = {}) => {
    await publishAllianceAnnouncement(payload);
  },
  siege_support_broadcast_job: async (payload = {}) => {
    await publishSiegeSupportRequest(payload);
  }
};

const runTask = async (task) => {
  const type = typeof task?.type === 'string' ? task.type.trim() : '';
  const handler = handlers[type];

  if (!handler) {
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
  console.log(`[worker] started owner=${WORKER_OWNER_ID} concurrency=${WORKER_CONCURRENCY}`);

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
