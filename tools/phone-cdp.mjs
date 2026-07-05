// Drive phone Chrome over CDP (adb forward tcp:9333). Usage:
//   node phone.mjs shot out.png            — screenshot current viewport
//   node phone.mjs eval "expr"             — Runtime.evaluate (awaitPromise, returnByValue)
//   node phone.mjs nav "url"               — navigate the giui tab
const [, , cmd, arg1, arg2] = process.argv;

const targets = await (await fetch("http://localhost:9333/json")).json();
const page = targets.find(
  (t) => t.type === "page" && t.url.includes("localhost:5173")
);
if (!page) {
  console.error("no localhost:5173 tab; tabs:", targets.map((t) => t.url));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

if (cmd === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (!r.result) { console.error(JSON.stringify(r)); process.exit(1); }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(arg1 ?? "phone-shot.png", Buffer.from(r.result.data, "base64"));
  console.log("saved", arg1 ?? "phone-shot.png");
} else if (cmd === "eval") {
  const r = await send("Runtime.evaluate", {
    expression: arg1,
    awaitPromise: true,
    returnByValue: true,
    timeout: 15000,
  });
  console.log(JSON.stringify(r.result ?? r, null, 2));
} else if (cmd === "nav") {
  await send("Page.navigate", { url: arg1 });
  console.log("navigated to", arg1);
} else if (cmd === "evalfile") {
  const { readFileSync } = await import("node:fs");
  const r = await send("Runtime.evaluate", {
    expression: readFileSync(arg1, "utf8"),
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000,
  });
  console.log(JSON.stringify(r.result ?? r, null, 2));
} else {
  console.error("unknown cmd", cmd);
}
ws.close();
