# MASTER BLUEPRINT — WEBKAS FAM SOS

> Dokumen induk untuk membangun ulang aplikasi kas komunitas/family dengan alur dan aturan bisnis yang sama. Dokumen ini merangkum implementasi repo produksi per 19 Oktober 2026. Gunakan sebagai spesifikasi, bukan pengganti audit kode dan pengujian sebelum sistem baru dipakai untuk uang sungguhan.

## 1. Tujuan produk

Webkas berbasis web untuk mengelola kas anggota komunitas/FAM:
- Anggota memiliki akun pribadi dan hanya mengakses data miliknya.
- Anggota mengajukan pembayaran dengan nominal, jumlah hari, catatan opsional, dan screenshot bukti.
- Admin memeriksa bukti secara manual lalu menerima atau menolak pengajuan.
- Saldo dompet, tunggakan, dan riwayat transaksi dicatat oleh database.
- Kas harian berjalan otomatis berdasarkan kalender Asia/Jakarta.
- Admin dapat mengelola anggota, status anggota, tarif kas, dan pengajuan.
- UI responsif untuk HP dan desktop, bertema gelap dengan aksen neon hijau.

## 2. Teknologi

- Frontend: React 18, Vite 6, JavaScript ES modules.
- UI icons: lucide-react.
- Backend/database: Supabase PostgreSQL.
- Authentication: Supabase Auth.
- Server-side privileged operations: Supabase Edge Functions (Deno).
- Realtime: Supabase Realtime / postgres_changes.
- File upload: Supabase Storage.
- Scheduler: pg_cron.
- Hosting frontend: Vercel.
- Source control: GitHub.
- Timezone bisnis: Asia/Jakarta (WIB); timestamp database disimpan sebagai timestamptz/UTC.

Dependency frontend saat dokumen dibuat: `react`, `react-dom`, `@supabase/supabase-js`, `lucide-react`, `vite`, `@vitejs/plugin-react`.

## 3. Fitur dan role

### Member
- Login menggunakan nama IC atau email yang sesuai.
- Melihat saldo, tunggakan, tarif kas, dan status pembayaran.
- Mengajukan pembayaran dengan screenshot JPG/PNG/WEBP maksimal 5 MB.
- Maksimal satu pengajuan berstatus `pending` per anggota.
- Melihat riwayat pengajuan dan statusnya.
- Mengubah profil, foto profil, dan password.
- Melihat perubahan data secara realtime.

### Admin
- Melihat daftar anggota, saldo, tunggakan, dan ringkasan kas.
- Meninjau pengajuan pembayaran dan membuka bukti melalui signed URL sementara.
- Menyetujui atau menolak pengajuan dengan catatan review opsional.
- Meninjau pendaftaran baru, mengaktifkan, menonaktifkan, atau menolak anggota.
- Membuat anggota baru dan menghapus akun hanya bila aman secara relasi/riwayat.
- Mengubah tarif kas harian.
- Melihat ledger kas dan riwayat transaksi.

Role admin harus disimpan pada `app_metadata.role` yang ditetapkan oleh proses tepercaya, bukan `user_metadata` yang dapat diubah pengguna.

## 4. Peta repositori

- `src/App.jsx`: alur UI utama, login, pendaftaran, pembayaran, review, profil, admin, realtime.
- `src/lib/supabase.js`: inisialisasi Supabase client dengan URL dan anon/publishable key.
- `supabase/migrations/`: perubahan skema, trigger, fungsi SQL, RLS, constraint, scheduler.
- `supabase/functions/register-member/index.ts`: pendaftaran anggota.
- `supabase/functions/account-profile/index.ts`: resolver login dan operasi profil/foto sesuai aksi yang diizinkan.
- `supabase/functions/create-member/index.ts`: pembuatan akun anggota oleh admin.
- `supabase/functions/delete-member/index.ts`: penghapusan akun anggota dengan pemeriksaan keamanan.
- `supabase/functions/cleanup-payment-proofs/index.ts`: pembersihan bukti pembayaran yang sudah melewati masa retensi.
- `package.json`: perintah build/development.
- `README.md`: ringkasan deploy dan setup.
- `MASTER_BLUEPRINT.md`: dokumen induk ini.

