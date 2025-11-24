const mongoose = require('mongoose');
const Node = require('./models/Node');
const User = require('./models/User');
require('dotenv').config();

// ========================================
// 节点管理工具
// ========================================
// 使用方法:
// 1. 查看所有节点: node reset-node.js list
// 2. 查看特定节点: node reset-node.js view 节点名称或ID
// 3. 设置域主: node reset-node.js set-master 节点名称 用户名
// 4. 清除域主: node reset-node.js clear-master 节点名称
// 5. 更新节点状态: node reset-node.js status 节点名称 状态(approved/pending/rejected)
// ========================================

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function colorLog(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

// 列出所有节点
async function listAllNodes() {
  try {
    const nodes = await Node.find({})
      .populate('owner', 'username role')
      .populate('domainMaster', 'username')
      .sort({ createdAt: -1 });

    if (nodes.length === 0) {
      colorLog(colors.yellow, '\n暂无节点');
      return;
    }

    colorLog(colors.cyan, '\n========================================');
    colorLog(colors.cyan, `所有节点列表 (共 ${nodes.length} 个)`);
    colorLog(colors.cyan, '========================================');

    nodes.forEach((node, index) => {
      console.log(`\n${colors.bright}${index + 1}. ${node.name}${colors.reset}`);
      console.log(`   ID: ${node._id}`);
      console.log(`   NodeID: ${node.nodeId}`);
      console.log(`   拥有者: ${node.owner?.username || '未知'} (${node.owner?.role || '未知'})`);
      console.log(`   域主: ${node.domainMaster?.username || colors.yellow + '(未设置)' + colors.reset}`);
      console.log(`   状态: ${getStatusText(node.status)}`);
      console.log(`   繁荣度: ${node.prosperity}`);
      console.log(`   等级: ${node.level}`);
      console.log(`   知识点: ${node.knowledgePoint?.value || 0}`);
      console.log(`   热门: ${node.isFeatured ? colors.green + '是' : '否'}${colors.reset}`);
      console.log(`   创建时间: ${node.createdAt?.toLocaleString('zh-CN') || '未知'}`);
    });

    colorLog(colors.cyan, '\n========================================');
  } catch (error) {
    colorLog(colors.red, '获取节点列表失败: ' + error.message);
  }
}

// 查看特定节点
async function viewNode(nameOrId) {
  try {
    if (!nameOrId) {
      colorLog(colors.red, '错误: 请提供节点名称或ID');
      colorLog(colors.yellow, '使用方法: node reset-node.js view 节点名称或ID');
      return;
    }

    // 尝试按名称或_id或nodeId查找
    let node = await Node.findOne({
      $or: [
        { name: nameOrId },
        { nodeId: nameOrId }
      ]
    })
      .populate('owner', 'username role level')
      .populate('domainMaster', 'username level allianceId')
      .populate('associations.targetNode', 'name');

    // 如果是ObjectId格式，尝试按_id查找
    if (!node && mongoose.Types.ObjectId.isValid(nameOrId)) {
      node = await Node.findById(nameOrId)
        .populate('owner', 'username role level')
        .populate('domainMaster', 'username level allianceId')
        .populate('associations.targetNode', 'name');
    }

    if (!node) {
      colorLog(colors.red, `\n节点 "${nameOrId}" 不存在！`);
      colorLog(colors.yellow, '\n提示: 使用 node reset-node.js list 查看所有节点');
      return;
    }

    colorLog(colors.cyan, '\n========================================');
    colorLog(colors.cyan, `节点详细信息: ${node.name}`);
    colorLog(colors.cyan, '========================================');

    console.log(`\n${colors.bright}基本信息:${colors.reset}`);
    console.log(`  节点名称: ${node.name}`);
    console.log(`  _id: ${node._id}`);
    console.log(`  NodeID: ${node.nodeId}`);
    console.log(`  描述: ${node.description}`);
    console.log(`  状态: ${getStatusText(node.status)}`);

    console.log(`\n${colors.bright}所有权信息:${colors.reset}`);
    console.log(`  拥有者: ${node.owner?.username || '未知'}`);
    console.log(`  拥有者角色: ${node.owner?.role || '未知'}`);
    console.log(`  拥有者等级: ${node.owner?.level || 0}`);
    console.log(`  域主: ${node.domainMaster?.username || colors.yellow + '(未设置)' + colors.reset}`);
    if (node.domainMaster) {
      console.log(`  域主等级: ${node.domainMaster.level || 0}`);
      console.log(`  域主熵盟: ${node.domainMaster.allianceId || colors.yellow + '(未加入)' + colors.reset}`);
    }

    console.log(`\n${colors.bright}节点属性:${colors.reset}`);
    console.log(`  繁荣度: ${node.prosperity}/${500}`);
    console.log(`  等级: ${node.level}/${10}`);
    console.log(`  内容分数: ${node.contentScore}`);
    console.log(`  知识点: ${node.knowledgePoint?.value || 0}`);
    console.log(`  战争损伤: ${node.warDamage}%`);
    console.log(`  位置: (${node.position.x}, ${node.position.y})`);

    console.log(`\n${colors.bright}展示设置:${colors.reset}`);
    console.log(`  是否热门: ${node.isFeatured ? colors.green + '是' : '否'}${colors.reset}`);
    console.log(`  热门顺序: ${node.featuredOrder}`);

    console.log(`\n${colors.bright}关联节点:${colors.reset}`);
    if (node.associations && node.associations.length > 0) {
      node.associations.forEach((assoc, index) => {
        console.log(`  ${index + 1}. ${assoc.targetNode?.name || assoc.targetNode} (${assoc.relationType})`);
      });
    } else {
      console.log(`  ${colors.yellow}(无)${colors.reset}`);
    }

    console.log(`\n${colors.bright}父域:${colors.reset}`);
    if (node.relatedParentDomains && node.relatedParentDomains.length > 0) {
      console.log(`  ${node.relatedParentDomains.join(', ')}`);
    } else {
      console.log(`  ${colors.yellow}(无)${colors.reset}`);
    }

    console.log(`\n${colors.bright}子域:${colors.reset}`);
    if (node.relatedChildDomains && node.relatedChildDomains.length > 0) {
      console.log(`  ${node.relatedChildDomains.join(', ')}`);
    } else {
      console.log(`  ${colors.yellow}(无)${colors.reset}`);
    }

    console.log(`\n${colors.bright}时间信息:${colors.reset}`);
    console.log(`  创建时间: ${node.createdAt?.toLocaleString('zh-CN') || '未知'}`);
    console.log(`  更新时间: ${node.lastUpdate?.toLocaleString('zh-CN') || '未知'}`);
    console.log(`  知识点更新: ${node.knowledgePoint?.lastUpdated?.toLocaleString('zh-CN') || '未知'}`);

    colorLog(colors.cyan, '\n========================================');

    // 显示建议
    if (!node.domainMaster) {
      colorLog(colors.yellow, '\n💡 提示: 该节点尚未设置域主');
      colorLog(colors.yellow, '   使用命令: node reset-node.js set-master "' + node.name + '" 用户名');
    }

  } catch (error) {
    colorLog(colors.red, '查看节点失败: ' + error.message);
  }
}

// 设置节点域主
async function setDomainMaster(nodeName, username) {
  try {
    if (!nodeName || !username) {
      colorLog(colors.red, '错误: 请提供节点名称和用户名');
      colorLog(colors.yellow, '使用方法: node reset-node.js set-master 节点名称 用户名');
      return;
    }

    // 查找节点
    const node = await Node.findOne({ name: nodeName });
    if (!node) {
      colorLog(colors.red, `\n节点 "${nodeName}" 不存在！`);
      return;
    }

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      colorLog(colors.red, `\n用户 "${username}" 不存在！`);
      return;
    }

    // 设置域主
    node.domainMaster = user._id;
    await node.save();

    colorLog(colors.green, '\n✓ 域主设置成功！');
    console.log(`\n节点: ${node.name}`);
    console.log(`域主: ${username}`);
    console.log(`域主ID: ${user._id}`);

  } catch (error) {
    colorLog(colors.red, '设置域主失败: ' + error.message);
  }
}

