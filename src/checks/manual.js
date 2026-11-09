// API'den okunamayan ayarlar: kullanıcıya linkini verip soruyoruz. Cevap sadece bu bilgisayarda,
// ~/.vibeamigo/answers.json içinde saklanır. Cevap verilmemiş ayar asla "güvende" gösterilmez.
import { loadAnswers } from "../store.js";

export { saveAnswer } from "../store.js";

const Q = {
  openai: {
    id: "manual.openai",
    name: "OpenAI",
    sub: { tr: "Sitende yapay zekâ kullanıyorsan ücretini ödediğin servis", en: "The AI service you pay for if your site uses AI" },
    title: { tr: "OpenAI harcama sınırı", en: "OpenAI spending limit" },
    ask: { tr: 'Limits sayfasında aylık sınır var mı ve "Enforce a hard limit" açık mı?', en: 'Is there a monthly limit on the Limits page, with "Enforce a hard limit" on?' },
    what: { tr: "Açıksa sınıra gelince yapay zekâ cevap vermeyi bırakır. Kapalıysa sınır sadece izler.", en: "If on, the AI stops answering at the limit. If off, the limit only monitors." },
    why: { tr: "Vercel'i durdurmak OpenAI faturasını durdurmaz. Her servisin kendi sınırı ayrıca açık olmalı.", en: "Pausing Vercel does not stop your OpenAI bill. Each service needs its own limit." },
    link: "https://platform.openai.com/settings/organization/limits",
  },
  anthropic: {
    id: "manual.anthropic",
    name: "Anthropic (Claude API)",
    sub: { tr: "Claude yapay zekâsı", en: "Claude AI" },
    title: { tr: "Claude aylık harcama sınırı", en: "Claude monthly spend limit" },
    ask: { tr: "Billing sayfasında kendi aylık harcama sınırını belirledin mi?", en: "Did you set your own monthly spend limit on the Billing page?" },
    what: { tr: "Sınıra gelince istekler durur ve yeni ayın başına kadar kapalı kalır.", en: "Requests stop at the limit until the next month." },
    why: { tr: "Senin koymadığın durumda sadece hesap seviyesinin tavanı geçerli, o da yüzlerce dolar olabilir.", en: "Without your own limit, only the tier cap applies, which can be hundreds of dollars." },
    link: "https://platform.claude.com/settings/billing",
  },
  gemini: {
    id: "manual.gemini",
    name: "Gemini",
    sub: { tr: "Google'ın yapay zekâsı", en: "Google's AI" },
    title: { tr: "Gemini aylık sınırı", en: "Gemini monthly limit" },
    ask: { tr: 'AI Studio\'da bu projenin "Spend" sekmesinde aylık tavan tanımlı mı?', en: 'Is a monthly cap set on this project\'s "Spend" tab in AI Studio?' },
    what: { tr: "Proje başına koyduğun aylık harcama tavanı. Google'a göre 10 dakikaya kadar gecikmeli işliyor.", en: "A monthly cap per project. Google says it can lag up to 10 minutes." },
    why: { tr: "Nisan 2026'da bir geliştiriciye unutulmuş bir Gemini anahtarı yüzünden bir gecede 18 bin $ fatura geldi.", en: "In April 2026 a developer got an $18k bill overnight from a forgotten Gemini key." },
    link: "https://aistudio.google.com/",
  },
  supabase: {
    id: "manual.supabase",
    name: "Supabase",
    sub: { tr: "Sitenin verilerini sakladığı veritabanı", en: "The database where your site keeps data" },
    title: { tr: "Supabase harcama sınırı", en: "Supabase spending limit" },
    ask: { tr: 'Organizasyonun Billing sayfasında "Spend Cap" açık mı?', en: 'Is "Spend Cap" on in your organization\'s Billing page?' },
    what: { tr: "Açıksa kota dolunca fazla ödeme yapmazsın. Sunucu (compute) gibi bazı kalemler kapsam dışında.", en: "If on, you don't pay overages. Some items like compute are not covered." },
    why: { tr: "Bu ayar Supabase'in API'sinde yok; sadece panelden görülüyor.", en: "This setting isn't in Supabase's API; only the dashboard shows it." },
    link: "https://supabase.com/dashboard/org/_/billing",
  },
  twilio: {
    id: "manual.twilio",
    name: "Twilio",
    sub: { tr: "SMS ve arama servisi", en: "SMS and calls" },
    title: { tr: "Otomatik bakiye yükleme kapalı mı?", en: "Is auto-recharge off?" },
    ask: { tr: "Billing sayfasında Auto Recharge kapalı mı (ya da düşük bir tutarda mı)?", en: "Is Auto Recharge off (or set to a low amount) on the Billing page?" },
    what: { tr: "Bakiye bitince Twilio hesabı durdurur; bu doğal bir şalter. Otomatik yükleme açıksa şalter kalkar.", en: "When the balance hits zero Twilio suspends the account, a natural kill switch. Auto-recharge removes it." },
    why: { tr: "Otomatik yükleme her seferinde 2.000 $'a kadar para çekebiliyor. SMS saldırıları yaygın.", en: "Auto-recharge can pull up to $2,000 each time. SMS abuse is common." },
    link: "https://console.twilio.com/us1/billing/manage-billing/billing-overview",
  },
  elevenlabs: {
    id: "manual.elevenlabs",
    name: "ElevenLabs",
    sub: { tr: "Yapay zekâ ile ses", en: "AI voice" },
    title: { tr: "Kredi bitince duruyor mu?", en: "Does it stop when credits run out?" },
    ask: { tr: "Abonelik sayfasında kullandıkça ödeme (usage based billing) kapalı ya da üst sınırlı mı?", en: "Is usage-based billing off or capped on the Subscription page?" },
    what: { tr: "Yeni planlarda kredi bitince ya durur ya da önceden aldığın krediyi kullanır. Eski planlarda fazla kullanım faturalanabilir.", en: "On new plans it stops or uses prepaid credit. Older plans can bill overages." },
    why: { tr: "Ses üretimi pahalıdır; açık bir uç nokta kısa sürede çok kredi yakar.", en: "Voice generation is expensive; an open endpoint burns credit fast." },
    link: "https://elevenlabs.io/app/subscription",
  },
};

export async function manualCards(detected) {
  const answers = await loadAnswers();
  return Object.entries(Q)
    .filter(([k]) => detected[k])
    .map(([, q]) => {
      const a = answers[q.id];
      const status = !a ? "unk" : a.value === "yes" ? "self" : "bad";
      const when = a ? new Date(a.at).toLocaleDateString("tr-TR") : "";
      return {
        id: q.id,
        name: q.name,
        sub: q.sub,
        checks: [
          {
            id: q.id,
            status,
            title: q.title,
            detail: !a
              ? q.ask
              : a.value === "yes"
                ? { tr: `Sen kontrol ettin, açık (${when}). Biz göremiyoruz; ayar değişirse haberimiz olmaz.`, en: `You checked: it's on (${when}). We can't see it; we won't know if it changes.` }
                : { tr: `Sen kontrol ettin, kapalı (${when}). Açmanı öneririz.`, en: `You checked: it's off (${when}). We suggest turning it on.` },
            what: q.what,
            why: q.why,
            link: q.link,
            manual: true,
          },
        ],
      };
    });
}
