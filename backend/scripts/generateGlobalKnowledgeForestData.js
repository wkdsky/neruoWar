#!/usr/bin/env node

const path = require('path');
const {
  GlobalKnowledgeForestBuilder
} = require('./lib/globalKnowledgeForestBuilder');
const {
  ROOTS,
  ASPECTS,
  ROOT_CLUSTERS,
  POLYSEMY_FAMILIES,
  MANUAL_CHAINS
} = require('./lib/globalKnowledgeForestConfig');

const OUTPUT_DIR = path.join(__dirname, '..', 'seed', 'global_knowledge_forest');

const ROOTS_BY_KEY = new Map(ROOTS.map((item) => [item.key, item]));

const buildAnchorSense = (builder, rootKey, nodes = []) => {
  const rootSense = builder.getRootSense(rootKey);
  const rootName = ROOTS_BY_KEY.get(rootKey)?.name || rootKey;
  let parent = rootSense;
  let current = rootSense;

  (Array.isArray(nodes) ? nodes : []).forEach((title, index) => {
    const sense = builder.ensureSense({
      titleName: title,
      senseLabel: title,
      summary: builder.createSummary({
        title,
        parentTitle: parent.titleName,
        rootName,
        kind: index === nodes.length - 1 ? 'branch' : 'topic'
      }),
      rootKey,
      tags: ['poly_anchor']
    });
    builder.connectContains(parent, sense, { mirrorExtends: true });
    parent = sense;
    current = sense;
  });

  return current;
};

