import React, { useEffect, useMemo, useRef, useState } from 'react';
import SenseArticleStateView from './SenseArticleStateView';

const buildOutlineTree = (items = []) => {
  const root = [];
  const stack = [];

  items.forEach((item, flatIndex) => {
    const node = {
      ...item,
      flatIndex,
      children: []
    };
    const level = Math.max(1, Number(item?.level) || 1);

    while (stack.length > 0 && Number(stack[stack.length - 1]?.level || 1) >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  });

  return root;
};

const collectExpandableIds = (nodes = []) => {
  const ids = [];
  nodes.forEach((node) => {
    if (Array.isArray(node?.children) && node.children.length > 0) {
      ids.push(node.headingId);
      ids.push(...collectExpandableIds(node.children));
    }
  });
  return ids;
};

const OutlineTreeNode = ({
  node,
  activeHeadingId = '',
  expandedIds,
  onToggle,
  onJump,
  renderActions = null
}) => {
  const hasChildren = Array.isArray(node?.children) && node.children.length > 0;
  const isExpanded = hasChildren ? expandedIds.has(node.headingId) : false;
  const actions = typeof renderActions === 'function' ? renderActions(node) : null;

  return (
    <div className={`sense-outline-tree-node level-${node.level || 1}${hasChildren ? ' has-children' : ''}${isExpanded ? ' expanded' : ' collapsed'}${activeHeadingId === node.headingId ? ' active' : ''}`}>
      <div className="sense-outline-tree-row">
        {hasChildren ? (
          <button
            type="button"
            className="sense-outline-tree-toggle"
            aria-label={isExpanded ? '收起下级目录' : '展开下级目录'}
            onClick={() => onToggle(node.headingId)}
          >
            {isExpanded ? '−' : '+'}
          </button>
        ) : <span className="sense-outline-tree-toggle-placeholder" aria-hidden="true" />}
        <button type="button" className="sense-outline-tree-link" onClick={() => onJump(node)}>
          <span>{node.title}</span>
        </button>
        {actions ? <div className="sense-outline-tree-row-actions">{actions}</div> : null}
      </div>
      {hasChildren && isExpanded ? (
        <div className="sense-outline-tree-children">
          {node.children.map((childNode) => (
            <OutlineTreeNode
              key={`${childNode.headingId}-${childNode.flatIndex}`}
              node={childNode}
              activeHeadingId={activeHeadingId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onJump={onJump}
              renderActions={renderActions}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const SenseArticleOutlineTree = ({
  items = [],
  activeHeadingId = '',
  onJump,
  renderActions = null,
  emptyTitle = '暂无目录项',
  emptyDescription = ''
}) => {
  const outlineTree = useMemo(() => buildOutlineTree(items), [items]);
  const [expandedIds, setExpandedIds] = useState([]);
  const hasInitializedStateRef = useRef(false);
  const treeRef = useRef(null);
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);

  useEffect(() => {
    const nextExpandableIds = collectExpandableIds(outlineTree);
    setExpandedIds((previousIds) => {
      if (!hasInitializedStateRef.current) {
        hasInitializedStateRef.current = true;
        return nextExpandableIds;
      }
      const previousIdSet = new Set(previousIds);
      return nextExpandableIds.filter((id) => previousIdSet.has(id));
    });
  }, [outlineTree]);

  useEffect(() => {
    if (!activeHeadingId) return;
    const activeLink = treeRef.current?.querySelector('.sense-outline-tree-node.active .sense-outline-tree-link');
    if (!activeLink) return;
    const scroller = treeRef.current?.closest('.sense-editor-outline-shell, .sense-reading-outline-card');
    if (!scroller) {
      activeLink.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth'
      });
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const nextTop = scroller.scrollTop + (linkRect.top - scrollerRect.top) - (scroller.clientHeight / 2) + (linkRect.height / 2);
    scroller.scrollTo({
      top: Math.max(0, nextTop),
      behavior: 'smooth'
    });
  }, [activeHeadingId]);

  const handleToggle = (headingId) => {
    if (!headingId) return;
    setExpandedIds((previousIds) => {
      const previousIdSet = new Set(previousIds);
      if (previousIdSet.has(headingId)) {
        return previousIds.filter((id) => id !== headingId);
      }
      return [...previousIds, headingId];
    });
  };

  if (!items.length) {
    return <SenseArticleStateView compact kind="empty" title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div ref={treeRef} className="sense-outline-tree" role="tree">
      {outlineTree.map((node) => (
        <OutlineTreeNode
          key={`${node.headingId}-${node.flatIndex}`}
          node={node}
          activeHeadingId={activeHeadingId}
          expandedIds={expandedIdSet}
          onToggle={handleToggle}
          onJump={onJump}
          renderActions={renderActions}
        />
      ))}
    </div>
  );
};

export default SenseArticleOutlineTree;