Sebelum membuat salinan, periksa seluruh isi file Edge Function dan semua migration di repo. Jangan mengandalkan nama file saja untuk menjamin perilaku identik.

## 5. Model data

Seluruh tabel inti berada di schema `public` dan RLS aktif.

### `member_profiles`
- `user_id`: UUID, PK, FK ke `auth.users.id`.
- `ic_name`: nama karakter/in-game; gunakan unique constraint/case-normalization agar tidak duplikat.
- `display_name`: nama tampilan.
- `login_username`: username login yang dinormalisasi.
- `member_status`: `pending`, `active`, `inactive`, `suspended`, atau `rejected`.
- `profile_image_path`: path objek foto profil.
- `dues_start_date`: tanggal mulai iuran berdasarkan WIB; tanggal ini penting untuk menghindari tunggakan fiktif.
- `created_by`, `created_at`, `updated_at`: audit metadata.

### `dues_settings`
Satu baris konfigurasi dengan `id = 1`, `daily_amount` (default 1000), `currency` (saat ini konfigurasi memakai `UIC`), `admin_fee`, `updated_by`, dan `updated_at`.

### `payment_submissions`
- `id`, `member_id`, `amount`, `days_covered`, `period_start`, `period_end`.
- `screenshot_path`, `status` (`pending`, `approved`, `rejected`).
- `member_note`, `review_note`, `reviewed_by`, `reviewed_at`.
- `created_at`, `updated_at`.

`created_at` adalah waktu pengajuan. `reviewed_at` adalah waktu keputusan admin. Jangan mengubah `created_at` untuk mewakili waktu approval. Periode adalah metadata pengajuan dan bukan dasar langsung untuk memotong dompet.

### `member_wallets`
- `user_id`: PK/FK ke akun anggota.
- `balance`: saldo yang tersedia, tidak boleh negatif.
- `arrears`: tunggakan, tidak boleh negatif.
- `updated_at`.

### `wallet_transactions`
Ledger pergerakan saldo/tunggakan: `member_id`, `payment_id` opsional, `transaction_type`, `amount`, `balance_after`, `arrears_after`, `description`, `created_at`.
Jenis transaksi: `payment_credit`, `daily_deduction`, `arrears_accrual`, `admin_adjustment`.

### `cash_ledger`
Buku kas pembayaran yang disetujui: `payment_id` unik, `member_id`, `entry_type`, `amount`, `description`, `created_by`, `created_at`. Unik per payment mencegah entri kas ganda.

### `daily_dues_log`
Snapshot pemotongan per anggota/tanggal: `member_id`, `due_date`, `daily_rate`, `balance_before`, `balance_after`, `arrears_added`, `arrears_after`, `created_at`. Wajib ada unique constraint pada pasangan anggota + tanggal agar job idempotent.

### Storage
- `payment-proofs`: bucket privat untuk bukti pembayaran.
- `profile-images`: foto profil; tentukan akses publik/privat sesuai kebijakan produk. Bila privat, tampilkan melalui signed URL.
- Simpan path objek, bukan URL permanen, untuk file sensitif.

## 6. Aturan bisnis yang wajib dipertahankan

### Approval pembayaran
1. Anggota mengirim nominal positif, jumlah hari 1–365, catatan opsional, dan bukti gambar valid.
2. Server/database memastikan anggota tidak punya pengajuan lain yang masih pending.
3. Status awal selalu `pending`.
4. Hanya admin tepercaya dapat membuat keputusan.
5. Approval harus menjadi satu transaksi database atomik: lock wallet, lunasi tunggakan dahulu, masukkan sisa nominal ke saldo, tulis `cash_ledger`, tulis `wallet_transactions`.
6. `cash_ledger.payment_id` dan `wallet_transactions.payment_id` harus unik agar retry tidak menggandakan uang.
7. Status final tidak boleh bolak-balik tanpa alur koreksi/audit eksplisit.
8. Catat `reviewed_by` dan `reviewed_at` saat keputusan dibuat.

Contoh: tunggakan 3.000 dan pembayaran disetujui 10.000 menghasilkan pelunasan tunggakan 3.000 dan saldo bertambah 7.000.