const buildPolyAnchors = (builder) => ({
  fruit: buildAnchorSense(builder, 'health_life', ['生活与休闲', '日常实践', '营养与饮食', '水果']),
  beverage: buildAnchorSense(builder, 'health_life', ['生活与休闲', '日常实践', '营养与饮食', '饮料']),
  tech_company: buildAnchorSense(builder, 'economy', ['产业经济', '产业结构', '行业体系', '科技公司']),
  programming_language: buildAnchorSense(builder, 'engineering', ['计算机科学', '软件与系统', '程序与架构', '编程语言']),
  island: buildAnchorSense(builder, 'geography', ['地球分区', '海洋与大陆', '大尺度地理单元', '岛屿']),
  snake: buildAnchorSense(builder, 'science', ['生物学', '生命系统', '组织与演化', '爬行动物']),
  computer_network: buildAnchorSense(builder, 'engineering', ['信息与通信工程', '网络与通信', '连接系统', '计算机网络']),
  social_network: buildAnchorSense(builder, 'society', ['社会结构', '社会组织', '群体与制度', '社会网络']),
  biology_cell: buildAnchorSense(builder, 'science', ['生物学', '生命系统', '组织与演化', '细胞生物学']),
  battery_cell: buildAnchorSense(builder, 'engineering', ['工程技术', '电子与控制', '硬件系统', '电池技术']),
  math_model: buildAnchorSense(builder, 'math_logic', ['数学', '应用数学', '数学建模', '数学模型']),
  ml_model: buildAnchorSense(builder, 'engineering', ['计算机科学', '人工智能', '机器学习', '机器学习模型']),
  physical_model: buildAnchorSense(builder, 'art_media', ['设计', '应用设计', '视觉传达', '实体模型']),
  engineering_structure: buildAnchorSense(builder, 'engineering', ['工程技术', '土木与机械', '基础设施与制造', '工程结构']),
  data_structure: buildAnchorSense(builder, 'engineering', ['计算机科学', '软件与系统', '程序与架构', '数据结构']),
  language_structure: buildAnchorSense(builder, 'language', ['语言学', '结构语言学', '语言系统', '语言结构']),
  communication_medium: buildAnchorSense(builder, 'art_media', ['媒体', '新闻与出版', '传播形态', '传播介质']),
  material_medium: buildAnchorSense(builder, 'science', ['化学', '物质科学', '结构与反应', '材料介质']),
  compute_platform: buildAnchorSense(builder, 'engineering', ['工程技术', '电子与控制', '硬件系统', '计算平台']),
  business_platform: buildAnchorSense(builder, 'economy', ['管理学', '组织与战略', '企业运行', '商业平台']),
  geologic_platform: buildAnchorSense(builder, 'science', ['地球科学', '地球系统', '地质与环境', '地质平台']),
  communication_signal: buildAnchorSense(builder, 'engineering', ['信息与通信工程', '网络与通信', '连接系统', '通信信号']),
  physiological_signal: buildAnchorSense(builder, 'health_life', ['医学与健康', '基础医学', '生命与诊断', '生理信号']),
  physical_field: buildAnchorSense(builder, 'science', ['物理学', '现代物理学', '微观与宇观', '物理场']),
  social_field: buildAnchorSense(builder, 'society', ['社会议题', '规范与权利', '公共讨论', '社会场域']),
  network_protocol: buildAnchorSense(builder, 'engineering', ['信息与通信工程', '网络与通信', '连接系统', '网络协议']),
  social_protocol: buildAnchorSense(builder, 'society', ['社会结构', '社会组织', '群体与制度', '社会协议']),
  bio_virus: buildAnchorSense(builder, 'science', ['生物学', '生命系统', '组织与演化', '病毒学']),
  computer_virus: buildAnchorSense(builder, 'engineering', ['计算机科学', '软件与系统', '程序与架构', '恶意软件']),
  atomic_nucleus: buildAnchorSense(builder, 'science', ['物理学', '现代物理学', '微观与宇观', '原子核']),
  computing_kernel: buildAnchorSense(builder, 'engineering', ['计算机科学', '软件与系统', '程序与架构', '计算机内核']),
  earth_core: buildAnchorSense(builder, 'science', ['地球科学', '地球系统', '地质与环境', '地核']),
  life_system: buildAnchorSense(builder, 'science', ['生物学', '生命系统', '组织与演化', '生命系统']),
  tech_system: buildAnchorSense(builder, 'engineering', ['工程技术', '电子与控制', '硬件系统', '技术系统']),
  software_interface: buildAnchorSense(builder, 'engineering', ['计算机科学', '软件与系统', '程序与架构', '软件接口']),
  ion_channel: buildAnchorSense(builder, 'science', ['生物学', '生命系统', '组织与演化', '离子通道']),
  stratigraphy: buildAnchorSense(builder, 'science', ['地球科学', '地球系统', '地质与环境', '地层']),
  data_stream: buildAnchorSense(builder, 'engineering', ['信息与通信工程', '网络与通信', '连接系统', '数据流']),
  ocean_current: buildAnchorSense(builder, 'science', ['地球科学', '地球系统', '地质与环境', '洋流']),
  drug_carrier: buildAnchorSense(builder, 'health_life', ['医学与健康', '基础医学', '生命与诊断', '药物载体']),
  teaching_unit: buildAnchorSense(builder, 'education_psychology', ['教育学', '教育制度', '学校与课程', '教学单元']),
  engineering_unit: buildAnchorSense(builder, 'engineering', ['工程技术', '电子与控制', '硬件系统', '工程单元']),
  design_grid: buildAnchorSense(builder, 'art_media', ['设计', '视觉传达设计', '品牌设计', '网格系统']),
  compute_grid: buildAnchorSense(builder, 'engineering', ['工程技术', '电子与控制', '硬件系统', '计算网格']),
  framework_engineering: buildAnchorSense(builder, 'engineering', ['计算机科学', '软件与系统', '程序与架构', '软件框架']),
  framework_theory: buildAnchorSense(builder, 'philosophy', ['思想史', '思想传统', '观念流变', '理论框架']),
  growth_driver: buildAnchorSense(builder, 'economy', ['经济学', '理论经济学', '宏观与微观分析', '增长驱动']),
  device_driver: buildAnchorSense(builder, 'engineering', ['工程技术', '电子与控制', '硬件系统', '设备驱动']),
  media_carrier: buildAnchorSense(builder, 'art_media', ['媒体', '新闻与出版', '传播形态', '传播载体'])
});

