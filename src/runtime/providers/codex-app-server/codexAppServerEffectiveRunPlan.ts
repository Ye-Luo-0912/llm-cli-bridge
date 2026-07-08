// LLM CLI Bridge — Codex app-server EffectiveRunPlan (V2.17-A Completion)
//
// 从 Bridge Core 的 EffectiveRunPlan + BridgePromptPackage 派生 codex app-server
// 特定的运行参数（thread/start instructions/config、turn/start input/attachments/effort）。
//
// Prompt 拆分映射（task spec §5）：
// - userPrompt → turn/start input（主输入）
// - bridgeSystemAppend → Codex instructions/config/rules 层
//   若 instructions/config/rules 暂不可用，则作为明确的 provider preamble，
//   但必须单独标记来源（source: "bridge-system-append"），不与 userPrompt 混合。
//
// V2.17-A Completion 主线闭环：
// - initialize.params 使用 clientInfo + capabilities（experimentalApi 审计）
// - thread/start.params 使用 config 容器（不再塞 resumeSessionId；resume 走 thread/resume）
// - experimentalApi 默认 false；若启用必须在 CodexRunOptions audit 记录

import type { EffectiveRunPlan, LLMBridgeSettings } from "../../../types";
import { pathToFileURL } from "url";
import type { BridgePromptPackage } from "../../core/types";
import type { RunInput } from "../../core/types";
import { buildAttachmentPlan, buildEffectiveRunPlan, computePromptPackageHash } from "../../../effectiveRunPlan";
import type {
  CodexClientCapabilities,
  CodexClientInfo,
  CodexInitializeParams,
  CodexThreadConfig,
  CodexThreadStartParams,
  CodexTurnInputItem,
  CodexTurnStartParams,
} from "./schema";

/**
 * Codex app-server 运行参数（派生自 EffectiveRunPlan + BridgePromptPackage）。
 */
export interface CodexAppServerRunOptions {
  /** initialize 请求参数（clientInfo + capabilities，官方 shape） */
  initialize: CodexInitializeParams;
  /** thread/start 参数（config 容器，不再塞 resumeSessionId） */
  threadStart: CodexThreadStartParams;
  /** turn/start 参数（threadId 由 provider 在 thread/start 后注入） */
  turnStart: Omit<CodexTurnStartParams, "threadId">;
  /** bridgeSystemAppend 的承载层（审计用：标记它走了哪个 codex 字段） */
  bridgeSystemAppendSource: "instructions" | "config" | "rules" | "provider-preamble";
  /** experimentalApi 是否启用（审计用；默认 false） */
  experimentalApi: boolean;
}

const CLIENT_NAME = "llm-cli-bridge";
const CLIENT_TITLE = "LLM CLI Bridge";
const CLIENT_VERSION = "2.17-A";

function localFileUrl(resolvedPath: string | undefined): string | null {
  if (!resolvedPath) return null;
  try {
    return pathToFileURL(resolvedPath).href;
  } catch {
    return null;
  }
}

/**
 * 构造 EffectiveRunPlan（codex-app-server backend）。
 *
 * 返回 CodexAppServerEffectiveRunPlan（backend="codex-app-server"），
 * 含 instructionsSource 字段标记 bridgeSystemAppend 走 instructions 层。
 */
export function buildCodexAppServerEffectiveRunPlan(
  input: RunInput,
  settings: LLMBridgeSettings,
): EffectiveRunPlan {
  // attachmentPlan 从 promptPackage.attachmentEntries 聚合（counts + entry-level 审计）
  const attachmentPlan = buildAttachmentPlan(input.promptPackage.attachmentEntries);
  return buildEffectiveRunPlan({
    backend: "codex-app-server",
    settings,
    cwd: input.cwd,
    promptPackageText: input.promptPackage.auditHash,
    settingSources: [], // codex app-server 当前不读 claude skills/setting sources
    skills: [],
    attachmentPlan,
  });
}

/**
 * 从 EffectiveRunPlan + BridgePromptPackage 派生 codex app-server 运行参数。
 *
 * bridgeSystemAppend 映射策略（优先级）：
 * 1. instructions 字段（codex app-server 文档支持）—— 当前默认
 * 2. （未来）config/rules 层 —— 当 schema 生成版本暴露这些字段时切换
 * 3. provider-preamble —— 兜底，作为 turn/start input 头部 preamble，但 source 单独标记
 *
 * experimentalApi 审计：
 * - 默认 false（不启用 experimental fields，如 item/plan/delta）
 * - 若需启用（如 plan item 支持），必须在返回的 options.experimentalApi=true，
 *   并在 EffectiveRunPlan/CodexRunOptions audit 中记录。
 */
