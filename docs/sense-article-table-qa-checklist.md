# 百科表格系统 QA Checklist

## 1. 插入与基础结构

- 插入 2x2、3x3、4x4 表格，确认未报错
- 插入时切换 `default / compact / zebra / three-line`，确认编辑态和保存后回显一致
- 插入时切换宽度模式 `auto / narrow / medium / wide / full`，确认编辑态、保存后再打开、阅读态一致
- 勾选首行表头、首列表头，确认 `th/td` 结构和回显一致

## 2. 表格上下文工具带

- 光标进入表格后，`TableContextBand` 出现在主工具栏下方
- 光标移出表格后，`TableContextBand` 消失
- 多单元格选区时，band 状态文案显示选区范围与格数
- merge 可用时，band 状态提示“当前选区可合并”
- merge 不可用时，band 能提示原因
- split 可用时，band 能提示当前在合并单元格上
- 删除行/列被 merged cell 拦截时，有明确用户可见提示

## 3. 选区与视觉反馈

- 单个单元格选中时，当前活动 cell 高亮明显
- 多单元格选中时，框选区域高亮明显
- merged cell 被选中或命中时，视觉上有额外提示
- 列宽 resize handle 可见
- 表格整体宽度 handle 可见且不遮挡正文输入

## 4. 宽度与列宽

- 整体宽度拖拽后，`tableWidthValue` 持久化成功
- 保存后再次打开，整体宽度恢复
- 列宽拖拽后，`data-colwidth` / `data-column-widths` 持久化成功
- 保存后再次打开，列宽恢复
- 阅读态下列宽表现正常

## 5. 多单元格格式

- 多选单元格后批量设置背景色，所有选中单元格生效
- 多选单元格后批量设置文字色，所有选中单元格生效
- 多选单元格后批量设置水平对齐，所有选中单元格生效
- 多选单元格后批量设置垂直对齐，所有选中单元格生效

## 6. 边框系统

- 切换表格边框 preset：
  - `all`
  - `none`
  - `outer`
  - `inner-horizontal`
  - `inner-vertical`
  - `three-line`
- preset 在编辑态、保存后再打开、阅读态一致
- 多选单元格后切换上/下/左/右边框，不出现明显混乱
- 多选单元格后批量设置边框粗细，结果一致
- 多选单元格后批量设置边框颜色，结果一致
- 清除单元格边框覆盖后，单元格回退到 table preset 观感
- 确认“cell 显式边框 > table preset”

## 7. merge / split

- 合法矩形选区可以合并
- 非法选区不能合并，且会提示原因
- merge 后内容汇总进左上角单元格
- merge 后格式以左上角单元格为主
- 单个已合并单元格可以拆分
- split 后内容保留在左上角
- split 后新单元格为空
- split 后格式按当前规则保留
- 删除行/列前若命中 merged cells，会先阻止并提示

## 8. 三线表与斜线单元格

- 三线表在编辑态看起来像正式文档表格
- 三线表在阅读态边线完整，表头分隔清楚
- header cell 设置 `tl-br` 后编辑态可见
- header cell 设置 `tl-br` / `tr-bl` 后阅读态可见
- 非 header cell 使用 diagonal 时，validation 会给 warning

## 9. compare / review / validation

- compare 能识别表格样式变化
- compare 能识别宽度变化
- compare 能识别列宽摘要变化
- compare 能识别边框 preset 变化
- compare 能识别 diagonal 变化
- compare 能识别 merge/split 结构变化
- compare 能显示 merge 区域摘要
- validation 能识别非法 `tableStyle`
- validation 能识别非法 `tableBorderPreset`
- validation 能识别非法宽度值
- validation 能识别非法 `columnWidths`
- validation 能识别非法 `rowspan/colspan`
- validation 保留空表格 warning

## 10. 阅读态 / 小屏 / 长表格

- 阅读态表格有横向滚动容器，不挤爆布局
- 小屏下 `TableContextBand` 会换行，不会一行炸开
- 小屏下表格 popover 不超出视口
- 长表格阅读时视觉负担可接受
- merged cell 在阅读态边界清晰
- 宽表格在阅读态滚动自然

## 11. 回归与兼容

- 旧表格 rich_html 仍能正常打开
- 旧表格未补新 attrs 时有合理默认值
- sanitize 不会放开任意 style
- 保存后再次打开，表格 attrs 不丢失
- compare / review 没有因为新表格属性报错
