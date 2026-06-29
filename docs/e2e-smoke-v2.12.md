# V2.12 Long Flow E2E / Real Daily Smoke 报告

> 目标：在真实 Obsidian 测试 Vault 中验证日常长流程可用性，不新增功能，不做 SDK 真实联调，不做 release 打包。
> 本报告分两部分：自动化代码级验证（已通过）+ 真实 Obsidian UI 手工验证清单（manual required）。

## 测试环境

| 项目 | 值 |
|---|---|
| 测试时间 | 2026-06-29 |
| 插件版本 | 2.12.0 |
| Node | v24.14.0 |
| Platform | win32 |
| Claude CLI | 2.1.195 (Claude Code) |
| main.js | 309.9 KB（317298 bytes） |
| 测试 Vault | `D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki` |
| bridge.json | exists（token 已脱敏，不写入本报告） |
| HTTP 端口 | 63019（运行时动态分配） |
| BackendMode | auto（CLI 主线，sdk-experimental 默认关闭） |

---

## 1. 约束确认（自动化代码级验证，已通过）

| 约束 | 状态 | 证据 |
|---|---|---|
| 不改 AgentEvent v0.1 | ✅ 通过 | `src/agentBackend.ts:33-76` AgentEvent 联合类型含 6 事件（started/stdout_delta/stderr_delta/completed/failed/stopped），注释明确"不新增 tool event" |
| 不新增 tool event | ✅ 通过 | WorkflowEvent 为 UI-only，不混入 AgentEvent；AgentEvent 联合类型未扩展 |
| CLI/auto 主线稳定 | ✅ 通过 | `test:process` 62 passed, 0 failed；`test:claude` Claude Smoke 真实执行成功（version 2.1.195） |
| sdk-experimental 默认关闭 | ✅ 通过 | `src/types.ts:110` `backendMode: "auto"`（DEFAULT_SETTINGS） |
| 不新增功能 | ✅ 通过 | V2.12 仅新增测试段与验证报告，未修改 src/ 业务代码 |
| 不做 SDK 真实联调 | ✅ 通过 | V2.12 测试段无真实 SDK query 调用 |
| 不做 release 打包 | ✅ 通过 | V2.12 不生成 release zip |

---

## 2. 自动化测试结果

### build
- `npm run build` — ✅ 通过（tsc -noEmit -skipLibCheck + esbuild production，无 TS 错误）

### test:unit
- 结果：**562 passed, 0 failed, 22 skipped, 0 manual required**
- V2.12 新增段：**38 个代码级断言**（全部通过）
- 覆盖：
  - 约束确认（3 项）：AgentEvent v0.1 不变 / sdk-experimental 默认关闭 / CLI 主线不回归
  - UI 默认折叠（4 项）：Skills 面板 / History 面板 / Advanced 指标区 / createCollapsibleSection startOpen=false
  - tooltip（3 项）：timeline detail / workflow trace detail / SDK event detail 均含 `attr title`
  - 权限策略（4 项）：low auto_allow / high needs_approval / medium+high 不静默 / medium+medium 不静默
  - stop 清理（3 项）：stop 按钮绑定 / onClose runHandle.stop() / onClose 清理 scrollRafId
  - 错误体验（3 项）：showFileNotFoundModal 完整路径 / 复制按钮 / debug log 路径可复制
  - Skills 验证（6 项）：搜索框+防抖 / 分组下拉 / 置顶按钮 / 使用统计 / V2.11.1 重命名 meta 迁移 / V2.11.1 组合勾选顺序
  - Session 验证（5 项）：历史搜索 / 标题重命名 / 删除会话 / 恢复会话 / V2.11.1 defense-in-depth 脱敏
  - 核心用户流（5 项）：自由提问输入框 / Selection chip / Note chip / openGeneratedFile / presetPrompts
  - 报告输出（2 项）：docs 目录存在 / e2e-smoke-v2.2.md 模板存在

### test:process
- 结果：**62 passed, 0 failed, 46 skipped, 0 manual required**
- 覆盖：Process 启动/stdout/stderr/exit/stop/cwd 带空格/large-output；Preflight 真实探测；File Diff fixture

### test:claude
- 结果：**55 passed, 0 failed, 44 skipped, 0 manual required**
- 覆盖：Claude Smoke version 2.1.195 / started / stdout_delta / completed exitCode 0；Note Summarize 真实执行

---

## 3. 真实 Obsidian UI 手工验证清单（manual required）

> 以下项目需在真实 Obsidian Vault（`D:\Users\Ye_Luo\APP\Test\Obsidian\LLM-Wiki`）中加载插件后手工执行。
> 自动化代码级断言已确认代码逻辑存在，但真实交互闭环需人工验证。

