# 0.2.2 思考摘要显示修复

## 已核实的原因

通过本机 Codex 0.165.0 app-server 只读调用 `thread/turns/list`，使用 `itemsView: full` 检查“提交并 push”轮次：两条命令后面的 reasoning 条目为 `summary: []`、`content: []`。界面仍生成“思考摘要”折叠栏，展开后没有正文。这条历史记录没有可恢复的可见摘要。

另有独立的流式缺陷：`item/started` 返回的空数组在 JavaScript 中为真，原合并条件 `!existing.summary` 为假，后续摘要 delta 因此被忽略。原实现还把 summaryTextDelta 与 textDelta 拼在同一个字符串里，丢失分段并混淆了摘要与正文。

## 修复

- 没有可见文本的 reasoning 不生成空折叠栏，也不打断连续工具分组。
- 按实际文本是否为空合并流式字段，保留 `summaryIndex` / `contentIndex` 的段落顺序。
- summary 与 content 分别保存，摘要优先显示；只有原始正文时标为“思考过程”。
- `item/completed` 仍为最终权威内容，清理相应流式缓存；不生成、猜测或补写模型没有返回的文字。
- `turn/completed` 携带空 items 时保留已接收的条目。

## 验证及边界

新增回归覆盖空历史条目、展开非空摘要、段落 delta、摘要与原始正文隔离、最终内容替换、完成空 items 与重载。完整发行 bundle 在宿主 React 18 下也验证非空摘要显示与空摘要隐藏。

本次未生成额外模型轮次，未续聊或修改原始 Codex 数据。未进行登录后的 DSH 页面验收；不会将组件渲染测试称为真实页面验收。

协议依据：[OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server#items)：summary 与 content 是不同字段，摘要 delta 带分段索引，item/completed 是最终权威状态。
