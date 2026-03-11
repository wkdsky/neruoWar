# Sense Article Rich Editor Changelog

## 第一轮

- 从 `textarea + 简易模板按钮` 升级为 TipTap 富文本内核
- 建立 `legacy_markup` / `rich_html` 双格式兼容
- 打通 revision 存储、阅读态渲染、媒体上传链路
- 引入 sanitize-html 与富文本媒体节点

## 第二轮

- 修复 workflow 回归与测试失败
- rich compare 从纯文本兼容模式升级为块级 compare
- scoped 修订从“无感局部编辑”收敛为“整页编辑 + 范围定位高亮”
- 表格、媒体、toolbar 交互完成成熟第一版收口

## 第三轮

- 增加自动保存、本地恢复、离开保护
- 增加版本冲突检测
- 增加 HTML/Word 粘贴治理与 Markdown 导入
- 增加媒体引用追踪、孤儿候选状态、发布前校验
- 增加 legacy 迁移审计和媒体使用审计

## 第四轮

- 编辑页状态区重组为正式信息带
- 新增轻量帮助系统
- 新增长文章目录导航
- 优化 compare/review 空状态与摘要可读性
- 补齐开发/运维/迁移/QA/demo 文档
- 做 touched files 级别低风险清洁与可访问性收口
