import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BadgeCheck, Banknote, CalendarClock, Check, ChevronRight, CircleAlert, Clock3, FileImage, History, KeyRound, LogOut, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, Wallet, X } from 'lucide-react';
import { emailFromIc, supabase, supabaseConfigured } from './lib/supabase';

const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateTime = (value) => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const dateOnly = (value) => value ? new Date(value + 'T00:00:00').toLocaleDateString('id-ID', { dateStyle: 'medium' }) : '—';
const friendlyError = (error) => error?.message || 'Terjadi kesalahan. Coba lagi.';

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState('login');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [history, setHistory] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [setting, setSetting] = useState({ daily_amount: 1000, currency: 'IDR' });
  const [tab, setTab] = useState('members');
  const [search, setSearch] = useState('');
  const [memberModal, setMemberModal] = useState(false);
  const [createdAccount, setCreatedAccount] = useState(null);
  const [reviewNote, setReviewNote] = useState({});
  const [proofUrl, setProofUrl] = useState('');
  const [form, setForm] = useState({ ic: '', password: '' });

  const role = session?.user?.app_metadata?.admin_level || (session?.user?.app_metadata?.role === 'admin' ? 'pendukung' : 'member');
  const isAdmin = session?.user?.app_metadata?.role === 'admin';
  const isMainAdmin = isAdmin && role === 'utama';

  const notify = useCallback((text, type = 'success') => {
    setNotice({ text, type });
    window.setTimeout(() => setNotice({ text: '', type: '' }), 5000);
  }, []);

  const loadMemberData = useCallback(async (userId) => {
    const [{ data: p, error: pe }, { data: h, error: he }, { data: l, error: le }, { data: s }] = await Promise.all([
      supabase.from('member_profiles').select('*').eq('user_id', userId).single(),
      supabase.from('payment_submissions').select('*').eq('member_id', userId).order('created_at', { ascending: false }).limit(30),
      supabase.from('cash_ledger').select('*').eq('member_id', userId).order('created_at', { ascending: false }).limit(30),
      supabase.from('dues_settings').select('daily_amount,currency').eq('id', 1).single(),
    ]);
    if (pe) throw pe;
    if (he) throw he;
    if (le) throw le;
    setProfile(p);
    setHistory(h || []);
    setLedger(l || []);
    if (s) setSetting(s);
    return p;
  }, []);

  const loadAdminData = useCallback(async () => {
    const [{ data: m, error: me }, { data: p, error: pe }, { data: s, error: se }, { data: l, error: le }] = await Promise.all([
      supabase.from('member_profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('payment_submissions').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('dues_settings').select('daily_amount,currency').eq('id', 1).single(),
      supabase.from('cash_ledger').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    if (me) throw me;
    if (pe) throw pe;
    if (se) throw se;
    if (le) throw le;
    setMembers(m || []);
    setPayments(p || []);
    setLedger(l || []);
    if (s) setSetting(s);
  }, []);

  const hydrate = useCallback(async (activeSession) => {
    if (!activeSession?.user) { setSession(null); setProfile(null); return; }
    setSession(activeSession);
    const { data, error } = await supabase.from('member_profiles').select('*').eq('user_id', activeSession.user.id).single();
    if (error || !data) { await supabase.auth.signOut(); setSession(null); notify('Profil akun tidak ditemukan. Hubungi admin.', 'error'); return; }
    if (data.member_status !== 'active') { await supabase.auth.signOut(); setSession(null); setProfile(data); notify('Akun sedang tidak aktif. Hubungi admin keluarga.', 'error'); return; }
    setProfile(data);
    try {
      if (activeSession.user.app_metadata?.role === 'admin') await loadAdminData();
      else await loadMemberData(activeSession.user.id);
    } catch (err) { notify(friendlyError(err), 'error'); }
  }, [loadAdminData, loadMemberData, notify]);

  useEffect(() => {
    if (!supabaseConfigured) return undefined;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) hydrate(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { if (alive) hydrate(nextSession); });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [hydrate]);

  useEffect(() => {
    if (!session || !supabase) return undefined;
    const channel = supabase.channel('webkas-live-' + session.user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_submissions' }, () => {
        if (isAdmin) loadAdminData().catch((e) => notify(friendlyError(e), 'error'));
        else loadMemberData(session.user.id).catch((e) => notify(friendlyError(e), 'error'));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_profiles' }, () => {
        if (isAdmin) loadAdminData().catch((e) => notify(friendlyError(e), 'error'));
        else loadMemberData(session.user.id).catch((e) => notify(friendlyError(e), 'error'));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, isAdmin, loadAdminData, loadMemberData, notify]);

  async function login(event) {
    event.preventDefault(); setBusy(true); setNotice({ type: '', text: '' });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailFromIc(form.ic), password: form.password });
      if (error) throw new Error('Nama IC atau password salah.');
      await hydrate(data.session);
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function activate(event) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    const confirm = String(data.get('confirm') || '');
    if (password.length < 8) { notify('Password minimal 8 karakter.', 'error'); setBusy(false); return; }
    if (password !== confirm) { notify('Konfirmasi password belum cocok.', 'error'); setBusy(false); return; }
    try {
      const { data: result, error } = await supabase.functions.invoke('activate-member', { body: { ic_name: data.get('ic'), activation_code: data.get('code'), password, confirm_password: confirm } });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      notify('Akun berhasil diaktifkan. Silakan masuk menggunakan Nama IC dan password baru.'); setView('login');
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function bootstrap(event) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    const confirm = String(data.get('confirm') || '');
    if (password.length < 12) { notify('Gunakan password admin minimal 12 karakter.', 'error'); setBusy(false); return; }
    if (password !== confirm) { notify('Konfirmasi password tidak cocok.', 'error'); setBusy(false); return; }
    try {
      const { data: result, error } = await supabase.functions.invoke('bootstrap-admin', { body: { bootstrap_token: data.get('token'), ic_name: data.get('ic'), password, confirm_password: confirm } });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      notify('Admin utama berhasil dibuat. Masuk menggunakan IC dan password yang baru dibuat.'); setView('login');
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function logout() { await supabase.auth.signOut(); setSession(null); setProfile(null); setView('login'); }

  async function submitPayment(event) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get('amount'));
    const file = data.get('proof');
    const note = String(data.get('note') || '').trim();
    if (!Number.isSafeInteger(amount) || amount < 1000) { notify('Nominal pembayaran minimal Rp1.000 dan harus berupa angka bulat.', 'error'); setBusy(false); return; }
    if (!(file instanceof File) || !file.size) { notify('Pilih screenshot bukti transfer terlebih dahulu.', 'error'); setBusy(false); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { notify('Bukti harus JPG, PNG, atau WEBP maksimal 5 MB.', 'error'); setBusy(false); return; }
    const path = session.user.id + '/' + crypto.randomUUID() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    try {
      const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('payment_submissions').insert({ member_id: session.user.id, amount, days_covered: Math.max(1, Math.floor(amount / Number(setting.daily_amount || 1000))), period_start: today, period_end: today, screenshot_path: path, member_note: note || null, status: 'pending' });
      if (error) { await supabase.storage.from('payment-proofs').remove([path]); throw error; }
      event.currentTarget.reset(); notify('Pengajuan berhasil dikirim. Menunggu pemeriksaan admin.'); await loadMemberData(session.user.id);
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function createAccount(event) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const { data: result, error } = await supabase.functions.invoke('create-member', { body: { ic_name: data.get('ic'), display_name: data.get('display') || data.get('ic'), account_role: data.get('role') || 'member' } });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      setCreatedAccount(result); setMemberModal(false); event.currentTarget.reset(); await loadAdminData();
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function reviewPayment(payment, status) {
    setBusy(true);
    try {
      const { error } = await supabase.from('payment_submissions').update({ status, reviewed_by: session.user.id, reviewed_at: new Date().toISOString(), review_note: String(reviewNote[payment.id] || '').trim() || null }).eq('id', payment.id).eq('status', 'pending');
      if (error) throw error;
      notify(status === 'approved' ? 'Pembayaran diterima dan saldo diperbarui.' : 'Pembayaran ditolak.'); await loadAdminData();
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function showProof(path) {
    if (!path || path.startsWith('[')) { notify('Bukti sudah dihapus sesuai kebijakan penyimpanan.', 'error'); return; }
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 60);
    if (error) { notify(friendlyError(error), 'error'); return; }
    setProofUrl(data.signedUrl);
  }

  async function updateMemberStatus(member, status) {
    setBusy(true);
    try {
      const { error } = await supabase.from('member_profiles').update({ member_status: status }).eq('user_id', member.user_id);
      if (error) throw error;
      notify('Status akun diperbarui.'); await loadAdminData();
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function saveSettings(event) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget); const amount = Number(data.get('daily_amount'));
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000) { notify('Tarif kas harus angka bulat yang valid.', 'error'); setBusy(false); return; }
    try {
      const { error } = await supabase.from('dues_settings').update({ daily_amount: amount, currency: 'IDR', updated_by: session.user.id, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) throw error;
      setSetting({ daily_amount: amount, currency: 'IDR' }); notify('Tarif kas harian disimpan. Riwayat tarif lama tetap tercatat.');
    } catch (err) { notify(friendlyError(err), 'error'); }
    finally { setBusy(false); }
  }

  async function refresh() { setLoading(true); try { if (isAdmin) await loadAdminData(); else await loadMemberData(session.user.id); } catch (err) { notify(friendlyError(err), 'error'); } finally { setLoading(false); } }

  const filteredMembers = useMemo(() => members.filter((m) => (m.ic_name || '').toLowerCase().includes(search.toLowerCase())), [members, search]);
  const pendingPayments = payments.filter((p) => p.status === 'pending');

  if (!supabaseConfigured) return <div className="setup-screen"><div className="setup-card"><div className="brand-mark">W<span>+</span></div><p className="eyebrow">STREET OF STYLE FAMILY</p><h1>WEBKAS <span>FAM SOS</span></h1><p>Konfigurasi Supabase belum diisi. Atur <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> pada environment hosting, lalu build ulang aplikasi.</p><p className="muted">Jangan pernah memasukkan service-role key ke frontend.</p></div></div>;

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#top" onClick={(e) => e.preventDefault()}><span className="brand-icon">W<span>+</span></span><span><strong>WEBKAS</strong><small>FAM SOS / FINANCE SYSTEM</small></span></a>
      {session && <div className="top-actions"><div className="identity"><span className="online-dot" /> <span>{profile?.ic_name || session.user.user_metadata?.ic_name || 'Member'}</span><small>{isMainAdmin ? 'ADMIN UTAMA' : isAdmin ? 'ADMIN PENDUKUNG' : 'MEMBER'}</small></div><button className="icon-button" onClick={refresh} title="Muat ulang"><RefreshCw size={17} /></button><button className="logout-button" onClick={logout}><LogOut size={16} /><span>Keluar</span></button></div>}
    </header>
    {notice.text && <div className={'notice ' + notice.type}><span>{notice.type === 'error' ? <CircleAlert size={18} /> : <BadgeCheck size={18} />}</span>{notice.text}<button onClick={() => setNotice({ type: '', text: '' })} aria-label="Tutup"><X size={16} /></button></div>}
    {!session ? <main className="auth-layout"><div className="hero-copy"><p className="eyebrow"><span className="online-dot" /> FINANCIAL CONTROL / SOS</p><h1>Solidaritas<br/><span>ada hitungannya.</span></h1><p>Kas keluarga tercatat rapi, pembayaran diperiksa admin, dan setiap perubahan bisa ditelusuri. Bukan lagi mengandalkan ingatan grup chat.</p><div className="hero-stats"><div><ShieldCheck size={18}/><span>AKSES TERKONTROL</span></div><div><Activity size={18}/><span>PEMBARUAN REALTIME</span></div></div></div>
      <section className="auth-card"><div className="auth-card-head"><span className="panel-kicker">MEMBER ACCESS</span><h2>{view === 'login' ? 'Masuk ke sistem' : view === 'activate' ? 'Aktivasi akun' : 'Setup admin utama'}</h2><p>{view === 'login' ? 'Gunakan Nama IC dan password akun kamu.' : view === 'activate' ? 'Masukkan kode aktivasi yang diberikan admin.' : 'Gunakan kode setup sekali pakai untuk membuat admin pertama.'}</p></div>
        <div className="auth-tabs"><button className={view === 'login' ? 'active' : ''} onClick={() => setView('login')}>MASUK</button><button className={view === 'activate' ? 'active' : ''} onClick={() => setView('activate')}>AKTIVASI</button></div>
        {view === 'login' && <form className="form-stack" onSubmit={login}><Field label="Nama In-Game (IC)" name="ic" value={form.ic} onChange={(v) => setForm({ ...form, ic: v })} placeholder="Contoh: Nama_IC" required/><Field label="Password" name="password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="Masukkan password" required/><button className="primary-button" disabled={busy}>{busy ? 'MEMERIKSA...' : 'MASUK KE WEBKAS'}<ChevronRight size={18}/></button><button type="button" className="text-button" onClick={() => setView('bootstrap')}>Setup admin utama pertama <KeyRound size={14}/></button></form>}
        {view === 'activate' && <form className="form-stack" onSubmit={activate}><Field label="Nama IC terdaftar" name="ic" placeholder="Nama IC dari admin" required/><Field label="Kode aktivasi" name="code" placeholder="Kode dari admin" required/><Field label="Password baru" name="password" type="password" placeholder="Minimal 8 karakter" required/><Field label="Konfirmasi password" name="confirm" type="password" placeholder="Ulangi password baru" required/><button className="primary-button" disabled={busy}>{busy ? 'MENGAKTIFKAN...' : 'AKTIFKAN AKUN'}<ChevronRight size={18}/></button></form>}
        {view === 'bootstrap' && <form className="form-stack" onSubmit={bootstrap}><div className="warning-note"><ShieldCheck size={18}/> Hanya bisa digunakan sekali, sebelum admin utama pertama dibuat.</div><Field label="Kode setup sekali pakai" name="token" placeholder="Kode yang disediakan saat setup" required/><Field label="Nama IC admin utama" name="ic" placeholder="Nama IC admin" required/><Field label="Password admin" name="password" type="password" placeholder="Minimal 12 karakter" required/><Field label="Konfirmasi password" name="confirm" type="password" placeholder="Ulangi password" required/><button className="primary-button" disabled={busy}>{busy ? 'MENYIAPKAN...' : 'BUAT ADMIN UTAMA'}<ShieldCheck size={18}/></button></form>}
        <div className="auth-foot"><span>ENCRYPTED AUTHENTICATION</span><span>V1.0 / 2026</span></div>
      </section></main> : <main className="dashboard">
      <section className="welcome-row"><div><p className="eyebrow">OVERVIEW / {isAdmin ? 'ADMIN CONTROL' : 'MEMBER SPACE'}</p><h1>{isAdmin ? 'Panel kontrol.' : 'Dashboard kas.'}</h1><p>{isAdmin ? 'Kelola anggota dan tinjau pengajuan pembayaran.' : 'Pantau saldo, tunggakan, dan status pembayaran kamu.'}</p></div><div className="daily-rate"><span>KAS HARIAN</span><strong>{money(setting.daily_amount)}</strong><small><CalendarClock size={13}/> Per hari / WIB</small></div></section>
      {isAdmin ? <>
        <div className="stat-grid"><Stat icon={<Users/>} label="TOTAL AKUN" value={members.length} note="Termasuk akun nonaktif"/><Stat icon={<Clock3/>} label="MENUNGGU REVIEW" value={pendingPayments.length} note="Perlu keputusan admin"/><Stat icon={<Banknote/>} label="PEMBAYARAN TERCATAT" value={payments.filter((p) => p.status === 'approved').length} note="Pengajuan diterima"/><Stat icon={<Wallet/>} label="SALDO MEMBER" value={money(members.reduce((sum, m) => sum + Number(m.balance || 0), 0))} note="Total saldo aktif"/></div>
        <div className="content-panel"><div className="panel-heading"><div><p className="panel-kicker">MANAGEMENT CONSOLE</p><h2>Administrasi kas</h2></div><div className="tab-row"><button className={tab === 'members' ? 'selected' : ''} onClick={() => setTab('members')}><Users size={15}/> Member</button><button className={tab === 'payments' ? 'selected' : ''} onClick={() => setTab('payments')}><FileImage size={15}/> Verifikasi <b>{pendingPayments.length}</b></button><button className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}><CalendarClock size={15}/> Tarif</button><button className={tab === 'ledger' ? 'selected' : ''} onClick={() => setTab('ledger')}><History size={15}/> Buku kas</button></div></div>
          {tab === 'members' && <><div className="table-tools"><label className="search-box"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari Nama IC..."/></label><button className="primary-button compact" onClick={() => setMemberModal(true)}><Plus size={16}/> Buat akun</button></div><div className="table-wrap"><table><thead><tr><th>NAMA IC</th><th>ROLE</th><th>STATUS</th><th>SALDO</th><th>TUNGGAKAN</th><th>AKSI</th></tr></thead><tbody>{filteredMembers.map((m) => <tr key={m.user_id}><td><strong>{m.ic_name}</strong><small>{m.display_name || m.ic_name}</small></td><td><span className="role-pill">{(m.role || 'member').replace('_', ' ')}</span></td><td><span className={'status-pill ' + m.member_status}>{m.member_status}</span></td><td className="number">{money(m.balance)}</td><td className="number debt">{money(m.arrears)}</td><td>{m.role === 'admin_utama' ? <span className="muted">Dilindungi</span> : <button className="small-action" disabled={busy || m.member_status === 'pending_activation'} onClick={() => updateMemberStatus(m, m.member_status === 'active' ? 'inactive' : 'active')}>{m.member_status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}</button>}</td></tr>)}{!filteredMembers.length && <Empty colSpan={6} text="Belum ada akun yang cocok."/>}</tbody></table></div></>}
          {tab === 'payments' && <div className="table-wrap"><table><thead><tr><th>MEMBER / WAKTU</th><th>NOMINAL</th><th>STATUS</th><th>BUKTI</th><th>CATATAN ADMIN</th><th>KEPUTUSAN</th></tr></thead><tbody>{payments.map((p) => { const m = members.find((x) => x.user_id === p.member_id); return <tr key={p.id}><td><strong>{m?.ic_name || 'Member'}</strong><small>{dateTime(p.created_at)}</small></td><td className="number">{money(p.amount)}</td><td><span className={'status-pill ' + p.status}>{p.status}</span></td><td><button className="small-action" onClick={() => showProof(p.screenshot_path)}><FileImage size={14}/> Lihat</button></td><td>{p.status === 'pending' ? <input className="inline-input" value={reviewNote[p.id] || ''} onChange={(e) => setReviewNote({ ...reviewNote, [p.id]: e.target.value })} placeholder="Opsional"/> : (p.review_note || '—')}</td><td>{p.status === 'pending' ? <div className="decision-actions"><button className="approve-button" disabled={busy} onClick={() => reviewPayment(p, 'approved')}><Check size={14}/></button><button className="reject-button" disabled={busy} onClick={() => reviewPayment(p, 'rejected')}><X size={14}/></button></div> : <span className="muted">{dateTime(p.reviewed_at)}</span>}</td></tr>; })}{!payments.length && <Empty colSpan={6} text="Belum ada pengajuan pembayaran."/>}</tbody></table></div>}
          {tab === 'settings' && <form className="settings-form" onSubmit={saveSettings}><div className="settings-info"><span className="settings-icon"><CalendarClock/></span><div><h3>Tarif kas harian</h3><p>Tarif baru berlaku untuk perhitungan berikutnya. Catatan tarif lama tidak diubah.</p></div></div><label className="field"><span>NOMINAL KAS (RUPIAH)</span><input type="number" name="daily_amount" min="0" step="100" defaultValue={setting.daily_amount} required/></label><button className="primary-button compact" disabled={busy}>Simpan tarif <Check size={15}/></button><div className="warning-note"><CircleAlert size={17}/> Perhitungan harian berjalan otomatis pukul 00.00 WIB setelah scheduler database aktif.</div></form>}
          {tab === 'ledger' && <div className="table-wrap"><table><thead><tr><th>WAKTU</th><th>MEMBER</th><th>JENIS</th><th>KETERANGAN</th><th>NOMINAL</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td>{dateTime(entry.created_at)}</td><td>{members.find((m) => m.user_id === entry.member_id)?.ic_name || '—'}</td><td><span className="role-pill">{entry.entry_type}</span></td><td>{entry.description || '—'}</td><td className="number">{money(entry.amount)}</td></tr>)}{!ledger.length && <Empty colSpan={5} text="Buku kas masih kosong."/>}</tbody></table></div>}
        </div>
      </> : <>
        <div className="stat-grid member-stats"><Stat icon={<Wallet/>} label="SISA SALDO" value={money(profile?.balance)} note="Siap digunakan untuk kas harian"/><Stat icon={<CircleAlert/>} label="TOTAL TUNGGAKAN" value={money(profile?.arrears)} note="Kekurangan kas yang belum tertutup"/><Stat icon={<Clock3/>} label="PENGAJUAN PENDING" value={history.filter((p) => p.status === 'pending').length} note="Menunggu verifikasi admin"/></div>
        <div className="member-grid"><section className="content-panel payment-form-panel"><div className="panel-heading"><div><p className="panel-kicker">PAYMENT SUBMISSION</p><h2>Ajukan pembayaran</h2></div><span className="panel-icon"><Banknote/></span></div><form className="form-stack" onSubmit={submitPayment}><Field label="Nominal bayar (Rp)" name="amount" type="number" min="1000" step="1000" placeholder="Contoh: 10000" required/><label className="field"><span>BUKTI SCREENSHOT TRANSFER</span><input type="file" name="proof" accept="image/jpeg,image/png,image/webp" required/><small>JPG, PNG, WEBP. Maksimal 5 MB. Bukti akan dihapus 24 jam setelah diverifikasi.</small></label><label className="field"><span>CATATAN (OPSIONAL)</span><textarea name="note" rows="3" maxLength="500" placeholder="Catatan untuk admin..."/></label><button className="primary-button" disabled={busy}>{busy ? 'MENGIRIM...' : 'KIRIM PENGAJUAN'}<ChevronRight size={17}/></button></form></section>
          <section className="content-panel"><div className="panel-heading"><div><p className="panel-kicker">PAYMENT HISTORY</p><h2>Riwayat pengajuan</h2></div><History size={20} className="muted-icon"/></div><div className="history-list">{history.map((p) => <div className="history-item" key={p.id}><span className="history-icon"><Banknote size={17}/></span><div className="history-main"><strong>{money(p.amount)}</strong><small>{dateTime(p.created_at)}</small>{p.review_note && <small className="review-note">Catatan: {p.review_note}</small>}</div><span className={'status-pill ' + p.status}>{p.status}</span></div>)}{!history.length && <Empty text="Belum ada riwayat pengajuan."/>}</div></section>
        </div>
        <section className="content-panel"><div className="panel-heading"><div><p className="panel-kicker">CASH ACTIVITY</p><h2>Aktivitas buku kas</h2></div></div><div className="history-list">{ledger.map((entry) => <div className="history-item" key={entry.id}><span className="history-icon"><Activity size={17}/></span><div className="history-main"><strong>{entry.description || entry.entry_type}</strong><small>{dateTime(entry.created_at)}</small></div><strong className="number">{money(entry.amount)}</strong></div>)}{!ledger.length && <Empty text="Aktivitas kas akan muncul di sini."/>}</div></section>
      </>}
    </main>}
    <footer className="footer"><span>WEBKAS FAM SOS <b>•</b> FINANCIAL SYSTEM</span><span>BUILT FOR STREET OF STYLE FAMILY / 2026</span></footer>

    {memberModal && <div className="modal-backdrop" onClick={() => setMemberModal(false)}><section className="modal-card" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">ACCOUNT PROVISIONING</p><h2>Buat akun baru</h2></div><button className="icon-button" onClick={() => setMemberModal(false)}><X size={17}/></button></div><p className="muted">Akun dibuat nonaktif sampai member memasukkan kode aktivasi yang akan ditampilkan setelah dibuat.</p><form className="form-stack" onSubmit={createAccount}><Field label="Nama In-Game (IC)" name="ic" placeholder="Nama IC unik" required/><Field label="Nama tampilan (opsional)" name="display" placeholder="Nama tampilan"/><label className="field"><span>JENIS AKUN</span><select name="role" defaultValue="member"><option value="member">Member</option>{isMainAdmin && <option value="admin_pendukung">Admin pendukung</option>}</select></label><button className="primary-button" disabled={busy}>{busy ? 'MEMBUAT AKUN...' : 'BUAT AKUN'}<Plus size={17}/></button></form></section></div>}
    {createdAccount && <div className="modal-backdrop" onClick={() => setCreatedAccount(null)}><section className="modal-card" onClick={(e) => e.stopPropagation()}><div className="success-mark"><Check size={28}/></div><p className="panel-kicker">ACCOUNT CREATED</p><h2>Akun berhasil dibuat</h2><p>Berikan kode aktivasi ini secara pribadi kepada pemilik akun. Kode hanya ditampilkan sekali.</p><div className="code-panel"><span>NAMA IC</span><strong>{createdAccount.ic_name}</strong><span>KODE AKTIVASI</span><code>{createdAccount.activation_code}</code><span>KADALUARSA</span><strong>{dateTime(createdAccount.activation_expires_at)}</strong></div><button className="primary-button" onClick={() => { navigator.clipboard?.writeText('Nama IC: ' + createdAccount.ic_name + '\nKode aktivasi: ' + createdAccount.activation_code); notify('Detail akun disalin jika izin clipboard tersedia.'); }}><KeyRound size={16}/> Salin detail aktivasi</button><button className="text-button" onClick={() => setCreatedAccount(null)}>Tutup</button></section></div>}
    {proofUrl && <div className="modal-backdrop" onClick={() => setProofUrl('')}><section className="proof-modal" onClick={(e) => e.stopPropagation()}><button className="icon-button proof-close" onClick={() => setProofUrl('')}><X size={18}/></button><img src={proofUrl} alt="Bukti pembayaran"/><p className="muted">Tautan bukti berlaku 60 detik.</p></section></div>}
  </div>;
}

function Field({ label, name, type = 'text', value, onChange, placeholder, required = false, min, step }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} placeholder={placeholder} required={required} min={min} step={step} autoComplete={type === 'password' ? 'current-password' : undefined}/></label>;
}
function Stat({ icon, label, value, note }) { return <article className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span></div><strong className="stat-value">{value}</strong><small>{note}</small></article>; }
function Empty({ text, colSpan }) { return <tr><td colSpan={colSpan}><div className="empty-state"><span><History size={19}/></span><p>{text}</p></div></td></tr>; }
