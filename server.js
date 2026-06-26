const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const https = require('https');

const TELEGRAM_TOKEN = '8688885911:AAGrkCzCKVeQc0X5RZto2Ghpc8ju5wpl8kA';
const CHAT_ID = '-5150678634';
const PORT = process.env.PORT || 8080;

// GÜVENLİK: Servis hesabı anahtarı ARTIK koda gömülü değil — Railway env değişkeni
// FIREBASE_SA'dan (ham JSON) okunur. Bu repo public olduğu için anahtar asla koda yazılmamalı.
if (!process.env.FIREBASE_SA) {
  console.error('HATA: FIREBASE_SA env değişkeni tanımlı değil. Railway Variables\'a servis hesabı JSON\'unu ekleyin.');
  process.exit(1);
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SA);
} catch (e) {
  console.error('HATA: FIREBASE_SA geçerli JSON değil:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function loadData(key) {
  try {
    const doc = await db.collection('config').doc(key).get();
    if (doc.exists) return JSON.parse(doc.data().value);
    return null;
  } catch (err) { console.error('Firestore:', key, err.message); return null; }
}

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => res.statusCode === 200 ? resolve(true) : reject(new Error(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function fDate(d) { return d ? new Date(d).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '-'; }
function fMoney(n) { return String.fromCharCode(8378) + Number(n || 0).toLocaleString('tr-TR'); }

// SABAH 07:45
async function sabahBildirimi() {
  try {
    const orders = await loadData('byp_orders');
    const today = new Date(new Date().toLocaleString('en-US', {timeZone:'Europe/Istanbul'})).toISOString().split('T')[0];
    const todayD = new Date(today + 'T00:00');
    const isSaturday = todayD.getDay() === 6;
    let tomorrowDate = '';
    if (isSaturday) {
      const tmr = new Date(todayD);
      tmr.setDate(tmr.getDate() + 1);
      tomorrowDate = tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');
    }

    if (!orders || !orders.length) { await sendTelegram('☀️ Günaydın! Bugün teslim edilecek sipariş yok.'); return; }

    const todayOrders = orders.filter(o => o.date === today && ['bekliyor','uretimde','hazir','sevkiyat'].includes(o.status)).sort((a,b) => (a.time||'99:99').localeCompare(b.time||'99:99'));
    const sundayOrders = isSaturday ? orders.filter(o => o.date === tomorrowDate && ['bekliyor','uretimde','hazir','sevkiyat'].includes(o.status)).sort((a,b) => (a.time||'99:99').localeCompare(b.time||'99:99')) : [];
    // Yarin sabah erken teslim siparisleri (yarin saat 10:00 oncesi teslim) - cumartesi-pazar mantigi disinda
    const earlyMorningOrders = !isSaturday ? orders.filter(o => o.date === tomorrowDate && (o.time||'99:99') < '10:00' && ['bekliyor','uretimde','hazir','sevkiyat'].includes(o.status)).sort((a,b) => (a.time||'99:99').localeCompare(b.time||'99:99')) : [];
    const overdueOrders = orders.filter(o => o.date < today && ['bekliyor','uretimde'].includes(o.status));
    const allWaiting = orders.filter(o => o.status === 'bekliyor');

    let msg = '☀️ <b>Günaydın Değerli Çalışma Arkadaşlarım</b>\n<b>By Pasta Sabah Bildirimi</b>\n📅 ' + fDate(today) + '\n\n';
    msg += '📊 <b>İstatistikler:</b>\n';
    msg += '🎂 Bugün hazır olması gereken: <b>' + todayOrders.length + '</b> sipariş\n';
    if (isSaturday && sundayOrders.length > 0) {
      msg += '🌙 Yarın pazar (bugün hazırlanmalı): <b>' + sundayOrders.length + '</b> sipariş\n';
    }
    if (!isSaturday && earlyMorningOrders.length > 0) {
      msg += '🌅 Yarın sabah erken teslim (bugün hazırlanmalı): <b>' + earlyMorningOrders.length + '</b> sipariş\n';
    }
    if (overdueOrders.length > 0) msg += '🔴 Gecikmiş: <b>' + overdueOrders.length + '</b>\n';
    msg += '\n';

    if (overdueOrders.length > 0) {
      msg += '🚨 <b>GECİKMİŞ SİPARİŞLER:</b>\n';
      overdueOrders.forEach(o => { msg += '  ⚠️ ' + o.orderNo + ' - ' + o.customer + ' (' + (o.branch||'') + ') Teslim: ' + fDate(o.date) + '\n'; });
      msg += '\n';
    }

    // Bugün hazırlanacak tüm siparişler tek bir sıra numarası akışıyla listelenir (pazar/erken teslim dahil)
    let sira = 0;
    if (todayOrders.length > 0) {
      msg += '📋 <b>BUGÜN HAZIR OLMASI GEREKENLER:</b>\n';
      todayOrders.forEach(o => {
        const e = {bekliyor:'⏳ Bekliyor',uretimde:'🔨 Üretimde',hazir:'✅ Hazır',sevkiyat:'🚗 Sevkiyat'};
        msg += '  <b>' + (++sira) + '.</b> ' + (e[o.status]||o.status) + ' | ' + o.orderNo + ' - ' + o.customer + '\n';
        msg += '     🍰 ' + o.size + ' - ' + o.coating + ' | 🕐 ' + o.time + ' | 🏪 ' + (o.branch||'') + '\n';
      });
      msg += '\n';
    }
    if (isSaturday && sundayOrders.length > 0) {
      msg += '🌙 <b>YARIN PAZAR — BUGÜN HAZIRLANMALI:</b>\n';
      msg += '<i>İşletme pazar günü tatil. Aşağıdaki siparişler bugün (cumartesi) hazırlanmalıdır.</i>\n\n';
      sundayOrders.forEach(o => {
        const e = {bekliyor:'⏳ Bekliyor',uretimde:'🔨 Üretimde',hazir:'✅ Hazır',sevkiyat:'🚗 Sevkiyat'};
        msg += '  <b>' + (++sira) + '.</b> ' + (e[o.status]||o.status) + ' | <b>' + o.orderNo + '</b> - ' + o.customer + ' <b>⚠ PAZAR TESLİM</b>\n';
        msg += '     🍰 ' + o.size + ' - ' + o.coating + ' | 🕐 ' + o.time + ' | 🏪 ' + (o.branch||'') + '\n';
      });
      msg += '\n';
    }
    if (!isSaturday && earlyMorningOrders.length > 0) {
      msg += '🌅 <b>YARIN SABAH ERKEN TESLİM — BUGÜN HAZIRLANMALI:</b>\n';
      msg += '<i>Aşağıdaki siparişler yarın sabah 10:00 öncesi teslim alınacak. Pastane sabah açılmadan hazır olmaları gerektiği için bugün (gece kapanışından önce) hazırlanmalıdır.</i>\n\n';
      earlyMorningOrders.forEach(o => {
        const e = {bekliyor:'⏳ Bekliyor',uretimde:'🔨 Üretimde',hazir:'✅ Hazır',sevkiyat:'🚗 Sevkiyat'};
        msg += '  <b>' + (++sira) + '.</b> ' + (e[o.status]||o.status) + ' | <b>' + o.orderNo + '</b> - ' + o.customer + ' <b>⚠ ' + o.time + '</b>\n';
        msg += '     🍰 ' + o.size + ' - ' + o.coating + ' | 🏪 ' + (o.branch||'') + '\n';
      });
      msg += '\n';
    }
    msg += '💪 Hayırlı mesailer!';
    await sendTelegram(msg);
  } catch (err) { console.error('Sabah hatasi:', err.message); }
}


const app = express();
app.use(express.json({limit: '10mb'}));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => res.json({ status: 'By Pasta Telegram Bot çalışıyor', time: new Date().toISOString() }));
app.get('/test', async (req, res) => { try { await sendTelegram('✅ By Pasta Telegram Bot — Test mesajı, sistem çalışıyor!'); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/sabah', async (req, res) => { await sabahBildirimi(); res.json({ ok: true }); });
app.get('/debug-sabah', async (req, res) => {
  try {
    const orders = await loadData('byp_orders');
    const trNow = new Date(new Date().toLocaleString('en-US', {timeZone:'Europe/Istanbul'}));
    const today = trNow.toISOString().split('T')[0];
    const ordersLen = orders ? orders.length : 'null';
    const todayOrders = orders ? orders.filter(o => o.date === today && ['bekliyor','uretimde','hazir','sevkiyat'].includes(o.status)).length : 0;
    const dates = orders ? [...new Set(orders.map(o=>o.date))].sort() : [];
    res.json({ trNow: trNow.toISOString(), today, ordersLen, todayOrders, allDates: dates, serverUtc: new Date().toISOString() });
  } catch(e) { res.json({ error: e.message }); }
});

// 2. Bugun alinan + bugune hazir siparis
app.post('/bugun-siparis', async (req, res) => {
  const { orderNo, customer, size, coating, time, branch, textTop } = req.body;
  let msg = '🎂 <b>BUGÜNE HAZIR SİPARİŞ</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🍰 ' + size + ' - ' + coating + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '🕐 Teslim saati: ' + time + '\n';
  if (textTop) msg += '✍️ Yazı: "' + textTop + '"';
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Iptal bildirimi
app.post('/iptal', async (req, res) => {
  const { orderNo, customer, branch, reason, by, status } = req.body;
  const sl = {uretimde:'ÜRETİMDE',bekliyor:'BUGÜNE HAZIR'};
  let msg = '❌ <b>SİPARİŞ İPTAL EDİLDİ</b>\n';
  msg += '⚠️ Durum: <b>' + (sl[status]||status) + '</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '📌 Gerekçe: ' + reason + '\n';
  msg += '👷 İptal eden: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Bekleyen siparis iptal
app.post('/bekleyen-iptal', async (req, res) => {
  const { orderNo, customer, branch, reason, by, delivDate } = req.body;
  let msg = '❌ <b>BEKLEYEN SİPARİŞ İPTAL EDİLDİ</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '📅 Teslim tarihi: ' + delivDate + '\n';
  msg += '📌 Gerekçe: ' + reason + '\n';
  msg += '👷 İptal eden: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. ACIL - tarihi bugune alinan
app.post('/acil', async (req, res) => {
  const { orderNo, customer, size, coating, branch, time, reason, by, oldDate } = req.body;
  let msg = '🚨 <b>ACİL SİPARİŞ!</b>\n\n';
  msg += '⏰ Tarihi öne alındı — BUGÜN\n';
  msg += '📅 Eski tarih: ' + oldDate + '\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🍰 ' + size + ' - ' + coating + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '🕐 Teslim saati: ' + time + '\n';
  msg += '📌 Gerekçe: ' + reason + '\n';
  msg += '👷 Güncelleyen: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5b. Tarih guncelleme (bugune cekilmeyen tum tarih degisiklikleri - one/ileri)
app.post('/tarih-guncelleme', async (req, res) => {
  const { orderNo, customer, size, coating, branch, time, reason, by, oldDate, newDate, dir } = req.body;
  const yon = dir === 'ileri' ? 'ileri alındı ⏩' : 'öne alındı ⏪';
  let msg = '📅 <b>TESLİM TARİHİ DEĞİŞTİ</b>\n';
  msg += '🔄 Tarih ' + yon + '\n\n';
  msg += '📅 Eski tarih: ' + oldDate + '\n';
  msg += '📅 Yeni tarih: <b>' + newDate + '</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🍰 ' + (size||'-') + ' - ' + (coating||'-') + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '🕐 Teslim saati: ' + (time||'-') + '\n';
  msg += '📌 Gerekçe: ' + reason + '\n';
  msg += '👷 Güncelleyen: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5c. Saat guncelleme (tum saat degisiklikleri - one/ileri)
app.post('/saat-guncelleme', async (req, res) => {
  const { orderNo, customer, size, coating, branch, date, reason, by, oldTime, newTime, dir } = req.body;
  const yon = dir === 'ileri' ? 'ileri alındı ⏩' : 'öne alındı ⏪';
  let msg = '🕐 <b>TESLİM SAATİ DEĞİŞTİ</b>\n';
  msg += '🔄 Saat ' + yon + '\n\n';
  msg += '🕐 Eski saat: ' + oldTime + '\n';
  msg += '🕐 Yeni saat: <b>' + newTime + '</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🍰 ' + (size||'-') + ' - ' + (coating||'-') + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '📅 Teslim tarihi: ' + (date||'-') + '\n';
  msg += '📌 Gerekçe: ' + reason + '\n';
  msg += '👷 Güncelleyen: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Teslim edilemedi
app.post('/teslim-edilemedi', async (req, res) => {
  const { orderNo, customer, branch, reason, by } = req.body;
  let msg = '⚠️ <b>TESLİM EDİLEMEDİ!</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '📌 Gerekçe: ' + reason + '\n';
  msg += '👷 Kaydeden: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Musteri geri bildirimi
app.post('/geri-bildirim', async (req, res) => {
  const { orderNo, customer, branch, feedback, by, deliveryDate, submittedAt } = req.body;
  let msg = '⭐ <b>MÜŞTERİ GERİ BİLDİRİMİ</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  if (deliveryDate) msg += '📅 Teslim tarihi: ' + deliveryDate + '\n';
  msg += '💬 Değerlendirme: ' + feedback + '\n';
  msg += '📌 Kaynak: ' + by;
  if (submittedAt) msg += '\n🕒 Geri bildirim tarihi: ' + submittedAt;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/tezgahtar-notu', async (req, res) => {
  const { orderNo, customer, branch, note, by } = req.body;
  let msg = '📝 <b>TEZGAHTAR NOTU</b>\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '✏️ Not: ' + note + '\n';
  msg += '👷 Yazan: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
// 9. Uretime geri gonderme (iade)
app.post('/order-rework', async (req, res) => {
  const { order, reworkCount, reason, sentBy, sentByRole } = req.body;
  if (!order) return res.status(400).json({ error: 'order zorunlu' });
  let msg = '🔴 <b>URETIME GERI GONDERILDI - IADE</b>' + String.fromCharCode(10) + String.fromCharCode(10);
  msg += '📋 Sipariş: <b>' + (order.orderNo||'') + '</b>' + String.fromCharCode(10);
  msg += '👤 Müşteri: ' + (order.customer||'') + String.fromCharCode(10);
  msg += '🏪 Şube: ' + (order.branch||'-') + String.fromCharCode(10);
  msg += '🔢 İade No: <b>' + (reworkCount||1) + '. iade</b>' + String.fromCharCode(10);
  msg += '📌 Sebep: ' + (reason||'-') + String.fromCharCode(10);
  msg += '👷 Geri gönderen: ' + (sentBy||'-') + (sentByRole?(' (' + sentByRole + ')'):'') + String.fromCharCode(10) + String.fromCharCode(10);
  msg += '⚡ Pasta üretim panosunda <b>Üretimde</b> sütununa kırmızı bantlı olarak geri döndü.';
  if(reworkCount && reworkCount > 1){
    msg += String.fromCharCode(10) + String.fromCharCode(10) + '⚠️ <b>Bu sipariş ' + reworkCount + '. kez iade edildi!</b>';
  }
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});


// MILESTONE — Ay içi 100. (200., 300. ...) sipariş bildirimi
app.post('/milestone', async (req, res) => {
  const { milestoneNo, orderNo, customer, phone, branch, size, coating, price, discount, discounted, applied, by, date, time } = req.body;
  const indirimSatiri = applied
    ? '🎁 Otomatik %5 indirim uygulandı\n💰 Fiyat: <s>' + fMoney(price) + '</s> → <b>' + fMoney(discounted) + '</b>'
    : 'ℹ️ Manuel indirim (%' + discount + ') zaten uygulanmış, milestone indirimi devreye girmedi\n💰 Fiyat: <b>' + fMoney(discounted) + '</b>';
  let msg = '🎉 <b>' + milestoneNo + '. SİPARİŞ!</b>\n';
  msg += '📊 Bu ay ' + milestoneNo + '. siparişe ulaşıldı!\n\n';
  msg += '📋 Sipariş: <b>' + orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + customer + '\n';
  msg += '📞 ' + (phone || '-') + '\n';
  msg += '🏪 Şube: ' + (branch || '-') + '\n';
  msg += '🎂 ' + (size || '-') + ' · ' + (coating || '-') + '\n';
  msg += '📅 Teslim: ' + (date || '-') + ' - ' + (time || '-') + '\n';
  msg += '👷 Alan: ' + (by || '-') + '\n\n';
  msg += indirimSatiri;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});


// 10. VIP / Ozel siparis bildirimi
app.post('/order-vip', async (req, res) => {
  const { orderNo, customer, phone, branch, size, coating, complexity, layers, price, reason, vipBy, vipByRole, staffName, date, time } = req.body;
  let msg = '🚨 <b>ÖZEL / VIP SİPARİŞ ALINDI</b>\n\n';
  msg += '📋 Sipariş: <b>' + (orderNo||'-') + '</b>\n';
  msg += '👤 Müşteri: ' + (customer||'-') + '\n';
  msg += '📞 Telefon: ' + (phone||'-') + '\n';
  msg += '🏪 Şube: ' + (branch||'-') + '\n';
  msg += '🎂 ' + (size||'-') + ' · ' + (coating||'-') + (complexity?(' · '+complexity):'') + (layers?(' · '+layers+' kat'):'') + '\n';
  msg += '💰 Fiyat: ' + fMoney(price||0) + '\n';
  msg += '📅 Teslim: ' + (date||'-') + ' - ' + (time||'-') + '\n';
  msg += '👷 Siparişi alan: ' + (staffName||'-') + '\n';
  msg += '✓ VIP modu aktif eden: ' + (vipBy||'-') + (vipByRole?(' (' + vipByRole + ')'):'') + '\n\n';
  msg += '🔴 <b>GEREKÇE:</b>\n' + (reason||'-') + '\n\n';
  msg += '⚡ Bu siparişte standart kurallar (saat sınırı, karmaşıklık, çok kat) uygulanmamıştır.';
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// CRON: Sabah 07:45 Turkiye
cron.schedule('45 7 * * *', () => { console.log('CRON: Sabah'); sabahBildirimi(); }, { timezone: 'Europe/Istanbul' });

// CRON: Gece 23:00 — yarim kalan isler
cron.schedule('0 23 * * *', () => { console.log('CRON: Yarim kalan isler'); yarimKalanlar(); }, { timezone: 'Europe/Istanbul' });
// Her akşam 20:00: geri bildirim hatırlatması (teslim edilmiş, geri bildirimi istenmemiş siparişler)
cron.schedule('0 20 * * *', () => { console.log('CRON: Geri bildirim hatirlatmasi'); geriBildirimHatirlatma(); }, { timezone: 'Europe/Istanbul' });

// YARIM KALAN ISLER — gun sonunda tamamlanmamis siparisler
async function yarimKalanlar() {
  console.log('Yarim kalan isler kontrolu...');
  try {
    const orders = await loadData('byp_orders');
    if (!orders || !orders.length) return;

    const now = new Date(new Date().toLocaleString('en-US', {timeZone:'Europe/Istanbul'}));
    const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

    const stuck = orders.filter(o =>
      o.date === today &&
      ['bekliyor', 'uretimde', 'hazir', 'sevkiyat'].includes(o.status)
    );

    if (stuck.length === 0) return;

    const byStatus = {};
    stuck.forEach(o => {
      if (!byStatus[o.status]) byStatus[o.status] = [];
      byStatus[o.status].push(o);
    });

    const statusLabel = {bekliyor:'⏳ BEKLIYOR', uretimde:'🔨 ÜRETİMDE', hazir:'✅ HAZIR', sevkiyat:'🚗 SEVKİYATTA'};

    let msg = '🔴 <b>DİKKAT! ARADA KALAN SİPARİŞLER</b>\n';
    msg += '📅 Bugün teslim edilmesi gerekip de tamamlanmamış siparişler:\n\n';
    msg += '📊 Toplam: <b>' + stuck.length + '</b> sipariş\n\n';

    Object.entries(byStatus).forEach(function(entry) {
      const status = entry[0];
      const list = entry[1];
      msg += '<b>' + (statusLabel[status] || status) + ' (' + list.length + '):</b>\n';
      list.forEach(o => {
        msg += '  📋 ' + o.orderNo + ' - ' + o.customer + ' (🏪 ' + (o.branch||'') + ') 🕐 ' + o.time + '\n';
      });
      msg += '\n';
    });

    msg += '⚠️ Bu siparişler ya iptal edilmeli, ya teslim edildi ya da teslim edilemedi olarak güncellenmelidir!';

    await sendTelegram(msg);
  } catch (err) { console.error('Yarim kalan isler hatasi:', err.message); }
}

// Manuel endpoint
app.post('/yarim-kalan', async (req, res) => { await yarimKalanlar(); res.json({ ok: true }); });

// GERİ BİLDİRİM HATIRLATMASI — her akşam: teslim edilmiş ama geri bildirimi istenmemiş siparişler
async function geriBildirimHatirlatma() {
  console.log('Geri bildirim hatirlatmasi...');
  try {
    const orders = await loadData('byp_orders');
    if (!orders || !orders.length) return;
    const now = new Date(new Date().toLocaleString('en-US', {timeZone:'Europe/Istanbul'}));
    const dStr = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const y = new Date(now); y.setDate(now.getDate()-1);
    // Son 2 gün ile sınırlı: yalnızca dün ve evvelsi gün teslim edilenler hatırlatılır.
    // Daha eski teslimler için hatırlatma GÖNDERİLMEZ (kullanıcı isteği).
    const lo = new Date(now); lo.setDate(now.getDate()-2);
    const yStr = dStr(y), oStr = dStr(lo);
    const pending = orders.filter(o =>
      o.status === 'teslim' && !o.customerFeedback && !o.fbRequestedAt &&
      (o.phone||'').trim() && (o.date||'') <= yStr && (o.date||'') >= oStr
    ).sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
    if (!pending.length) return; // bekleyen yoksa sessiz geç
    const shortD = d => { try { return new Date(d+'T00:00').toLocaleDateString('tr-TR',{day:'numeric',month:'long'}); } catch(e){ return d||'-'; } };
    let msg = '📲 <b>GERİ BİLDİRİM HATIRLATMASI</b>\n';
    msg += '<i>Teslim edilmiş, henüz geri bildirim istenmemiş siparişler. Panelden "📲 Toplu geri bildirim" ile gönderin.</i>\n\n';
    msg += '📊 Bekleyen: <b>' + pending.length + '</b> sipariş\n\n';
    pending.slice(0,30).forEach(o => { msg += '  • ' + o.orderNo + ' — ' + o.customer + ' (🗓️ ' + shortD(o.date) + ')\n'; });
    if (pending.length > 30) msg += '\n…ve ' + (pending.length - 30) + ' sipariş daha.';
    await sendTelegram(msg);
  } catch (err) { console.error('Geri bildirim hatirlatmasi hatasi:', err.message); }
}
app.post('/geri-bildirim-hatirlatma', async (req, res) => { await geriBildirimHatirlatma(); res.json({ ok: true }); });

// MÜŞTERİ ONAYI — müşteri confirm.html'den veya tezgahtar manuel onayladığında
// Kaybolup gölge kayıttan otomatik geri yüklenen sipariş — DİKKAT çekici uyarı
app.post('/order-recovered', async (req, res) => {
  try {
    const o = req.body || {};
    let msg = '🛟 <b>OTOMATİK KURTARILAN SİPARİŞ</b>\n';
    msg += '<i>Sistemden kaybolmuş bir sipariş gölge kayıttan geri yüklendi. Lütfen siparişi açıp bilgilerini kontrol edin.</i>\n\n';
    msg += '📋 Sipariş: <b>' + (o.orderNo || '-') + '</b>\n';
    msg += '👤 Müşteri: ' + (o.customer || '-') + '\n';
    if (o.date) msg += '📅 Teslim: ' + o.date + (o.time ? ' - ' + o.time : '') + '\n';
    if (o.branch) msg += '🏪 Şube: ' + o.branch + '\n';
    await sendTelegram(msg);
    res.json({ ok: true });
  } catch (err) { console.error('order-recovered:', err.message); res.status(500).json({ error: err.message }); }
});

app.post('/order-confirmed', async (req, res) => {
  const { order, method, staff } = req.body;
  if (!order) return res.status(400).json({ error: 'order gerekli' });
  const dateFmt = new Date(order.date + 'T00:00').toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  
  // Onay yöntemine göre başlık
  let title = '✅ <b>MÜŞTERİ SİPARİŞİ ONAYLADI</b>';
  let methodInfo = '';
  if (method === 'phone') {
    title = '📞 <b>SİPARİŞ TELEFONLA ONAYLANDI</b>';
    methodInfo = '\n👷 Onay alan: ' + (staff || '-') + '\n';
  } else if (method === 'signature') {
    title = '✍️ <b>SİPARİŞ FİŞİ İMZALANDI</b>';
    methodInfo = '\n👷 İmzalatan: ' + (staff || '-') + '\n';
  } else if (order.confirmedByAdmin) {
    title = '👤 <b>SİPARİŞ YÖNETİCİ TARAFINDAN ONAYLANDI</b>';
    methodInfo = '\n👷 Yönetici: ' + order.confirmedByAdmin + '\n';
  }
  
  let msg = title + '\n\n';
  msg += '📋 Sipariş: <b>' + order.orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + order.customer + '\n';
  msg += '📅 Teslim: ' + dateFmt + ' - ' + (order.time || '-') + '\n';
  msg += '🏪 Teslim Şubesi: ' + (order.delBranch || order.branch || '-') + methodInfo + '\n';
  msg += '🎂 Sipariş üretime alınabilir.';
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// MÜŞTERİ HATA BİLDİRDİ — müşteri confirm.html'de hata bildirdiğinde
app.post('/order-rejected', async (req, res) => {
  const { order, note } = req.body;
  if (!order) return res.status(400).json({ error: 'order gerekli' });
  const dateFmt = new Date(order.date + 'T00:00').toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let msg = '⚠️ <b>MÜŞTERİ HATA BİLDİRDİ!</b>\n\n';
  msg += '📋 Sipariş: <b>' + order.orderNo + '</b>\n';
  msg += '👤 Müşteri: ' + order.customer + '\n';
  msg += '📞 Telefon: ' + (order.phone || '-') + '\n';
  msg += '👷 Siparişi alan: ' + (order.staffName || '-') + (order.branch ? ' (' + order.branch + ')' : '') + '\n';
  msg += '📅 Teslim: ' + dateFmt + ' - ' + (order.time || '-') + '\n\n';
  msg += '📝 <b>Müşteri Notu:</b>\n' + (note || '-') + '\n\n';
  msg += '🚨 Lütfen müşteri ile iletişime geçip bilgileri düzeltin.';
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
// AI FIYAT TAHMINI PROXY — tarayicidan CORS engeli oldugu icin Railway uzerinden
app.post('/ai-fiyat', async (req, res) => {
  const { base64, mediaType, priceInfo } = req.body;
  if (!base64 || !priceInfo) return res.status(400).json({ error: 'base64 ve priceInfo zorunlu' });
  
  try {
    const data = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } },
          { type: 'text', text: 'Bu bir pasta gorseli. Bu pastayi analiz et ve asagidaki fiyatlandirma parametrelerine gore tahmini fiyat hesapla.\n\n' + priceInfo + '\n\nFormul: (ebat + kaplama + dolgu + altlik + sekil + renk + cicek + figur) x karmasiklik x kat carpani\n\nSADECE JSON formatinda yanit ver, baska hicbir sey yazma:\n{"ebat":"tahmini ebat adi","kaplama":"krem santi veya seker hamuru","dolgu":"tahmini dolgu","karmasiklik":"basit/orta/zor/ozel","kat":1,"sekil":"normal/kalp/retro/baton","renk_sayisi":1,"cicek":"varsa turu, yoksa yok","figur":"varsa turu, yoksa yok","altlik":"varsa turu, yoksa yok","tahmini_fiyat":0,"aciklama":"kisa aciklama"}' }
        ]
      }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      const chunks = [];
      apiRes.on('data', c => chunks.push(c));
      apiRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const result = JSON.parse(body);
          res.json(result);
        } catch (e) {
          res.status(500).json({ error: 'API yanit parse hatasi', raw: body.substring(0, 500) });
        }
      });
    });
    apiReq.on('error', (e) => res.status(500).json({ error: e.message }));
    apiReq.write(data);
    apiReq.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI MÜŞTERİ YORUMU YANITI — müşteri yorumuna marka sesiyle nazik bir cevap taslağı üretir
app.post('/ai-yorum-cevap', async (req, res) => {
  const { comment, visual, taste, service, customer, orderNo } = req.body;
  try {
    const firstName = String(customer || '').trim().split(/\s+/)[0] || 'değerli müşterimiz';
    const ratingTxt = [visual, taste, service].some(v => v != null)
      ? `Görsel: ${visual ?? '-'}/5, Lezzet: ${taste ?? '-'}/5, Hizmet: ${service ?? '-'}/5`
      : 'Puan belirtilmemiş';
    const sys = 'Sen By Pasta adlı butik pasta markasının müşteri ilişkileri sorumlususun. '
      + 'Müşterilerin sipariş sonrası bıraktığı yorumlara WhatsApp üzerinden gönderilecek kısa, samimi ve profesyonel bir Türkçe yanıt yazarsın. '
      + 'Kurallar: Müşteriye adıyla nazikçe hitap et. Olumlu yorumlarda içtenlikle teşekkür et. '
      + 'Olumsuz/eleştirel yorumlarda asla savunmacı, suçlayıcı veya soğuk olma; empati kur, gerekiyorsa özür dile, '
      + 'sorunu ciddiye aldığını belirt ve telafi/çözüm niyetini içtenlikle ifade et. '
      + 'Abartılı vaat verme, indirim/iade sözü verme (bunu işletme karar verir). '
      + '2-4 cümle, sıcak ama ölçülü bir dil, en fazla 1-2 uygun emoji. Sonunda "By Pasta" imzası. '
      + 'SADECE gönderilecek yanıt metnini yaz, başka hiçbir açıklama, başlık veya tırnak ekleme.';
    const userText = `Müşteri adı: ${firstName}\nSipariş no: ${orderNo || '-'}\nPuanlar: ${ratingTxt}\nMüşteri yorumu: "${(comment || '').trim() || '(yorum yazmamış, sadece puan vermiş)'}"`;
    const data = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: sys,
      messages: [{ role: 'user', content: userText }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const apiReq = https.request(options, (apiRes) => {
      const chunks = [];
      apiRes.on('data', c => chunks.push(c));
      apiRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try { res.json(JSON.parse(body)); }
        catch (e) { res.status(500).json({ error: 'API yanit parse hatasi', raw: body.substring(0, 500) }); }
      });
    });
    apiReq.on('error', (e) => res.status(500).json({ error: e.message }));
    apiReq.write(data);
    apiReq.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BETA GERI BILDIRIM — kullanici tarafindan bildirilmis sorun/oneri
app.post('/feedback', async (req, res) => {
  const { message, docId } = req.body;
  if (!message) return res.status(400).json({ error: 'message zorunlu' });
  try {
    await sendTelegram(message);
    res.json({ ok: true, docId: docId || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => { console.log('By Pasta Telegram Bot - Port: ' + PORT + ' | Cron: 07:45 sabah, 20:00 geri bildirim, 23:00 yarim kalanlar'); });
