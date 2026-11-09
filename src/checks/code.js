// Kod taraması: projede ve Git geçmişinde sızmış gizli anahtar, Git'e girmiş .env dosyası,
// gereğinden geniş görsel izni. Bulunan anahtarlar asla tam gösterilmez, hiçbir yere gönderilmez.
// Gitleaks kuruluysa onu da çalıştırır; değilse kendi kural listesiyle tarar.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { run, parseJson } from "../run.js";

// Sadece "gizli" (sunucuda kalması gereken) anahtar türleri. Tarayıcıda durması normal olan
// anahtarlar (Supabase anon/publishable, Stripe pk_) bilerek listede yok.
const PATTERNS = [
  { name: "OpenAI", re: /\bsk-(?:proj-|admin-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { name: "Anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{32,}/g },
  { name: "Google / Gemini", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Stripe (secret)", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/g },
  { name: "AWS", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "GitHub", re: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}/g },
  { name: "Supabase (secret)", re: /\bsb_secret_[A-Za-z0-9_-]{20,}/g },
  { name: "Twilio", re: /\bSK[0-9a-f]{32}\b/g },
  { name: "Vercel token", re: /\bvc[pk]_[A-Za-z0-9]{24,}/g },
  { name: "Private key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

// Supabase service_role anahtarı bir JWT; içindeki "role" alanına bakmadan ayırt edilemez.
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
function isServiceRoleJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

const mask = (s) => (s.length <= 10 ? "••••" : `${s.slice(0, 6)}…${s.slice(-3)}`);

export function findSecrets(text) {
  const hits = [];
  for (const p of PATTERNS) for (const m of text.matchAll(p.re)) hits.push({ type: p.name, value: m[0] });
  for (const m of text.matchAll(JWT)) if (isServiceRoleJwt(m[0])) hits.push({ type: "Supabase service_role", value: m[0] });
  return hits;
}

const SOURCE = /\.(m?[jt]sx?|vue|svelte|astro)$/;
const AI_CALL = /\b(?:generateText|streamText|generateObject|streamObject)\s*\(|\.(?:chat\.completions|responses|messages)\.create\s*\(|\.generate(?:Content)(?:Stream)?\s*\(/g; // (?:Content) ayrı yazıldı: araç kendi kaynağını taradığında bu satırı çağrı sanmasın
const AI_CAP = /maxOutputTokens|maxTokens|max_tokens|max_output_tokens|max_completion_tokens/;

export const countAiCalls = (text) => [...text.matchAll(AI_CALL)].length;

/** Cevap uzunluğu sınırı (maxOutputTokens vb.) verilmemiş yapay zekâ çağrılarını bulur. Tahmine dayalıdır. */
export function findUncappedAiCalls(text) {
  const out = [];
  for (const m of text.matchAll(AI_CALL)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const end = Math.min(text.length, i + 6000);
    for (; i < end && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    if (!AI_CAP.test(text.slice(m.index, i))) out.push({ line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

const RISKY_ENV = /OPENAI|ANTHROPIC|CLAUDE|GEMINI|GENERATIVE|ELEVENLABS|TWILIO_AUTH|RESEND|SENDGRID|SERVICE_ROLE|SECRET|PRIVATE_KEY|ADMIN_KEY/;
const SAFE_ENV = /PUBLISHABLE|ANON|SITE_KEY|PUBLIC_KEY|CLIENT_ID/;

/** Adı gizli anahtara benzeyen ama tarayıcıya gönderilen ortam değişkenleri. */
export const riskyPublicEnv = (names) => names.filter((n) => RISKY_ENV.test(n.replace(/^(NEXT_PUBLIC|VITE|EXPO_PUBLIC|PUBLIC)_/, "")) && !SAFE_ENV.test(n)).sort();

async function cronPaths(dir) {
  try {
    const cfg = JSON.parse(await readFile(path.join(dir, "vercel.json"), "utf8"));
    return (cfg.crons ?? []).map((c) => String(c.path).split("?")[0]).filter(Boolean);
  } catch {
    return [];
  }
}

const routeFiles = (p) => {
  const clean = p.replace(/^\/+|\/+$/g, "");
  return ["", "src/"].flatMap((pre) => [".ts", ".js", ".mjs", ".tsx"].flatMap((ext) => [`${pre}app/${clean}/route${ext}`, `${pre}pages/${clean}${ext}`, `${pre}pages/${clean}/index${ext}`]));
};

/** Bu klasör hangi Vercel projesine bağlı? (.vercel/project.json) */
export async function linkedProject(dir) {
  try {
    const j = JSON.parse(await readFile(path.join(dir, ".vercel", "project.json"), "utf8"));
    return { projectId: j.projectId ?? null, teamId: j.orgId ?? null };
  } catch {
    return { projectId: null, teamId: null };
  }
}

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|woff2?|ttf|otf|mp[34]|mov|webm|lock)$/i;

async function trackedFiles(dir) {
  const r = await run("git", ["ls-files", "-z"], { cwd: dir });
  return r.ok ? r.stdout.split("\0").filter(Boolean) : null;
}

export async function scanCode(dir) {
  const checks = [];
  const files = await trackedFiles(dir);
  const isRepo = files !== null;

  // 1) Şu anki dosyalarda sızmış anahtar
  const found = [];
  for (const f of files ?? []) {
    if (BINARY.test(f)) continue;
    try {
      const full = path.join(dir, f);
      if ((await stat(full)).size > 1_000_000) continue;
      for (const h of findSecrets(await readFile(full, "utf8"))) found.push({ ...h, where: f });
    } catch {}
  }

  // 2) Git geçmişinde sızmış anahtar (silinmiş olsa bile geçmişte durur)
  const history = [];
  if (isRepo) {
    const log = await run("git", ["log", "-p", "--all", "--no-color", "-U0", "--max-count=2000"], { cwd: dir, timeout: 120_000 });
    if (log.ok) {
      let commit = "";
      for (const line of log.stdout.split("\n")) {
        if (line.startsWith("commit ")) commit = line.slice(7, 14);
        else if (line.startsWith("+") && !line.startsWith("+++"))
          for (const h of findSecrets(line)) history.push({ ...h, where: `commit ${commit}` });
      }
    }
  }
  const currentValues = new Set(found.map((f) => f.value));
  const onlyInHistory = history.filter((h) => !currentValues.has(h.value));
  const uniq = (arr) => [...new Map(arr.map((x) => [x.value, x])).values()];
  const leaks = uniq([...found, ...onlyInHistory]);

  // Gitleaks kuruluysa ek kontrol olarak çalıştır (raporu sadece yerelde okur)
  const gl = await run("gitleaks", ["detect", "--source", dir, "--no-banner", "--redact", "--report-format", "json", "--report-path", "/dev/stdout", "--exit-code", "0"], { timeout: 180_000 });
  const gitleaksCount = gl.ok ? (parseJson(gl.stdout) ?? []).length : null;

  checks.push({
    id: "code.secrets",
    status: !isRepo ? "unk" : leaks.length ? "bad" : "clean",
    title: { tr: "Şifrelerin internete sızmış mı?", en: "Have your keys leaked?" },
    detail: !isRepo
      ? { tr: "Bu klasör bir Git deposu değil. Aracı projenin klasöründe çalıştır.", en: "This folder is not a Git repo. Run the tool inside your project folder." }
      : leaks.length
        ? {
            tr: `${leaks.length} gizli anahtar bulundu: ${leaks.slice(0, 4).map((l) => `${l.type} ${mask(l.value)} (${l.where})`).join("; ")}`,
            en: `${leaks.length} secret keys found: ${leaks.slice(0, 4).map((l) => `${l.type} ${mask(l.value)} (${l.where})`).join("; ")}`,
          }
        : {
            tr: `Kodunda ve Git geçmişinde açıkta anahtar bulunmadı.${gitleaksCount === null ? "" : ` Gitleaks: ${gitleaksCount} bulgu.`}`,
            en: `No exposed keys in your code or Git history.${gitleaksCount === null ? "" : ` Gitleaks: ${gitleaksCount} findings.`}`,
          },
    advice: leaks.length
      ? {
          tr: "Dosyadan silmek yetmez: anahtar Git geçmişinde ve büyük ihtimalle başkasının elinde. Önce servisin panelinden anahtarı iptal et ve yenisini oluştur. Yenisini .env dosyasına koy.",
          en: "Deleting the file is not enough: the key is in Git history and likely already copied. Revoke it in the provider's dashboard first, create a new one, and keep it in .env.",
        }
      : undefined,
  });

  // 3) .env dosyası Git'e girmiş mi?
  if (isRepo) {
    const envTracked = (files ?? []).filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.(example|sample|template)$/.test(f));
    checks.push({
      id: "code.env",
      status: envTracked.length ? "bad" : "clean",
      title: { tr: ".env dosyası gizli mi?", en: "Is your .env file private?" },
      detail: envTracked.length
        ? { tr: `Şu dosyalar Git'e girmiş: ${envTracked.join(", ")}`, en: `These files are in Git: ${envTracked.join(", ")}` }
        : { tr: ".env dosyaların Git'e girmemiş.", en: "Your .env files are not in Git." },
      advice: envTracked.length
        ? {
            tr: "Dosyayı .gitignore'a ekle ve `git rm --cached` ile Git'ten çıkar. İçindeki anahtarları yenile.",
            en: "Add it to .gitignore and remove it with `git rm --cached`. Rotate the keys inside.",
          }
        : undefined,
    });
  }

  // 4) Görsel izin listesi (Next.js images.remotePatterns)
  for (const name of ["next.config.ts", "next.config.mjs", "next.config.js"]) {
    let src;
    try {
      src = await readFile(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    const wide = /hostname\s*:\s*["'`]\*\*["'`]/.test(src) || /domains\s*:\s*\[[^\]]*["'`]\*["'`]/.test(src);
    const usesRemote = /remotePatterns|domains\s*:/.test(src);
    checks.push({
      id: "code.images",
      status: wide ? "bad" : "clean",
      title: { tr: "Görsel küçültme izni", en: "Image resizing permission" },
      detail: wide
        ? { tr: `${name} içinde her siteden görsel küçültmeye izin verilmiş (hostname: "**").`, en: `${name} allows resizing images from any site (hostname: "**").` }
        : usesRemote
          ? { tr: "Sadece belirli sitelerden gelen görseller küçültülüyor.", en: "Only images from specific sites are resized." }
          : { tr: "Dış sitelerden görsel küçültme kapalı.", en: "Resizing images from other sites is off." },
      advice: wide
        ? { tr: 'remotePatterns listesine "**" yerine sadece kendi görsellerinin durduğu alan adlarını yaz.', en: 'Replace "**" in remotePatterns with only the domains that host your images.' }
        : undefined,
    });
    break;
  }

  // 5) Yapay zekâ çağrılarında cevap uzunluğu sınırı
  const sources = [];
  for (const f of files ?? []) {
    if (!SOURCE.test(f) || /(^|\/)(node_modules|dist|build|\.next)\//.test(f)) continue;
    try {
      const full = path.join(dir, f);
      if ((await stat(full)).size > 500_000) continue;
      sources.push({ file: f, text: await readFile(full, "utf8") });
    } catch {}
  }
  const ai = sources.flatMap((s) => findUncappedAiCalls(s.text).map((c) => ({ ...c, file: s.file })));
  const aiTotal = sources.reduce((n, s) => n + countAiCalls(s.text), 0);
  if (aiTotal > 0) {
    checks.push({
      id: "code.aicaps",
      status: ai.length ? "warn" : "clean",
      title: { tr: "Yapay zekâ cevaplarında uzunluk sınırı", en: "Length limit on AI answers" },
      detail: ai.length
        ? { tr: `${aiTotal} yapay zekâ çağrısının ${ai.length} tanesinde sınır bulamadım: ${ai.slice(0, 4).map((c) => `${c.file}:${c.line}`).join(", ")}${ai.length > 4 ? "…" : ""}`, en: `Found no limit on ${ai.length} of ${aiTotal} AI calls: ${ai.slice(0, 4).map((c) => `${c.file}:${c.line}`).join(", ")}${ai.length > 4 ? "…" : ""}` }
        : { tr: `${aiTotal} yapay zekâ çağrısının hepsinde cevap uzunluğu sınırı var.`, en: `All ${aiTotal} AI calls have an answer length limit.` },
      advice: ai.length ? { tr: "Bu çağrılara maxOutputTokens (ya da max_tokens) ekle. Bu bir tahmin taraması; sınırı başka bir yerde koyduysan bu uyarıyı yok say.", en: "Add maxOutputTokens (or max_tokens) to these calls. This is a heuristic scan; ignore it if you set the limit elsewhere." } : undefined,
    });
  }

  // 6) Zamanlanmış görev adresleri şifreli mi?
  const crons = await cronPaths(dir);
  if (crons.length) {
    const open = [];
    for (const c of crons) {
      const src = sources.find((s) => routeFiles(c).includes(s.file));
      if (!src || !/CRON_SECRET|authorization/i.test(src.text)) open.push(c);
    }
    checks.push({
      id: "code.cron",
      status: open.length ? "warn" : "clean",
      title: { tr: "Zamanlanmış görevler dışarıdan tetiklenebiliyor mu?", en: "Can scheduled jobs be triggered from outside?" },
      detail: open.length
        ? { tr: `${crons.length} zamanlanmış görevin ${open.length} tanesinde şifre kontrolü bulamadım: ${open.join(", ")}`, en: `Found no secret check on ${open.length} of ${crons.length} scheduled jobs: ${open.join(", ")}` }
        : { tr: `${crons.length} zamanlanmış görevin hepsinde şifre kontrolü var.`, en: `All ${crons.length} scheduled jobs check a secret.` },
      advice: open.length ? { tr: "Bu adreslerin başında CRON_SECRET kontrolü yap: istek başlığındaki Authorization değeri `Bearer ${process.env.CRON_SECRET}` değilse 401 dön.", en: "Check CRON_SECRET at the top of these routes: return 401 unless the Authorization header equals `Bearer ${process.env.CRON_SECRET}`." } : undefined,
    });
  }

  // 7) Tarayıcıya giden gizli anahtar adı
  const envNames = new Set(sources.flatMap((s) => [...s.text.matchAll(/\b(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]+/g)].map((m) => m[0])));
  for (const name of [".env", ".env.local", ".env.production", ".env.development"]) {
    try {
      for (const line of (await readFile(path.join(dir, name), "utf8")).split("\n")) {
        const key = line.match(/^\s*(?:export\s+)?((?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]+)\s*=/)?.[1];
        if (key) envNames.add(key);
      }
    } catch {}
  }
  if (envNames.size) {
    const risky = riskyPublicEnv([...envNames]);
    checks.push({
      id: "code.publicenv",
      status: risky.length ? "bad" : "clean",
      title: { tr: "Gizli anahtar tarayıcıya gidiyor mu?", en: "Is a secret key sent to the browser?" },
      detail: risky.length
        ? { tr: `Şu ayarlar tarayıcıya gönderiliyor ve adları gizli anahtara benziyor: ${risky.join(", ")}`, en: `These settings are sent to the browser and look like secret keys: ${risky.join(", ")}` }
        : { tr: `Tarayıcıya giden ${envNames.size} ayarın hiçbiri gizli anahtara benzemiyor.`, en: `None of the ${envNames.size} browser-visible settings looks like a secret key.` },
      advice: risky.length ? { tr: "Adı NEXT_PUBLIC_ (ya da VITE_) ile başlayan her şey sitenin ziyaretçilerine açıktır. Bu anahtarı yenile, adındaki öneki kaldır ve sadece sunucu tarafında kullan.", en: "Anything named NEXT_PUBLIC_ (or VITE_) is visible to every visitor. Rotate this key, drop the prefix and use it only on the server." } : undefined,
    });
  }

  return {
    id: "code",
    name: { tr: "Kod", en: "Code" },
    sub: { tr: `Bu klasördeki proje · ${path.basename(dir)}`, en: `The project in this folder · ${path.basename(dir)}` },
    checks,
  };
}

/** package.json'a bakarak projenin hangi ücretli servisleri kullandığını bulur. */
export async function detectServices(dir) {
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
  } catch {}
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const has = (...names) => deps.some((d) => names.some((n) => d === n || d.startsWith(n)));
  return {
    openai: has("openai", "@ai-sdk/openai"),
    anthropic: has("@anthropic-ai/", "@ai-sdk/anthropic"),
    gemini: has("@google/genai", "@google/generative-ai", "@ai-sdk/google"),
    supabase: has("@supabase/"),
    twilio: has("twilio"),
    elevenlabs: has("elevenlabs", "@elevenlabs/"),
    aiGateway: has("ai") && !has("@ai-sdk/openai", "@ai-sdk/anthropic", "@ai-sdk/google"),
  };
}
