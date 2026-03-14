const fs = require('fs');
const path = require('path');

const ROOT_TAG_PREFIX = 'root:';
const MARKER = 'global_knowledge_forest_v1';

const uniq = (list = []) => Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));

const stableSortStrings = (list = []) => [...(Array.isArray(list) ? list : [])].sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));

class GlobalKnowledgeForestBuilder {
  constructor({ roots = [], aspects = {} } = {}) {
    this.roots = Array.isArray(roots) ? roots : [];
    this.aspectMap = aspects && typeof aspects === 'object' ? aspects : {};

    this.titleCounter = 1;
    this.senseCounter = 1;

    this.titles = [];
    this.senses = [];
    this.relations = [];
    this.chains = [];

    this.titleByName = new Map();
    this.senseByKey = new Map();
    this.senseById = new Map();
    this.containsKeys = new Set();
    this.extendsKeys = new Set();
  }

  nextTitleId() {
    const id = `gkf_t${String(this.titleCounter).padStart(5, '0')}`;
    this.titleCounter += 1;
    return id;
  }

  nextSenseId() {
    const id = `gkf_s${String(this.senseCounter).padStart(6, '0')}`;
    this.senseCounter += 1;
    return id;
  }

  ensureTitle(name) {
    const safeName = String(name || '').trim();
    if (!safeName) throw new Error('title name is required');
    if (this.titleByName.has(safeName)) return this.titleByName.get(safeName);

    const title = {
      titleId: this.nextTitleId(),
      name: safeName,
      marker: MARKER
    };
    this.titles.push(title);
    this.titleByName.set(safeName, title);
    return title;
  }

  ensureSense({
    titleName,
    senseLabel,
    summary,
    rootKey,
    tags = [],
    aliases = [],
    order = 0,
    status = 'active'
  }) {
    const title = this.ensureTitle(titleName);
    const safeSenseLabel = String(senseLabel || titleName || '').trim();
    const key = `${title.titleId}::${safeSenseLabel}`;
    if (this.senseByKey.has(key)) {
      const existing = this.senseByKey.get(key);
      existing.tags = uniq([...(existing.tags || []), ...tags, `${ROOT_TAG_PREFIX}${rootKey}`]);
      existing.aliases = uniq([...(existing.aliases || []), ...aliases]);
      return existing;
    }

    const sense = {
      senseId: this.nextSenseId(),
      titleId: title.titleId,
      titleName: title.name,
      senseLabel: safeSenseLabel,
      summary: String(summary || '').trim(),
      order: Number.isFinite(Number(order)) ? Number(order) : 0,
      status,
      aliases: uniq(aliases),
      tags: uniq([...(tags || []), `${ROOT_TAG_PREFIX}${rootKey}`]),
      rootKey,
      marker: MARKER
    };

    this.senses.push(sense);
    this.senseByKey.set(key, sense);
    this.senseById.set(sense.senseId, sense);
    return sense;
  }

  connect(sourceSenseId, targetSenseId, relationType) {
    const safeSource = String(sourceSenseId || '').trim();
    const safeTarget = String(targetSenseId || '').trim();
    const safeType = relationType === 'contains' ? 'contains' : (relationType === 'extends' ? 'extends' : '');
    if (!safeSource || !safeTarget || !safeType || safeSource === safeTarget) return;
    const key = `${safeSource}|${safeType}|${safeTarget}`;
    if ((safeType === 'contains' && this.containsKeys.has(key)) || (safeType === 'extends' && this.extendsKeys.has(key))) {
      return;
    }
    if (safeType === 'contains') this.containsKeys.add(key);
    if (safeType === 'extends') this.extendsKeys.add(key);
    this.relations.push({
      sourceSenseId: safeSource,
      targetSenseId: safeTarget,
      relationType: safeType,
      marker: MARKER
    });
  }

  connectContains(parentSense, childSense, { mirrorExtends = true } = {}) {
    this.connect(parentSense.senseId, childSense.senseId, 'contains');
    if (mirrorExtends) {
      this.connect(childSense.senseId, parentSense.senseId, 'extends');
    }
  }

