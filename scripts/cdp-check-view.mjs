// 检查 LLM CLI Bridge 插件视图是否可见
import http from "node:http";

const PORT = 9223;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    }).on("error", reject);
  });
}

function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const pagesJson = await httpGet(`http://localhost:${PORT}/json`);
  const pages = JSON.parse(pagesJson).filter((p) => p.type === "page");
  console.log(`找到 ${pages.length} 个页面`);

  for (const page of pages) {
    console.log(`\n--- 检查页面: ${page.title} ---`);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, e) => { ws.addEventListener("open", r); ws.addEventListener("error", e); });
    await cdpSend(ws, "Runtime.enable");

    // 检查 LLM Bridge 视图
    const r1 = await cdpSend(ws, "Runtime.evaluate", {
      expression: 'document.querySelector(".llm-bridge-view") ? "FOUND" : "NOT FOUND"',
    });
    console.log("LLM Bridge view:", r1.result?.value);

    // 检查 nav item
    const r2 = await cdpSend(ws, "Runtime.evaluate", {
      expression: 'document.querySelectorAll(".llm-bridge-nav-item").length',
    });
    console.log("Nav items count:", r2.result?.value);

    // 检查 view content
    const r3 = await cdpSend(ws, "Runtime.evaluate", {
      expression: 'document.querySelector(".llm-bridge-view-content")?.innerHTML?.slice(0, 100) || "NOT FOUND"',
    });
    console.log("View content:", r3.result?.value);

    // 检查 nav-label (UI-03 关键变动)
    const r4 = await cdpSend(ws, "Runtime.evaluate", {
      expression: 'document.querySelectorAll(".llm-bridge-nav-label").length',
    });
    console.log("Nav label count:", r4.result?.value);

    // 检查插件版本
    const r5 = await cdpSend(ws, "Runtime.evaluate", {
      expression: 'app?.plugins?.plugins?.["llm-cli-bridge"]?.manifest?.version || "unknown"',
    });
    console.log("Plugin version:", r5.result?.value);

    // 检查插件是否加载
    const r6 = await cdpSend(ws, "Runtime.evaluate", {
      expression: '!!(app && app.plugins && app.plugins.plugins["llm-cli-bridge"]) ? "LOADED" : "NOT LOADED"',
    });
    console.log("Plugin status:", r6.result?.value);

    ws.close();
  }
}

main().catch(console.error);
