const User = require('../models/User');

// 管理员用户名列表（可以改为从环境变量读取）
const ADMIN_USERNAMES = process.env.ADMIN_USERNAMES 
  ? process.env.ADMIN_USERNAMES.split(',') 
  : ['admin'];

async function isAdmin(req, res, next) {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (!ADMIN_USERNAMES.includes(user.username)) {
      return res.status(403).json({ error: '需要管理员权限' });
    }

    req.adminUser = user;
    next();
  } catch (error) {
    console.error('管理员验证错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
}

module.exports = { isAdmin };