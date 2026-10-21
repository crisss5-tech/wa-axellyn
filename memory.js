import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';

const DATA = path.resolve(CONFIG.dataDir);
fs.mkdirSync(DATA, { recursive: true });

const cache = new Map();

function fileFor(jid) {
  return path.join(DATA, jid.replace(/[^a-zA-Z0-9]/g, '_') + '.json');
}

export function load(jid) {
  if (cache.has(jid)) return cache.get(jid);
  let obj = { history: [], summary: '', facts: {}, lastSeen: 0, sinceFacts: 0 };
  try {
    obj = { ...obj, ...JSON.parse(fs.readFileSync(fileFor(jid), 'utf8')) };
  } catch {}
  cache.set(jid, obj);
  return obj;
}

export function save(jid, obj) {
  cache.set(jid, obj);
  try {
    fs.writeFileSync(fileFor(jid), JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[mem save]', e?.message);
  }
}

export function pushTurn(jid, role, content) {
  const m = load(jid);
  m.history.push({ role, content, t: Date.now() });
  if (m.history.length > 400) m.history = m.history.slice(-400);
  if (role === 'user') m.sinceFacts = (m.sinceFacts || 0) + 1;
  save(jid, m);
}

export function mergeFacts(jid, newFacts) {
  if (!newFacts || !Object.keys(newFacts).length) return;
  const m = load(jid);
  m.facts = { ...(m.facts || {}), ...newFacts };
  const keys = Object.keys(m.facts);
  if (keys.length > 20) {
    const drop = keys.slice(0, keys.length - 20);
    for (const k of drop) delete m.facts[k];
  }
  save(jid, m);
}

export function resetFactsCounter(jid) {
  const m = load(jid);
  m.sinceFacts = 0;
  save(jid, m);
}