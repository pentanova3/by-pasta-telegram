const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const https = require('https');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = '8688885911:AAGrkCzCKVeQc0X5RZto2Ghpc8ju5wpl8kA';
const CHAT_ID = '-5150678634';
const PORT = process.env.PORT || 8080;

// Firebase Admin SDK - service account olmadan Firestore'a bağlan
admin.initializeApp({
  projectId: 'by-pasta-siparis'
});
const db = admin.firestore();

// ==================== HELPERS ====================

// Firestore'dan veri oku (config koleksiyonu, JSON string olarak saklanıyor)
async function loadData(key) {
  try {
    const doc = await db.collection('config').doc(key).get();
    if (doc.exists) {
      return JSON.parse(doc.data().value);
    }
    return null;
  } catch (err) {
    console.error('Firestore okuma hatası:', key, err.message);
    return null;
  }
}

// Telegram mesaj gönder
function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('Telegram mesaj gönderildi');
          resolve(true);
        } else {
          console.error('Telegram hata:', body);
          reject(new Error(body));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Tarih formatla
function fDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function fMoney(n) {
  return '₺' + Number(n || 0).toLocaleString('tr-TR');
}

// ==================== SABAH 08:00 — ÜRETIM BİLDİRİMİ ====================
async function sabahBildirimi() {
  console.log('Sabah bildirimi çalışıyor...');
  try {
    const orders = await loadData('byp_orders');
    if (!orders || !orders.length) {
      await sendTelegram('☀️ <b>Günaydın!</b>\n\nBugün teslim edilecek sipariş yok.');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    
    // Bugün teslim edilecekler (bekliyor + üretimde + hazır + sevkiyat)
    const todayOrders = orders.filter(o => 
      o.date === today && 
      ['bekliyor', 'uretimde', 'hazir', 'sevkiyat'].includes(o.status)
    );

    // Gecikmiş siparişler
    const overdueOrders = orders.filter(o => 
      o.date < today && 
      ['bekliyor', 'uretimde'].includes(o.status)
    );

    // Toplam bekleyen
    const allWaiting = orders.filter(o => o.status === 'bekliyor');

    let msg = '☀️ <b>Günaydın! BY Pasta Üretim Bildirimi</b>\n';
    msg += `📅 ${fDate(today)}\n\n`;

    if (overdueOrders.length > 0) {
      msg += `🚨 <b>GECİKMİŞ SİPARİŞLER (${overdueOrders.length})</b>\n`;
      overdueOrders.forEach(o => {
        msg += `  ⚠️ ${o.orderNo} — ${o.customer} (${o.branch || ''})\n`;
        msg += `     ${o.size} · Teslim: ${fDate(o.date)}\n`;
      });
      msg += '\n';
    }

    if (todayOrders.length > 0) {
      msg += `📋 <b>BUGÜN TESLİM EDİLECEK (${todayOrders.length})</b>\n`;
      todayOrders.forEach(o => {
        const statusEmoji = {
          bekliyor: '🟠', uretimde: '🔵', hazir: '🟢', sevkiyat: '🚛'
        };
        msg += `  ${statusEmoji[o.status] || '⚪'} ${o.orderNo} — ${o.customer}\n`;
        msg += `     ${o.size} · ${o.coating} · ${o.time} · ${o.branch || ''}\n`;
      });
      msg += '\n';
    } else {
      msg += '✅ Bugün teslim edilecek sipariş yok.\n\n';
    }

    if (allWaiting.length > 0) {
      msg += `⏳ <b>TOPLAM BEKLEYEN: ${allWaiting.length}</b>\n`;
    }

    msg += '\n💪 Hayırlı mesailer!';

    await sendTelegram(msg);
  } catch (err) {
    console.error('Sabah bildirimi hatası:', err.message);
  }
}

// ==================== AKŞAM 20:00 — GÜN SONU RAPORU ====================
async function gunSonuRaporu() {
  console.log('Gün sonu raporu çalışıyor...');
  try {
    const orders = await loadData('byp_orders');
    if (!orders) {
      await sendTelegram('📊 <b>Gün Sonu Raporu</b>\n\nVeri okunamadı.');
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    // Bugün alınan siparişler
    const todayCreated = orders.filter(o => o.createdAt && o.createdAt.split('T')[0] === today);
    
    // Bugün teslim edilenler
    const todayDelivered = orders.filter(o => o.delivAt && o.delivAt.split('T')[0] === today && o.status === 'teslim');
    
    // Bugün iptal edilenler
    const todayCancelled = orders.filter(o => o.cancelledAt && o.cancelledAt.split('T')[0] === today && o.status === 'iptal');
    
    // Bugün teslim edilemeyenler
    const todayUndelivered = orders.filter(o => o.undeliveredAt && o.undeliveredAt.split('T')[0] === today && o.status === 'teslim_edilemedi');

    // Ciro
    const revenue = todayDelivered.reduce((s, o) => s + (o.discounted || o.price || 0), 0);
    const collected = todayDelivered.reduce((s, o) => s + (o.paid || 0), 0);

    // Hâlâ bekleyenler
    const stillWaiting = orders.filter(o => o.status === 'bekliyor');
    const stillInProd = orders.filter(o => o.status === 'uretimde');

    let msg = '📊 <b>BY Pasta — Gün Sonu Raporu</b>\n';
    msg += `📅 ${fDate(today)}\n\n`;

    msg += `📝 Bugün alınan: <b>${todayCreated.length}</b> sipariş\n`;
    msg += `✅ Teslim edilen: <b>${todayDelivered.length}</b>\n`;
    msg += `❌ İptal edilen: <b>${todayCancelled.length}</b>\n`;
    msg += `🚫 Teslim edilemeyen: <b>${todayUndelivered.length}</b>\n\n`;

    msg += `💰 <b>Günlük ciro: ${fMoney(revenue)}</b>\n`;
    msg += `💵 Tahsil edilen: ${fMoney(collected)}\n`;
    if (revenue - collected > 0) {
      msg += `⚠️ Kalan bakiye: ${fMoney(revenue - collected)}\n`;
    }
    msg += '\n';

    if (stillWaiting.length > 0 || stillInProd.length > 0) {
      msg += `⏳ Bekleyen: ${stillWaiting.length} · Üretimde: ${stillInProd.length}\n`;
    }

    // Şube bazlı
    const byBranch = {};
    todayDelivered.forEach(o => {
      const b = o.branch || 'Belirsiz';
      if (!byBranch[b]) byBranch[b] = { count: 0, rev: 0 };
      byBranch[b].count++;
      byBranch[b].rev += (o.discounted || o.price || 0);
    });

    if (Object.keys(byBranch).length > 0) {
      msg += '\n🏪 <b>Şube Performansı:</b>\n';
      Object.entries(byBranch).forEach(([b, d]) => {
        msg += `  ${b}: ${d.count} teslim · ${fMoney(d.rev)}\n`;
      });
    }

    // İptal detayları
    if (todayCancelled.length > 0) {
      msg += '\n❌ <b>İptal Detayları:</b>\n';
      todayCancelled.forEach(o => {
        msg += `  ${o.orderNo} — ${o.customer}: ${o.cancelReason || '-'}\n`;
      });
    }

    // Teslim edilemedi detayları
    if (todayUndelivered.length > 0) {
      msg += '\n🚫 <b>Teslim Edilemedi:</b>\n';
      todayUndelivered.forEach(o => {
        msg += `  ${o.orderNo} — ${o.customer}: ${o.undeliveredReason || '-'}\n`;
      });
    }

    msg += '\n🌙 İyi akşamlar!';

    await sendTelegram(msg);
  } catch (err) {
    console.error('Gün sonu raporu hatası:', err.message);
  }
}

// ==================== TESLİM EDİLEMEDİ — ANLIK BİLDİRİM ====================
// Bu endpoint frontend'den çağrılacak
async function teslimEdilemediNotify(orderNo, customer, branch, reason, by) {
  try {
    let msg = '🚫 <b>TESLİM EDİLEMEDİ!</b>\n\n';
    msg += `📦 Sipariş: <b>${orderNo}</b>\n`;
    msg += `👤 Müşteri: ${customer}\n`;
    msg += `🏪 Şube: ${branch || '-'}\n`;
    msg += `📝 Gerekçe: ${reason}\n`;
    msg += `👷 Kaydeden: ${by}\n`;
    msg += `⏰ ${fTime(new Date().toISOString())}`;

    await sendTelegram(msg);
  } catch (err) {
    console.error('Teslim edilemedi bildirimi hatası:', err.message);
  }
}

// ==================== EXPRESS SERVER ====================
const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'BY Pasta Telegram Bot çalışıyor',
    time: new Date().toISOString(),
    crons: {
      sabah: '08:00 (Europe/Istanbul)',
      aksam: '20:00 (Europe/Istanbul)'
    }
  });
});

