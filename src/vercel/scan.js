// Vercel taraması: önce ham bilgileri toplar (collectTeam), sonra panel kartına çevirir (teamCard).
// Bekçi (watch) aynı ham bilgileri kullanır.
import { parseJson } from "../run.js";
import { vc, api, mapLimit, whoami, listTeams, listProjects } from "./cli.js";
import { classify, GENERAL_LIMIT, WRITE_LIMIT } from "./rules.js";
import { teamTraffic } from "./traffic.js";

const money = (n) => `${(Math.round(n * 100) / 100).toLocaleString("tr-TR")} $`;
const moneyEn = (n) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US")}`;
const num = (n, l) => Math.round(n).toLocaleString(l === "tr" ? "tr-TR" : "en-US");
const day = (iso, l) => new Date(iso).toLocaleDateString(l === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
const names = (list, max = 5) => `${list.slice(0, max).map((p) => p.name).join(", ")}${list.length > max ? "…" : ""}`;

/** Bir takımın ham durumu. Hiçbir şeyi değiştirmez. */
export async function collectTeam(team, { thresholds } = {}) {
  const scope = ["--scope", team.slug];
  const [budgetRes, usageRes, dailyRes, rawProjects, traffic] = await Promise.all([
    vc(["billing", "budgets", "inspect", "--json", ...scope]),
    vc(["billing", "usage", "--json", ...scope]),
    vc(["billing", "usage", "--json", "--breakdown", "daily", "--since", "14d", ...scope]),
    listProjects(team.id),
    teamTraffic(team.slug, thresholds).catch(() => null),
  ]);
  const budgetData = parseJson(budgetRes.stdout);
  const budget = budgetData?.budget ?? null;
  const now = Date.now();

  const projects = await mapLimit(rawProjects, 6, async (p) => {
    const fw = await api(`/v1/security/firewall/config/active?projectId=${p.id}&teamId=${team.id}`);
    const sec = p.security ?? {};
    const until = sec.attackModeActiveUntil ?? null;
    return {
      id: p.id,
      name: p.name,
      domain: p.targets?.production?.alias?.[0] ?? null,
      paused: !!p.paused,
      attack: !!sec.attackModeEnabled && (until === null || until > now),
      attackUntil: until,
      previewsOpen: !p.ssoProtection && !p.passwordProtection,
      limits: classify(fw.json),
    };
  });

  return {
    team: { id: team.id, slug: team.slug, name: team.name },
    projects,
    budgetReadable: !!budgetData,
    budget,
    pauseOn: !!budget?.thresholds?.some((t) => t.percent >= 100 && t.pauseUsage),
    overage: budgetData?.spend?.currentSpend ?? 0,
    usage: parseJson(usageRes.stdout),
    daily: parseJson(dailyRes.stdout),
    traffic,
  };
}

function drillNote(d) {
  if (!d) return null;
  const when = { tr: day(d.at, "tr"), en: day(d.at, "en") };
  if (!d.ok) return { ok: false, tr: `Denendi ama çalışmadı (${d.project}, ${when.tr}): ${d.note?.tr ?? ""}`, en: `Tested but it did not work (${d.project}, ${when.en}): ${d.note?.en ?? ""}` };
  if (d.passed !== undefined)
    return { ok: true, tr: `${d.project} sitesinde denendi (${when.tr}): ${d.passed} istek geçti, sonrakiler durduruldu.`, en: `Tested on ${d.project} (${when.en}): ${d.passed} requests passed, the rest were blocked.` };
  return { ok: true, tr: `${d.project} sitesinde denendi (${when.tr}): ${d.onSec} saniyede devreye girdi, ${d.offSec} saniyede kalktı.`, en: `Tested on ${d.project} (${when.en}): on in ${d.onSec}s, off in ${d.offSec}s.` };
}

const join = (a, b) => (b ? { tr: `${a.tr} ${b.tr}`, en: `${a.en} ${b.en}` } : a);

/** Ham durumu panel kartına çevirir. `drills`: bu takımın kayıtlı tatbikat sonuçları. */
export function teamCard(f, { linkedProjectId = null, drills = {} } = {}) {
  const { team, projects, budget, pauseOn, overage, traffic } = f;
  const suggested = Math.max(10, Math.ceil(overage * 2));
  const tooHigh = !!budget && budget.amount > suggested * 5 && budget.amount > 50;
  const base = { team: team.slug, teamId: team.id };
  const pick = (list) => list.map((p) => ({ id: p.id, name: p.name }));
  const checks = [];

  // Tatbikat için varsayılan site: bu klasöre bağlı proje, yoksa en az ziyaret alan
  const quietFirst = (list) => [...list].sort((a, b) => (traffic?.perProject?.[a.name]?.h24 ?? 0) - (traffic?.perProject?.[b.name]?.h24 ?? 0));
  const drillable = (list) => {
    const ok = quietFirst(list.filter((p) => p.domain && !p.paused));
    return { projects: ok.map((p) => ({ id: p.id, name: p.name, domain: p.domain })), defaultProject: ok.find((p) => p.id === linkedProjectId)?.id ?? ok[0]?.id ?? null };
  };

  // 1) Aylık harcama sınırı
  if (!f.budgetReadable) {
    checks.push({
      id: "vercel.budget",
      status: "unk",
      detail: { tr: "Okunamadı. Bu takımda Owner ya da Billing yetkin olmayabilir, ya da plan Hobby olabilir (Hobby'de ek ücret çıkmaz).", en: "Could not read it. You may lack the Owner/Billing role, or the plan may be Hobby (Hobby has no overage charges)." },
      link: `https://vercel.com/${team.slug}/~/settings/billing`,
    });
  } else if (!budget) {
    checks.push({
      id: "vercel.budget",
      status: "bad",
      detail: { tr: "Hiç sınır yok. Faturanın üst sınırı yok.", en: "No limit at all. Your bill has no ceiling." },
      fix: { kind: "fix", id: "vercel.setBudget", ...base, amount: suggested, label: "fix", plan: { tr: [`Aylık ${suggested} $'lık bir harcama sınırı koyacağım.`, "Sınıra gelince bütün sitelerin geçici olarak duracak."], en: [`I will set a ${suggested} USD monthly spending limit.`, "All your sites will pause when you hit it."] } },
    });
  } else {
    checks.push({
      id: "vercel.budget",
      status: tooHigh ? "warn" : "on",
      detail: tooHigh
        ? { tr: `${budget.amount} $ sınır var. Bu ay ek ödemen ${money(overage)}; sınır gereğinden yüksek.`, en: `Limit is ${moneyEn(budget.amount)}. Your extra spend this month is ${moneyEn(overage)}; the limit is higher than needed.` }
        : { tr: `${budget.amount} $ sınır var. Bu ay ek ödemen ${money(overage)}.`, en: `Limit is ${moneyEn(budget.amount)}. Your extra spend this month is ${moneyEn(overage)}.` },
      fix: tooHigh
        ? { kind: "fix", id: "vercel.setBudget", ...base, amount: suggested, label: "lower", plan: { tr: [`Aylık sınırı ${budget.amount} $'dan ${suggested} $'a indireceğim.`, "Normal kullanımın etkilenmez."], en: [`I will lower the monthly limit from ${budget.amount} to ${suggested} USD.`, "Your normal usage is not affected."] } }
        : undefined,
    });
  }

  // 2) Sınıra gelince durdur
  if (budget) {
    checks.push({
      id: "vercel.pause",
      status: pauseOn ? "on" : "bad",
      detail: pauseOn
        ? { tr: "Açık. Sınıra gelince Vercel bütün sitelerini durdurur.", en: "On. Vercel pauses all your sites at the limit." }
        : { tr: "Kapalı. Sınıra gelince sadece e-posta geliyor, fatura büyümeye devam ediyor.", en: "Off. At the limit you only get an email; the bill keeps growing." },
      worst: pauseOn ? { tr: `En kötü durumda Vercel'e ek ödemen: yaklaşık ${budget.amount} $ + birkaç dakikalık harcama.`, en: `Worst case extra you pay Vercel: about ${moneyEn(budget.amount)} + a few minutes of spend.` } : undefined,
      fix: pauseOn
        ? undefined
        : { kind: "fix", id: "vercel.pause", ...base, label: "fix", plan: { tr: ["Sınıra gelince bütün sitelerin geçici olarak kapanacak.", 'Ziyaretçiler "site geçici olarak kapalı" görecek.', "Siteleri sen tekrar açana kadar kapalı kalırlar."], en: ["All your sites will pause when you hit the limit.", 'Visitors will see "site temporarily unavailable".', "They stay paused until you resume them."] } },
    });
  }

  // 3) Aşırı ziyaret engeli (1. kademe)
  const noGeneral = projects.filter((p) => !p.limits.general);
  const gNote = drillNote(drills.ratelimit);
  checks.push({
    id: "vercel.ratelimit",
    status: noGeneral.length ? "bad" : gNote ? (gNote.ok ? "tested" : "bad") : "on",
    detail: noGeneral.length
      ? { tr: `${projects.length} sitenin ${noGeneral.length} tanesinde yok: ${names(noGeneral)}`, en: `Missing on ${noGeneral.length} of ${projects.length} sites: ${names(noGeneral)}` }
      : join({ tr: `${projects.length} sitenin hepsinde var.`, en: `Present on all ${projects.length} sites.` }, gNote),
    fix: noGeneral.length
      ? { kind: "fix", id: "vercel.ratelimit", ...base, projects: pick(noGeneral), selectable: true, label: "fix", plan: { tr: [`Seçtiğin sitelere "aynı bilgisayar dakikada ${GENERAL_LIMIT}'den fazla istek atarsa durdur" kuralı ekleyeceğim.`, "Sitenin kendi dosyaları (/_next/static) bu sayıma girmez; normal ziyaretçiler etkilenmez.", "Vercel bu kural için izin verilen 1 milyon istek başına 0,50 $ alır."], en: [`I will add a "block one computer sending over ${GENERAL_LIMIT} requests a minute" rule to the sites you pick.`, "Static files (/_next/static) don't count; normal visitors are not affected.", "Vercel charges $0.50 per 1M allowed requests for this rule."] } }
      : undefined,
    drill: { kind: "drill", type: "ratelimit", ...base, ...drillable(projects.filter((p) => p.limits.general)), plan: { tr: [`Seçtiğin siteye kendi bilgisayarından art arda yaklaşık ${GENERAL_LIMIT + 50} istek atacağım.`, `Sınır çalışıyorsa ${GENERAL_LIMIT}. istekten sonra "çok fazla istek" cevabı gelmeli.`, "Maliyeti 1 sentin altında. Senin bağlantın o siteye 1 dakika kadar engelli kalır."], en: [`I will send about ${GENERAL_LIMIT + 50} requests in a row from your computer to the site you pick.`, `If the limit works, requests after number ${GENERAL_LIMIT} get "too many requests".`, "It costs less than a cent. Your own connection stays blocked on that site for up to a minute."] } },
  });

  // 4) Yazma isteği sınırı (2. kademe)
  const noWrite = projects.filter((p) => !p.limits.write);
  const wNote = drillNote(drills.writelimit);
  checks.push({
    id: "vercel.writelimit",
    status: noWrite.length ? "warn" : wNote ? (wNote.ok ? "tested" : "bad") : "on",
    detail: noWrite.length
      ? { tr: `${projects.length} sitenin ${noWrite.length} tanesinde yok: ${names(noWrite)}`, en: `Missing on ${noWrite.length} of ${projects.length} sites: ${names(noWrite)}` }
      : join({ tr: `${projects.length} sitenin hepsinde var.`, en: `Present on all ${projects.length} sites.` }, wNote),
    fix: noWrite.length
      ? { kind: "fix", id: "vercel.writelimit", ...base, projects: pick(noWrite), selectable: true, label: "fix", plan: { tr: [`Seçtiğin sitelere "aynı bilgisayar dakikada ${WRITE_LIMIT}'den fazla veri gönderemez" kuralı ekleyeceğim (form, yapay zekâ çağrısı, ödeme gibi işlemler).`, 'Adresinde "webhook" geçen yollar bu sınırın dışında kalır.', "Dikkat: Aynı ofisten çok kişinin yoğun kullandığı bir panel varsa onu listeden çıkar."], en: [`I will add a "one computer can't send data more than ${WRITE_LIMIT} times a minute" rule to the sites you pick (forms, AI calls, payments).`, 'Paths containing "webhook" are excluded.', "Careful: untick any internal tool that many people use heavily from one office."] } }
      : undefined,
    drill: { kind: "drill", type: "writelimit", ...base, ...drillable(projects.filter((p) => p.limits.write)), plan: { tr: [`Seçtiğin siteye art arda yaklaşık ${WRITE_LIMIT + 30} veri gönderme isteği atacağım (boş, zararsız istekler).`, `Sınır çalışıyorsa ${WRITE_LIMIT}. istekten sonrakiler durdurulmalı.`, "Maliyeti 1 sentin altında."], en: [`I will send about ${WRITE_LIMIT + 30} empty, harmless write requests to the site you pick.`, `If the limit works, requests after number ${WRITE_LIMIT} are blocked.`, "It costs less than a cent."] } },
  });

  // 5) Deneme sayfalarının gizliliği
  const open = projects.filter((p) => p.previewsOpen);
  checks.push({
    id: "vercel.previews",
    status: open.length ? "warn" : "on",
    detail: open.length
      ? { tr: `${open.length} sitenin deneme sayfaları herkese açık: ${names(open, 8)}`, en: `${open.length} sites have public test pages: ${names(open, 8)}` }
      : { tr: "Bütün sitelerin deneme sayfaları gizli.", en: "All test pages are private." },
    fix: open.length
      ? { kind: "fix", id: "vercel.previews", ...base, projects: pick(open), selectable: true, label: "fix", plan: { tr: ["Seçtiğin sitelerin deneme sayfalarını sadece Vercel hesabıyla giriş yapanların görebileceği hâle getireceğim.", "Canlı siten etkilenmez."], en: ["I will make the test pages of the sites you pick visible only to logged-in Vercel members.", "Your live site is not affected."] } }
      : undefined,
  });

  // 6) Trafik normal mi?
  if (!traffic) {
    checks.push({ id: "vercel.traffic", status: "unk", detail: { tr: "Trafik verisi okunamadı.", en: "Could not read traffic data." } });
  } else if (traffic.spikes.length) {
    const s = traffic.spikes[0];
    checks.push({
      id: "vercel.traffic",
      status: "bad",
      label: { tr: "Anormal artış", en: "Unusual spike" },
      detail: { tr: `${s.name}: son 10 dakikada ${num(s.last10, "tr")} istek, normalinin yaklaşık ${num(s.times, "tr")} katı.${traffic.spikes.length > 1 ? ` (+${traffic.spikes.length - 1} site daha)` : ""}`, en: `${s.name}: ${num(s.last10, "en")} requests in the last 10 minutes, about ${num(s.times, "en")}× its normal.${traffic.spikes.length > 1 ? ` (+${traffic.spikes.length - 1} more)` : ""}` },
      advice: { tr: "Gerçek bir ilgi patlaması değilse yukarıdaki \"Saldırı modunu aç\" düğmesini kullan.", en: 'If this is not real interest, use "Turn on attack mode" above.' },
    });
  } else {
    checks.push({ id: "vercel.traffic", status: "clean", label: { tr: "Normal", en: "Normal" }, detail: { tr: `Son 1 saatte ${num(traffic.last60, "tr")} istek. Hiçbir sitede ani artış yok.`, en: `${num(traffic.last60, "en")} requests in the last hour. No sudden spike on any site.` } });
  }

  // 7-8) Acil frenler: hazır mı, denendi mi?
  const brake = (id, type, ready, plan) => {
    const note = drillNote(drills[type]);
    checks.push({ id, status: note ? (note.ok ? "tested" : "bad") : "ready", label: note ? undefined : { tr: "Hazır, denenmedi", en: "Ready, untested" }, detail: join(ready, note), drill: { kind: "drill", type, ...base, ...drillable(projects), plan } });
  };
  brake("vercel.brake.attack", "attack", { tr: "Saldırı anında tek tıkla açılır: herkese kısa bir doğrulama çıkar, botların çoğu geçemez.", en: "One click during an attack: everyone gets a short check, most bots fail it." }, { tr: ["Seçtiğin sitede saldırı modunu açacağım, doğrulamanın devreye girdiğini kontrol edip hemen kapatacağım.", "Yaklaşık 30 saniye sürer. Bu sırada gelen ziyaretçiler kısa bir doğrulama görür.", "Güvenlik ağı: yarıda kalırsa saldırı modu 10 dakika sonra kendiliğinden kapanır."], en: ["I will turn attack mode on for the site you pick, check that the challenge kicks in, and turn it off right away.", "Takes about 30 seconds. Visitors during that time see a short check.", "Safety net: if interrupted, attack mode turns itself off after 10 minutes."] });
  brake("vercel.brake.pause", "pause", { tr: "Son çare: siteyi tamamen kapatır. Kapalı site para harcamaz.", en: "Last resort: switches the site off completely. A paused site costs nothing." }, { tr: ["Seçtiğin siteyi durduracağım, kapandığını kontrol edip hemen geri açacağım.", "Site yaklaşık 20-30 saniye kapalı kalır.", 'Yarıda kalırsa site kapalı kalır; bu panelden "Normale dön" ile açabilirsin.'], en: ["I will pause the site you pick, check that it is off, and resume it right away.", "The site is down for about 20-30 seconds.", 'If interrupted the site stays paused; use "Back to normal" in this panel.'] });

  // Acil durum çubuğu
  const inAttack = projects.filter((p) => p.attack);
  const paused = projects.filter((p) => p.paused);
  const emergency = {
    state: { attack: inAttack.map((p) => p.name), paused: paused.map((p) => p.name) },
    actions: [
      { kind: "panic", type: "attack", ...base, projects: pick(projects.filter((p) => !p.attack && !p.paused)), selectable: true, label: { tr: "Saldırı modunu aç", en: "Turn on attack mode" }, plan: { tr: ["Seçtiğin sitelerde 1 saatliğine saldırı modunu açacağım.", "Gerçek ziyaretçiler kısa bir otomatik doğrulamadan geçer; botların çoğu geçemez.", "Dikkat: Sitene bağlanan başka programlar (webhook, API, RSS okuyucu) da engellenir.", '1 saat sonra kendiliğinden kapanır. Erken kapatmak için "Normale dön".'], en: ["I will turn attack mode on for 1 hour on the sites you pick.", "Real visitors pass a short automatic check; most bots don't.", "Careful: other programs calling your site (webhooks, APIs, RSS readers) are blocked too.", 'It turns itself off after 1 hour. Use "Back to normal" to end it sooner.'] } },
      { kind: "panic", type: "pause", ...base, projects: pick(projects.filter((p) => !p.paused)), selectable: true, danger: true, label: { tr: "Siteleri durdur", en: "Pause sites" }, plan: { tr: ['Seçtiğin siteleri tamamen durduracağım. Ziyaretçiler "site geçici olarak kapalı" görür.', "Durdurulan site para harcamaz.", 'Sen "Normale dön" diyene kadar kapalı kalırlar.'], en: ['I will pause the sites you pick completely. Visitors see "site temporarily unavailable".', "A paused site costs nothing.", 'They stay off until you choose "Back to normal".'] } },
      ...(inAttack.length || paused.length
        ? [{ kind: "panic", type: "resume", ...base, attack: inAttack.map((p) => p.id), paused: paused.map((p) => p.id), projects: pick([...new Map([...inAttack, ...paused].map((p) => [p.id, p])).values()]), selectable: true, primary: true, label: { tr: "Normale dön", en: "Back to normal" }, plan: { tr: ["Seçtiğin sitelerde saldırı modunu kapatacağım ve durdurulan siteleri yeniden açacağım."], en: ["I will turn attack mode off and resume paused sites for the ones you pick."] } }]
        : []),
    ],
  };

  // Harcama şeridi
  let stats;
  if (f.usage?.creditBalance) {
    const cb = f.usage.creditBalance;
    const top = (f.usage.services ?? []).filter((s) => s.category === "usage" && s.cost > 0.01).sort((a, b) => b.cost - a.cost).slice(0, 3);
    stats = {
      items: [
        { tr: "Bu ay kullanım", en: "Usage this month", v: { tr: money(cb.used), en: moneyEn(cb.used) } },
        { tr: "Ek ödeme", en: "Extra charges", v: { tr: money(overage), en: moneyEn(overage) } },
        budget && !tooHigh ? { tr: "Harcama sınırın", en: "Your limit", v: { tr: `${budget.amount} $`, en: `$${budget.amount}` } } : { tr: "Önerilen sınır", en: "Suggested limit", v: { tr: `${suggested} $`, en: `$${suggested}` } },
      ],
      bars: (f.daily?.breakdown?.data ?? []).map((d) => (d.services ?? []).filter((s) => s.category === "usage").reduce((n, s) => n + s.cost, 0)),
      barsLabel: { tr: "Son 14 gün, günlük harcama", en: "Last 14 days, daily spend" },
      note: { tr: `Pro paketindeki aylık ${cb.allocated} $ kredinin ${money(cb.used)} kadarı kullanıldı. En çok harcayan: ${top.map((s) => `${s.name} (${money(s.cost)})`).join(", ") || "—"}.`, en: `${moneyEn(cb.used)} of the ${moneyEn(cb.allocated)} monthly Pro credit used. Top costs: ${top.map((s) => `${s.name} (${moneyEn(s.cost)})`).join(", ") || "—"}.` },
    };
  }

  // Trafik şeridi
  const trafficStrip = traffic && {
    items: [
      { tr: "Son 24 saat", en: "Last 24 hours", v: { tr: `${num(traffic.total24, "tr")} istek`, en: `${num(traffic.total24, "en")} requests` } },
      { tr: "Firewall durdurdu", en: "Firewall stopped", v: { tr: num(traffic.blocked, "tr"), en: num(traffic.blocked, "en") } },
      { tr: "Son 1 saat", en: "Last hour", v: { tr: num(traffic.last60, "tr"), en: num(traffic.last60, "en") } },
    ],
    bars: traffic.hourly,
    barsLabel: { tr: "Son 24 saat, saatlik istek", en: "Last 24 hours, requests per hour" },
    note: { tr: `En çok ziyaret alan: ${traffic.top.map((t) => `${t.name} (${num(t.h24, "tr")})`).join(", ") || "—"}.`, en: `Busiest: ${traffic.top.map((t) => `${t.name} (${num(t.h24, "en")})`).join(", ") || "—"}.` },
  };

  return {
    id: `vercel:${team.slug}`,
    name: `Vercel · ${team.name}`,
    sub: { tr: `Siteni internette yayınlayan servis · ${projects.length} proje`, en: `The service that hosts your site · ${projects.length} projects` },
    stats,
    traffic: trafficStrip,
    emergency,
    checks,
  };
}

/** Giriş yapılmamışsa gösterilecek kart. */
export const loginCard = () => ({
  id: "vercel",
  name: "Vercel",
  sub: { tr: "Siteni internette yayınlayan servis", en: "The service that hosts your site" },
  checks: [{ id: "vercel.login", status: "unk", title: { tr: "Vercel'e giriş yapılmamış", en: "Not logged in to Vercel" }, detail: { tr: "Terminalde `vercel login` yazıp giriş yap, sonra bu sayfada \"Yeniden tara\"ya bas.", en: 'Run `vercel login` in your terminal, then press "Scan again" here.' } }],
});

export async function scanVercel({ linkedProjectId, drills = {} } = {}) {
  if (!(await whoami())) return [loginCard()];
  const teams = await listTeams();
  const cards = [];
  for (const team of teams) cards.push(teamCard(await collectTeam(team), { linkedProjectId, drills: drills[team.id] ?? {} }));
  return cards;
}