  createRootSenses() {
    this.rootSenseByKey = new Map();
    this.roots.forEach((root) => {
      const sense = this.ensureSense({
        titleName: root.name,
        senseLabel: root.name,
        summary: `${root.name}是全球通用百科知识森林中的根方向，用于容纳该领域下的标题容器与释义网络。`,
        rootKey: root.key,
        tags: ['layer:root', 'kind:root']
      });
      this.rootSenseByKey.set(root.key, sense);
    });
  }

  getRootSense(rootKey) {
    const sense = this.rootSenseByKey?.get(rootKey);
    if (!sense) throw new Error(`missing root sense for ${rootKey}`);
    return sense;
  }

  createSummary({ title, parentTitle, rootName, kind = 'concept', aspect = '' }) {
    const safeTitle = String(title || '').trim();
    const safeParent = String(parentTitle || '').trim();
    const safeRoot = String(rootName || '').trim();
    const safeAspect = String(aspect || '').trim();

    if (kind === 'root') {
      return `${safeTitle}是全球通用百科知识森林中的根方向，用于组织相关知识释义。`;
    }
    if (kind === 'leaf' && safeAspect) {
      return `${safeTitle}是${safeParent}下围绕“${safeAspect}”展开的百科专题节点，属于${safeRoot}方向。`;
    }
    if (kind === 'branch') {
      return `${safeTitle}是${safeParent}下的分支类别，用于组织${safeRoot}方向中的相关概念与对象。`;
    }
    if (kind === 'topic') {
      return `${safeTitle}是${safeParent}下的具体专题概念，属于${safeRoot}方向的可浏览节点。`;
    }
    return `${safeTitle}是${safeParent}下的百科概念节点，属于${safeRoot}方向。`;
  }

  addManualChain({ rootKey, nodes = [], tags = [] }) {
    const rootSense = this.getRootSense(rootKey);
    const rootName = this.roots.find((item) => item.key === rootKey)?.name || rootKey;
    const chainSenses = [rootSense];
    let parent = rootSense;

    (Array.isArray(nodes) ? nodes : []).forEach((nodeName, index) => {
      const title = String(nodeName || '').trim();
      if (!title) return;
      const sense = this.ensureSense({
        titleName: title,
        senseLabel: title,
        summary: this.createSummary({
          title,
          parentTitle: parent.titleName,
          rootName,
          kind: index === (nodes.length - 1) ? 'leaf' : 'topic'
        }),
        rootKey,
        tags: uniq([...tags, `depth:${index + 1}`])
      });
      this.connectContains(parent, sense, { mirrorExtends: true });
      parent = sense;
      chainSenses.push(sense);
    });

    if (chainSenses.length >= 7) {
      this.chains.push({
        rootKey,
        titles: chainSenses.map((item) => item.titleName),
        senseIds: chainSenses.map((item) => item.senseId)
      });
    }
    return chainSenses;
  }

