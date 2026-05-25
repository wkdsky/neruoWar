const sameAxisPoint = (a, b) => !!a && !!b
  && Math.abs((a.x || 0) - (b.x || 0)) <= 0.001
  && Math.abs((a.y || 0) - (b.y || 0)) <= 0.001;

const sameAxisSegment = (a = [], b = []) => (
  Array.isArray(a)
  && Array.isArray(b)
  && a.length >= 2
  && b.length >= 2
  && (
    (sameAxisPoint(a[0], b[0]) && sameAxisPoint(a[1], b[1]))
    || (sameAxisPoint(a[0], b[1]) && sameAxisPoint(a[1], b[0]))
  )
);

const WALL_EDGE_ENDPOINTS = {
  north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
  south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
  west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
  east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
};

const getAbsoluteWallEdgeEndpoints = (cell, edge = 'north') => {
  const endpoints = WALL_EDGE_ENDPOINTS[edge] || WALL_EDGE_ENDPOINTS.north;
  return endpoints.map((point) => ({
    x: (Number(cell?.x) || 0) + point.x,
    y: (Number(cell?.y) || 0) + point.y
  }));
};

const findWallCandidatesForVertex = (vertex, z = 0) => {
  if (!vertex) return [];
  const seen = new Set();
  const candidates = [];
  for (let y = Math.floor(vertex.y) - 1; y <= Math.ceil(vertex.y) + 1; y += 1) {
    for (let x = Math.floor(vertex.x) - 1; x <= Math.ceil(vertex.x) + 1; x += 1) {
      Object.keys(WALL_EDGE_ENDPOINTS).forEach((edge) => {
        if (!getAbsoluteWallEdgeEndpoints({ x, y, z }, edge).some((point) => sameAxisPoint(point, vertex))) return;
        const physicalKey = `${x},${y},${z}:${edge}`;
        if (seen.has(physicalKey)) return;
        seen.add(physicalKey);
        candidates.push({ cell: { x, y, z }, edge });
      });
    }
  }
  return candidates;
};

const findWallCandidatesForSegment = (segment, z = 0) => {
  if (!Array.isArray(segment) || segment.length < 2) return [];
  const seen = new Set();
  const candidates = [];
  const xs = segment.map((point) => point.x);
  const ys = segment.map((point) => point.y);
  const minX = Math.floor(Math.min(...xs) - 1);
  const maxX = Math.ceil(Math.max(...xs) + 1);
  const minY = Math.floor(Math.min(...ys) - 1);
  const maxY = Math.ceil(Math.max(...ys) + 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      Object.keys(WALL_EDGE_ENDPOINTS).forEach((edge) => {
        if (!sameAxisSegment(getAbsoluteWallEdgeEndpoints({ x, y, z }, edge), segment)) return;
        const physicalKey = `${x},${y},${z}:${edge}`;
        if (seen.has(physicalKey)) return;
        seen.add(physicalKey);
        candidates.push({ cell: { x, y, z }, edge });
      });
    }
  }
  return candidates;
};

describe('vertical snap structural support', () => {
  it('allows diagonal corner-only wall via vertex matching (bug)', () => {
    const supportCell = { x: 0, y: 0, z: 0 };
    const vertex = { x: 0.5, y: 0.5 }; // NE corner of support south/top edge
    const vertexCandidates = findWallCandidatesForVertex(vertex, 1);
    const diagonal = vertexCandidates.find((item) => item.cell.x === 1 && item.cell.y === 1);
    expect(diagonal).toBeTruthy();
  });

  it('rejects diagonal placement when requiring full edge segment overlap', () => {
    const supportCell = { x: 0, y: 0, z: 0 };
    const segment = getAbsoluteWallEdgeEndpoints(supportCell, 'south');
    const segmentCandidates = findWallCandidatesForSegment(segment, 1);
    const diagonal = segmentCandidates.find((item) => item.cell.x === 1 && item.cell.y === 1);
    expect(diagonal).toBeFalsy();
  });
});
