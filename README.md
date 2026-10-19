# WEBKAS FAM SOS — STREET OF STYLE FAMILY

Webkas kas keluarga berbasis React + Vite dan Supabase. Tema: dark mode, neon green, dan tampilan responsif untuk HP maupun desktop.

## Fitur yang tersedia
- Login menggunakan nama IC (in-game) dan password berupa nomor HP melalui Supabase Auth; password tidak disimpan di tabel publik. Nama IC dipetakan ke alamat login internal sintetis.
- Dashboard member menampilkan saldo, tunggakan, tarif kas, dan pengajuan terbaru.
- Pengajuan pembayaran dengan bukti gambar JPG/PNG/WEBP maksimal 5 MB.
- Penyimpanan bukti di bucket privat `payment-proofs`; bukti hanya dibuka lewat signed URL berumur 60 detik.
- Panel admin untuk membuat akun member, melihat saldo/tunggakan, mengaktifkan/nonaktifkan member, mengubah tarif, dan menyetujui/menolak pengajuan.
- Saldo bertambah saat pembayaran disetujui admin.
- Pemotongan kas harian otomatis pukul 00.00 WIB melalui pg_cron. Saldo yang tidak cukup dihabiskan dan kekurangannya masuk tunggakan.
- Catatan harian menyimpan tarif saat pemotongan sehingga perubahan tarif tidak mengubah riwayat lama.
- Pembersihan bukti pembayaran terverifikasi dijadwalkan setiap hari sekitar 00.30 WIB, setelah 24 jam sejak keputusan admin.
- Realtime refresh untuk pengajuan, profil member, dan tarif kas.

## Deploy / environment
Project Vercel: `webkas-fam-sos`
Domain utama: https://webkas-fam-sos.vercel.app
Repository: https://github.com/vergilwebkas-eng/webkas-fam-sos
Supabase project ref: `jxdzhqbkwbnndhtnkbqr`

Environment Vercel yang dibutuhkan:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (legacy anon/publishable key yang boleh digunakan di browser)

Jangan pernah menaruh `service_role` atau secret key di frontend, GitHub, maupun environment variable berawalan `VITE_`.

## Pembuatan akun pertama dan admin
Database saat ini belum memiliki akun Auth. Sebelum login dapat digunakan, buat akun admin pertama melalui Supabase Dashboard > Authentication > Users. Untuk login berbasis IC, alamat internal sintetis admin harus mengikuti pola `adm_sos@login.webkas-fam-sos.invalid` (nama IC `ADM_SOS` dinormalisasi menjadi `adm_sos`). Tetapkan `app_metadata.role = "admin"` lewat proses server tepercaya / panel admin Supabase. Di halaman website, admin tetap masuk memakai nama IC `ADM_SOS` dan password yang diset saat pembuatan akun. Jangan menaruh role admin di `user_metadata` yang dapat diubah pengguna.

Admin membuat akun member melalui Edge Function `create-member`, yang memeriksa role dari `app_metadata` di server. Admin mengisi nama IC dan password awal berupa nomor HP; member login dengan dua nilai itu. Source terbaru fungsi ini ada di `supabase/functions/create-member/index.ts`. Setelah source diperbarui, fungsi tersebut harus di-deploy ke Supabase sebelum form pembuatan member berbasis IC berfungsi. Password/nomor HP hanya dipakai sebagai kredensial Auth dan tidak disalin ke profil publik.

## Struktur database
- `member_profiles`: nama IC, nama tampilan, status akun.
- `dues_settings`: tarif kas harian.
- `payment_submissions`: pengajuan pembayaran dan status verifikasi.
- `cash_ledger`: catatan kas pembayaran yang disetujui.
- `member_wallets`: saldo dan tunggakan.
- `wallet_transactions`: riwayat perubahan saldo/tunggakan.
- `daily_dues_log`: snapshot tarif dan hasil pemotongan harian per member.
- Storage bucket `payment-proofs` bersifat privat.

## Job terjadwal
- `webkas-daily-dues-wib`: `0 17 * * *` UTC = 00.00 WIB.
- `webkas-cleanup-payment-proofs`: `30 17 * * *` UTC = 00.30 WIB.

## Development
1. Node.js 20+.
2. Salin `.env.example` menjadi `.env`, lalu isi URL dan anon/publishable key.
3. Jalankan `npm install`.
4. Jalankan `npm run dev`.
5. Jalankan `npm run build` sebelum deploy.

## Catatan keamanan dan batasan
- Keputusan pembayaran tetap manual; aplikasi tidak mengakses rekening bank.
- Role admin harus berada di `app_metadata.role`, bukan metadata yang dapat diubah pengguna.
- RLS diterapkan pada tabel yang menyimpan data member, saldo, dan bukti.
- Penghapusan bukti hanya dilakukan untuk pengajuan yang sudah disetujui/ditolak lebih dari 24 jam.
- Uji dengan akun admin dan member terpisah sebelum dipakai untuk pencatatan uang sungguhan.
