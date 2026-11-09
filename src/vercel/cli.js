// Vercel'e erişim: kullanıcının kendi `vercel` oturumu (ya da CI'da VERCEL_TOKEN) üzerinden.
// VibeAmigo anahtarı hiç görmez; sadece Vercel CLI'ı çalıştırır.
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run, parseJson } from "../run.js";

// `api` komutu kurulu CLI'da hızlı çalışır. `billing` ve `metrics` komutları yeni sürümde (65+) var;
// kurulu sürüm eskiyse sadece o komutlar için `npx vercel@latest` kullanılır.
let cli = null;
async function pick() {
  if (cli) return cli;
  const v = await run("vercel", ["--version"], { timeout: 30_000 });
  const major = v.ok ? Number((v.stdout + v.stderr).match(/(\d+)\.\d+\.\d+/)?.[1] ?? 0) : 0;
  const latest = { cmd: "npx", pre: ["-y", "vercel@latest"] };
  const local = { cmd: "vercel", pre: [] };
  cli = { modern: major >= 65 ? local : latest, basic: major >= 50 ? local : latest };
  return cli;
}

const MODERN = new Set(["billing", "metrics"]);

export async function vc(args, opts) {
  const c = (await pick())[MODERN.has(args[0]) ? "modern" : "basic"];
  return run(c.cmd, [...c.pre, ...args], { timeout: 180_000, ...opts });
}

/** Vercel REST API çağrısı. { ok, json, error } döner; hata fırlatmaz. */
export async function api(pathname, { method, body } = {}) {
  const args = ["api", pathname];
  let dir;
  if (method) args.push("--method", method);
  if (body !== undefined) {
    dir = await mkdtemp(path.join(tmpdir(), "vibeamigo-"));
    const file = path.join(dir, "body.json");
    await writeFile(file, JSON.stringify(body), { mode: 0o600 });
    args.push("--input", file);
  }
  try {
    const r = await vc(args);
    const error = r.ok ? null : (r.stderr + r.stdout).split("\n").filter((l) => /error/i.test(l)).pop()?.trim() || "request failed";
    return { ok: r.ok, json: parseJson(r.stdout), error };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

/** Aynı anda en fazla `limit` iş çalıştırır, sonuçları sırasıyla döner. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

export async function whoami() {
  const r = await vc(["whoami"], { timeout: 60_000 });
  return r.ok ? r.stdout.trim().split("\n").pop() : null;
}

export async function listTeams() {
  return (await api("/v2/teams?limit=100")).json?.teams ?? [];
}

export async function listProjects(teamId) {
  const projects = [];
  let from;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ teamId, limit: "100", ...(from ? { from: String(from) } : {}) });
    const r = await api(`/v10/projects?${q}`);
    if (!r.json?.projects) break;
    projects.push(...r.json.projects);
    from = r.json.pagination?.next;
    if (!from) break;
  }
  return projects;
}
