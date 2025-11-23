const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
require('dotenv').config();

// ========================================
// 用户管理工具
// ========================================
// 使用方法:
// 1. 查看所有用户: node reset-user.js list
// 2. 查看特定用户: node reset-user.js view 用户名
// 3. 创建/更新用户: 修改下面的 USER_CONFIG，然后运行 node reset-user.js update
// ========================================

// ========================================
// 配置区域 - 在这里修改要创建/更新的用户信息
// ========================================
const USER_CONFIG = {
  // 用户名（必填）
  username: 'bbb',

  // 密码（必填，创建新用户或修改密码时需要）
  password: '123456',

  // 角色（可选：'admin' 或 'common'，默认 'common'）
  role: 'common',

  // 等级（可选，默认 1）
  level: 1,

  // 经验值（可选，默认 0）
  experience: 0,

  // 位置/降临的知识域（可选，管理员建议设为'任意'，普通用户可设为具体节点名或留空''）
  location: ''
};
// ========================================
// 配置区域结束
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

// 列出所有用户
async function listAllUsers() {
  try {
    const users = await User.find({});

    if (users.length === 0) {
      colorLog(colors.yellow, '\n暂无用户');
      return;
    }

    colorLog(colors.cyan, '\n========================================');
    colorLog(colors.cyan, '所有用户列表');
    colorLog(colors.cyan, '========================================');

    users.forEach((user, index) => {
      console.log(`\n${colors.bright}${index + 1}. ${user.username}${colors.reset}`);
      console.log(`   ID: ${user._id}`);
      console.log(`   角色: ${user.role === 'admin' ? colors.red + '管理员' : colors.green + '普通用户'}${colors.reset}`);
      console.log(`   等级: ${user.level}`);
      console.log(`   经验: ${user.experience}`);
      console.log(`   位置: ${user.location || colors.yellow + '(未设置)' + colors.reset}`);
      console.log(`   明文密码: ${user.plainPassword || colors.yellow + '(不可用)' + colors.reset}`);
      console.log(`   创建时间: ${user.createdAt?.toLocaleString('zh-CN') || '未知'}`);
      console.log(`   更新时间: ${user.updatedAt?.toLocaleString('zh-CN') || '未知'}`);
    });

    colorLog(colors.cyan, '\n========================================');
  } catch (error) {
    colorLog(colors.red, '获取用户列表失败: ' + error.message);
  }
}

// 查看特定用户
async function viewUser(username) {
  try {
    if (!username) {
      colorLog(colors.red, '错误: 请提供用户名');
      colorLog(colors.yellow, '使用方法: node reset-user.js view 用户名');
      return;
    }

    const user = await User.findOne({ username }).populate('ownedNodes');

    if (!user) {
      colorLog(colors.red, `\n用户 "${username}" 不存在！`);
      colorLog(colors.yellow, '\n提示: 使用 node reset-user.js list 查看所有用户');
      return;
    }

    colorLog(colors.cyan, '\n========================================');
    colorLog(colors.cyan, `用户详细信息: ${username}`);
    colorLog(colors.cyan, '========================================');

    console.log(`\n${colors.bright}基本信息:${colors.reset}`);
    console.log(`  用户名: ${user.username}`);
    console.log(`  ID: ${user._id}`);
    console.log(`  角色: ${user.role === 'admin' ? colors.red + '管理员' : colors.green + '普通用户'}${colors.reset}`);
    console.log(`  等级: ${user.level}`);
    console.log(`  经验值: ${user.experience}`);
    console.log(`  位置/知识域: ${user.location || colors.yellow + '(未设置 - 登录后需要选择)' + colors.reset}`);

    console.log(`\n${colors.bright}密码信息:${colors.reset}`);
    console.log(`  哈希密码: ${user.password}`);
    console.log(`  明文密码: ${user.plainPassword || colors.yellow + '(不可用)' + colors.reset}`);

    console.log(`\n${colors.bright}拥有的节点:${colors.reset}`);
    if (user.ownedNodes && user.ownedNodes.length > 0) {
      user.ownedNodes.forEach((node, index) => {
        console.log(`  ${index + 1}. ${node.name || node._id}`);
      });
    } else {
      console.log(`  ${colors.yellow}(无)${colors.reset}`);
    }

    console.log(`\n${colors.bright}时间信息:${colors.reset}`);
    console.log(`  创建时间: ${user.createdAt?.toLocaleString('zh-CN') || '未知'}`);
    console.log(`  更新时间: ${user.updatedAt?.toLocaleString('zh-CN') || '未知'}`);

    colorLog(colors.cyan, '\n========================================');

    // 显示配置建议
    if (!user.location || user.location === '') {
      colorLog(colors.yellow, '\n⚠️  警告: 该用户尚未设置location字段');
      if (user.role === 'admin') {
        colorLog(colors.yellow, '   建议设置为"任意"以便管理员可以直接进入系统');
      } else {
        colorLog(colors.yellow, '   该用户登录后需要选择降临的知识域');
      }
    }

  } catch (error) {
    colorLog(colors.red, '查看用户失败: ' + error.message);
  }
}

