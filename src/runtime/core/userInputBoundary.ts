// LLM CLI Bridge — UserInputBoundary 实现
//
// 会话级用户输入边界：承载 agent 对用户的确认/选择/补充信息请求。
// 与 PermissionBoundary 分离，避免把 "需要答案" 错当成 "需要授权"。

import type {
  UserInputBoundary,
  UserInputRequest,
  UserInputResponse,
} from "./types";

export class UserInputBoundaryImpl implements UserInputBoundary {
  private readonly pendingMap = new Map<string, UserInputRequest>();
  private readonly resolvers = new Map<string, (r: { response: UserInputResponse; source: "user" | "cancel" }) => void>();

  get pending(): ReadonlyMap<string, UserInputRequest> {
    return this.pendingMap;
  }

  requestInput(req: UserInputRequest): "pending" {
    this.pendingMap.set(req.requestId, req);
    return "pending";
  }

  resolveInput(requestId: string, response: UserInputResponse): boolean {
    const req = this.pendingMap.get(requestId);
    if (!req) return false;
    this.pendingMap.delete(requestId);
    const resolver = this.resolvers.get(requestId);
    if (resolver) {
      this.resolvers.delete(requestId);
      resolver({
        response,
        source: response.type === "cancel" ? "cancel" : "user",
      });
    }
    return true;
  }

  cancelAllPending(): ReadonlyArray<{ requestId: string; providerContext: unknown }> {
    const cancelled: Array<{ requestId: string; providerContext: unknown }> = [];
    for (const [id, req] of this.pendingMap) {
      cancelled.push({ requestId: id, providerContext: req.providerContext });
      const resolver = this.resolvers.get(id);
      if (resolver) {
        this.resolvers.delete(id);
        resolver({ response: { type: "cancel" }, source: "cancel" });
      }
    }
    this.pendingMap.clear();
    return cancelled;
  }

  waitForInput(requestId: string): Promise<{ response: UserInputResponse; source: "user" | "cancel" }> {
    return new Promise((resolve) => {
      this.resolvers.set(requestId, resolve);
    });
  }
}

export function createUserInputBoundary(): UserInputBoundaryImpl {
  return new UserInputBoundaryImpl();
}
