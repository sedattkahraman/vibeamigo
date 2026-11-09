// Firewall kuralları: VibeAmigo'nun eklediği kurallar ve mevcut kuralları tanıma mantığı.
// Bu dosyadaki her şey saf fonksiyon; ağ çağrısı yok, testlerle doğrulanıyor.

export const RULE_GENERAL = "VibeAmigo rate limit";
export const RULE_WRITE = "VibeAmigo write limit";
export const GENERAL_LIMIT = 600; // IP başına dakikada, her türlü istek
export const WRITE_LIMIT = 100; // IP başına dakikada, veri gönderen istekler (form, API, server action)
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

const rateLimitAction = (limit) => ({
  mitigate: {
    action: "rate_limit",
    rateLimit: { algo: "fixed_window", window: 60, limit, keys: ["ip"], action: "rate_limit" },
    actionDuration: null,
  },
});

/** 1. kademe: aynı IP dakikada 600'den fazla istek atamaz. Statik dosyalar sayılmaz. */
export function generalRule() {
  return {
    name: RULE_GENERAL,
    description: `Added by VibeAmigo: max ${GENERAL_LIMIT} requests per minute per IP (static files excluded)`,
    active: true,
    conditionGroup: [{ conditions: [{ type: "path", op: "pre", value: "/_next/static", neg: true }] }],
    action: rateLimitAction(GENERAL_LIMIT),
  };
}

/**
 * 2. kademe: aynı IP dakikada 100'den fazla "yazma" isteği atamaz. Para harcatan işlerin çoğu
 * (yapay zekâ çağrısı, form, ödeme, server action) bu tür isteklerle tetiklenir.
 * Adresinde "webhook" geçen yollar hariç: ödeme/mesaj servisleri aynı IP'den toplu gönderim yapabilir.
 */
export function writeRule() {
  return {
    name: RULE_WRITE,
    description: `Added by VibeAmigo: max ${WRITE_LIMIT} write requests (POST/PUT/PATCH/DELETE) per minute per IP; paths containing "webhook" excluded`,
    active: true,
    conditionGroup: [
      {
        conditions: [
          { type: "method", op: "inc", value: WRITE_METHODS },
          { type: "path", op: "sub", value: "webhook", neg: true },
        ],
      },
    ],
    action: rateLimitAction(WRITE_LIMIT),
  };
}

const limiter = (r) => (r?.active !== false && r?.action?.mitigate?.action === "rate_limit" ? r.action.mitigate.rateLimit : null);
const conditions = (r) => (r.conditionGroup ?? []).flatMap((g) => g.conditions ?? []);

/** Bütün siteyi kapsayan istek sınırı mı? (Koşulu yok ya da sadece "şunlar hariç" koşulları var.) */
export function isGeneralLimit(rule) {
  return !!limiter(rule) && conditions(rule).every((c) => c.neg === true);
}

/** Yazma isteklerini (en azından POST) kapsayan sınır mı? Belirli bir yola daraltılmış olmamalı. */
export function isWriteLimit(rule) {
  if (!limiter(rule)) return false;
  const cs = conditions(rule);
  const coversPost = cs.some(
    (c) => c.type === "method" && !c.neg && (c.value === "POST" || (Array.isArray(c.value) && c.value.includes("POST"))),
  );
  const narrowed = cs.some((c) => c.type !== "method" && !c.neg);
  return coversPost && !narrowed;
}

/** Bir projenin firewall ayarından hangi sınırların var olduğunu çıkarır. */
export function classify(config) {
  if (!config || config.firewallEnabled === false) return { general: null, write: null };
  const rules = config.rules ?? [];
  const info = (r) => (r ? { name: r.name, limit: limiter(r).limit, window: limiter(r).window } : null);
  return { general: info(rules.find(isGeneralLimit)), write: info(rules.find(isWriteLimit)) };
}
