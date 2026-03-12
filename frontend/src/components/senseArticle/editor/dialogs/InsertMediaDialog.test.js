import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import InsertMediaDialog from './InsertMediaDialog';

describe('InsertMediaDialog inline presentation', () => {
  it('keeps the panel open for inside clicks and closes on outside pointerdown', () => {
    const onClose = jest.fn();
    const anchorRef = { current: null };

    const { container } = render(
      <div>
        <div ref={(node) => { anchorRef.current = node; }} data-testid="anchor">toolbar cluster</div>
        <InsertMediaDialog
          open
          kind="image"
          onClose={onClose}
          onUpload={jest.fn()}
          onSubmit={jest.fn()}
          presentation="inline"
          anchorRef={anchorRef}
        />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: '粘贴 URL' }));
    const urlInput = screen.getByPlaceholderText('https://...');
    fireEvent.pointerDown(urlInput);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(anchorRef.current);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(container.ownerDocument.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps input focus when the parent rerenders while the dialog stays open', () => {
    const portalHost = document.createElement('div');
    document.body.appendChild(portalHost);

    const firstOnClose = jest.fn();
    const { rerender } = render(
      <InsertMediaDialog
        open
        kind="image"
        onClose={firstOnClose}
        onUpload={jest.fn()}
        onSubmit={jest.fn()}
        portalTarget={portalHost}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '粘贴 URL' }));
    const urlInput = screen.getByPlaceholderText('https://...');
    urlInput.focus();
    expect(document.activeElement).toBe(urlInput);

    rerender(
      <InsertMediaDialog
        open
        kind="image"
        onClose={jest.fn()}
        onUpload={jest.fn()}
        onSubmit={jest.fn()}
        portalTarget={portalHost}
      />
    );

    expect(document.activeElement).toBe(urlInput);
    portalHost.remove();
  });

  it('blocks inserting audio when the browser cannot play the selected format', async () => {
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (String(tagName).toLowerCase() === 'audio') {
        element.canPlayType = jest.fn((mimeType) => (mimeType === 'audio/flac' ? '' : 'probably'));
      }
      return element;
    });

    const onUpload = jest.fn();
    render(
      <InsertMediaDialog
        open
        kind="audio"
        onClose={jest.fn()}
        onUpload={onUpload}
        onSubmit={jest.fn()}
      />
    );

    const fileInput = screen.getByLabelText('选择文件');
    const file = new File(['fake-audio'], 'sample.flac', { type: 'audio/flac' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '插入媒体' }));

    expect(await screen.findByText('当前浏览器不支持该音频格式。建议使用 MP3、WAV 或 OGG；M4A 取决于具体编码。')).toBeTruthy();
    expect(onUpload).not.toHaveBeenCalled();
    document.createElement.mockRestore();
  });

  it('keeps uploaded relative media URLs unchanged in the saved payload', async () => {
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (String(tagName).toLowerCase() === 'audio') {
        element.canPlayType = jest.fn(() => 'probably');
      }
      return element;
    });

    const onSubmit = jest.fn();

    render(
      <InsertMediaDialog
        open
        kind="audio"
        onClose={jest.fn()}
        onUpload={jest.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '粘贴 URL' }));
    fireEvent.change(screen.getByPlaceholderText('https://...'), {
      target: {
        value: '/uploads/sense-article-media/example.wav'
      }
    });
    fireEvent.click(screen.getByRole('button', { name: '插入媒体' }));

    expect(await screen.findByDisplayValue('/uploads/sense-article-media/example.wav')).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      src: '/uploads/sense-article-media/example.wav'
    }));
    document.createElement.mockRestore();
  });
});
