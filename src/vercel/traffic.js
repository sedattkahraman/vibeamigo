// Canlı trafik: Vercel'in gözlem verisinden proje başına istek sayıları ve firewall hareketleri.
// Ölçüm (Kasım 2026): bir istek bu veride yaklaşık 30 saniye içinde görünüyor.
import { vc } from "./cli.js";
import { parseJson } from "../run.js";

const value = (row) => Number(Object.entries(row).find(([k]) => k.startsWith("vercel_"))?.[1] ?? 0);

async function metric(id, scope, extra) {
  const r = await vc(["metrics", id, "--all", "--scope", scope, "--json", ...extra]);
  return r.ok ? parseJson(r.stdout) : null;
}

/**
 * Ani artış tespiti. Saf fonksiyon.
 * Bir proje, son 10 dakikada hem mutlak eşiği (`minAbs`) hem de kendi 24 saatlik ortalamasının
 * `factor` katını aşarsa "ani artış" sayılır. İki koşul birlikte: küçük sitelerde gürültü, büyük
 * sitelerde normal yoğunluk alarm üretmesin.
 */
export function findSpikes(perProject, { minAbs = 2000, factor = 10 } = {}) {
  const spikes = [];
  for (const [name, p] of Object.entries(perProject)) {
    const baseline10 = Math.max((p.h24 - p.last60) / (23 * 6), 0);
    if (p.last10 >= minAbs && p.last10 >= factor * Math.max(baseline10, 1)) {
      spikes.push({ name, last10: p.last10, baseline10: Math.round(baseline10 * 10) / 10, times: Math.round(p.last10 / Math.max(baseline10, 1)) });
    }
  }
  return spikes.sort((a, b) => b.last10 - a.last10);
}

/** Takımın son 24 saatlik trafiği. Veri okunamazsa null. */
export async function teamTraffic(teamSlug, thresholds) {
  const [day, hour, fw] = await Promise.all([
    metric("vercel.request.count", teamSlug, ["--since", "24h", "--granularity", "1h", "--group-by", "projectName", "-n", "200"]),
    metric("vercel.request.count", teamSlug, ["--since", "1h", "--granularity", "5m", "--group-by", "projectName", "-n", "200"]),
    metric("vercel.firewall_action.count", teamSlug, ["--since", "24h", "--granularity", "1h", "--group-by", "wafAction"]),
  ]);
  if (!day?.data || !hour?.data) return null;

  const perProject = {};
  const slot = (name) => (perProject[name] ??= { h24: 0, last60: 0, last10: 0 });
  const hourly = new Map();
  for (const row of day.data) {
    if (!row.projectName) continue;
    slot(row.projectName).h24 += value(row);
    hourly.set(row.timestamp, (hourly.get(row.timestamp) ?? 0) + value(row));
  }
  const buckets = [...new Set(hour.data.map((r) => r.timestamp))].sort();
  const recent = new Set(buckets.slice(-2)); // son iki 5 dakikalık dilim ≈ son 10 dakika
  for (const row of hour.data) {
    if (!row.projectName) continue;
    slot(row.projectName).last60 += value(row);
    if (recent.has(row.timestamp)) slot(row.projectName).last10 += value(row);
  }

  const firewall = {};
  for (const row of fw?.summary ?? []) if (row.wafAction) firewall[row.wafAction] = value(row);
  const blocked = Object.entries(firewall).filter(([k]) => k !== "allow").reduce((n, [, v]) => n + v, 0);

  return {
    total24: Object.values(perProject).reduce((n, p) => n + p.h24, 0),
    last60: Object.values(perProject).reduce((n, p) => n + p.last60, 0),
    hourly: [...hourly.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v),
    top: Object.entries(perProject).sort(([, a], [, b]) => b.h24 - a.h24).slice(0, 3).map(([name, p]) => ({ name, h24: p.h24 })),
    firewall,
    blocked,
    perProject,
    spikes: findSpikes(perProject, thresholds),
  };
}