// 清除节点域主
async function clearDomainMaster(nodeName) {
  try {
    if (!nodeName) {
      colorLog(colors.red, '错误: 请提供节点名称');
      colorLog(colors.yellow, '使用方法: node reset-node.js clear-master 节点名称');
      return;
    }

    // 查找节点
    const node = await Node.findOne({ name: nodeName }).populate('domainMaster', 'username');
    if (!node) {
      colorLog(colors.red, `\n节点 "${nodeName}" 不存在！`);
      return;
    }

    const oldMaster = node.domainMaster?.username || '(无)';

    // 清除域主
    node.domainMaster = null;
    await node.save();

    colorLog(colors.green, '\n✓ 域主已清除！');
    console.log(`\n节点: ${node.name}`);
    console.log(`原域主: ${oldMaster}`);
    console.log(`新域主: (无)`);

  } catch (error) {
    colorLog(colors.red, '清除域主失败: ' + error.message);
  }
}

// 更新节点状态
async function updateNodeStatus(nodeName, status) {
  try {
    if (!nodeName || !status) {
      colorLog(colors.red, '错误: 请提供节点名称和状态');
      colorLog(colors.yellow, '使用方法: node reset-node.js status 节点名称 状态');
      colorLog(colors.yellow, '状态可选: approved, pending, rejected');
      return;
    }

    if (!['approved', 'pending', 'rejected'].includes(status)) {
      colorLog(colors.red, '错误: 状态只能是 approved, pending 或 rejected');
      return;
    }

    // 查找节点
    const node = await Node.findOne({ name: nodeName });
    if (!node) {
      colorLog(colors.red, `\n节点 "${nodeName}" 不存在！`);
      return;
    }

    const oldStatus = node.status;
    node.status = status;
    await node.save();

    colorLog(colors.green, '\n✓ 状态更新成功！');
    console.log(`\n节点: ${node.name}`);
    console.log(`原状态: ${getStatusText(oldStatus)}`);
    console.log(`新状态: ${getStatusText(status)}`);

  } catch (error) {
    colorLog(colors.red, '更新状态失败: ' + error.message);
  }
}

