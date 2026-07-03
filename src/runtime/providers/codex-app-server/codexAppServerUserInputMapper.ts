// LLM CLI Bridge — Codex app-server user input mapper
//
// 把 codex app-server 的 item/tool/requestUserInput server-request 映射为
// provider-neutral UserInputRequest，并把统一 UserInputResponse 映射回
// CodexServerRequestResult。

import type {
  CodexServerRequestResult,
  CodexToolUserInputRequestParams,
} from "./schema";
import type {
  ProviderId,
  UserInputOption,
  UserInputQuestion,
  UserInputRequest,
  UserInputResponse,
} from "../../core/types";

export interface CodexUserInputServerRequest {
  method: "item/tool/requestUserInput";
  serverRequestId: number | string;
  params: CodexToolUserInputRequestParams;
}

export class CodexAppServerUserInputMapper {
  constructor(private readonly providerId: ProviderId) {}

  mapUserInputRequest(req: CodexUserInputServerRequest): UserInputRequest {
    const { serverRequestId, params } = req;
    const questions = this.parseQuestions(params);
    return {
      requestId: `codex-input-${serverRequestId}`,
      providerId: this.providerId,
      toolName: params.toolName || "AskUserQuestion",
      prompt: (params.prompt || "").trim(),
      inputType: params.inputType === "secret" ? "secret" : "text",
      questions,
      placeholder: params.placeholder,
      providerContext: {
        serverRequestId,
        method: req.method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
      },
    };
  }

  mapServerRequestResult(response: UserInputResponse): CodexServerRequestResult {
    if (response.type === "cancel") return { cancelled: true };
    return { value: response.value };
  }

  private parseQuestions(params: CodexToolUserInputRequestParams): ReadonlyArray<UserInputQuestion> | undefined {
    const structured = Array.isArray(params.questions)
      ? params.questions.map((q, index) => this.parseQuestion(q, index)).filter((q): q is UserInputQuestion => q !== null)
      : [];
    if (structured.length > 0) return structured;

    const singleQuestion = typeof params.question === "string" && params.question.trim().length > 0
      ? params.question.trim()
      : typeof params.prompt === "string" ? params.prompt.trim() : "";
    const options = this.parseOptions(params.options);
    if (!singleQuestion || options.length === 0) return undefined;
    return [{
      id: "question-1",
      question: singleQuestion,
      options,
    }];
  }

  private parseQuestion(value: unknown, index: number): UserInputQuestion | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const question = typeof raw.question === "string" && raw.question.trim().length > 0
      ? raw.question.trim()
      : typeof raw.prompt === "string" && raw.prompt.trim().length > 0
        ? raw.prompt.trim()
        : "";
    const options = this.parseOptions(raw.options);
    if (!question) return null;
    return {
      id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : `question-${index + 1}`,
      header: typeof raw.header === "string" && raw.header.trim().length > 0 ? raw.header.trim() : undefined,
      question,
      options,
    };
  }

  private parseOptions(value: unknown): ReadonlyArray<UserInputOption> {
    if (!Array.isArray(value)) return [];
    const parsed: Array<UserInputOption | null> = value.map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const label = typeof raw.label === "string" ? raw.label.trim() : "";
      if (!label) return null;
      return {
        label,
        description: typeof raw.description === "string" && raw.description.trim().length > 0
          ? raw.description.trim()
          : undefined,
        value: typeof raw.value === "string" && raw.value.trim().length > 0
          ? raw.value.trim()
          : undefined,
      };
    });
    return parsed.filter((item): item is UserInputOption => item !== null);
  }
}
