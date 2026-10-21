export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function timeOfDay() {
  const h = new Date().getHours();
  if (h < 5) return 'tengah malam';
  if (h < 11) return 'pagi';
  if (h < 15) return 'siang';
  if (h < 18) return 'sore';
  if (h < 22) return 'malam';
  return 'larut malam';
}

export function sleepFactor() {
  const h = new Date().getHours();
  if (h >= 1 && h < 6) return 2.2;
  if (h >= 22) return 1.4;
  if (h >= 6 && h < 9) return 1.15;
  return 1;
}

export function splitBubbles(text, maxLen = 130) {
  text = (text || '').trim();
  if (!text) return [];
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (line.length <= maxLen) {
      out.push(line);
      continue;
    }
    const sentences = line.match(/[^.!?…]+[.!?…]*/g) || [line];
    let cur = '';
    for (const s of sentences) {
      const t = s.trim();
      if (!t) continue;
      if (cur && (cur + ' ' + t).length > maxLen) {
        out.push(cur);
        cur = t;
      } else {
        cur = cur ? cur + ' ' + t : t;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function burstPauses(n) {
  if (n <= 1) return [];
  const style = Math.random();
  const pauses = [];
  for (let i = 1; i < n; i++) {
    if (style < 0.3) {
      pauses.push(i < 2 ? rand(300, 900) : rand(1500, 5000));
    } else if (style < 0.6) {
      pauses.push(rand(1200, 4500));
    } else {
      pauses.push(rand(3000, 10000));
    }
  }
  return pauses;
}

export function pickReact() {
  const emojis = ['🥺', '😍', '💕', '😘', '🥰', '😔', '😭', '🤍', '🫶'];
  return emojis[rand(0, emojis.length - 1)];
}

export function detectLangHint(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const id =
    /\b(aku|kamu|lagi|apa|gak|nggak|iya|banget|sih|dong|yaa|kangen|sayang|makasih|udah|belum|gimana|axel)\b/.test(
      t
    );
  const en =
    /\b(you|i|love|what|doing|hey|hi|okay|yes|no|the|and|are|how|im|me)\b/.test(
      t
    );
  if (id && !en) return 'id';
  if (en && !id) return 'en';
  return 'auto';
}