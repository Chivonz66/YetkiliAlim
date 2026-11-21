#!/usr/bin/env node
// Luminacraft Staff Center — ilk yöneticiyi oluşturma aracı (Node ESM)
//
// Kullanım (örnek; gerçek değerler asla bu dosyaya yazılmaz):
//   SUPABASE_URL=https://<proje>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<servis anahtarı> \
//   ADMIN_USERNAME=<kullanıcı adı> ADMIN_PASSWORD=<en az 12 karakter> \
//   node scripts/create-first-admin.mjs
//
// Parola özeti biçimi: pbkdf2$210000$<saltHex>$<hashHex>
// PBKDF2-SHA256, 210000 yineleme, 16 bayt tuz, 32 bayt anahtar.
// Ham parola, oturum anahtarı veya servis anahtarı diske yazılmaz ve günlüğe basılmaz.
//
// Zaten bir yönetici varsa araç reddeder. Bilinçli değiştirmek için:
//   ALLOW_REPLACE_ADMIN=1 SETUP_TOKEN=LUMINACRAFT-ADMIN-REPLACE-ONAY \
//   node scripts/create-first-admin.mjs
// SETUP_TOKEN bir onay ifadesidir (kimlik bilgisi değildir); yalnızca bu dokümanda yer alır.

import { pbkdf2Sync, randomBytes } from 'node:crypto'

const ITERASYON = 210000
const ANAHTAR_UZUNLUGU = 32
const TUZ_UZUNLUGU = 16
const OZET_ALGORITMASI = 'sha256'
const OZET_ON_EKI = 'pbkdf2$210000$'
const ONAY_IFADESI = 'LUMINACRAFT-ADMIN-REPLACE-ONAY'

function mesaj(yazi) {
  console.log(yazi)
}

function hata(yazi) {
  console.error(yazi)
}

function ortamiOku() {
  const ayarlar = {
    supabaseUrl: process.env.SUPABASE_URL,
    servisAnahtari: process.env.SUPABASE_SERVICE_ROLE_KEY,
    kullaniciAdi: process.env.ADMIN_USERNAME,
    parola: process.env.ADMIN_PASSWORD,
  }

  const eksik = Object.entries(ayarlar)
    .filter(([, deger]) => typeof deger !== 'string' || deger.trim() === '')
    .map(([anahtar]) => anahtar)

  if (eksik.length > 0) {
    throw new Error(`Eksik ortam değişkenleri: ${eksik.join(', ')}.`)
  }

  return ayarlar
}

function parolayiDogrula(parola) {
  if (parola.length < 12) {
    throw new Error('ADMIN_PASSWORD en az 12 karakter olmalıdır.')
  }
}

function kullaniciAdiniDogrula(kullaniciAdi) {
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(kullaniciAdi)) {
    throw new Error('ADMIN_USERNAME 3-32 karakter olmalı ve yalnızca harf, rakam, _, . veya - içermelidir.')
  }
}

function parolayiOzetle(parola) {
  const tuz = randomBytes(TUZ_UZUNLUGU)
  const ozet = pbkdf2Sync(parola, tuz, ITERASYON, ANAHTAR_UZUNLUGU, OZET_ALGORITMASI)
  return `${OZET_ON_EKI}${tuz.toString('hex')}$${ozet.toString('hex')}`
}

function olusturBasliklar(servisAnahtari, ekBasliklar = {}) {
  return {
    apikey: servisAnahtari,
    Authorization: `Bearer ${servisAnahtari}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
    ...ekBasliklar,
  }
}

async function istekAt(url, secenekler, karsiyaCikma) {
  let yanit
  try {
    yanit = await fetch(url, secenekler)
  } catch {
    throw new Error(`${karsiyaCikma} sırasında Supabase'e ulaşılamadı.`)
  }

  if (!yanit.ok) {
    throw new Error(`${karsiyaCikma} başarısız (HTTP ${yanit.status}).`)
  }
  return yanit
}

async function satirlariOku(yanit) {
  try {
    const veri = await yanit.json()
    return Array.isArray(veri) ? veri : []
  } catch {
    return []
  }
}

/** Yeni kaydın beklenen özetle, kullanıcı adıyla ve aktif olarak yazıldığını doğrular. */
function yeniYoneticiDogru(satir, kullaniciAdi, parolaOzeti) {
  return Boolean(
    satir &&
      typeof satir.id === 'string' &&
      satir.is_active === true &&
      typeof satir.password_hash === 'string' &&
      satir.password_hash === parolaOzeti &&
      typeof satir.username === 'string' &&
      satir.username.toLowerCase() === kullaniciAdi.toLowerCase(),
  )
}

/**aktif admin sayısını kontrol eder; hiçbiri yoksa en az birini yeniden etkinleştirir. */
async function aktifYoneticiKaldi(tabahUrl, basliklar, yeniYoneticiId) {
  const listeUrl = `${tabahUrl}/rest/v1/admins?select=id&is_active=eq.true&limit=1`
  const yanit = await istekAt(listeUrl, { method: 'GET', headers: basliklar }, 'Aktif yönetici doğrulaması')
  if ((await satirlariOku(yanit)).length > 0) return true

  // Beklenmedik bir eşzamanlı güncelleme yeni kaydı pasifleştirdiyse geri alırız.
  await istekAt(
    `${tabahUrl}/rest/v1/admins?id=eq.${encodeURIComponent(yeniYoneticiId)}`,
    {
      method: 'PATCH',
      headers: basliklar,
      body: JSON.stringify({ is_active: true }),
    },
    'Aktif yöneticiyi geri yükleme',
  )
  const tekrar = await istekAt(listeUrl, { method: 'GET', headers: basliklar }, 'Aktif yönetici doğrulaması')
  return (await satirlariOku(tekrar)).length > 0
}

