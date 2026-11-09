// Ağ çağrısı yapmayan mantık testleri: `npm test`
import test from "node:test";
import assert from "node:assert/strict";
import { generalRule, writeRule, isGeneralLimit, isWriteLimit, classify, GENERAL_LIMIT, WRITE_LIMIT } from "../src/vercel/rules.js";
import { findSpikes } from "../src/vercel/traffic.js";
import { teamCard } from "../src/vercel/scan.js";
import { evaluate } from "../src/watch.js";
import { findSecrets, findUncappedAiCalls, countAiCalls, riskyPublicEnv } from "../src/checks/code.js";
import { parseJson } from "../src/run.js";

const rl = (conditions, limit = 60) => ({ name: "x", active: true, conditionGroup: [{ conditions }], action: { mitigate: { action: "rate_limit", rateLimit: { limit, window: 60, keys: ["ip"] } } } });

test("kural tanıma: genel sınır", () => {
  assert.equal(isGeneralLimit(generalRule()), true);
  assert.equal(isGeneralLimit(rl([])), true, "koşulsuz kural her şeyi kapsar");
  assert.equal(isGeneralLimit(rl([{ type: "path", op: "pre", value: "/s/" }])), false, "tek bir yola daraltılmış kural genel sayılmaz");
  assert.equal(isGeneralLimit(writeRule()), false);
  assert.equal(isGeneralLimit({ ...generalRule(), active: false }), false, "kapalı kural sayılmaz");
  assert.equal(isGeneralLimit({ name: "deny", action: { mitigate: { action: "deny" } }, conditionGroup: [] }), false);
});

test("kural tanıma: yazma sınırı", () => {
  assert.equal(isWriteLimit(writeRule()), true);
  assert.equal(isWriteLimit(rl([{ type: "method", op: "eq", value: "POST" }])), true);
  assert.equal(isWriteLimit(rl([{ type: "method", op: "eq", value: "GET" }])), false);
  assert.equal(isWriteLimit(rl([{ type: "method", op: "eq", value: "POST" }, { type: "path", op: "pre", value: "/api/chat" }])), false, "tek yola daraltılmış kural bütün siteyi korumaz");
  assert.equal(isWriteLimit(generalRule()), false);
});

test("classify: firewall ayarından sınırları çıkarır", () => {
  assert.deepEqual(classify(null), { general: null, write: null });
  assert.deepEqual(classify({ firewallEnabled: false, rules: [generalRule()] }), { general: null, write: null });
  const c = classify({ firewallEnabled: true, rules: [rl([{ type: "path", op: "pre", value: "/s/" }]), generalRule(), writeRule()] });
  assert.equal(c.general.limit, GENERAL_LIMIT);
  assert.equal(c.write.limit, WRITE_LIMIT);
});

test("ani artış: iki koşul birlikte aranır", () => {
  const quiet = { h24: 200, last60: 10, last10: 3 };
  assert.deepEqual(findSpikes({ a: quiet }), []);
  assert.equal(findSpikes({ a: { h24: 5000, last60: 5000, last10: 4000 } })[0].name, "a", "sıfırdan patlama");
  assert.deepEqual(findSpikes({ busy: { h24: 400_000, last60: 17_000, last10: 3000 } }), [], "her zaman yoğun site alarm vermez");
  assert.deepEqual(findSpikes({ small: { h24: 300, last60: 300, last10: 250 } }), [], "mutlak eşiğin altı gürültüdür");
  assert.equal(findSpikes({ small: { h24: 300, last60: 300, last10: 250 } }, { minAbs: 100, factor: 5 }).length, 1, "eşikler ayarlanabilir");
});

const project = (o = {}) => ({ id: "p1", name: "site", domain: "site.example", paused: false, attack: false, previewsOpen: false, limits: { general: { limit: 600 }, write: { limit: 100 } }, ...o });
const facts = (o = {}) => ({ team: { id: "t1", slug: "team", name: "Team" }, projects: [project()], budgetReadable: true, budget: { amount: 5, thresholds: [{ percent: 100, pauseUsage: true }] }, pauseOn: true, overage: 0, usage: null, daily: null, traffic: { total24: 10, last60: 1, hourly: [1], top: [], firewall: {}, blocked: 0, perProject: {}, spikes: [] }, ...o });
const status = (card, id) => card.checks.find((c) => c.id === id)?.status;

test("panel kartı: açık ayar 'Açık'tır, 'Denendi' sadece tatbikattan sonra gelir", () => {
  const card = teamCard(facts());
  assert.equal(status(card, "vercel.pause"), "on");
  assert.equal(status(card, "vercel.ratelimit"), "on");
  assert.equal(status(card, "vercel.brake.attack"), "ready");
  assert.ok(!card.checks.some((c) => c.status === "ok"), "hiçbir satır 'Güvende' demez");

  const drilled = teamCard(facts(), { drills: { ratelimit: { ok: true, project: "site", passed: 600, at: "2026-11-09T00:00:00Z" }, attack: { ok: true, project: "site", onSec: 2, offSec: 10, at: "2026-11-09T00:00:00Z" } } });
  assert.equal(status(drilled, "vercel.ratelimit"), "tested");
  assert.equal(status(drilled, "vercel.brake.attack"), "tested");
  assert.equal(status(drilled, "vercel.pause"), "on", "harcama sınırı durdurması denenemez, 'Açık' kalır");

  const failed = teamCard(facts(), { drills: { ratelimit: { ok: false, project: "site", note: { tr: "x", en: "x" }, at: "2026-11-09T00:00:00Z" } } });
  assert.equal(status(failed, "vercel.ratelimit"), "bad", "başarısız tatbikat riski gösterir");
});

