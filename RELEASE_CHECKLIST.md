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
| v2.6.0 | 2026-06-29 | 4726356 | Skills 体验深化，#标签分组(extractTags 从 description 行末提取 #标签 + parse/serialize 往返一致 + searchSkills 支持 #标签语法与普通查询匹配 tags) + Skills State 持久化(.llm-bridge/skills-state.json: SkillMeta pinned/sortOrder/collapsed/groupOverride/applyCount/lastUsedAt + version=1 + tmp+rename 原子写 + 失败不阻断 + 不存 prompt/secret) + 分组与排序(分组下拉 全部/未分组/标签 + 排序下拉 名称/最近/最常用 + 置顶📌) + 片段插入/追加(点击 skill 名=insertSkillAtCursor 光标位置插入 + "+"按钮=appendSkillToInput 末尾追加) + skill 链式组合(勾选框 + 组合应用按钮 + 按出现顺序拼接 \n\n---\n\n 分隔 + 记录 lastCombo) + 使用统计(applyCount×N + lastUsedAt 相对时间 formatRelativeTime) + 不可变更新(recordSkillApplied/setSkillPinned/setSkillGroupOverride/recordCombo 不修改原 state) + 损坏 ISO/JSON 容错，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 34 个 V2.6 单元测试 |
| v2.7.0 | 2026-06-29 | fb89b1e | 稳定性加固，数据完整性/迁移(sessions.ts migrateSession 迁移框架：version 字段+高版本不降级+字段缺失/类型错误返回 null + skillsState.ts .bak 备份回滚 + sanitizeSkillMeta 字段校验过滤无效条目 + lastCombo 过滤非字符串) + 性能优化(view.ts 搜索防抖 300ms skillsSearchDebounceTimer + state 写入节流 500ms scheduleSkillsStateSave 合并多次 IO + 长会话折叠 messagesFoldExpanded >8 条显示最近 8 + 展开更早 N 条按钮) + 错误边界/崩溃防护(renderMessage/renderSkillsList/renderHistoryList try/catch + renderMessageError/renderListError fallback + fallback 自身失败静默忽略 + doNewSession/restoreSession 重置折叠状态) + SDK 会话支持铺路(src/sessionContext.ts: SessionContext 抽象 mode fresh/continue/resume + source cli/sdk/local + buildCliSessionContext/buildSdkSessionContext/buildLocalSessionContext 工厂 + needsSessionResume/isContinueMode/sessionContextLabel 判断，纯类型无副作用，不启用真实联调)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，新增 45 个 V2.7 单元测试 |
| v2.8.0 | 2026-06-29 | 9a41e09 | 会话恢复深化，恢复一致性提示(restoreSession 时 agentType 不一致弹 Notice 提示，不强制切换 backend) + 文件引用增强(openGeneratedFile 失败时弹 showFileNotFoundModal 显示完整路径 + 复制按钮，替代原 Notice) + session 标题手动编辑(sessions.ts renameSession 原子写仅改 title+savedAt + view.ts ✎编辑按钮 + promptDialog 通用输入对话框 + 原地更新 historyItems + 当前活动会话同步 sessionState.title) + 恢复后滚动定位(restoreSession 末尾 scrollToBottom) + 排序选项(History 面板排序下拉 按时间/按消息数 + historySortMode 字段 + renderHistoryList 副本排序不修改原数组) + 删除后原地刷新(deleteHistorySession 改为 historyItems.filter + renderHistoryList，不重新 listSessions)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，SESSION_SCHEMA_VERSION 不变(仍为 1)，新增 19 个 V2.8 单元测试 |
| v2.9.0 | 2026-06-29 | e922ce4 | 性能优化+搜索，findToolParentAgent O(N²)→O(1)(buildToolTimeline 预记录 parentToolUseId 到 ToolTimelineEntry，appendSdkWorkflow 用 entry.parentToolUseId 做 O(1) 分组，移除 findToolParentAgent 线性扫描方法) + scrollToBottom rAF 批处理(requestAnimationFrame 合并同帧多次调用，scrollRafId 跟踪 pending 状态，onClose 用 cancelAnimationFrame 清理) + listSessions 5s 缓存(refreshHistory(force=false) + historyLastLoadAt 时间戳守卫，↻ 按钮与运行后保存传 force=true) + History 搜索框(300ms 防抖 + 标题子串过滤大小写不敏感 + historyBodyEl/listContainer 分离避免搜索框被 empty() 清空 + countLabel 显示「匹配数/总数」)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，SESSION_SCHEMA_VERSION 不变(仍为 1)，新增 23 个 V2.9 单元测试 |
| v2.10.0 | 2026-06-29 | e4f116c | Bug Fix，B-001 选区/笔记 chip 不稳定(view.ts 额外订阅 workspace.on("file-open") 事件，同 pane 内切换文件时 chip 立即更新，补充 active-leaf-change 不触发的场景) + B-002 timeline/workflow trace detail 截断无 tooltip(appendTimeline + appendWorkflowTrace 的 detail span 加 attr title=entry.detail，CSS 截断后鼠标悬停可看完整内容) + B-003 首次使用提示关闭后无法重显(settings.ts 新增「重新显示首次使用提示」按钮，点击 removeItem localStorage llm-bridge-guide-dismissed) + B-018 fileDiff 串行 stat 大 Vault 性能差(snapshotVaultMarkdownFiles 重构为两阶段：第一遍 BFS 收集所有 md 路径只 readdir，第二遍分批 Promise.all 并行 stat，STAT_BATCH_SIZE=64 避免超大 Vault 同时打开过多句柄，EXCLUDE_DIRS/shouldExclude/isMarkdownFile 不变) + B-019 切换 backendMode 后 view 不刷新(settings.ts onChange 调用 plugin.refreshBridgeView()，main.ts 新增公开 refreshBridgeView() 分发到 view.refreshOnSettingsChange()，view.ts 新增公开 refreshOnSettingsChange() 调用 syncControlsFromSettings + refreshStatusBar，状态栏 Backend 值立即更新)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，SESSION_SCHEMA_VERSION 不变(仍为 1)，新增 20 个 V2.10 单元测试 |
| v2.11.0 | 2026-06-29 | cf49292 | Bug Fix，B-010 scan-sensitive.mjs 误报测试假数据(scan-sensitive.mjs 新增 SCAN_EXCLUDE_DIRS 集合跳过 node_modules/.git/.llm-bridge/dist/build 目录 + --strict 标志默认 false 启用全扫描 + TEST_FIXTURE_MARKERS 测试假数据关键词集合 + isTestFile 文件级判断整体跳过测试文件 PATTERN 扫描 + isTestFixture 上下文判断 ±5 行用 lastIndexOf/indexOf 优化避免大文件 split + 主循环非 strict 模式跳过测试文件 + 输出含跳过数提示) + 修复 re.exec 死循环 bug(原 PATTERNS 正则无 g 标志，while 循环中 re.exec 总返回同一匹配导致 ENOBUFS 缓冲区溢出，强制添加 g 标志推进 lastIndex)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，SESSION_SCHEMA_VERSION 不变(仍为 1)，新增 18 个 V2.11 单元测试 |
| v2.11.1 | 2026-06-29 | 7ddf9fd | Skills State Integrity / Lifecycle Cleanup，skill 重命名 meta 迁移(skillsState.ts 新增 renameSkillMeta 迁移 pinned/applyCount/lastUsedAt/groupOverride/sortOrder/collapsed 到新名称 + view.ts openEditSkillDialog 重命名时调用) + tags 编辑保留(skills.ts updateImportedSkill 从 newDescription 重新 extractTags 替代原 tags:[] + view.ts EditSkillModal 描述框预填原始描述+#标签) + onClose flush(view.ts onClose 立即写入 skillsStateSaveTimer 待写 state + 清理 skillsSearchDebounceTimer) + groupOverride future 标注(skillsState.ts 注释标明当前 UI 未实现手动分组留作 future 扩展) + 组合应用勾选顺序(view.ts applyCombo 改用 Set 插入顺序即勾选顺序替代原可见列表顺序) + session defense-in-depth 脱敏(sessions.ts redactSessionMessages 扩展脱敏 timeline/timelineEvents/commandPreview/workflowTrace/workflowEvents/sdkEvents 嵌套字段 + redactSdkEventForSession 处理 WorkflowEvent 联合类型各 string 字段) + 设置页关键配置刷新(settings.ts agentType/claudePermissionMode/permissionPolicy onChange 调用 refreshBridgeView 统一刷新状态栏)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，SESSION_SCHEMA_VERSION 不变(仍为 1)，SKILLS_STATE_VERSION 不变(仍为 1)，新增 24 个 V2.11.1 单元测试 |
| v2.12.0 | 2026-06-29 | e61ceb7 | Long Flow E2E / Real Daily Smoke，验证型工作单元不新增功能不修改 src/ 业务代码，新增 8.20 测试段 38 个代码级断言覆盖(约束确认 AgentEvent v0.1 不变/sdk-experimental 默认关闭/CLI 主线不回归 + UI 默认折叠 Skills/History/Advanced/createCollapsibleSection startOpen=false + tooltip timeline/workflow trace/sdk event detail 含 attr title + 权限策略 low auto_allow/high needs_approval/medium+high 不静默/medium+medium 不静默 + stop 清理 stopBtn 绑定/onClose runHandle.stop()/onClose 清理 scrollRafId + 错误体验 showFileNotFoundModal 完整路径/复制按钮/debug log 路径可复制 + Skills 搜索框防抖/分组下拉/置顶按钮/使用统计/V2.11.1 renameSkillMeta 不回归/V2.11.1 组合勾选顺序不回归 + Session 历史搜索/标题重命名/删除会话/恢复会话/V2.11.1 defense-in-depth 脱敏不回归 + 核心流 inputEl/Selection chip/Note chip/openGeneratedFile/presetPrompts + 报告输出 docs 目录/e2e-smoke-v2.2.md 模板) + 输出 docs/e2e-smoke-v2.12.md 报告(7 项约束确认 + 自动化测试结果 562/62/55 passed 0 failed + 35 项 manual required 手工验证清单覆盖核心用户流 7/Skills 7/Session 6/权限停止 4/UI 7/错误体验 3/session 文件扫描 1 + V2.11.1 修复回归确认 8/8 + 敏感信息扫描 4/4 自动化项通过)，不修改 AgentEvent v0.1，CLI 主线不变(test:process 62 passed + test:claude 55 passed 真实执行)，sdk-experimental 仍默认关闭，SESSION_SCHEMA_VERSION 不变(仍为 1)，新增 38 个 V2.12 单元测试 |
| v2.12.1 | 2026-06-29 | 00ad47e | Skill Rename Meta Runtime Patch，修复 ManualId 13 blocker(导入 skill 重命名后 pinned/applyCount/lastUsedAt/groupOverride 未迁移到新名称)，根因(scheduleSkillsStateSave 500ms 防抖定时器 + refreshSkills 立即从磁盘重载 state 时序冲突导致内存迁移被覆盖)，修复(view.ts 新增 flushSkillsStateSave() 方法抽取自原 onClose flush 逻辑 + openEditSkillDialog 改为 renameSkillMeta 后 await flushSkillsStateSave() 立即落盘再 refreshSkills + onClose 复用 flushSkillsStateSave 消除内联重复)，新增 8.21 测试段 20 个测试覆盖(flushSkillsStateSave 代码级存在/timer===null 提前返回/saveSkillsState 落盘 + openEditSkillDialog 调用链路/renameSkillMeta 后 flush/flush 在 refresh 之前/不再调用 scheduleSkillsStateSave + onClose 复用/不再内联 + 真实保存路径集成测试 导入→pin/apply/groupOverride→updateImportedSkill→renameSkillMeta→flush→reload 验证新名 meta 完整 + 旧名孤儿清理 + 磁盘 skills 文件重命名 + 字段完整性 pinned/applyCount/lastUsedAt/groupOverride 全部迁移 + 时序冲突回归 重现 bug scheduleSkillsStateSave 路径丢失迁移 + 验证修复 flushSkillsStateSave 路径保留迁移 + EditSkillModal 保存按钮触发 onConfirm + openEditSkillDialog updateImportedSkill/checkImportConflict/newName!==skill.name + 约束确认 AgentEvent v0.1 不变/sdk-experimental 默认关闭/schema 不变/CLI 主线不回归)，不修改 AgentEvent v0.1，CLI 主线不变，sdk-experimental 仍默认关闭，SESSION_SCHEMA_VERSION 不变(仍为 1)，SKILLS_STATE_VERSION 不变(仍为 1)，新增 20 个 V2.12.1 单元测试 |
