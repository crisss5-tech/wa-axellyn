import OpenAI from 'openai';
import { CONFIG } from './config.js';

const clients = CONFIG.providers.map((p) => ({
  ...p,
  client: new OpenAI({
    apiKey: p.apiKey,
    baseURL: p.baseURL,
    defaultHeaders: p.extraHeaders || undefined,
    maxRetries: 0,
  }),
  failCount: 0,
  coolingUntil: 0,
}));

export async function chatComplete(messages, opts = {}) {
  let lastErr;
  const now = Date.now();

  for (const p of clients) {
    if (p.coolingUntil && now < p.coolingUntil) continue;
    try {
      const payload = {
        model: p.model,
        messages,
        temperature: opts.temperature ?? 0.95,
        max_tokens: opts.max_tokens ?? CONFIG.maxTokens,
      };
      if (p.supportsPenalty) {
        payload.presence_penalty = 0.3;
        payload.frequency_penalty = 0.3;
      }
      const res = await p.client.chat.completions.create(payload);
      const text = res.choices?.[0]?.message?.content || '';
      p.failCount = 0;
      p.coolingUntil = 0;
      if (!text.trim()) throw new Error('empty response');
      return { text, provider: p.name };
    } catch (e) {
      p.failCount += 1;
      p.coolingUntil = Date.now() + Math.min(60000, 5000 * p.failCount);
      lastErr = e;
      console.error(`[ai:${p.name}]`, e?.message || e);
    }
  }
  throw lastErr || new Error('all providers failed');
}

export async function extractFacts(history, currentFacts) {
  const convo = history
    .slice(-40)
    .map((m) => `${m.role === 'user' ? 'axel' : 'axellyn'}: ${m.content}`)
    .join('\n');

  const prompt = [
    {
      role: 'system',
      content:
        'Kamu mesin ekstraksi fakta. Baca percakapan, kembalikan HANYA JSON valid tanpa penjelasan. Format: {"facts":{"key":"value"}}. Fokus fakta tentang "axel": nama panggilan akrab, kesukaan, kebiasaan, jadwal, pekerjaan/sekolah, hal yang dia sebut tentang dirinya, tanggal penting, orang yang dia sebut. Maksimal 15 key, singkat, bahasa Indonesia. Kalau tidak ada fakta baru, kembalikan {"facts":{}}.',
    },
    {
      role: 'user',
      content: `Fakta lama: ${JSON.stringify(currentFacts)}\n\nPercakapan:\n${convo}`,
    },
  ];

  try {
    const { text } = await chatComplete(prompt, {
      temperature: 0.2,
      max_tokens: 400,
    });
    const clean = text.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    const parsed = JSON.parse(clean.slice(start, end + 1));
    return parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : {};
  } catch (e) {
    console.error('[facts]', e?.message);
    return {};
  }
}

export async function summarize(history) {
  const prompt = [
    {
      role: 'system',
      content:
        'Ringkas percakapan berikut dalam 3–5 kalimat Bahasa Indonesia. Fokus pada topik, emosi, dan janji. Tanpa komentar atau penjelasan.',
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const { text } = await chatComplete(prompt, {
    temperature: 0.3,
    max_tokens: 300,
  });
  return text.trim();
}

export async function generateFollowupText(recentLines, persona) {
  const prompt = [
    {
      role: 'system',
      content:
        persona +
        '\n\nTUGAS: axel belum balas pesanmu. Kirim 1–3 bubble pendek clingy, cemas, atau ngambek lucu. Jangan nyapa ulang, jangan basa-basi. Nyambung sama obrolan terakhir. Satu bubble per baris.',
    },
    {
      role: 'user',
      content: `Obrolan terakhir:\n${recentLines}\n\nSekarang kirim pesan karena axel belum balas.`,
    },
  ];
  const { text } = await chatComplete(prompt, {
    temperature: 0.95,
    max_tokens: 150,
  });
  return text.trim();
}