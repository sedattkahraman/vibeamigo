// Bekçi: hesabı düzenli aralıklarla kontrol eder, sorun görürse haber verir, istenirse freni çeker.
//   vibeamigo watch                  bir kez kontrol et (zamanlanmış görevler ve GitHub Actions için)
//   vibeamigo watch --loop 5         bilgisayar açıkken 5 dakikada bir kontrol et
//   --brake attack                   ani artış görülen sitede 1 saatliğine saldırı modunu aç
//   --heal                           istek sınırı olmayan (yeni) sitelere kuralı kendiliğinden ekle
//   --strict                         uyarıları da alarm say
// Çıkış kodu: 0 sorun yok · 1 alarm var · 2 kontrol yapılamadı (bekçi kör)
// Haber kanalları (ortam değişkeni varsa): TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, VIBEAMIGO_WEBHOOK
import { appendFile } from "node:fs/promises";
import { whoami, listTeams } from "./vercel/cli.js";
import { collectTeam } from "./vercel/scan.js";
import { setAttackMode, addGeneralLimit } from "./vercel/actions.js";
import { saveWatch } from "./store.js";

const n = (x, l) => Math.round(x).toLocaleString(l === "tr" ? "tr-TR" : "en-US");

/** Toplanan durumdan alarm listesi çıkarır. Saf fonksiyon: hiçbir şeyi değiştirmez. */
export function evaluate(facts) {
  const { team, projects, budget, pauseOn, overage, traffic } = facts;
  const out = [];
  const add = (level, code, tr, en, extra = {}) => out.push({ level, code, team: team.slug, tr, en, ...extra });

  if (facts.budgetReadable) {
    if (!budget) add("alert", "no-budget", "Harcama sınırı yok. Faturanın üst sınırı yok.", "No spending limit. The bill has no ceiling.");
    else if (!pauseOn) add("alert", "pause-off", "Sınıra gelince durdurma kapalı. Sınır sadece e-posta atıyor.", "Pause at the limit is off. The limit only sends emails.");
    if (budget && overage >= budget.amount * 0.8) add("alert", "budget-80", `Ek harcama sınırın %80'ini geçti: ${overage.toFixed(2)} $ / ${budget.amount} $.`, `Extra spend is above 80% of the limit: $${overage.toFixed(2)} / $${budget.amount}.`);
    else if (budget && overage >= budget.amount * 0.5) add("warn", "budget-50", `Ek harcama sınırın yarısını geçti: ${overage.toFixed(2)} $ / ${budget.amount} $.`, `Extra spend is above half the limit: $${overage.toFixed(2)} / $${budget.amount}.`);
  }

  const noLimit = projects.filter((p) => !p.limits.general);
  if (noLimit.length) add("warn", "no-ratelimit", `${noLimit.length} sitede aşırı ziyaret engeli yok: ${noLimit.map((p) => p.name).join(", ")}`, `${noLimit.length} sites have no rate limit: ${noLimit.map((p) => p.name).join(", ")}`, { projects: noLimit.map((p) => p.id) });

  const paused = projects.filter((p) => p.paused);
  if (paused.length) add("alert", "paused", `${paused.length} site durdurulmuş (kapalı): ${paused.map((p) => p.name).join(", ")}`, `${paused.length} sites are paused (down): ${paused.map((p) => p.name).join(", ")}`);

  const inAttack = projects.filter((p) => p.attack);
  if (inAttack.length) add("info", "attack-on", `${inAttack.length} sitede saldırı modu açık: ${inAttack.map((p) => p.name).join(", ")}`, `Attack mode is on for ${inAttack.length} sites: ${inAttack.map((p) => p.name).join(", ")}`);

  if (!traffic) add("error", "no-traffic", "Trafik verisi okunamadı; ani artışları göremiyorum.", "Could not read traffic data; I can't see spikes.");
  else
    for (const s of traffic.spikes) {
      const p = projects.find((x) => x.name === s.name);
      add("alert", "spike", `${s.name}: son 10 dakikada ${n(s.last10, "tr")} istek, normalinin yaklaşık ${n(s.times, "tr")} katı.`, `${s.name}: ${n(s.last10, "en")} requests in the last 10 minutes, about ${n(s.times, "en")}× its normal.`, { project: p?.id, braked: !!(p?.attack || p?.paused) });
    }
  return out;
}

