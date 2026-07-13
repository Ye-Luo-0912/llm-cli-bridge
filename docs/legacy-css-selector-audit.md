# Legacy CSS Selector Audit

Target file: `styles/legacy.css` (10651 lines)

## Summary

| Metric | Count |
|---|---|
| Total unique class selectors in `legacy.css` | 689 |
| REACHABLE (found in `src/*.ts`, `main.ts`, or `scripts/*.mjs`) | 651 |
| UNREACHABLE — likely false-positive (producible by dynamic prefix) | 27 |
| UNREACHABLE — deletion candidates (no dynamic match) | 11 |
| Unique ID selectors | 0 |
| Element selectors tracked (HTML/SVG) | 10 |

> REACHABLE selectors are kept. UNREACHABLE — deletion candidates are safe to remove (verify each one). UNREACHABLE — likely false-positive classes are produced by dynamic template-literal / concatenation patterns and should NOT be deleted without manual verification.

## Dynamic class construction (false-positive risks)

These source locations build class names via template literals (`prefix${var}`) or string concatenation (`"prefix-" + var`). Any class whose name begins with one of these prefixes is listed in the "UNREACHABLE — likely false-positive" table below instead of the deletion-candidates table.

Detected dynamic prefixes:

`is-<value>`, `is-answer-<value>`, `is-disposition-<value>`, `is-multiline-<value>`, `is-profile-<value>`, `is-progress-<value>`, `is-reasoning-text-<value>`, `is-risk-<value>`, `is-safety-<value>`, `is-step-<value>`, `llm-bridge-agent-skill-registry-item-<value>`, `llm-bridge-clarification-option-<value>`, `llm-bridge-codex-detail-<value>`, `llm-bridge-codex-plugin-item-<value>`, `llm-bridge-collapse-<value>`, `llm-bridge-command-menu-plugin-<value>`, `llm-bridge-context-tag-<value>`, `llm-bridge-effort-option-<value>`, `llm-bridge-model-menu-row-<value>`, `llm-bridge-model-option-<value>`, `llm-bridge-msg-<value>`, `llm-bridge-msg-time-<value>`, `llm-bridge-perm-popover-runtime-item-<value>`, `llm-bridge-phase-user-input-option-<value>`, `llm-bridge-status-dot-<value>`, `llm-bridge-tl-tool-cat-<value>`, `llm-bridge-vc-status-badge-<value>`

### Construction sites

