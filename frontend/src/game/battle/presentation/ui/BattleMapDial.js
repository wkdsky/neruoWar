import React from 'react';

const DIAL_SIZE = 120;
const CX = 60;
const CY = 60;
const OUTER_R = 58;
const INNER_R = 31;

const polarToCartesian = (cx, cy, r, deg) => {
  const rad = (deg * Math.PI) / 180;
  return {
    x: cx + (r * Math.cos(rad)),
    y: cy + (r * Math.sin(rad))
  };
};

const buildRingSectorPath = (startDeg, endDeg) => {
  const outerStart = polarToCartesian(CX, CY, OUTER_R, startDeg);
  const outerEnd = polarToCartesian(CX, CY, OUTER_R, endDeg);
  const innerEnd = polarToCartesian(CX, CY, INNER_R, endDeg);
  const innerStart = polarToCartesian(CX, CY, INNER_R, startDeg);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_R} ${INNER_R} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    'Z'
  ].join(' ');
};

const RING_SECTORS = [
  { command: 'forward', startDeg: -135, endDeg: -45, label: '↑', lx: 60, ly: 15 },
  { command: 'right', startDeg: -45, endDeg: 45, label: '→', lx: 105, ly: 60 },
  { command: 'backward', startDeg: 45, endDeg: 135, label: '↓', lx: 60, ly: 105 },
  { command: 'left', startDeg: 135, endDeg: 225, label: '←', lx: 15, ly: 60 }
];

const CurvedArrow = ({ direction = 'ccw' }) => {
  const isCcw = direction === 'ccw';
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {isCcw ? (
        <g>
          <path d="M15.6 5.6C11.1 8.3 9.4 13.2 11.2 17.2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M8.6 16.3l3.6 2.9 1-4.4z" fill="currentColor" />
        </g>
      ) : (
        <g>
          <path d="M8.4 5.6c4.5 2.7 6.2 7.6 4.4 11.6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M15.4 16.3l-3.6 2.9-1-4.4z" fill="currentColor" />
        </g>
      )}
    </svg>
  );
};

const BattleMapDial = ({
  activeCommand = '',
  onHoverCommandChange
}) => {
  const bindHover = (command) => ({
    onMouseEnter: () => onHoverCommandChange?.(command),
    onMouseLeave: () => onHoverCommandChange?.(''),
    onFocus: () => onHoverCommandChange?.(command),
    onBlur: () => onHoverCommandChange?.('')
  });

  return (
    <div className="pve2-map-dial-wrap">
      <div className="pve2-map-dial" role="group" aria-label="战场视角圆盘">
        <svg className="pve2-map-dial-ring-svg" viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`} aria-hidden="true">
          {RING_SECTORS.map((row) => (
            <path
              key={`ring-sector-${row.command}`}
              d={buildRingSectorPath(row.startDeg, row.endDeg)}
              className={`pve2-map-dial-sector-path ${activeCommand === row.command ? 'active' : ''}`}
              onMouseEnter={() => onHoverCommandChange?.(row.command)}
              onMouseLeave={() => onHoverCommandChange?.('')}
            />
          ))}
          {[-135, -45, 45, 135].map((deg) => {
            const a = polarToCartesian(CX, CY, INNER_R, deg);
            const b = polarToCartesian(CX, CY, OUTER_R, deg);
            return (
              <line
                key={`ring-separator-${deg}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="pve2-map-dial-ring-separator"
              />
            );
          })}
          {RING_SECTORS.map((row) => (
            <text
              key={`ring-arrow-${row.command}`}
              x={row.lx}
              y={row.ly}
              className="pve2-map-dial-arrow-text"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {row.label}
            </text>
          ))}
        </svg>
        <div className="pve2-map-dial-core">
          <span className="pve2-map-dial-core-divider" />
          <button
            type="button"
            className={`pve2-map-dial-core-btn ccw ${activeCommand === 'rotate_ccw' ? 'active' : ''}`}
            aria-label="地图逆时针旋转"
            title="逆时针旋转"
            {...bindHover('rotate_ccw')}
          >
            <CurvedArrow direction="ccw" />
          </button>
          <button
            type="button"
            className={`pve2-map-dial-core-btn cw ${activeCommand === 'rotate_cw' ? 'active' : ''}`}
            aria-label="地图顺时针旋转"
            title="顺时针旋转"
            {...bindHover('rotate_cw')}
          >
            <CurvedArrow direction="cw" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default BattleMapDial;