const REQUIRED_POLYSEMY = [
  {
    titleName: '苹果',
    senses: [
      { rootKey: 'health_life', senseLabel: '水果', summary: '苹果作为水果，是常见的温带果实与饮食对象。', anchorKey: 'fruit' },
      { rootKey: 'economy', senseLabel: '科技公司', summary: '苹果作为科技公司，是从事消费电子与软件生态经营的企业主体。', anchorKey: 'tech_company' }
    ]
  },
  {
    titleName: 'Java',
    senses: [
      { rootKey: 'engineering', senseLabel: '编程语言', summary: 'Java作为编程语言，是面向对象且广泛用于企业与平台开发的程序语言。', anchorKey: 'programming_language' },
      { rootKey: 'geography', senseLabel: '印度尼西亚岛屿', summary: 'Java作为印度尼西亚岛屿，是东南亚人口密集且历史重要的岛屿。', anchorKey: 'island' },
      { rootKey: 'health_life', senseLabel: '咖啡', summary: 'Java作为咖啡名称，可指代咖啡饮品及其流通语境中的称谓。', anchorKey: 'beverage' }
    ]
  },
  {
    titleName: 'Python',
    senses: [
      { rootKey: 'engineering', senseLabel: '编程语言', summary: 'Python作为编程语言，是以高可读性著称的通用程序语言。', anchorKey: 'programming_language' },
      { rootKey: 'science', senseLabel: '蟒蛇', summary: 'Python作为蟒蛇，是大型无毒蛇类的通称。', anchorKey: 'snake' }
    ]
  },
  {
    titleName: '网络',
    senses: [
      { rootKey: 'engineering', senseLabel: '计算机网络', summary: '网络作为计算机网络，是用于节点互联与数据传输的技术系统。', anchorKey: 'computer_network' },
      { rootKey: 'society', senseLabel: '社会网络', summary: '网络作为社会网络，是由个体、组织与关系构成的社会联系结构。', anchorKey: 'social_network' }
    ]
  },
  {
    titleName: '细胞',
    senses: [
      { rootKey: 'science', senseLabel: '生物学中的细胞', summary: '细胞作为生物学概念，是生命体结构与功能的基本单位。', anchorKey: 'biology_cell' },
      { rootKey: 'engineering', senseLabel: '电池单元', summary: '细胞作为电池单元，是构成电化学储能系统的基本模块。', anchorKey: 'battery_cell' }
    ]
  },
  {
    titleName: '模型',
    senses: [
      { rootKey: 'math_logic', senseLabel: '数学模型', summary: '模型作为数学模型，是对变量、关系与约束的形式化表达。', anchorKey: 'math_model' },
      { rootKey: 'engineering', senseLabel: '机器学习模型', summary: '模型作为机器学习模型，是从数据中训练得到的预测或生成结构。', anchorKey: 'ml_model' },
      { rootKey: 'art_media', senseLabel: '实体模型', summary: '模型作为实体模型，是用于展示形态、比例或方案的物理原型。', anchorKey: 'physical_model' }
    ]
  },
  {
    titleName: '结构',
    senses: [
      { rootKey: 'engineering', senseLabel: '工程结构', summary: '结构作为工程结构，是由构件、连接与受力关系组成的实体体系。', anchorKey: 'engineering_structure' },
      { rootKey: 'engineering', senseLabel: '数据结构', summary: '结构作为数据结构，是组织、索引与访问数据的计算机抽象。', anchorKey: 'data_structure' },
      { rootKey: 'language', senseLabel: '语言结构', summary: '结构作为语言结构，是语言单位之间的组合层次与规则关系。', anchorKey: 'language_structure' }
    ]
  },
  {
    titleName: '介质',
    senses: [
      { rootKey: 'art_media', senseLabel: '传播介质', summary: '介质作为传播介质，是承载、传递与扩散信息的媒介形式。', anchorKey: 'communication_medium' },
      { rootKey: 'science', senseLabel: '材料介质', summary: '介质作为材料介质，是波、场或反应得以发生的物质环境。', anchorKey: 'material_medium' }
    ]
  },
  {
    titleName: '平台',
    senses: [
      { rootKey: 'engineering', senseLabel: '计算平台', summary: '平台作为计算平台，是提供运行、部署与调度能力的技术基础。', anchorKey: 'compute_platform' },
      { rootKey: 'economy', senseLabel: '商业平台', summary: '平台作为商业平台，是连接供给与需求并组织交易的经营结构。', anchorKey: 'business_platform' },
      { rootKey: 'science', senseLabel: '地质平台', summary: '平台作为地质平台，是稳定陆块或沉积环境中的地质构造单元。', anchorKey: 'geologic_platform' }
    ]
  },
  {
    titleName: '信号',
    senses: [
      { rootKey: 'engineering', senseLabel: '通信信号', summary: '信号作为通信信号，是携带信息并可被传输与处理的物理量。', anchorKey: 'communication_signal' },
      { rootKey: 'health_life', senseLabel: '生理信号', summary: '信号作为生理信号，是反映机体状态与生命活动的监测数据。', anchorKey: 'physiological_signal' }
    ]
  },
  {
    titleName: '场',
    senses: [
      { rootKey: 'science', senseLabel: '物理学中的场', summary: '场作为物理学概念，是在空间中分布并对对象施加作用的物理量结构。', anchorKey: 'physical_field' },
      { rootKey: 'society', senseLabel: '社会场域', summary: '场作为社会场域，是社会行动者围绕资本、规则与位置展开竞争的关系空间。', anchorKey: 'social_field' }
    ]
  },
  {
    titleName: '协议',
    senses: [
      { rootKey: 'engineering', senseLabel: '网络协议', summary: '协议作为网络协议，是用于互联互通与数据交换的规则集合。', anchorKey: 'network_protocol' },
      { rootKey: 'society', senseLabel: '社会协议', summary: '协议作为社会协议，是用于协调合作、停火或谈判的约定文本。', anchorKey: 'social_protocol' }
    ]
  },
  {
    titleName: '病毒',
    senses: [
      { rootKey: 'science', senseLabel: '生物病毒', summary: '病毒作为生物病毒，是依赖宿主细胞复制的亚显微感染因子。', anchorKey: 'bio_virus' },
      { rootKey: 'engineering', senseLabel: '计算机病毒', summary: '病毒作为计算机病毒，是能够自我复制或破坏系统的恶意程序。', anchorKey: 'computer_virus' }
    ]
  },
  {
    titleName: '核',
    senses: [
      { rootKey: 'science', senseLabel: '原子核', summary: '核作为原子核，是原子中由质子与中子构成的中心部分。', anchorKey: 'atomic_nucleus' },
      { rootKey: 'engineering', senseLabel: '计算机内核', summary: '核作为计算机内核，是操作系统负责资源管理与调度的核心部分。', anchorKey: 'computing_kernel' },
      { rootKey: 'science', senseLabel: '地核', summary: '核作为地核，是地球内部由金属物质主导的深部结构层。', anchorKey: 'earth_core' }
    ]
  },
  {
    titleName: '系统',
    senses: [
      { rootKey: 'science', senseLabel: '生命系统', summary: '系统作为生命系统，是由多层次结构与调节过程构成的生物体系。', anchorKey: 'life_system' },
      { rootKey: 'engineering', senseLabel: '技术系统', summary: '系统作为技术系统，是由组件、接口与流程协同构成的工程体系。', anchorKey: 'tech_system' }
    ]
  },
  {
    titleName: '接口',
    senses: [
      { rootKey: 'engineering', senseLabel: '软件接口', summary: '接口作为软件接口，是系统之间交换调用约定与数据格式的边界。', anchorKey: 'software_interface' },
      { rootKey: 'science', senseLabel: '离子通道界面', summary: '接口作为离子通道界面，是膜蛋白与离子交换发生作用的生物学边界。', anchorKey: 'ion_channel' }
    ]
  },
  {
    titleName: '层',
    senses: [
      { rootKey: 'engineering', senseLabel: '网络层', summary: '层作为网络层，是协议栈中承担特定通信职能的层级。', anchorKey: 'computer_network' },
      { rootKey: 'science', senseLabel: '地层', summary: '层作为地层，是地质年代与沉积过程形成的岩层单元。', anchorKey: 'stratigraphy' }
    ]
  },
  {
    titleName: '流',
    senses: [
      { rootKey: 'engineering', senseLabel: '数据流', summary: '流作为数据流，是在系统中连续传递、处理或缓存的信息序列。', anchorKey: 'data_stream' },
      { rootKey: 'science', senseLabel: '洋流', summary: '流作为洋流，是海洋中具有稳定方向与动力机制的水体运动。', anchorKey: 'ocean_current' }
    ]
  },
  {
    titleName: '载体',
    senses: [
      { rootKey: 'art_media', senseLabel: '传播载体', summary: '载体作为传播载体，是承载信息、符号或内容的媒介形式。', anchorKey: 'media_carrier' },
      { rootKey: 'health_life', senseLabel: '药物载体', summary: '载体作为药物载体，是帮助药物递送、释放或定位的材料系统。', anchorKey: 'drug_carrier' }
    ]
  },
  {
    titleName: '单元',
    senses: [
      { rootKey: 'education_psychology', senseLabel: '教学单元', summary: '单元作为教学单元，是围绕目标与主题组织的课程片段。', anchorKey: 'teaching_unit' },
      { rootKey: 'engineering', senseLabel: '电池单元', summary: '单元作为电池单元，是构成储能模组的基本电化学组件。', anchorKey: 'battery_cell' }
    ]
  },
  {
    titleName: '网格',
    senses: [
      { rootKey: 'art_media', senseLabel: '设计网格', summary: '网格作为设计网格，是组织版式、信息与视觉节奏的排版系统。', anchorKey: 'design_grid' },
      { rootKey: 'engineering', senseLabel: '计算网格', summary: '网格作为计算网格，是用于分布式资源协同计算的基础设施。', anchorKey: 'compute_grid' }
    ]
  },
  {
    titleName: '框架',
    senses: [
      { rootKey: 'engineering', senseLabel: '软件框架', summary: '框架作为软件框架，是约束应用结构与扩展方式的开发骨架。', anchorKey: 'framework_engineering' },
      { rootKey: 'philosophy', senseLabel: '理论框架', summary: '框架作为理论框架，是组织概念、命题与分析路径的解释结构。', anchorKey: 'framework_theory' }
    ]
  },
  {
    titleName: '驱动',
    senses: [
      { rootKey: 'engineering', senseLabel: '设备驱动', summary: '驱动作为设备驱动，是连接操作系统与硬件设备的底层软件。', anchorKey: 'device_driver' },
      { rootKey: 'economy', senseLabel: '增长驱动', summary: '驱动作为增长驱动，是推动产出、需求或投资扩张的关键力量。', anchorKey: 'growth_driver' }
    ]
  }
];

