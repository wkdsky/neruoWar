import { ensureKatexReady, normalizeFormulaSource, renderLatexWithKatex } from '../formula/katexRenderUtils';

const dispatchFormulaEditEvent = ({ getPos, node }) => {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent('sense-formula-edit', {
    detail: {
      pos: typeof getPos === 'function' ? getPos() : null,
      latex: String(node?.attrs?.formulaSource || '').trim(),
      displayMode: String(node?.attrs?.displayMode || 'inline').trim() || 'inline'
    }
  });
  window.dispatchEvent(event);
};

export const createFormulaNodeView = ({
  node,
  getPos
}) => {
  const isBlock = String(node?.attrs?.displayMode || '').trim() === 'block' || node.type.name === 'formulaBlock';
  const dom = document.createElement(isBlock ? 'div' : 'span');
  dom.className = isBlock
    ? 'sense-formula-placeholder sense-formula-block-node'
    : 'sense-formula-placeholder sense-formula-inline-node';
  dom.contentEditable = 'false';
  let currentNodeRef = node;

  const syncNode = (currentNode) => {
    currentNodeRef = currentNode;
    const formulaSource = normalizeFormulaSource(currentNode?.attrs?.formulaSource || '');
    const displayMode = String(currentNode?.attrs?.displayMode || (currentNode.type.name === 'formulaBlock' ? 'block' : 'inline')).trim() || 'inline';
    dom.setAttribute('data-formula-placeholder', 'true');
    dom.setAttribute('data-formula-source', formulaSource);
    dom.setAttribute('data-formula-display', displayMode);
    dom.setAttribute('title', formulaSource ? `公式源码：${formulaSource}` : '公式节点');
    dom.classList.toggle('is-block', displayMode === 'block');
    if (!formulaSource) {
      dom.textContent = '空公式';
      return;
    }
    const applyRender = () => {
      const rendered = renderLatexWithKatex(formulaSource, {
        displayMode: displayMode === 'block'
      });
      if (rendered.error) {
        dom.innerHTML = `<span class="sense-formula-error-badge">公式有误</span>`;
        dom.classList.add('is-error');
        return;
      }
      dom.classList.remove('is-error');
      dom.innerHTML = rendered.html || '';
    };
    if (window.katex?.renderToString) {
      applyRender();
      return;
    }
    dom.textContent = '正在渲染公式…';
    ensureKatexReady()
      .then(() => {
        applyRender();
      })
      .catch(() => {
        dom.innerHTML = '<span class="sense-formula-error-badge">公式引擎加载失败</span>';
        dom.classList.add('is-error');
      });
  };

  syncNode(node);

  const handleOpenEditor = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchFormulaEditEvent({ getPos, node: currentNodeRef });
  };

  dom.addEventListener('click', handleOpenEditor);

  return {
    dom,
    update: (updatedNode) => {
      if (updatedNode.type.name !== currentNodeRef.type.name) return false;
      syncNode(updatedNode);
      return true;
    },
    selectNode: () => {
      dom.classList.add('ProseMirror-selectednode');
    },
    deselectNode: () => {
      dom.classList.remove('ProseMirror-selectednode');
    },
    stopEvent: (event) => event.type === 'click' || event.type === 'mousedown',
    destroy: () => {
      dom.removeEventListener('click', handleOpenEditor);
    }
  };
};
