// Vercel kontrolleri. Kullanıcının mevcut `vercel login` oturumunu kullanır; anahtar istemez.
// Harcama sınırı komutları Vercel CLI 65+ ile geldi; eski sürüm kuruluysa `npx vercel@latest` kullanılır.
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run, parseJson } from "../run.js";

const RULE_NAME = "VibeAmigo rate limit";

// İki ayrı CLI seçimi: `api` komutu 50+ sürümde var (hızlı, kurulu olanı kullan);
// `billing budgets` 65+ ile geldi (eskiyse npx ile en yenisini çalıştır).
let cli = null;
async function vercelCli() {
  if (cli) return cli;
  const v = await run("vercel", ["--version"], { timeout: 30_000 });
  const major = v.ok ? Number((v.stdout + v.stderr).match(/(\d+)\.\d+\.\d+/)?.[1] ?? 0) : 0;
  const latest = { cmd: "npx", pre: ["-y", "vercel@latest"] };
  const local = { cmd: "vercel", pre: [] };
  cli = { billing: major >= 65 ? local : latest, api: major >= 50 ? local : latest };
  return cli;
}

async function vc(args, opts) {
  const c = (await vercelCli())[args[0] === "billing" ? "billing" : "api"];
  return run(c.cmd, [...c.pre, ...args], { timeout: 180_000, ...opts });
}

async function api(pathname, { method, body } = {}) {
  const args = ["api", pathname];
  let dir;
  if (method) args.push("--method", method);
  if (body) {
    dir = await mkdtemp(path.join(tmpdir(), "vibeamigo-"));
    const file = path.join(dir, "body.json");
    await writeFile(file, JSON.stringify(body));
    args.push("--input", file);
  }
  const r = await vc(args);
  if (dir) await rm(dir, { recursive: true, force: true });
  return { ...r, json: parseJson(r.stdout) };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const money = (n) => `${(Math.round(n * 100) / 100).toLocaleString("tr-TR")} $`;
const moneyEn = (n) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US")}`;

async function listProjects(teamId) {
  const projects = [];
  let from;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ teamId, limit: "100", ...(from ? { from } : {}) });
    const r = await api(`/v10/projects?${q}`);
    if (!r.json?.projects) break;
    projects.push(...r.json.projects);
    from = r.json.pagination?.next;
    if (!from) break;
  }
  return projects;
}

function hasRateLimit(config) {
  return (config?.rules ?? []).some(
    (r) => r.active !== false && (r.action?.mitigate?.action === "rate_limit" || r.action?.mitigate?.rateLimit),
  );
}

/** Oturum açık mı? Değilse kullanıcıya gösterilecek bir servis kartı döner. */
async function whoami() {
  const r = await vc(["whoami"], { timeout: 60_000 });
  return r.ok ? r.stdout.trim().split("\n").pop() : null;
}

export async function scanVercel() {
  const user = await whoami();
  if (!user) {
    return [
      {
        id: "vercel",
        name: "Vercel",
        sub: { tr: "Siteni internette yayınlayan servis", en: "The service that hosts your site" },
        checks: [
          {
            id: "vercel.login",
            status: "unk",
            title: { tr: "Vercel'e giriş yapılmamış", en: "Not logged in to Vercel" },
            detail: {
              tr: "Terminalde `vercel login` yazıp giriş yap, sonra bu sayfayı yenile.",
              en: "Run `vercel login` in your terminal, then refresh this page.",
            },
          },
        ],
      },
    ];
  }

  const teams = (await api("/v2/teams?limit=100")).json?.teams ?? [];
  const cards = [];
  for (const team of teams) cards.push(await scanTeam(team));
  return cards;
}

