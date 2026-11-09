// Yerel panel sunucusu. Sadece 127.0.0.1'e bağlanır; her açılışta rastgele bir anahtar üretir.
// Tarayıcıda açık başka bir site bu sunucuya istek atamaz: anahtar, Host kontrolü ve JSON zorunluluğu.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scanVercel, fixVercel } from "./checks/vercel.js";
import { scanCode, detectServices } from "./checks/code.js";
import { manualCards, saveAnswer } from "./checks/manual.js";
import { EXPLAIN } from "./copy.js";

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "index.html");

export async function startServer({ dir, port = 0 }) {
  const token = randomBytes(24).toString("hex");
  let fixes = new Map(); // son taramada bulunan düzeltmeler; tarayıcı sadece anahtarını gönderir
  let scanning = null;

  async function scan() {
    const detected = await detectServices(dir);
    const safe = (p, name) =>
      p.catch((e) => [
        {
          id: name,
          name,
          sub: { tr: "Kontrol sırasında hata", en: "Error while checking" },
          checks: [{ id: `${name}.error`, status: "unk", title: { tr: "Kontrol edilemedi", en: "Could not check" }, detail: { tr: String(e.message), en: String(e.message) } }],
        },
      ]);
    const [vercel, code, manual] = await Promise.all([
      safe(scanVercel(), "Vercel"),
      safe(scanCode(dir).then((c) => [c]), "Code"),
      safe(manualCards(detected), "Manual"),
    ]);
    const services = [...vercel, ...manual, ...code];
    fixes = new Map();
    let n = 0;
    for (const s of services)
      for (const c of s.checks) {
        Object.assign(c, EXPLAIN[c.id] && !c.what ? EXPLAIN[c.id] : {});
        if (c.fix) {
          const key = `f${++n}`;
          fixes.set(key, c.fix);
          c.fix = { key, label: c.fix.label, plan: c.fix.plan };
        }
      }
    return { services, detected, at: new Date().toISOString() };
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, {
        "content-type": type,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };

    // DNS rebinding'e karşı: sadece kendi adresimizden gelen istekler
    const addr = server.address();
    const allowed = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
    if (!allowed.includes(req.headers.host)) return send(403, { error: "forbidden host" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") {
      const html = (await readFile(UI, "utf8")).replace("__VA_TOKEN__", token);
      return send(200, html, "text/html; charset=utf-8");
    }
    if (!url.pathname.startsWith("/api/")) return send(404, { error: "not found" });
    if (req.headers["x-va-token"] !== token) return send(401, { error: "bad token" });

    try {
      if (req.method === "GET" && url.pathname === "/api/scan") {
        scanning ??= scan().finally(() => (scanning = null));
        return send(200, await scanning);
      }
      if (req.method === "POST") {
        if (!String(req.headers["content-type"]).startsWith("application/json")) return send(415, { error: "json only" });
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 10_000) return send(413, { error: "too large" });
        }
        const body = JSON.parse(raw || "{}");
        if (url.pathname === "/api/fix") {
          const fix = fixes.get(body.key);
          if (!fix) return send(400, { error: "unknown fix; scan again" });
          const result = await fixVercel(fix);
          fixes.delete(body.key);
          return send(200, result);
        }
        if (url.pathname === "/api/answer") {
          if (!/^manual\.[a-z]+$/.test(body.id) || !["yes", "no"].includes(body.value)) return send(400, { error: "bad answer" });
          await saveAnswer(body.id, body.value);
          return send(200, { ok: true });
        }
      }
      return send(404, { error: "not found" });
    } catch (e) {
      return send(500, { error: String(e.message) });
    }
  });

  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
