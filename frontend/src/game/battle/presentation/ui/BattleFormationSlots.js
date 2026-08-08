import React, { useMemo, useRef, useState } from 'react';

const MAX_FORMATION_SLOTS = 9;

const normalizeFormations = (formations = []) => (
  (Array.isArray(formations) ? formations : [])
    .filter((formation) => formation && formation.legal !== false)
    .slice(0, MAX_FORMATION_SLOTS)
    .map((formation, index) => ({
      ...formation,
      formationId: String(formation?.formationId || formation?.id || `formation_${index}`).trim()
    }))
    .filter((formation) => formation.formationId)
);

const FormationPreview = ({ formation }) => {
  const points = useMemo(() => {
    const placements = Array.isArray(formation?.placements) ? formation.placements : [];
    if (placements.length <= 0) return [];
    const xs = placements.map((placement) => Number(placement?.x) || 0);
    const ys = placements.map((placement) => Number(placement?.y) || 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return placements.slice(0, 25).map((placement, index) => ({
      key: `${formation.formationId}-point-${index}`,
      left: `${8 + (((Number(placement?.x) || 0) - minX) / width) * 84}%`,
      top: `${8 + (((Number(placement?.y) || 0) - minY) / height) * 84}%`
    }));
  }, [formation]);

  return (
    <span className="pve2-formation-slot-preview" aria-hidden="true">
      {points.map((point) => <i key={point.key} style={{ left: point.left, top: point.top }} />)}
    </span>
  );
};

const BattleFormationSlots = ({
  formations = [],
  activeFormationId = '',
  editable = false,
  disabled = false,
  onPick,
  onReorder
}) => {
  const normalized = useMemo(() => normalizeFormations(formations), [formations]);
  const [dragIndex, setDragIndex] = useState(-1);
  const suppressClickRef = useRef(false);

  const moveFormation = (sourceIndex, targetIndex) => {
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...normalized];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    onReorder?.(next);
  };

  if (normalized.length <= 0) return null;

  return (
    <section
      className={`pve2-formation-slots ${editable ? 'is-editable' : ''}`}
      aria-label="阵型快捷栏"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="pve2-formation-slot-grid"
      >
        {normalized.map((formation, index) => {
          const formationId = formation.formationId;
          const active = formationId === String(activeFormationId || '').trim();
          return (
            <button
              key={formationId}
              type="button"
              className={`pve2-formation-slot ${active ? 'is-active' : ''} ${dragIndex === index ? 'is-dragging' : ''}`}
              draggable={editable && !disabled}
              disabled={disabled}
              title={`${index + 1} · ${formation.name || `阵型${index + 1}`}`}
              aria-label={`${index + 1} · ${formation.name || `阵型${index + 1}`}`}
              aria-pressed={active}
              aria-grabbed={dragIndex === index}
              onDragStart={(event) => {
                if (!editable || disabled) return;
                suppressClickRef.current = false;
                setDragIndex(index);
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                }
              }}
              onDragOver={(event) => {
                if (!editable || disabled) return;
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                if (!editable || disabled) return;
                event.preventDefault();
                const sourceIndex = Number(event.dataTransfer?.getData?.('text/plain'));
                moveFormation(Number.isFinite(sourceIndex) ? sourceIndex : dragIndex, index);
                setDragIndex(-1);
                suppressClickRef.current = true;
                setTimeout(() => {
                  suppressClickRef.current = false;
                }, 0);
              }}
              onDragEnd={() => setDragIndex(-1)}
              onClick={() => {
                if (suppressClickRef.current) return;
                onPick?.(formation, index);
              }}
            >
              <FormationPreview formation={formation} />
              <span className="pve2-formation-slot-hotkey">{index + 1}</span>
              <em>{formation.name || `阵型${index + 1}`}</em>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export { MAX_FORMATION_SLOTS, normalizeFormations };
export default BattleFormationSlots;
