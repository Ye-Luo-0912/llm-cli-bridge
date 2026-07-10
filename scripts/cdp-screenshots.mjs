// CDP 4 宽度截图 — 重新加载插件 + clip 方式截图（不调整窗口大小）
// Electron CDP 不支持 Emulation.setDeviceMetricsOverride / Browser.setWindowBounds
// 改用 Page.captureScreenshot 的 clip 参数 + CSS 宽度设置模拟窄屏
import http from "node:http";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const PROJECT_ROOT = resolve(__dirname, "..");
const SCREENSHOT_DIR = join(PROJECT_ROOT, "docs", "screenshots");
const PORT = 9223;
const WIDTHS = [1920, 1280, 768, 480];
const HEIGHT = 900;

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

function waitFor(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const pagesJson = await httpGet(`http://localhost:${PORT}/json`);
  const pages = JSON.parse(pagesJson).filter((p) => p.type === "page");
  console.log(`找到 ${pages.length} 个页面`);

  // 找到 Obsidian 主窗口
  let targetPage = null;
  let ws = null;
  for (const page of pages) {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, e) => { ws.addEventListener("open", r); ws.addEventListener("error", e); });
    await cdpSend(ws, "Runtime.enable");
    try {
      const r = await cdpSend(ws, "Runtime.evaluate", {
        expression: 'typeof app !== "undefined" && app.workspace ? "HAS_APP" : "NO_APP"',
      });
      if (r.result?.value === "HAS_APP") {
        targetPage = page;
        console.log(`使用页面: ${page.title}`);

        // 重载插件 — 强制加载新 main.js
        console.log("重载 LLM CLI Bridge 插件...");
        const reloadResult = await cdpSend(ws, "Runtime.evaluate", {
          expression: `(async function(){ try { await app.plugins.disablePlugin('llm-cli-bridge'); await app.plugins.enablePlugin('llm-cli-bridge'); return 'RELOADED'; } catch(e) { return 'ERROR:'+e.message; } })()`,
          awaitPromise: true,
        });
        console.log(`  插件重载: ${reloadResult.result?.value}`);

        await waitFor(3000);

        // 激活 LLM Bridge 视图
        const activateResult = await cdpSend(ws, "Runtime.evaluate", {
          expression: `(function(){ const leaves = app.workspace.getLeavesOfType("llm-cli-bridge-view"); if(leaves.length>0){ app.workspace.revealLeaf(leaves[0]); return "ACTIVATED"; } else { app.workspace.getLeftLeaf(false).setViewState({type:"llm-cli-bridge-view"}); return "CREATED"; } })()`,
        });
        console.log(`  视图激活: ${activateResult.result?.value}`);

        await waitFor(2000);

        // 验证 UI 元素存在
        const uiCheck = await cdpSend(ws, "Runtime.evaluate", {
          expression: `(function(){ const v=document.querySelector(".llm-bridge-view"); const nav=document.querySelectorAll(".llm-bridge-nav-item"); const label=document.querySelectorAll(".llm-bridge-nav-label"); return "view="+!!v+" nav="+nav.length+" label="+label.length; })()`,
        });
        console.log(`  UI 元素: ${uiCheck.result?.value}`);

        break;
      }
    } catch (e) {
      console.log(`  检查失败: ${e.message}`);
    }
    ws.close();
    ws = null;
  }

  if (!targetPage) {
    console.error("未找到 Obsidian 主窗口");
    process.exit(1);
  }

  // 创建截图目录
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // 启用 Page domain
  await cdpSend(ws, "Page.enable");

  const results = [];

  for (const width of WIDTHS) {
    console.log(`--- 宽度 ${width}px ---`);

    // 设置视图容器宽度模拟窄屏（不触发媒体查询，但能看到布局变化）
    await cdpSend(ws, "Runtime.evaluate", {
      expression: `(function(){ const v=document.querySelector(".llm-bridge-view"); if(v){ v.style.maxWidth='${width}px'; } return 'SET'; })()`,
    });
    await waitFor(1000);

    // 用 clip 截图
    try {
      const result = await cdpSend(ws, "Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width: width, height: HEIGHT, scale: 1 },
        captureBeyondViewport: false,
      });
      const buffer = Buffer.from(result.data, "base64");
      const filename = `obsidian-${width}px.png`;
      writeFileSync(join(SCREENSHOT_DIR, filename), buffer);
      console.log(`  ✅ 保存: ${filename} (${buffer.length} bytes)`);
      results.push({ width, filename, size: buffer.length, ok: true });
    } catch (e) {
      console.log(`  ❌ 截图失败: ${e.message}`);
      results.push({ width, ok: false, error: e.message });
    }
  }

  // 恢复视图宽度
  await cdpSend(ws, "Runtime.evaluate", {
    expression: `(function(){ const v=document.querySelector(".llm-bridge-view"); if(v){ v.style.maxWidth=''; } return 'RESET'; })()`,
  });
  ws.close();

  // 验证截图
  const sizes = results.filter(r => r.ok).map(r => r.size);
  const allDifferent = new Set(sizes).size === sizes.length;
  console.log(`\n=== 截图完成 ===`);
  console.log(`成功: ${results.filter(r => r.ok).length}/${results.length}`);
  console.log(`截图大小各不同: ${allDifferent ? "是" : "否"}`);
  console.log(`截图目录: ${SCREENSHOT_DIR}`);

  if (results.some(r => !r.ok)) process.exit(1);
}

main().catch(console.error);
