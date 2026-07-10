# ToolPresentation Smoke 报告 (F-01)

- 生成时间: 2026-07-10T03:35:38.241Z
- commit sha: fd951b1eb32c89b3213b4c2ab4e135ed904f84cb
- 结果: 14 passed, 0 failed, 0 skipped

## 验收项

| 状态 | 验收项 | 详情 |
| --- | --- | --- |
| ✅ | F-01 普通模式不泄露下划线内部名（19 个 ActionType） | - |
| ✅ | F-01 codex-managed-app-server → Codex runtime（不泄露内部 provider id） | Codex runtime |
| ✅ | F-01 未知工具安全降级（Running tool / 正在执行工具，不泄露 payload） | en="Running tool" zh="正在执行工具" isUnknown=true |
| ✅ | F-01 Developer Mode 保留原始名称与输入（rawName / rawInput） | known.rawName=property_get unknown.rawName=mystery_tool |
| ✅ | F-01 普通模式 rawName/rawInput 为 undefined（不保留原始） | rawName=undefined |
| ✅ | F-01 双语：property_get → 读取笔记属性 / Read note property | zh="读取笔记属性" en="Read note property" |
| ✅ | F-01 双语：Read + path → 读取 AGENTS.md / Read AGENTS.md | zh="读取 AGENTS.md" en="Read AGENTS.md" |
| ✅ | F-01 resolveUiLocale 自动跟随 Obsidian 语言（zh-cn→zh, en→en, fr→en, 无 window→en） | zh=zh en=en fr=en none=en |
| ✅ | F-01 上下文摘要：property_get→读取《项目计划》的 tags / search→在 Vault 中搜索「foo」 | zh="读取《项目计划》的 tags" en="Read tags of "plan"" search="在 Vault 中搜索「foo」" |
| ✅ | F-01 风险等级：vault_delete/command_run=high, property_set=medium, property_get=low | del=high set=medium get=low |
| ✅ | F-01 ActionType 精确匹配优先于正则（tags_list→List vault tags，不被 list 正则误吞） | tags="List vault tags" cmd="List commands" tasks="List tasks" |
| ✅ | F-01 旧入口委托：toolLabelLegacy/toolIconCategoryLegacy/toolActivityLegacy 输出与既有断言一致 | read="Read AGENTS.md" grep="Search" |
| ✅ | F-01 present() 统一入口按 kind 分派（tool/action/provider） | tool="Read a.md" action="读取笔记属性" provider="Codex 运行时" |
| ✅ | F-01 group 高层分组（read/edit/search/external） | get=read create=edit search=search url=external bash=external |

## 验收标准对照

- 普通模式绝不显示 property_get / vault_delete / codex-managed-app-server 等内部名 ✅
- 未知工具有安全降级文案「正在执行工具」，不泄露原始 payload ✅
- 现有 toolDisplayLabel 逻辑迁移到 toolPresentation 单一入口 ✅
- Developer Mode 下保留原始名称和输入 ✅
- 双语表（zh/en）运行时按设置切换 ✅
