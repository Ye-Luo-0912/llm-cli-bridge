// LLM CLI Bridge — First Use Guide
// V1.8: 简化为 3 步用户导向（打开 → 选文字/打开笔记 → 点总结/解释）
// 不再提及 backend / sdk / mock 等技术细节，普通用户零配置可用

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
 * - V1.8: 3 步用户导向，不展开技术细节
 * - 默认 auto 模式即最佳路径，无需理解 backend
 */
export function buildFirstUseGuide(): GuideContent {
  return {
    title: "3 步开始使用",
    steps: [
      {
        index: 1,
        title: "确认 Claude Code 已安装",
        detail: "在终端执行 `claude --version` 能看到版本号即可。若未安装，参考 Claude Code 官方文档。安装后无需任何配置，插件默认使用 auto 模式。",
      },
      {
        index: 2,
        title: "打开笔记或选中文字",
        detail: "在 Obsidian 中打开一篇笔记，或选中一段文字作为上下文。插件会自动识别当前笔记和选区（底部 chips 显示状态）。",
      },
      {
        index: 3,
        title: "点「总结当前笔记」或「解释选区」",
        detail: "底部有 3 个按钮：自由提问（清空输入框）、解释选区（解释选中文字）、总结当前笔记（生成摘要笔记）。点击后自动填充 prompt，再点 ↑ 或 Ctrl/Cmd+Enter 发送。",
      },
    ],
    footer: "提示：日常使用只需 auto 模式，无需理解 backend / SDK / mock。点 × 关闭此提示后不再显示。",
  };
}

/**
 * 判断是否应显示首次使用提示
 * - 基于本地存储标志（view 层传入）
 */
export function shouldShowFirstUseGuide(dismissed: boolean): boolean {
  return !dismissed;
}
