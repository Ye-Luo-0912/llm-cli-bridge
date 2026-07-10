#!/usr/bin/env node
// CDP 插件重载 + 验证脚本
// 用法: node scripts/cdp-reload.mjs

import http from "http";

const CDP_PORT = 9223;

function getPages() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  const pages = await getPages();
  const page = pages.find((p) => p.url && p.url.includes("obsidian"));
  if (!page) {
    console.log("No obsidian page found. Pages:", pages.map((p) => p.type).join(", "));
    process.exit(1);
  }

  console.log("Connected to:", page.title);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = id++;
      ws.send(JSON.stringify({ id: msgId, method, params }));
      const handler = (ev) => {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
        if (msg.id === msgId) {
          ws.removeEventListener("message", handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener("message", handler);
    });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  try {
    // 检查插件状态
    const checkExpr = `(function(){
      try {
        if (typeof app === 'undefined') return 'app_undefined';
        if (!app.plugins) return 'no_plugins';
        const p = app.plugins.plugins['llm-cli-bridge'];
        if (!p) return 'plugin_not_loaded';
        return 'v' + p.manifest.version;
      } catch(e) {
        return 'EXC:' + e.message;
      }
    })()`;

    const r1 = await send("Runtime.evaluate", {
      expression: checkExpr,
      returnByValue: true,
    });
    console.log("Plugin status:", r1.result?.value);

    // 如果插件未加载，尝试重载
    if (r1.result?.value === "plugin_not_loaded" || r1.result?.value?.startsWith("v")) {
      console.log("Reloading plugin...");
      const r2 = await send("Runtime.evaluate", {
        expression: `(async function(){
          try {
            await app.plugins.disablePlugin('llm-cli-bridge');
            await app.plugins.enablePlugin('llm-cli-bridge');
            return 'RELOADED';
          } catch(e) {
            return 'ERROR:' + e.message;
          }
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      console.log("Reload result:", r2.result?.value);

      // 等待 3 秒让插件初始化
      await new Promise((r) => setTimeout(r, 3000));

      // 再次检查
      const r3 = await send("Runtime.evaluate", {
        expression: checkExpr,
        returnByValue: true,
      });
      console.log("After reload:", r3.result?.value);

      // 检查 nav labels
      const r4 = await send("Runtime.evaluate", {
        expression: `document.querySelectorAll('.llm-bridge-nav-label').length`,
        returnByValue: true,
      });
      console.log("Nav labels:", r4.result?.value);
    }
  } catch (e) {
    console.log("Error:", e.message);
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 500);
  }
}

main().catch((e) => {
  console.log("Fatal:", e.message);
  process.exit(1);
});
