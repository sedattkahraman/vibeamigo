// Vercel'de değişiklik yapan her şey burada: düzeltmeler, acil frenler ve tatbikatlar.
// Hiçbiri kendiliğinden çalışmaz; panelde kullanıcı onayladıktan (ya da bekçide açıkça istendikten) sonra çağrılır.
// Hiçbiri veri silmez.
import { vc, api, mapLimit } from "./cli.js";
import { generalRule, writeRule, GENERAL_LIMIT, WRITE_LIMIT } from "./rules.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t0) => Math.round((Date.now() - t0) / 100) / 10;

async function each(ids, fn) {
  const results = await mapLimit(ids, 4, async (id) => {
    const r = await fn(id);
    return r.ok ? null : `${id}: ${r.error}`;
  });
  const errors = results.filter(Boolean);
  return { ok: errors.length === 0, log: errors };
}

// ---------- Tek tek frenler ----------

export const setAttackMode = (teamId, projectId, on, minutes = 60) =>
  api(`/v1/security/attack-mode?teamId=${teamId}`, {
    method: "POST",
    body: { projectId, attackModeEnabled: on, attackModeActiveUntil: on ? Date.now() + minutes * 60_000 : null },
  });

export const pauseProject = (teamId, projectId) => api(`/v1/projects/${projectId}/pause?teamId=${teamId}`, { method: "POST", body: {} });
export const unpauseProject = (teamId, projectId) => api(`/v1/projects/${projectId}/unpause?teamId=${teamId}`, { method: "POST", body: {} });

const insertRule = (teamId, projectId, rule) =>
  api(`/v1/security/firewall/config?projectId=${projectId}&teamId=${teamId}`, { method: "PATCH", body: { action: "rules.insert", id: null, value: rule } });

export const addGeneralLimit = (teamId, projectId) => insertRule(teamId, projectId, generalRule());

// ---------- Düzeltmeler ----------

export async function applyFix(fix, projectIds) {
  const scope = ["--scope", fix.team];
  const cli = async (args) => {
    const r = await vc(args, { input: "y\n" });
    return { ok: r.ok, log: r.ok ? [] : [(r.stderr || r.stdout).trim().split("\n").pop()] };
  };
  switch (fix.id) {
    case "vercel.pause":
      return cli(["billing", "budgets", "set", "--pause", ...scope]);
    case "vercel.setBudget":
      return cli(["billing", "budgets", "set", "--amount", String(Math.max(1, Math.round(fix.amount))), "--pause", ...scope]);
    case "vercel.ratelimit":
      return each(projectIds, (pid) => insertRule(fix.teamId, pid, generalRule()));
    case "vercel.writelimit":
      return each(projectIds, (pid) => insertRule(fix.teamId, pid, writeRule()));
    case "vercel.previews":
      return each(projectIds, (pid) => api(`/v9/projects/${pid}?teamId=${fix.teamId}`, { method: "PATCH", body: { ssoProtection: { deploymentType: "all_except_custom_domains" } } }));
    default:
      return { ok: false, log: [`unknown fix ${fix.id}`] };
  }
}

// ---------- Acil durum ----------

export async function panic(action, projectIds) {
  switch (action.type) {
    case "attack":
      return each(projectIds, (pid) => setAttackMode(action.teamId, pid, true, 60));
    case "pause":
      return each(projectIds, (pid) => pauseProject(action.teamId, pid));
    case "resume": {
      const a = await each(projectIds.filter((id) => action.attack.includes(id)), (pid) => setAttackMode(action.teamId, pid, false));
      const p = await each(projectIds.filter((id) => action.paused.includes(id)), (pid) => unpauseProject(action.teamId, pid));
      return { ok: a.ok && p.ok, log: [...a.log, ...p.log] };
    }
    default:
      return { ok: false, log: [`unknown action ${action.type}`] };
  }
}

// ---------- Tatbikatlar ----------