// Manuel tetikleme endpoint'leri
app.post('/sabah', async (req, res) => {
  await sabahBildirimi();
  res.json({ ok: true, message: 'Sabah bildirimi gönderildi' });
});

app.post('/aksam', async (req, res) => {
  await gunSonuRaporu();
  res.json({ ok: true, message: 'Gün sonu raporu gönderildi' });
});

// Teslim edilemedi bildirimi (frontend'den çağrılır)
app.post('/teslim-edilemedi', async (req, res) => {
  const { orderNo, customer, branch, reason, by } = req.body;
  if (!orderNo || !reason) {
    return res.status(400).json({ error: 'orderNo ve reason zorunlu' });
  }
  await teslimEdilemediNotify(orderNo, customer, branch, reason, by);
  res.json({ ok: true, message: 'Bildirim gönderildi' });
});

// Test endpoint
app.get('/test', async (req, res) => {
  try {
    await sendTelegram('🔔 <b>BY Pasta Telegram Bot</b>\n\nTest mesajı — Sistem çalışıyor!');
    res.json({ ok: true, message: 'Test mesajı gönderildi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CRON JOBS ====================

// Sabah 08:00 (Türkiye saati)
cron.schedule('0 8 * * *', () => {
  console.log('CRON: Sabah bildirimi tetiklendi');
  sabahBildirimi();
}, { timezone: 'Europe/Istanbul' });

// Akşam 20:00 (Türkiye saati)
cron.schedule('0 20 * * *', () => {
  console.log('CRON: Gün sonu raporu tetiklendi');
  gunSonuRaporu();
}, { timezone: 'Europe/Istanbul' });

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`BY Pasta Telegram Bot çalışıyor — Port: ${PORT}`);
  console.log('Cron: Sabah 08:00, Akşam 20:00 (Europe/Istanbul)');
});
