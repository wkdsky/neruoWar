# 数据库管理工具使用说明

## 1. 用户管理工具 (reset-user.js)

### 查看所有用户
```bash
node reset-user.js list
```

### 查看特定用户详情
```bash
node reset-user.js view 用户名
```
例如：
```bash
node reset-user.js view admin
node reset-user.js view bbb
```

### 创建或更新用户
1. 打开 `reset-user.js` 文件
2. 修改 `USER_CONFIG` 配置：
```javascript
const USER_CONFIG = {
  username: 'testuser',     // 用户名
  password: '123456',       // 密码
  role: 'common',           // 角色: 'admin' 或 'common'
  level: 0,                 // 等级
  experience: 0,            // 经验值
  location: '',             // 位置（管理员建议设为"任意"）
  allianceId: null          // 熵盟ID（可选）
};
```
3. 运行：
```bash
node reset-user.js update
```

### 字段说明
- **username**: 用户名（必填，唯一）
- **password**: 密码（必填，至少6个字符）
- **role**: 角色
  - `admin`: 管理员，可以管理所有节点和用户
  - `common`: 普通用户
- **level**: 用户等级（默认0）
- **experience**: 经验值（默认0）
- **location**: 降临的知识域
  - 管理员建议设为 `"任意"`，可以直接进入系统
  - 普通用户可以设为具体节点名或留空 `""`，登录后需要选择
- **allianceId**: 所属熵盟的ObjectId（可选，null表示未加入任何熵盟）

---

## 2. 节点管理工具 (reset-node.js)

### 查看所有节点
```bash
node reset-node.js list
```

### 查看特定节点详情
```bash
node reset-node.js view "节点名称"
```
例如：
```bash
node reset-node.js view "深度学习"
node reset-node.js view "人工智能"
```

### 设置节点域主
```bash
node reset-node.js set-master "节点名称" 用户名
```
例如：
```bash
node reset-node.js set-master "深度学习" admin
node reset-node.js set-master "人工智能" bbb
```

### 清除节点域主
```bash
node reset-node.js clear-master "节点名称"
```
例如：
```bash
node reset-node.js clear-master "深度学习"
```

### 更新节点状态
```bash
node reset-node.js status "节点名称" 状态
```
状态可选：
- `approved`: 已批准（正常显示）
- `pending`: 待审批（需要管理员审核）
- `rejected`: 已拒绝（不显示）

例如：
```bash
node reset-node.js status "深度学习" approved
node reset-node.js status "测试节点" rejected
```

### 域主相关说明
- **域主 (domainMaster)**: 节点的管理者，其所属的熵盟将管辖该节点
- **拥有者 (owner)**: 创建节点的用户
- 域主和拥有者可以是不同的用户
- 只有域主所属的熵盟才能统计该节点为管辖知识域
- 用户必须至少是一个节点的域主才能创建熵盟

---

## 3. 熵盟系统说明

### 熵盟特性
- 每个用户最多只能属于一个熵盟
- 管理员不能创建和加入熵盟
- 创建熵盟需要至少是一个知识域的域主
- 创建者自动成为熵盟成员
- 熵盟没有成员时自动解散

### 熵盟管辖知识域规则
- 节点的域主所属的熵盟，该节点就归属于该熵盟管辖
- 成员数量：统计所有用户的 `allianceId` 字段
- 管辖域数量：统计所有域主属于该熵盟的节点数量

### 示例流程
1. 创建用户并设置为某个节点的域主：
```bash
# 修改 reset-user.js 的 USER_CONFIG
# username: 'user1', password: '123456', role: 'common'
node reset-user.js update

# 设置为域主
node reset-node.js set-master "深度学习" user1
```

2. 该用户现在可以登录系统创建熵盟

3. 查看节点是否正确归属：
```bash
node reset-node.js view "深度学习"
# 应该显示：域主: user1
```

---

## 4. 常见操作

### 初始化管理员账户
```bash
# 1. 修改 reset-user.js 的 USER_CONFIG
const USER_CONFIG = {
  username: 'admin',
  password: '123456',
  role: 'admin',
  location: '任意'
};

# 2. 运行更新
node reset-user.js update
```

### 创建测试用户并设为域主
```bash
# 1. 创建用户
# 修改 USER_CONFIG: username: 'testuser'
node reset-user.js update

# 2. 设为某节点域主
node reset-node.js set-master "节点名称" testuser

# 3. 验证
node reset-node.js view "节点名称"
node reset-user.js view testuser
```

### 批量查看节点域主情况
```bash
node reset-node.js list
```
会显示所有节点的域主信息

---

## 5. 数据库字段变更说明

### User表新增字段
- `allianceId`: ObjectId类型，引用EntropyAlliance表，默认null

### Node表新增字段
- `domainMaster`: ObjectId类型，引用User表，默认null，表示节点的域主

### 新表：EntropyAlliance
- `name`: 熵盟名称（唯一）
- `flag`: 熵盟旗帜颜色代码（如 "#7c3aed"）
- `declaration`: 熵盟号召/宣言
- `founder`: 创始人用户ID
- `createdAt`: 创建时间
- `updatedAt`: 更新时间

---

## 6. 故障排查

### 如果后端启动失败
1. 检查MongoDB是否运行
2. 检查.env文件配置
3. 查看错误日志

### 如果节点域主设置失败
1. 确认节点名称正确（使用引号）
2. 确认用户存在：`node reset-user.js view 用户名`
3. 确认节点存在：`node reset-node.js view "节点名称"`

### 如果熵盟功能异常
1. 确保用户有正确的域主身份
2. 检查用户的allianceId字段
3. 检查节点的domainMaster字段

---

## 7. 帮助命令

```bash
# 用户管理帮助
node reset-user.js help

# 节点管理帮助
node reset-node.js help
```