async function scanTeam(team) {
  const scope = ["--scope", team.slug];
  const [budgetRes, usageRes, dailyRes, projects] = await Promise.all([
    vc(["billing", "budgets", "inspect", "--json", ...scope]),
    vc(["billing", "usage", "--json", ...scope]),
    vc(["billing", "usage", "--json", "--breakdown", "daily", "--since", "14d", ...scope]),
    listProjects(team.id),
  ]);
  const budgetData = parseJson(budgetRes.stdout);
  const usage = parseJson(usageRes.stdout);
  const daily = parseJson(dailyRes.stdout);
  const budget = budgetData?.budget ?? null;
  const overage = budgetData?.spend?.currentSpend ?? 0;
  const pauseOn = !!budget?.thresholds?.some((t) => t.percent >= 100 && t.pauseUsage);
  const suggested = Math.max(10, Math.ceil(overage * 2));
  const checks = [];

  // 1) Aylık harcama sınırı
  if (!budgetData) {
    checks.push({
      id: "vercel.budget",
      status: "unk",
      title: { tr: "Aylık harcama sınırı", en: "Monthly spending limit" },
      detail: {
        tr: "Okunamadı. Bu takımda Owner ya da Billing yetkin olmayabilir, ya da plan Hobby olabilir.",
        en: "Could not read it. You may lack the Owner/Billing role, or the plan may be Hobby.",
      },
      link: `https://vercel.com/${team.slug}/~/settings/billing`,
    });
  } else if (!budget) {
    checks.push({
      id: "vercel.budget",
      status: "bad",
      title: { tr: "Aylık harcama sınırı", en: "Monthly spending limit" },
      detail: { tr: "Hiç sınır yok. Faturanın üst sınırı yok.", en: "No limit at all. Your bill has no ceiling." },
      fix: {
        id: "vercel.setBudget",
        team: team.slug,
        amount: suggested,
        label: "fix",
        plan: {
          tr: [`Aylık ${suggested} $'lık bir harcama sınırı koyacağım.`, "Sınıra gelince bütün sitelerin geçici olarak duracak."],
          en: [`I will set a ${suggested} USD monthly spending limit.`, "All your sites will pause when you hit it."],
        },
      },
    });
  } else {
    const high = budget.amount > suggested * 5 && budget.amount > 50;
    checks.push({
      id: "vercel.budget",
      status: high ? "warn" : "ok",
      title: { tr: "Aylık harcama sınırı", en: "Monthly spending limit" },
      detail: high
        ? {
            tr: `${budget.amount} $ sınır var. Bu ay ek ödemen ${money(overage)}; sınır gereğinden yüksek.`,
            en: `Limit is ${moneyEn(budget.amount)}. Your extra spend this month is ${moneyEn(overage)}; the limit is higher than needed.`,
          }
        : {
            tr: `${budget.amount} $ sınır var. Bu ay ek ödemen ${money(overage)}.`,
            en: `Limit is ${moneyEn(budget.amount)}. Your extra spend this month is ${moneyEn(overage)}.`,
          },
      fix: high
        ? {
            id: "vercel.setBudget",
            team: team.slug,
            amount: suggested,
            label: "lower",
            plan: {
              tr: [`Aylık sınırı ${budget.amount} $'dan ${suggested} $'a indireceğim.`, "Normal kullanımın etkilenmez."],
              en: [`I will lower the monthly limit from ${budget.amount} to ${suggested} USD.`, "Your normal usage is not affected."],
            },
          }
        : undefined,
    });
  }

  // 2) Sınıra gelince durdur
  if (budget) {
    checks.push({
      id: "vercel.pause",
      status: pauseOn ? "ok" : "bad",
      title: { tr: "Sınıra gelince siteyi durdur", en: "Pause the site at the limit" },
      detail: pauseOn
        ? { tr: "Açık. Sınıra gelince sitelerin durur, fatura büyümez.", en: "On. Your sites pause at the limit; the bill stops growing." }
        : {
            tr: "Kapalı. Sınıra gelince sadece e-posta geliyor, fatura büyümeye devam ediyor.",
            en: "Off. At the limit you only get an email; the bill keeps growing.",
          },
      fix: pauseOn
        ? undefined
        : {
            id: "vercel.pause",
            team: team.slug,
            label: "fix",
            plan: {
              tr: [
                "Sınıra gelince bütün sitelerin geçici olarak kapanacak.",
                'Ziyaretçiler "site geçici olarak kapalı" görecek.',
                "Siteleri sen tekrar açana kadar kapalı kalırlar.",
              ],
              en: ["All your sites will pause when you hit the limit.", 'Visitors will see "site temporarily unavailable".', "They stay paused until you resume them."],
            },
          },
    });
  }

  // 3) Aşırı ziyaret engeli (firewall istek sınırı)
  const fw = await mapLimit(projects, 6, async (p) => {
    const r = await api(`/v1/security/firewall/config/active?projectId=${p.id}&teamId=${team.id}`);
    return { id: p.id, name: p.name, ok: hasRateLimit(r.json) };
  });
  const missing = fw.filter((x) => !x.ok);
  checks.push({
    id: "vercel.ratelimit",
    status: missing.length === 0 ? "ok" : "bad",
    title: { tr: "Aşırı ziyaret engeli", en: "Too-many-visits blocker" },
    detail:
      missing.length === 0
        ? { tr: `${projects.length} sitenin hepsinde var.`, en: `Present on all ${projects.length} sites.` }
        : {
            tr: `${projects.length} sitenin ${missing.length} tanesinde yok: ${missing.slice(0, 5).map((m) => m.name).join(", ")}${missing.length > 5 ? "…" : ""}`,
            en: `Missing on ${missing.length} of ${projects.length} sites: ${missing.slice(0, 5).map((m) => m.name).join(", ")}${missing.length > 5 ? "…" : ""}`,
          },
    fix: missing.length
      ? {
          id: "vercel.ratelimit",
          team: team.slug,
          teamId: team.id,
          projects: missing.map((m) => m.id),
          label: "fix",
          plan: {
            tr: [
              `${missing.length} siteye "aynı bilgisayar dakikada 600'den fazla istek atarsa durdur" kuralı ekleyeceğim.`,
              "Sitenin kendi dosyaları (/_next/static) bu sayıma girmez; normal ziyaretçiler etkilenmez.",
            ],
            en: [
              `I will add a "block one computer sending over 600 requests a minute" rule to ${missing.length} sites.`,
              "Static files (/_next/static) don't count; normal visitors are not affected.",
            ],
          },
        }
      : undefined,
  });

  // 4) Deneme sayfalarının gizliliği
  const publicPreviews = projects.filter((p) => !p.ssoProtection && !p.passwordProtection);
  checks.push({
    id: "vercel.previews",
    status: publicPreviews.length === 0 ? "ok" : "warn",
    title: { tr: "Deneme sayfalarının gizliliği", en: "Privacy of test pages" },
    detail:
      publicPreviews.length === 0
        ? { tr: "Bütün sitelerin deneme sayfaları gizli.", en: "All test pages are private." }
        : {
            tr: `${publicPreviews.length} sitenin deneme sayfaları herkese açık: ${publicPreviews.map((p) => p.name).join(", ")}`,
            en: `${publicPreviews.length} sites have public test pages: ${publicPreviews.map((p) => p.name).join(", ")}`,
          },
    fix: publicPreviews.length
      ? {
          id: "vercel.previews",
          team: team.slug,
          teamId: team.id,
          projects: publicPreviews.map((p) => p.id),
          label: "fix",
          plan: {
            tr: [`${publicPreviews.length} sitenin deneme sayfalarını sadece Vercel hesabıyla giriş yapanların görebileceği hâle getireceğim.`, "Canlı siten (kendi alan adın) etkilenmez."],
            en: [`I will make the test pages of ${publicPreviews.length} sites visible only to logged-in Vercel members.`, "Your live site (custom domain) is not affected."],
          },
        }
      : undefined,
  });

  // İstatistik şeridi
  let stats;
  if (usage?.creditBalance) {
    const cb = usage.creditBalance;
    const top = (usage.services ?? [])
      .filter((s) => s.category === "usage" && s.cost > 0.01)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3);
    const bars = (daily?.breakdown?.data ?? []).map((d) =>
      (d.services ?? []).filter((s) => s.category === "usage").reduce((n, s) => n + s.cost, 0),
    );
    stats = {
      items: [
        { tr: "Bu ay kullanım", en: "Usage this month", v: { tr: money(cb.used), en: moneyEn(cb.used) } },
        { tr: "Ek ödeme", en: "Extra charges", v: { tr: money(overage), en: moneyEn(overage) } },
        budget && !(budget.amount > suggested * 5 && budget.amount > 50)
          ? { tr: "Harcama sınırın", en: "Your limit", v: { tr: `${budget.amount} $`, en: `$${budget.amount}` } }
          : { tr: "Önerilen sınır", en: "Suggested limit", v: { tr: `${suggested} $`, en: `$${suggested}` } },
      ],
      bars,
      note: {
        tr: `Pro paketindeki aylık ${cb.allocated} $ kredinin ${money(cb.used)} kadarı kullanıldı. En çok harcayan: ${top.map((s) => `${s.name} (${money(s.cost)})`).join(", ") || "—"}.`,
        en: `${moneyEn(cb.used)} of the ${moneyEn(cb.allocated)} monthly Pro credit used. Top costs: ${top.map((s) => `${s.name} (${moneyEn(s.cost)})`).join(", ") || "—"}.`,
      },
    };
  }

  return {
    id: `vercel:${team.slug}`,
    name: `Vercel · ${team.name}`,
    sub: {
      tr: `Siteni internette yayınlayan servis · ${projects.length} proje`,
      en: `The service that hosts your site · ${projects.length} projects`,
    },
    stats,
    checks,
  };
}