test("panel kartı: eksikler ve acil durum", () => {
  const card = teamCard(facts({ budget: null, pauseOn: false, projects: [project({ limits: { general: null, write: null }, previewsOpen: true })] }));
  assert.equal(status(card, "vercel.budget"), "bad");
  assert.equal(status(card, "vercel.ratelimit"), "bad");
  assert.equal(status(card, "vercel.writelimit"), "warn");
  assert.equal(status(card, "vercel.previews"), "warn");
  assert.equal(card.checks.find((c) => c.id === "vercel.ratelimit").drill.projects.length, 0, "kuralı olmayan sitede tatbikat önerilmez");

  const live = teamCard(facts({ projects: [project({ paused: true }), project({ id: "p2", name: "b", attack: true })] }));
  assert.deepEqual(live.emergency.state, { attack: ["b"], paused: ["site"] });
  const resume = live.emergency.actions.find((a) => a.type === "resume");
  assert.deepEqual(resume.paused, ["p1"]);
  assert.deepEqual(resume.attack, ["p2"]);
  assert.ok(!teamCard(facts()).emergency.actions.some((a) => a.type === "resume"), "normal durumda 'Normale dön' görünmez");
});

test("bekçi: alarm kuralları", () => {
  const codes = (f) => evaluate(f).map((x) => `${x.level}:${x.code}`);
  assert.deepEqual(codes(facts()), []);
  assert.deepEqual(codes(facts({ budget: null, pauseOn: false })), ["alert:no-budget"]);
  assert.deepEqual(codes(facts({ pauseOn: false })), ["alert:pause-off"]);
  assert.deepEqual(codes(facts({ overage: 4.5 })), ["alert:budget-80"]);
  assert.deepEqual(codes(facts({ overage: 2.6 })), ["warn:budget-50"]);
  assert.deepEqual(codes(facts({ projects: [project({ limits: { general: null, write: null } })] })), ["warn:no-ratelimit"]);
  assert.deepEqual(codes(facts({ projects: [project({ paused: true })] })), ["alert:paused"]);
  assert.deepEqual(codes(facts({ traffic: null })), ["error:no-traffic"]);
  const spike = evaluate(facts({ traffic: { spikes: [{ name: "site", last10: 9000, times: 300 }] } }))[0];
  assert.equal(spike.code, "spike");
  assert.equal(spike.project, "p1");
  assert.equal(spike.braked, false);
  assert.equal(evaluate(facts({ projects: [project({ attack: true })], traffic: { spikes: [{ name: "site", last10: 9000, times: 300 }] } })).find((x) => x.code === "spike").braked, true, "zaten frenlenmiş siteye tekrar fren çekilmez");
});

test("kod taraması: gizli anahtarlar", () => {
  const key = (prefix, n, ch = "a") => prefix + ch.repeat(n);
  assert.equal(findSecrets(`const k = "${key("sk-proj-", 40)}"`)[0].type, "OpenAI");
  assert.equal(findSecrets(`x=${key("sk-ant-", 40)}`).some((h) => h.type === "Anthropic"), true);
  assert.equal(findSecrets(key("AIza", 35, "B"))[0].type, "Google / Gemini");
  assert.equal(findSecrets(key("sb_secret_", 24))[0].type, "Supabase (secret)");
  assert.deepEqual(findSecrets(key("sb_publishable_", 24)), [], "tarayıcıda durması normal olan anahtar sızıntı sayılmaz");
  assert.deepEqual(findSecrets(key("pk_live_", 24)), []);
  const jwt = (role) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role, iss: "supabase", ref: "abcdefghijklmnop" })).toString("base64url"), "c".repeat(30)].join(".");
  assert.equal(findSecrets(jwt("service_role"))[0].type, "Supabase service_role");
  assert.deepEqual(findSecrets(jwt("anon")), [], "anon anahtarı gizli değildir");
});

test("kod taraması: sınırsız yapay zekâ çağrıları", () => {
  const capped = `await generateText({ model, prompt, maxOutputTokens: 500 })`;
  const open = `const r = await streamText({\n  model,\n  messages: convert(messages),\n})`;
  assert.equal(findUncappedAiCalls(capped).length, 0);
  assert.deepEqual(findUncappedAiCalls(`// hi\n${open}`), [{ line: 2 }]);
  assert.equal(findUncappedAiCalls(`openai.chat.completions.create({ model: "x", messages, max_tokens: 100 })`).length, 0);
  assert.equal(findUncappedAiCalls(`anthropic.messages.create({ model: "x", messages })`).length, 1);
  assert.equal(countAiCalls(`${capped}\n${open}`), 2);
  assert.equal(countAiCalls(`function generateTextile() {}`), 0);
});

test("kod taraması: tarayıcıya giden gizli anahtar adları", () => {
  assert.deepEqual(riskyPublicEnv(["NEXT_PUBLIC_OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "VITE_STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_RECAPTCHA_SITE_KEY"]), ["NEXT_PUBLIC_OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", "VITE_STRIPE_SECRET_KEY"]);
});

test("parseJson: CLI çıktısının başındaki uyarı satırlarını atlar", () => {
  assert.deepEqual(parseJson('Vercel CLI 54\n{"a":1}'), { a: 1 });
  assert.equal(parseJson("no json here"), null);
});
