import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured } from './lib/supabase.js';

const money = (value, currency = 'IDR') => new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
const date = (value) => value ? new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);
const initialPeriodEnd = () => { const d = new Date(); d.setDate(d.getDate() + 0); return d.toISOString().slice(0, 10); };

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [payments, setPayments] = useState([]);
  const [members, setMembers] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('1');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState(null);
  const [search, setSearch] = useState('');
  const [newMember, setNewMember] = useState({ email: '', password: '', ic_name: '', display_name: '' });
  const [dailyAmount, setDailyAmount] = useState('1000');
  const [reviewNotes, setReviewNotes] = useState({});

  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  const loadData = useCallback(async (user = session?.user) => {
    if (!supabase || !user) return;
    setError('');
    const [pRes, sRes, payRes, memberRes, ledgerRes, walletRes] = await Promise.all([
      supabase.from('member_profiles').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('dues_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('payment_submissions').select('*').order('created_at', { ascending: false }).limit(100),
      isAdmin ? supabase.from('member_profiles').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
      supabase.from('cash_ledger').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('member_wallets').select('*')
    ]);
    const firstError = [pRes, sRes, payRes, memberRes, ledgerRes, walletRes].find(x => x.error);
    if (firstError) setError(firstError.error.message);
    setProfile(pRes.data || null);
    setSettings(sRes.data || null);
    setDailyAmount(String(sRes.data?.daily_amount ?? 1000));
    setPayments(payRes.data || []);
    setMembers(memberRes.data || []);
    setLedger(ledgerRes.data || []);
    setWallets(walletRes.data || []);
    if (pRes.data?.member_status && pRes.data.member_status !== 'active' && !isAdmin) {
      await supabase.auth.signOut();
      setError('Akun member sedang tidak aktif. Hubungi admin.');
    }
  }, [session?.user, isAdmin]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { setProfile(null); setPayments([]); setMembers([]); setLedger([]); setLoading(false); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setLoading(false); return; }
    setLoading(true);
    loadData(session.user).finally(() => setLoading(false));
  }, [session?.user?.id, loadData]);

  useEffect(() => {
    if (!session?.user || !supabase) return;
    const channel = supabase.channel('webkas-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_submissions' }, () => loadData(session.user))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_profiles' }, () => loadData(session.user))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dues_settings' }, () => loadData(session.user))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, loadData]);

  async function signIn(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (e1) setError(e1.message);
    setBusy(false);
  }
  async function signOut() { await supabase.auth.signOut(); setSession(null); setTab('overview'); }
  async function submitPayment(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (!proof) throw new Error('Pilih screenshot bukti pembayaran terlebih dahulu.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(proof.type)) throw new Error('Format screenshot harus JPG, PNG, atau WEBP.');
      if (proof.size > 5 * 1024 * 1024) throw new Error('Ukuran screenshot maksimal 5 MB.');
      const n = Number(days); const amt = Number(amount);
      if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error('Jumlah hari harus 1 sampai 365.');
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Nominal pembayaran harus lebih dari nol.');
      const start = today(); const endD = new Date(start + 'T12:00:00'); endD.setDate(endD.getDate() + n - 1);
      const path = session.user.id + '/' + crypto.randomUUID() + '-' + proof.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const upload = await supabase.storage.from('payment-proofs').upload(path, proof, { contentType: proof.type, upsert: false });
      if (upload.error) throw upload.error;
      const result = await supabase.from('payment_submissions').insert({
        member_id: session.user.id, amount: Math.round(amt), days_covered: n,
        period_start: start, period_end: endD.toISOString().slice(0, 10),
        screenshot_path: path, status: 'pending', member_note: note.trim() || null
      });
      if (result.error) {
        await supabase.storage.from('payment-proofs').remove([path]);
        throw result.error;
      }
      setAmount(''); setDays('1'); setNote(''); setProof(null);
      e.target.reset(); setMessage('Pengajuan terkirim. Status menunggu pemeriksaan admin.');
      await loadData(session.user);
    } catch (e1) { setError(e1.message || 'Pengajuan gagal dikirim.'); }
    finally { setBusy(false); }
  }
  async function reviewPayment(payment, status) {
    setBusy(true); setError(''); setMessage('');
    const { error: e1 } = await supabase.from('payment_submissions').update({
      status, reviewed_by: session.user.id, reviewed_at: new Date().toISOString(),
      review_note: reviewNotes[payment.id]?.trim() || null
    }).eq('id', payment.id).eq('status', 'pending');
    if (e1) setError(e1.message);
    else setMessage(status === 'approved' ? 'Pembayaran disetujui.' : 'Pembayaran ditolak.');
    await loadData(session.user); setBusy(false);
  }
  async function createMember(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const { data, error: e1 } = await supabase.functions.invoke('create-member', { body: newMember });
      if (e1) throw new Error(data?.error || e1.message);
      setMessage('Akun member berhasil dibuat: ' + (data?.ic_name || newMember.ic_name));
      setNewMember({ email: '', password: '', ic_name: '', display_name: '' });
      await loadData(session.user);
    } catch (e1) { setError(e1.message || 'Gagal membuat akun. Pastikan akun ini memiliki role admin.'); }
    finally { setBusy(false); }
  }
  async function saveSettings(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    const value = Number(dailyAmount);
    if (!Number.isInteger(value) || value < 0) { setError('Tarif harus berupa angka bulat minimal 0.'); setBusy(false); return; }
    const { error: e1 } = await supabase.from('dues_settings').update({ daily_amount: value, updated_by: session.user.id, updated_at: new Date().toISOString() }).eq('id', 1);
    if (e1) setError(e1.message); else { setMessage('Tarif kas harian diperbarui.'); await loadData(session.user); }
    setBusy(false);
  }
  async function toggleMember(member) {
    const next = member.member_status === 'active' ? 'inactive' : 'active';
    const { error: e1 } = await supabase.from('member_profiles').update({ member_status: next, updated_at: new Date().toISOString() }).eq('user_id', member.user_id);
    if (e1) setError(e1.message); else { setMessage('Status member diubah menjadi ' + next + '.'); await loadData(session.user); }
  }
  async function viewProof(payment) {
    const { data, error: e1 } = await supabase.storage.from('payment-proofs').createSignedUrl(payment.screenshot_path, 60);
    if (e1) { setError(e1.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  const visiblePayments = useMemo(() => payments.filter(p => isAdmin || p.member_id === session?.user?.id), [payments, isAdmin, session?.user?.id]);
  const pendingCount = payments.filter(p => p.status === 'pending').length;
  const ownWallet = wallets.find(w => w.user_id === session?.user?.id);
  const totalBalance = wallets.reduce((n, w) => n + Number(w.balance || 0), 0);
  const totalArrears = wallets.reduce((n, w) => n + Number(w.arrears || 0), 0);
  const totalApproved = visiblePayments.filter(p => p.status === 'approved').reduce((a, p) => a + Number(p.amount), 0);
  const filteredMembers = members.filter(m => (m.ic_name + ' ' + m.display_name).toLowerCase().includes(search.toLowerCase()));

  if (!supabaseConfigured) return <div className="setup-screen"><div className="brand">WEBKAS <span>FAM SOS</span></div><section className="panel"><h1>Konfigurasi belum lengkap</h1><p>Tambahkan <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> pada environment deployment. Gunakan publishable/anon key, bukan service-role key.</p><p className="muted">Project Supabase yang disiapkan: jxdzhqbkwbnndhtnkbqr</p></section></div>;
  if (loading) return <div className="setup-screen"><div className="loader" /><p>Menyiapkan WEBKAS FAM SOS…</p></div>;
  if (!session) return <main className="auth-page"><div className="brand">WEBKAS <span>FAM SOS</span></div><p className="tagline">Satu keluarga. Satu kas. Semua tercatat.</p><form className="panel auth-panel" onSubmit={signIn}><div className="eyebrow">MEMBER ACCESS</div><h1>Masuk ke sistem</h1><p className="muted">Gunakan email dan password akun yang dibuat admin.</p><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required /></label>{error && <div className="alert error">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Memproses…' : 'MASUK'}</button><p className="footnote">Belum punya akun? Hubungi admin keluarga untuk dibuatkan akun.</p></form><footer>STREET OF STYLE FAMILY · 2026</footer></main>;

  return <div className="app-shell"><aside className="sidebar"><div className="brand small">WEBKAS <span>FAM SOS</span></div><div className="identity"><div className="avatar">{(profile?.ic_name || session.user.email || 'M').slice(0,1).toUpperCase()}</div><div><strong>{profile?.display_name || profile?.ic_name || session.user.email}</strong><small>{isAdmin ? 'ADMIN' : 'MEMBER'}</small></div></div><nav>{[['overview','◈','Ringkasan'],['payments','↗','Pengajuan Kas'],['history','≡','Riwayat'],...(isAdmin ? [['members','♙','Kelola Member'],['review','✓','Verifikasi'],['settings','⚙','Pengaturan']] : [])].map(([id,icon,label])=><button key={id} className={tab===id?'nav-active':''} onClick={()=>setTab(id)}><span>{icon}</span>{label}{id==='review'&&pendingCount>0&&<b className="count">{pendingCount}</b>}</button>)}</nav><button className="logout" onClick={signOut}>↪ Keluar</button></aside>
  <main className="main"><header className="topbar"><div><div className="eyebrow">DASHBOARD / {tab.toUpperCase()}</div><h1>{({overview:'Ringkasan Kas',payments:'Pengajuan Pembayaran',history:'Riwayat Transaksi',members:'Manajemen Member',review:'Verifikasi Pembayaran',settings:'Pengaturan Kas'})[tab]}</h1></div><button className="icon-button" onClick={()=>loadData(session.user)} title="Segarkan data">⟳</button></header>
  {error&&<div className="alert error">{error}<button onClick={()=>setError('')}>×</button></div>}{message&&<div className="alert success">{message}<button onClick={()=>setMessage('')}>×</button></div>}
  {tab==='overview'&&<><div className="welcome"><div><div className="eyebrow">STREET OF STYLE FAMILY</div><h2>Catatan kas, tanpa drama. <span>✳</span></h2><p>Semua pengajuan tercatat dan keputusan pembayaran tetap diverifikasi admin.</p></div><div className="welcome-mark">SOS<span>✳</span></div></div><div className="stats"><article className="stat"><span>{isAdmin?'Tarif kas harian':'Saldo tersedia'}</span><strong>{isAdmin?money(settings?.daily_amount,'IDR'):money(ownWallet?.balance)}</strong><small>{isAdmin?'Per hari / member':'Siap untuk pemotongan kas'}</small></article><article className="stat"><span>{isAdmin?'Saldo semua member':'Tunggakan kas'}</span><strong>{isAdmin?money(totalBalance):money(ownWallet?.arrears)}</strong><small>{isAdmin?'Total saldo yang tersedia':'Kas harian yang belum tertutup'}</small></article><article className="stat"><span>{isAdmin?'Total tunggakan':'Pengajuan pending'}</span><strong>{isAdmin?money(totalArrears):visiblePayments.filter(p=>p.status==='pending').length}</strong><small>{isAdmin?'Akumulasi semua member':'Perlu diperhatikan'}</small></article><article className="stat"><span>Status akun</span><strong className="status-text">{profile?.member_status==='active'?'Aktif':(profile?.member_status||'Belum terdaftar')}</strong><small>{isAdmin?'Akses admin':'Akses member'}</small></article></div><section className="panel"><div className="section-head"><div><div className="eyebrow">AKTIVITAS TERBARU</div><h2>Pengajuan terbaru</h2></div><button className="text-button" onClick={()=>setTab('history')}>Lihat semua ↗</button></div><PaymentTable rows={visiblePayments.slice(0,5)} onProof={viewProof} /></section></>}
  {tab==='payments'&&<section className="panel form-panel"><div className="eyebrow">PEMBAYARAN KAS</div><h2>Kirim pengajuan</h2><p className="muted">Unggah bukti transfer yang jelas. Pengajuan akan berstatus menunggu sampai admin memeriksa.</p><form onSubmit={submitPayment} className="form-grid"><label>Nominal pembayaran (Rp)<input type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)} required placeholder="Contoh: 7000" /></label><label>Jumlah hari yang dibayar<input type="number" min="1" max="365" step="1" value={days} onChange={e=>setDays(e.target.value)} required /></label><label className="span-2">Screenshot bukti transfer<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setProof(e.target.files?.[0]||null)} required /><small>JPG, PNG, atau WEBP · maksimal 5 MB</small></label><label className="span-2">Catatan (opsional)<textarea rows="3" value={note} onChange={e=>setNote(e.target.value)} placeholder="Keterangan pembayaran…" /></label><div className="span-2"><button className="primary" disabled={busy}>{busy?'Mengirim…':'KIRIM PENGAJUAN ↗'}</button></div></form></section>}
  {tab==='history'&&<section className="panel"><div className="section-head"><div><div className="eyebrow">ARSIP PEMBAYARAN</div><h2>Riwayat pengajuan</h2></div></div><PaymentTable rows={visiblePayments} onProof={viewProof} /></section>}
  {tab==='review'&&isAdmin&&<section className="panel"><div className="section-head"><div><div className="eyebrow">TINDAKAN ADMIN</div><h2>Antrean verifikasi</h2></div><span className="pill pending">{pendingCount} pending</span></div><div className="review-list">{payments.filter(p=>p.status==='pending').map(p=><article className="review-card" key={p.id}><div className="review-top"><div><strong>{members.find(m=>m.user_id===p.member_id)?.ic_name||p.member_id.slice(0,8)}</strong><small>Diajukan {date(p.created_at)} · {p.days_covered} hari</small></div><strong className="amount">{money(p.amount)}</strong></div><p className="muted">Periode {date(p.period_start)} – {date(p.period_end)}{p.member_note?' · '+p.member_note:''}</p><button className="secondary" onClick={()=>viewProof(p)}>Lihat bukti ↗</button><textarea rows="2" placeholder="Catatan admin (opsional)" value={reviewNotes[p.id]||''} onChange={e=>setReviewNotes({...reviewNotes,[p.id]:e.target.value})}/><div className="button-row"><button className="primary" disabled={busy} onClick={()=>reviewPayment(p,'approved')}>✓ Terima</button><button className="danger" disabled={busy} onClick={()=>reviewPayment(p,'rejected')}>✕ Tolak</button></div></article>)}{pendingCount===0&&<Empty text="Tidak ada pengajuan yang menunggu verifikasi."/>}</div></section>}
  {tab==='members'&&isAdmin&&<><section className="panel"><div className="eyebrow">TAMBAH MEMBER</div><h2>Buat akun member</h2><p className="muted">Akun dibuat melalui Edge Function yang memeriksa role admin di server.</p><form className="form-grid" onSubmit={createMember}><label>Nama IC<input required value={newMember.ic_name} onChange={e=>setNewMember({...newMember,ic_name:e.target.value})}/></label><label>Nama tampilan<input value={newMember.display_name} onChange={e=>setNewMember({...newMember,display_name:e.target.value})} placeholder="Opsional"/></label><label>Email login<input type="email" required value={newMember.email} onChange={e=>setNewMember({...newMember,email:e.target.value})}/></label><label>Password awal<input type="password" minLength="8" required value={newMember.password} onChange={e=>setNewMember({...newMember,password:e.target.value})}/></label><div className="span-2"><button className="primary" disabled={busy}>{busy?'Membuat akun…':'+ BUAT AKUN MEMBER'}</button></div></form></section><section className="panel"><div className="section-head"><div><div className="eyebrow">DAFTAR AKUN</div><h2>Member keluarga <span className="muted">({members.length})</span></h2></div><input className="search" placeholder="Cari nama IC…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>Nama IC</th><th>Nama tampilan</th><th>Saldo</th><th>Tunggakan</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>{filteredMembers.map(m=><tr key={m.user_id}><td><strong>{m.ic_name}</strong></td><td>{m.display_name}</td><td>{money(wallets.find(w=>w.user_id===m.user_id)?.balance)}</td><td>{money(wallets.find(w=>w.user_id===m.user_id)?.arrears)}</td><td><span className={'pill '+m.member_status}>{m.member_status}</span></td><td>{date(m.created_at)}</td><td><button className="secondary compact" disabled={m.user_id===session.user.id} onClick={()=>toggleMember(m)}>{m.member_status==='active'?'Nonaktifkan':'Aktifkan'}</button></td></tr>)}</tbody></table></div></section></>}
  {tab==='settings'&&isAdmin&&<section className="panel form-panel"><div className="eyebrow">KONFIGURASI KAS</div><h2>Tarif kas harian</h2><p className="muted">Perubahan tarif berlaku untuk pengajuan selanjutnya. Riwayat transaksi yang sudah dicatat tidak diubah.</p><form onSubmit={saveSettings} className="form-grid"><label className="span-2">Nominal kas per hari (Rp)<input type="number" min="0" step="1" value={dailyAmount} onChange={e=>setDailyAmount(e.target.value)} required/></label><div className="span-2"><button className="primary" disabled={busy}>{busy?'Menyimpan…':'SIMPAN TARIF'}</button></div></form><div className="notice"><strong>Catatan keamanan</strong><p>Role admin dibaca dari <code>app_metadata.role</code> pada sesi autentikasi. Jika menu admin tidak muncul, role harus diberikan melalui proses server tepercaya, bukan dari browser.</p></div></section>}
  <footer className="app-footer">WEBKAS FAM SOS <span>·</span> CATATAN KAS KELUARGA</footer></main></div>;
}

function Empty({text}) { return <div className="empty">{text}</div>; }
function PaymentTable({rows, onProof}) {
  if (!rows.length) return <Empty text="Belum ada pengajuan pembayaran." />;
  return <div className="table-wrap"><table><thead><tr><th>Tanggal</th><th>Nominal</th><th>Periode</th><th>Status</th><th>Bukti</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{date(p.created_at)}</td><td><strong>{money(p.amount)}</strong><small className="cell-sub">{p.days_covered} hari</small></td><td>{date(p.period_start)} – {date(p.period_end)}</td><td><span className={'pill '+p.status}>{p.status==='approved'?'diterima':p.status==='rejected'?'ditolak':'pending'}</span></td><td><button className="text-button" onClick={()=>onProof(p)}>Lihat ↗</button></td></tr>)}</tbody></table></div>;
}
