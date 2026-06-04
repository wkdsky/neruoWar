import React, { Suspense, lazy, useState } from 'react';
import { Castle } from 'lucide-react';
import CityChannelTemplateGallery from './cityChannel/CityChannelTemplateGallery';
import './CityWorkshopPage.css';

const CityChannelEditor = lazy(() => import('./cityChannel/CityChannelEditor'));

const CityWorkshopPage = () => {
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);

  const handleExitEditor = () => {
    setEditingTemplate(null);
    setGalleryRefreshKey((current) => current + 1);
  };

  return (
    <div className="city-workshop-page">
      <header className="city-workshop-hero">
        <div className="city-workshop-hero__icon">
          <Castle size={26} />
        </div>
        <div>
          <h2>城内工坊</h2>
          <p>选择模板、编辑草稿，或创建新的城内通道场景</p>
        </div>
      </header>

      <CityChannelTemplateGallery
        refreshKey={galleryRefreshKey}
        onOpenTemplate={setEditingTemplate}
      />

      {editingTemplate ? (
        <Suspense fallback={<div className="city-workshop-editor-loading">正在加载编辑器...</div>}>
          <CityChannelEditor
            initialMapData={editingTemplate.mapData}
            templateId={editingTemplate.id}
            templateName={editingTemplate.name}
            templateSource={editingTemplate.source}
            onExit={handleExitEditor}
          />
        </Suspense>
      ) : null}
    </div>
  );
};

export default CityWorkshopPage;
