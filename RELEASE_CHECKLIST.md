# Release Checklist

每次发布前按此清单逐项检查。所有项必须 ✅ 才能发布。

---

## 1. 代码与构建

- [ ] `npm run build` 成功（tsc 类型检查 + esbuild 打包 main.js）
- [ ] `main.js` 已重新生成，时间戳为最新
- [ ] `manifest.json` 的 `version` 已更新
- [ ] 无未提交的改动（`git status` 干净）

## 2. 测试

- [ ] `npm run test:unit` 全绿（0 failed，skipped 项有合理原因）
- [ ] `npm run test:process` 全绿（0 failed，skipped 项有合理原因）
- [ ] `npm run test:claude` 全绿或正确 skip（缺 claude 时 skip）
- [ ] `docs/test-report.md` 已重新生成，含测试时间、环境、插件版本

## 3. 手工 Smoke（manual required）

- [ ] mock-success：发送消息 → 显示 completed → 无错误
- [ ] mock-failure：发送消息 → 显示 failed → 错误摘要脱敏 → debug log 路径可点击复制
- [ ] auto + Claude 短消息：发送 → 收到回复
- [ ] 选区识别：编辑器选中文本 → Selection chip 显示字符数
- [ ] 当前笔记识别：打开笔记 → Note chip 显示文件名
- [ ] 生成文件可点击：运行结束后文件列表可点击打开
- [ ] 运行过程时间线：started / stdout / stderr / 终态 正确显示
- [ ] 空状态引导：首次打开显示 5 步引导 + Preflight 按钮
- [ ] 首次使用提示：可关闭，关闭后不再显示

### 3.1 V1.6 SDK Experimental Smoke（manual required，详见 docs/manual-smoke-v1.6.md）

- [ ] sdk-experimental 模式：发送消息 → 显示 SDK Workflow 区域（工具时间线 + 非工具事件）
- [ ] SDK 不可用时 fallback：sdk-experimental 仍产出 mock workflow 事件 + AgentEvent v0.1
- [ ] sdk-experimental 事件已脱敏：无完整 sk-ant / Bearer / password 明文
- [ ] sdk-experimental stop() 可中断：状态 → Stopped
- [ ] SDK 不影响 CLI：切回 auto 模式后 claude CLI 正常，无 SDK Workflow 区域
- [ ] auto/mock-success/mock-failure 不产生 SDK Workflow 区域（CLI 主线不回归）

## 4. 敏感信息扫描

- [ ] `node scripts/scan-sensitive.mjs` 通过（无 token / API key / .env / credentials）
- [ ] `git log --all -p | grep -iE "sk-ant|api[_-]?key|token="` 无敏感值命中
- [ ] `.llm-bridge/` 未入库（`.gitignore` 已排除）
- [ ] `bridge.json` / `.bridge-token` 未入库

## 5. Release zip 构建

- [ ] `npm run release` 成功生成 `release/llm-cli-bridge-<version>.zip`
- [ ] zip 内容只含 6 个文件：`main.js` / `manifest.json` / `styles.css` / `README.md` / `RELEASE_CHECKLIST.md` / `USER_GUIDE.md`
- [ ] zip 不含：源码 / node_modules / .llm-bridge / docs/test-report.md / 测试临时文件 / .git
- [ ] zip 内 `main.js` 与本地构建产物一致（大小或哈希核对）

## 6. 文档

- [ ] `README.md` 普通用户章节与当前功能一致（无已移除的按钮名称）
- [ ] `docs/USER_GUIDE.md` 步骤可走通
- [ ] `docs/BACKLOG.md` 已更新已知问题
- [ ] `docs/test-report.md` 已重新生成

## 7. 提交与推送

- [ ] 改动已提交（commit message 含版本号与变更摘要）
- [ ] 已推送到 `origin/master`
- [ ] 可选：打 tag `v<version>` 并推送

## 8. 发布后验证

- [ ] 在干净 Vault 中按 USER_GUIDE 步骤安装
- [ ] Preflight 通过
- [ ] 至少完成一次「总结当前笔记」端到端流程
- [ ] 至少完成一次「解释选区」端到端流程

---

## 历史发布

