# VibeAmigo

**Monitor and brakes for vibe-coded apps.** Shows what you spend, finds the protections you forgot to turn on, lets you *test* that your brakes really work, and gives you a panic button. Runs on your computer, sends nothing anywhere.

**Yapay zekâyla yaptığın siteler için izleme ve fren.** Ne harcadığını gösterir, açmayı unuttuğun korumaları bulur, frenlerinin gerçekten çalıştığını *denemeni* sağlar ve bir acil durdurma düğmesi verir. Kendi bilgisayarında çalışır, hiçbir yere bir şey göndermez.

```bash
npx github:sedattkahraman/vibeamigo
```

[Türkçe](#türkçe) · [English](#english)

---

## Türkçe

### Neden?

Bir sitenin firewall'u açık olabilir, yine de 1.000 dolar fatura gelebilir. Firewall bir süzgeçtir; faturaya tavan koymaz. Bir ayarın "açık" olması da çalıştığını kanıtlamaz. VibeAmigo bu yüzden hiçbir şeye "güvende" demez. Üç şey söyler:

- **Açık:** Ayar açık, servisten okuduk. Ama denenmedi.
- **✓ Denendi:** Freni gerçekten denedik ve çalıştı. Tarihiyle birlikte.
- **Neyi kapsamaz:** Her korumanın altında, o korumanın durdurmadığı şeyler yazar.

Hikâyenin tamamı: [Güvenlik önlemi vardı, yine de 1.000 dolar fatura geldi](https://sedatkahraman.com/yazilar/vibe-coding-surpriz-fatura)

### Ne yapıyor?

**İzler**
- Vercel'de bu ayki kullanım, ek ödeme, son 14 günün harcaması
- Son 24 saatin trafiği, firewall'un durdurduğu istek sayısı, en çok ziyaret alan siteler
- Her sitede ani artış var mı (son 10 dakika, sitenin kendi 24 saatlik ortalamasına göre)

**Kontrol eder ve onayınla düzeltir**

| Kontrol | Düzeltme |
|---|---|
| Aylık harcama sınırı var mı, makul mü? | Sınır koyar ya da düşürür |
| Sınıra gelince siteler duruyor mu? | Durdurmayı açar |
| Her sitede aşırı ziyaret engeli var mı? (aynı IP, dakikada 600 istek) | Kuralı ekler |
| Her sitede veri gönderme sınırı var mı? (aynı IP, dakikada 100 POST/PUT/PATCH/DELETE) | Kuralı ekler |
| Deneme (preview) sayfaları gizli mi? | Gizler |
| Kodda ya da Git geçmişinde gizli anahtar var mı? `.env` Git'e girmiş mi? | Ne yapacağını söyler |
| Adı `NEXT_PUBLIC_` / `VITE_` ile başlayan gizli anahtar var mı? | Ne yapacağını söyler |
| Yapay zekâ çağrılarında cevap uzunluğu sınırı var mı? | Ne yapacağını söyler |
| Zamanlanmış görev (cron) adresleri şifre kontrolü yapıyor mu? | Ne yapacağını söyler |
| Next.js görsel izni (`remotePatterns`) çok mu geniş? | Ne yapacağını söyler |
| OpenAI, Claude, Gemini, Supabase, Twilio, ElevenLabs sınırları | Projende kullanıyorsan link verip sorar |

**Frenleri dener ("Dene" düğmesi)**

| Tatbikat | Ne yapar |
|---|---|
| Aşırı ziyaret engeli | Siteye art arda ~650 istek atar; 600'den sonrakilerin durdurulduğunu doğrular |
| Veri gönderme sınırı | ~130 boş POST atar; 100'den sonrakilerin durdurulduğunu doğrular |
| Saldırı modu | Açar, doğrulamanın devreye girdiğini görür, kapatır |
| Siteyi durdurma | Durdurur, kapandığını görür, yeniden açar |

Sonuç yerelde saklanır ve panelde "✓ Denendi: … sitesinde, … tarihinde" diye görünür. Belirsiz bir sonuç kaydedilmez.

**Acil durum çubuğu**
- **Saldırı modunu aç:** Seçtiğin sitelerde 1 saatliğine herkese kısa bir doğrulama çıkarır. Kendiliğinden kapanır.
- **Siteleri durdur:** Son çare. Kapalı site para harcamaz.
- **Normale dön:** İkisini de geri alır. Vercel'in harcama sınırı sitelerini durdurduysa hepsini buradan tek seferde açarsın.

**Bekçi (`watch`)**

Panel kapalıyken de aynı kontrolleri yapar: harcama sınırın duruyor mu, yeni bir siteye kural eklenmemiş mi, bir sitede ani artış var mı.

```bash
# Bilgisayarın açıkken, 5 dakikada bir. Ani artış görürse o sitede saldırı modunu açar.
npx github:sedattkahraman/vibeamigo watch --loop 5 --brake attack
```

Günün her saati çalışması için [`templates/vibeamigo-watch.yml`](templates/vibeamigo-watch.yml) dosyasını özel bir GitHub reposuna koy ve `VERCEL_TOKEN` secret'ını ekle. 30 dakikada bir çalışır; alarm olursa iş başarısız biter ve GitHub sana e-posta atar. Telegram için `TELEGRAM_BOT_TOKEN` ve `TELEGRAM_CHAT_ID` ekle.

| Seçenek | Ne yapar |
|---|---|
| `--brake attack` | Ani artış görülen sitede 1 saatliğine saldırı modunu açar |
| `--heal` | Aşırı ziyaret engeli olmayan (yeni) sitelere kuralı ekler |
| `--strict` | Uyarıları da alarm sayar |
| `--min 2000 --factor 10` | Ani artış eşiği: 10 dakikada en az 2000 istek **ve** sitenin normalinin 10 katı |

Çıkış kodu: `0` sorun yok · `1` alarm · `2` kontrol yapılamadı.

**Ajanınla kullan**

```bash
npx github:sedattkahraman/vibeamigo scan          # okunur özet
npx github:sedattkahraman/vibeamigo scan --json   # makine için
```

Claude Code ya da Cursor'a "bu projede VibeAmigo taraması çalıştır ve sonucu anlat" demen yeter.

### Nasıl çalışır?

1. Projenin klasöründe `npx github:sedattkahraman/vibeamigo` yaz. Tarayıcında bir panel açılır.
2. Vercel için yeni bir şifre istemez: bilgisayarındaki `vercel login` oturumunu kullanır.
3. Her değişiklikten önce ne yapacağını açıkça yazar, hangi sitelere uygulanacağını seçtirir ve onayını ister.

Gereken: Node.js 20+ ve `vercel login`. Harcama ve trafik komutları yeni Vercel CLI'da (65+) var; kurulu sürüm eskiyse araç `npx vercel@latest` kullanır.

### Bilmen gerekenler (dürüst sınırlar)

- **%100 koruma yoktur.** Amaç, en kötü durumda ne kadar kaybedeceğini önceden bilmek.
- **Harcama sınırının durdurması denenemez:** tetiklemek için gerçekten para harcamak gerekir. O yüzden hep "Açık" görünür, "Denendi" olmaz. Durdurma mekanizmasının kendisini "Siteyi durdurma" tatbikatıyla deneyebilirsin.
- **Vercel'in durdurması anlık değil** (birkaç dakikada bir kontrol eder) ve AI Gateway, v0, depolama ücretlerini durdurmaz.
- **İstek sınırları IP başınadır.** Binlerce farklı bilgisayardan gelen dağıtık bir saldırıyı tek başına durdurmaz; o durumda saldırı modu ve harcama sınırı devreye girer.
- **İstek sınırı ücretlidir:** Vercel izin verilen 1 milyon istek başına 0,50 $ alır.
- **OpenAI, Gemini, Supabase gibi servislerin ayarlarını okuyamıyoruz.** Link verip soruyoruz ve cevabını "Sen onayladın" diye gösteriyoruz.
- **Kod taramaları tahmine dayalıdır.** Kodu okur, çalıştırmaz. Yanlış alarm verebilir ya da bir şeyi kaçırabilir.
- **Bekçi GitHub'da 30 dakikada bir çalışır.** Yavaş sızıntıları ve ayar değişikliklerini yakalar; ani bir patlamayı ilk dakikada durduran şey istek sınırları ve harcama sınırıdır.

Ölçümler (Kasım 2026, bir Pro hesapta): saldırı modu ~2 saniyede devreye giriyor; proje ~3 saniyede duruyor, ~9 saniyede açılıyor; bir istek Vercel'in trafik verisinde ~30 saniyede görünüyor.

### Güvenlik

- Panel sadece `127.0.0.1`'de açılır. Her açılışta rastgele bir anahtar üretilir; tarayıcındaki başka bir site araca istek atamaz.
- Tarayıcı serbest komut gönderemez: sadece son taramanın önerdiği bir işlemin numarasını ve o işlemin izin verdiği sitelerden bir seçimi gönderir.
- Araç Vercel anahtarını hiç görmez; Vercel CLI'ı çalıştırır.
- Hiçbir işlem veri silmez.
- Bulunan anahtarlar ekranda maskelenir ve hiçbir yere gönderilmez.
- Cevapların ve tatbikat sonuçların sadece `~/.vibeamigo/` içinde saklanır.
- Bekçiyi GitHub'da çalıştırırsan Vercel anahtarın GitHub secret'ında durur. Bu anahtar hesabına tam yetkilidir; sadece kendi özel repona koy. Şablon belirli bir sürüme sabitlenmiştir.

---

## English

### Why?

Your firewall can be on and you can still get a $1,000 bill. A firewall is a filter, not a spending cap. And a setting being "on" doesn't prove it works. So VibeAmigo never says "safe". It says three things:

- **On:** the setting is on; we read it from the service. Not tested.
- **✓ Tested:** we really tried the brake and it worked, with the date.
- **What it doesn't cover:** under every protection, the things it will not stop.

### What it does

**Monitors** this month's Vercel usage and overage, the last 14 days of spend, the last 24 hours of traffic, how many requests the firewall stopped, and whether any site is spiking against its own 24-hour average.

**Checks, and fixes with your approval:** monthly spending limit; pause-at-limit; a general rate limit on every site (600 req/min per IP); a write rate limit on every site (100 POST/PUT/PATCH/DELETE per min per IP, paths containing "webhook" excluded); private preview deployments. In your code: leaked keys in files and Git history, committed `.env`, secret-looking `NEXT_PUBLIC_`/`VITE_` variables, AI calls without an output cap, cron routes without a secret check, wide-open `remotePatterns`. For OpenAI, Claude, Gemini, Supabase, Twilio and ElevenLabs it links you to the setting and asks.

**Drills ("Test it"):** floods a site you pick until the rate limit blocks it; turns attack mode on and off and times it; pauses and resumes a site and times it. Results are stored locally and shown as "✓ Tested on … (date)". Inconclusive results are not recorded.

**Emergency bar:** *Turn on attack mode* (1 hour, self-expiring), *Pause sites* (last resort), *Back to normal* (undoes both, and resumes everything in one go after Vercel's spending limit paused your sites).

**Watchdog:**

```bash
npx github:sedattkahraman/vibeamigo watch --loop 5 --brake attack
```

For 24/7, put [`templates/vibeamigo-watch.yml`](templates/vibeamigo-watch.yml) in a private GitHub repo with a `VERCEL_TOKEN` secret. It runs every 30 minutes; on an alarm the job fails and GitHub emails you. Options: `--brake attack`, `--heal`, `--strict`, `--min`, `--factor`. Exit codes: `0` clear, `1` alarm, `2` could not check.

**For agents and scripts:** `vibeamigo scan` and `vibeamigo scan --json`.

### Honest limits

- Nothing is 100% safe. The goal is to know your worst case in advance.
- The spending-limit pause can't be drilled without really spending money, so it stays "On", never "Tested".
- Vercel's pause is not instant and doesn't stop AI Gateway, v0 or storage charges.
- Rate limits are per IP. They don't stop a distributed attack alone; attack mode and the spending limit cover that.
- Rate limiting costs $0.50 per 1M allowed requests on Vercel.
- We can't read OpenAI, Gemini or Supabase settings; we ask you and label the answer "You confirmed".
- Code scans are heuristic.
- On GitHub the watchdog runs every 30 minutes. It catches slow leaks and drifted settings, not the first minute of a burst.

### Security

- The panel binds to `127.0.0.1` with a random per-session token and a Host check. Other sites in your browser can't call it.
- The browser can't send free-form commands: only the ID of an action the last scan proposed, plus a choice among the sites that action allows.
- VibeAmigo never sees your Vercel token; it runs the Vercel CLI.
- No action deletes data. Found keys are masked and never sent anywhere.
- Local state lives in `~/.vibeamigo/`.

Found a security issue? Please open a private advisory on GitHub instead of a public issue.

### Development

```bash
npm test   # logic and local-server tests, no network
```

## License

MIT — Sedat Kahraman, [sedatkahraman.com](https://sedatkahraman.com)
