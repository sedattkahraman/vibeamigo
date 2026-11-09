# VibeAmigo

**Spend and security check for vibe-coded apps.** Finds the kill switches you forgot to turn on and the keys you leaked by mistake. Runs on your computer, sends nothing anywhere.

**Yapay zekâyla yaptığın siteler için fatura ve güvenlik kontrolü.** Açmayı unuttuğun şalterleri ve yanlışlıkla sızdırdığın anahtarları bulur. Kendi bilgisayarında çalışır, hiçbir yere bir şey göndermez.

```bash
npx github:sedattkahraman/vibeamigo
```

(npm'e yayınlanınca kısaca `npx vibeamigo` / once on npm: `npx vibeamigo`)

[Türkçe](#türkçe) · [English](#english)

---

## Türkçe

### Neden?

Bir sitenin firewall'u açık olabilir, yine de 1.000 dolar fatura gelebilir. Firewall bir süzgeç; faturaya tavan koymaz. Asıl koruma, rahatça kaybedebileceğin bir harcama sınırı ve sınıra gelince siteyi durduran ayardır. Çoğu platformda bu ayar vardır ama kapalıdır.

Hikâyenin tamamı: [Güvenlik önlemi vardı, yine de 1.000 dolar fatura geldi](https://sedatkahraman.com/yazilar/vibe-coding-surpriz-fatura)

### Ne kontrol ediyor?

| Servis | Kontrol | Nasıl |
|---|---|---|
| **Vercel** | Aylık harcama sınırı var mı, makul mü? | Otomatik, düzeltilebilir |
| | Sınıra gelince siteler duruyor mu? | Otomatik, düzeltilebilir |
| | Her sitede aşırı ziyaret engeli (istek sınırı) var mı? | Otomatik, düzeltilebilir |
| | Deneme (preview) sayfaları gizli mi? | Otomatik, düzeltilebilir |
| | Bu ayki kullanım, ek ödeme, son 14 gün | Otomatik |
| **Kod** | Kodda ya da Git geçmişinde gizli anahtar var mı? | Otomatik |
| | `.env` Git'e girmiş mi? | Otomatik |
| | Next.js görsel izni (`remotePatterns`) çok mu geniş? | Otomatik |
| **OpenAI, Claude, Gemini, Supabase, Twilio, ElevenLabs** | Harcama sınırı / otomatik yükleme ayarı | Projende kullanıyorsan, link verip sorar |

Renkler: **Güvende** (açık ve kontrol edildi) · **Risk var** (kapalı) · **Eksik** (kısmen açık) · **Senin bakman lazım** (dışarıdan okunamıyor).

Doğrulanamayan bir ayar asla "güvende" gösterilmez.

### Nasıl çalışır?

1. Projenin klasöründe `npx github:sedattkahraman/vibeamigo` yaz. Tarayıcında bir panel açılır.
2. Vercel için yeni bir şifre istemez: bilgisayarındaki `vercel login` oturumunu kullanır.
3. Her düzeltmeden önce ne yapacağını açıkça yazar ve onayını ister. Sen onaylamadan hiçbir şey değişmez.

Gereken: Node.js 20+. Vercel kontrolleri için `vercel login` yapmış olman. Harcama sınırı komutları yeni Vercel CLI'da (65+) var; eskiyse araç `npx vercel@latest` ile en yenisini kullanır.

### Güvenlik

- Panel sadece `127.0.0.1`'de açılır. Her açılışta rastgele bir anahtar üretilir; tarayıcındaki başka bir site araca istek atamaz.
- Tarayıcı düzeltme isteğinde proje adı göndermez; sadece taramanın bulduğu düzeltmenin numarasını gönderir.
- Bulunan anahtarlar ekranda maskelenir (`sk-pro…aaa`) ve hiçbir yere gönderilmez.
- Elle kontrol cevapların sadece `~/.vibeamigo/answers.json` içinde saklanır.

### Ne yapmaz?

- Kendi 7/24 "acil kapatma" sistemini çalıştırmaz. Platformların kendi şalterini (Vercel'de "Pause Production Deployments" gibi) senin onayınla açar.
- Hiçbir şeyi silmez.
- %100 koruma vaat etmez. Firewall her saldırıyı durdurmaz; asıl koruma harcama sınırıdır.

---

## English

### Why?

Your firewall can be on and you can still get a $1,000 bill. A firewall is a filter, not a spending cap. The real protection is a spending limit you can afford to lose, plus the setting that pauses your site when you hit it. Most platforms have it. It's usually off.

### What it checks

| Service | Check | How |
|---|---|---|
| **Vercel** | Is there a monthly spending limit, and is it sensible? | Automatic, fixable |
| | Do sites pause at the limit? | Automatic, fixable |
| | Does every site have a rate limit rule? | Automatic, fixable |
| | Are preview deployments private? | Automatic, fixable |
| | This month's usage, overage, last 14 days | Automatic |
| **Code** | Secret keys in code or Git history | Automatic |
| | `.env` committed to Git | Automatic |
| | Next.js `remotePatterns` too wide | Automatic |
| **OpenAI, Claude, Gemini, Supabase, Twilio, ElevenLabs** | Spend cap / auto-recharge | If your project uses it: link + question |

A setting we can't verify is never shown as safe.

### How it works

1. Run `npx github:sedattkahraman/vibeamigo` in your project folder. A panel opens in your browser.
2. No new keys for Vercel: it uses your existing `vercel login` session.
3. Every fix shows exactly what it will do and waits for your approval.

Requires Node.js 20+ and `vercel login` for the Vercel checks.

### Security

- The panel binds to `127.0.0.1` only, with a random per-session token. Other sites in your browser can't call it.
- Fix requests carry only an ID from the last scan, never project names.
- Found keys are masked on screen and never sent anywhere.
- Your manual answers stay in `~/.vibeamigo/answers.json`.

Found a security issue? Please open a private advisory on GitHub instead of a public issue.

## License

MIT — Sedat Kahraman, [sedatkahraman.com](https://sedatkahraman.com)