// 获取状态文本
function getStatusText(status) {
  switch (status) {
    case 'approved':
      return colors.green + '已批准' + colors.reset;
    case 'pending':
      return colors.yellow + '待审批' + colors.reset;
    case 'rejected':
      return colors.red + '已拒绝' + colors.reset;
    default:
      return status;
  }
}

// 显示帮助
function showHelp() {
  colorLog(colors.cyan, '\n========================================');
  colorLog(colors.cyan, '节点管理工具 - 帮助');
  colorLog(colors.cyan, '========================================');

  console.log('\n使用方法:\n');

  console.log(`${colors.bright}1. 列出所有节点:${colors.reset}`);
  console.log(`   ${colors.green}node reset-node.js list${colors.reset}`);

  console.log(`\n${colors.bright}2. 查看特定节点:${colors.reset}`);
  console.log(`   ${colors.green}node reset-node.js view 节点名称或ID${colors.reset}`);
  console.log(`   例如: node reset-node.js view "深度学习"`);

  console.log(`\n${colors.bright}3. 设置节点域主:${colors.reset}`);
  console.log(`   ${colors.green}node reset-node.js set-master 节点名称 用户名${colors.reset}`);
  console.log(`   例如: node reset-node.js set-master "深度学习" admin`);

  console.log(`\n${colors.bright}4. 清除节点域主:${colors.reset}`);
  console.log(`   ${colors.green}node reset-node.js clear-master 节点名称${colors.reset}`);
  console.log(`   例如: node reset-node.js clear-master "深度学习"`);

  console.log(`\n${colors.bright}5. 更新节点状态:${colors.reset}`);
  console.log(`   ${colors.green}node reset-node.js status 节点名称 状态${colors.reset}`);
  console.log(`   状态可选: approved, pending, rejected`);
  console.log(`   例如: node reset-node.js status "深度学习" approved`);

  console.log(`\n${colors.bright}说明:${colors.reset}`);
  console.log(`   - ${colors.yellow}域主${colors.reset}: 节点的管理者，其所属的熵盟将管辖该节点`);
  console.log(`   - ${colors.yellow}拥有者${colors.reset}: 创建节点的用户`);
  console.log(`   - 域主和拥有者可以是不同的用户`);

  colorLog(colors.cyan, '\n========================================');
}

// 主函数
async function main() {
  try {
    // 连接数据库
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game');
    colorLog(colors.green, '✓ 已连接到数据库');

    const command = process.argv[2];
    const arg1 = process.argv[3];
    const arg2 = process.argv[4];

    switch (command) {
      case 'list':
        await listAllNodes();
        break;

      case 'view':
        await viewNode(arg1);
        break;

      case 'set-master':
        await setDomainMaster(arg1, arg2);
        break;

      case 'clear-master':
        await clearDomainMaster(arg1);
        break;

      case 'status':
        await updateNodeStatus(arg1, arg2);
        break;

      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;

      default:
        if (!command) {
          showHelp();
        } else {
          colorLog(colors.red, `\n未知命令: ${command}`);
          showHelp();
        }
    }

    process.exit(0);
  } catch (error) {
    colorLog(colors.red, '\n发生错误: ' + error.message);
    console.error(error);
    process.exit(1);
  }
}

// 运行
main();
