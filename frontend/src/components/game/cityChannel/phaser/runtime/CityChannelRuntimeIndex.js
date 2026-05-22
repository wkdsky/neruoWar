import {
  createCellKey,
  createWallKey,
  wallEdgeToRotation
} from '../../cityChannelSchema';

export class CityChannelRuntimeIndex {
  constructor() {
    this.cellIndex = new Map();
    this.edgeIndex = new Map();
    this.placementIndex = new Map();
  }

  rebuild(mapData = {}) {
    this.cellIndex.clear();
    this.edgeIndex.clear();
    this.placementIndex.clear();

    Object.values(mapData.tiles || {}).forEach((tile) => {
      const cellKey = createCellKey(tile.x, tile.y, tile.z);
      const placementId = `tile:${cellKey}`;
      const info = {
        id: placementId,
        kind: 'tile',
        cellKey,
        x: tile.x,
        y: tile.y,
        z: tile.z,
        panelType: tile.panelType,
        rotation: tile.rotation || 0,
        flipped: false,
        tile
      };
      this.placementIndex.set(placementId, info);
      this.cellIndex.set(cellKey, [...(this.cellIndex.get(cellKey) || []), placementId]);
    });

    Object.values(mapData.walls || {}).forEach((wall) => {
      const cellKey = createCellKey(wall.x, wall.y, wall.z);
      const wallKey = createWallKey(wall.x, wall.y, wall.z, wall.edge);
      const placementId = `wall:${wallKey}`;
      const info = {
        id: placementId,
        kind: 'wall',
        cellKey,
        wallKey,
        x: wall.x,
        y: wall.y,
        z: wall.z,
        edge: wall.edge,
        panelType: wall.panelType,
        rotation: wallEdgeToRotation(wall.edge),
        flipped: false,
        wall
      };
      this.placementIndex.set(placementId, info);
      this.edgeIndex.set(wallKey, [...(this.edgeIndex.get(wallKey) || []), placementId]);
      this.cellIndex.set(cellKey, [...(this.cellIndex.get(cellKey) || []), placementId]);
    });
  }

  getAtCell(cellOrKey) {
    const key = typeof cellOrKey === 'string'
      ? cellOrKey
      : createCellKey(cellOrKey.x, cellOrKey.y, cellOrKey.z);
    return (this.cellIndex.get(key) || [])
      .map((id) => this.placementIndex.get(id))
      .filter(Boolean);
  }

  getAtEdge(wallLikeOrKey) {
    const key = typeof wallLikeOrKey === 'string'
      ? wallLikeOrKey
      : createWallKey(wallLikeOrKey.x, wallLikeOrKey.y, wallLikeOrKey.z, wallLikeOrKey.edge);
    return (this.edgeIndex.get(key) || [])
      .map((id) => this.placementIndex.get(id))
      .filter(Boolean);
  }

  getPlacement(id) {
    return this.placementIndex.get(id) || null;
  }

  get count() {
    return this.placementIndex.size;
  }
}

export default CityChannelRuntimeIndex;
