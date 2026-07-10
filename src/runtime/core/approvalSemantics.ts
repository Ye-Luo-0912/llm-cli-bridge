// LLM CLI Bridge — Approval / user-input semantic helpers
//
// Shared predicates for distinguishing real permission approvals from
// user-input tools (AskUserQuestion / request_user_input) that some providers
// surface as approval_request events.

/** Tools that represent user input, not filesystem/command permission. */
export function isUserInputApprovalTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "askuserquestion" || normalized === "request_user_input";
}
