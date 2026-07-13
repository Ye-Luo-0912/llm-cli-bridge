// LLM CLI Bridge — History 面板渲染（从 view.ts 渐进拆分 P1）
// 纯渲染函数：renderHistoryList + 纯 helper（formatHistoryTime / historyStatusText）。
import { setIcon } from "obsidian";
import type { SessionListItem } from "../sessions";

/** History 列表渲染依赖注入 */
export interface HistoryListDeps {
  /** 当前会话 id（用于高亮 is-current；null 表示无当前会话） */
  currentSessionId: string | null;
  /** 全部历史项（未过滤） */
  historyItems: ReadonlyArray<SessionListItem>;
  /** 搜索查询字符串 */
  historySearchQuery: string;
  /** 排序模式：messages=按消息数 / time=按时间 */
  historySortMode: "messages" | "time";
  /** 已选中的会话 id 集合（可变引用，handler 会 add/delete） */
  selectedHistorySessionIds: Set<string>;
  /** 过滤 + 排序后的列表（由 view 实现，保持原逻辑） */
  getFilteredHistoryItems: () => SessionListItem[];
  /** 清理已选集合中不存在的会话 id（由 view 实现） */
  reconcileSelectedHistorySessions: () => void;
  /** 更新批量操作控件状态（由 view 实现） */
  updateHistoryBulkControls: (visibleItems: SessionListItem[]) => void;
  /** 更新计数标签（由 view 实现） */
  updateHistoryCountLabel: (visibleCount: number, totalCount: number) => void;
  /** 恢复会话回调 */
  onRestore: (sessionId: string) => void;
  /** 重命名会话回调 */
  onRename: (sessionId: string, currentTitle: string) => void;
  /** 删除会话回调 */
  onDelete: (sessionId: string, title: string) => void;
  /** 渲染错误占位（由 view 实现） */
  renderListError: (container: HTMLElement | null, kind: string, error: unknown) => void;
}

/** 渲染历史会话列表：过滤 + 排序 + 行渲染 + 批量控件 */
export function renderHistoryList(container: HTMLElement, deps: HistoryListDeps): void {
  if (!container) return;
  try {
    container.empty();
    const filtered = deps.getFilteredHistoryItems();
    deps.reconcileSelectedHistorySessions();
    deps.updateHistoryBulkControls(filtered);
    if (deps.historyItems.length === 0) {
      container.createDiv({ cls: "llm-bridge-history-empty", text: "暂无历史会话" });
      deps.updateHistoryCountLabel(0, 0);
      return;
    }
    if (filtered.length === 0) {
      container.createDiv({ cls: "llm-bridge-history-empty", text: `无匹配「${deps.historySearchQuery.trim()}」的会话` });
      deps.updateHistoryCountLabel(0, deps.historyItems.length);
      return;
    }
    const list = container.createDiv({ cls: "llm-bridge-history-list" });
    for (const item of filtered) {
      const row = list.createDiv({
        cls: `llm-bridge-history-item is-${item.status}${item.id === deps.currentSessionId ? " is-current" : ""}`,
        attr: { title: `${item.title} · ${item.messageCount} 条消息 · ${item.savedAt}` },
      });
      const selectWrap = row.createEl("label", { cls: "llm-bridge-history-select" });
      const checkbox = selectWrap.createEl("input", {
        type: "checkbox",
        cls: "llm-bridge-history-select-input",
        attr: { title: `选择 ${item.title}` },
      }) as HTMLInputElement;
      checkbox.checked = deps.selectedHistorySessionIds.has(item.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) deps.selectedHistorySessionIds.add(item.id);
        else deps.selectedHistorySessionIds.delete(item.id);
        deps.updateHistoryBulkControls(filtered);
      });
      const icon = row.createDiv({ cls: "llm-bridge-history-row-icon" });
      setIcon(icon.createEl("span", { cls: "llm-bridge-icon" }), item.id === deps.currentSessionId ? "circle-dot" : "history");
      // 主信息（点击恢复）
      const main = row.createEl("button", { cls: "llm-bridge-history-main" });
      const titleRow = main.createDiv({ cls: "llm-bridge-history-title-row" });
      titleRow.createEl("span", { cls: "llm-bridge-history-title", text: item.title });
      const meta = `${formatHistoryTime(item.savedAt)} · ${item.messageCount} 条`;
      titleRow.createEl("span", { cls: "llm-bridge-history-inline-meta", text: meta });
      // UI-03: 分开显示首条请求 + 最后答复（而非单一 preview）
      const firstUser = item.firstUserSummary || "";
      const lastReply = item.lastAssistantSummary || "";
      if (firstUser) {
        main.createEl("span", { cls: "llm-bridge-history-preview llm-bridge-history-first-user", text: `首条：${firstUser}`, attr: { title: firstUser } });
      }
      if (lastReply) {
        main.createEl("span", { cls: "llm-bridge-history-preview llm-bridge-history-last-reply", text: `答复：${lastReply}`, attr: { title: lastReply } });
      }
      if (!firstUser && !lastReply) {
        main.createEl("span", { cls: "llm-bridge-history-preview", text: "无摘要" });
      }
      main.addEventListener("click", () => deps.onRestore(item.id));
      const status = row.createDiv({ cls: "llm-bridge-history-status" });
      status.createEl("span", {
        cls: `llm-bridge-history-status-text is-${item.id === deps.currentSessionId ? "current" : item.status}`,
        text: item.id === deps.currentSessionId ? "current" : historyStatusText(item.status),
      });
      const actions = row.createDiv({ cls: "llm-bridge-history-actions" });
      // V2.8: 编辑按钮（重命名标题）
      const editBtn = actions.createEl("button", {
        cls: "llm-bridge-history-edit-btn",
        attr: { title: "重命名会话标题" },
      });
      setIcon(editBtn.createEl("span", { cls: "llm-bridge-icon" }), "pencil");
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deps.onRename(item.id, item.title);
      });
      // 删除按钮
      const delBtn = actions.createEl("button", {
        cls: "llm-bridge-history-del-btn",
        attr: { title: "删除此历史会话" },
      });
      setIcon(delBtn.createEl("span", { cls: "llm-bridge-icon" }), "trash-2");
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deps.onDelete(item.id, item.title);
      });
    }
    // V2.9: 搜索时显示「匹配数/总数」，否则显示总数
    deps.updateHistoryCountLabel(filtered.length, deps.historyItems.length);
  } catch (e) {
    deps.renderListError(container, "history", e);
  }
}

/** 会话状态 → 显示文本（纯函数） */
export function historyStatusText(status: SessionListItem["status"]): string {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "running":
      return "running";
    default:
      return status;
  }
}

/** V2.5: 格式化历史会话时间（简化展示，纯函数） */
export function formatHistoryTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (sameDay) return `今天 ${hh}:${mm}`;
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mo}-${dd} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}