| File | Pattern | Context |
|---|---|---|
| `src\agentProfile.ts` | `preflight-${ts}` | `]/g, "-"); const logPath = path.join(logDir, `preflight-${ts}.log`); fs.writeFileSync(logPath, content, "utf8"); return logPath;` |
| `src\agentProfile.ts` | `n${stdoutTrim}` | `; debugLines.push(`---- version stdout ----\n${stdoutTrim}`); debugLines.push(`---- version stderr ----\n${stderrTrim}`);` |
| `src\agentProfile.ts` | `n${stderrTrim}` | `; debugLines.push(`---- version stderr ----\n${stderrTrim}`); const debugLogPath = writePreflightDebugLog(cwd, debugLines.join("` |
| `src\agentRuntimeWorkspace.ts` | `n---${rel}` | `y.isFile()) { try { chunks.push(`\n---${rel}---\n` + fs.readFileSync(full, "utf8")); } catch { // 读取失败跳过` |
| `src\agentSkills.ts` | `as-${sha256(`${name}` | `xistingSlugs)); const id = input.id?.trim() \|\| `as-${sha256(`${name}\n${description}\n${nowIso}\n${randomUUID()}`).slice(0, 16)}`; retur` |
| `src\agentSkills.ts` | `n${description}` | `st id = input.id?.trim() \|\| `as-${sha256(`${name}\n${description}\n${nowIso}\n${randomUUID()}`).slice(0, 16)}`; return normalizeAgentSkill` |
| `src\agentSkills.ts` | `n${nowIso}` | `?.trim() \|\| `as-${sha256(`${name}\n${description}\n${nowIso}\n${randomUUID()}`).slice(0, 16)}`; return normalizeAgentSkillRecord({ id,` |
| `src\agentSkills.ts` | `n${randomUUID()}` | ``as-${sha256(`${name}\n${description}\n${nowIso}\n${randomUUID()}`).slice(0, 16)}`; return normalizeAgentSkillRecord({ id, slug,` |
| `src\agentSkills.ts` | `skill-${sha256(name).slice(0, 8)}` | `, "") .slice(0, 64); const base = ascii \|\| `skill-${sha256(name).slice(0, 8)}`; const used = new Set(existingSlugs.map(normalizeSlug` |
| `src\claudeCliBackend.ts` | `debug-${ts}` | `]/g, "-"); const logPath = path.join(logDir, `debug-${ts}.log`); const redacted = redactSecrets(content); fs.writeFileSync(logPa` |
| `src\claudeCliBackend.ts` | `n${stderrTail.trim()}` | `(stderrTail.trim()) { lines.push(`stderr 摘要:\n${stderrTail.trim()}`); } else { lines.push("reason: 进程启动失败（无 stderr 输出）"); } r` |
| `src\claudeCliBackend.ts` | `n${describeRuntimeFileToolAdapter(task.runtimeFileToolAdapter)}` | `ag; debugLog += `\n=== Runtime File Tools ===\n${describeRuntimeFileToolAdapter(task.runtimeFileToolAdapter)}\n`; // spawn 前检查 cwd` |
| `src\claudeCliBackend.ts` | `n${stderr}` | `h}\n`; debugLog += `---- stderr (full) ----\n${stderr}\n`; writeDebugLog(task.cwd, debugLog, !!settings.developerMode); /` |
| `src\fileAccessPolicy.ts` | `read-${(hash >>> 0).toString(16)}` | `hash = Math.imul(hash, 16777619); } return `read-${(hash >>> 0).toString(16)}`; } function buildDecision( operation: FileAccessOper` |
| `src\fileRefs.ts` | `fileref-${kind}` | `hash = Math.imul(hash, 16777619); } return `fileref-${kind}-${(hash >>> 0).toString(16)}`; }` |
| `src\httpServer.ts` | `bridge-${Date.now()}` | `rue }); const logPath = path.join(logsDir, `bridge-${Date.now()}.log`); const logContent = `=== bridge.json 写入失败 ===\ntime: ${ne` |
| `src\httpServer.ts` | `a-${Date.now()}` | `Promise<ActionResult> { const id = req.id \|\| `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; const type = req.type;` |
| `src\runtime\core\agentRunDisplayModel.ts` | `timeline-${node.sourceRef?.sequence ?? node.id}` | `detail ?? node.title; const base = { id: `timeline-${node.sourceRef?.sequence ?? node.id}`, title: node.title, status,` |
| `src\runtime\core\agentRunDisplayModel.ts` | `thought-${i}` | `houghts[i]; timelineCards.push({ id: `thought-${i}`, kind: "thinking", title: "思考", status: "completed",` |
| `src\runtime\core\agentRunDisplayModel.ts` | `tool-${tool.callId}` | `e === true; timelineCards.push({ id: `tool-${tool.callId}${count > 0 ? `-${count}` : ""}`, kind: "tool-call", titl` |
| `src\runtime\core\agentRunDisplayModel.ts` | `approval-resolved-${ap.requestId}` | `scription); timelineCards.push({ id: `approval-resolved-${ap.requestId}`, kind: "approval", title: `权限: ${label}`,` |
| `src\runtime\core\agentRunDisplayModel.ts` | `user-input-${req.requestId}` | `) continue; timelineCards.push({ id: `user-input-${req.requestId}`, kind: "user-input", title: "User input",` |
| `src\runtime\core\agentRunDisplayModel.ts` | `error-${i}` | `st(errMsg); timelineCards.push({ id: `error-${i}`, kind: "error", title: isAuthError ? "API Key 缺失或无效" : "错误",` |
| `src\runtime\core\agentRunDisplayModel.ts` | `approval-pending-${ap.requestId}` | `scription); approvalCards.push({ id: `approval-pending-${ap.requestId}`, kind: "approval", title: label, st` |
| `src\runtime\core\agentRunDisplayModel.ts` | `user-input-pending-${req.requestId}` | `continue; userInputCards.push({ id: `user-input-pending-${req.requestId}`, kind: "user-input", title: req.toolNam` |
| `src\runtime\core\agentRunDisplayModel.ts` | `filechange-${i}` | `)}` : ""; fileChangeCards.push({ id: `filechange-${i}`, kind: "file-change", title: `${actionLabel}文件`, sta` |
| `src\runtime\core\agentRunDisplayModel.ts` | `warning-${i}` | `h; i++) { diagnosticCards.push({ id: `warning-${i}`, kind: "warning", title: "警告", status: "completed",` |
| `src\runtime\core\assistantTurnView.ts` | `n${existing}` | `ng; } else if ( incoming === `${existing}\n${existing}` \|\| (incoming.startsWith(`${existing}\n`) && incoming.slice(existing.len` |
| `src\runtime\core\assistantTurnView.ts` | `n${incoming.trimStart()}` | `{ merged = `${existing.replace(/\s+$/, "")}\n${incoming.trimStart()}`; } else { merged = existing + incoming; } return n` |
| `src\runtime\core\assistantTurnView.ts` | `msg-${this.thoughtMessageIdx++}` | `` : (this.currentThinkingMessageId ?? `msg-${this.thoughtMessageIdx++}`); const isRaw = !!p.isRawFallback; cons` |
| `src\runtime\core\assistantTurnView.ts` | `msg-${this.thoughtMessageIdx++}` | `{ this.currentThinkingMessageId = `msg-${this.thoughtMessageIdx++}`; this.lifecycleEventsList.push(` |
| `src\runtime\core\assistantTurnView.ts` | `msg-${this.thoughtMessageIdx++}` | `on) { this.currentThinkingMessageId = `msg-${this.thoughtMessageIdx++}`; this.lifecycleEventsList.push( {` |
| `src\runtime\core\bridgeSession.ts` | `run-${Date.now()}` | `ble<NormalizedRuntimeEvent> { const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; this._currentRunId = ru` |
| `src\runtime\core\bridgeSession.ts` | `resume-${Date.now()}` | `ble<NormalizedRuntimeEvent> { const runId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; this._currentRunId =` |
| `src\runtime\core\codexRunViewModel.ts` | `segment-${fc.timestamp}` | `onst fc of turnView.fileChanges) { addChange(`segment-${fc.timestamp}`, fc.action, fc.path, undefined, undefined, undefined, fc.timestam` |
| `src\runtime\core\codexRunViewModel.ts` | `feed-change-${change.id}` | `ngeIds.add(change.id); feed.push({ id: `feed-change-${change.id}`, kind: "file", icon: stepIcon("file"), label:` |
| `src\runtime\core\codexRunViewModel.ts` | `feed-${card.id}` | `ss" : "candidate"; feed.push({ id: `feed-${card.id}`, kind: "assistant", icon: "message-square", label` |
| `src\runtime\core\codexRunViewModel.ts` | `feed-${card.id}` | `=== "thinking") { feed.push({ id: `feed-${card.id}`, kind: "thinking", icon: stepIcon("thinking"), la` |
| `src\runtime\core\codexRunViewModel.ts` | `feed-${card.id}` | `romToolCard(card); feed.push({ id: `feed-${card.id}`, kind: step.kind, icon: step.icon, label: step.la` |
| `src\runtime\core\codexRunViewModel.ts` | `feed-${card.id}` | `=== "approval") { feed.push({ id: `feed-${card.id}`, kind: "approval", icon: stepIcon("approval"), la` |
| `src\runtime\core\codexRunViewModel.ts` | `feed-${card.id}` | `== "user-input") { feed.push({ id: `feed-${card.id}`, kind: "user-input", icon: stepIcon("user-input"),` |
| `src\runtime\core\codexRunViewModel.ts` | `feed-change-${change.id}` | `(change.id)) continue; feed.push({ id: `feed-change-${change.id}`, kind: "file", icon: stepIcon("file"), label:` |
| `src\runtime\core\codexRunViewModel.ts` | `step-${change.id}` | `el.fileChangeCards) { steps.push({ id: `step-${change.id}`, kind: "file", icon: stepIcon("file"), label: `${acti` |
| `src\runtime\core\codexRunViewModel.ts` | `diagnostic-${byKey.size}` | `} else { byKey.set(key, { id: `diagnostic-${byKey.size}`, severity, message, count: 1, });` |
| `src\runtime\core\providerLifecycleEvent.ts` | `msg-${thoughtIdx}` | `mp: item.data.timestamp, messageId: `msg-${thoughtIdx}`, }); events.push({ type: "reasoning_` |
| `src\runtime\core\providerLifecycleEvent.ts` | `msg-${thoughtIdx}` | `mp: item.data.timestamp, messageId: `msg-${thoughtIdx}`, }); } if (item.data.text) { ev` |
| `src\runtime\core\providerLifecycleEvent.ts` | `msg-${thoughtIdx}` | `text: item.data.text, messageId: `msg-${thoughtIdx}`, }); } thoughtIdx++; lastWasObser` |
| `src\runtime\core\providerLifecycleEvent.ts` | `msg-${thoughtIdx}` | `mp: item.data.startTime, messageId: `msg-${thoughtIdx}`, }); } events.push({ type: "too` |
| `src\runtime\core\runPhaseModel.ts` | `phase-${phaseIdx++}` | `startedAt?: string): MutablePhase => ({ id: `phase-${phaseIdx++}`, type, status: "running", label: phaseLabel(type, firs` |
| `src\runtime\core\runPhaseModel.ts` | `phase-${phaseIdx++}` | `ror) { phases.push({ id: `phase-${phaseIdx++}`, type: "failed", status: "failed",` |
| `src\runtime\core\runPhaseModel.ts` | `phase-${phaseIdx++}` | `gUserInputPhase) { phases.push({ id: `phase-${phaseIdx++}`, type: "waiting-input", status: "pending", label` |
| `src\runtime\core\runPhaseModel.ts` | `phase-${phaseIdx++}` | `ngApprovalPhase) { phases.push({ id: `phase-${phaseIdx++}`, type: "waiting-approval", status: "pending", la` |
| `src\runtime\core\runPhaseModel.ts` | `m${s}` | `const s = totalSec % 60; return s > 0 ? `${m}m${s}s` : `${m}m`; }` |
| `src\runtime\providers\codex-app-server\codexAppServerApprovalMapper.ts` | `codex-req-${serverRequestId}` | `?? "" }`; return { requestId: `codex-req-${serverRequestId}`, providerId: this.providerId, toolName,` |
| `src\runtime\providers\codex-app-server\codexAppServerEventMapper.ts` | `codex-req-${params.requestId}` | `kind: "approval_resolved", requestId: `codex-req-${params.requestId}`, response: mapped, source: "user",` |
| `src\runtime\providers\codex-app-server\codexAppServerUserInputMapper.ts` | `codex-input-${serverRequestId}` | `nput requested"; return { requestId: `codex-input-${serverRequestId}`, providerId: this.providerId, toolName: para` |
| `src\runtime\providers\codex-app-server\codexAppServerUserInputMapper.ts` | `question-${index + 1}` | `g" && raw.id.trim().length > 0 ? raw.id.trim() : `question-${index + 1}`, header: typeof raw.header === "string" && raw.header.trim()` |
| `src\runtime\providers\codex-app-server\codexItemTimeline.ts` | `codex-req-${a}` | `(String(a) === String(b)) return true; return `codex-req-${a}` === String(b) \|\| String(a) === `codex-req-${b}`; } function stringifyValu` |
| `src\runtime\providers\codex-app-server\codexItemTimeline.ts` | `codex-req-${b}` | ``codex-req-${a}` === String(b) \|\| String(a) === `codex-req-${b}`; } function stringifyValue(value: unknown): string { if (value === unde` |
| `src\runtime\providers\codex-managed-app-server\codexManagedRuntimeInstallerBridge.ts` | `extract-${platformKey}` | `equired" }; const extractDir = join(cacheDir, `extract-${platformKey}`); const tarballPath = join(cacheDir, fileNameFromUrl(entry.artif` |
| `src\runtime\providers\codex-managed-app-server\codexManagedRuntimeInstallerBridge.ts` | `partial-${process.pid}` | `l)); const partialRuntimePath = `${runtimePath}.partial-${process.pid}-${Date.now()}`; let activeTarballPath: string \| null = null; mk` |
| `src\runtime\providers\pi-rpc\piRpcProvider.ts` | `n${helpR.stderr || ""}` | `}); const helpText = `${helpR.stdout \|\| ""}\n${helpR.stderr \|\| ""}`; rpcSupported = /--mode\|rpc/i.test(helpText); } catch {` |
| `src\runtime\providers\pi-rpc\piRpcProvider.ts` | `pi-${Date.now()}` | `const callId = typeof o.id === "string" ? o.id : `pi-${Date.now()}`; if (isWriteToolCall(toolName)) { // 写工具：映射为 approval_request` |
| `src\runtime\providers\pi-sdk\piSdkProvider.ts` | `pi-sdk-${toolName}` | `4. 全部缺失：生成新 id（仅 start 时） const fallback = `pi-sdk-${toolName}-${Date.now()}-${this.counter++}`; this.byToolName.set(toolName, fa` |
| `src\runtime\providers\pi-sdk\piSdkProvider.ts` | `pi-bridge-${name}` | `fy(args).slice(0, 200); const requestId = `pi-bridge-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; const r` |
| `src\runtime\providers\workflowEventMapper.ts` | `legacy-${ev.timestamp}` | `oval_request", requestId: ev.requestId ?? `legacy-${ev.timestamp}`, toolName: ev.toolName, description: ev.description,` |
| `src\runtime\RunSessionController.ts` | `session-${Date.now()}` | `} const sess = createBridgeSession( `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, this.host.plugin.s` |
| `src\runtime\RunSessionController.ts` | `n${result.stdout}` | `e().toISOString()}\n` + `\n---- stdout ----\n${result.stdout}\n` + `\n---- stderr ----\n${result.stderr}\n`; await fs.promis` |
| `src\runtime\RunSessionController.ts` | `n${result.stderr}` | `\n${result.stdout}\n` + `\n---- stderr ----\n${result.stderr}\n`; await fs.promises.writeFile(file, content, "utf8"); return f` |
| `src\runtimeTranscript.ts` | `tl-${idx++}` | `[]; let idx = 0; const nextId = () => `tl-${idx++}`; // 1. session_started（仅 Developer mode 由 filter 决定是否展示） if (this` |
| `src\runtimeTranscript.ts` | `tl-${i}` | `}); return nodes.map((n, i) => ({ ...n, id: `tl-${i}` })); } /** 原始事件流（Developer mode raw log 用） */ toRawEvents(): WorkflowE` |
| `src\sdkBackend.ts` | `question-${index + 1}` | `(!question) return null; return { id: `question-${index + 1}`, question, options: fallbackOptions, multiSelect:` |
| `src\sdkBackend.ts` | `question-${index + 1}` | `: readStringField(raw, ["id", "name", "key"]) ?? `question-${index + 1}`, header: readStringField(raw, ["header", "title"]), questio` |
| `src\sdkBackend.ts` | `sdk-input-${toolUseId}` | `""; return { requestId: toolUseId ? `sdk-input-${toolUseId}` : `sdk-input-${Date.now()}-${Math.random().toString(36).slic` |
| `src\sdkBackend.ts` | `sdk-input-${Date.now()}` | `olUseId ? `sdk-input-${toolUseId}` : `sdk-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, providerId: "claud` |
| `src\session.ts` | `is-${status}` | `tatusClass(status: RunStatus): string { return `is-${status}`; } /** * 更新会话状态（返回新对象，不可变更新） */ export function updateSession( prev: Se` |
| `src\sessions.ts` | `s-${ts}` | `ath.random().toString(36).slice(2, 8); return `s-${ts}-${rand}`; } function summarizeSessionText(value: unknown, maxLen = 96): string` |
| `src\timelineAdapter.ts` | `tl-${nodeIndex++}` | `[]; let nodeIndex = 0; const nextId = () => `tl-${nodeIndex++}`; // 1. tool_start + tool_result 配对 const toolPairs = pairTools(eve` |
| `src\timelineAdapter.ts` | `tl-${i}` | `序后） return allNodes.map((n, i) => ({ ...n, id: `tl-${i}` })); } // ---------- Timeline 统计 ---------- export interface TimelineStats {` |
| `src\toolsWriter.ts` | `dp0${HELPER_FILE_NAME}` | `onst winContent = [ "@echo off", `node "%~dp0${HELPER_FILE_NAME}" %*`, "", ].join("\r\n"); const unixContent = [ "#!/bin` |
| `src\ui\codexRunRenderer.ts` | `is-${run.runHeader.statusKind}` | `ap llm-bridge-turn-view llm-bridge-codex-run-view is-${run.runHeader.statusKind}${developerMode ? " is-developer" : ""}${semanticClass}${sho` |
| `src\ui\codexRunRenderer.ts` | `is-disposition-${sourceModel.finalAnswerDisposition}` | `eModel.finalAnswerDisposition); wrap.addClass(`is-disposition-${sourceModel.finalAnswerDisposition}`); const head = wrap.createDiv({` |
| `src\ui\codexRunRenderer.ts` | `is-${run.runHeader.statusKind}` | `idge-codex-run-status llm-bridge-timeline-summary is-${run.runHeader.statusKind}`, text: deps.localizeRunStatus(run.runHeader.status)` |
| `src\ui\codexRunRenderer.ts` | `is-${run.runHeader.statusKind}` | `ap llm-bridge-turn-view llm-bridge-codex-run-view is-${run.runHeader.statusKind}${developerMode ? " is-developer" : ""}${ presentation.` |
| `src\ui\codexRunRenderer.ts` | `is-${run.currentActivity.kind}` | `eateDiv({ cls: `llm-bridge-codex-current-activity is-${run.currentActivity.kind}` }); const text = activity.createEl("span", { cls: "llm-` |
| `src\ui\codexRunRenderer.ts` | `is-risk-${gate.risk}` | `.createDiv({ cls: `llm-bridge-codex-approval-gate is-risk-${gate.risk}` }); card.setAttribute("data-request-id", gate.requestId);` |
| `src\ui\codexRunRenderer.ts` | `is-${gate.risk}` | `pan", { cls: `llm-bridge-codex-approval-gate-risk is-${gate.risk}`, text: gate.risk === "high" ? "高风险" : gate.risk === "medium" ? "需确认" : "低` |
| `src\ui\codexRunRenderer.ts` | `is-${diagnostic.severity}` | `reateDiv({ cls: `llm-bridge-codex-diagnostic-item is-${diagnostic.severity}` }); item.createDiv({ cls: "llm-bridge-codex-diagnostic-mes` |
| `src\ui\codexWaterfallRenderer.ts` | `t${codexFeedItemSignature(i)}` | `return items.map((i) => `${codexFeedItemKey(i)}\t${codexFeedItemSignature(i)}`).join("\n"); } /** * cluster 最新数据缓存：每个 details 元素对应最新的 it` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.status}` | `ateDiv({ cls: `llm-bridge-codex-thinking-line is-${item.status}${isLive ? " is-thinking-live" : " is-thinking-done"}`, }); row.setAt` |
| `src\ui\codexWaterfallRenderer.ts` | `is-reasoning-text${isLive ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-glow is-thinking-faded" : ""}` | `n", { cls: `llm-bridge-codex-thinking-summary is-reasoning-text${isLive ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-g` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.status}` | `ateDiv({ cls: `llm-bridge-codex-thinking-line is-${item.status} is-narrative is-answer-${role}${isLive ? " is-thinking-live" : ""}${isCa` |
| `src\ui\codexWaterfallRenderer.ts` | `is-answer-${role}` | `odex-thinking-line is-${item.status} is-narrative is-answer-${role}${isLive ? " is-thinking-live" : ""}${isCandidate ? " is-final-candidate"` |
| `src\ui\codexWaterfallRenderer.ts` | `is-multiline${isLive ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-glow is-thinking-faded" : ""}` | `msg-stream-text llm-bridge-codex-thinking-summary is-multiline${isLive ? " llm-bridge-codex-thinking-status is-running llm-bridge-run-glow i` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.change.action}` | `Cls = item.change ? ` llm-bridge-codex-change-row is-${item.change.action}` : ""; const row = expandable ? parent.createEl("details",` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.kind}` | `ridge-codex-event-block llm-bridge-codex-step-row is-${item.kind} is-${item.status}${changeCls}`, }) : parent.createDiv({ cls:` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.status}` | `t-block llm-bridge-codex-step-row is-${item.kind} is-${item.status}${changeCls}`, }) : parent.createDiv({ cls: `llm-bridge-cod` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.kind}` | `-bridge-codex-feed-item llm-bridge-codex-step-row is-${item.kind} is-${item.status}${changeCls}`, }); row.setAttribute("data-step-kind` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.status}` | `ed-item llm-bridge-codex-step-row is-${item.kind} is-${item.status}${changeCls}`, }); row.setAttribute("data-step-kind", item.kind);` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.change.approvalStatus ?? "resolved"}` | `", { cls: `llm-bridge-codex-change-approval is-${item.change.approvalStatus ?? "resolved"}`, text: item.change.approvalStatus ??` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.change.action}` | `l("a", { cls: `llm-bridge-codex-change-path is-${item.change.action}`, text: item.change.fileName \|\| item.change.relativePath,` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.status}` | `teEl("span", { cls: `llm-bridge-codex-step-status is-${item.status}`, text: item.status }); if (item.durationMs) meta.createEl("span", { c` |
| `src\ui\codexWaterfallRenderer.ts` | `is-answer-${answerRole}` | `rocess") : ""; const roleClass = answerRole ? ` is-answer-${answerRole}` : ""; entry.className = `llm-bridge-codex-feed-entry is-item is` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.kind}` | `.className = `llm-bridge-codex-feed-entry is-item is-${item.kind} is-${item.status}${roleClass}`; entry.setAttribute("data-feed-kind", ite` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.status}` | `m-bridge-codex-feed-entry is-item is-${item.kind} is-${item.status}${roleClass}`; entry.setAttribute("data-feed-kind", item.kind); if (i` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${item.status}` | `tatusEl.className = `llm-bridge-codex-step-status is-${item.status}`; if (statusEl.textContent !== item.status) statusEl.textContent = i` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${clusterKind}` | `assName = `llm-bridge-codex-feed-entry is-cluster is-${clusterKind} is-${groupStatus}`; entry.setAttribute("data-feed-kind", "cluster");` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${groupStatus}` | `dge-codex-feed-entry is-cluster is-${clusterKind} is-${groupStatus}`; entry.setAttribute("data-feed-kind", "cluster"); entry.setAttribut` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${groupStatus}` | `El("details", { cls: `llm-bridge-codex-tool-group is-${groupStatus}` }); const summary = group.createEl("summary", { cls: "llm-bridge-co` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${groupStatus}` | `group.className = `llm-bridge-codex-tool-group is-${groupStatus}`; if (wasOpen) group.open = true; // 更新标题 const titleEl = group.q` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${groupStatus}` | `teEl("span", { cls: `llm-bridge-codex-step-status is-${groupStatus}` }); else statusEl.className = `llm-bridge-codex-step-status is-${gr` |
| `src\ui\codexWaterfallRenderer.ts` | `is-${groupStatus}` | `tatusEl.className = `llm-bridge-codex-step-status is-${groupStatus}`; if (statusEl.textContent !== groupStatus) statusEl.textContent = g` |
| `src\ui\composerController.ts` | `n${info.description}` | `le); chip.setAttribute("title", `${info.title}\n${info.description}\n点击切换`); chip.classList.remove("is-safe", "is-caution", "is-danger` |
| `src\ui\composerController.ts` | `is-${profile}` | `-auto", "is-full-access"); chip.classList.add(`is-${profile}`); } /** 权限菜单：请求批准 / 替我审批 / 完全访问（计划模式已移出） */ export function renderPerm` |
| `src\ui\composerController.ts` | `is-profile-${profile.id}` | `l("button", { cls: `llm-bridge-perm-option is-profile-${profile.id}${current === profile.id ? " is-active" : ""}`, attr: {` |
| `src\ui\composerController.ts` | `llm-bridge-perm-popover-runtime-item${rp.allowed ? "" : " is-disabled"}` | `t item = rtList.createEl("span", { cls: `llm-bridge-perm-popover-runtime-item${rp.allowed ? "" : " is-disabled"}`, text: r` |
| `src\ui\composerController.ts` | `llm-bridge-model-option${isActive ? " is-active" : ""}` | `odelOptionsEl.createEl("button", { cls: `llm-bridge-model-option${isActive ? " is-active" : ""}${!isSelectable ? " is-disabled" : "` |
| `src\ui\composerController.ts` | `llm-bridge-effort-option${isActive ? " is-active" : ""}` | `effortOptionsEl.createEl("button", { cls: `llm-bridge-effort-option${isActive ? " is-active" : ""}`, attr: { "data-effort": ef` |
| `src\ui\composerController.ts` | `llm-bridge-model-menu-row${deps.activeFlyout === panel ? " is-active" : ""}` | `rimaryMenuEl!.createEl("button", { cls: `llm-bridge-model-menu-row${deps.activeFlyout === panel ? " is-active" : ""}`, att` |
| `src\ui\composerController.ts` | `is-${isImage ? "image" : "file"}` | `reateDiv({ cls: `llm-bridge-attachment-token is-${isImage ? "image" : "file"}${deps.selectedAttachmentId === ref.id ? " is-selected" :` |
| `src\ui\composerController.ts` | `is-${state.kind}` | `ilEl.className = `llm-bridge-composer-status-rail is-${state.kind}`; els.textEl.textContent = state.label; els.textEl.setAttribute("ti` |
| `src\ui\messageRenderer.ts` | `is-${msg.status}` | `? " is-stopped" : ` is-${msg.status}`; const block = messagesEl.createDiv({ cls: `llm-bridge-msg` |
| `src\ui\messageRenderer.ts` | `llm-bridge-msg-${msg.role}` | `essagesEl.createDiv({ cls: `llm-bridge-msg llm-bridge-msg-${msg.role}${kindClass}`, attr: { "data-msg-id": msg.id }, });` |
| `src\ui\messageRenderer.ts` | `llm-bridge-msg-time${presentation.timeFaded ? " is-faded" : ""}` | `) { head.createEl("span", { cls: `llm-bridge-msg-time${presentation.timeFaded ? " is-faded" : ""}`, text: new Date(` |
| `src\ui\messageRenderer.ts` | `is-${ref.kind}` | `Div({ cls: `llm-bridge-msg-attachment-chip is-${ref.kind} is-${ref.fileType}`, attr: { title: `${ref.displayName}\n${ref.resol` |
| `src\ui\messageRenderer.ts` | `is-${ref.fileType}` | `s: `llm-bridge-msg-attachment-chip is-${ref.kind} is-${ref.fileType}`, attr: { title: `${ref.displayName}\n${ref.resolvedPath}` },` |
| `src\ui\messageRenderer.ts` | `n${ref.resolvedPath}` | `Type}`, attr: { title: `${ref.displayName}\n${ref.resolvedPath}` }, }); const preview = chip.createEl("button", { cl` |
| `src\ui\messageRenderer.ts` | `is-${msg.status}` | `ummary", "is-completed"); else block.addClass(`is-${msg.status}`); const statusEl = block.querySelector(".llm-bridge-msg-status");` |
| `src\ui\messageRenderer.ts` | `is-${msg.status}` | `statusEl.className = `llm-bridge-msg-status is-${msg.status}`; } else { statusEl.remove(); } } // 限定在 msg-head` |
| `src\view.ts` | `m${Date.now()}` | `extMsgId(): string { msgIdSeq += 1; return `m${Date.now()}_${msgIdSeq}`; } type ComposerRuntimeCapabilitySelection = { readonly` |
| `src\view.ts` | `llm-bridge-context-tag-${kind}` | `ent.createDiv({ cls: `llm-bridge-context-tag-wrap llm-bridge-context-tag-${kind}` }); const check = wrap.createEl("input", { type: "che` |
| `src\view.ts` | `llm-bridge-command-menu-plugin${plugin.enabled ? "" : " is-disabled"}` | `tem = section.createEl("button", { cls: `llm-bridge-command-menu-plugin${plugin.enabled ? "" : " is-disabled"}`, attr: {` |
| `src\view.ts` | `n${hints}` | `rn `Preferred runtime capabilities for this turn:\n${hints}\n\nUser request:\n${userInput}`; } private refreshAllChips(): void {` |
| `src\view.ts` | `n${userInput}` | `ilities for this turn:\n${hints}\n\nUser request:\n${userInput}`; } private refreshAllChips(): void { // composer agent 下拉 c` |
| `src\view.ts` | `llm-bridge-status-dot-${status}` | `is.statusDotEl.className = `llm-bridge-status-dot llm-bridge-status-dot-${status}`; this.statusDotEl.setAttribute("title", installStatu` |
| `src\view.ts` | `is-${pfStatus.kind}` | `own"); this.statusPreflightEl.classList.add(`is-${pfStatus.kind}`); // V2.3: 权限策略 const policy = s.permissionPolicy ?? "mediu` |
| `src\view.ts` | `is-${policy}` | `gh"); this.statusPermissionEl.classList.add(`is-${policy}`); // 审批画像（优先显示本轮 EffectiveRunPlan 实际生效值） const profile = this.disp` |
| `src\view.ts` | `n${profileInfo.description}` | `odeEl.setAttribute("title", `${profileInfo.title}\n${profileInfo.description}`); this.statusPermModeEl.classList.remove("is-safe", "is-` |
| `src\view.ts` | `is-${profile}` | `cess"); this.statusPermModeEl.classList.add(`is-${profile}`); // V2.3: 最近一次 SDK 运行的工具步骤与 agent 数 this.statusToolsEl.querySele` |
| `src\view.ts` | `is-risk-${riskLevel}` | `n", { cls: `llm-bridge-approval-card-badge is-risk-${riskLevel}`, text: riskLevel === "high" ? "高风险" : riskLevel === "medium"` |
| `src\view.ts` | `is-risk-${riskLevel}` | `proval-card-row llm-bridge-approval-card-row-risk is-risk-${riskLevel}`, text: first.riskReason, }); } if (first.s` |
| `src\view.ts` | `is-${kind}` | `"span", { cls: `llm-bridge-run-status-text is-${kind}`, text: this.localizeRunStatus(text), }); if (kind === "runnin` |
| `src\view.ts` | `is-step-${draft.stepIndex + 1}` | `t.createDiv({ cls: `llm-bridge-clarification-card is-step-${draft.stepIndex + 1}` }); const header = card.createDiv({ cls: "llm-bridge-` |
| `src\view.ts` | `llm-bridge-clarification-option${selected ? " is-selected" : ""}` | `st row = body.createEl("button", { cls: `llm-bridge-clarification-option${selected ? " is-selected" : ""}${multiSelect ? " is-multi` |
| `src\view.ts` | `screenshot-${Date.now()}` | `n await this.persistBinaryAttachmentToVault(png, `screenshot-${Date.now()}.png`, "paste"); } catch { return null; } }` |
| `src\view.ts` | `is-${ref.fileType}` | `b = parent.createEl("span", { cls: `${thumbClass} is-${ref.fileType}` }); const lines = this.getDocumentPreviewLines(ref, maxLines, max` |
| `src\view.ts` | `is-${options.variant}` | `iner.createDiv({ cls: `llm-bridge-context-section is-${options.variant}` }); const head = section.createDiv({ cls: "llm-bridge-context-` |
| `src\view.ts` | `is-${ref.kind}` | `ateDiv({ cls: `llm-bridge-context-ref-chip is-${ref.kind} is-${ref.status} is-${ref.fileType}`, attr: { title: `${ref.displayN` |
| `src\view.ts` | `is-${ref.status}` | `cls: `llm-bridge-context-ref-chip is-${ref.kind} is-${ref.status} is-${ref.fileType}`, attr: { title: `${ref.displayName}\n${this.fi` |
| `src\view.ts` | `is-${ref.fileType}` | `-context-ref-chip is-${ref.kind} is-${ref.status} is-${ref.fileType}`, attr: { title: `${ref.displayName}\n${this.fileRefDisplayPath(` |
| `src\view.ts` | `n${this.fileRefDisplayPath(ref)}` | `Type}`, attr: { title: `${ref.displayName}\n${this.fileRefDisplayPath(ref)}\n${this.fileRefBadgeLabel(ref)}` }, }); chip.ad` |
| `src\view.ts` | `n${this.fileRefBadgeLabel(ref)}` | `ref.displayName}\n${this.fileRefDisplayPath(ref)}\n${this.fileRefBadgeLabel(ref)}` }, }); chip.addEventListener("click", () => voi` |
| `src\view.ts` | `is-${ref.fileType}` | `ntentEl.createDiv({ cls: `llm-bridge-file-preview is-${ref.fileType}` }); const thumbnailUrl = ref.fileType === "image" ? this.getFileR` |
| `src\view.ts` | `is-risk-${req.risk}` | `l.createDiv({ cls: `llm-bridge-external-read-card is-risk-${req.risk} is-safety-${req.grantRootSafety}` }); const title = card.create` |
| `src\view.ts` | `is-safety-${req.grantRootSafety}` | `llm-bridge-external-read-card is-risk-${req.risk} is-safety-${req.grantRootSafety}` }); const title = card.createDiv({ cls: "llm-brid` |
| `src\view.ts` | `is-${fileType}` | `iv({ cls: `llm-bridge-external-read-target is-${fileType} is-risk-${req.risk}`, attr: { title: `${req.requestedPath}\n${req.pr` |
| `src\view.ts` | `is-risk-${req.risk}` | `: `llm-bridge-external-read-target is-${fileType} is-risk-${req.risk}`, attr: { title: `${req.requestedPath}\n${req.proposedGrantRoot` |
| `src\view.ts` | `n${req.proposedGrantRoot || ""}` | `sk}`, attr: { title: `${req.requestedPath}\n${req.proposedGrantRoot \|\| ""}`.trim() }, }); const thumb = target.createEl("sp` |
| `src\view.ts` | `is-${req.risk}` | `an", { cls: `llm-bridge-external-read-target-risk is-${req.risk}`, text: req.risk === "high" ? "high risk" : req.risk === "medium" ? "medium` |
| `src\view.ts` | `is-disposition-${model.finalAnswerDisposition}` | `odel.finalAnswerDisposition); wrap.addClass(`is-disposition-${model.finalAnswerDisposition}`); const head = wrap.createDiv({ cls:` |
| `src\view.ts` | `llm-bridge-codex-detail-${slug}` | `eateEl("details", { cls: `llm-bridge-codex-detail llm-bridge-codex-detail-${slug}` }); const lines = value.split(/\r?\n/).filter((line)` |
| `src\view.ts` | `n${outputText}` | `mmandText && outputText) return `$ ${commandText}\n${outputText}`.trim(); if (commandText) return `$ ${commandText}`; return outpu` |
| `src\view.ts` | `is-${phase.type}` | `= parent.createDiv({ cls: `llm-bridge-phase-card is-${phase.type} is-${phase.status}` }); const head = card.createDiv({ cls: "llm-brid` |
| `src\view.ts` | `is-${phase.status}` | `iv({ cls: `llm-bridge-phase-card is-${phase.type} is-${phase.status}` }); const head = card.createDiv({ cls: "llm-bridge-phase-head" })` |
| `src\view.ts` | `is-${phase.status}` | `.createEl("span", { cls: `llm-bridge-phase-status is-${phase.status}`, text: statusLabel }); // 耗时 if (phase.durationMs !== unde` |
| `src\view.ts` | `is-${fc.action}` | `dy.createDiv({ cls: `llm-bridge-phase-file-change is-${fc.action}` }); const fcHead = fcEl.createDiv({ cls: "llm-bridge-phase-file-ch` |
| `src\view.ts` | `is-${tool.status}` | `El = body.createDiv({ cls: `llm-bridge-phase-tool is-${tool.status}` }); const toolHead = toolEl.createDiv({ cls: "llm-bridge-phase-t` |
| `src\view.ts` | `llm-bridge-phase-user-input-option${selectedValue === optionValue ? " is-selected" : ""}` | `tionsEl.createEl("button", { cls: `llm-bridge-phase-user-input-option${selectedValue === optionValue ? " is-selected" : ""}`,` |
| `src\view.ts` | `is-${card.status}` | `Div({ cls: `llm-bridge-tl-node llm-bridge-tl-tool is-${card.status}` }); node.createDiv({ cls: "llm-bridge-tl-dot" }); const conte` |
| `src\view.ts` | `is-${iconCat.category}` | `.createEl("span", { cls: `llm-bridge-tl-tool-icon is-${iconCat.category}`, text: iconCat.icon }); // P4-D: 普通用户态用简洁 label（如 "Read AGENT` |
| `src\view.ts` | `is-risk-${card.riskLevel}` | `t.createDiv({ cls: `llm-bridge-turn-approval-card is-risk-${card.riskLevel}` }); approval.setAttribute("data-request-id", card.reques` |
| `src\view.ts` | `is-${card.riskLevel}` | `{ cls: `llm-bridge-turn-approval-risk is-${card.riskLevel}`, text: card.riskLevel === "high" ? "高风险" : "需确认",` |
| `src\view.ts` | `is-${card.status}` | `cls: `llm-bridge-tl-node llm-bridge-tl-user-input is-${card.status}` }); node.createDiv({ cls: "llm-bridge-tl-dot" }); const conte` |
| `src\view.ts` | `is-${entry.status}` | `-workflow-trace-item ${workflowStageClass(stage)} is-${entry.status}`, }); item.createEl("span", { cls: "llm-bridge-workflow-t` |
| `src\view.ts` | `llm-bridge-collapse${emphasize ? " is-emphasized" : ""}` | `void { const wrap = parent.createDiv({ cls: `llm-bridge-collapse${emphasize ? " is-emphasized" : ""}` }); const head = wrap.create` |
| `src\view.ts` | `n${item.messageCount}` | `row.setAttribute("title", `${item.title}\n${item.messageCount} 条消息 · ${item.savedAt}`); row.addEventListener("click", asyn` |
| `src\view.ts` | `is-${item.status}` | `reateDiv({ cls: `llm-bridge-history-item is-${item.status}${item.id === this.currentSessionId ? " is-current" : ""}`, attr` |
| `src\view.ts` | `is-${item.id === this.currentSessionId ? "current" : item.status}` | `, { cls: `llm-bridge-history-status-text is-${item.id === this.currentSessionId ? "current" : item.status}`, text: item.id` |
| `src\view.ts` | `llm-bridge-${skill.name}` | `ridge-{name} 或 slug 匹配） const runtimeName = `llm-bridge-${skill.name}`; const runtimeDiscovered = this.runtimeDiscoveredSkillNames` |
| `src\view.ts` | `llm-bridge-agent-skill-registry-item${skill.enabled ? "" : " is-disabled"}` | `const item = parent.createDiv({ cls: `llm-bridge-agent-skill-registry-item${skill.enabled ? "" : " is-disabled"}`, attr:` |
| `src\view.ts` | `llm-bridge-vc-status-badge${materialized ? " is-ok" : " is-warn"}` | `row" }); row.createEl("span", { cls: `llm-bridge-vc-status-badge${materialized ? " is-ok" : " is-warn"}`, text: materiali` |
| `src\view.ts` | `llm-bridge-vc-status-badge${runtimeDiscovered ? " is-ok" : " is-muted"}` | `}); row.createEl("span", { cls: `llm-bridge-vc-status-badge${runtimeDiscovered ? " is-ok" : " is-muted"}`, text: run` |
| `src\view.ts` | `llm-bridge-codex-plugin-item${plugin.enabled ? "" : " is-disabled"}` | `eDiv({ cls: `llm-bridge-agent-skill-registry-item llm-bridge-codex-plugin-item${plugin.enabled ? "" : " is-disabled"}` }); const icon` |
| `src\view.ts` | `is-${step.status}` | `owBody.createDiv({ cls: `llm-bridge-run-flow-item is-${step.status}` }); item.createEl("span", { cls: "llm-bridge-run-flow-dot" });` |
| `src\view.ts` | `is-${finalStatus}` | `"is-running"); this.runFlowEl.classList.add(`is-${finalStatus}`); this.runFlowBody.setAttribute("hidden", ""); this.runFlowTo` |
| `src\view.ts` | `is-${entry.status}` | `bridge-run-flow-item ${workflowStageClass(stage)} is-${entry.status}`, }); item.createEl("span", { cls: "llm-bridge-run-flow-d` |
| `src\workflowEvent.ts` | `is-progress-${event.category ?? "status"}` | `erm-denied"; case "progress": return `is-progress-${event.category ?? "status"}`; case "error": return event.recover` |
| `main.ts` | `smoke-${Date.now()}` | `const session = createBridgeSession( `smoke-${Date.now()}`, this.settings, cwd \|\| this.getVaultPath(), this` |
| `main.ts` | `n${(e as Error)?.stack || e}` | `.writeFile(diagPath, `${new Date().toISOString()}\n${(e as Error)?.stack \|\| e}\n`, "utf8"); } catch { /* ignore */ } new Notic` |
| `main.ts` | `n${sel}` | `v) return; v.setInput(`关于以下选区：\n\n\`\`\`\n${sel}\n\`\`\`\n\n`); }, }); // 2. Rewrite selection with Agent —— 预填指` |
| `main.ts` | `n${sel}` | `replace_selection action 把重写结果写回原选区位置：\n\n\`\`\`\n${sel}\n\`\`\`\n`); await v.runNow(); }, }); // 3. Summarize` |
| `main.ts` | `n${sel}` | `outputDir}/\` 目录下，自行拟定文件名和 frontmatter：\n\n\`\`\`\n${sel}\n\`\`\`\n`); await v.runNow(); }, }); // 5. Open last` |
| `main.ts` | `n${authProbe.hint}` | `statusMsg = `Pi SDK 已安装${fromInfo}，但认证/模型未配置：\n${authProbe.hint}`; noticeClass = "llm-bridge-notice-warn"; }` |
| `scripts\build-release.mjs` | `user-package-offline-${platformKey}` | `flineRuntime ? path.join(PROJECT_ROOT, "dist", `user-package-offline-${platformKey}`) : path.join(PROJECT_ROOT, "dist", "user-package");` |
| `scripts\build-release.mjs` | `llm-cli-bridge-${version}` | `fflineRuntime ? "-offline" : ""; const zipName = `llm-cli-bridge-${version}-${platformKey}${zipSuffix}.zip`; const zipPath = path.join(relea` |
| `scripts\build-release.mjs` | `user-package${offlineRuntime ? ":offline" : ""}` | `console.error(`[release] 提示：先运行 npm run build:user-package${offlineRuntime ? ":offline" : ""}`); process.exit(1); } console.log(` |
| `scripts\build-release.mjs` | `user-package${offlineRuntime ? ":offline" : ""}` | `） console.log(`\n[release] 步骤 1: 执行 npm run build:user-package${offlineRuntime ? ":offline" : ""}...`); try { execSync(`npm run build:user` |
| `scripts\build-release.mjs` | `user-package${offlineRuntime ? ":offline" : ""}` | `line" : ""}...`); try { execSync(`npm run build:user-package${offlineRuntime ? ":offline" : ""}`, { cwd: PROJECT_ROOT, stdio: "inh` |
| `scripts\build-user-package.mjs` | `user-package-offline-${platformKey}` | `in( PROJECT_ROOT, "dist", offlineRuntime ? `user-package-offline-${platformKey}` : "user-package", ); const SDK_PACKAGE_NAME = "@earen` |
| `scripts\build-user-package.mjs` | `llm-cli-bridge-${platformKey}` | `console.log(`[user-package] platformPackageName: llm-cli-bridge-${platformKey}`); // 1. 先执行 npm run build（含 tsc 类型检查 + esbuild；V17-E1 任务 G` |
| `scripts\build-user-package.mjs` | `llm-cli-bridge-${platformKey}` | `; const userPkgMeta = { name: offlineRuntime ? `llm-cli-bridge-${platformKey}` : "llm-cli-bridge", version: version, description: offl` |
| `scripts\build-user-package.mjs` | `llm-cli-bridge-${platformKey}` | `i-bridge-linux-x64", ], platformPackageName: `llm-cli-bridge-${platformKey}`, containsRuntimeBinary: offlineRuntime, runtimeDownload` |
| `scripts\cdp-screenshots.mjs` | `obsidian-${width}` | `m(result.data, "base64"); const filename = `obsidian-${width}px.png`; writeFileSync(join(SCREENSHOT_DIR, filename), buffer);` |
| `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` | `user-package-offline-${PLATFORM_KEY}` | `OFFLINE_PACKAGE_DIR = join(PROJECT_ROOT, "dist", `user-package-offline-${PLATFORM_KEY}`); const USER_PACKAGE_META_PATH = join(USER_PACKAGE_D` |
| `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` | `skip-${reason}` | `function setSkip(reason, detail = "", status = `skip-${reason}`) { report.skipReason = reason; report.skipDetail = detail; report.re` |
| `scripts\codex-real-protocol-capability-smoke.mjs` | `codex-req-${serverRequestId}` | `kind: "approval_request", requestId: `codex-req-${serverRequestId}`, toolName: isCommand ? "Bash" : "Write", descr` |
| `scripts\codex-real-protocol-capability-smoke.mjs` | `codex-req-${serverRequestId}` | `kind: "approval_resolved", requestId: `codex-req-${serverRequestId}`, response: { type: responseType }, source: "us` |
| `scripts\codex-real-protocol-capability-smoke.mjs` | `question-${index + 1}` | `stions.map((q, index) => ({ id: q.id \|\| `question-${index + 1}`, header: q.header \|\| undefined, question: q.quest` |
| `scripts\codex-real-protocol-capability-smoke.mjs` | `codex-input-${serverRequestId}` | `kind: "user_input_request", requestId: `codex-input-${serverRequestId}`, toolName: "request_user_input", prompt: que` |
| `scripts\codex-real-protocol-capability-smoke.mjs` | `codex-input-${serverRequestId}` | `kind: "user_input_resolved", requestId: `codex-input-${serverRequestId}`, response, source: "user", }, }; }` |
| `scripts\codex-real-protocol-capability-smoke.mjs` | `turn-${name}` | `threadConfig }) { const builder = new Builder(`turn-${name}`, providerId, new Date().toISOString()); const rawEvents = []; const se` |
| `scripts\codex-runtime-install-default-package-smoke.mjs` | `extract-${platformKey}` | `; const extractDir = existsSync(join(cacheDir, `extract-${platformKey}`)); return partialRuntime \|\| extractDir \|\| existsSync(runtimePath` |
| `scripts\codex-runtime-install-download-smoke.mjs` | `extract-${platformKey}` | `; const extractDir = existsSync(join(cacheDir, `extract-${platformKey}`)); return partialRuntime \|\| extractDir \|\| existsSync(runtimePath` |
| `scripts\fixtures\fixture-cli.mjs` | `fixture-output-${Date.now()}` | `} catch { /* 已存在忽略 */ } const fileName = `fixture-output-${Date.now()}.md`; writeFileSync(join(targetDir, fileName), `# Fixtu` |
| `scripts\generate-codex-schema.mjs` | `codex-schema-gen-${Date.now()}` | `(/\r?\n/)[0]; const tmpOut = join(tmpdir(), `codex-schema-gen-${Date.now()}`); mkdirSync(tmpOut, { recursive: true }); console.` |
| `scripts\generate-runtime-distribution-report.mjs` | `user-package-offline-${PLATFORM_KEY}` | `OFFLINE_PACKAGE_DIR = join(PROJECT_ROOT, "dist", `user-package-offline-${PLATFORM_KEY}`); const MANIFEST_PATH = join(PROJECT_ROOT, "src", "r` |
| `scripts\install-codex-managed-runtime.mjs` | `extract-${platformKey}` | `equired" }; const extractDir = join(cacheDir, `extract-${platformKey}`); const tarballPath = join(cacheDir, fileNameFromUrl(entry.artif` |
| `scripts\install-codex-managed-runtime.mjs` | `partial-${process.pid}` | `l)); const partialRuntimePath = `${runtimePath}.partial-${process.pid}-${Date.now()}`; let activeTarballPath = null; mkdirSync(cacheDi` |
| `scripts\obsidian-http-smoke.mjs` | `smoke-accept-${Date.now()}` | `ction testApprovalAccept() { const actionId = `smoke-accept-${Date.now()}`; const notePath = `smoke-test/smoke-accept-${Date.now()}.md` |
| `scripts\obsidian-http-smoke.mjs` | `smoke-accept-${Date.now()}` | `t-${Date.now()}`; const notePath = `smoke-test/smoke-accept-${Date.now()}.md`; const r1 = await fetchBridge("/action", { method:` |
| `scripts\obsidian-http-smoke.mjs` | `smoke-reject-${Date.now()}` | `ction testApprovalReject() { const actionId = `smoke-reject-${Date.now()}`; const notePath = `smoke-test/smoke-reject-${Date.now()}.md` |
| `scripts\obsidian-http-smoke.mjs` | `smoke-reject-${Date.now()}` | `t-${Date.now()}`; const notePath = `smoke-test/smoke-reject-${Date.now()}.md`; const r1 = await fetchBridge("/action", { method:` |
| `scripts\obsidian-http-smoke.mjs` | `smoke-idem-${Date.now()}` | `ction testDevIdempotency() { const actionId = `smoke-idem-${Date.now()}`; const notePath = `smoke-test/smoke-idem-${Date.now()}.md`;` |
| `scripts\obsidian-http-smoke.mjs` | `smoke-idem-${Date.now()}` | `m-${Date.now()}`; const notePath = `smoke-test/smoke-idem-${Date.now()}.md`; const r1 = await fetchBridge("/action", { method: "P` |
| `scripts\presentation\fixtures\codex-run-events.mjs` | `item-${sequence}` | `itemId: payload.callId \|\| payload.requestId \|\| `item-${sequence}`, method: payload.kind, sequence, }, payload, ...` |
| `src\httpServer.ts` | `"state-" + …` | `{ const result = await this.runAction({ id: "state-" + Date.now(), type: "get_state", params: {} }, { log: false }); this.sendJs` |
| `src\view.ts` | `"llm-bridge-tl-tool-cat-" + …` | `tegory(node.toolName ?? ""); item.addClass("llm-bridge-tl-tool-cat-" + toolInfo.category); const headEl = content.createDiv({` |
| `scripts\cdp-cli-smoke-v216a.mjs` | `"cli-smoke-" + …` | `const evts = []; const task = { id: "cli-smoke-" + Date.now(), userMessage: "只回复 OK", prompt: "只回复 OK 两个字，不要使用` |
| `scripts\cdp-effective-model-smoke-v216c.mjs` | `"eff-model-" + …` | `nst wfEvts = []; const task = { id: "eff-model-" + Date.now(), userMessage: "只回复 OK", prompt: "只回复 OK 两个字，不要使用` |
| `scripts\cdp-runtime-smoke-v216b.mjs` | `"auto-sdk-" + …` | `nst wfEvts = []; const task = { id: "auto-sdk-" + Date.now(), userMessage: "只回复 OK", prompt: "只回复 OK 两个字，不要使用任` |
| `scripts\cdp-runtime-smoke-v216b.mjs` | `"cli-explicit-" + …` | `const evts = []; const task = { id: "cli-explicit-" + Date.now(), userMessage: "只回复 OK", prompt: "只回复 OK 两个字。"` |
| `scripts\cdp-sdk-smoke-v216a.mjs` | `"sdk-smoke-read-" + …` | `nst wfEvts = []; const task = { id: "sdk-smoke-read-" + Date.now(), userMessage: "Read marker file", prompt: "` |
| `scripts\cdp-sdk-smoke-v216a.mjs` | `"sdk-smoke-edit-" + …` | `nst wfEvts = []; const task = { id: "sdk-smoke-edit-" + Date.now(), userMessage: "Create output file", prompt:` |
| `scripts\fixtures\fake-pi-coding-agent.mjs` | `"fake-session-" + …` | `tSession { constructor() { this.sessionId = "fake-session-" + Math.random().toString(36).slice(2, 8); this.isStreaming = false;` |

## Overlap with other `styles/*.css` files

Classes that are ALSO defined (or referenced) in another stylesheet. Overlap means deleting the rule from `legacy.css` is safe ONLY if the other stylesheet still provides the rule; otherwise deleting will remove the styling entirely.

Total overlapping class selectors: **113**

<details><summary>Full overlap list</summary>

| Class | Other CSS files |
|---|---|
| `.is-preview-only` | `message.css` |
| `.llm-bridge-action-col` | `composer.css` |
| `.llm-bridge-approval-card` | `composer.css` |
| `.llm-bridge-attach-file-btn` | `composer.css` |
| `.llm-bridge-clarification-card` | `composer.css` |
| `.llm-bridge-codex-change-diff-summary` | `run-view.css` |
| `.llm-bridge-codex-change-path` | `run-view.css` |
| `.llm-bridge-codex-change-row` | `run-view.css` |
| `.llm-bridge-codex-current-activity` | `run-view.css` |
| `.llm-bridge-codex-current-activity-text` | `run-view.css` |
| `.llm-bridge-codex-diagnostics-head` | `run-view.css` |
| `.llm-bridge-codex-event-block` | `run-view.css` |
| `.llm-bridge-codex-event-body` | `run-view.css` |
| `.llm-bridge-codex-event-summary` | `run-view.css` |
| `.llm-bridge-codex-feed-icon` | `run-view.css` |
| `.llm-bridge-codex-feed-item` | `run-view.css` |
| `.llm-bridge-codex-feed-label` | `run-view.css` |
| `.llm-bridge-codex-feed-list` | `run-view.css` |
| `.llm-bridge-codex-feed-main` | `run-view.css` |
| `.llm-bridge-codex-feed-meta` | `run-view.css` |
| `.llm-bridge-codex-feed-summary` | `run-view.css` |
| `.llm-bridge-codex-feed-title` | `run-view.css` |
| `.llm-bridge-codex-inline-shell-panel` | `run-view.css` |
| `.llm-bridge-codex-process` | `run-view.css` |
| `.llm-bridge-codex-process-body` | `run-view.css` |
| `.llm-bridge-codex-process-head` | `run-view.css` |
| `.llm-bridge-codex-run-body` | `run-view.css` |
| `.llm-bridge-codex-run-header` | `run-view.css` |
| `.llm-bridge-codex-run-metric` | `run-view.css` |
| `.llm-bridge-codex-run-metric-icon` | `run-view.css` |
| `.llm-bridge-codex-run-metrics` | `run-view.css` |
| `.llm-bridge-codex-run-provider` | `run-view.css` |
| `.llm-bridge-codex-run-status` | `run-view.css` |
| `.llm-bridge-codex-run-summary` | `run-view.css` |
| `.llm-bridge-codex-run-view` | `run-view.css` |
| `.llm-bridge-codex-section-head` | `run-view.css` |
| `.llm-bridge-codex-section-title` | `run-view.css` |
| `.llm-bridge-codex-shell-panel` | `run-view.css` |
| `.llm-bridge-codex-shell-pre` | `run-view.css` |
| `.llm-bridge-codex-step-exit` | `run-view.css` |
| `.llm-bridge-codex-step-status` | `run-view.css` |
| `.llm-bridge-codex-thinking-label` | `run-view.css` |
| `.llm-bridge-codex-thinking-line` | `run-view.css` |
| `.llm-bridge-codex-thinking-summary` | `run-view.css` |
| `.llm-bridge-codex-tool-group` | `run-view.css` |
| `.llm-bridge-codex-tool-group-status` | `run-view.css` |
| `.llm-bridge-command-menu` | `composer.css` |
| `.llm-bridge-command-menu-body` | `composer.css` |
| `.llm-bridge-command-menu-item` | `composer.css` |
| `.llm-bridge-command-menu-label` | `composer.css` |
| `.llm-bridge-command-menu-summary` | `composer.css` |
| `.llm-bridge-composer` | `composer.css` |
| `.llm-bridge-composer-bar` | `composer.css` |
| `.llm-bridge-composer-context` | `composer.css` |
| `.llm-bridge-composer-file-image` | `composer.css` |
| `.llm-bridge-composer-file-refs` | `composer.css` |
| `.llm-bridge-composer-tool-btn` | `composer.css` |
| `.llm-bridge-composer-tools-left` | `composer.css` |
| `.llm-bridge-composer-tools-right` | `composer.css` |
| `.llm-bridge-context-ref-chip` | `composer.css` |
| `.llm-bridge-context-ref-doc-line` | `composer.css` |
| `.llm-bridge-context-ref-doc-thumb` | `composer.css` |
| `.llm-bridge-context-section` | `composer.css` |
| `.llm-bridge-context-strip` | `composer.css` |
| `.llm-bridge-context-tags` | `composer.css` |
| `.llm-bridge-effort-option` | `composer.css` |
| `.llm-bridge-files-page` | `composer.css`, `secondary.css` |
| `.llm-bridge-history-page` | `secondary.css` |
| `.llm-bridge-input` | `composer.css` |
| `.llm-bridge-input-row` | `composer.css` |
| `.llm-bridge-main` | `shell.css` |
| `.llm-bridge-mention-picker` | `composer.css` |
| `.llm-bridge-messages` | `composer.css` |
| `.llm-bridge-model-effort-chip` | `composer.css` |
| `.llm-bridge-model-effort-picker` | `composer.css` |
| `.llm-bridge-model-effort-popover` | `composer.css` |
| `.llm-bridge-model-option` | `composer.css` |
| `.llm-bridge-msg-assistant` | `message.css` |
| `.llm-bridge-msg-attachment-chip` | `message.css` |
| `.llm-bridge-msg-attachment-doc-line` | `message.css` |
| `.llm-bridge-msg-attachment-doc-thumb` | `message.css` |
| `.llm-bridge-msg-attachment-image` | `message.css` |
| `.llm-bridge-msg-content` | `message.css` |
| `.llm-bridge-msg-markdown` | `message.css` |
| `.llm-bridge-msg-user` | `message.css` |
| `.llm-bridge-nav-item` | `shell.css` |
| `.llm-bridge-nav-label` | `shell.css` |
| `.llm-bridge-nav-rail` | `shell.css` |
| `.llm-bridge-page-title` | `shell.css` |
| `.llm-bridge-perm-option` | `composer.css` |
| `.llm-bridge-perm-option-check` | `composer.css` |
| `.llm-bridge-perm-option-desc` | `composer.css` |
| `.llm-bridge-perm-option-icon` | `composer.css` |
| `.llm-bridge-perm-option-text` | `composer.css` |
| `.llm-bridge-perm-option-title` | `composer.css` |
| `.llm-bridge-perm-popover` | `composer.css` |
| `.llm-bridge-perm-popover-head` | `composer.css` |
| `.llm-bridge-permission-chip` | `composer.css` |
| `.llm-bridge-permission-chip-icon` | `composer.css` |
| `.llm-bridge-permission-chip-label` | `composer.css` |
| `.llm-bridge-permission-picker` | `composer.css` |
| `.llm-bridge-run-status-text` | `message.css`, `run-view.css` |
| `.llm-bridge-secondary-head` | `secondary.css` |
| `.llm-bridge-secondary-kicker` | `secondary.css` |
| `.llm-bridge-send-btn` | `composer.css` |
| `.llm-bridge-session-dropdown-history` | `secondary.css` |
| `.llm-bridge-shell` | `shell.css` |
| `.llm-bridge-skills-page` | `secondary.css` |
| `.llm-bridge-stop-btn` | `composer.css` |
| `.llm-bridge-stop-icon` | `composer.css` |
| `.llm-bridge-timeline-head` | `run-view.css` |
| `.llm-bridge-user-message-text` | `message.css` |
| `.llm-bridge-view` | `shell.css` |

</details>

## UNREACHABLE — deletion candidates

Total: **11**

These classes are NOT referenced in any `.ts` / `.mjs` source AND cannot be produced by a detected dynamic prefix. They are the safest deletion candidates. Still, verify each one before deleting (a few may be set from `.md` documentation or generated DOM not covered here).

| # | Class selector | Also in other CSS? |
|---|---|---|
| 1 | `.llm-bridge-nav-collapse` | — |
| 2 | `.llm-bridge-runtime-tab-content` | — |
| 3 | `.llm-bridge-tl-completed` | — |
| 4 | `.llm-bridge-tl-file-action-create` | — |
| 5 | `.llm-bridge-tl-file-action-delete` | — |
| 6 | `.llm-bridge-tl-file-action-modify` | — |
| 7 | `.llm-bridge-tl-final-text` | — |
| 8 | `.llm-bridge-tl-session_started` | — |
| 9 | `.llm-bridge-tl-thought` | — |
| 10 | `.llm-bridge-tl-tool-path` | — |
| 11 | `.modal-title` | — |

### Notes on deletion candidates

- `.modal-title` — This is a standard Obsidian class automatically applied by the Obsidian `Modal` API to the title element. It IS used at runtime but does not appear in the project's TypeScript source. **Do NOT delete** — it styles Obsidian's built-in modal title for the plugin's modals (`file-preview-modal`, `confirm-modal`, `prompt-modal`, `file-not-found-modal`).
- `.llm-bridge-nav-collapse` — The source uses `.llm-bridge-nav-collapse-btn` (the button), not the bare `.llm-bridge-nav-collapse`. Verify if the base class is needed as a container selector target.
- `.llm-bridge-runtime-tab-content` — The source uses `.llm-bridge-runtime-tab-contents` (plural). This singular form appears to be a typo/leftover.
- `.llm-bridge-tl-*` classes — The timeline renderer uses different, more specific class names (e.g. `.llm-bridge-tl-tool-path-inline` instead of `.llm-bridge-tl-tool-path`, `.llm-bridge-tl-completed-chips` instead of `.llm-bridge-tl-completed`). These bare forms appear to be leftovers from an earlier timeline design.

## UNREACHABLE — likely false-positive (dynamic)

Total: **27**

These classes were NOT found as literal tokens in source, but their name begins with a detected dynamic construction prefix. They are most likely produced at runtime by template literals or string concatenation. Do NOT delete without verifying the runtime values of the interpolated variables.

| # | Class selector | Dynamic prefix | Also in other CSS? |
|---|---|---|---|
| 1 | `.is-approved` | `is-<value>` | — |
| 2 | `.is-cancelled` | `is-<value>` | — |
| 3 | `.is-collapsed` | `is-<value>` | — |
| 4 | `.is-create` | `is-<value>` | — |
| 5 | `.is-declined` | `is-<value>` | — |
| 6 | `.is-delete` | `is-<value>` | — |
| 7 | `.is-file` | `is-<value>` | — |
| 8 | `.is-image` | `is-<value>` | — |
| 9 | `.is-risk-high` | `is-risk-<value>` | — |
| 10 | `.is-risk-low` | `is-risk-<value>` | — |
| 11 | `.is-risk-medium` | `is-risk-<value>` | — |
| 12 | `.is-safety-deny` | `is-safety-<value>` | — |
| 13 | `.is-skipped` | `is-<value>` | — |
| 14 | `.is-verifying` | `is-<value>` | — |
| 15 | `.is-waiting-input` | `is-<value>` | — |
| 16 | `.llm-bridge-msg-assistant` | `llm-bridge-msg-<value>` | `message.css` |
| 17 | `.llm-bridge-msg-user` | `llm-bridge-msg-<value>` | `message.css` |
| 18 | `.llm-bridge-status-dot-completed` | `llm-bridge-status-dot-<value>` | — |
| 19 | `.llm-bridge-status-dot-failed` | `llm-bridge-status-dot-<value>` | — |
| 20 | `.llm-bridge-status-dot-running` | `llm-bridge-status-dot-<value>` | — |
| 21 | `.llm-bridge-status-dot-stopped` | `llm-bridge-status-dot-<value>` | — |
| 22 | `.llm-bridge-tl-tool-cat-bash` | `llm-bridge-tl-tool-cat-<value>` | — |
| 23 | `.llm-bridge-tl-tool-cat-other` | `llm-bridge-tl-tool-cat-<value>` | — |
| 24 | `.llm-bridge-tl-tool-cat-read` | `llm-bridge-tl-tool-cat-<value>` | — |
| 25 | `.llm-bridge-tl-tool-cat-search` | `llm-bridge-tl-tool-cat-<value>` | — |
| 26 | `.llm-bridge-tl-tool-cat-skill` | `llm-bridge-tl-tool-cat-<value>` | — |
| 27 | `.llm-bridge-tl-tool-cat-write` | `llm-bridge-tl-tool-cat-<value>` | — |

## REACHABLE selectors (kept)

Total: **651**

<details><summary>Full reachable list with first-hit file</summary>

| Class | First TS hit | First MJS hit |
|---|---|---|
| `.active` | `src\agentRuntimeWorkspace.ts` | `scripts\cdp-acceptance-smoke.mjs` |
| `.has-preview` | `src\ui\messageRenderer.ts` | `—` |
| `.has-text-preview` | `src\view.ts` | `—` |
| `.is-active` | `src\ui\composerController.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.is-allow-once` | `src\ui\codexRunRenderer.ts` | `scripts\cdp-v164d-smoke.mjs` |
| `.is-allow-session` | `src\ui\codexRunRenderer.ts` | `—` |
| `.is-auto-grown` | `src\ui\composerController.ts` | `scripts\ui-02-smoke.mjs` |
| `.is-available` | `src\view.ts` | `—` |
| `.is-batch-event` | `—` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.is-blocked` | `—` | `scripts\cdp-v164h-smoke.mjs` |
| `.is-build` | `src\workflowTrace.ts` | `—` |
| `.is-cancel` | `src\view.ts` | `—` |
| `.is-caution` | `src\ui\composerController.ts` | `—` |
| `.is-command` | `—` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.is-completed` | `src\runTimeline.ts` | `scripts\cdp-smoke.mjs` |
| `.is-current` | `src\view.ts` | `—` |
| `.is-danger` | `src\ui\composerController.ts` | `—` |
| `.is-decline` | `src\view.ts` | `—` |
| `.is-decline-session` | `src\view.ts` | `—` |
| `.is-deleted` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.is-deny` | `src\ui\codexRunRenderer.ts` | `—` |
| `.is-diff` | `src\workflowTrace.ts` | `—` |
| `.is-disabled` | `src\ui\composerController.ts` | `—` |
| `.is-dismiss-stale` | `src\view.ts` | `—` |
| `.is-done` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.is-emphasized` | `src\view.ts` | `—` |
| `.is-enabled` | `src\view.ts` | `—` |
| `.is-enabled-group` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.is-error` | `src\view.ts` | `—` |
| `.is-expanded` | `src\ui\codexRunRenderer.ts` | `—` |
| `.is-failed` | `src\runTimeline.ts` | `—` |
| `.is-flag` | `src\view.ts` | `—` |
| `.is-high` | `src\view.ts` | `—` |
| `.is-icon-fallback` | `src\view.ts` | `—` |
| `.is-low` | `src\view.ts` | `—` |
| `.is-medium` | `src\view.ts` | `—` |
| `.is-multi` | `src\view.ts` | `—` |
| `.is-muted` | `src\view.ts` | `—` |
| `.is-ok` | `src\view.ts` | `—` |
| `.is-pending` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.is-placeholder` | `src\view.ts` | `—` |
| `.is-preflight` | `src\workflowTrace.ts` | `—` |
| `.is-preview-only` | `src\ui\messageRenderer.ts` | `—` |
| `.is-primary` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.is-proceed` | `src\view.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.is-proceed-session` | `src\view.ts` | `—` |
| `.is-rail-collapsed` | `src\view.ts` | `—` |
| `.is-resolved` | `src\view.ts` | `—` |
| `.is-resolving` | `src\view.ts` | `scripts\cdp-v164h-smoke.mjs` |
| `.is-running` | `src\ui\codexRunRenderer.ts` | `scripts\cdp-smoke.mjs` |
| `.is-runtime` | `src\view.ts` | `—` |
| `.is-safe` | `src\ui\composerController.ts` | `—` |
| `.is-secondary` | `src\view.ts` | `—` |
| `.is-selected` | `src\ui\composerController.ts` | `—` |
| `.is-spawn` | `src\workflowTrace.ts` | `—` |
| `.is-stale` | `src\view.ts` | `scripts\cdp-v164h-smoke.mjs` |
| `.is-started` | `src\runTimeline.ts` | `—` |
| `.is-stderr` | `src\runTimeline.ts` | `—` |
| `.is-stdout` | `src\runTimeline.ts` | `—` |
| `.is-stop-run` | `src\view.ts` | `—` |
| `.is-stopped` | `src\runTimeline.ts` | `—` |
| `.is-subagent` | `src\view.ts` | `—` |
| `.is-submit` | `src\view.ts` | `—` |
| `.is-success` | `src\view.ts` | `—` |
| `.is-text` | `src\view.ts` | `—` |
| `.is-thinking` | `src\workflowEvent.ts` | `—` |
| `.is-unavailable` | `src\view.ts` | `scripts\cdp-ux-state-smoke-v216d.mjs` |
| `.is-unknown` | `src\view.ts` | `—` |
| `.is-warn` | `src\view.ts` | `—` |
| `.llm-bridge-action-col` | `src\view.ts` | `—` |
| `.llm-bridge-agent-select` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-badge` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-desc` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-doc` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-doc-body` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-doc-error-path` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-doc-head` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-doc-kicker` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-doc-path` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-icon` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-meta` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-name` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-open` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-registry-item` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-title-row` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skill-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skills-boundary` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skills-group` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.llm-bridge-agent-skills-group-label` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.llm-bridge-agent-skills-list` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skills-list-container` | `src\view.ts` | `—` |
| `.llm-bridge-agent-skills-panel` | `src\view.ts` | `—` |
| `.llm-bridge-approval-btn` | `src\view.ts` | `scripts\cdp-v164h-smoke.mjs` |
| `.llm-bridge-approval-card` | `src\view.ts` | `scripts\cdp-v164h-smoke.mjs` |
| `.llm-bridge-approval-card-badge` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-badges` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-body` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-btns` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-cancel` | `src\view.ts` | `scripts\cdp-v164h-smoke.mjs` |
| `.llm-bridge-approval-card-dev-body` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-dev-details` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-dev-line` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-header` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-queue` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-row` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-row-command` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-row-label` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-row-risk` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-row-stale` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-row-subagent` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-title` | `src\view.ts` | `—` |
| `.llm-bridge-approval-card-title-icon` | `src\view.ts` | `—` |
| `.llm-bridge-approval-dock` | `src\view.ts` | `—` |
| `.llm-bridge-attach-file-btn` | `src\view.ts` | `—` |
| `.llm-bridge-chip` | `src\view.ts` | `—` |
| `.llm-bridge-chip-check` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-btn` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.llm-bridge-clarification-card` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.llm-bridge-clarification-char-count` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-choice-body` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-close` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-count` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-footer` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-head` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-icon-btn` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-nav` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-option` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.llm-bridge-clarification-option-desc` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-option-enter` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-option-label` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-option-pages` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-other-input` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-other-label` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-other-row` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-page-btn` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-question` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-step` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.llm-bridge-clarification-supplement-body` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-supplement-count` | `src\view.ts` | `—` |
| `.llm-bridge-clarification-supplement-textarea` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.llm-bridge-clarification-title` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.llm-bridge-cmd-preview` | `src\view.ts` | `—` |
| `.llm-bridge-cmd-preview-body` | `src\view.ts` | `—` |
| `.llm-bridge-cmd-preview-copy` | `src\view.ts` | `—` |
| `.llm-bridge-cmd-preview-head` | `src\view.ts` | `—` |
| `.llm-bridge-cmd-preview-label` | `src\view.ts` | `—` |
| `.llm-bridge-cmd-preview-row` | `src\view.ts` | `—` |
| `.llm-bridge-cmd-preview-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-cmd-preview-value` | `src\view.ts` | `—` |
| `.llm-bridge-codex-approval-btn` | `src\ui\codexRunRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-approval-gate` | `src\ui\codexRunRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-approval-gate-action` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-approval-gate-actions` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-approval-gate-head` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-approval-gate-icon` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-approval-gate-reason` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-approval-gate-risk` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-approval-gate-summary` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-approval-gates` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-change-approval` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-change-diff-summary` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-change-path` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-change-row` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-changes-panel` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-current-activity` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-current-activity-text` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-debug-drawer` | `src\view.ts` | `—` |
| `.llm-bridge-codex-debug-drawer-body` | `src\view.ts` | `—` |
| `.llm-bridge-codex-debug-drawer-meta` | `src\view.ts` | `—` |
| `.llm-bridge-codex-debug-drawer-summary` | `src\view.ts` | `—` |
| `.llm-bridge-codex-detail` | `src\view.ts` | `—` |
| `.llm-bridge-codex-detail-panel` | `src\view.ts` | `—` |
| `.llm-bridge-codex-detail-panel-title` | `src\view.ts` | `—` |
| `.llm-bridge-codex-detail-pre` | `src\view.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-diagnostic-item` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-diagnostics` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-diagnostics-body` | `src\ui\codexRunRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-diagnostics-head` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-diagnostics-icon` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-diagnostics-toggle` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-diff-pre` | `src\view.ts` | `—` |
| `.llm-bridge-codex-diff-preview` | `src\view.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-event-block` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-event-body` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-event-summary` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-feed` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-feed-icon` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-feed-item` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-feed-label` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-feed-list` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-feed-main` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-feed-meta` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-feed-summary` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-feed-title` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-final-answer` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-inline-shell-panel` | `src\view.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-plugin-desc` | `src\view.ts` | `—` |
| `.llm-bridge-codex-plugin-item` | `src\view.ts` | `—` |
| `.llm-bridge-codex-plugin-meta` | `src\view.ts` | `—` |
| `.llm-bridge-codex-plugins-count` | `src\view.ts` | `—` |
| `.llm-bridge-codex-plugins-head` | `src\view.ts` | `—` |
| `.llm-bridge-codex-plugins-hint` | `src\view.ts` | `—` |
| `.llm-bridge-codex-plugins-panel` | `src\view.ts` | `—` |
| `.llm-bridge-codex-plugins-title` | `src\view.ts` | `—` |
| `.llm-bridge-codex-process` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-process-body` | `src\ui\codexRunRenderer.ts` | `scripts\ui-01-smoke.mjs` |
| `.llm-bridge-codex-process-head` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-run-body` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-run-header` | `src\ui\codexRunRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-run-metric` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-run-metric-icon` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-run-metrics` | `src\ui\codexRunRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-run-provider` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-run-status` | `src\ui\codexRunRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-run-summary` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-run-view` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-section-head` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-section-title` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-codex-shell-footer` | `src\view.ts` | `—` |
| `.llm-bridge-codex-shell-panel` | `src\view.ts` | `—` |
| `.llm-bridge-codex-shell-panel-head` | `src\view.ts` | `—` |
| `.llm-bridge-codex-shell-panel-meta` | `src\view.ts` | `—` |
| `.llm-bridge-codex-shell-pre` | `src\view.ts` | `—` |
| `.llm-bridge-codex-source-ref` | `src\view.ts` | `—` |
| `.llm-bridge-codex-step-cwd` | `src\view.ts` | `—` |
| `.llm-bridge-codex-step-duration` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-step-exit` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-step-icon` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-step-label` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-step-list` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-step-row` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-step-status` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-thinking-label` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-thinking-line` | `src\ui\codexRunRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-thinking-status` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-thinking-summary` | `src\ui\codexWaterfallRenderer.ts` | `scripts\codex-real-obsidian-runtime-ux-smoke.mjs` |
| `.llm-bridge-codex-tool-group` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-codex-tool-group-status` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-collapse` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-body` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-head` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-section` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-section-body` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-section-head` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-section-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-text` | `src\view.ts` | `—` |
| `.llm-bridge-collapse-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-command-menu` | `src\ui\composerController.ts` | `scripts\cdp-verify-ui-presentation.mjs` |
| `.llm-bridge-command-menu-body` | `src\view.ts` | `—` |
| `.llm-bridge-command-menu-item` | `src\view.ts` | `—` |
| `.llm-bridge-command-menu-label` | `src\view.ts` | `scripts\ui-02-smoke.mjs` |
| `.llm-bridge-command-menu-summary` | `—` | `scripts\ui-02-smoke.mjs` |
| `.llm-bridge-composer` | `src\view.ts` | `scripts\cdp-acceptance-smoke.mjs` |
| `.llm-bridge-composer-bar` | `src\view.ts` | `scripts\cdp-v164e2-user-input-smoke.mjs` |
| `.llm-bridge-composer-context` | `src\view.ts` | `—` |
| `.llm-bridge-composer-file-chip` | `—` | `scripts\cdp-ux-state-smoke-v216d.mjs` |
| `.llm-bridge-composer-file-image` | `src\ui\composerController.ts` | `scripts\cdp-ux-state-smoke-v216d.mjs` |
| `.llm-bridge-composer-file-refs` | `src\view.ts` | `—` |
| `.llm-bridge-composer-tool-btn` | `src\view.ts` | `—` |
| `.llm-bridge-composer-tools-left` | `src\view.ts` | `scripts\ui-02-smoke.mjs` |
| `.llm-bridge-composer-tools-right` | `src\view.ts` | `scripts\ui-02-smoke.mjs` |
| `.llm-bridge-confirm-modal` | `src\view.ts` | `—` |
| `.llm-bridge-confirm-msg` | `src\view.ts` | `—` |
| `.llm-bridge-context-ref-chip` | `src\view.ts` | `—` |
| `.llm-bridge-context-ref-doc-line` | `src\view.ts` | `—` |
| `.llm-bridge-context-ref-doc-thumb` | `src\view.ts` | `—` |
| `.llm-bridge-context-refs` | `src\view.ts` | `—` |
| `.llm-bridge-context-section` | `src\view.ts` | `—` |
| `.llm-bridge-context-strip` | `src\view.ts` | `—` |
| `.llm-bridge-context-tags` | `src\view.ts` | `—` |
| `.llm-bridge-debug-path` | `src\view.ts` | `—` |
| `.llm-bridge-debug-path-copy` | `src\view.ts` | `—` |
| `.llm-bridge-debug-path-label` | `src\view.ts` | `—` |
| `.llm-bridge-debug-path-open` | `src\view.ts` | `—` |
| `.llm-bridge-debug-path-value` | `src\view.ts` | `—` |
| `.llm-bridge-diagnostics-strip` | `src\view.ts` | `—` |
| `.llm-bridge-doc-thumb-fallback` | `src\view.ts` | `—` |
| `.llm-bridge-effort-option` | `src\ui\composerController.ts` | `scripts\cdp-effective-model-smoke-v216c.mjs` |
| `.llm-bridge-empty` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-empty-subtitle` | `src\view.ts` | `—` |
| `.llm-bridge-empty-title` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-actions` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-allow-dir` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-allow-file` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-card` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-card-title` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-count` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-deny` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-field` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-field-label` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-field-value` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-fields` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-header` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-panel` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-source` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-badges` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-ext` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-icon` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-name` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-path` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-risk` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-scope` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-text` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-target-thumb` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-title` | `src\view.ts` | `—` |
| `.llm-bridge-external-read-warning` | `src\view.ts` | `—` |
| `.llm-bridge-file-not-found-modal` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview-container` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview-empty` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview-icon` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview-image` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview-modal` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview-path` | `src\view.ts` | `—` |
| `.llm-bridge-file-preview-text` | `src\view.ts` | `—` |
| `.llm-bridge-files-page` | `src\view.ts` | `—` |
| `.llm-bridge-gen-item` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-gen-list` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-gen-name` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-gen-title` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-gen-wrap` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-guide` | `src\view.ts` | `—` |
| `.llm-bridge-guide-body` | `src\view.ts` | `—` |
| `.llm-bridge-guide-close` | `src\view.ts` | `—` |
| `.llm-bridge-guide-footer` | `src\view.ts` | `—` |
| `.llm-bridge-guide-head` | `src\view.ts` | `—` |
| `.llm-bridge-guide-step` | `src\view.ts` | `—` |
| `.llm-bridge-guide-step-detail` | `src\view.ts` | `—` |
| `.llm-bridge-guide-step-index` | `src\view.ts` | `—` |
| `.llm-bridge-guide-step-text` | `src\view.ts` | `—` |
| `.llm-bridge-guide-step-title` | `src\view.ts` | `—` |
| `.llm-bridge-guide-title` | `src\view.ts` | `—` |
| `.llm-bridge-header` | `src\view.ts` | `scripts\cdp-visual-smoke.mjs` |
| `.llm-bridge-header-right` | `src\view.ts` | `—` |
| `.llm-bridge-history-actions` | `src\view.ts` | `—` |
| `.llm-bridge-history-body` | `src\view.ts` | `—` |
| `.llm-bridge-history-bulkbar` | `src\view.ts` | `—` |
| `.llm-bridge-history-clear-btn` | `src\view.ts` | `—` |
| `.llm-bridge-history-del-btn` | `src\view.ts` | `—` |
| `.llm-bridge-history-delete-selected-btn` | `src\view.ts` | `—` |
| `.llm-bridge-history-edit-btn` | `src\view.ts` | `—` |
| `.llm-bridge-history-empty` | `src\view.ts` | `—` |
| `.llm-bridge-history-first-user` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.llm-bridge-history-head` | `src\view.ts` | `scripts\cdp-visual-smoke.mjs` |
| `.llm-bridge-history-inline-meta` | `src\view.ts` | `—` |
| `.llm-bridge-history-item` | `src\view.ts` | `—` |
| `.llm-bridge-history-last-reply` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.llm-bridge-history-list` | `src\view.ts` | `—` |
| `.llm-bridge-history-list-container` | `src\view.ts` | `—` |
| `.llm-bridge-history-main` | `src\view.ts` | `—` |
| `.llm-bridge-history-page` | `src\view.ts` | `—` |
| `.llm-bridge-history-page-head` | `src\view.ts` | `—` |
| `.llm-bridge-history-panel` | `src\view.ts` | `—` |
| `.llm-bridge-history-preview` | `src\view.ts` | `—` |
| `.llm-bridge-history-refresh-btn` | `src\view.ts` | `scripts\cdp-visual-smoke.mjs` |
| `.llm-bridge-history-row-icon` | `src\view.ts` | `—` |
| `.llm-bridge-history-search` | `src\view.ts` | `—` |
| `.llm-bridge-history-search-input` | `src\view.ts` | `—` |
| `.llm-bridge-history-select` | `src\view.ts` | `—` |
| `.llm-bridge-history-select-all` | `src\view.ts` | `—` |
| `.llm-bridge-history-select-all-input` | `src\view.ts` | `—` |
| `.llm-bridge-history-select-input` | `src\view.ts` | `—` |
| `.llm-bridge-history-sort` | `src\view.ts` | `—` |
| `.llm-bridge-history-status` | `src\view.ts` | `—` |
| `.llm-bridge-history-status-text` | `src\view.ts` | `—` |
| `.llm-bridge-history-title` | `src\view.ts` | `—` |
| `.llm-bridge-history-title-row` | `src\view.ts` | `—` |
| `.llm-bridge-history-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-history-toggle-chevron` | `src\view.ts` | `—` |
| `.llm-bridge-history-toggle-count` | `src\view.ts` | `—` |
| `.llm-bridge-history-toggle-label` | `src\view.ts` | `—` |
| `.llm-bridge-icon` | `src\view.ts` | `—` |
| `.llm-bridge-icon-btn` | `src\view.ts` | `—` |
| `.llm-bridge-input` | `src\view.ts` | `scripts\cdp-acceptance-smoke.mjs` |
| `.llm-bridge-input-row` | `src\view.ts` | `—` |
| `.llm-bridge-list-error` | `src\view.ts` | `—` |
| `.llm-bridge-main` | `src\view.ts` | `—` |
| `.llm-bridge-managed-runtime-settings` | `src\settings.ts` | `—` |
| `.llm-bridge-managed-runtime-settings-grid` | `src\settings.ts` | `—` |
| `.llm-bridge-managed-runtime-settings-title` | `src\settings.ts` | `—` |
| `.llm-bridge-mention-picker` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-badge` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-body` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-check` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-desc` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-icon` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-meta` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-title` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-item-title-row` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-menu-surface` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-messages` | `src\view.ts` | `—` |
| `.llm-bridge-model-effort-chip` | `src\view.ts` | `—` |
| `.llm-bridge-model-effort-picker` | `src\ui\composerController.ts` | `scripts\cdp-smoke.mjs` |
| `.llm-bridge-model-effort-popover` | `src\view.ts` | `—` |
| `.llm-bridge-model-option` | `src\ui\composerController.ts` | `scripts\cdp-effective-model-smoke-v216c.mjs` |
| `.llm-bridge-msg-attachment-chip` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-msg-attachment-doc-line` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-msg-attachment-doc-thumb` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-msg-attachment-image` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-msg-content` | `src\ui\messageRenderer.ts` | `scripts\cdp-ux-state-smoke-v216d.mjs` |
| `.llm-bridge-msg-markdown` | `src\ui\codexWaterfallRenderer.ts` | `—` |
| `.llm-bridge-native-file-input` | `src\view.ts` | `—` |
| `.llm-bridge-nav-collapse-btn` | `src\view.ts` | `—` |
| `.llm-bridge-nav-icon` | `src\view.ts` | `—` |
| `.llm-bridge-nav-item` | `src\view.ts` | `scripts\cdp-check-view.mjs` |
| `.llm-bridge-nav-label` | `src\view.ts` | `scripts\cdp-check-view.mjs` |
| `.llm-bridge-nav-rail` | `src\view.ts` | `—` |
| `.llm-bridge-new-chat-btn` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.llm-bridge-new-chat-label` | `src\view.ts` | `—` |
| `.llm-bridge-page-stack` | `src\view.ts` | `—` |
| `.llm-bridge-page-title` | `src\view.ts` | `—` |
| `.llm-bridge-pending-body` | `src\view.ts` | `—` |
| `.llm-bridge-pending-btn-approve` | `src\view.ts` | `—` |
| `.llm-bridge-pending-btn-reject` | `src\view.ts` | `—` |
| `.llm-bridge-pending-btns` | `src\view.ts` | `—` |
| `.llm-bridge-pending-count` | `src\view.ts` | `—` |
| `.llm-bridge-pending-head` | `src\view.ts` | `—` |
| `.llm-bridge-pending-id` | `src\view.ts` | `—` |
| `.llm-bridge-pending-item` | `src\view.ts` | `—` |
| `.llm-bridge-pending-meta` | `src\view.ts` | `—` |
| `.llm-bridge-pending-row1` | `src\view.ts` | `—` |
| `.llm-bridge-pending-row2` | `src\view.ts` | `—` |
| `.llm-bridge-pending-row3` | `src\view.ts` | `—` |
| `.llm-bridge-pending-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-pending-type` | `src\view.ts` | `—` |
| `.llm-bridge-pending-wrap` | `src\view.ts` | `—` |
| `.llm-bridge-perm-option` | `src\ui\composerController.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-perm-option-check` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-perm-option-desc` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-perm-option-icon` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-perm-option-text` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-perm-option-title` | `src\ui\composerController.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-perm-panel` | `src\view.ts` | `—` |
| `.llm-bridge-perm-popover` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-perm-popover-head` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-perm-snapshot-text` | `src\view.ts` | `—` |
| `.llm-bridge-permission-chip` | `src\view.ts` | `—` |
| `.llm-bridge-permission-chip-icon` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-permission-chip-label` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-permission-picker` | `src\ui\composerController.ts` | `scripts\cdp-verify-ui-presentation.mjs` |
| `.llm-bridge-phase-body` | `src\view.ts` | `scripts\cdp-smoke.mjs` |
| `.llm-bridge-phase-card` | `src\view.ts` | `scripts\cdp-smoke.mjs` |
| `.llm-bridge-phase-duration` | `src\view.ts` | `—` |
| `.llm-bridge-phase-file-change` | `src\view.ts` | `—` |
| `.llm-bridge-phase-file-change-head` | `src\view.ts` | `—` |
| `.llm-bridge-phase-file-change-icon` | `src\view.ts` | `—` |
| `.llm-bridge-phase-file-change-label` | `src\view.ts` | `—` |
| `.llm-bridge-phase-head` | `src\view.ts` | `—` |
| `.llm-bridge-phase-icon` | `src\view.ts` | `—` |
| `.llm-bridge-phase-label` | `src\view.ts` | `—` |
| `.llm-bridge-phase-list` | `src\view.ts` | `—` |
| `.llm-bridge-phase-reasoning` | `src\view.ts` | `—` |
| `.llm-bridge-phase-reasoning-content` | `src\view.ts` | `—` |
| `.llm-bridge-phase-reasoning-head` | `src\view.ts` | `—` |
| `.llm-bridge-phase-reasoning-hint` | `src\view.ts` | `—` |
| `.llm-bridge-phase-reasoning-label` | `src\view.ts` | `—` |
| `.llm-bridge-phase-reasoning-tokens` | `src\view.ts` | `—` |
| `.llm-bridge-phase-status` | `src\view.ts` | `—` |
| `.llm-bridge-phase-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-phase-tool` | `src\view.ts` | `—` |
| `.llm-bridge-phase-tool-auto-approval` | `src\view.ts` | `—` |
| `.llm-bridge-phase-tool-duration` | `src\view.ts` | `—` |
| `.llm-bridge-phase-tool-head` | `src\view.ts` | `—` |
| `.llm-bridge-phase-tool-icon` | `src\view.ts` | `—` |
| `.llm-bridge-phase-tool-label` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-actions` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-btn` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-compose` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-input` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-option` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-options` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-prompt` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-question` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-question-header` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-question-text` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-questions` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-response` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-row` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-title` | `src\view.ts` | `—` |
| `.llm-bridge-phase-user-input-tool` | `src\view.ts` | `—` |
| `.llm-bridge-pinned-context` | `src\view.ts` | `—` |
| `.llm-bridge-process-placeholder` | `src\view.ts` | `—` |
| `.llm-bridge-prompt-input` | `src\view.ts` | `—` |
| `.llm-bridge-prompt-modal` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-body` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-detail` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-dot` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-empty` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-head` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-item` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-label` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-text` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-time` | `src\view.ts` | `—` |
| `.llm-bridge-run-flow-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-run-glow` | `src\ui\codexRunRenderer.ts` | `scripts\cdp-v164h-smoke.mjs` |
| `.llm-bridge-run-status-text` | `src\ui\codexRunRenderer.ts` | `scripts\cdp-v164h-smoke.mjs` |
| `.llm-bridge-runtime-install-btn` | `src\view.ts` | `—` |
| `.llm-bridge-runtime-status` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.llm-bridge-runtime-tab-buttons` | `src\settings.ts` | `—` |
| `.llm-bridge-runtime-tabs` | `src\settings.ts` | `—` |
| `.llm-bridge-sb-advanced-items` | `src\view.ts` | `—` |
| `.llm-bridge-sb-advanced-toggle` | `src\view.ts` | `scripts\cdp-visual-smoke.mjs` |
| `.llm-bridge-sb-agents` | `src\view.ts` | `—` |
| `.llm-bridge-sb-cwd` | `src\view.ts` | `—` |
| `.llm-bridge-sb-item` | `src\view.ts` | `—` |
| `.llm-bridge-sb-items` | `src\view.ts` | `—` |
| `.llm-bridge-sb-label` | `src\view.ts` | `—` |
| `.llm-bridge-sb-perm-mode` | `src\view.ts` | `—` |
| `.llm-bridge-sb-permission` | `src\view.ts` | `—` |
| `.llm-bridge-sb-preflight` | `src\view.ts` | `—` |
| `.llm-bridge-sb-session-title` | `src\view.ts` | `—` |
| `.llm-bridge-sb-title-row` | `src\view.ts` | `—` |
| `.llm-bridge-sb-tools` | `src\view.ts` | `—` |
| `.llm-bridge-sb-value` | `src\view.ts` | `scripts\cdp-acceptance-smoke.mjs` |
| `.llm-bridge-secondary-head` | `src\view.ts` | `—` |
| `.llm-bridge-secondary-kicker` | `src\view.ts` | `—` |
| `.llm-bridge-send-btn` | `src\view.ts` | `scripts\cdp-visual-smoke.mjs` |
| `.llm-bridge-send-icon` | `src\view.ts` | `—` |
| `.llm-bridge-session-caret` | `src\view.ts` | `—` |
| `.llm-bridge-session-dropdown` | `src\ui\composerController.ts` | `—` |
| `.llm-bridge-session-dropdown-clear` | `src\view.ts` | `—` |
| `.llm-bridge-session-dropdown-empty` | `src\view.ts` | `—` |
| `.llm-bridge-session-dropdown-history` | `src\view.ts` | `—` |
| `.llm-bridge-session-dropdown-history-icon` | `src\view.ts` | `—` |
| `.llm-bridge-session-dropdown-item` | `src\view.ts` | `—` |
| `.llm-bridge-session-dropdown-title` | `src\view.ts` | `—` |
| `.llm-bridge-session-icon` | `src\view.ts` | `—` |
| `.llm-bridge-session-kicker` | `src\view.ts` | `—` |
| `.llm-bridge-session-selector` | `src\ui\composerController.ts` | `scripts\cdp-ux-state-smoke-v216d.mjs` |
| `.llm-bridge-setting-hint` | `src\settings.ts` | `—` |
| `.llm-bridge-setting-hint-warn` | `src\settings.ts` | `—` |
| `.llm-bridge-settings-btn` | `src\view.ts` | `scripts\ui-03-smoke.mjs` |
| `.llm-bridge-shell` | `src\view.ts` | `—` |
| `.llm-bridge-skills-body` | `src\view.ts` | `—` |
| `.llm-bridge-skills-empty` | `src\view.ts` | `—` |
| `.llm-bridge-skills-head` | `src\view.ts` | `scripts\cdp-visual-smoke.mjs` |
| `.llm-bridge-skills-page` | `src\view.ts` | `—` |
| `.llm-bridge-skills-refresh-btn` | `src\view.ts` | `—` |
| `.llm-bridge-skills-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-skills-toggle-chevron` | `src\view.ts` | `—` |
| `.llm-bridge-skills-toggle-count` | `src\view.ts` | `—` |
| `.llm-bridge-status-bar` | `src\view.ts` | `—` |
| `.llm-bridge-status-dot` | `src\view.ts` | `—` |
| `.llm-bridge-status-dot-idle` | `src\view.ts` | `—` |
| `.llm-bridge-status-text` | `src\view.ts` | `—` |
| `.llm-bridge-stderr-text` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-stop-btn` | `src\view.ts` | `—` |
| `.llm-bridge-stop-icon` | `src\view.ts` | `—` |
| `.llm-bridge-tab` | `—` | `scripts\cdp-visual-smoke.mjs` |
| `.llm-bridge-tab-button` | `src\settings.ts` | `—` |
| `.llm-bridge-tab-panel` | `src\view.ts` | `scripts\cdp-final-smoke-v216a.mjs` |
| `.llm-bridge-timeline` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-body` | `src\ui\codexRunRenderer.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-timeline-detail` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-dot` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-final` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-head` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-timeline-head-noclick` | `src\ui\codexRunRenderer.ts` | `—` |
| `.llm-bridge-timeline-item` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-label` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-live` | `src\ui\messageRenderer.ts` | `scripts\cdp-effective-model-smoke-v216c.mjs` |
| `.llm-bridge-timeline-live-head` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-live-nodes` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-raw` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-raw-body` | `src\view.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-timeline-raw-head` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-raw-text` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-raw-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-summary` | `src\ui\codexRunRenderer.ts` | `scripts\cdp-smoke.mjs` |
| `.llm-bridge-timeline-text` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-time` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-timeline-wrap` | `src\ui\codexRunRenderer.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-tl-agent` | `—` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-tl-agent-tag` | `src\view.ts` | `—` |
| `.llm-bridge-tl-agent-text` | `src\view.ts` | `scripts\cdp-effective-model-smoke-v216c.mjs` |
| `.llm-bridge-tl-chip` | `src\view.ts` | `—` |
| `.llm-bridge-tl-chip-success` | `src\view.ts` | `—` |
| `.llm-bridge-tl-completed-chips` | `src\view.ts` | `—` |
| `.llm-bridge-tl-content` | `src\view.ts` | `—` |
| `.llm-bridge-tl-detail` | `src\view.ts` | `—` |
| `.llm-bridge-tl-dot` | `src\view.ts` | `—` |
| `.llm-bridge-tl-error` | `src\view.ts` | `—` |
| `.llm-bridge-tl-error-icon` | `src\view.ts` | `—` |
| `.llm-bridge-tl-error-text` | `src\view.ts` | `—` |
| `.llm-bridge-tl-expandable` | `src\view.ts` | `—` |
| `.llm-bridge-tl-failed` | `src\view.ts` | `—` |
| `.llm-bridge-tl-file-action` | `src\view.ts` | `—` |
| `.llm-bridge-tl-file-head` | `src\view.ts` | `—` |
| `.llm-bridge-tl-file-path` | `src\view.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-tl-file-symbol` | `src\view.ts` | `—` |
| `.llm-bridge-tl-file_change` | `—` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-tl-node` | `src\view.ts` | `scripts\cdp-claude-style-smoke-v216c.mjs` |
| `.llm-bridge-tl-thinking-icon` | `src\view.ts` | `—` |
| `.llm-bridge-tl-thinking-meta` | `src\view.ts` | `—` |
| `.llm-bridge-tl-thinking-star` | `src\view.ts` | `—` |
| `.llm-bridge-tl-thinking-title` | `src\view.ts` | `—` |
| `.llm-bridge-tl-thought-body` | `src\view.ts` | `—` |
| `.llm-bridge-tl-thought-text` | `src\view.ts` | `—` |
| `.llm-bridge-tl-title` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-badge` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-duration` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-err` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-head` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-icon` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-name` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-output` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-output-body` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-output-head` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-output-label` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-output-toggle` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-output-wrap` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-param-key` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-param-row` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-param-val` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-params` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool-path-inline` | `src\view.ts` | `—` |
| `.llm-bridge-tl-tool_call` | `—` | `scripts\cdp-effective-model-smoke-v216c.mjs` |
| `.llm-bridge-tl-user-input` | `src\view.ts` | `—` |
| `.llm-bridge-tl-warning` | `src\view.ts` | `—` |
| `.llm-bridge-tl-warning-icon` | `src\view.ts` | `—` |
| `.llm-bridge-tl-warning-text` | `src\view.ts` | `—` |
| `.llm-bridge-topbar` | `src\view.ts` | `scripts\cdp-ux-state-smoke-v216d.mjs` |
| `.llm-bridge-topbar-brand` | `src\view.ts` | `—` |
| `.llm-bridge-topbar-logo` | `src\view.ts` | `—` |
| `.llm-bridge-user-input-dock` | `src\view.ts` | `—` |
| `.llm-bridge-user-input-panel` | `src\view.ts` | `—` |
| `.llm-bridge-user-message-text` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-user-prompt-body` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-user-prompt-collapse` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-user-prompt-count` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-user-prompt-label` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-user-prompt-preview` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-user-prompt-summary` | `src\ui\messageRenderer.ts` | `—` |
| `.llm-bridge-vc-status` | `src\view.ts` | `—` |
| `.llm-bridge-vc-status-badge` | `src\view.ts` | `—` |
| `.llm-bridge-vc-status-row` | `src\view.ts` | `—` |
| `.llm-bridge-view` | `src\view.ts` | `scripts\cdp-check-view.mjs` |
| `.llm-bridge-workflow-trace` | `src\view.ts` | `scripts\cdp-smoke.mjs` |
| `.llm-bridge-workflow-trace-detail` | `src\view.ts` | `—` |
| `.llm-bridge-workflow-trace-dot` | `src\view.ts` | `—` |
| `.llm-bridge-workflow-trace-item` | `src\view.ts` | `—` |
| `.llm-bridge-workflow-trace-label` | `src\view.ts` | `—` |
| `.llm-bridge-workflow-trace-text` | `src\view.ts` | `—` |
| `.llm-bridge-workflow-trace-time` | `src\view.ts` | `—` |
| `.mod-warning` | `src\actions.ts` | `scripts\cdp-verify-manual13.mjs` |
| `.modal-button-container` | `src\actions.ts` | `—` |

</details>

## ID selectors

_None found in legacy.css_ (the `#` patterns detected were all color hex values).

## Element selectors observed

Element selectors (HTML/SVG tags) appear in `legacy.css`. These are not class selectors and are listed for completeness only; they are not deletion candidates unless the element itself is never rendered.

Elements: `button`, `h2`, `ol`, `pre`, `small`, `span`, `strong`, `summary`, `svg`, `ul`

## Methodology

1. Parsed `styles/legacy.css` (comments stripped) and split selector groups by `,` before each `{`.
2. Extracted every `.classname` token into a unique set.
3. Searched every `.ts` file under `src/` (excluding auto-generated `src/runtime/providers/codex-app-server/schema/generated/**`) plus `main.ts`, and every `.mjs`/`.js` file under `scripts/`, for each class name with word-boundary regex `(^|[^\w])cls([^\w-]|$)`.
4. A class is **REACHABLE** if it appears as a literal token in any TS/MJS source; otherwise it is UNREACHABLE.
5. UNREACHABLE classes are then checked against detected dynamic construction prefixes. If the class name begins with a dynamic prefix (e.g. `is-`, `is-risk-`, `llm-bridge-status-dot-`, `llm-bridge-tl-tool-cat-`), it is moved to the **likely false-positive** table; otherwise it remains a **deletion candidate**.
6. Dynamic construction is detected two ways: template literals `prefix${var}` and string concatenation `"prefix-" + var`.
7. Cross-checked each class against the other stylesheets (`composer.css`, `message.css`, `run-view.css`, `secondary.css`, `shell.css`) to flag overlaps.

> No files were modified. This report is for review only.