### Kas harian
- Tarif diambil dari `dues_settings.daily_amount` saat proses dijalankan.
- Proses menggunakan tanggal kalender WIB, bukan timezone perangkat anggota.
- Anggota aktif mulai dikenai iuran pada `dues_start_date`.
- Bila saldo cukup, potong tarif harian.
- Bila saldo tidak cukup, habiskan saldo dan tambahkan kekurangannya ke tunggakan.
- Simpan snapshot tarif dan hasilnya ke `daily_dues_log` dan `wallet_transactions`.
- Jalankan untuk hari kalender yang sudah selesai, pada 00:01 WIB (17:01 UTC), dengan tanggal target hari sebelumnya.
- Job harus idempotent: retry tidak boleh memotong hari yang sama dua kali.
- Kunci wallet saat mutasi untuk mencegah race condition antara cron dan approval pembayaran.
- Jika ditemukan tanggal historis yang hilang di tengah ledger, hentikan dan minta rekonsiliasi manual; jangan menerka-nerka saldo.

### Aktivasi anggota
- Anggota pending tidak ditagih.
- Saat status berubah menjadi active, tetapkan `dues_start_date` ke tanggal saat aktivasi di WIB.
- Anggota aktif yang sudah ada saat rollout diberi tanggal mulai eksplisit saat migrasi agar sistem tidak membuat tunggakan masa lalu tanpa data pendukung.

### Bukti pembayaran
- Validasi MIME dan ukuran file di client serta server bila memungkinkan.
- Bucket bukti privat.
- Admin mengakses bukti melalui signed URL singkat (implementasi saat ini 60 detik).
- Hapus bukti setelah 24 jam dari keputusan approved/rejected; jangan hapus bukti pengajuan pending.
- Job cleanup dijalankan terjadwal setiap 5 menit pada konfigurasi produksi saat ini; fungsi tetap harus memeriksa status dan umur sebelum menghapus.

## 7. Arsitektur request

