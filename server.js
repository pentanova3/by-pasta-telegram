const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const https = require('https');

const TELEGRAM_TOKEN = '8688885911:AAGrkCzCKVeQc0X5RZto2Ghpc8ju5wpl8kA';
const CHAT_ID = '-5150678634';
const PORT = process.env.PORT || 8080;

const serviceAccount = {
  type: 'service_account',
  project_id: 'by-pasta-siparis',
  private_key_id: '418c97c6f78568d4a60ae8974f15f5932c8e1f4a',
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDItd3zqt06tCAG\nt0i7N+1wAob0zyU+n04VH3w1BfbpNw7KUemcQkaRoOQSpFnoyNC0xFaggNEZNrNy\ndjziHV0PMlPm8pmAVy0R8EN94u/mfkKfQoYAtArxtt6T7OjYzLuTitCrS0jbXO/9\nqEsMKhCVbbqMRSVOea/tIvzyMy+lcvDKv0fwcr5dg1yZk5NttC+uh95M6hzGsBfX\n80QAAj13lDGIyld3EkAoqbhSZICBe4+flqM4orrMFAQSLGfYgZDdXiy4cTg17KX+\nZ1cJZf3t3UECVkeT8TAjDY9K8qXmHHm2jcl08hKO9UrYGOBs+5ZsKERjVCrVyG7A\nEDj7CeOnAgMBAAECggEACXk2wLQ6kkrDjY2ZIT0X4pw77SeEhTAqaf99HVjquUH1\nW2ytBMhxYZj2gEAW/lB8NAwQYAMJ25F5ZthYh1Ow0MbPWayZvN+11jhA90V+4qI9\nrXFhDHzIXMsE4SE4Ma4i1xP2RXTdkNJngXwwDqLtpXVIbivVVvQ8xDSikSFZXmBj\nm5X9qblJKOmM52qp3gGm+/IKcEZChfujosPTYma/7RN4FjCGt3LkjDrdU+zYM9fm\nnQuQ7SY+k8qiJ0btf9LGzceO+FUq8x/7voOyrgTj47x3ZkiBjq4yB4adNiSW8A9q\nM7EgsCJ1kRX9K6QOqDndxQy+MsWt7bgAIx+xiMI8AQKBgQD/GS9DzmFDuno4zE2m\nyxgeIyAf1+ap9FDUutbEHXiu7jdq/427vvOxOBUZWtrCf8cPlJC2odeRzgujLjqW\ng6Zs33JXOyC1VURA7RqJIzZF8aAC8cuYBAQ5WODl5SAELlecEbzkPCRdAJVdvMG/\nYevAtvlmISHoO3WI3Vw7blctvwKBgQDJa3i9iTej8dF8cGYJ7nTQa1IHiNFXU2gt\nLUQn+fl5eaIWEVn+z5mX1wd4qsdqFnD8i0i9hd5+OxBFzuO9WiE2e9mQpLI5zhkK\nRIvSnLt6XG4yXHd/vWh90dhoV4yxqgB8SINKonlgE5kCKHrpS648Mowr+0E1hYeZ\nfTMp3uyUGQKBgFmLoKC/qDrbEZ4wcS2UayHhGJy0795Gybzy3QK4ia12J3PiwwDd\ndbOGyTk+QD44FksszmOdigs/daxRRPWivt/Gy988/S1KAgx8bm0nNBz3RUDjWaFB\n/62VulRYypVNIynAvDqtteIDm2rtIGGq4NOkJwWnqbxYatihQ4gFIosHAoGBAItx\n+DlgEkFSXTHFrx8ZE45nfnbw5d2LRQhh2lnC2lCbQPf+M0wR9cgFeoqz0TNFLhvp\nYgaz84F46p8pyMmC6JOL0ugs3abfZL6TDipVkAX6j+AV3DV3sCvLaAN0+VbW11cz\n7JFzQoydhMTVuaJiXtIWPK0GWfLv6xz8bLuENk2hAoGATlVvpqZ23x/AM7bFvatt\n5IJ5aQncMWF/fa7wqHobQJmhF01iftTyBsKf3RrxL2eY7Fb2+jVf63RJugE/DCqy\nZUDHJQvg9dLI14NFu7FTh+R8I/OXjEHm8R2QTO4Qu33qgE+VfZpgqONSPm2153fW\ncy0hBGA1KZ48Q1xTuVg0ZDo=\n-----END PRIVATE KEY-----\n",
  client_email: 'firebase-adminsdk-fbsvc@by-pasta-siparis.iam.gserviceaccount.com',
  client_id: '113751706185384082198',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token'
};
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
  const { orderNo, customer, size, coating, time, branch, textTop } = req.body;
  let msg = '<b>BUGUN ALINAN VE BUGUNE HAZIR OLACAK SIPARIS</b>\n\n';
  msg += 'Siparis: <b>' + orderNo + '</b>\n';
  msg += 'Musteri: ' + customer + '\n';
  msg += size + ' - ' + coating + '\n';
  msg += 'Sube: ' + (branch||'-') + '\n';
  msg += 'Teslim saati: ' + time + '\n';
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

// CRON: Gun sonu 21:00 — yarim kalan isler
cron.schedule('0 21 * * *', () => { console.log('CRON: Yarim kalan isler'); yarimKalanlar(); }, { timezone: 'Europe/Istanbul' });

// YARIM KALAN ISLER — gun sonunda tamamlanmamis siparisler
async function yarimKalanlar() {
  console.log('Yarim kalan isler kontrolu...');
  try {
    const orders = await loadData('byp_orders');
    if (!orders || !orders.length) return;

    const now = new Date(new Date().toLocaleString('en-US', {timeZone:'Europe/Istanbul'}));
    const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

    // Bugun teslim edilmesi gerekip de hala arada kalan siparisler
    const stuck = orders.filter(o =>
      o.date === today &&
      ['bekliyor', 'uretimde', 'hazir', 'sevkiyat'].includes(o.status)
    );

    if (stuck.length === 0) return; // Arada kalan yok, mesaj gonderme

    const byStatus = {};
    stuck.forEach(o => {
      if (!byStatus[o.status]) byStatus[o.status] = [];
      byStatus[o.status].push(o);
    });

    const statusLabel = {bekliyor:'BEKLIYOR', uretimde:'URETIMDE', hazir:'HAZIR', sevkiyat:'SEVKIYATTA'};

    let msg = '<b>DIKKAT! ARADA KALAN SIPARISLER</b>\n';
    msg += 'Bugun teslim edilmesi gerekip de tamamlanmamis siparisler:\n\n';
    msg += 'Toplam: <b>' + stuck.length + '</b> siparis\n\n';

    Object.entries(byStatus).forEach(function(entry) {
      const status = entry[0];
      const list = entry[1];
      msg += '<b>' + (statusLabel[status] || status) + ' (' + list.length + '):</b>\n';
      list.forEach(o => {
        msg += '  ' + o.orderNo + ' - ' + o.customer + ' (' + (o.branch||'') + ') Saat: ' + o.time + '\n';
      });
      msg += '\n';
    });

    msg += 'Bu siparisler ya iptal edilmeli, ya teslim edildi ya da teslim edilemedi olarak guncellenmeli!';

    await sendTelegram(msg);
  } catch (err) { console.error('Yarim kalan isler hatasi:', err.message); }
}

// Manuel endpoint
app.post('/yarim-kalan', async (req, res) => { await yarimKalanlar(); res.json({ ok: true }); });

app.listen(PORT, () => { console.log('BY Pasta Telegram Bot - Port: ' + PORT + ' | Cron: 07:45 sabah, 21:00 yarim kalanlar'); });