  addClusterTree({ rootKey, cluster, aspectKey }) {
    const rootSense = this.getRootSense(rootKey);
    const rootName = this.roots.find((item) => item.key === rootKey)?.name || rootKey;
    const aspects = this.aspectMap[aspectKey] || [];
    if (!Array.isArray(cluster?.prefix) || cluster.prefix.length !== 3) {
      throw new Error(`invalid cluster prefix for ${rootKey}`);
    }

    let parent = rootSense;
    const prefixSenses = [];
    cluster.prefix.forEach((name, index) => {
      const sense = this.ensureSense({
        titleName: name,
        senseLabel: name,
        summary: this.createSummary({
          title: name,
          parentTitle: parent.titleName,
          rootName,
          kind: index === cluster.prefix.length - 1 ? 'branch' : 'concept'
        }),
        rootKey,
        tags: [`cluster:${cluster.id}`, `layer:prefix_${index + 1}`]
      });
      this.connectContains(parent, sense, { mirrorExtends: true });
      parent = sense;
      prefixSenses.push(sense);
    });

    Object.entries(cluster.branches || {}).forEach(([branchName, topicList], branchIndex) => {
      const branchSense = this.ensureSense({
        titleName: branchName,
        senseLabel: branchName,
        summary: this.createSummary({
          title: branchName,
          parentTitle: parent.titleName,
          rootName,
          kind: 'branch'
        }),
        rootKey,
        tags: [`cluster:${cluster.id}`, 'layer:branch', `branch_index:${branchIndex + 1}`]
      });
      this.connectContains(parent, branchSense, { mirrorExtends: true });

      stableSortStrings(topicList).forEach((topicName, topicIndex) => {
        const topicSense = this.ensureSense({
          titleName: topicName,
          senseLabel: topicName,
          summary: this.createSummary({
            title: topicName,
            parentTitle: branchName,
            rootName,
            kind: 'topic'
          }),
          rootKey,
          tags: [`cluster:${cluster.id}`, 'layer:topic', `topic_index:${topicIndex + 1}`]
        });
        this.connectContains(branchSense, topicSense, { mirrorExtends: true });

        aspects.forEach((aspect, aspectIndex) => {
          const leafTitle = `${topicName}${aspect}`;
          const leafSense = this.ensureSense({
            titleName: leafTitle,
            senseLabel: leafTitle,
            summary: this.createSummary({
              title: leafTitle,
              parentTitle: topicName,
              rootName,
              kind: 'leaf',
              aspect
            }),
            rootKey,
            tags: [`cluster:${cluster.id}`, 'layer:leaf', `aspect:${aspectIndex + 1}`]
          });
          this.connectContains(topicSense, leafSense, { mirrorExtends: true });
          this.chains.push({
            rootKey,
            titles: [
              rootSense.titleName,
              ...prefixSenses.map((item) => item.titleName),
              branchSense.titleName,
              topicSense.titleName,
              leafSense.titleName
            ],
            senseIds: [
              rootSense.senseId,
              ...prefixSenses.map((item) => item.senseId),
              branchSense.senseId,
              topicSense.senseId,
              leafSense.senseId
            ]
          });
        });
      });
    });
  }

  addPolysemyFamily(family, rootsByKey) {
    const baseTitles = Array.isArray(family?.titles) ? family.titles : [];
    const senses = Array.isArray(family?.senses) ? family.senses : [];
    baseTitles.forEach((titleName) => {
      senses.forEach((senseSpec, index) => {
        const rootKey = senseSpec.rootKey;
        const rootName = rootsByKey.get(rootKey)?.name || rootKey;
        this.ensureSense({
          titleName,
          senseLabel: senseSpec.senseLabel,
          summary: String(senseSpec.summary || '')
            .replaceAll('{title}', titleName)
            .replaceAll('{rootName}', rootName),
          rootKey,
          aliases: senseSpec.aliases || [],
          tags: ['polysemy', `poly_family:${family.id}`, `poly_index:${index + 1}`]
        });
      });
    });
  }

  getStats() {
    const senses = this.senses;
    const relations = this.relations;
    const contains = relations.filter((item) => item.relationType === 'contains');
    const extendsRows = relations.filter((item) => item.relationType === 'extends');

    const containsInCount = new Map();
    const containsOutCount = new Map();
    contains.forEach((row) => {
      containsOutCount.set(row.sourceSenseId, (containsOutCount.get(row.sourceSenseId) || 0) + 1);
      containsInCount.set(row.targetSenseId, (containsInCount.get(row.targetSenseId) || 0) + 1);
    });

    const rootSenseCount = senses.filter((sense) => (containsInCount.get(sense.senseId) || 0) === 0).length;
    const leafSenseCount = senses.filter((sense) => (containsOutCount.get(sense.senseId) || 0) === 0).length;

    const polysemyCount = this.titles.filter((title) => senses.filter((sense) => sense.titleId === title.titleId).length > 1).length;

    const rootDistribution = this.roots.map((root) => {
      const rootSenses = senses.filter((sense) => sense.rootKey === root.key);
      const rootTitleIdSet = new Set(rootSenses.map((sense) => sense.titleId));
      const rootSenseIdSet = new Set(rootSenses.map((sense) => sense.senseId));
      return {
        rootKey: root.key,
        rootName: root.name,
        titleCount: rootTitleIdSet.size,
        senseCount: rootSenses.length,
        containsCount: contains.filter((row) => rootSenseIdSet.has(row.sourceSenseId)).length,
        extendsCount: extendsRows.filter((row) => rootSenseIdSet.has(row.sourceSenseId)).length
      };
    });

    return {
      marker: MARKER,
      titleCount: this.titles.length,
      senseCount: senses.length,
      containsCount: contains.length,
      extendsCount: extendsRows.length,
      rootSenseCount,
      leafSenseCount,
      chainCount6to7: this.chains.filter((item) => item.titles.length >= 7 && item.titles.length <= 8).length,
      polysemyTitleCount: polysemyCount,
      rootDistribution
    };
  }

