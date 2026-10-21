import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import http from 'http';

import { CONFIG } from './config.js';
import { PERSONA } from './persona.js';
import {
  chatComplete,
  extractFacts,
  summarize,
  generateFollowupText,
} from './ai.js';
import {
  load as loadMem,
  save as saveMem,
  pushTurn,
  mergeFacts,
  resetFactsCounter,
} from './memory.js';
import {
  sleep,
  rand,
  clamp,
  splitBubbles,
  burstPauses,
  pickReact,
  timeOfDay,
  sleepFactor,
  detectLangHint,
} from './humanize.js';

const logger = pino({ level: 'silent' });

const seenIds = new Set();
const queues = new Map();
const buffers = new Map();
const sendingNow = new Set();
const pendingFollowups = new Map();

function rememberId(id) {
  if (!id) return;
  seenIds.add(id);
  if (seenIds.size > 2000) {
    const it = seenIds.values().next().value;
    seenIds.delete(it);
  }
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  ).trim();
}

function extractMediaHint(msg) {
  const m = msg.message;
  if (!m) return '';
  if (m.imageMessage)
    return `[axel kirim foto${m.imageMessage.caption ? ': ' + m.imageMessage.caption : ''}]`;
  if (m.videoMessage)
    return `[axel kirim video${m.videoMessage.caption ? ': ' + m.videoMessage.caption : ''}]`;
  if (m.audioMessage) return '[axel kirim voice note]';
  if (m.stickerMessage) return '[axel kirim stiker]';
  if (m.documentMessage) return '[axel kirim dokumen]';
  return '';
}

function buildSystemPrompt(jid, userText) {
  const mem = loadMem(jid);
  const since = mem.lastSeen ? Date.now() - mem.lastSeen : 0;
  const sinceStr = !since
    ? 'baru pertama kali'
    : since > 3600000
      ? `${Math.round(since / 3600000)} jam lalu`
      : `${Math.max(1, Math.round(since / 60000))} menit lalu`;

  const lang = detectLangHint(userText);
  const langLine =
    lang === 'id'
      ? 'Axel pakai Bahasa Indonesia santai. Balas Bahasa Indonesia santai.'
      : lang === 'en'
        ? 'Axel is typing in English. Reply in English, match his style.'
        : 'Ikuti bahasa dan gaya ngetik axel.';

  return `${PERSONA}

KONTEKS SAAT INI:
- Waktu: ${timeOfDay()}
- Terakhir chat dengan axel: ${sinceStr}
${mem.summary ? `- Ringkasan obrolan sebelumnya: ${mem.summary}` : ''}
${Object.keys(mem.facts).length ? `- Fakta yang kamu ingat tentang axel: ${JSON.stringify(mem.facts)}` : ''}

BAHASA: ${langLine}

FORMAT OUTPUT:
- Satu bubble = satu baris. Kalau mau kirim beberapa bubble, pisahkan dengan newline.
- Maksimal 2 kalimat per bubble.
- Panggil dia "axel" (bukan "kak").
- Jangan pakai awalan nama, tanda kutip, atau penjelasan.`.trim();
}

async function generateReply(jid, userText) {
  const mem = loadMem(jid);
  const sys = buildSystemPrompt(jid, userText);
  const ctx = mem.history
    .slice(-CONFIG.maxContextMessages)
    .map((m) => ({ role: m.role, content: m.content }));

  if (!ctx.length || ctx[ctx.length - 1].content !== userText) {
    ctx.push({ role: 'user', content: userText });
  }

  const { text } = await chatComplete([
    { role: 'system', content: sys },
    ...ctx,
  ]);
  return text.trim();
}

async function maybeSummarize(jid) {
  const mem = loadMem(jid);
  if (mem.history.length < CONFIG.summaryTriggerAt) return;
  const old = mem.history.slice(0, mem.history.length - CONFIG.summaryKeepRecent);
  const recent = mem.history.slice(-CONFIG.summaryKeepRecent);
  try {
    const sum = await summarize(old);
    mem.summary = sum;
    mem.history = recent;
    saveMem(jid, mem);
  } catch (e) {
    console.error('[summary]', e?.message);
  }
}