/** Siteye tek bir istek atar; firewall'un ne yaptığını döner. */
async function probe(url, method = "GET") {
  try {
    const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}va=${Date.now()}${Math.random().toString(36).slice(2, 8)}`, {
      method,
      redirect: "manual",
      headers: { "user-agent": "VibeAmigo-drill (+https://github.com/sedattkahraman/vibeamigo)" },
      signal: AbortSignal.timeout(15_000),
    });
    await r.arrayBuffer().catch(() => {});
    return { status: r.status, mitigated: r.headers.get("x-vercel-mitigated") };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

/** Art arda istek atar; engellenmeye başladığı anda durur. */
async function flood(url, { method, max, concurrency = 20 }) {
  let sent = 0;
  let passed = 0;
  let blocked = 0;
  let errors = 0;
  let blockStatus = null;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (sent < max && blocked < 5 && errors < 30) {
        sent++;
        const r = await probe(url, method);
        if (r.status === 0) errors++;
        else if (r.status === 429 || r.mitigated) {
          blocked++;
          blockStatus ??= r.mitigated ? `${r.status} (${r.mitigated})` : String(r.status);
        } else passed++;
      }
    }),
  );
  return { passed, blocked, errors, blockStatus };
}

async function until(fn, { timeout, every = 1500 }) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return secs(t0);
    await sleep(every);
  }
  return null;
}

/**
 * Bir freni gerçekten dener ve sonucu döner: { ok, project, ...ölçümler, note }.
 * Her tatbikat sonunda siteyi eski hâline getirir; getiremezse `restoreFailed: true` döner.
 */
export async function runDrill(drill, projectId) {
  const project = drill.projects.find((p) => p.id === projectId);
  if (!project) return { ok: false, project: "?", note: { tr: "Bu site tatbikat için uygun değil.", en: "This site is not eligible for a drill." } };
  const base = `https://${project.domain}`;
  const out = { project: project.name };

  if (drill.type === "ratelimit" || drill.type === "writelimit") {
    const limit = drill.type === "ratelimit" ? GENERAL_LIMIT : WRITE_LIMIT;
    const method = drill.type === "ratelimit" ? "GET" : "POST";
    const url = `${base}/__vibeamigo-drill`;
    // Önceki bir tatbikat yüzünden bağlantı hâlâ engelliyse sonuç yanıltıcı olur: önce engelin kalkmasını bekle.
    const free = await until(async () => { const p = await probe(url, method); return p.status !== 0 && p.status !== 429 && !p.mitigated; }, { timeout: 75_000, every: 5000 });
    if (free === null) return { ...out, ok: false, inconclusive: true, note: { tr: "Bağlantın bu sitede hâlâ engelli (önceki bir tatbikattan olabilir). Birkaç dakika sonra tekrar dene.", en: "Your connection is still blocked on this site (maybe from an earlier drill). Try again in a few minutes." } };
    // Sabit pencere dakika ortasında sıfırlanabilir; o durumda bir kez daha dene.
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await flood(url, { method, max: Math.round(limit * 1.6) });
      if (r.blocked > 0 || r.errors >= 30) break;
    }
    if (r.errors >= 30) return { ...out, ok: false, note: { tr: "Siteye ulaşılamadı.", en: "Could not reach the site." } };
    if (!r.blocked) return { ...out, ok: false, passed: undefined, note: { tr: `${r.passed} istek attım, hiçbiri durdurulmadı. Sınır devreye girmedi.`, en: `Sent ${r.passed} requests and none was blocked. The limit did not kick in.` } };
    if (r.passed > limit * 1.25) return { ...out, ok: false, note: { tr: `Sınır ${limit} olmalıydı ama ${r.passed} istek geçti.`, en: `The limit should be ${limit} but ${r.passed} requests passed.` } };
    const passed = r.passed + 1; // baştaki yoklama isteği de sayıldı
    if (passed < limit * 0.8) return { ...out, ok: false, inconclusive: true, note: { tr: `Sınır beklenenden erken devreye girdi (${passed} istek). Aynı dakikada başka istekler de sayılmış olabilir; biraz sonra tekrar dene.`, en: `The limit kicked in earlier than expected (${passed} requests). Other requests may have been counted in the same minute; try again shortly.` } };
    return { ...out, ok: true, passed, blockStatus: r.blockStatus };
  }

  if (drill.type === "attack") {
    const before = await probe(base);
    if (before.mitigated) return { ...out, ok: false, note: { tr: "Site zaten doğrulama gösteriyor; önce normale dönmesini bekle.", en: "The site is already challenging; wait for it to return to normal first." } };
    const on = await setAttackMode(drill.teamId, project.id, true, 10); // 10 dk sonra kendiliğinden kapanır
    if (!on.ok) return { ...out, ok: false, note: { tr: `Saldırı modu açılamadı: ${on.error}`, en: `Could not turn attack mode on: ${on.error}` } };
    let onSec = null;
    let off;
    try {
      onSec = await until(async () => (await probe(base)).mitigated === "challenge", { timeout: 30_000 });
    } finally {
      off = await setAttackMode(drill.teamId, project.id, false);
    }
    if (!off.ok) return { ...out, ok: false, restoreFailed: true, note: { tr: "Saldırı modu kapatılamadı. 10 dakika içinde kendiliğinden kapanacak.", en: "Could not turn attack mode off. It will turn itself off within 10 minutes." } };
    const offSec = await until(async () => { const p = await probe(base); return p.status !== 0 && !p.mitigated; }, { timeout: 150_000, every: 3000 }); // Vercel doğrulamayı bağlantı başına ~60 sn hatırlar
    if (onSec === null) return { ...out, ok: false, note: { tr: "Saldırı modu açıldı ama 30 saniyede doğrulama görünmedi.", en: "Attack mode was turned on but no challenge appeared within 30 seconds." } };
    if (offSec === null) return { ...out, ok: false, note: { tr: "Saldırı modu kapatıldı ama site 150 saniyede normale dönmedi. Biraz sonra tekrar tara.", en: "Attack mode was turned off but the site did not return to normal within 150 seconds. Scan again shortly." } };
    return { ...out, ok: true, onSec, offSec };
  }

  if (drill.type === "pause") {
    const paused = await pauseProject(drill.teamId, project.id);
    if (!paused.ok) return { ...out, ok: false, note: { tr: `Site durdurulamadı: ${paused.error}`, en: `Could not pause the site: ${paused.error}` } };
    let onSec = null;
    let resumed;
    try {
      onSec = await until(async () => (await probe(base)).status === 503, { timeout: 30_000 });
    } finally {
      resumed = await unpauseProject(drill.teamId, project.id);
      if (!resumed.ok) {
        await sleep(3000);
        resumed = await unpauseProject(drill.teamId, project.id);
      }
    }
    if (!resumed.ok) return { ...out, ok: false, restoreFailed: true, note: { tr: 'SİTE HÂLÂ KAPALI: yeniden açılamadı. "Yeniden tara"ya basıp "Normale dön" ile aç.', en: 'THE SITE IS STILL PAUSED: could not resume it. Press "Scan again", then "Back to normal".' } };
    const offSec = await until(async () => { const s = (await probe(base)).status; return s !== 0 && s !== 503; }, { timeout: 90_000 });
    if (onSec === null) return { ...out, ok: false, note: { tr: "Durdurma komutu gitti ama site 30 saniyede kapanmadı.", en: "The pause was sent but the site did not go down within 30 seconds." } };
    if (offSec === null) return { ...out, ok: false, note: { tr: "Site yeniden açıldı ama 90 saniyede cevap vermedi. Biraz sonra kontrol et.", en: "The site was resumed but did not answer within 90 seconds. Check again shortly." } };
    return { ...out, ok: true, onSec, offSec };
  }

  return { ...out, ok: false, note: { tr: "Bilinmeyen tatbikat.", en: "Unknown drill." } };
}
