// LLM CLI Bridge — Skills State (V2.6)
// 持久化 skill 元数据：置顶/排序/折叠/分组覆盖/应用次数/最近使用时间/最近组合
// 写入 .llm-bridge/skills-state.json，version + tmp+rename 原子写
// 只保存 metadata，不保存 prompt 正文，不保存 secret
//
// 设计原则：
// - 不改 AgentEvent v0.1，不新增 tool event
// - per-vault 数据（跨设备通过 git 同步）
// - 失败不阻断主流程（返回空 state / 静默失败）
// - version 字段便于后续迁移

import * as fs from "fs";
import * as path from "path";

/** skills-state 文件相对 Vault 根的路径 */
export const SKILLS_STATE_FILE_REL = ".llm-bridge/skills-state.json";

/** state 文件 schema 版本 */
export const SKILLS_STATE_VERSION = 1;

/**
 * 单个 skill 的元数据（不含 prompt 正文）
 * - pinned: 置顶（排在分组最前）
 * - sortOrder: 手动排序权重（越小越靠前；默认 0）
 * - collapsed: 在列表中折叠（长 prompt skill 折叠展示）
 * - groupOverride: 手动指定分组（覆盖 #标签推断）
 * - applyCount: 累计应用次数
 * - lastUsedAt: 最近应用时间（ISO），null 表示从未使用
 */
export interface SkillMeta {
  readonly pinned?: boolean;
  readonly sortOrder?: number;
  readonly collapsed?: boolean;
  readonly groupOverride?: string;
  readonly applyCount: number;
  readonly lastUsedAt: string | null;
}

/**
 * skills-state 文件结构
 * - version: schema 版本
 * - skills: skillName → SkillMeta 映射
 * - lastCombo: 最近一次组合应用的 skill 名称顺序（供快速重用）
 */
export interface SkillsState {
  readonly version: number;
  readonly skills: Record<string, SkillMeta>;
  readonly lastCombo: string[];
}

/**
 * 最近组合项（用于 UI 展示历史组合）
 */
export interface ComboHistoryEntry {
  readonly skillNames: string[];
  readonly usedAt: string;
}

/** 创建空的 skills state */
export function createEmptySkillsState(): SkillsState {
  return {
    version: SKILLS_STATE_VERSION,
    skills: {},
    lastCombo: [],
  };
}

/**
 * 读取 skills-state（文件不存在或解析失败返回空 state）
 */
export async function loadSkillsState(vaultPath: string): Promise<SkillsState> {
  try {
    const filePath = path.join(vaultPath, SKILLS_STATE_FILE_REL);
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<SkillsState>;
    // 基本字段校验
    if (typeof parsed.version !== "number" || typeof parsed.skills !== "object" || parsed.skills === null) {
      return createEmptySkillsState();
    }
    // 版本迁移占位（当前只有 v1）
    if (parsed.version > SKILLS_STATE_VERSION) {
      return createEmptySkillsState();
    }
    return {
      version: SKILLS_STATE_VERSION,
      skills: parsed.skills as Record<string, SkillMeta>,
      lastCombo: Array.isArray(parsed.lastCombo) ? parsed.lastCombo : [],
    };
  } catch {
    return createEmptySkillsState();
  }
}

/**
 * 保存 skills-state（tmp+rename 原子写，失败不抛异常返回 false）
 */
export async function saveSkillsState(vaultPath: string, state: SkillsState): Promise<boolean> {
  try {
    const dirPath = path.join(vaultPath, ".llm-bridge");
    await fs.promises.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, "skills-state.json");
    const tmpPath = path.join(dirPath, "skills-state.json.tmp");
    const payload: SkillsState = {
      version: SKILLS_STATE_VERSION,
      skills: state.skills,
      lastCombo: state.lastCombo,
    };
    await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.promises.rename(tmpPath, filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取单个 skill 的 meta（不存在返回默认值）
 */
export function getSkillMeta(state: SkillsState, skillName: string): SkillMeta {
  return state.skills[skillName] || { applyCount: 0, lastUsedAt: null };
}

/**
 * 记录 skill 已应用（applyCount+1, lastUsedAt=now），返回新 state（不可变更新）
 */
export function recordSkillApplied(state: SkillsState, skillName: string): SkillsState {
  const prev = getSkillMeta(state, skillName);
  const updated: SkillMeta = {
    ...prev,
    applyCount: prev.applyCount + 1,
    lastUsedAt: new Date().toISOString(),
  };
  return {
    ...state,
    skills: { ...state.skills, [skillName]: updated },
  };
}

/**
 * 设置 skill 置顶状态，返回新 state
 */
export function setSkillPinned(state: SkillsState, skillName: string, pinned: boolean): SkillsState {
  const prev = getSkillMeta(state, skillName);
  const updated: SkillMeta = { ...prev, pinned };
  return {
    ...state,
    skills: { ...state.skills, [skillName]: updated },
  };
}

/**
 * 设置 skill 分组覆盖（手动指定分组，覆盖 #标签推断），返回新 state
 * 传 undefined 清除覆盖
 */
export function setSkillGroupOverride(state: SkillsState, skillName: string, group: string | undefined): SkillsState {
  const prev = getSkillMeta(state, skillName);
  const updated: SkillMeta = { ...prev, groupOverride: group };
  return {
    ...state,
    skills: { ...state.skills, [skillName]: updated },
  };
}

/**
 * 记录最近组合应用（更新 lastCombo），返回新 state
 */
export function recordCombo(state: SkillsState, skillNames: string[]): SkillsState {
  return {
    ...state,
    lastCombo: skillNames.slice(),
  };
}

/**
 * 计算相对时间描述（如 "刚刚"、"3 分钟前"、"2 天前"）
 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "未使用";
  try {
    const t = new Date(iso).getTime();
    // 损坏 ISO（Invalid Date）视为未使用
    if (isNaN(t)) return "未使用";
    const now = Date.now();
    const diff = now - t;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "未使用";
  }
}