const FAMILY_ANCHORS = {
  model_family: ['math_model', 'ml_model'],
  structure_family: ['engineering_structure', 'language_structure'],
  signal_family: ['communication_signal', 'physiological_signal'],
  protocol_family: ['network_protocol', 'social_protocol'],
  platform_family: ['compute_platform', 'business_platform'],
  system_family: ['life_system', 'tech_system'],
  unit_family: ['teaching_unit', 'engineering_unit']
};

const attachSenseToAnchor = (builder, sense, anchorSense) => {
  if (!sense || !anchorSense) return;
  builder.connectContains(anchorSense, sense, { mirrorExtends: true });
};

const validateStats = (stats) => {
  const errors = [];
  if (stats.titleCount < 5000) errors.push(`titleCount ${stats.titleCount} < 5000`);
  if (stats.senseCount < 9000) errors.push(`senseCount ${stats.senseCount} < 9000`);
  if (stats.containsCount < 12000) errors.push(`containsCount ${stats.containsCount} < 12000`);
  if (stats.extendsCount < 3000) errors.push(`extendsCount ${stats.extendsCount} < 3000`);
  if (stats.rootSenseCount < 14) errors.push(`rootSenseCount ${stats.rootSenseCount} < 14`);
  if (stats.leafSenseCount < 3500) errors.push(`leafSenseCount ${stats.leafSenseCount} < 3500`);
  if (stats.chainCount6to7 < 150) errors.push(`chainCount6to7 ${stats.chainCount6to7} < 150`);
  if (stats.polysemyTitleCount < 300) errors.push(`polysemyTitleCount ${stats.polysemyTitleCount} < 300`);
  stats.rootDistribution.forEach((item) => {
    if (item.titleCount < 180) errors.push(`${item.rootName} titleCount ${item.titleCount} < 180`);
    if (item.senseCount < 300) errors.push(`${item.rootName} senseCount ${item.senseCount} < 300`);
    if (item.containsCount < 400) errors.push(`${item.rootName} containsCount ${item.containsCount} < 400`);
    if (item.extendsCount < 80) errors.push(`${item.rootName} extendsCount ${item.extendsCount} < 80`);
  });
  return errors;
};

