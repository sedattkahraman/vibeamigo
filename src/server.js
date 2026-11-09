// Yerel panel sunucusu. Sadece 127.0.0.1'e bağlanır; her açılışta rastgele bir anahtar üretir.
// Tarayıcıda açık başka bir site bu sunucuya istek atamaz: anahtar, Host kontrolü ve JSON zorunluluğu.
// Tarayıcı hiçbir zaman "şunu yap" diye serbest komut göndermez: sadece son taramanın önerdiği bir
// işlemin numarasını ve o işlemin izin verdiği sitelerden bir seçimi gönderir.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scanVercel } from "./vercel/scan.js";
import { applyFix, panic, runDrill } from "./vercel/actions.js";
import { scanCode, detectServices, linkedProject } from "./checks/code.js";
import { manualCards, saveAnswer } from "./checks/manual.js";
import { loadDrills, saveDrill, loadWatch } from "./store.js";
import { EXPLAIN } from "./copy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "ui", "index.html");
const WATCH_TEMPLATE = path.join(ROOT, "templates", "vibeamigo-watch.yml");

const errorCard = (name, e) => [
  {
    id: name,
    name,
    sub: { tr: "Kontrol sırasında hata", en: "Error while checking" },
    checks: [{ id: `${name}.error`, status: "unk", title: { tr: "Kontrol edilemedi", en: "Could not check" }, detail: { tr: String(e.message), en: String(e.message) } }],
  },
];

/** Taramayı yapar; değişiklik yapabilen her öneriyi kayda alıp tarayıcıya sadece numarasını verir. */
export async function fullScan(dir) {
  const [detected, link, drills, watch, watchTemplate] = await Promise.all([detectServices(dir), linkedProject(dir), loadDrills(), loadWatch(), readFile(WATCH_TEMPLATE, "utf8").catch(() => "")]);
  const safe = (p, name) => p.catch((e) => errorCard(name, e));
  const [vercel, code, manual] = await Promise.all([
    safe(scanVercel({ linkedProjectId: link.projectId, drills }), "Vercel"),
    safe(scanCode(dir).then((c) => [c]), "Code"),
    safe(manualCards(detected), "Manual"),
  ]);
  const services = [...vercel, ...manual, ...code];
  const registry = new Map();
  let n = 0;
  const register = (action) => {
    const key = `a${++n}`;
    registry.set(key, action);
    return {
      key,
      kind: action.kind,
      type: action.type,
      label: action.label,
      plan: action.plan,
      projects: action.projects?.map((p) => ({ id: p.id, name: p.name })),
      selectable: !!action.selectable,
      defaultProject: action.defaultProject,
      danger: !!action.danger,
      primary: !!action.primary,
    };
  };
  for (const s of services) {
    for (const c of s.checks) {
      const copy = EXPLAIN[c.id];
      if (copy) for (const k of ["title", "what", "why", "limits"]) c[k] ??= copy[k];
      if (c.fix) c.fix = register(c.fix);
      if (c.drill) c.drill = c.drill.projects.length ? register(c.drill) : undefined;
    }
    if (s.emergency) s.emergency.actions = s.emergency.actions.filter((a) => a.projects.length).map(register);
  }
  return { result: { services, detected, watch, watchTemplate, at: new Date().toISOString() }, registry };
}

export async function startServer({ dir, port = 0, scanImpl = fullScan }) {
  const token = randomBytes(24).toString("hex");
  let registry = new Map();
  let scanning = null;
  let busy = false;

  const scan = async () => {
    const s = await scanImpl(dir);
    registry = s.registry;
    return s.result;
  };

  async function act(body) {
    const action = registry.get(body.key);
    if (!action) return [400, { error: "unknown action; scan again" }];
    const allowed = new Set((action.projects ?? []).map((p) => p.id));
    const ids = Array.isArray(body.projectIds) ? body.projectIds : [];
    if (!ids.every((id) => typeof id === "string" && allowed.has(id))) return [400, { error: "project not allowed for this action" }];
    if (action.projects && (action.selectable || action.kind === "drill") && ids.length === 0) return [400, { error: "pick at least one site" }];
    if (action.kind === "drill" && ids.length !== 1) return [400, { error: "pick exactly one site" }];
    const targets = action.projects && !action.selectable && action.kind !== "drill" ? [...allowed] : ids;

    if (action.kind === "fix") return [200, await applyFix(action, targets)];
    if (action.kind === "panic") return [200, await panic(action, targets)];
    if (action.kind === "drill") {
      const result = await runDrill(action, targets[0]);
      if (!result.inconclusive) await saveDrill(action.teamId, action.type, result); // belirsiz sonuç kayda geçmez
      return [200, { ok: result.ok, result }];
    }
    return [400, { error: "unknown action kind" }];
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
    if (![`127.0.0.1:${addr.port}`, `localhost:${addr.port}`].includes(req.headers.host)) return send(403, { error: "forbidden host" });

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
          if (raw.length > 20_000) return send(413, { error: "too large" });
        }
        const body = JSON.parse(raw || "{}");
        if (url.pathname === "/api/act") {
          if (busy) return send(409, { error: "another action is running" });
          busy = true;
          try {
            const [code, out] = await act(body);
            return send(code, out);
          } finally {
            busy = false;
          }
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
