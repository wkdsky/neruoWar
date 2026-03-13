import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import InsertLinkDialog from './InsertLinkDialog';

describe('InsertLinkDialog', () => {
  it('shows only saved active media assets in internal media reference mode', () => {
    const onSubmit = jest.fn();

    render(
      <InsertLinkDialog
        open
        mode="media"
        initialValue={{ displayText: '' }}
        onClose={jest.fn()}
        onSubmit={onSubmit}
        onSearchReferences={jest.fn()}
        mediaLibrary={{
          referencedAssets: [
            { _id: 'img-1', kind: 'image', originalName: 'saved-image.png', url: '/uploads/sense-article-media/saved-image.png', status: 'active', isTemporary: false },
            { _id: 'aud-1', kind: 'audio', originalName: 'saved-audio.mp3', url: '/uploads/sense-article-media/saved-audio.mp3', status: 'active', isTemporary: false }
          ],
          recentAssets: [
            { _id: 'img-1', kind: 'image', originalName: 'saved-image.png', url: '/uploads/sense-article-media/saved-image.png', status: 'active', isTemporary: false },
            { _id: 'img-2', kind: 'image', originalName: 'temp-image.png', url: '/uploads/sense-article-media/temp-image.png', status: 'uploaded', isTemporary: true },
            { _id: 'vid-1', kind: 'video', originalName: 'orphan-video.mp4', url: '/uploads/sense-article-media/orphan-video.mp4', status: 'orphan_candidate', isTemporary: false }
          ]
        }}
      />
    );

    expect(screen.getByText('附件1（图片） saved-image.png')).toBeTruthy();
    expect(screen.queryByText('temp-image.png')).toBeNull();
    expect(screen.queryByText('orphan-video.mp4')).toBeNull();

    fireEvent.click(screen.getByText('音频'));
    fireEvent.click(screen.getByText('附件2（音频） saved-audio.mp3'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'media',
      href: '#',
      displayText: '附件2'
    }));
  });

  it('keeps input focus and value when parent rerenders while the dialog stays open', () => {
    const portalHost = document.createElement('div');
    document.body.appendChild(portalHost);

    const { rerender } = render(
      <InsertLinkDialog
        open
        mode="external"
        initialValue={{ href: '', displayText: '' }}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        onSearchReferences={jest.fn()}
        portalTarget={portalHost}
        autoFocusTarget="dialog"
      />
    );

    const displayInput = screen.getByPlaceholderText('默认使用 URL');
    fireEvent.change(displayInput, { target: { value: '外链引用文字' } });
    displayInput.focus();
    expect(document.activeElement).toBe(displayInput);

    rerender(
      <InsertLinkDialog
        open
        mode="external"
        initialValue={{ href: 'https://example.com', displayText: '会被忽略的新初始值' }}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        onSearchReferences={jest.fn()}
        portalTarget={portalHost}
        autoFocusTarget="dialog"
      />
    );

    expect(screen.getByDisplayValue('外链引用文字')).toBeTruthy();
    expect(document.activeElement).toBe(displayInput);
    portalHost.remove();
  });
});