// ---------- Düzeltmeler (her biri kullanıcı onayından sonra çalışır) ----------

export async function fixVercel(fix) {
  const scope = ["--scope", fix.team];
  if (fix.id === "vercel.pause") {
    const r = await vc(["billing", "budgets", "set", "--pause", ...scope], { input: "y\n" });
    return { ok: r.ok, log: r.ok ? [] : [r.stderr.trim()] };
  }
  if (fix.id === "vercel.setBudget") {
    const r = await vc(["billing", "budgets", "set", "--amount", String(Math.max(1, Math.round(fix.amount))), "--pause", ...scope], {
      input: "y\n",
    });
    return { ok: r.ok, log: r.ok ? [] : [r.stderr.trim()] };
  }
  if (fix.id === "vercel.ratelimit") {
    const rule = {
      action: "rules.insert",
      id: null,
      value: {
        name: RULE_NAME,
        description: "Added by VibeAmigo: max 600 requests per minute per IP (static files excluded)",
        active: true,
        conditionGroup: [{ conditions: [{ type: "path", op: "pre", value: "/_next/static", neg: true }] }],
        action: {
          mitigate: {
            action: "rate_limit",
            rateLimit: { algo: "fixed_window", window: 60, limit: 600, keys: ["ip"], action: "rate_limit" },
            actionDuration: null,
          },
        },
      },
    };
    const results = await mapLimit(fix.projects, 4, async (pid) => {
      const r = await api(`/v1/security/firewall/config?projectId=${pid}&teamId=${fix.teamId}`, { method: "PATCH", body: rule });
      return r.ok ? null : `${pid}: ${r.stderr.trim().split("\n").pop()}`;
    });
    const errors = results.filter(Boolean);
    return { ok: errors.length === 0, log: errors };
  }
  if (fix.id === "vercel.previews") {
    const results = await mapLimit(fix.projects, 4, async (pid) => {
      const r = await api(`/v9/projects/${pid}?teamId=${fix.teamId}`, {
        method: "PATCH",
        body: { ssoProtection: { deploymentType: "all_except_custom_domains" } },
      });
      return r.ok ? null : `${pid}: ${r.stderr.trim().split("\n").pop()}`;
    });
    const errors = results.filter(Boolean);
    return { ok: errors.length === 0, log: errors };
  }
  return { ok: false, log: [`unknown fix ${fix.id}`] };
}