### 3.1 核心用户流（manual required，要求 3）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 1 | 自由提问 | 打开 Bridge View → 输入框输入任意问题 → Ctrl+Enter 发送 | 消息出现在对话区，状态点 Running→Done，收到 Claude 回复 | ☐ 待验证 |
| 2 | 解释选区 | 编辑器选中文本 → Bridge View 显示 Selection chip 字符数 → 点击「解释选区」preset → 发送 | prompt 含选中文本，Claude 返回解释 | ☐ 待验证 |
| 3 | 总结当前笔记 | 打开笔记 → Bridge View 显示 Note chip 文件名 → 点击「总结当前笔记」preset → 发送 | prompt 含笔记内容，Claude 返回总结，生成 -summary 文件可点击 | ☐ 待验证 |
| 4 | 应用单个 Skill 后运行 | Skills 面板点击某 skill（如「改写润色」）→ prompt 注入 → 编辑后发送 | prompt 含 skill 指令，{{outputDir}} 已替换，Claude 按指令执行 | ☐ 待验证 |
| 5 | 组合应用多个 Skill | 勾选 2+ skill（注意勾选顺序）→ 点击「组合应用」→ 发送 | prompt 按勾选顺序拼接，顺序与勾选一致（V2.11.1 修复） | ☐ 待验证 |
| 6 | 生成/修改 Markdown | 运行结束后观察生成文件列表 | 显示新增/修改的 .md 文件，点击在 Obsidian 中打开 | ☐ 待验证 |
| 7 | 恢复历史会话 | 运行至少一次任务（触发自动保存）→ History 面板点击某会话 | 消息/状态/生成文件/workflow trace 完整恢复 | ☐ 待验证 |

### 3.2 Skills 验证（manual required，要求 4）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 8 | 搜索 | Skills 面板搜索框输入关键词 | 列表按名称/描述/#标签过滤（300ms 防抖） | ☐ 待验证 |
| 9 | 标签分组 | 分组下拉选择某 #标签 | 仅显示该标签下的 skill | ☐ 待验证 |
| 10 | 置顶 | 点击某 skill 的 📌 按钮 | skill 排到分组最前，meta pinned=true 持久化 | ☐ 待验证 |
| 11 | 使用统计 | 多次应用同一 skill 后观察 | applyCount 递增，lastUsedAt 更新，排序按 recent/popular 变化 | ☐ 待验证 |
| 12 | 编辑导入 Skill 后 tags 不丢 | 编辑某导入 skill 的描述（含 #标签）→ 保存 | tags 从 description 重新 extractTags，不丢失（V2.11.1 修复） | ☐ 待验证 |
| 13 | 重命名后 meta 保留 | 编辑某导入 skill 改名 → 保存 | pinned/applyCount/lastUsedAt 迁移到新名（V2.11.1 renameSkillMeta） | ☐ 待验证 |
| 14 | 组合应用顺序 | 勾选 C→A→B 三个 skill → 组合应用 | prompt 顺序为 C→A→B（Set 插入顺序，V2.11.1 修复） | ☐ 待验证 |

### 3.3 Session 验证（manual required，要求 5）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 15 | 自动保存 | 运行任一任务 → 查看 `.llm-bridge/sessions/` 目录 | 新增 session json 文件，含完整 messages + workflow trace | ☐ 待验证 |
| 16 | 历史搜索 | History 面板搜索框输入标题关键词 | 列表按标题子串过滤（大小写不敏感，300ms 防抖） | ☐ 待验证 |
| 17 | 标题重命名 | History 面板点击 ✎ → 输入新标题 → 确认 | title 更新，savedAt 刷新，其他字段不变 | ☐ 待验证 |
| 18 | 恢复消息/状态/生成文件/workflow trace | 点击某历史会话 → 观察 | 消息列表 + 状态 + 生成文件 + workflow trace 完整恢复 | ☐ 待验证 |
| 19 | 删除确认 | 点击某会话删除按钮 → 确认对话框 | 删除后列表刷新，文件从磁盘移除 | ☐ 待验证 |
| 20 | session 文件不落 secret 明文 | 用文本编辑器打开 `.llm-bridge/sessions/*.json` | content/stderr/log/timeline/commandPreview/workflowTrace/sdkEvents 均脱敏（V2.11.1 defense-in-depth） | ☐ 待验证 |

### 3.4 权限和停止验证（manual required，要求 6）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 21 | low 自动允许 | 设置 permissionPolicy=low/medium → 触发读操作（如 open_note） | low 风险 auto_allow，无弹窗 | ☐ 待验证 |
| 22 | medium/high 不静默放行 | 设置 permissionPolicy=medium → 触发 medium 风险写操作 | 弹窗需本轮授权（needs_approval） | ☐ 待验证 |
| 23 | high 不静默 | 触发 high 风险操作（删除/Vault外） | 始终 needs_approval，即使 policy=low | ☐ 待验证 |
| 24 | stop 时 pending permission 不挂死 | 触发需授权操作 → 弹窗等待时点 Stop | runHandle.stop() 终止运行，pendingActions 标记 cancelled，无挂死 | ☐ 待验证 |

