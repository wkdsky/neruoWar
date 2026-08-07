import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Ban,
  CircleDot,
  Crosshair,
  Flame,
  Gauge,
  HeartPulse,
  Layers,
  Move,
  Orbit,
  Radio,
  RotateCw,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sword,
  Swords,
  Target,
  Waves,
  Wind,
  Zap,
  Rocket
} from 'lucide-react';
import './SkillTreePanel.css';
import { SKILL_TREE_CATALOG } from './skillTreeData';

const SKILL_ICONS = Object.freeze({
  ArrowUpRight,
  Ban,
  CircleDot,
  Crosshair,
  Flame,
  Gauge,
  HeartPulse,
  Layers,
  Move,
  Orbit,
  Radio,
  RotateCw,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sword,
  Swords,
  Target,
  Waves,
  Wind,
  Zap,
  Rocket
});

const TREE_LEVEL_Y = Object.freeze({ 0: 12, 1: 36, 2: 60, 3: 84 });

const getTreeRootSkill = (tree) => tree?.skills?.find((skill) => skill.tier === 0) || tree?.skills?.[0] || null;

const getSkillById = (skills = []) => new Map(skills.map((skill) => [skill.id, skill]));

const getSkillCoordinates = (skill) => ({
  x: skill.tier === 0 ? 50 : ((skill.column - 0.5) / 3) * 100,
  y: TREE_LEVEL_Y[skill.tier] || TREE_LEVEL_Y[0]
});

const SkillIcon = ({ name, size = 20, strokeWidth = 1.8 }) => {
  const Icon = SKILL_ICONS[name] || Sparkles;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
};

const SkillNode = ({ skill, selected, onSelect }) => (
  <button
    type="button"
    className={`skill-tree-node ${selected ? 'is-selected' : ''} ${skill.tier === 0 ? 'is-core' : ''} ${skill.tier >= 3 ? 'is-terminal' : ''} ${skill.tier > 0 && skill.tier < 3 ? 'is-route' : ''}`}
    onClick={() => onSelect(skill.id)}
    aria-pressed={selected}
    aria-label={`${skill.name}，查看技能详情`}
  >
    <span className="skill-tree-node-icon">
      <SkillIcon name={skill.icon} size={22} />
    </span>
    <span className="skill-tree-node-copy">
      <strong>{skill.name}</strong>
      <small>{skill.power}</small>
    </span>
    <span className="skill-tree-node-state">
      {skill.tier === 0 ? '核心节点' : (skill.tier >= 3 ? '终式节点' : '路线节点')}
    </span>
  </button>
);

