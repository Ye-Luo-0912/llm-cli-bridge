import http from "http";

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

const pages = await get("http://127.0.0.1:9223/json");
const page = pages.find((p) => p.url && p.url.includes("obsidian"));
if (!page) {
  console.error("no obsidian page");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
let id = 1;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = id++;
    ws.send(JSON.stringify({ id: mid, method, params }));
    const handler = (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.id === mid) {
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
  });

const expr = `(() => {
  const labels = [...document.querySelectorAll('.llm-bridge-nav-item')].map((el) => ({
    title: el.getAttribute('title'),
    label: el.querySelector('.llm-bridge-nav-label')?.textContent || '',
  }));
  return {
    labels,
    composer: !!document.querySelector('.llm-bridge-composer-toolbar'),
    merged: !!document.querySelector('.llm-bridge-model-chip-merged'),
    permInMenu: !!document.querySelector('.llm-bridge-command-menu .llm-bridge-permission-picker'),
  };
})()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(JSON.stringify(r.result?.value, null, 2));
ws.close();
setTimeout(() => process.exit(0), 200);
