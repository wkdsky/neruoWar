export const cloneHiddenModule = (hiddenModule) => (
  hiddenModule && typeof hiddenModule === 'object' ? JSON.parse(JSON.stringify(hiddenModule)) : null
);

export const cloneTransmissionSkeleton = (transmissionSkeleton) => (
  transmissionSkeleton && typeof transmissionSkeleton === 'object'
    ? JSON.parse(JSON.stringify(transmissionSkeleton))
    : null
);

export const cloneGearMounts = (gearMounts = []) => (
  Array.isArray(gearMounts)
    ? gearMounts.map((mount) => (
      mount && typeof mount === 'object'
        ? {
          ...mount,
          ...(mount.axisBinding && typeof mount.axisBinding === 'object'
            ? { axisBinding: { ...mount.axisBinding } }
            : {})
        }
        : mount
    )).filter(Boolean)
    : []
);

export const clonePlainObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {}
);

export const cloneConnectors = (connectors = []) => (
  Array.isArray(connectors) ? connectors.map((connector) => (
    connector && typeof connector === 'object' ? { ...connector } : connector
  )) : []
);

export const normalizeString = (value, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

export const normalizeVector3 = (value = {}, fallback = { x: 0, y: 0, z: 0 }) => ({
  x: Number.isFinite(Number(value.x)) ? Number(value.x) : fallback.x,
  y: Number.isFinite(Number(value.y)) ? Number(value.y) : fallback.y,
  z: Number.isFinite(Number(value.z)) ? Number(value.z) : fallback.z
});

export const normalizeStringArray = (value = [], fallback = []) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : fallback
);
