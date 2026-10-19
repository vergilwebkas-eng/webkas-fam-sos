# WEBKAS FAM SOS — STREET OF STYLE FAMILY

Webkas kas keluarga berbasis React + Vite dan Supabase. Tema: dark mode, neon green, dan tampilan responsif untuk HP maupun desktop.

**Dokumen induk/reusable blueprint:** [MASTER_BLUEPRINT.md](./MASTER_BLUEPRINT.md). Dokumen tersebut menjelaskan arsitektur, tabel, alur uang, keamanan, setup ulang, deploy, dan checklist pengujian.

## Fitur yang tersedia
- Login menggunakan nama IC (in-game) dan password melalui Supabase Auth; password tidak disimpan di tabel publik. Nama IC dipetakan ke alamat login internal sintetis.
- Dashboard member menampilkan saldo, tunggakan, tarif kas, dan pengajuan terbaru.
- Pengajuan pembayaran dengan bukti gambar JPG/PNG/WEBP maksimal 5 MB.
- Penyimpanan bukti di bucket privat `payment-proofs`; bukti hanya dibuka lewat signed URL berumur 60 detik.
- Pendaftaran member mandiri; akun berstatus menunggu sampai disetujui admin dari daftar member.
- Panel admin untuk menyetujui/menolak pendaftaran, melihat saldo/tunggakan, mengaktifkan/nonaktifkan member, mengubah tarif, dan menyetujui/menolak pengajuan pembayaran.
- Saldo bertambah saat pembayaran disetujui admin; tunggakan dilunasi terlebih dahulu sebelum sisa masuk saldo.
- Pemotongan kas harian otomatis pukul 00.01 WIB. Saldo yang tidak cukup dihabiskan dan kekurangannya masuk tunggakan.
- Catatan harian menyimpan tarif saat pemotongan sehingga perubahan tarif tidak mengubah riwayat lama.
- Bukti pembayaran yang sudah diputuskan dibersihkan setelah masa retensi 24 jam.
- Realtime refresh untuk pengajuan, profil member, dan tarif kas.

## Deploy / environment
Project Vercel: `webkas-fam-sos`
Domain utama: https://webkas-fam-sos.vercel.app
Repository: https://github.com/vergilwebkas-eng/webkas-fam-sos
Supabase project ref: `jxdzhqbkwbnndhtnkbqr`

Environment Vercel yang dibutuhkan:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (anon/publishable key yang boleh digunakan di browser)

Jangan pernah menaruh `service_role` atau secret key di frontend, GitHub, maupun environment variable berawalan `VITE_`.

## Pembuatan akun pertama dan pendaftaran member
Database perlu memiliki satu akun admin pertama sebelum pendaftaran dapat disetujui. Buat akun tersebut melalui Supabase Dashboard > Authentication > Users, lalu tetapkan `app_metadata.role = "admin"` melalui proses server tepercaya. Jangan menaruh role admin di `user_metadata` yang dapat diubah pengguna.

Member mendaftar sendiri dari tombol **Daftar sebagai member**. Edge Function `register-member` membuat akun Auth dan profil berstatus `pending`; akses aplikasi baru tersedia setelah admin menyetujui pendaftaran. Nama IC yang sudah terdaftar atau masih menunggu tidak dapat didaftarkan ulang. Password dikelola Supabase Auth dan tidak disimpan di tabel profil publik.

## Struktur database
- `member_profiles`: nama IC, nama tampilan, status akun, tanggal mulai kas.
- `dues_settings`: tarif kas harian.
- `payment_submissions`: pengajuan pembayaran dan status verifikasi.
- `cash_ledger`: catatan kas pembayaran yang disetujui.
- `member_wallets`: saldo dan tunggakan.
- `wallet_transactions`: riwayat perubahan saldo/tunggakan.
- `daily_dues_log`: snapshot tarif dan hasil pemotongan harian per member.
- Storage bucket `payment-proofs` bersifat privat.

## Job terjadwal
- `webkas-daily-dues-wib`: `1 17 * * *` UTC = 00.01 WIB; memproses hari WIB sebelumnya.
- `webkas-cleanup-payment-proofs`: berjalan setiap 5 menit; hanya menghapus bukti yang sudah memenuhi syarat retensi.

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
- Jangan hard-delete anggota yang memiliki riwayat keuangan/audit; nonaktifkan bila perlu.
- Deployment READY bukan bukti seluruh alur telah lulus end-to-end test. Uji dengan akun admin dan member terpisah sebelum dipakai untuk pencatatan uang sungguhan.
