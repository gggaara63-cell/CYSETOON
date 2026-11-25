# Nanjak (nama sementara)

Solo (Daily, Endless) dan Mabar (room online) dengan bank soal contoh ID dan EN.

## Ganti nama
Atur `NEXT_PUBLIC_APP_NAME` (dan `NEXT_PUBLIC_APP_SLUG`) di `.env.local` atau di Vercel. Judul tab, teks UI, dan teks bagikan ikut berubah. Slug dipakai untuk kunci `localStorage`; mengganti slug mereset preferensi pemain yang tersimpan. Default ada di `src/config/brand.ts`. Ganti juga `name` di `package.json` bila perlu.

## Menjalankan
```bash
npm install
npm run typecheck && npm test      # jalankan dulu, perbaiki galat bila ada
npm run dev
```
Solo jalan tanpa Supabase. Mabar membutuhkan Supabase.

## Menyiapkan Supabase
1. Buat proyek. Auth > Providers: aktifkan **Anonymous sign-ins** (disarankan aktifkan captcha).
2. SQL Editor, jalankan berurutan: `supabase/migrations/0001_schema.sql`, `0002_party.sql`, lalu `supabase/seed.sql`.
   Perbaiki galat sintaks bila ada: file ini ditulis tanpa dijalankan di Postgres.
   Bila `alter publication supabase_realtime add table ...` gagal karena tabel sudah terdaftar, hapus barisnya.
3. Salin URL dan anon key ke `.env.local` (lihat `.env.example`). Di Vercel isi variabel yang sama.
4. Deploy ke Vercel (framework Next.js, tanpa pengaturan tambahan).

## Bank soal
Edit `src/data/questions-id.json` dan `questions-en.json` (format jawaban "Kanonik|alias;alias|familiarity|override"), lalu `npm run seed:gen` dan jalankan ulang `supabase/seed.sql`. Mesin Solo membaca JSON yang sama. Nilai familiarity di bank ini tebakan demo, bukan data kelangkaan nyata.

## Catatan teknis
- Party: seluruh aturan (validasi, kunci jawaban pertama, timer, nyawa, reveal, handoff host) ada di fungsi SQL. Klien memantau perubahan baris `rooms` dan `room_players` lalu memuat ulang snapshot; ini menggantikan siaran `realtime.send` di `architecture.md` agar tidak bergantung pada API yang belum diverifikasi.
- Tabel jawaban Party bernama `room_submissions` (sesuai `schema.sql`).
- Daftar kata terlarang di `seed.sql` hanya daftar awal; tinjau sebelum rilis publik.
