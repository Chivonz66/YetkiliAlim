# Discord OAuth2 ve Bot Bildirimleri

Discord entegrasyonu **opsiyoneldir**. Başvuru formu, takip ve yönetim paneli Discord olmadan da çalışır (`app_settings.discord_enabled` varsayılan `false`). İki ayrı özellik vardır:

1. **OAuth2 bağlama** (`discord-oauth`): Başvuranın Discord kullanıcısını başvuruya bağlar.
2. **DM bildirimi** (`discord-notify`): Karar (kabul/red) sonrası kullanıcıya özel mesaj gönderir.

---

## 1. Discord uygulaması oluştur

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → ad: `Luminacraft Staff Center`.
2. **OAuth2 → General** ekranında **Client ID** ve **Client Secret** değerlerini kopyalayın. Client Secret'ı kimseyle paylaşmayın.
3. **Redirects** alanına **Add Redirect** ile şu adresi girin (Supabase proje URL'nizin sonunda `/` olmadığına dikkat edin):

```
<SUPABASE_URL>/functions/v1/discord-oauth?action=callback
```

Örnek placeholder: `https://sizin-projeniz.supabase.co/functions/v1/discord-oauth?action=callback`

Bu adres `DISCORD_REDIRECT_URI` Edge secret'ı ile **birebir aynı** olmalıdır; farklı olursa Discord `invalid_state` hatası döner. Sorgu dizisindeki `action=callback` önemlidir: uç, eylemi bu parametreden okur (ayrıca `/callback` yolu da desteklenir).

4. **OAuth2 → URL Generator**: `identify` kapsamını seçin. Kod yalnızca `identify` ister (kullanıcı adı ve Discord ID); e-posta, rol veya sunucu erişimi istemez.

## 2. Bot oluştur ve izinleri ayarla

1. Uygulama içinde **Bot → Add Bot** (zaten varsa **Reset Token** kullanmayın, mevcut token'ı alın).
2. Bot sayfasındaki **Token** değerini kopyalayın → bu `DISCORD_BOT_TOKEN` olur. **Yalnızca Edge Functions secret'ına yazın**; `.env`, istemci kodu, README veya GitHub Actions dosyasına koymayın.
3. Bot'u Luminacraft sunucusuna davet edin (**OAuth2 → URL Generator**: `bot` kapsamı, gereken minimum izinlerle). DM göndermek için botun kullanıcıyla ortak bir sunucuda bulunması gerekir.
4. Kullanıcıların **Gizlilik Ayarları → DM'ler** kısmında "Sunucu üyelerinden DM al" seçeneği açık olmalıdır. Aksi halde mesaj gönderilemez.
5. **Önemli:** Kullanıcıya DM göndermek için **Privileged Gateway Intents** (MESSAGE CONTENT INTENT / PRESENCE INTENT / SERVER MEMBERS INTENT) **gerekmez**. Bu intents mesaj içeriğini okumak içindir; bot yalnızca kendi DM kanalını açıp mesaj gönderdiği için etkin olmaları şart değildir. Gereksiz yere açmayın.

## 3. Edge gizli anahtarlarını tanımla

```bash
supabase secrets set \
  DISCORD_CLIENT_ID=<uygulama-client-id> \
  DISCORD_CLIENT_SECRET=<uygulama-client-secret> \
  DISCORD_REDIRECT_URI=https://sizin-projeniz.supabase.co/functions/v1/discord-oauth?action=callback \
  DISCORD_BOT_TOKEN=<bot-token> \
  SESSION_SECRET=<oturum-imza-sirri> \
  ALLOWED_ORIGINS=https://KULLANICI.github.io,http://localhost:5173
```

Ardından Discord uçlarını (yeniden) dağıtın:

```bash
supabase functions deploy discord-oauth --no-verify-jwt
supabase functions deploy discord-notify --no-verify-jwt
```

| Secret | Nerede kullanılır | Tarayıcıya gider mi? |
| --- | --- | --- |
| `DISCORD_CLIENT_ID` | `discord-oauth`: yetkilendirme URL'si, token değişimi | Hayır |
| `DISCORD_CLIENT_SECRET` | `discord-oauth`: `authorization_code` → token değişimi | Hayır |
| `DISCORD_REDIRECT_URI` | `discord-oauth`: start/callback eşleşmesi | Hayır |
| `DISCORD_BOT_TOKEN` | `discord-notify`: `POST /users/@me/channels` ve mesaj gönderimi | Hayır |
| `SESSION_SECRET` | `discord-oauth`: `state` özeti (HMAC-SHA256) | Hayır |
| `ALLOWED_ORIGINS` | Callback sonrası güvenli dönüş adresi doğrulaması | Hayır |

Token değişimi başarılı olsa da **erişim belirteci hiçbir yere kaydedilmez ve loglara yazılmaz**; yalnızca Discord kullanıcı ID'si ve kullanıcı adı `discord_links` tablosuna yazılır. OAuth `state` değeri 32 rastgele bayttan üretilir, 10 dakika geçerli bir `HttpOnly`/`Secure`/`SameSite=None` çerezinde tutulur ve veritabanında yalnızca özeti saklanır.

## 4. Bağlama akışı (isteğe bağlı)

1. Başvuru sayfasında Discord bağlama bağlantısı `/functions/v1/discord-oauth?action=start&return_to=...` adresini çağırır.
2. Uç, Discord'un yetkilendirme ekranına yönlendirir (`scope=identify`, `prompt=consent`) ve `state` çerezini kurar.
3. Kullanıcı onaylayınca Discord tanımladığınız callback adresine `code` + `state` ile döner.
4. Uç, `state` çereziyle eşleşmeyi ve veritabanındaki özeti doğrular; kodu token ile değiştirir, `/users/@me` ile kullanıcıyı okur ve `discord_links` kaydını günceller.
5. Kullanıcı güvenli bir `return_to` adresine `?discord=linked&username=...` ile döner. açık yönlendirme (open redirect) engellenir; adres `ALLOWED_ORIGINS` listesindeki originlerle sınırlıdır.

Bağlama zorunlu değildir. Başvuru formundaki Discord kullanıcı adı alanı her zaman doldurulur; bağlama yalnızca DM'nin hangi Discord ID'ye gönderileceğini belirler.

## 5. DM bildirimi ve başarısızlık davranışı

Yönetici bir başvuruyu `accepted` veya `rejected` yaptığında `notification_queue` tablosuna `pending` kayıt eklenir ve başvurunun `notification_status` alanı `pending` olur. Yönetici panelinden **Bildirimleri Gönder** (veya `discord-notify` `action=send`) çağrılır:

- Başarılıysa yanıt: `{ "ok": true, "notification_status": "sent", "application_id": "<uuid>" }`.
- Discord kullanıcısı bulunamazsa, DM kapalıysa veya bot token yoksa karar **geçersiz kılınmaz**; yanıt `200` ile `{ "ok": true, "notification_status": "failed", "error": "..." }` döner.
- Hata nedeni kuyruk kaydına (`error_message`) ve başvuruya (`notification_status='failed'`) yazılır.
- Kullanıcı DM'lerini açtıktan sonra yönetim panelindeki **Yeniden Dene** düğmesi `action=retry` ile aynı kuyruk kaydını tekrar gönderir; yeni bir karar oluşturulmaz.

Mesaj içeriği Türkçedir ve şu biçimdedir: `Merhaba! <TAKIP-NO> numaralı Luminacraft ekip başvurunuz kabul edildi/reddedildi. ...`

## 6. Sorun giderme

| Belirti | Sebep | Çözüm |
| --- | --- | --- |
| Discord'a yönlendirilince `Discord yapılandırması eksik` (503) | Client ID/Secret/Redirect URI secret'ları yok | `supabase secrets set` ile dört Discord değişkenini de ekleyip uçları yeniden dağıtın. |
| `invalid_state` | Redirect URI birebir eşleşmiyor, `state` çerezi silindi veya 10 dakika doldu | Developer Portal'daki Redirects ile `DISCORD_REDIRECT_URI` değerini karşılaştırın; akışı baştan başlatın. |
| `discord_auth` (401) | Kod süresi doldu veya Client Secret yanlış | Yeni bir yetkilendirme akışı başlatın; secret'ı Supabase Dashboard'dan doğrulayın. |
| Callback sonrası boş/yabancı adrese yönlendirme | `return_to` allowlist dışı veya `ALLOWED_ORIGINS` boş | Dönüş adresini `ALLOWED_ORIGINS` içine ekleyin; uç izinli originleri zaten zorunlu kılar. |
| DM gönderilemedi / `failed` | Kullanıcı DM'leri kapalı veya bot ortak sunucuda değil | Kullanıcıdan DM ayarını açmasını isteyin; botun sunucuda olduğunu doğrulayın; panelden **Yeniden Dene**. |
| "Privileged Intent açık mı?" şüphesi | Gereksiz endişe | Kullanıcı DM'leri için **privileged intent gerekmez**; yalnızca bot token ve ortak sunucu/DM izni gerekir. |
| `notification_status` hiç `pending` olmuyor | Karar `pending`/`reviewing` olarak verildi | Yalnızca `accepted`/`rejected` durumları bildirim kuyruğuna eklenir. |
| Bot token sızdı | Token yanlış yere yazıldı | Discord Developer Portal → Bot → **Reset Token**, yeni değeri yalnızca Supabase Edge Secret olarak güncelleyin. |
| Edge loglarında CORS hatası | Pages adresi `ALLOWED_ORIGINS` içinde yok | Origin'i ekleyip `discord-oauth`/`discord-notify` uçlarını yeniden dağıtın. |

Loglar için: Supabase Dashboard → **Edge Functions → seçilen uç → Logs**. Ayrıntılar ve diğer uçlar: [edge-functions.md](edge-functions.md), güvenlik gerekçeleri: [guvenlik.md](guvenlik.md).
