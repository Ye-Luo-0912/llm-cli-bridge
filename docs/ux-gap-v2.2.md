# V2.2 UX Gap Review / Stability Polish 审计报告

> 目标：不扩展 backend，集中审计当前插件距离普通用户可交付还差什么。

## 审计范围

| 维度 | 审计文件 |
|---|---|
| UI 路径清晰度 | view.ts、settings.ts、firstUseGuide.ts、presetPrompts.ts、styles.css |
| Agent 过程展示 | view.ts、claudeCliBackend.ts、sdkBackend.ts、workflowEvent.ts、workflowTrace.ts、runTimeline.ts、fileDiff.ts、sdkMessageMapper.ts |
| 稳定性 | agentProfile.ts、preflightStatus.ts、fileDiff.ts、httpServer.ts、main.ts、types.ts |

---

## 1. Must（已修复）

### M1. 两套引导内容冲突，且同时展示（已修复）

- **问题**：firstUseGuide（V1.8）3 步引导明确"无需理解 backend / SDK / mock"，但 emptyState 5 步引导第 1 步要求"确认 Backend 模式为 auto：设置→开发者区域"，内容直接矛盾。两套引导同时出现在同一屏。
- **修复**：简化 emptyState 为纯文本提示（"在底部输入框输入问题" + "或点击上方按钮选择预设功能"），不再与 firstUseGuide 冲突。清理不再使用的 step/action/btn CSS。
- **位置**：`src/view.ts:772-779`、`styles.css:1126-1147`

### M2. 点击禁用 skill 静默无反馈（已修复）

- **问题**：`if (isDisabled) return;` 直接静默返回，用户点击后毫无反应，会反复点击误以为程序卡死。
- **修复**：改为 `new Notice("该 skill 已禁用，请在 Skills 面板勾选启用")` 后返回。
- **位置**：`src/view.ts:1335-1341`

---

## 2. Must（误报，无需修复）

### M3. showStderr=false 时失败诊断被完全吞掉（误报）

- **审计发现**：`showStderr=false` 时 `newStderr` 为空字符串，errorSummary 被追加到空串上。
- **实际验证**：`buildErrorSummary(result.stderr, result.exitCode)` 使用原始 `result.stderr`（非 `newStderr`），且在 stderr 为空但 exitCode 非 null 时仍返回 `exit ${exitCode}`。`newStderr` 为空时走 `newStderr ? ... : "摘要: ${errorSummary}"` 分支，errorSummary 仍会显示。
- **结论**：误报，errorSummary 在 showStderr=false 时仍正常显示。

---

## 3. Must（进 BACKLOG，非阻塞）

### M4. Model 选项与 Agent 类型概念冲突 → B-012

- **问题**：默认组合"Claude Code + gpt-5.5"在概念上不成立。
- **决策**：需确认 model 是否实际生效（通过 ANTHROPIC_MODEL 环境变量），可能是有意设计（中转 API）。进 BACKLOG。

### M5. 首屏 9 层面板信息过载 → B-013

- **问题**：窄侧栏下 9 层面板，输入框易被挤出可视区。
- **决策**：涉及大量 UI 重构，非"小问题"。进 BACKLOG。

### M6. SDK 真实路径 stop() 不能中断 query → B-014

- **问题**：sdk-experimental 模式下真实 SDK 路径的 `for await` 循环不响应 `stopped` 标志。
- **决策**：sdk-experimental 默认关闭，真实 SDK 路径仅在 SDK 可用时触发，当前 fallback mock 不受影响。进 BACKLOG。

### M7. SDK 真实路径停止后 content 为空 → B-015

- **问题**：真实 SDK 路径 stdout_delta 只在终态一次性发出，停止后 msg.content 为空。
- **决策**：同 M6，experimental 功能。进 BACKLOG。

---

## 4. Should（进 BACKLOG）

### UI 路径清晰度

