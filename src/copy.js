// Her kontrolün sade dilde açıklaması: başlık, "Ne demek?", "Neden önemli?" ve "Neyi kapsamaz?".
// "Neyi kapsamaz" kısmı bilerek her kontrolde var: bir ayarın açık olması, her şeyin güvende olduğu anlamına gelmez.
export const EXPLAIN = {
  "vercel.budget": {
    title: { tr: "Aylık harcama sınırı", en: "Monthly spending limit" },
    what: { tr: "Ayda en fazla ne kadar ek ödemeye razı olduğunu Vercel'e söylediğin rakam.", en: "The most you're willing to pay Vercel extra per month." },
    why: { tr: "Saldırı olursa kaybedeceğin para en fazla bu kadar olur. Ne kadar düşükse o kadar güvendesin.", en: "If you're attacked, this is the most you can lose. Lower is safer." },
    limits: {
      tr: ["Tek başına hiçbir şeyi durdurmaz; bir alttaki \"durdur\" ayarı da açık olmalı.", "Pro paketindeki aylık 20 $ kredi bittikten sonraki harcamayı sayar.", "OpenAI, Supabase gibi başka servislerin faturasını kapsamaz."],
      en: ['Stops nothing on its own; the "pause" setting below must be on too.', "Counts only spend above the $20 monthly Pro credit.", "Doesn't cover bills from other services such as OpenAI or Supabase."],
    },
  },
  "vercel.pause": {
    title: { tr: "Sınıra gelince siteyi durdur", en: "Pause the site at the limit" },
    what: { tr: "Harcama sınırına gelince Vercel'in sitelerini otomatik olarak kapatması.", en: "Vercel switches your sites off automatically when you hit the spending limit." },
    why: {
      tr: "Bu kapalıysa harcama sınırı sadece bir uyarıdır, fren değildir. 72 bin $ ve 18 bin $ fatura alan iki kişinin de 7 $'lık bütçesi vardı; bütçe sadece e-posta attı.",
      en: "If this is off, the limit is only a warning, not a brake. Two people who got $72k and $18k bills both had a $7 budget; it only sent emails.",
    },
    limits: {
      tr: ["Bu ayarı Vercel'den okuduk ama deneyemeyiz: tetiklemek için gerçekten para harcamak gerekir.", "Anlık değil. Vercel harcamayı birkaç dakikada bir kontrol eder; o arada sınır biraz aşılabilir.", "AI Gateway, v0 ve depolama ücretleri durmaz.", "OpenAI, Supabase, Twilio gibi başka servislerin faturasını durdurmaz.", "Siteler kendiliğinden geri açılmaz; bu panelden \"Normale dön\" ile açarsın."],
      en: ["We read this setting from Vercel but can't test it: triggering it means really spending money.", "Not instant. Vercel checks spend every few minutes, so the limit can be exceeded a little.", "AI Gateway, v0 and storage charges continue.", "Doesn't stop bills from other services such as OpenAI, Supabase or Twilio.", 'Sites don\'t come back on their own; use "Back to normal" in this panel.'],
    },
  },
  "vercel.ratelimit": {
    title: { tr: "Aşırı ziyaret engeli", en: "Too-many-visits blocker" },
    what: { tr: "Aynı bilgisayardan dakikada 600'den fazla istek gelirse onu durduran kural. Bot ve saldırılara karşı ilk kapı.", en: "A rule that stops one computer sending more than 600 requests a minute. The first gate against bots." },
    why: { tr: "Bir bot sitene milyonlarca istek atarsa her biri sana para yazar. Bu kural çoğunu kapıda durdurur; durdurulan istekler ücretsizdir.", en: "If a bot sends millions of requests, each one costs you. This rule stops most at the door, and blocked ones are free." },
    limits: {
      tr: ["Binlerce farklı bilgisayardan gelen dağıtık bir saldırıyı durdurmaz: her biri sınırın altında kalır. O durumda \"Saldırı modu\" ve harcama sınırı devreye girer.", "Vercel bu kural için izin verilen 1 milyon istek başına 0,50 $ alır."],
      en: ['Doesn\'t stop a distributed attack from thousands of computers: each stays under the limit. "Attack mode" and the spending limit cover that case.', "Vercel charges $0.50 per 1M allowed requests for this rule."],
    },
  },
  "vercel.writelimit": {
    title: { tr: "Veri gönderme sınırı", en: "Write request limit" },
    what: { tr: "Aynı bilgisayar dakikada 100'den fazla veri gönderemez: form doldurma, yapay zekâya soru sorma, ödeme gibi işlemler.", en: "One computer can't send data more than 100 times a minute: forms, AI questions, payments." },
    why: { tr: "Sitende para harcatan işlerin çoğu veri gönderen isteklerle başlar. Sayfa görüntülemek ucuzdur; yapay zekâya soru sormak pahalıdır. Bu yüzden bunlara daha sıkı bir sınır gerekir.", en: "Most things that cost you money start with a write request. Viewing a page is cheap; asking an AI is not. So these need a tighter limit." },
    limits: {
      tr: ["Dağıtık saldırıyı durdurmaz (her bilgisayar ayrı sayılır).", "Adresinde \"webhook\" geçen yollar bu sınırın dışındadır.", "Veri göndermeden para harcatan sayfaları (her açılışta yapay zekâ çağıran bir sayfa gibi) kapsamaz."],
      en: ["Doesn't stop a distributed attack (each computer is counted separately).", 'Paths containing "webhook" are excluded.', "Doesn't cover pages that cost money without a write (such as a page calling an AI on every view)."],
    },
  },
  "vercel.previews": {
    title: { tr: "Deneme sayfalarının gizliliği", en: "Privacy of test pages" },
    what: { tr: "Vercel her değişiklikte sitenin bir deneme kopyasını yapar. Bunlar sadece sana açık olmalı.", en: "Vercel makes a test copy of your site on every change. These should be visible only to you." },
    why: { tr: "Açık deneme sayfaları hem bitmemiş işini gösterir hem de botlara ikinci bir kapı açar.", en: "Public test pages show unfinished work and give bots a second door." },
  },
  "vercel.traffic": {
    title: { tr: "Trafik normal mi?", en: "Is traffic normal?" },
    what: { tr: "Her sitenin son 10 dakikadaki istek sayısını kendi 24 saatlik ortalamasıyla karşılaştırıyoruz.", en: "We compare each site's requests in the last 10 minutes with its own 24-hour average." },
    why: { tr: "Saldırı da gerçek ilgi patlaması da önce burada görünür. Vercel'in verisi yaklaşık 30 saniye gecikmeli gelir.", en: "Both attacks and real spikes show up here first. Vercel's data lags by about 30 seconds." },
    limits: { tr: ["Sadece bu panel açıkken ya da bekçi çalışırken bakılır. Sürekli izleme için aşağıdaki \"Bekçi\"yi kur."], en: ['Checked only while this panel is open or the watchdog runs. Set up the "Watchdog" below for constant monitoring.'] },
  },
  "vercel.brake.attack": {
    title: { tr: "Acil fren: saldırı modu", en: "Emergency brake: attack mode" },
    what: { tr: "Açılınca siteye gelen herkese kısa bir otomatik doğrulama çıkar. Gerçek ziyaretçi birkaç saniyede geçer, botların çoğu geçemez.", en: "When on, everyone visiting the site gets a short automatic check. Real visitors pass in seconds; most bots don't." },
    why: { tr: "Dağıtık saldırıya karşı en hızlı fren. Siteyi kapatmadan saldırıyı keser; doğrulamada takılan istekler ücretsizdir.", en: "The fastest brake against a distributed attack. It cuts the attack without taking the site down, and challenged requests are free." },
    limits: { tr: ["Sitene bağlanan başka programları da (webhook, API, RSS okuyucu) engeller.", "Doğrulamayı geçebilen gelişmiş botları durdurmaz."], en: ["Also blocks other programs calling your site (webhooks, APIs, RSS readers).", "Doesn't stop advanced bots that can pass the check."] },
  },
  "vercel.brake.pause": {
    title: { tr: "Acil fren: siteyi durdur", en: "Emergency brake: pause the site" },
    what: { tr: "Siteyi tamamen kapatır. Ziyaretçiler \"site geçici olarak kapalı\" görür.", en: 'Switches the site off completely. Visitors see "site temporarily unavailable".' },
    why: { tr: "Kapalı site Vercel'de para harcamaz. Başka hiçbir şey işe yaramazsa son çare budur.", en: "A paused site costs nothing on Vercel. The last resort when nothing else works." },
    limits: { tr: ["Site sen açana kadar kapalı kalır.", "Sitenin kullandığı başka servislerde (OpenAI gibi) dışarıdan gelen harcamayı durdurmaz."], en: ["The site stays off until you resume it.", "Doesn't stop spend that reaches other services (like OpenAI) from elsewhere."] },
  },
  "code.secrets": {
    what: { tr: "Servislere bağlanmak için kullandığın gizli anahtarların yanlışlıkla koda ya da Git geçmişine girip girmediği.", en: "Whether your secret service keys ended up in your code or Git history by mistake." },
    why: { tr: "Botlar GitHub'ı sürekli tarar. Sızan bir anahtar dakikalar içinde senin hesabından harcama yapmaya başlar.", en: "Bots scan GitHub nonstop. A leaked key gets used on your account within minutes." },
    limits: { tr: ["Sadece bu klasördeki projeye ve bilinen anahtar biçimlerine bakar. Tanımadığı biçimdeki bir anahtarı kaçırabilir."], en: ["Looks only at the project in this folder and at known key formats. It can miss a key in an unknown format."] },
  },
  "code.env": {
    what: { tr: ".env, gizli anahtarlarının durduğu dosya. Git'e hiç girmemeli.", en: ".env is where your secret keys live. It should never be in Git." },
    why: { tr: "Git'e giren dosya GitHub'a da gider. Depo bir gün herkese açılırsa anahtarlar da açılır.", en: "Whatever is in Git goes to GitHub. If the repo is ever made public, so are the keys." },
  },
  "code.images": {
    what: { tr: "Next.js'e hangi sitelerden gelen görselleri küçültebileceğini söyleyen liste (remotePatterns).", en: "The list telling Next.js which sites' images it may resize (remotePatterns)." },
    why: { tr: "Liste çok genişse başkası internetteki herhangi bir görseli senin siten üzerinden küçülttürür, parasını sen ödersin.", en: "If it's too wide, anyone can resize any image through your site, and you pay." },
  },
  "code.aicaps": {
    what: { tr: "Yapay zekâya \"cevabın en fazla şu kadar uzun olsun\" demek (maxOutputTokens). Ücret cevabın uzunluğuna göre yazılır.", en: 'Telling the AI "your answer can be at most this long" (maxOutputTokens). You pay by answer length.' },
    why: { tr: "Sınır yoksa tek bir kötü niyetli soru, çok uzun ve pahalı bir cevap ürettirebilir.", en: "Without a limit, one malicious question can produce a very long, expensive answer." },
    limits: { tr: ["Tahmine dayalı bir taramadır: kodu okur, çalıştırmaz. Yanlış alarm verebilir ya da bir çağrıyı kaçırabilir."], en: ["A heuristic scan: it reads code, doesn't run it. It can raise false alarms or miss a call."] },
  },
  "code.cron": {
    what: { tr: "Zamanlanmış görevler (cron) aslında internetten erişilebilen adreslerdir. Şifre kontrolü yoksa adresi bilen herkes çalıştırabilir.", en: "Scheduled jobs (crons) are really public URLs. Without a secret check, anyone who knows the URL can run them." },
    why: { tr: "Biri bu adresi art arda çağırırsa görev binlerce kez çalışır: e-posta gönderir, yapay zekâ çağırır, veritabanını yorar.", en: "If someone calls the URL repeatedly, the job runs thousands of times: sending emails, calling AI, loading your database." },
    limits: { tr: ["Tahmine dayalı bir taramadır; sadece vercel.json içindeki görevlere bakar."], en: ["A heuristic scan; it only looks at jobs in vercel.json."] },
  },
  "code.publicenv": {
    what: { tr: "Adı NEXT_PUBLIC_ ya da VITE_ ile başlayan ayarlar sitenin koduna gömülür ve her ziyaretçi tarafından görülebilir.", en: "Settings named NEXT_PUBLIC_ or VITE_ are baked into your site's code and visible to every visitor." },
    why: { tr: "Yapay zekâ araçları bazen gizli bir anahtarı bu şekilde adlandırır. O anahtarı sitene giren herkes kopyalayabilir.", en: "AI coding tools sometimes name a secret key this way. Anyone visiting your site can copy it." },
    limits: { tr: ["Sadece ayarın adına bakar, değerine değil."], en: ["Looks only at the setting's name, not its value."] },
  },
};
