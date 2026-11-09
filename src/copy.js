// Her kontrolün sade dilde "Ne demek? / Neden önemli?" açıklaması.
export const EXPLAIN = {
  "vercel.budget": {
    what: { tr: "Ayda en fazla ne kadar ek ödemeye razı olduğunu Vercel'e söylediğin rakam.", en: "The most you're willing to pay Vercel extra per month." },
    why: { tr: "Saldırı olursa kaybedeceğin para en fazla bu kadar olur. Ne kadar düşükse o kadar güvendesin.", en: "If you're attacked, this is the most you can lose. Lower is safer." },
  },
  "vercel.pause": {
    what: { tr: "Harcama sınırına gelince Vercel'in sitelerini otomatik olarak kapatması.", en: "Vercel switches your sites off automatically when you hit the spending limit." },
    why: {
      tr: "Bu kapalıysa harcama sınırı sadece bir uyarıdır, fren değildir. 72 bin $ ve 18 bin $ fatura alan iki kişinin de 7 $'lık bütçesi vardı; bütçe sadece e-posta attı.",
      en: "If this is off, the limit is only a warning, not a brake. Two people who got $72k and $18k bills both had a $7 budget; it only sent emails.",
    },
  },
  "vercel.ratelimit": {
    what: { tr: "Aynı bilgisayardan dakikada yüzlerce istek gelirse onu durduran kural. Bot ve saldırılara karşı ilk kapı.", en: "A rule that stops one computer sending hundreds of requests a minute. The first gate against bots." },
    why: {
      tr: "Bir bot sitene milyonlarca istek atarsa her biri sana para yazar. Bu kural çoğunu kapıda durdurur, durdurulanlar ücretsizdir. Binlerce farklı bilgisayardan gelen saldırıyı tek başına durdurmaz; asıl koruma harcama sınırıdır.",
      en: "If a bot sends millions of requests, each one costs you. This rule stops most at the door, and blocked ones are free. It can't stop attacks from thousands of computers alone; the spending limit is the real guard.",
    },
  },
  "vercel.previews": {
    what: { tr: "Vercel her değişiklikte sitenin bir deneme kopyasını yapar. Bunlar şifreli olmalı.", en: "Vercel makes a test copy of your site on every change. These should be private." },
    why: { tr: "Açık deneme sayfaları hem bitmemiş işini gösterir hem de botlara ikinci bir kapı açar.", en: "Public test pages show unfinished work and give bots a second door." },
  },
  "code.secrets": {
    what: { tr: "Servislere bağlanmak için kullandığın gizli anahtarların yanlışlıkla koda ya da Git geçmişine girip girmediği.", en: "Whether your secret service keys ended up in your code or Git history by mistake." },
    why: { tr: "Botlar GitHub'ı sürekli tarar. Sızan bir anahtar dakikalar içinde senin hesabından harcama yapmaya başlar.", en: "Bots scan GitHub nonstop. A leaked key gets used on your account within minutes." },
  },
  "code.env": {
    what: { tr: ".env, gizli anahtarlarının durduğu dosya. Git'e hiç girmemeli.", en: ".env is where your secret keys live. It should never be in Git." },
    why: { tr: "Git'e giren dosya GitHub'a da gider. Depo bir gün herkese açılırsa anahtarlar da açılır.", en: "Whatever is in Git goes to GitHub. If the repo is ever made public, so are the keys." },
  },
  "code.images": {
    what: { tr: "Next.js'e hangi sitelerden gelen görselleri küçültebileceğini söyleyen liste (remotePatterns).", en: "The list telling Next.js which sites' images it may resize (remotePatterns)." },
    why: { tr: "Liste çok genişse başkası internetteki herhangi bir görseli senin siten üzerinden küçülttürür, parasını sen ödersin.", en: "If it's too wide, anyone can resize any image through your site, and you pay." },
  },
};