### 3.5 UI 验证（manual required，要求 7）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 25 | 首屏不拥挤 | 打开 Bridge View 首屏 | 仅显示输入框 + 选区/笔记 chip + 状态栏；Skills/History/Advanced 默认折叠 | ☐ 待验证 |
| 26 | Skills 默认折叠 | 打开 Bridge View | Skills 面板 ▶ 折叠态，点击展开 | ☐ 待验证 |
| 27 | History 默认折叠 | 打开 Bridge View | History 面板 ▶ 折叠态，点击展开 | ☐ 待验证 |
| 28 | Advanced 默认折叠 | 打开 Bridge View | Advanced 指标区隐藏，点击展开 | ☐ 待验证 |
| 29 | 选区/笔记 chip 切换稳定 | 切换不同笔记 / 选中文本/取消选中 | chip 实时更新（V2.10 B-001 file-open 订阅修复） | ☐ 待验证 |
| 30 | timeline tooltip | 运行任务 → 展开 timeline → 鼠标悬停被截断的 detail | 显示完整 detail（attr title） | ☐ 待验证 |
| 31 | workflow trace tooltip | 运行任务 → 展开 workflow trace → 悬停截断内容 | 显示完整 detail | ☐ 待验证 |

### 3.6 错误体验验证（manual required，要求 8）

| # | 验证项 | 步骤 | 预期结果 | 实际结果 |
|---|---|---|---|---|
| 32 | 错误摘要可读 | 触发失败（如断网或错误命令） | 错误摘要脱敏（无 token/key 明文），含 exit code | ☐ 待验证 |
| 33 | debug log 指向具体文件 | 失败后查看错误区 | 显示 debug log 路径，可点击复制 | ☐ 待验证 |
| 34 | 生成文件丢失完整路径+复制 | 删除生成的 .md 文件 → 点击文件列表中的丢失项 | 弹 showFileNotFoundModal，显示完整路径 + 复制按钮 | ☐ 待验证 |

---

## 4. 敏感信息扫描

| 扫描项 | 状态 |
|---|---|
| 本报告无 token/key/env/logs 明文 | ✅ 通过（bridge.json token 未写入报告） |
| 本报告无调试日志明文 | ✅ 通过 |
| 自动化测试 debug log 不含 secret | ✅ 通过（test:process 验证） |
| session 文件 defense-in-depth 脱敏 | ✅ 代码级通过（redactSessionMessages + redactSdkEventForSession，V2.11.1） |
| 真实 session 文件扫描 | ☐ manual required（需手工扫描 `.llm-bridge/sessions/*.json`） |

---

## 5. V2.11.1 修复回归确认（自动化代码级，已通过）

| 修复项 | 状态 | 证据 |
|---|---|---|
| skill 重命名 meta 迁移 | ✅ 通过 | view.ts 含 `renameSkillMeta` 调用 |
| tags 编辑保留 | ✅ 通过 | skills.ts updateImportedSkill 含 extractTags（test:unit V2.11.1 段） |
| onClose flush skillsStateSaveTimer | ✅ 通过 | view.ts onClose 含 saveSkillsState 立即写入（test:unit V2.11.1 段） |
| onClose 清理 skillsSearchDebounceTimer | ✅ 通过 | view.ts onClose 含 clearTimeout（test:unit V2.11.1 段） |
| groupOverride future 标注 | ✅ 通过 | skillsState.ts 含 "future 扩展" 注释（test:unit V2.11.1 段） |
| 组合应用勾选顺序 | ✅ 通过 | view.ts applyCombo 含 `for (const name of this.skillsComboSet)` |
| session defense-in-depth 脱敏 | ✅ 通过 | sessions.ts 含 redactSdkEventForSession |
| 设置页关键配置刷新 | ✅ 通过 | settings.ts agentType/claudePermissionMode/permissionPolicy onChange 调用 refreshBridgeView（test:unit V2.11.1 段） |

---

## 6. 结论

### 自动化部分（已通过）
- 约束确认：7/7 通过
- build：通过
- test:unit：562 passed, 0 failed（含 V2.12 新增 38 个代码级断言）
- test:process：62 passed, 0 failed
- test:claude：55 passed, 0 failed
- V2.11.1 修复回归确认：8/8 通过
- 敏感信息扫描：4/4 自动化项通过

### 手工部分（manual required）
- 核心用户流：7 项待验证（要求 3）
- Skills 验证：7 项待验证（要求 4）
- Session 验证：6 项待验证（要求 5）
- 权限和停止：4 项待验证（要求 6）
- UI 验证：7 项待验证（要求 7）
- 错误体验：3 项待验证（要求 8）
- session 文件真实扫描：1 项待验证
- **合计：35 项 manual required，需在 Obsidian 真实 Vault 中手工执行**

### 验收标准
> 真实日常工作流可用，Skills/History/Session 不丢状态，失败可诊断，CLI 主线不回归。

**自动化代码级验证已确认所有功能逻辑存在且 V2.11.1 修复未回归；真实 Obsidian UI 交互闭环需用户在测试 Vault 中完成 35 项手工验证。CLI 主线（test:process + test:claude）已通过真实执行确认不回归。**
