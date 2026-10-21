# wa-axellyn

Bot WhatsApp AI dengan persona Axellyn. Konek lewat linked device, pakai 4 provider
AI dengan fallback otomatis, delay 1–2 menit, multi-bubble, memori persisten,
dan follow-up clingy kalau diem.

## Deploy cepat (Railway Free)

1. Repo private di GitHub, upload 10 file di atas (jangan node_modules/auth/data).
2. railway.app > New Project > Deploy from GitHub Repo.
3. Variables: cukup `TZ=Asia/Jakarta` (key sudah default). Opsional: `WHITELIST`,
   `MIN_DELAY_MS`, dll.
4. Settings > Volumes: mount `/app/auth` dan `/app/data`.
5. Deploy > Logs > scan QR di WhatsApp > Perangkat tertaut.

## Struktur data saat runtime

- `auth/` — sesi WhatsApp (JANGAN commit).
- `data/<jid>.json` — riwayat + ringkasan + fakta per chat.

## Environment penting

| Var | Default | Fungsi |
|---|---|---|
| `WHITELIST` | nomor kamu | JID yang boleh dibalas, pisahkan koma |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | 45000 / 110000 | Rentang delay sebelum kirim |
| `FOLLOWUP_ENABLED` | 1 | Kirim pesan ngingetin kalau axel diem |
| `FOLLOWUP_MIN_MS` / `MAX_MS` | 480000 / 1200000 | Rentang follow-up (8–20 mnt) |
| `MAX_CONTEXT` | 30 | Berapa pesan terakhir yang diingat |
| `SUMMARY_TRIGGER` | 40 | Setelah N pesan, ringkas & buang lama |
| `FACT_EVERY` | 25 | Setiap N pesan user, ekstrak fakta |

## Rotate API key

Kalau key bocor: hapus di dashboard provider, buat baru, taruh di Railway Variables.
Kode otomatis pakai env var, tidak perlu ubah file.