export function buildCodexAppServerRunOptions(
  plan: EffectiveRunPlan,
  promptPackage: BridgePromptPackage,
  opts?: { experimentalApi?: boolean },
): CodexAppServerRunOptions {
  // experimentalApi 默认 false；显式启用时审计记录
  const experimentalApi = !!opts?.experimentalApi;

  // initialize 参数：clientInfo + capabilities（官方 shape）
  const clientInfo: CodexClientInfo = {
    name: CLIENT_NAME,
    title: CLIENT_TITLE,
    version: CLIENT_VERSION,
  };
  const capabilities: CodexClientCapabilities = {
    experimentalApi,
  };
  const initialize: CodexInitializeParams = {
    clientInfo,
    capabilities,
    cwd: plan.cwd,
  };

  // bridgeSystemAppend → instructions（当前默认）
  const bridgeSystemAppendSource: CodexAppServerRunOptions["bridgeSystemAppendSource"] = "instructions";

  // thread/start.config 容器（官方 shape；model 走 config.model）
  const threadConfig: CodexThreadConfig = plan.model ? { model: plan.model } : {};
  // 真实 codex app-server binary 读取顶层 model + baseInstructions（与 codex-app-server-smoke
  // / codex-managed-runtime-smoke 主线 wire 一致；缺失会导致 thread/start hang）。
  // config/instructions 保留供 thread/resume 路径与审计哈希使用。
  // plan.session 可选（部分测试 plan 不含 session 字段）；缺省按新会话处理。
  const continueSession = !!plan.session?.continueSession;
  const threadStart: CodexThreadStartParams = {
    config: threadConfig,
    instructions: promptPackage.bridgeSystemAppend,
    cwd: plan.cwd,
    // 顶层字段（binary 实际读取）
    model: plan.model,
    baseInstructions: promptPackage.bridgeSystemAppend,
    approvalPolicy: "never",
    sandbox: "workspace-write",
    personality: "pragmatic",
    ephemeral: !continueSession,
    sessionStartSource: continueSession ? "resume" : "clear",
  };
  // 不再把 resumeSessionId 塞进 thread/start；resume 走 thread/resume。

  // turn/start.input 为 content item array（V2.17-A Completion wire 校准）
  const inputItems: CodexTurnInputItem[] = [
    { type: "text", text: promptPackage.userPrompt },
  ];
  // 本地图片用 localImage 作为 input item 一并送入。
  // native-ref-only 文件不进入 input item；否则真实 app-server 会返回
  // unknown variant `file`, expected text/image/localImage/skill/mention。
  for (const entry of promptPackage.attachmentEntries) {
    if (entry.packing === "sdk-streaming-block" && entry.fileType === "image") {
      const url = localFileUrl(entry.resolvedPath);
      if (url) {
        inputItems.push({ type: "localImage", refId: entry.refId, path: entry.resolvedPath, url });
      }
    }
  }

  const turnStart: Omit<CodexTurnStartParams, "threadId"> = {
    input: inputItems,
    effort: plan.effort || undefined,
  };

  return {
    initialize,
    threadStart,
    turnStart,
    bridgeSystemAppendSource,
    experimentalApi,
  };
}

/**
 * 审计哈希（与 plan.promptPackageHash 互验；保证 prompt 拆分跨 provider 一致）。
 *
 * 包含 experimentalApi 字段，确保 experimental 启用状态可审计。
 */
export function computeCodexRunOptionsAuditHash(options: CodexAppServerRunOptions): string {
  const inputItemsStr = (options.turnStart.input ?? [])
    .map((it) => {
      if (it.type === "text") return `${it.type}:${it.text}`;
      if (it.type === "skill") return `${it.type}:${it.name}`;
      return `${it.type}:${it.refId ?? it.path ?? ""}`;
    })
    .join("|");
  const capabilitiesStr = JSON.stringify(options.initialize.capabilities ?? {});
  const configStr = JSON.stringify(options.threadStart.config ?? {});
  // 任务3: attachments 收敛 —— managed path 不发送 turnStart.attachments，
  // 审计哈希明确写入 "attachments=disabled" 而非读取空 attachments 字段。
  const attachmentsAudit = "attachments=disabled";
  const input = [
    options.bridgeSystemAppendSource,
    options.experimentalApi ? "experimentalApi=true" : "experimentalApi=false",
    capabilitiesStr,
    options.initialize.clientInfo.name,
    options.initialize.clientInfo.version,
    options.threadStart.instructions ?? "",
    configStr,
    inputItemsStr,
    options.turnStart.effort ?? "",
    attachmentsAudit,
  ].join("\n---\n");
  return computePromptPackageHash(input);
}