async function notify(text) {
  const sent = [];
  const { TELEGRAM_BOT_TOKEN: bot, TELEGRAM_CHAT_ID: chat, VIBEAMIGO_WEBHOOK: hook } = process.env;
  const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }).then((r) => r.ok).catch(() => false);
  if (bot && chat) sent.push(["telegram", await post(`https://api.telegram.org/bot${bot}/sendMessage`, { chat_id: chat, text })]);
  if (hook) sent.push(["webhook", await post(hook, { text, content: text })]);
  return sent;
}

export async function watchOnce({ brake = "none", heal = false, strict = false, minAbs, factor, lang = "tr", lastKey = null } = {}) {
  const findings = [];
  const actions = [];
  if (!(await whoami())) {
    findings.push({ level: "error", code: "no-login", team: "-", tr: "Vercel'e giriş yapılmamış (ya da VERCEL_TOKEN geçersiz).", en: "Not logged in to Vercel (or VERCEL_TOKEN is invalid)." });
  } else {
    for (const team of await listTeams()) {
      let facts;
      try {
        facts = await collectTeam(team, { thresholds: { minAbs, factor } });
      } catch (e) {
        findings.push({ level: "error", code: "scan-failed", team: team.slug, tr: `Kontrol başarısız: ${e.message}`, en: `Check failed: ${e.message}` });
        continue;
      }
      for (const f of evaluate(facts)) {
        findings.push(f);
        if (f.code === "spike" && brake === "attack" && f.project && !f.braked) {
          const r = await setAttackMode(facts.team.id, f.project, true, 60);
          actions.push({ ok: r.ok, tr: `${f.tr.split(":")[0]}: 1 saatliğine saldırı modu ${r.ok ? "açıldı" : `açılamadı (${r.error})`}.`, en: `${f.en.split(":")[0]}: attack mode ${r.ok ? "turned on for 1 hour" : `could not be turned on (${r.error})`}.` });
        }
        if (f.code === "no-ratelimit" && heal) {
          let ok = 0;
          for (const pid of f.projects) if ((await addGeneralLimit(facts.team.id, pid)).ok) ok++;
          actions.push({ ok: ok === f.projects.length, tr: `${ok}/${f.projects.length} siteye aşırı ziyaret engeli eklendi.`, en: `Rate limit added to ${ok}/${f.projects.length} sites.` });
        }
      }
    }
  }

  const is = (l) => findings.filter((f) => f.level === l);
  const alarms = [...is("alert"), ...(strict ? is("warn") : [])];
  const exit = is("error").length ? 2 : alarms.length ? 1 : 0;
  const mark = { alert: "🔴", warn: "🟡", info: "🔵", error: "⚠️" };
  const lines = [
    exit === 0 ? (lang === "tr" ? "✅ VibeAmigo bekçi: sorun yok." : "✅ VibeAmigo watchdog: all clear.") : lang === "tr" ? "VibeAmigo bekçi:" : "VibeAmigo watchdog:",
    ...findings.map((f) => `${mark[f.level]} [${f.team}] ${f[lang]}`),
    ...actions.map((a) => `${a.ok ? "🛑" : "⚠️"} ${a[lang]}`),
  ];
  const text = lines.join("\n");
  // Döngüde aynı alarm her turda yeniden gönderilmesin: sadece durum değişince haber ver.
  const key = [...alarms, ...is("error")].map((f) => `${f.code}:${f.team}:${f.project ?? ""}`).sort().join("|");
  const sent = (exit !== 0 || actions.length) && key !== lastKey ? await notify(text) : [];
  await saveWatch({ at: new Date().toISOString(), exit, alarms: alarms.length, findings: findings.length }).catch(() => {});
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.map((l) => `- ${l}`).join("\n")}\n`).catch(() => {});
  return { exit, text, findings, actions, sent, key };
}

export async function watchCommand(opts) {
  if (!opts.loop) {
    const r = await watchOnce(opts);
    console.log(opts.json ? JSON.stringify({ exit: r.exit, findings: r.findings, actions: r.actions }, null, 2) : r.text);
    return r.exit;
  }
  const every = Math.max(1, opts.loop) * 60_000;
  console.log(opts.lang === "tr" ? `Bekçi çalışıyor: ${opts.loop} dakikada bir kontrol. Durdurmak için Ctrl+C.` : `Watchdog running: checking every ${opts.loop} min. Ctrl+C to stop.`);
  let lastKey = null;
  for (;;) {
    const r = await watchOnce({ ...opts, lastKey });
    lastKey = r.key;
    console.log(`[${new Date().toLocaleTimeString()}] ${r.text}`);
    await new Promise((res) => setTimeout(res, every));
  }
}