const SkillTreePanel = () => {
  const [activeTreeId, setActiveTreeId] = useState('melee');
  const [selectedSkillId, setSelectedSkillId] = useState('melee_war_form');

  const activeTree = useMemo(
    () => SKILL_TREE_CATALOG.find((tree) => tree.id === activeTreeId) || SKILL_TREE_CATALOG[0],
    [activeTreeId]
  );
  const activeSkillMap = useMemo(() => getSkillById(activeTree.skills), [activeTree]);
  const selectedSkill = activeSkillMap.get(selectedSkillId) || getTreeRootSkill(activeTree);

  const connections = useMemo(() => activeTree.skills.flatMap((skill) => (
    skill.prerequisites.map((prerequisiteId) => {
      const parent = activeSkillMap.get(prerequisiteId);
      if (!parent) return null;
      const parentPoint = getSkillCoordinates(parent);
      const childPoint = getSkillCoordinates(skill);
      return {
        id: `${prerequisiteId}-${skill.id}`,
        x1: parentPoint.x,
        y1: parentPoint.y,
        x2: childPoint.x,
        y2: childPoint.y
      };
    }).filter(Boolean)
  )), [activeSkillMap, activeTree.skills]);

  const handleTreeChange = (treeId) => {
    const nextTree = SKILL_TREE_CATALOG.find((tree) => tree.id === treeId) || SKILL_TREE_CATALOG[0];
    setActiveTreeId(nextTree.id);
    setSelectedSkillId(getTreeRootSkill(nextTree)?.id || nextTree.skills[0]?.id || '');
  };

  return (
    <section
      className="skill-tree-panel"
      style={{ '--skill-tree-color': activeTree.color, '--skill-tree-soft-color': activeTree.softColor }}
    >
      <header className="skill-tree-panel-header">
        <div>
          <div className="skill-tree-eyebrow">TACTICAL DOCTRINE · 技能系统</div>
          <h3>部队技能树</h3>
          <p>技能树用于展示部队可选的战术路线；技能本身不绑定某个具体兵种。</p>
        </div>
        <div className="skill-tree-mode-card">
          <span>系统状态</span>
          <strong>只读展示</strong>
          <small>技能选择请在训练营部队技能栏完成</small>
        </div>
      </header>

      <div className="skill-tree-selector" role="tablist" aria-label="技能树类型">
        {SKILL_TREE_CATALOG.map((tree) => {
          return (
            <button
              key={tree.id}
              type="button"
              role="tab"
              aria-selected={activeTree.id === tree.id}
              className={`skill-tree-selector-button ${activeTree.id === tree.id ? 'is-active' : ''}`}
              style={{ '--tree-selector-color': tree.color, '--tree-selector-soft-color': tree.softColor }}
              onClick={() => handleTreeChange(tree.id)}
            >
              <span className="skill-tree-selector-icon"><SkillIcon name={tree.id === 'melee' ? 'Swords' : (tree.id === 'ranged' ? 'Crosshair' : 'Radio')} size={22} /></span>
              <span>
                <strong>{tree.name}</strong>
                <small>{`${tree.codename} · ${tree.skills.length} 项技能`}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="skill-tree-workspace">
        <div className="skill-tree-map-card">
          <div className="skill-tree-map-header">
            <div>
              <span className="skill-tree-map-kicker">{activeTree.codename}</span>
              <h4>{activeTree.name}</h4>
            </div>
            <span className="skill-tree-map-hint">上方核心 · 下方三路终式</span>
          </div>
          <p className="skill-tree-map-description">{activeTree.description}</p>
          <div className="skill-tree-map-scroll">
            <div className="skill-tree-map">
              <svg className="skill-tree-connectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {connections.map((connection) => (
                  <line
                    key={connection.id}
                    className={`skill-tree-connector ${connection.active ? 'is-active' : ''}`}
                    x1={connection.x1}
                    y1={connection.y1}
                    x2={connection.x2}
                    y2={connection.y2}
                  />
                ))}
              </svg>
              {[0, 1, 2, 3].map((tier) => (
                <div key={`tier-${tier}`} className={`skill-tree-level skill-tree-level-${tier}`}>
                  {activeTree.skills.filter((skill) => skill.tier === tier).map((skill) => (
                    <SkillNode
                      key={skill.id}
                      skill={skill}
                      selected={selectedSkill?.id === skill.id}
                      onSelect={setSelectedSkillId}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="skill-tree-legend">
            <span><i className="is-core" />核心</span>
            <span><i className="is-route" />路线</span>
            <span><i className="is-terminal" />终式</span>
          </div>
        </div>

        <aside className="skill-tree-details">
          {selectedSkill ? (
            <>
              <div className="skill-tree-detail-head">
                <span className="skill-tree-detail-icon"><SkillIcon name={selectedSkill.icon} size={30} /></span>
                <div>
                  <span>{`${activeTree.categoryLabel} · T${selectedSkill.tier + 1}`}</span>
                  <h4>{selectedSkill.name}</h4>
                  <small>{selectedSkill.subtitle}</small>
                </div>
              </div>
              <div className="skill-tree-detail-state">展示节点</div>
              <div className="skill-tree-stat-grid">
                <div><span>{selectedSkill.powerLabel}</span><strong>{selectedSkill.power}</strong></div>
                <div><span>冷却</span><strong>{selectedSkill.cooldown}</strong></div>
                <div><span>范围</span><strong>{selectedSkill.range}</strong></div>
                <div><span>持续</span><strong>{selectedSkill.duration}</strong></div>
              </div>
              <div className="skill-tree-detail-section">
                <span className="skill-tree-section-label">战术说明</span>
                <p>{selectedSkill.description}</p>
              </div>
              <div className="skill-tree-detail-section skill-tree-effect-box">
                <span className="skill-tree-section-label">实际效果</span>
                <p>{selectedSkill.effect}</p>
              </div>
              <div className="skill-tree-tag-list">
                {selectedSkill.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              {selectedSkill.prerequisites.length > 0 ? (
                <div className="skill-tree-prerequisite">
                  <span className="skill-tree-section-label">前置技能</span>
                  <p>{selectedSkill.prerequisites.map((id) => activeSkillMap.get(id)?.name || id).join(' · ')}</p>
                </div>
              ) : null}
              <div className="skill-tree-detail-actions">
                <span className="skill-tree-detail-hint">点击任意节点查看，训练营中可直接配置任意路线技能。</span>
              </div>
            </>
          ) : (
            <div className="skill-tree-empty-detail">选择一个技能查看详情。</div>
          )}
        </aside>
      </div>
    </section>
  );
};

export default SkillTreePanel;