| 版本 | 日期 | Commit | 备注 |
|---|---|---|---|
| v1.0.1-rc.1 | 2026-06-28 | d281628 | 首个 release zip，36.9 KB |
| v1.3.0 | 2026-06-28 | b9b87e4 | Handoff Ready Polish，含 USER_GUIDE / BACKLOG / 统一 release 脚本，GitHub Release 已创建 |
| v1.5.0 | 2026-06-28 | d0c489d | Claude Code Command Support / Workflow Trace Foundation，新增命令预览区 + Workflow Trace |
| v1.6.0 | 2026-06-28 | 282b911 | SDK Workflow Event Prototype (experimental)，新增 sdk-experimental backend + UI-only WorkflowEvent 模型，默认关闭，CLI 主线不变 |
| v1.7.0 | 2026-06-28 | d07f4de | Real SDK Workflow Enhancement，接入真实 Claude Agent SDK 事件流（双包名兼容）+ SDKMessage→WorkflowEvent 纯函数映射 + SDK diagnostics，SDK 不可用时 fallback mock，CLI 主线不变 |
| v1.8.0 | 2026-06-28 | d1e6267 | Real User Flow Consolidation，3 核心用户流收敛 + workflow trace/timeline/sdk workflow 默认折叠 + onboarding 简化为 3 步用户导向 + README 3 步使用法，不新增功能 |
| v2.0.0 | 2026-06-28 | 0276352 | Agent State / Session / Workflow UX + SDK Workflow Deepening，会话概念(title/new/clear) + 会话状态区(4面板) + 运行流程区(6步) + Skills 入口(.llm-bridge/skills.md) + thinking/completed/failed WorkflowEvent + tool durationMs + 按阶段分组 UI + error 复制按钮 + diagnostics errorSummary，不修改 AgentEvent v0.1，CLI 主线不变 |
| v2.1.0 | 2026-06-28 | 1c1f57f | Skills Pack / Workflow Preset as Data，5 个默认 skill(总结/解释/整理/提取待办/改写) 数据驱动从 .llm-bridge/skills.md 读取 + 启用/禁用(disabledSkills 持久化) + {{outputDir}} 占位符替换 + seed 初始化按钮(不覆盖) + secret 脱敏(redactSkillForLog)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭 |
| v2.2.0 | 2026-06-28 | 5d6227e | Core Flow End-to-End Smoke / Real Vault Flow，验证插件主流程在真实 Vault 中完整可用（自动化测试全绿 + 20 项 manual required 手工验证清单）+ 约束确认(AgentEvent v0.1 未改/sdk-experimental 默认关闭/不绑定固定输出目录/不新增业务模板)，不新增功能，不改 Skills 系统，生成 docs/e2e-smoke-v2.2.md |
| v2.3.0 | 2026-06-28 | 95a2431 | Permission Policy / Skills Install / SDK Process UX，权限分级(low/medium/high)+会话级授权缓存+批量授权UI + Skills 本地导入(.llm-bridge/skills/)+启用/禁用/删除+敏感扫描+长度截断(8000) + SDK agent/subagent 事件标识(sessionId/parentToolUseId)+按 agent 分组渲染 + 状态栏扩展(Perm/Skills/Tools/Agents) + 权限策略设置项，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 20 个 V2.3 单元测试 |
| v2.3.1 | 2026-06-28 | c4c191e | SDK Permission Bridge / Skills Install UX，SDK permissionMode 扩展到 6 种(default/acceptEdits/plan/auto/dontAsk/bypassPermissions)+中文风险解释 + canUseTool 异步回调接入 sdkPermission 模块(assessToolRisk/decideByMode/会话缓存/请求合并) + 权限请求实时面板(工具名/参数摘要/风险等级/来源 agent/允许一次/本会话允许/拒绝) + high-risk 明确提示(删除/Shell/Vault外/.obsidian/env/网络) + subagent 权限继承风险提示 + PermissionEvent 扩展字段(inputSummary/riskLevel/highRiskFlags/mergeKey/pending/requestId) + 脱敏增强 + 权限历史渲染，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 24 个 V2.3s 单元测试 |
| v2.3.2 | 2026-06-28 | 6d2924c | Permission Safety Gate，修正 decideByMode：auto 模式 high 不自动允许(返回 ask) + acceptEdits high 返回 ask + default medium/high 返回 ask + CanUseToolDecision 增加 ask 语义 + canUseTool 统一调用 decideByMode 作为唯一真相源(消除重复 low 自动允许逻辑) + auto/bypassPermissions 中文风险文案更新(Safety Gate/显式选择) + bypassPermissions 仅开发者显式选择放行，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 15 个 V2.3.2 单元测试 |
| v2.4.0 | 2026-06-28 | f316842 | Core UX Consolidation / SDK Runtime Fix，SDK 运行时路径解析支持 sibling 布局(<vault>/../LLM-AgentRuntime，resolveRuntimeDirs 统一候选目录) + plan 权限语义修正(low 只读允许/medium+high 拒绝，与文案一致) + Skills 导入删除一致性(importSkillFromFile 改用 skillNameToFileName(skill.name)) + UI 首屏降噪(状态栏 Advanced 高级指标默认折叠 + Command Preview 默认折叠) + 4 项 UX 修复(Preflight 缓存切换/刷新失效 + debug log 指向具体文件 + Mode chip 移除 + New 按钮去重) + CLI PATH 增量补 sibling .bin，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 17 个 V2.4 单元测试 |
| v2.5.0 | 2026-06-28 | d6ea9ee | Daily Use UX Foundation / Skills + Session Persistence，Skills 增强(updateImportedSkill 编辑/重命名 + searchSkills 搜索过滤 + checkImportConflict 冲突检测 + 查看完整 prompt 弹窗 + 导入冲突覆盖确认) + 会话历史持久化(sessions.ts: save/load/list/delete + version 字段 + tmp+rename 原子写 + redactSecrets 脱敏 + MAX_SESSIONS_KEPT 淘汰) + History 面板(默认折叠，列表/恢复/删除确认) + onRunFinished 自动保存会话 + New 会话确认 + EditSkillModal，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 28 个 V2.5 单元测试 |
| v2.6.0 | 2026-06-29 | a0b7427 | Skills 体验深化，#标签分组(extractTags 从 description 行末提取 #标签 + parse/serialize 往返一致 + searchSkills 支持 #标签语法与普通查询匹配 tags) + Skills State 持久化(.llm-bridge/skills-state.json: SkillMeta pinned/sortOrder/collapsed/groupOverride/applyCount/lastUsedAt + version=1 + tmp+rename 原子写 + 失败不阻断 + 不存 prompt/secret) + 分组与排序(分组下拉 全部/未分组/标签 + 排序下拉 名称/最近/最常用 + 置顶📌) + 片段插入/追加(点击 skill 名=insertSkillAtCursor 光标位置插入 + "+"按钮=appendSkillToInput 末尾追加) + skill 链式组合(勾选框 + 组合应用按钮 + 按出现顺序拼接 \n\n---\n\n 分隔 + 记录 lastCombo) + 使用统计(applyCount×N + lastUsedAt 相对时间 formatRelativeTime) + 不可变更新(recordSkillApplied/setSkillPinned/setSkillGroupOverride/recordCombo 不修改原 state) + 损坏 ISO/JSON 容错，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 34 个 V2.6 单元测试 |
