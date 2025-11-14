const User = require('../models/User');

async function isAdmin(req, res, next) {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role !== 'admin') {
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
