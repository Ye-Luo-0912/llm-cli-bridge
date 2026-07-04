#!/usr/bin/env node
// V16.4-E2 AskUserQuestion UI CDP smoke.
// Requires Obsidian launched with --remote-debugging-port=9223.

import fs from "node:fs";
import path from "node:path";

const CDP_HOST = "127.0.0.1";
const CDP_PORTS = (process.env.CDP_PORT ? [Number(process.env.CDP_PORT)] : [9223, 9222, 9224, 9225])
  .filter((port) => Number.isFinite(port));
const PLUGIN_ID = "llm-cli-bridge";
const VIEW_TYPE = "llm-cli-bridge-view";
const PROJECT_ROOT = path.resolve(new URL("..", import.meta.url).pathname, "..").replace(/^\/([A-Za-z]:)/, "$1");
const OUT_DIR = path.join(PROJECT_ROOT, "docs", "visual-smoke");

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("CDP WebSocket connection failed"));
      ws.onclose = () => {
        for (const { reject: rejectPending } of this.pending.values()) rejectPending(new Error("closed"));
        this.pending.clear();
      };
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!msg.id || !this.pending.has(msg.id)) return;
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  async screenshot(name) {
    await this.send("Page.bringToFront");
    const shot = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = path.join(OUT_DIR, name);
    fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));
    return outPath;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function findObsidianPage() {
  for (const port of CDP_PORTS) {
    try {
      const resp = await fetch(`http://${CDP_HOST}:${port}/json`);
      const pages = await resp.json();
      const page = pages.find((p) => p.type === "page" && /obsidian/i.test(p.title || p.url || ""))
        ?? pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl)
        ?? null;
      if (page) return { ...page, cdpPort: port };
    } catch {
      // Try the next common Electron remote-debugging port.
    }
  }
  return null;
}

async function main() {
  const page = await findObsidianPage();
  if (!page) throw new Error("No Obsidian CDP page found");
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  try {
    const reload = await client.evaluate(`(async () => {
      const app = window.app || globalThis.app;
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      await new Promise((r) => setTimeout(r, 500));
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      await new Promise((r) => setTimeout(r, 1200));
      let leaves = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)});
      if (leaves.length === 0) {
        await app.workspace.getLeaf(true).setViewState({ type: ${JSON.stringify(VIEW_TYPE)} });
        await new Promise((r) => setTimeout(r, 700));
        leaves = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)});
      }
      app.workspace.revealLeaf(leaves[0]);
      return { ok: true, leaves: leaves.length };
    })()`);
    if (!reload?.ok) throw new Error(`reload failed: ${JSON.stringify(reload)}`);

    const injected = await client.evaluate(`(async () => {
      const app = window.app || globalThis.app;
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
      if (!view) return { ok: false, error: "view missing" };
      const session = view.getSession();
      session.userInput.cancelAllPending();
      view.pendingUserInputDrafts?.clear?.();
      const req = {
        requestId: "cdp-v164e2-user-input",
        providerId: "claude-sdk",
        toolName: "AskUserQuestion",
        prompt: "这是一个测试问题，你看到了吗？",
        inputType: "text",
        questions: [{
          id: "visible",
          question: "请选择弹窗状态",
          options: [
            { label: "看到了", description: "弹窗正常显示", value: "seen" },
            { label: "没看到", description: "弹窗有问题", value: "not_seen" },
            { label: "其他", description: "我会补充说明", value: "other" }
          ]
        }],
        placeholder: "请输入"
      };
      session.userInput.requestInput(req);
      globalThis.__v164e2UserInputResult = null;
      session.userInput.waitForInput(req.requestId).then((result) => {
        globalThis.__v164e2UserInputResult = result;
      });
      view.refreshUserInputPanel();
      await new Promise((r) => setTimeout(r, 300));
      const card = view.containerEl.querySelector(".llm-bridge-clarification-card");
      return {
        ok: !!card,
        step: card?.querySelector(".llm-bridge-clarification-step")?.textContent || "",
        composerHidden: !!view.containerEl.querySelector(".llm-bridge-composer-bar.is-user-input-active"),
        options: Array.from(card?.querySelectorAll(".llm-bridge-clarification-option") || []).map((el) => el.textContent || "")
      };
    })()`);
    if (!injected?.ok || injected.step !== "1 of 2" || !injected.composerHidden) {
      throw new Error(`injection failed: ${JSON.stringify(injected)}`);
    }
    const step1Path = await client.screenshot("v164e2-ask-user-question-step1.png");

    const step2 = await client.evaluate(`(async () => {
      const app = window.app || globalThis.app;
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
      view.containerEl.querySelector(".llm-bridge-clarification-option")?.click();
      await new Promise((r) => setTimeout(r, 300));
      const textarea = view.containerEl.querySelector(".llm-bridge-clarification-supplement-textarea");
      if (textarea) {
        textarea.value = "补充页截图测试";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const card = view.containerEl.querySelector(".llm-bridge-clarification-card");
      return {
        ok: !!textarea,
        step: card?.querySelector(".llm-bridge-clarification-step")?.textContent || "",
        title: card?.querySelector(".llm-bridge-clarification-title")?.textContent || "",
        value: textarea?.value || ""
      };
    })()`);
    if (!step2?.ok || step2.step !== "2 of 2") throw new Error(`step2 failed: ${JSON.stringify(step2)}`);
    const step2Path = await client.screenshot("v164e2-ask-user-question-step2.png");

    const resolved = await client.evaluate(`(async () => {
      const app = window.app || globalThis.app;
      const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
      view.containerEl.querySelector(".llm-bridge-clarification-btn.is-primary")?.click();
      const deadline = Date.now() + 3000;
      while (!globalThis.__v164e2UserInputResult && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 200));
      return {
        result: globalThis.__v164e2UserInputResult,
        panelVisible: getComputedStyle(view.userInputPanelEl).display !== "none",
        composerHidden: !!view.containerEl.querySelector(".llm-bridge-composer-bar.is-user-input-active")
      };
    })()`);
    const response = resolved?.result?.response;
    const ok = response?.type === "submit"
      && response.value.includes("补充页截图测试")
      && response.answers?.visible === "seen"
      && resolved.panelVisible === false
      && resolved.composerHidden === false;
    if (!ok) throw new Error(`resolve failed: ${JSON.stringify(resolved)}`);

    console.log(JSON.stringify({
      ok: true,
      target: page.title,
      step1Path,
      step2Path,
      resolved: response,
    }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
