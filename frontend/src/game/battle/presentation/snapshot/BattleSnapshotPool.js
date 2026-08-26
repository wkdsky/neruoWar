import BattleSnapshotSchema from './BattleSnapshotSchema';

const DEFAULT_CAPACITY = 16;
const GROWTH_FACTOR = 1.5;
const SNAPSHOT_BUFFER_COUNT = 2;
const DEV = process.env.NODE_ENV !== 'production';

const createChannel = (stride, capacity = DEFAULT_CAPACITY) => ({
  stride,
  count: 0,
  capacity,
  data: new Float32Array(stride * capacity)
});

const createSnapshot = (schema) => ({
  schemaVersion: schema.version,
  unitAgentIds: [],
  unitSquadIds: [],
  units: createChannel(schema.units.stride),
  skillStates: createChannel(schema.skillStates.stride),
  buildings: createChannel(schema.buildings.stride),
  projectiles: createChannel(schema.projectiles.stride),
  effects: createChannel(schema.effects.stride)
});

export default class BattleSnapshotPool {
  constructor(schema = BattleSnapshotSchema) {
    this.schema = schema;
    this.snapshots = Array.from(
      { length: SNAPSHOT_BUFFER_COUNT },
      () => createSnapshot(schema)
    );
    this.snapshotIndex = 0;
    this.snapshot = this.snapshots[this.snapshotIndex];
  }

  ensureCapacity(key, nextCount = 0) {
    const channel = this.snapshot[key];
    if (!channel) return null;
    if (nextCount <= channel.capacity) return channel;
    const oldCapacity = channel.capacity;
    let nextCapacity = Math.max(nextCount, DEFAULT_CAPACITY);
    while (nextCapacity <= channel.capacity) {
      nextCapacity = Math.max(nextCount, Math.ceil(nextCapacity * GROWTH_FACTOR));
    }
    channel.capacity = nextCapacity;
    channel.data = new Float32Array(channel.stride * channel.capacity);
    if (DEV) {
      console.info(`[BattleSnapshotPool] grow ${key}: ${oldCapacity} -> ${nextCapacity}`);
    }
    return channel;
  }

  acquire() {
    this.snapshotIndex = (this.snapshotIndex + 1) % this.snapshots.length;
    this.snapshot = this.snapshots[this.snapshotIndex];
    return this.snapshot;
  }

  release() {
    return this.snapshot;
  }
}