async function maybeExtractFacts(jid) {
  const mem = loadMem(jid);
  if ((mem.sinceFacts || 0) < CONFIG.factExtractEvery) return;
  try {
    const newFacts = await extractFacts(mem.history, mem.facts || {});
    mergeFacts(jid, newFacts);
    resetFactsCounter(jid);
  } catch (e) {
    console.error('[facts]', e?.message);
  }
}

function clearFollowup(jid) {
  const t = pendingFollowups.get(jid);
  if (t) {
    clearTimeout(t);
    pendingFollowups.delete(jid);
  }
}

async function generateFollowup(jid) {
  const mem = loadMem(jid);
  const recent = mem.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'axel' : 'axellyn'}: ${m.content}`)
    .join('\n');
  return await generateFollowupText(recent, PERSONA);
}

function scheduleFollowup(sock, jid) {
  if (!CONFIG.followupEnabled) return;
  clearFollowup(jid);
  const delay = rand(CONFIG.followupMinMs, CONFIG.followupMaxMs);
  const timer = setTimeout(async () => {
    pendingFollowups.delete(jid);
    try {
      const text = await generateFollowup(jid);
      if (!text) return;
      const bubbles = splitBubbles(text, 120);
      try {
        await sock.sendPresenceUpdate('composing', jid);
      } catch {}
      await sleep(rand(3000, 7000));
      for (let i = 0; i < bubbles.length; i++) {
        if (i > 0) {
          try {
            await sock.sendPresenceUpdate('composing', jid);
          } catch {}
          await sleep(rand(800, 2500));
        }
        try {
          const sent = await sock.sendMessage(jid, { text: bubbles[i] });
          rememberId(sent?.key?.id);
        } catch {}
      }
      try {
        await sock.sendPresenceUpdate('paused', jid);
      } catch {}
      pushTurn(jid, 'assistant', text);
    } catch (e) {
      console.error('[followup]', e?.message);
    }
  }, delay);
  pendingFollowups.set(jid, timer);
}

async function handleMessage(sock, keys, jid, text, lastKey, ownJid) {
  await sleep(rand(1500, 5500));
  try {
    await sock.readMessages(keys);
  } catch {}

  let reply;
  try {
    reply = await generateReply(jid, text);
  } catch (e) {
    console.error('[gen]', e?.message);
    return;
  }
  if (!reply) return;

  const chunks = splitBubbles(reply, 130);
  if (!chunks.length) return;

  const base = rand(CONFIG.delay.minMs, CONFIG.delay.maxMs);
  const lengthFactor = clamp(1 + reply.length / 800, 1, 1.6);
  const target = clamp(
    base * lengthFactor * sleepFactor(),
    CONFIG.delay.minMs,
    CONFIG.delay.maxMs * 1.5
  );

  try {
    await sock.sendPresenceUpdate('available', jid);
  } catch {}
  await sleep(rand(1000, 3000));
  try {
    await sock.sendPresenceUpdate('composing', jid);
  } catch {}

  const endAt = Date.now() + target;
  while (Date.now() < endAt) {
    await sleep(Math.min(4000, endAt - Date.now()));
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch {}
  }

  if (lastKey && Math.random() < 0.25) {
    try {
      await sock.sendMessage(jid, {
        react: { text: pickReact(), key: lastKey },
      });
    } catch {}
  }

  const isSelf = ownJid && jid === ownJid;
  if (isSelf) sendingNow.add(jid);

  const pauses = burstPauses(chunks.length);

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) {
        try {
          await sock.sendPresenceUpdate('composing', jid);
        } catch {}
        await sleep(pauses[i - 1]);
      }
      const opts = { text: chunks[i] };
      if (i === 0 && lastKey && Math.random() < 0.2) opts.quoted = lastKey;
      try {
        const sent = await sock.sendMessage(jid, opts);
        rememberId(sent?.key?.id);
      } catch (e) {
        console.error('[send]', e?.message);
        break;
      }
      try {
        await sock.sendPresenceUpdate('paused', jid);
      } catch {}
    }
  } finally {
    if (isSelf) setTimeout(() => sendingNow.delete(jid), 8000);
  }

  const mem = loadMem(jid);
  mem.lastSeen = Date.now();
  saveMem(jid, mem);
  pushTurn(jid, 'assistant', chunks.join('\n'));

  maybeSummarize(jid).catch(() => {});
  maybeExtractFacts(jid).catch(() => {});

  if (CONFIG.followupEnabled) scheduleFollowup(sock, jid);
}

function enqueue(jid, task) {
  const prev = queues.get(jid) || Promise.resolve();
  const next = prev
    .then(task)
    .catch((e) => console.error('[queue]', e?.message || e));
  queues.set(jid, next);
  next.finally(() => {
    if (queues.get(jid) === next) queues.delete(jid);
  });
  return next;
}

function bufferMessage(sock, msg, jid, text, ownJid) {
  clearFollowup(jid);
  let buf = buffers.get(jid);
  if (!buf) {
    buf = { texts: [], keys: [], last: null, timer: null };
    buffers.set(jid, buf);
  }
  buf.texts.push(text);
  buf.keys.push(msg.key);
  buf.last = msg.key;

  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => {
    buffers.delete(jid);
    const combined = buf.texts.join('\n');
    pushTurn(jid, 'user', combined);
    enqueue(jid, () =>
      handleMessage(sock, buf.keys, jid, combined, buf.last, ownJid)
    );
  }, CONFIG.debounceMs);
}

let reconnecting = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
    browser: ['Ubuntu', 'Chrome', '131.0.0.0'],
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    defaultQueryTimeoutMs: 60000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log(
        '[QR] WhatsApp > Perangkat tertaut > Tautkan perangkat, lalu scan.'
      );
    }
    if (connection === 'open') {
      reconnecting = false;
      console.log(`[ok] tersambung: ${sock.user?.id}`);
      try {
        await sock.sendPresenceUpdate('unavailable');
      } catch {}
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('[!] Logout. Hapus folder auth/, lalu jalankan ulang.');
        process.exit(0);
      }
      if (!reconnecting) {
        reconnecting = true;
        console.log('[!] Reconnect dalam 3 detik...');
        setTimeout(() => startBot().catch(console.error), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const ownJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;

    for (const msg of messages) {
      try {
        if (!msg.message || !msg.key?.id) continue;
        if (seenIds.has(msg.key.id)) continue;
        rememberId(msg.key.id);

        const jid = msg.key.remoteJid;
        if (!jid) continue;
        if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) continue;
        if (jid.endsWith('@g.us') && !CONFIG.respondToGroups) continue;
        if (msg.key.fromMe && jid !== ownJid) continue;
        if (jid === ownJid && sendingNow.has(jid)) continue;
        if (CONFIG.whitelist.length && !CONFIG.whitelist.includes(jid)) continue;

        const text = extractText(msg) || extractMediaHint(msg);
        if (!text) continue;

        bufferMessage(sock, msg, jid, text, ownJid);
      } catch (e) {
        console.error('[upsert]', e?.message);
      }
    }
  });
}

function startHealth() {
  http
    .createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            uptime: Math.round(process.uptime()),
            ts: Date.now(),
            queues: queues.size,
            followups: pendingFollowups.size,
          })
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(CONFIG.healthPort, () =>
      console.log(`[health] :${CONFIG.healthPort}`)
    );
}

async function startSafe() {
  try {
    await startBot();
  } catch (e) {
    console.error('[startBot]', e?.message);
    setTimeout(startSafe, 5000);
  }
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

startHealth();
startSafe();