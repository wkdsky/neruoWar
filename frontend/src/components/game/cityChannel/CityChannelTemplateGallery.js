import React from 'react';
import { Box, FilePlus2, Layers, PencilLine, Sparkles, Users } from 'lucide-react';
import {
  CITY_CHANNEL_TEMPLATE_GROUPS,
  describeCityChannelMap,
  readCityChannelDraft,
  readCityChannelUserTemplates
} from './cityChannelTemplates';
import './CityChannelTemplateGallery.css';

const groupIconByKey = {
  create: FilePlus2,
  draft: PencilLine,
  user: PencilLine,
  official: Sparkles,
  shared: Users
};

const TemplateCard = ({ template, onOpen }) => {
  const mapData = template.mapData || template.createMapData?.();
  const meta = mapData ? describeCityChannelMap(mapData) : null;
  const disabled = template.disabled || !mapData;

  return (
    <article className={`city-channel-template-card ${disabled ? 'is-disabled' : ''}`}>
      <div className="city-channel-template-card__visual" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="city-channel-template-card__body">
        <div className="city-channel-template-card__head">
          <h4>{template.name}</h4>
          <span className={meta?.verified ? 'is-verified' : 'is-unverified'}>
            {meta?.verified ? '白通路已验证' : '未验证'}
          </span>
        </div>
        <p>{template.description}</p>
        <div className="city-channel-template-card__meta">
          <span>
            <Box size={14} />
            {meta?.sizeLabel || '未知尺寸'}
          </span>
          <span>
            <Layers size={14} />
            {meta?.layersLabel || '未知层数'}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-small city-channel-template-card__action"
        disabled={disabled}
        onClick={() => onOpen({
          id: template.id,
          name: template.name,
          source: template.source,
          mapData
        })}
      >
        {template.actionLabel || '编辑'}
      </button>
    </article>
  );
};

const TemplateGroup = ({ group, onOpen }) => {
  const Icon = groupIconByKey[group.key] || Sparkles;
  return (
    <section className="city-channel-template-section">
      <header className="city-channel-template-section__head">
        <div>
          <Icon size={18} />
          <h3>{group.title}</h3>
        </div>
        <p>{group.description}</p>
      </header>
      <div className="city-channel-template-grid">
        {group.templates.map((template) => (
          <TemplateCard key={template.id} template={template} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
};

const CityChannelTemplateGallery = ({ onOpenTemplate, refreshKey = 0 }) => {
  const draft = readCityChannelDraft();
  const userTemplates = readCityChannelUserTemplates();
  const draftGroup = {
    key: 'draft',
    title: '我的草稿',
    description: draft ? '继续编辑浏览器中保存的本地草稿。' : '当前浏览器还没有保存过草稿。',
    templates: draft
      ? [draft]
      : [{
        id: 'empty-draft',
        name: '暂无本地草稿',
        description: '在沉浸式编辑器中保存后，这里会出现“继续编辑草稿”。',
        actionLabel: '暂无草稿',
        source: 'draft',
        disabled: true,
        mapData: null
      }]
  };
  const userTemplateGroup = {
    key: 'user',
    title: '我的模板库',
    description: userTemplates.length > 0 ? '从官方或玩家模板另存后的个人模板。' : '从官方推荐或玩家分享模板另存后会出现在这里。',
    templates: userTemplates.length > 0
      ? userTemplates
      : [{
        id: 'empty-user-template',
        name: '暂无我的模板',
        description: '使用官方推荐或玩家分享模板并保存后，会自动另存到这里。',
        actionLabel: '暂无模板',
        source: 'user',
        disabled: true,
        mapData: null
      }]
  };
  const [createGroup, ...restGroups] = CITY_CHANNEL_TEMPLATE_GROUPS;
  const groups = [createGroup, draftGroup, userTemplateGroup, ...restGroups];
  void refreshKey;

  return (
    <div className="city-channel-template-gallery">
      {groups.map((group) => (
        <TemplateGroup key={group.key} group={group} onOpen={onOpenTemplate} />
      ))}
    </div>
  );
};

export default CityChannelTemplateGallery;