// 创建或更新用户
async function updateUser(config) {
  try {
    // 验证配置
    if (!config.username || !config.username.trim()) {
      colorLog(colors.red, '\n错误: 用户名不能为空');
      colorLog(colors.yellow, '请在代码中修改 USER_CONFIG.username');
      return;
    }

    if (!config.password || !config.password.trim()) {
      colorLog(colors.red, '\n错误: 密码不能为空');
      colorLog(colors.yellow, '请在代码中修改 USER_CONFIG.password');
      return;
    }

    if (config.password.length < 6) {
      colorLog(colors.red, '\n错误: 密码长度不能少于6个字符');
      return;
    }

    if (config.username.length < 3) {
      colorLog(colors.red, '\n错误: 用户名长度不能少于3个字符');
      return;
    }

    if (config.role && !['admin', 'common'].includes(config.role)) {
      colorLog(colors.red, '\n错误: 角色只能是 "admin" 或 "common"');
      return;
    }

    // 查找用户
    let user = await User.findOne({ username: config.username });
    const isNewUser = !user;

    if (isNewUser) {
      colorLog(colors.cyan, `\n正在创建新用户: ${config.username}`);
      user = new User({
        username: config.username
      });
    } else {
      colorLog(colors.cyan, `\n正在更新用户: ${config.username}`);
    }

    // 更新密码
    const hashedPassword = await bcrypt.hash(config.password, 10);
    user.password = hashedPassword;
    user.plainPassword = config.password;

    // 更新其他字段
    if (config.role !== undefined) {
      user.role = config.role;
    } else if (isNewUser) {
      user.role = 'common';
    }

    if (config.level !== undefined) {
      user.level = config.level;
    } else if (isNewUser) {
      user.level = 1;
    }

    if (config.experience !== undefined) {
      user.experience = config.experience;
    } else if (isNewUser) {
      user.experience = 0;
    }

    if (config.location !== undefined) {
      user.location = config.location;
    } else if (isNewUser) {
      user.location = '';
    }

    // 保存用户
    await user.save();

    // 显示结果
    colorLog(colors.green, `\n✓ ${isNewUser ? '创建' : '更新'}成功！`);
    colorLog(colors.cyan, '\n========================================');
    colorLog(colors.cyan, '用户信息');
    colorLog(colors.cyan, '========================================');

    console.log(`\n用户名: ${user.username}`);
    console.log(`ID: ${user._id}`);
    console.log(`密码: ${user.plainPassword}`);
    console.log(`角色: ${user.role === 'admin' ? colors.red + '管理员' : colors.green + '普通用户'}${colors.reset}`);
    console.log(`等级: ${user.level}`);
    console.log(`经验: ${user.experience}`);
    console.log(`位置: ${user.location || colors.yellow + '(未设置)' + colors.reset}`);

    colorLog(colors.cyan, '\n========================================');

    // 显示提示
    if (user.role === 'admin' && (!user.location || user.location === '')) {
      colorLog(colors.yellow, '\n💡 提示: 管理员用户建议设置location为"任意"');
      colorLog(colors.yellow, '   这样管理员登录后可以直接进入系统，无需选择知识域');
    } else if (!user.location || user.location === '') {
      colorLog(colors.yellow, '\n💡 提示: 该用户登录后需要选择降临的知识域');
    }

  } catch (error) {
    if (error.code === 11000) {
      colorLog(colors.red, '\n错误: 用户名已存在！');
    } else {
      colorLog(colors.red, '\n更新用户失败: ' + error.message);
    }
  }
}

// 显示帮助
function showHelp() {
  colorLog(colors.cyan, '\n========================================');
  colorLog(colors.cyan, '用户管理工具 - 帮助');
  colorLog(colors.cyan, '========================================');

  console.log('\n使用方法:\n');

  console.log(`${colors.bright}1. 列出所有用户:${colors.reset}`);
  console.log(`   ${colors.green}node reset-user.js list${colors.reset}`);

  console.log(`\n${colors.bright}2. 查看特定用户:${colors.reset}`);
  console.log(`   ${colors.green}node reset-user.js view 用户名${colors.reset}`);
  console.log(`   例如: node reset-user.js view admin`);

  console.log(`\n${colors.bright}3. 创建/更新用户:${colors.reset}`);
  console.log(`   ${colors.green}node reset-user.js update${colors.reset}`);
  console.log(`   需要先在代码中修改 USER_CONFIG 配置`);

  console.log(`\n${colors.bright}配置示例:${colors.reset}`);
  console.log(`   ${colors.yellow}const USER_CONFIG = {${colors.reset}`);
  console.log(`     username: 'admin',          // 用户名`);
  console.log(`     password: '123456',         // 密码`);
  console.log(`     role: 'admin',              // 角色: 'admin' 或 'common'`);
  console.log(`     level: 1,                   // 等级`);
  console.log(`     experience: 0,              // 经验值`);
  console.log(`     location: '任意'            // 位置（管理员建议'任意'）`);
  console.log(`   ${colors.yellow}};${colors.reset}`);

  colorLog(colors.cyan, '\n========================================');
}

// 主函数
async function main() {
  try {
    // 连接数据库
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game');
    colorLog(colors.green, '✓ 已连接到数据库');

    const command = process.argv[2];

    switch (command) {
      case 'list':
        await listAllUsers();
        break;

      case 'view':
        await viewUser(process.argv[3]);
        break;

      case 'update':
        await updateUser(USER_CONFIG);
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
