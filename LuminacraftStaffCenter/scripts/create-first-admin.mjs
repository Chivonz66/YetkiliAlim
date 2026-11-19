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
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

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

async function main() {
  mesaj('Adım 1/5: Ortam değişkenleri okunuyor...')
  const { supabaseUrl, servisAnahtari, kullaniciAdi, parola } = ortamiOku()
  const tabanUrl = supabaseUrl.replace(/\/+$/, '')
  parolayiDogrula(parola)
  kullaniciAdiniDogrula(kullaniciAdi)
  mesaj('Adım 1/5: Zorunlu alanlar ve parola uzunluğu geçerli.')

  const basliklar = olusturBasliklar(servisAnahtari)
  const listeUrl = `${tabanUrl}/rest/v1/admins?select=id&limit=1`

  mesaj('Adım 2/5: Mevcut yönetici kaydı kontrol ediliyor...')
  const listeYaniti = await istekAt(listeUrl, { method: 'GET', headers: basliklar }, 'Yönetici listesi sorgusu')
  const mevcut = await listeYaniti.json()

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

    mesaj('Adım 3/5: Onay doğrulandı; mevcut yönetici kayıtları kaldırılıyor...')
    const silmeUrl = `${tabanUrl}/rest/v1/admins?id=neq.${NIL_UUID}`
    await istekAt(silmeUrl, { method: 'DELETE', headers: basliklar }, 'Mevcut yöneticilerin silinmesi')
  } else {
    mesaj('Adım 3/5: Mevcut yönetici yok; doğrudan oluşturmaya geçiliyor.')
  }

  mesaj('Adım 4/5: Parola PBKDF2-SHA256 (210000 yineleme) ile özetleniyor...')
  const parolaOzeti = parolayiOzetle(parola)

  mesaj('Adım 5/5: Yönetici kaydı Supabase REST üzerinden oluşturuluyor...')
  const gonderim = {
    method: 'POST',
    headers: basliklar,
    body: JSON.stringify({ username: kullaniciAdi, password_hash: parolaOzeti }),
  }
  await istekAt(`${tabanUrl}/rest/v1/admins`, gonderim, 'Yönetici oluşturma')

  mesaj('Tamamlandı: İlk yönetici başarıyla oluşturuldu.')
  mesaj('Güvenlik: Parola ve özet hiçbir yere yazılmadı; yalnızca özet veritabanında saklandı.')
}

main().catch((hataNesnesi) => {
  hata(`Hata: ${hataNesnesi instanceof Error ? hataNesnesi.message : 'Bilinmeyen bir sorun oluştu.'}`)
  process.exitCode = 1
})