1. Browser memuat aplikasi React/Vite dari Vercel.
2. Supabase client memakai `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.
3. Supabase Auth memvalidasi kredensial dan mengelola session.
4. Operasi data biasa memakai Supabase client dan dikendalikan RLS/constraint.
5. Operasi administratif sensitif (membuat/menghapus akun, registrasi, perubahan profil khusus) lewat Edge Function yang memvalidasi JWT/role/izin.
6. Trigger database menangani settlement approval secara konsisten, bukan logika saldo yang hanya hidup di browser.
7. pg_cron memanggil `process_daily_dues` untuk iuran harian.
8. Supabase Realtime memicu reload data saat tabel terkait berubah.
9. Storage menyimpan bukti/foto; signed URL memberi akses sementara sesuai izin.

## 8. Security checklist

- Jangan pernah menaruh service-role key, database password, PAT, atau secret di source code, chat, repo, atau variabel `VITE_*`.
- Frontend hanya memakai anon/publishable key; key publik bukan pengganti RLS.
- Aktifkan RLS untuk semua tabel data bisnis dan tulis policy least-privilege.
- Member hanya dapat membaca/mengubah profil dan melihat pengajuan/dompet/transaksi miliknya sesuai kebijakan.
- Member tidak boleh mengubah saldo, tunggakan, status approval, reviewer, ledger, atau tarif.
- Hanya role admin dari `app_metadata` tepercaya yang dapat meninjau pembayaran dan mengelola anggota/tarif.
- Validasi role di server/Edge Function, jangan percaya flag role dari React.
- Terapkan validasi input, constraint DB, unique constraint untuk pending/ledger/log, dan transaksi atomik.
- Bucket bukti pembayaran harus privat; signed URL pendek.
- Lindungi fungsi publik dari spam: rate limit/CAPTCHA bila diperlukan, batas panjang field, password policy, dan pencegahan duplikasi username.
- Jangan mengirim password ke log atau menyimpan password dalam tabel profil.
- Hindari hard-delete anggota yang memiliki transaksi/audit; nonaktifkan akun agar riwayat tetap konsisten.
- Gunakan audit log untuk perubahan tarif, status anggota, keputusan pembayaran, dan koreksi manual.
- Rotasi segera token/secret yang pernah terpapar.

## 9. Environment variables

Frontend Vercel / local:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (atau publishable key kompatibel)

Server-side secrets harus disimpan di Supabase Edge Function secrets atau secret manager deployment yang sesuai, tidak menggunakan prefix `VITE_`. Jangan salin nilai secret ke dokumen ini.

Contoh `.env.example` berisi nama variabel dan placeholder saja, tidak boleh nilai produksi.

## 10. Membangun ulang dari nol

### A. Buat layanan gratis
1. Buat repo GitHub baru.
2. Buat project Supabase di region yang sesuai; periksa batas Free Plan saat itu.
3. Buat project Vercel dan hubungkan repo GitHub.
4. Jangan membuat database branch berbayar hanya untuk mengikuti blueprint ini; bisa menggunakan migration lokal/review dan deployment terkontrol. Jangan menguji query destruktif pada produksi.
5. Pastikan ketiga layanan memakai akun yang dikuasai pemilik proyek.

### B. Siapkan kode
1. Pasang Node.js 20+.
2. Buat aplikasi React + Vite dan dependency yang tercantum di bagian Teknologi.
3. Tambahkan Supabase client pada `src/lib/supabase.js`.
4. Implementasikan halaman autentikasi, dashboard member, formulir pembayaran, riwayat, profil, panel admin, dan layout responsif.
5. Pecah `App.jsx` menjadi komponen terpisah saat mengembangkan ulang agar logika bisnis dan UI tidak terlalu tercampur.
6. Jalankan `npm install`, `npm run dev`, lalu `npm run build`.

### C. Siapkan database
1. Salin migration dari repo sumber secara berurutan ke project baru.
2. Audit setiap migration dan sesuaikan role, storage policy, trigger, constraint, dan extension yang dibutuhkan.
3. Terapkan skema lewat Supabase migrations/CLI atau SQL Editor yang terkontrol.
4. Buat bucket `payment-proofs` privat dan bucket foto profil sesuai kebijakan akses.
5. Aktifkan RLS dan buat policy per tabel.
6. Konfigurasikan pg_cron/pg_net bila dipakai, dan verifikasi job serta log.
7. Buat satu akun admin pertama melalui Supabase Auth lalu tetapkan `app_metadata.role = admin` lewat proses tepercaya. Jangan memberi role admin lewat form pendaftaran.

### D. Edge Functions
Deploy fungsi yang dibutuhkan:
- `register-member`
- `account-profile`
- `create-member`
- `delete-member`
- `cleanup-payment-proofs`

Audit kode setiap fungsi sebelum deploy, terutama apakah fungsi menerima JWT, bagaimana role diverifikasi, bagaimana CORS ditangani, dan bagaimana service-role key digunakan. Fungsi pendaftaran publik harus punya validasi/rate limit memadai dan tidak boleh memberi role admin.

### E. Deploy
1. Atur `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` di Vercel.
2. Build dan deploy ke preview dahulu bila tersedia tanpa biaya tambahan.
3. Pastikan login, RLS, upload, signed URL, approval, settlement, cron, dan cleanup berjalan.
4. Setelah lulus tes, promote/merge ke production.
5. Periksa deployment READY, browser console, Supabase logs, cron history, dan Storage.
6. Simpan backup migration dan prosedur rollback sebelum perubahan database besar.

## 11. Checklist pengujian wajib

Gunakan akun admin dan member yang berbeda serta nominal dummy.

- [ ] Pengunjung dapat mendaftar, status awal pending.
- [ ] Member pending tidak bisa memakai dashboard/fitur transaksi.
- [ ] Admin menyetujui pendaftaran; member dapat login setelah aktif.
- [ ] Member A tidak dapat membaca profil, wallet, transaksi, atau pengajuan Member B melalui API langsung.
- [ ] Member tidak dapat mengubah role, status pembayaran, saldo, tunggakan, tarif, atau ledger.
- [ ] Upload bukti menolak tipe file salah dan file di atas 5 MB.
- [ ] Pengajuan kedua ditolak saat masih ada pengajuan pending.
- [ ] Approval menulis satu ledger dan satu transaksi, tidak ganda saat retry.
- [ ] Pembayaran melunasi tunggakan lebih dulu, sisanya masuk saldo.
- [ ] Rejection tidak menambah saldo atau ledger pembayaran.
- [ ] Dua proses bersamaan tidak menghasilkan saldo negatif atau charge ganda.
- [ ] Daily dues memproses tanggal WIB yang benar, termasuk ketika job terlambat.
- [ ] Missing historical log menghentikan proses dengan pesan yang bisa ditindaklanjuti.
- [ ] Signed URL tidak bisa dipakai setelah kedaluwarsa dan anggota biasa tidak dapat membaca bukti orang lain.
- [ ] Cleanup tidak menghapus bukti pending dan hanya menghapus bukti yang sudah melewati retensi.
- [ ] Penghapusan anggota dengan riwayat ditolak atau diarahkan ke nonaktif.
- [ ] Ganti tarif tidak mengubah snapshot tarif historis.
- [ ] Build produksi berhasil; tidak ada secret di bundle frontend.
- [ ] Uji mobile dan desktop.

## 12. Monitoring dan pemeliharaan

- Pantau Supabase Auth, Edge Function, Postgres, Storage, dan Realtime logs.
- Pantau `cron.job_run_details` untuk job iuran dan cleanup.
- Bandingkan saldo/tunggakan dengan `wallet_transactions`, `daily_dues_log`, dan `cash_ledger` secara berkala.
- Backup database dan simpan migration di GitHub.
- Review dependency dan security advisories.
- Periksa kuota Free Plan Supabase/Vercel secara berkala; “gratis” bukan berarti kuota tanpa batas.
- Jangan menghapus transaksi untuk merapikan tampilan. Gunakan arsip/soft-delete dan audit trail.
- Lakukan rekonsiliasi manual sebelum memperbaiki ledger yang tidak konsisten.

## 13. Status dan batasan snapshot saat dokumen dibuat

- Repo sumber: https://github.com/vergilwebkas-eng/webkas-fam-sos
- Website produksi: https://webkas-fam-sos.vercel.app
- Backend: Supabase.
- Iuran harian produksi dijadwalkan pukul 00:01 WIB; targetnya adalah hari WIB sebelumnya.
- Bukti pembayaran yang sudah diputuskan dijadwalkan dibersihkan setelah retensi 24 jam.
- Migration `20261019120000_harden_daily_dues_and_payment_settlement.sql` menambahkan `dues_start_date`, settlement yang melunasi tunggakan dahulu, dan catch-up harian idempotent dengan pemeriksaan gap.
- Pada snapshot terakhir, belum ada transaksi pembayaran approved yang menguji trigger settlement secara nyata, dan eksekusi cron pertama setelah migration belum tercatat. Karena itu, status deployment tidak sama dengan bukti seluruh alur telah lulus end-to-end test.
- Konfigurasi tarif yang terlihat pada database saat snapshot: `daily_amount = 1000`, `currency = UIC`, `admin_fee = 0`. Konfirmasi apakah mata uang/label tersebut memang yang diinginkan sebelum menyalin sistem untuk organisasi lain.

## 14. Cara memakai blueprint ini untuk proyek berikutnya

1. Salin file ini ke repo baru sebagai `MASTER_BLUEPRINT.md`.
2. Ubah nama aplikasi, logo, warna, nama role, currency, aturan tarif, masa retensi file, dan domain.
3. Pertahankan prinsip keamanan, idempotensi, transaksi atomik, audit trail, timezone eksplisit, dan RLS.
4. Terapkan database migration ke project Supabase BARU, bukan ke database Webkas produksi.
5. Buat ulang secret dan akun admin khusus proyek baru; jangan salin secret, user UUID, data member, bukti, atau kredensial produksi.
6. Uji semua checklist di atas sebelum mengelola uang sungguhan.

---
Dokumen ini adalah master spesifikasi teknis yang bisa dipakai ulang. Untuk salinan yang benar-benar identik, source code, semua migration, Edge Functions, Storage policies, RLS policies, cron jobs, environment setup, dan pengaturan deployment juga harus ikut direplikasi dan diverifikasi.
