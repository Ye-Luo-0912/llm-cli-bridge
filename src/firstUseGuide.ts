// LLM CLI Bridge — First Use Guide
// V1.2: 首次使用提示（纯函数，便于单元测试）
// 指导用户：如何选择 backend / 如何点 Preflight / 如何使用选区/当前笔记

/**
 * 首次使用提示步骤
 */
export interface GuideStep {
  readonly index: number;
  readonly title: string;
  readonly detail: string;
}

/**
 * 首次使用提示内容
 */
export interface GuideContent {
  readonly title: string;
  readonly steps: readonly GuideStep[];
  readonly footer: string;
}

/**
 * 构造首次使用提示内容（纯函数）
 * - 不依赖 Obsidian，便于单元测试
 * - 内容面向普通用户，不展开开发细节
 */
export function buildFirstUseGuide(): GuideContent {
  return {
    title: "首次使用提示",
    steps: [
      {
        index: 1,
        title: "选择 Backend 模式",
        detail: "在设置中选择 backend 模式：auto（默认，使用本地 Claude Code CLI）/ mock-success（测试用，不调用真实模型）/ mock-failure（测试失败显示）。日常使用保持 auto 即可。",
      },
      {
        index: 2,
        title: "点 Preflight 检测 agent 可用性",
        detail: "点击顶部 Preflight 按钮，插件会执行 `claude --version`（不调用真实模型），显示 available / unavailable。状态栏会显示最近一次检测结果。如果 unavailable，请确认本地已安装 Claude Code CLI 且 PATH 可用。",
      },
      {
        index: 3,
        title: "使用选区作为上下文",
        detail: "在编辑器中选中文本，底部 chips 行的 Selection 会显示选区字符数。点击 Selection chip 可开关是否将选区注入 prompt。常见用法：选中代码/概念 → 点「解释/改写选区」按钮。",
      },
      {
        index: 4,
        title: "使用当前笔记作为上下文",
        detail: "打开一个笔记后，底部 chips 行的 Note 会显示文件名。点击 Note chip 可开关是否将当前笔记内容注入 prompt。常见用法：打开笔记 → 点「总结当前笔记」或「生成复习提纲」按钮。",
      },
      {
        index: 5,
        title: "运行与停止",
        detail: "在底部输入框输入请求，点 ↑ 发送（或 Ctrl/Cmd+Enter）。运行中显示 Running 状态，可点 ■ 停止。运行结束后，新增/修改的 Markdown 文件会显示在消息下方，可点击打开。",
      },
    ],
    footer: "提示：预设按钮只生成 prompt 文本，不自动发送。你可以在发送前编辑输入框内容。点 × 关闭此提示后不再显示。",
  };
}

/**
 * 判断是否应显示首次使用提示
 * - 基于本地存储标志（view 层传入）
 */
export function shouldShowFirstUseGuide(dismissed: boolean): boolean {
  return !dismissed;
}
