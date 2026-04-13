const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const https = require('https');

const TELEGRAM_TOKEN = '8688885911:AAGrkCzCKVeQc0X5RZto2Ghpc8ju5wpl8kA';
const CHAT_ID = '-5150678634';
const PORT = process.env.PORT || 8080;

admin.initializeApp({ projectId: 'by-pasta-siparis' });
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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
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

function fDate(d) { return d ? new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'; }
function fMoney(n) { return String.fromCharCode(8378) + Number(n || 0).toLocaleString('tr-TR'); }

// SABAH 07:45
async function sabahBildirimi() {
  try {
    const orders = await loadData('byp_orders');
    if (!orders || !orders.length) { await sendTelegram('Gunaydin! Bugun teslim edilecek siparis yok.'); return; }
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = orders.filter(o => o.date === today && ['bekliyor','uretimde','hazir','sevkiyat'].includes(o.status));
    const overdueOrders = orders.filter(o => o.date < today && ['bekliyor','uretimde'].includes(o.status));
    const allWaiting = orders.filter(o => o.status === 'bekliyor');
    const totalRev = todayOrders.reduce((s, o) => s + (o.discounted || o.price || 0), 0);

    let msg = '<b>GUNAYDIN! BY Pasta Sabah Bildirimi</b>\n' + fDate(today) + '\n\n';
    msg += '<b>Istatistikler:</b>\n';
    msg += 'Bugun hazir olmasi gereken: <b>' + todayOrders.length + '</b> siparis\n';
    msg += 'Tahmini ciro: <b>' + fMoney(totalRev) + '</b>\n';
    msg += 'Toplam bekleyen: <b>' + allWaiting.length + '</b>\n';
    if (overdueOrders.length > 0) msg += 'Gecikmis: <b>' + overdueOrders.length + '</b>\n';
    msg += '\n';

    if (overdueOrders.length > 0) {
      msg += '<b>GECIKMIS SIPARISLER:</b>\n';
      overdueOrders.forEach(o => { msg += '  ' + o.orderNo + ' - ' + o.customer + ' (' + (o.branch||'') + ') Teslim: ' + fDate(o.date) + '\n'; });
      msg += '\n';
    }
    if (todayOrders.length > 0) {
      msg += '<b>BUGUN HAZIR OLMASI GEREKENLER:</b>\n';
      todayOrders.forEach(o => {
        const e = {bekliyor:'Bekliyor',uretimde:'Uretimde',hazir:'Hazir',sevkiyat:'Sevkiyat'};
        msg += '  [' + (e[o.status]||o.status) + '] ' + o.orderNo + ' - ' + o.customer + '\n';
        msg += '     ' + o.size + ' - ' + o.coating + ' - Saat: ' + o.time + ' - ' + (o.branch||'') + '\n';
      });
    }
    msg += '\nHayirli mesailer!';
    await sendTelegram(msg);
  } catch (err) { console.error('Sabah hatasi:', err.message); }
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => res.json({ status: 'BY Pasta Telegram Bot calisiyor', time: new Date().toISOString() }));
app.get('/test', async (req, res) => { try { await sendTelegram('BY Pasta Telegram Bot - Test mesaji, sistem calisiyor!'); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/sabah', async (req, res) => { await sabahBildirimi(); res.json({ ok: true }); });

// 2. Bugun alinan + bugune hazir siparis
app.post('/bugun-siparis', async (req, res) => {
  const { orderNo, customer, size, coating, time, branch, price, textTop } = req.body;
  let msg = '<b>BUGUN ALINAN VE BUGUNE HAZIR OLACAK SIPARIS</b>\n\n';
  msg += 'Siparis: <b>' + orderNo + '</b>\n';
  msg += 'Musteri: ' + customer + '\n';
  msg += size + ' - ' + coating + '\n';
  msg += 'Sube: ' + (branch||'-') + '\n';
  msg += 'Teslim saati: ' + time + '\n';
  msg += 'Fiyat: ' + fMoney(price) + '\n';
  if (textTop) msg += 'Yazi: "' + textTop + '"';
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Iptal bildirimi
app.post('/iptal', async (req, res) => {
  const { orderNo, customer, branch, reason, by, status } = req.body;
  const sl = {uretimde:'URETIMDE',bekliyor:'BUGUNE HAZIR'};
  let msg = '<b>SIPARIS IPTAL EDILDI</b>\n';
  msg += 'Durum: <b>' + (sl[status]||status) + '</b>\n\n';
  msg += 'Siparis: <b>' + orderNo + '</b>\n';
  msg += 'Musteri: ' + customer + '\n';
  msg += 'Sube: ' + (branch||'-') + '\n';
  msg += 'Gerekce: ' + reason + '\n';
  msg += 'Iptal eden: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Bekleyen siparis iptal
app.post('/bekleyen-iptal', async (req, res) => {
  const { orderNo, customer, branch, reason, by, delivDate } = req.body;
  let msg = '<b>BEKLEYEN SIPARIS IPTAL EDILDI</b>\n\n';
  msg += 'Siparis: <b>' + orderNo + '</b>\n';
  msg += 'Musteri: ' + customer + '\n';
  msg += 'Sube: ' + (branch||'-') + '\n';
  msg += 'Teslim tarihi: ' + delivDate + '\n';
  msg += 'Gerekce: ' + reason + '\n';
  msg += 'Iptal eden: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. ACIL - tarihi bugune alinan
app.post('/acil', async (req, res) => {
  const { orderNo, customer, size, coating, branch, time, reason, by, oldDate } = req.body;
  let msg = '<b>ACIL SIPARIS!</b>\n\n';
  msg += 'Tarihi one alindi - BUGUN\n';
  msg += 'Eski tarih: ' + oldDate + '\n\n';
  msg += 'Siparis: <b>' + orderNo + '</b>\n';
  msg += 'Musteri: ' + customer + '\n';
  msg += size + ' - ' + coating + '\n';
  msg += 'Sube: ' + (branch||'-') + '\n';
  msg += 'Teslim saati: ' + time + '\n';
  msg += 'Gerekce: ' + reason + '\n';
  msg += 'Guncelleyen: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Teslim edilemedi
app.post('/teslim-edilemedi', async (req, res) => {
  const { orderNo, customer, branch, reason, by } = req.body;
  let msg = '<b>TESLIM EDILEMEDI!</b>\n\n';
  msg += 'Siparis: <b>' + orderNo + '</b>\n';
  msg += 'Musteri: ' + customer + '\n';
  msg += 'Sube: ' + (branch||'-') + '\n';
  msg += 'Gerekce: ' + reason + '\n';
  msg += 'Kaydeden: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Musteri geri bildirimi
app.post('/geri-bildirim', async (req, res) => {
  const { orderNo, customer, branch, feedback, by } = req.body;
  let msg = '<b>MUSTERI GERI BILDIRIMI</b>\n\n';
  msg += 'Siparis: <b>' + orderNo + '</b>\n';
  msg += 'Musteri: ' + customer + '\n';
  msg += 'Sube: ' + (branch||'-') + '\n';
  msg += 'Geri bildirim: ' + feedback + '\n';
  msg += 'Kaydeden: ' + by;
  try { await sendTelegram(msg); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// CRON: Sabah 07:45 Turkiye
cron.schedule('45 7 * * *', () => { console.log('CRON: Sabah'); sabahBildirimi(); }, { timezone: 'Europe/Istanbul' });

app.listen(PORT, () => { console.log('BY Pasta Telegram Bot - Port: ' + PORT); });