async function main() {
  const builder = new GlobalKnowledgeForestBuilder({
    roots: ROOTS,
    aspects: ASPECTS
  });

  builder.createRootSenses();

  MANUAL_CHAINS.forEach((chain) => {
    builder.addManualChain(chain);
  });

  ROOTS.forEach((root) => {
    const clusters = ROOT_CLUSTERS[root.key] || [];
    clusters.forEach((cluster) => {
      builder.addClusterTree({
        rootKey: root.key,
        cluster,
        aspectKey: root.aspectKey
      });
    });
  });

  const anchors = buildPolyAnchors(builder);

  REQUIRED_POLYSEMY.forEach((item) => {
    item.senses.forEach((senseSpec) => {
      const sense = builder.ensureSense({
        titleName: item.titleName,
        senseLabel: senseSpec.senseLabel,
        summary: senseSpec.summary,
        rootKey: senseSpec.rootKey,
        tags: ['polysemy', 'required_example']
      });
      attachSenseToAnchor(builder, sense, anchors[senseSpec.anchorKey]);
    });
  });

  POLYSEMY_FAMILIES.filter((family) => family.id !== 'required_examples').forEach((family) => {
    const anchorKeys = FAMILY_ANCHORS[family.id] || [];
    const familySenses = Array.isArray(family.senses) ? family.senses : [];
    family.titles.forEach((titleName) => {
      if (builder.titleByName.has(titleName)) {
        return;
      }
      familySenses.forEach((senseSpec, index) => {
        const rootName = ROOTS_BY_KEY.get(senseSpec.rootKey)?.name || senseSpec.rootKey;
        const sense = builder.ensureSense({
          titleName,
          senseLabel: senseSpec.senseLabel,
          summary: String(senseSpec.summary || '')
            .replaceAll('{title}', titleName)
            .replaceAll('{rootName}', rootName),
          rootKey: senseSpec.rootKey,
          tags: ['polysemy', `poly_family:${family.id}`]
        });
        attachSenseToAnchor(builder, sense, anchors[anchorKeys[index]]);
      });
    });
  });

  const stats = builder.writeDataset(OUTPUT_DIR);
  const errors = validateStats(stats);

  console.log(JSON.stringify({
    outputDir: OUTPUT_DIR,
    stats,
    validationErrors: errors
  }, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