async function main() {
  mesaj('Adım 1/6: Ortam değişkenleri okunuyor...')
  const { supabaseUrl, servisAnahtari, kullaniciAdi, parola } = ortamiOku()
  const tabanUrl = supabaseUrl.replace(/\/+$/, '')
  parolayiDogrula(parola)
  kullaniciAdiniDogrula(kullaniciAdi)
  mesaj('Adım 1/6: Zorunlu alanlar ve parola uzunluğu geçerli.')

  const basliklar = olusturBasliklar(servisAnahtari)
  const gonderimBasliklari = olusturBasliklar(servisAnahtari, { Prefer: 'return=representation' })
  const listeUrl = `${tabanUrl}/rest/v1/admins?select=id&limit=1`

  mesaj('Adım 2/6: Parola PBKDF2-SHA256 (210000 yineleme) ile özetleniyor...')
  const parolaOzeti = parolayiOzetle(parola)

  mesaj('Adım 3/6: Mevcut yönetici kaydı kontrol ediliyor...')
  const listeYaniti = await istekAt(listeUrl, { method: 'GET', headers: basliklar }, 'Yönetici listesi sorgusu')
  const mevcut = await listeYaniti.json()

  let degistirme = false
  if (Array.isArray(mevcut) && mevcut.length > 0) {
    const degistirmeIzinli = process.env.ALLOW_REPLACE_ADMIN === '1'
    const onayDogru = process.env.SETUP_TOKEN === ONAY_IFADESI

    if (!degistirmeIzinli) {
      mesaj('İşlem reddedildi: Bu projede zaten bir yönetici var.')
      mesaj('Bilinçli bir değiştirme için ALLOW_REPLACE_ADMIN=1 ve SETUP_TOKEN değerini dokümandaki onay ifadesiyle birlikte ayarlayın.')
      process.exitCode = 1
      return
    }

    if (!onayDogru) {
      mesaj('İşlem reddedildi: ALLOW_REPLACE_ADMIN=1 için SETUP_TOKEN onay ifadesi eşleşmiyor.')
      process.exitCode = 1
      return
    }
    degistirme = true
  }

  // lower(username) benzersiz indeksi sayesinde ekleme atomiktir; aynı kullanıcı
  // adıyla ikinci bir yönetici oluşturulamaz.
  mesaj('Adım 4/6: Yeni yönetici kaydı oluşturuluyor...')
  const olusturmaYaniti = await istekAt(
    `${tabanUrl}/rest/v1/admins`,
    {
      method: 'POST',
      headers: gonderimBasliklari,
      body: JSON.stringify({ username: kullaniciAdi, password_hash: parolaOzeti }),
    },
    'Yönetici oluşturma',
  )
  const olusturulan = (await satirlariOku(olusturmaYaniti))[0]

  mesaj('Adım 5/6: Yeni yönetici satırı ve parola özeti doğrulanıyor...')
  const dogrulamaYaniti = await istekAt(
    `${tabanUrl}/rest/v1/admins?id=eq.${encodeURIComponent(olusturulan?.id ?? '')}&select=id,username,password_hash,is_active`,
    { method: 'GET', headers: gonderimBasliklari },
    'Yeni yönetici doğrulaması',
  )
  const dogrulanan = (await satirlariOku(dogrulamaYaniti)).find(
    (satir) => satir?.id === olusturulan?.id,
  )
  if (!yeniYoneticiDogru(dogrulanan, kullaniciAdi, parolaOzeti)) {
    throw new Error('Yeni yönetici doğrulanamadı; mevcut kayıtlar silinmedi.')
  }

  if (degistirme) {
    // KRİTİK: DELETE yalnızca yeni yönetici doğrulandıktan sonra çalışır ve
    // yeni kayıt asla silinmez; en az bir aktif yönetici korunur.
    mesaj('Adım 6/6: Doğrulama başarılı; yalnızca eski yönetici kayıtları kaldırılıyor...')
    const silmeUrl = `${tabanUrl}/rest/v1/admins?id=neq.${olusturulan.id}`
    await istekAt(silmeUrl, { method: 'DELETE', headers: basliklar }, 'Eski yöneticilerin silinmesi')
    if (!(await aktifYoneticiKaldi(tabanUrl, basliklar, olusturulan.id))) {
      throw new Error('En az bir aktif yönetici kalması doğrulanamadı.')
    }
  }

  mesaj('Tamamlandı: İlk yönetici başarıyla oluşturuldu.')
  mesaj('Güvenlik: Parola ve özet hiçbir yere yazılmadı; yalnızca özet veritabanında saklandı.')
}

main().catch((hataNesnesi) => {
  hata(`Hata: ${hataNesnesi instanceof Error ? hataNesnesi.message : 'Bilinmeyen bir sorun oluştu.'}`)
  process.exitCode = 1
})
