import BattleSnapshotSchema from './BattleSnapshotSchema';

const CHANNEL_KEYS = ['units', 'skillStates', 'buildings', 'projectiles', 'effects'];
const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, alpha) => from + ((to - from) * alpha);
const normalizeCount = (channel = null) => Math.max(0, Math.floor(Number(channel?.count) || 0));

const createChannel = (stride = 1) => ({
  stride,
  count: 0,
  capacity: 0,
  data: new Float32Array(0)
});

const createSnapshot = (schema = BattleSnapshotSchema) => ({
  schemaVersion: schema.version,
  unitAgentIds: [],
  unitSquadIds: [],
  units: createChannel(schema.units.stride),
  skillStates: createChannel(schema.skillStates.stride),
  buildings: createChannel(schema.buildings.stride),
  projectiles: createChannel(schema.projectiles.stride),
  effects: createChannel(schema.effects.stride)
});

const ensureCapacity = (channel, count) => {
  if (!channel || count <= channel.capacity) return channel;
  const nextCapacity = Math.max(count, Math.ceil(Math.max(16, channel.capacity) * 1.5));
  channel.capacity = nextCapacity;
  channel.data = new Float32Array(channel.stride * nextCapacity);
  return channel;
};

const copyCurrentChannel = (targetChannel, currentChannel) => {
  const count = normalizeCount(currentChannel);
  const sourceStride = Math.max(1, Math.floor(Number(currentChannel?.stride) || targetChannel.stride));
  if (sourceStride !== targetChannel.stride) {
    targetChannel.count = 0;
    return false;
  }
  ensureCapacity(targetChannel, count);
  targetChannel.count = count;
  const length = count * sourceStride;
  if (!(currentChannel?.data instanceof Float32Array) || length <= 0) return length <= 0;
  targetChannel.data.set(currentChannel.data.subarray(0, length), 0);
  return true;
};

const canInterpolateChannel = (previousChannel, currentChannel, targetChannel) => (
  previousChannel?.data instanceof Float32Array
  && currentChannel?.data instanceof Float32Array
  && normalizeCount(previousChannel) === normalizeCount(currentChannel)
  && Math.max(1, Number(previousChannel?.stride) || 0) === targetChannel.stride
  && Math.max(1, Number(currentChannel?.stride) || 0) === targetChannel.stride
);

const resolveUnitIdentityList = (snapshot = null, count = 0) => {
  const source = snapshot?.unitAgentIds;
  if (!Array.isArray(source) || source.length < count) return null;
  const identities = [];
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    const identity = String(source[index] || '');
    if (!identity || seen.has(identity)) return null;
    seen.add(identity);
    identities.push(identity);
  }
  return identities;
};

const buildUnitInterpolationMap = (previousSnapshot = null, currentSnapshot = null) => {
  const previousCount = normalizeCount(previousSnapshot?.units);
  const currentCount = normalizeCount(currentSnapshot?.units);
  const previousIds = resolveUnitIdentityList(previousSnapshot, previousCount);
  const currentIds = resolveUnitIdentityList(currentSnapshot, currentCount);
  if (!previousIds || !currentIds) return null;
  const previousIndexById = new Map(
    previousIds.map((identity, index) => [identity, index])
  );
  const previousIndexByCurrentIndex = new Int32Array(currentCount);
  previousIndexByCurrentIndex.fill(-1);
  let matchedCount = 0;
  currentIds.forEach((identity, index) => {
    const previousIndex = previousIndexById.get(identity);
    if (previousIndex === undefined) return;
    previousIndexByCurrentIndex[index] = previousIndex;
    matchedCount += 1;
  });
  return matchedCount > 0 ? previousIndexByCurrentIndex : null;
};

const canInterpolateMappedChannel = (previousChannel, currentChannel, targetChannel, indexMap) => (
  indexMap instanceof Int32Array
  && previousChannel?.data instanceof Float32Array
  && currentChannel?.data instanceof Float32Array
  && Math.max(1, Number(previousChannel?.stride) || 0) === targetChannel.stride
  && Math.max(1, Number(currentChannel?.stride) || 0) === targetChannel.stride
);

export const interpolateRadians = (from, to, alpha) => {
  const start = Number(from) || 0;
  const end = Number(to) || 0;
  const delta = ((((end - start) + Math.PI) % TAU) + TAU) % TAU - Math.PI;
  return start + (delta * alpha);
};

const interpolateUnits = (target, previous, current, alpha, previousIndexByCurrentIndex) => {
  const count = normalizeCount(current);
  const stride = target.stride;
  for (let index = 0; index < count; index += 1) {
    const previousIndex = Number(previousIndexByCurrentIndex?.[index]);
    if (!Number.isInteger(previousIndex) || previousIndex < 0) continue;
    const base = index * stride;
    const previousBase = previousIndex * stride;
    target.data[base + 0] = lerp(previous.data[previousBase + 0], current.data[base + 0], alpha);
    target.data[base + 1] = lerp(previous.data[previousBase + 1], current.data[base + 1], alpha);
    target.data[base + 2] = lerp(previous.data[previousBase + 2], current.data[base + 2], alpha);
    target.data[base + 4] = interpolateRadians(previous.data[previousBase + 4], current.data[base + 4], alpha);
    target.data[base + 6] = lerp(previous.data[previousBase + 6], current.data[base + 6], alpha);
  }
};

