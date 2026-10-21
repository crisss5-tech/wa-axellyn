process.env.TZ = process.env.TZ || 'Asia/Jakarta';

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (v == null ? d : v === '1' || v === 'true');

export const CONFIG = {
  providers: [
    {
      name: 'groq',
      apiKey:
        process.env.GROQ_API_KEY ||
        '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',
      baseURL: 'https://api.groq.com/openai/v1',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      supportsPenalty: true,
    },
    {
      name: 'gemini',
      apiKey:
        process.env.GEMINI_API_KEY ||
        'AQ.Ab8RN6LNh-hDAvZUZFyAIqHPC0gg1YOXEPD42znV33wjnmGIEw',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      supportsPenalty: false,
    },
    {
      name: 'openrouter',
      apiKey:
        process.env.OPENROUTER_API_KEY ||
        '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',
      baseURL: 'https://openrouter.ai/api/v1',
      model:
        process.env.OPENROUTER_MODEL ||
        'meta-llama/llama-3.3-70b-instruct:free',
      supportsPenalty: true,
      extraHeaders: {
        'HTTP-Referer': 'https://railway.app',
        'X-Title': 'wa-axellyn',
      },
    },
    {
      name: 'mistral',
      apiKey:
        process.env.MISTRAL_API_KEY ||
        'mstrl_fCZtCKykOf7TvDEiqbCIKag5YyUDcJLy_36wnQv',
      baseURL: 'https://api.mistral.ai/v1',
      model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
      supportsPenalty: true,
    },
  ],

  delay: {
    minMs: int(process.env.MIN_DELAY_MS, 45000),
    maxMs: int(process.env.MAX_DELAY_MS, 110000),
  },
  debounceMs: int(process.env.DEBOUNCE_MS, 1500),
  maxContextMessages: int(process.env.MAX_CONTEXT, 30),
  maxTokens: int(process.env.MAX_TOKENS, 400),

  summaryTriggerAt: int(process.env.SUMMARY_TRIGGER, 40),
  summaryKeepRecent: int(process.env.SUMMARY_KEEP, 20),
  factExtractEvery: int(process.env.FACT_EVERY, 25),

  whitelist: (process.env.WHITELIST || '6281259222210@s.whatsapp.net')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  respondToGroups: bool(process.env.RESPOND_TO_GROUPS, false),

  followupEnabled: bool(process.env.FOLLOWUP_ENABLED, true),
  followupMinMs: int(process.env.FOLLOWUP_MIN_MS, 480000), // 8 menit
  followupMaxMs: int(process.env.FOLLOWUP_MAX_MS, 1200000), // 20 menit

  dataDir: process.env.DATA_DIR || 'data',
  authDir: process.env.AUTH_DIR || 'auth',
  healthPort: int(process.env.PORT, 3000),
};