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

function findSecrets(text) {
  const hits = [];
  for (const p of PATTERNS) for (const m of text.matchAll(p.re)) hits.push({ type: p.name, value: m[0] });
  for (const m of text.matchAll(JWT)) if (isServiceRoleJwt(m[0])) hits.push({ type: "Supabase service_role", value: m[0] });
  return hits;
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
    status: !isRepo ? "unk" : leaks.length ? "bad" : "ok",
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
      status: envTracked.length ? "bad" : "ok",
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
      status: wide ? "bad" : "ok",
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