const interpolateSkillStates = (target, previous, current, alpha, previousIndexByCurrentIndex) => {
  const count = normalizeCount(current);
  const stride = target.stride;
  for (let index = 0; index < count; index += 1) {
    const previousIndex = Number(previousIndexByCurrentIndex?.[index]);
    if (!Number.isInteger(previousIndex) || previousIndex < 0) continue;
    const base = index * stride;
    const previousBase = previousIndex * stride;
    const sameAction = previous.data[previousBase + 0] === current.data[base + 0]
      && previous.data[previousBase + 1] === current.data[base + 1]
      && previous.data[previousBase + 2] === current.data[base + 2];
    if (sameAction) {
      target.data[base + 3] = lerp(previous.data[previousBase + 3], current.data[base + 3], alpha);
    }
  }
};

const interpolateBuildings = (target, previous, current, alpha) => {
  const count = normalizeCount(current);
  const stride = target.stride;
  for (let index = 0; index < count; index += 1) {
    const base = index * stride;
    target.data[base + 0] = lerp(previous.data[base + 0], current.data[base + 0], alpha);
    target.data[base + 1] = lerp(previous.data[base + 1], current.data[base + 1], alpha);
    target.data[base + 2] = lerp(previous.data[base + 2], current.data[base + 2], alpha);
    target.data[base + 3] = interpolateRadians(previous.data[base + 3], current.data[base + 3], alpha);
    target.data[base + 7] = lerp(previous.data[base + 7], current.data[base + 7], alpha);
  }
};

const interpolateParticles = (target, previous, current, alpha) => {
  const count = normalizeCount(current);
  const stride = target.stride;
  for (let index = 0; index < count; index += 1) {
    const base = index * stride;
    target.data[base + 0] = lerp(previous.data[base + 0], current.data[base + 0], alpha);
    target.data[base + 1] = lerp(previous.data[base + 1], current.data[base + 1], alpha);
    target.data[base + 2] = lerp(previous.data[base + 2], current.data[base + 2], alpha);
    target.data[base + 6] = lerp(previous.data[base + 6], current.data[base + 6], alpha);
  }
};

export const createBattleDisplaySnapshot = (schema = BattleSnapshotSchema) => createSnapshot(schema);

export const interpolateBattleSnapshots = ({
  previousSnapshot = null,
  currentSnapshot = null,
  alpha = 1,
  targetSnapshot = null
} = {}) => {
  if (!currentSnapshot) return { snapshot: null, active: false };
  const target = targetSnapshot || createSnapshot();
  const progress = clamp(Number(alpha) || 0, 0, 1);
  target.schemaVersion = currentSnapshot.schemaVersion || target.schemaVersion;
  const currentUnitCount = normalizeCount(currentSnapshot.units);
  target.unitAgentIds = Array.isArray(currentSnapshot.unitAgentIds)
    ? currentSnapshot.unitAgentIds.slice(0, currentUnitCount)
    : [];
  target.unitSquadIds = Array.isArray(currentSnapshot.unitSquadIds)
    ? currentSnapshot.unitSquadIds.slice(0, currentUnitCount)
    : [];
  CHANNEL_KEYS.forEach((key) => {
    copyCurrentChannel(target[key], currentSnapshot[key]);
  });

  let compatibleChannelCount = 0;
  const unitInterpolationMap = buildUnitInterpolationMap(previousSnapshot, currentSnapshot);
  const interpolateMapped = (key, fn) => {
    const previous = previousSnapshot?.[key];
    const current = currentSnapshot?.[key];
    const targetChannel = target[key];
    if (!canInterpolateMappedChannel(previous, current, targetChannel, unitInterpolationMap)) return;
    compatibleChannelCount += 1;
    fn(targetChannel, previous, current, progress, unitInterpolationMap);
  };
  const interpolate = (key, fn) => {
    const previous = previousSnapshot?.[key];
    const current = currentSnapshot?.[key];
    const targetChannel = target[key];
    if (!canInterpolateChannel(previous, current, targetChannel)) return;
    compatibleChannelCount += 1;
    fn(targetChannel, previous, current, progress);
  };
  interpolateMapped('units', interpolateUnits);
  interpolateMapped('skillStates', interpolateSkillStates);
  interpolate('buildings', interpolateBuildings);
  interpolate('projectiles', interpolateParticles);
  interpolate('effects', interpolateParticles);

  return {
    snapshot: target,
    active: compatibleChannelCount > 0 && progress < 1
  };
};