| 编号 | 问题 | BACKLOG |
|---|---|---|
| S1 | 预设按钮在空状态引导上方，位置倒置 | 后续迭代 |
| S2 | 输入框 placeholder 英文，与中文 UI 不一致 | 后续迭代 |
| S3 | "总结当前笔记"无前置状态内联提示，仅靠 Notice | 后续迭代 |
| S4 | Skills 面板折叠态发现性偏弱 | 后续迭代 |
| S5 | Selection/Note chips 与依赖它们的预设按钮距离远 | 后续迭代 |
| S6 | 上下文 chip 开关态仅靠背景色，无文字/图标变化 | 后续迭代 |
| S7 | Mode chip 是无效控件但表现为可点击 → B-020 | 已进 BACKLOG |
| S8 | 状态栏对普通用户暴露 Backend/Cwd 技术概念 | 后续迭代 |
| S9 | 运行中按 Ctrl/Cmd+Enter 静默无反馈 | 后续迭代 |
| S10 | Pending Actions(count=0) 与 Status Bar 技术指标占位 → B-013 | 已进 BACKLOG |
| S11 | "New"按钮重复出现两处 → B-021 | 已进 BACKLOG |
| S12 | Composer chips 行混合 3 类概念控件 | 后续迭代 |
| S13 | Preset 前置条件错误仅用 Notice，无按钮内联态 | 后续迭代 |
| S14 | Debug log 路径指向目录而非具体文件 → B-017 | 已进 BACKLOG |

### Agent 过程展示

| 编号 | 问题 | BACKLOG |
|---|---|---|
| S1 | SDK 模式 Command Preview 误导（显示 claude -p 但实际执行 SDK query） | 后续迭代 |
| S2 | SDK 真实路径 stdout 非流式 → B-015 | 已进 BACKLOG |
| S3 | 切换 backend mode 后 view 不立即刷新 → B-019 | 已进 BACKLOG |
| S4 | file_change 事件与 fileDiff 结果重复且路径格式不一致 | 后续迭代 |
| S5 | timeline 与 workflowTrace 功能重叠，timeline 为死代码 | 后续迭代 |
| S6 | runFlow 区与消息内 Workflow Trace 信息重复 | 后续迭代 |
| S7 | SDK 模式 Workflow Trace 的 spawn/file_diff_scan 阶段描述不准确 | 后续迭代 |
| S8 | CLI 模式无工具调用细节/thinking/进度（claude -p 固有限制） | 后续迭代 |

### 稳定性

| 编号 | 问题 | BACKLOG |
|---|---|---|
| S1 | Preflight 缓存在切换 agent 类型后不失效 → B-016 | 已进 BACKLOG |
| S2 | Preflight 不在运行前自动执行 | 后续迭代 |
| S3 | Preflight 的 debugLogPath 被 mapPreflightToStatus 丢弃 | 后续迭代 |
| S4 | Debug log 路径指向目录 → B-017 | 已进 BACKLOG |
| S5 | 无 agent 运行重试机制 | 后续迭代 |
| S6 | redactSecret 不覆盖通用 token=/password=/JWT/绝对路径 | 后续迭代 |
| S7 | buildErrorSummary 取首行可能抓到 banner 噪音 | 后续迭代 |
| S8 | stop() 不立即清空 runHandle，UI 状态滞后 | 后续迭代 |
| S9 | onClose 不等待 stopped 事件，最终状态不落盘 | 后续迭代 |
| S10 | fileDiff 串行 stat，大 Vault 性能差 → B-018 | 已进 BACKLOG |
| S11 | 只检测 .md 文件，非 md 生成物不可见 | 后续迭代 |
| S12 | EXCLUDE_DIRS 不含 .trash 等；扫描错误静默吞掉 | 后续迭代 |
| S13 | cleanupPendingActions 清 pendingConfirms 不 reject | 后续迭代 |
| S14 | readBody 无大小上限 | 后续迭代 |
| S15 | bridge.json 回退 unlink+write 非原子 | 后续迭代 |
| S16 | processedDevOps Set 无界增长 | 后续迭代 |
| S17 | CORS * + 无 OPTIONS 处理 | 后续迭代 |
| S18 | loadData() 失败未捕获，插件整体加载失败 | 后续迭代 |
| S19 | 无版本迁移/类型变更处理，仅浅合并 | 后续迭代 |
| S20 | 无加载值校验（类型/范围/路径） | 后续迭代 |

---

## 5. Later（进 BACKLOG 或后续迭代）