  shardRows(rows = [], size = 1000) {
    const shards = [];
    for (let index = 0; index < rows.length; index += size) {
      shards.push(rows.slice(index, index + size));
    }
    return shards;
  }

  writeDataset(outputDir) {
    const safeOutputDir = String(outputDir || '').trim();
    if (!safeOutputDir) throw new Error('outputDir is required');
    fs.mkdirSync(safeOutputDir, { recursive: true });

    const titles = stableSortStrings(this.titles.map((title) => title.name)).map((name) => this.titleByName.get(name));
    const titleOrderMap = new Map(titles.map((item, index) => [item.titleId, index]));
    const senses = [...this.senses].sort((a, b) => {
      const titleDiff = (titleOrderMap.get(a.titleId) || 0) - (titleOrderMap.get(b.titleId) || 0);
      if (titleDiff !== 0) return titleDiff;
      return a.senseLabel.localeCompare(b.senseLabel, 'zh-Hans-CN');
    });
    const relations = [...this.relations].sort((a, b) => {
      if (a.relationType !== b.relationType) return a.relationType.localeCompare(b.relationType, 'en');
      const sourceDiff = a.sourceSenseId.localeCompare(b.sourceSenseId, 'en');
      if (sourceDiff !== 0) return sourceDiff;
      return a.targetSenseId.localeCompare(b.targetSenseId, 'en');
    });
    const stats = this.getStats();

    const titleShards = this.shardRows(titles, 1000);
    const senseShards = this.shardRows(senses, 1000);
    const relationShards = this.shardRows(relations, 1500);

    titleShards.forEach((rows, index) => {
      fs.writeFileSync(path.join(safeOutputDir, `titles.part${String(index + 1).padStart(2, '0')}.json`), JSON.stringify(rows, null, 2));
    });
    senseShards.forEach((rows, index) => {
      fs.writeFileSync(path.join(safeOutputDir, `senses.part${String(index + 1).padStart(2, '0')}.json`), JSON.stringify(rows, null, 2));
    });
    relationShards.forEach((rows, index) => {
      fs.writeFileSync(path.join(safeOutputDir, `sense_relations.part${String(index + 1).padStart(2, '0')}.json`), JSON.stringify(rows, null, 2));
    });

    fs.writeFileSync(path.join(safeOutputDir, 'roots.json'), JSON.stringify(this.roots, null, 2));
    fs.writeFileSync(path.join(safeOutputDir, 'manifest.json'), JSON.stringify({
      marker: MARKER,
      generatedAt: new Date().toISOString(),
      titleFiles: titleShards.length,
      senseFiles: senseShards.length,
      relationFiles: relationShards.length,
      stats
    }, null, 2));
    fs.writeFileSync(path.join(safeOutputDir, 'stats.json'), JSON.stringify(stats, null, 2));
    fs.writeFileSync(path.join(safeOutputDir, 'sample_chains.json'), JSON.stringify(this.chains.slice(0, 500), null, 2));
    fs.writeFileSync(path.join(safeOutputDir, 'polysemy_titles.json'), JSON.stringify(
      this.titles
        .map((title) => ({
          titleId: title.titleId,
          name: title.name,
          senses: senses
            .filter((sense) => sense.titleId === title.titleId)
            .map((sense) => ({
              senseId: sense.senseId,
              senseLabel: sense.senseLabel,
              rootKey: sense.rootKey,
              summary: sense.summary
            }))
        }))
        .filter((item) => item.senses.length > 1)
        .slice(0, 800),
      null,
      2
    ));

    return stats;
  }
}

module.exports = {
  MARKER,
  ROOT_TAG_PREFIX,
  GlobalKnowledgeForestBuilder
};