| 编号 | 问题 |
|---|---|
| L1 | 预设按钮视觉权重均一，核心操作未强调 |
| L2 | Note chip 文件名截断 max-width 120px 过短 |
| L3 | Preflight 初始文案"未检测"无行动指引 |
| L4 | Header 刷新按钮语义不明 |
| L5 | 设置页分层清晰（正面发现） |
| L6 | Run Flow 空态"暂无运行"常驻占位 |
| L7 | 折叠策略总体合理（正面发现） |
| L8 | Notice 反馈总体充分（正面发现） |
| L9 | 错误摘要脱敏处理到位（正面发现） |
| L10 | 生成文件点击打开时索引延迟，无自动重试 |
| L11 | file_change 事件 path 可能是绝对路径 |
| L12 | SDK Workflow 区默认折叠，新用户不易发现 |
| L13 | 无 token 用量/成本展示 |
| L14 | 两种模式过程展示粒度差异大 |
| L15 | SDK 真实路径无中间 assistant 消息展示 |

---

## 6. 正面发现

| 发现 | 说明 |
|---|---|
| 设置页分层清晰 | 4 段（基础/高级/日志/开发者），开发者区域有橙色警告条，高级功能对普通用户隐藏足够好 |
| 折叠策略合理 | Pending/Skills/Run Flow 默认折叠；消息内 stderr/log/timeline/workflow trace 默认折叠，失败时 stderr 自动展开 |
| Notice 反馈覆盖 | 空输入/Preflight 结果/复制成功失败/文件未索引/运行中清空新建均有 Notice |
| 错误摘要脱敏 | redactSecret 移除 48 位 hex token、sk-ant-*、Bearer、ANTHROPIC_API_KEY，buildErrorSummary 截断 200 字符 |
| SDK Workflow 区条件渲染 | 仅在 sdkEvents.length > 0 时显示，数据驱动非条件渲染，设计正确 |
| token 时间安全比较 | timingSafeEqual + 降级方案，符合安全要求 |
| bridge.json 原子写入 | tmp+rename，失败回退 unlink+writeFile，再失败写日志 |
| pending action 幂等 | processedActionIds 做幂等，completedActions 保留 60s |
| backend stop() 守卫幂等 | exited/stopped 守卫，多次调用安全 |

---

## 7. 修复总结

### 已修复 Must 级问题（2 项）

1. **M1 两套引导冲突**：简化 emptyState 为纯文本提示，不再与 firstUseGuide 3 步引导冲突
2. **M2 禁用 skill 静默**：加 Notice 提示"该 skill 已禁用，请在 Skills 面板勾选启用"

### 误报（1 项）

3. **M3 showStderr=false 吞掉 errorSummary**：误报，errorSummary 在 showStderr=false 时仍正常显示

### 进 BACKLOG（10 项，B-012 ~ B-021）

- B-012 Model/Agent 概念冲突
- B-013 首屏信息过载
- B-014 SDK stop() 不能中断 query
- B-015 SDK 停止后 content 为空
- B-016 Preflight 缓存不失效
- B-017 Debug log 路径指向目录
- B-018 fileDiff 串行 stat 性能差
- B-019 切换 backend mode 后 view 不刷新
- B-020 Mode chip 无效控件
- B-021 "New"按钮重复

---

## 8. 结论

当前插件距离普通用户可交付的主要缺口集中在：

1. **UI 信息层次**（M1 已修复，M5/B-013 进 BACKLOG）：首屏层数过多，但核心的引导冲突已解决
2. **交互反馈完整性**（M2 已修复）：禁用 skill 的静默问题已解决
3. **SDK experimental 路径**（M6/M7 进 BACKLOG）：stop() 和 content 为空问题仅在真实 SDK 路径下存在，sdk-experimental 默认关闭，不影响普通用户
4. **稳定性边缘场景**（多项 Should 进 BACKLOG）：大 Vault 性能、Preflight 缓存失效、debug log 路径精度等，均为非阻塞改进项

**正面发现**：设置页分层、折叠策略、Notice 覆盖、错误脱敏、SDK 条件渲染、token 安全、bridge.json 原子写入、pending action 幂等、stop() 守卫等关键点均已覆盖，体现 V1.8~V2.1 迭代的积累。

**验收**：得到一份明确的交付前缺口清单（Must 2 项已修复 + 误报 1 项 + BACKLOG 10 项 + Should/Later 若干），并修复了阻塞级体验问题。
