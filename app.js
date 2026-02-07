/* Customer Evaluation – CRM Score v2 (Frontend Only)
   - Mobile-first RTL UI
   - Smart search + suggestions
   - Customer notes
   - Reports: Payment% and Returns% (vs Sales) + Stars
   - Excel import/export (all data + customers-only)
   - Professional PDF printing for reports + statements
   - Optional Firestore Sync
*/
(() => {
  'use strict';

  const APP_VERSION = 'v2.0';
  const LS = {
    USERS: 'crm_users_v2',
    SESSION: 'crm_session_v2',
    COMPANY: 'crm_company_v2',
    FIREBASE: 'crm_firebase_v2',
    LOCAL_DB: 'crm_local_db_v2',
  };

  // Score Weights (as in documentation)
  const W = { sales: 0.4, returns: 0.3, payments: 0.2, discounts: 0.1 };
  const COLS = ['customers', 'sales', 'returns', 'payments', 'discounts'];

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
  const uid = (p='id') => `${p}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  const isoDate = (d=new Date()) => d.toISOString().slice(0,10);
  const fmt = (n)=>Number(n||0).toLocaleString('ar-EG',{maximumFractionDigits:2});

  const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  function toast(title, msg='', type='info') {
    const host = $('#toastHost');
    const el = document.createElement('div');
    el.className = 'toast';
    const ico = document.createElement('div');
    ico.className = 't-ico';
    ico.textContent = type === 'danger' ? '!' : type === 'ok' ? '✓' : 'i';
    const body = document.createElement('div');
    body.className = 't-msg';
    body.innerHTML = `<b>${escapeHtml(title)}</b><div class="muted small">${escapeHtml(msg)}</div>`;
    const x = document.createElement('div');
    x.className = 't-x';
    x.textContent = '✕';
    x.onclick = () => el.remove();
    el.append(ico, body, x);
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // Modal
  const modal = {
    open({title, bodyHtml, footerButtons=[]}) {
      $('#modalTitle').textContent = title || '';
      $('#modalBody').innerHTML = bodyHtml || '';
      const f = $('#modalFooter');
      f.innerHTML = '';
      footerButtons.forEach(b => f.appendChild(b));
      $('#modalHost').classList.remove('hidden');
      $('#modalHost').setAttribute('aria-hidden','false');
    },
    close() {
      $('#modalHost').classList.add('hidden');
      $('#modalHost').setAttribute('aria-hidden','true');
    }
  };
  $('#modalClose').addEventListener('click', () => modal.close());
  $('#modalBackdrop').addEventListener('click', () => modal.close());

  // Local data store
  function loadDB() {
    const raw = localStorage.getItem(LS.LOCAL_DB);
    if (!raw) return { customers:[], sales:[], returns:[], payments:[], discounts:[] };
    try {
      const d = JSON.parse(raw);
      for (const c of COLS) if (!Array.isArray(d[c])) d[c] = [];
      // migration: ensure note exists
      d.customers = (d.customers||[]).map(c=>({note:'', ...c}));
      return d;
    } catch { return { customers:[], sales:[], returns:[], payments:[], discounts:[] }; }
  }
  function saveDB(db) { localStorage.setItem(LS.LOCAL_DB, JSON.stringify(db)); }

  // Users
  function seedUsers() {
    if (localStorage.getItem(LS.USERS)) return;
    localStorage.setItem(LS.USERS, JSON.stringify([
      { id: uid('u'), username:'admin', password:'admin123', role:'Admin', name:'المدير', createdAt: Date.now() }
    ]));
  }
  const getUsers = () => { try { return JSON.parse(localStorage.getItem(LS.USERS)||'[]'); } catch { return []; } };
  const setUsers = (u) => localStorage.setItem(LS.USERS, JSON.stringify(u));

  const getSession = () => { try { return JSON.parse(localStorage.getItem(LS.SESSION)||'null'); } catch { return null; } };
  const setSession = (s) => localStorage.setItem(LS.SESSION, JSON.stringify(s));
  const clearSession = () => localStorage.removeItem(LS.SESSION);

  const getCompany = () => { try { return JSON.parse(localStorage.getItem(LS.COMPANY)||'null'); } catch { return null; } };
  const setCompany = (c) => localStorage.setItem(LS.COMPANY, JSON.stringify(c));

  const getFirebaseConfig = () => { try { return JSON.parse(localStorage.getItem(LS.FIREBASE)||'null'); } catch { return null; } };
  const setFirebaseConfig = (c) => localStorage.setItem(LS.FIREBASE, JSON.stringify(c));

  // Firestore (optional)
  let fbApp=null, fs=null;
  function initFirebase() {
    const cfg = getFirebaseConfig();
    if (!cfg?.projectId || !window.firebase) return { ok:false, reason:'no_config' };
    try{
      if (fbApp && fs) return { ok:true, reason:'already' };
      fbApp = firebase.initializeApp(cfg);
      fs = firebase.firestore();
      return { ok:true, reason:'ok' };
    } catch(e){
      console.error(e);
      fbApp=null; fs=null;
      return { ok:false, reason:String(e?.message||e) };
    }
  }
  const fsGetAll = async (col) => {
    const snap = await fs.collection(col).get();
    return snap.docs.map(d => ({ id:d.id, ...d.data() }));
  };
  const fsUpsert = async (col, id, data) => fs.collection(col).doc(id).set(data, { merge:true });

  // Helpers for ratios
  function sum(arr){ return arr.reduce((a,x)=>a+(Number(x.amount)||0),0); }
  function inRange(dateStr, from, to){
    if(from && dateStr < from) return false;
    if(to && dateStr > to) return false;
    return true;
  }
  function calcTotals(customerId, db, range=null){
    const from = range?.from || '';
    const to = range?.to || '';
    const pick = (col)=>db[col].filter(x=>x.customerId===customerId && inRange((x.date||''), from, to));
    const sales = sum(pick('sales'));
    const returns = sum(pick('returns'));
    const payments = sum(pick('payments'));
    const discounts = sum(pick('discounts'));
    const payRatio = sales>0 ? clamp(Math.round((payments/sales)*100),0,999) : 0;
    const retRatio = sales>0 ? clamp(Math.round((returns/sales)*100),0,999) : 0;
    return { sales, returns, payments, discounts, payRatio, retRatio };
  }

  // Score engine (uses doc weights + practical normalization)
  const scoreToStars = (p)=> (p>=90?5:p>=75?4:p>=60?3:p>=40?2:1);
  const scoreToBadge = (p)=> (p>=90?{cls:'vip',label:'VIP'}:p>=75?{cls:'good',label:'جيد'}:p>=60?{cls:'mid',label:'متوسط'}:p>=40?{cls:'warn',label:'تنبيه'}:{cls:'danger',label:'خطر'});
  const starsText = (n)=>'⭐'.repeat(n);

  function calcScorePct(customerId, db, range=null){
    const t = calcTotals(customerId, db, range);
    const raw = (t.sales*W.sales) - (t.returns*W.returns) + (t.payments*W.payments) - (t.discounts*W.discounts);
    // Normalize to 0..100 in a stable way
    let pct = t.sales>0 ? (raw / t.sales) * 100 : raw/10;
    pct = clamp(Math.round(pct), 0, 100);
    return { pct, stars: scoreToStars(pct), badge: scoreToBadge(pct), totals:t };
  }

  let DB = loadDB();
  function recompute(){
    DB.customers = DB.customers.map(c=>{
      const s = calcScorePct(c.id, DB);
      return { ...c, scorePct:s.pct, stars:s.stars, payRatio:s.totals.payRatio, retRatio:s.totals.retRatio, updatedAt: Date.now() };
    });
    saveDB(DB);
  }

  // Routing / Sidebar
  const routes = ['dashboard','customers','transactions','reports','excel','pdf','company','users'];
  function showRoute(route){
    routes.forEach(r=>{
      const el = document.querySelector(`#page-${r}`);
      if (el) el.classList.toggle('hidden', r!==route);
    });
    $$('.nav-item[data-route]').forEach(b=>b.classList.toggle('active', b.dataset.route===route));
    closeSidebar();
    if(route==='reports') renderReports();
  }
  const sidebar = $('#sidebar');
  const openSidebar = ()=>{ sidebar.classList.remove('hidden'); sidebar.setAttribute('aria-hidden','false'); };
  const closeSidebar = ()=>{ sidebar.classList.add('hidden'); sidebar.setAttribute('aria-hidden','true'); };
  $('#btnMenu').addEventListener('click', openSidebar);
  $('#btnCloseMenu').addEventListener('click', closeSidebar);
  $$('.nav-item[data-route]').forEach(b=>b.addEventListener('click', ()=>showRoute(b.dataset.route)));

  // Quick company button
  $('#btnQuickCompany').addEventListener('click', ()=>showRoute('company'));

  // Permissions
  function applyPerm(u){
    const accountant = (u.role==='Admin'||u.role==='Accountant');
    $('#btnAddCustomer').disabled = !accountant;
    $('#btnAddSale').disabled = !accountant;
    $('#btnAddReturn').disabled = !accountant;
    $('#btnAddPayment').disabled = !accountant;
    $('#btnAddDiscount').disabled = !accountant;
    $('#btnExportExcel').disabled = !accountant;
    $('#fileExcel').disabled = !accountant;
    $('#btnExportCustomers').disabled = !accountant;
    $('#fileCustomers').disabled = !accountant;
    $('#btnSaveCompany').disabled = !accountant;
    $('#btnSync').disabled = !accountant;
    $('#btnWipeLocal').disabled = !(u.role==='Admin');
    const usersNav = $('.nav-item[data-route="users"]');
    if (usersNav) usersNav.disabled = !(u.role==='Admin');
  }

  // UI helpers
  function mkBtn(text, kind, onClick){
    const b=document.createElement('button');
    b.className = `btn ${kind||''}`.trim();
    b.textContent=text;
    b.onclick=onClick;
    return b;
  }

  function refreshSelects(){
    const cs = DB.customers.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar'));
    const allOpt = ['<option value="">الكل</option>'].concat(cs.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`)).join('');
    $('#txCustomer').innerHTML = allOpt;
    $('#invCustomer')?.remove(); // invoices page removed in v2, keep safe
    $('#pdfCustomer').innerHTML = cs.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    const cities = Array.from(new Set(cs.map(c=>c.city).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b),'ar'));
    $('#custCityFilter').innerHTML = ['<option value="">الكل</option>'].concat(cities.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`)).join('');
  }

  // DASHBOARD
  function renderDashboard(){
    const cs = DB.customers.slice();
    const avg = cs.length ? Math.round(cs.reduce((a,c)=>a+(c.scorePct||0),0)/cs.length) : 0;

    // Overall ratios (based on totals)
    const totalSales = sum(DB.sales);
    const totalPayments = sum(DB.payments);
    const totalReturns = sum(DB.returns);

    const payRatio = totalSales>0 ? Math.round((totalPayments/totalSales)*100) : 0;
    const retRatio = totalSales>0 ? Math.round((totalReturns/totalSales)*100) : 0;

    $('#kpiCustomers').textContent = cs.length;
    $('#kpiAvg').textContent = `${avg}%`;
    $('#kpiPayRatio').textContent = `${clamp(payRatio,0,999)}%`;
    $('#kpiRetRatio').textContent = `${clamp(retRatio,0,999)}%`;

    const top = cs.sort((a,b)=>(b.scorePct||0)-(a.scorePct||0)).slice(0,10);
    const host = $('#topCustomers'); host.innerHTML='';
    if(!top.length){ host.innerHTML = `<div class="muted small">لا توجد بيانات بعد.</div>`; return; }
    top.forEach(c=>host.appendChild(customerCard(c,true)));
  }

  function customerCard(c, compact=false){
    const badge = scoreToBadge(c.scorePct||0);
    const el=document.createElement('div');
    el.className='row';
    const noteIcon = (c.note && String(c.note).trim()) ? '📝' : '—';
    el.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(c.name)} <span class="muted small">${noteIcon}</span></div>
        <div class="row-sub">${escapeHtml(c.city||'—')} • ${c.status==='Active'?'نشط':'غير نشط'} • سداد ${clamp(c.payRatio||0,0,999)}% • مرتجعات ${clamp(c.retRatio||0,0,999)}%</div>
      </div>
      <div class="row-right">
        <div class="stars">${starsText(c.stars||scoreToStars(c.scorePct||0))}</div>
        <div class="chip">${Number(c.scorePct||0)}%</div>
        <span class="badge ${badge.cls}">${badge.label}</span>
        ${compact?'':`<button class="btn-mini" data-act="edit">تعديل</button>`}
      </div>`;
    if(!compact){
      el.querySelector('[data-act="edit"]').onclick = ()=>customerForm(c);
      el.addEventListener('click',(e)=>{
        if(e.target.closest('button')) return;
        quickStatement(c.id);
      });
    }
    return el;
  }

  // SMART SEARCH (suggestions)
  let suggestTimer=null;
  function buildSuggestions(q){
    q = (q||'').trim().toLowerCase();
    const box = $('#searchSuggest');
    if(!q){ box.classList.add('hidden'); box.innerHTML=''; return; }
    const list = DB.customers.filter(c=>{
      const hay = `${c.name||''} ${c.phone||''} ${c.city||''} ${c.note||''}`.toLowerCase();
      return hay.includes(q);
    }).slice(0,6);
    if(!list.length){ box.classList.add('hidden'); box.innerHTML=''; return; }
    box.innerHTML = list.map(c=>`<div class="s-item" data-id="${c.id}"><b>${escapeHtml(c.name)}</b> <span class="muted small">• ${escapeHtml(c.city||'—')} • ${c.scorePct||0}%</span></div>`).join('');
    box.classList.remove('hidden');
    $$('.s-item', box).forEach(it=>{
      it.addEventListener('click', ()=>{
        $('#custSearch').value = list.find(x=>x.id===it.dataset.id)?.name || $('#custSearch').value;
        box.classList.add('hidden');
        renderCustomers();
      });
    });
  }

  // CUSTOMERS
  function renderCustomers(){
    const q = ($('#custSearch').value||'').trim().toLowerCase();
    const city = $('#custCityFilter').value;
    const status = $('#custStatusFilter').value;
    const stars = $('#custStarsFilter').value;
    const sort = $('#custSort').value;

    let list = DB.customers.slice();
    if(q) list = list.filter(c => (`${c.name||''} ${c.phone||''} ${c.city||''} ${c.note||''}`).toLowerCase().includes(q));
    if(city) list = list.filter(c => (c.city||'')===city);
    if(status) list = list.filter(c => c.status===status);
    if(stars) list = list.filter(c => String(c.stars||scoreToStars(c.scorePct||0))===String(stars));

    const nameCmp = (a,b)=> (a.name||'').localeCompare(b.name||'','ar');
    switch(sort){
      case 'pay_desc': list.sort((a,b)=>(b.payRatio||0)-(a.payRatio||0)); break;
      case 'ret_asc': list.sort((a,b)=>(a.retRatio||0)-(b.retRatio||0)); break;
      case 'name_asc': list.sort(nameCmp); break;
      case 'name_desc': list.sort((a,b)=>nameCmp(b,a)); break;
      case 'created_desc': list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); break;
      default: list.sort((a,b)=>(b.scorePct||0)-(a.scorePct||0));
    }

    $('#custCount').textContent = list.length;
    const host = $('#customersList'); host.innerHTML='';
    if(!list.length){ host.innerHTML = `<div class="muted small">لا توجد نتائج.</div>`; return; }
    list.forEach(c=>host.appendChild(customerCard(c,false)));
  }

  // Transactions
  const txLabel = (t)=>({sales:'مبيعات',returns:'مرتجعات',payments:'سداد',discounts:'خصومات'})[t]||t;

  function renderTx(){
    const custId = $('#txCustomer').value;
    const type = $('#txType').value;
    const q = ($('#txSearch').value||'').trim().toLowerCase();
    const from = $('#txFrom').value;
    const to = $('#txTo').value;

    let items=[];
    for(const col of ['sales','returns','payments','discounts']){
      DB[col].forEach(x=>items.push({...x,__type:col}));
    }
    if(custId) items = items.filter(x=>x.customerId===custId);
    if(type) items = items.filter(x=>x.__type===type);
    if(q) items = items.filter(x=>(x.invoiceNo||'').toLowerCase().includes(q)||(x.note||'').toLowerCase().includes(q));
    if(from) items = items.filter(x=>(x.date||'')>=from);
    if(to) items = items.filter(x=>(x.date||'')<=to);

    items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const total = items.reduce((a,x)=>a+(Number(x.amount)||0),0);
    $('#txTotal').textContent = fmt(total);

    const host=$('#txList'); host.innerHTML='';
    if(!items.length){ host.innerHTML=`<div class="muted small">لا توجد حركات.</div>`; return; }
    items.forEach(x=>host.appendChild(txCard(x)));
  }

  function txCard(x){
    const c = DB.customers.find(c=>c.id===x.customerId);
    const el=document.createElement('div');
    el.className='row';
    const badgeCls = x.__type==='sales'?'good':x.__type==='payments'?'vip':x.__type==='returns'?'danger':'warn';
    el.innerHTML = `
      <div class="row-main">
        <div class="row-title">${txLabel(x.__type)} • ${escapeHtml(c?.name||'—')}</div>
        <div class="row-sub">${escapeHtml(x.invoiceNo||'—')} • ${escapeHtml(x.date||'—')} • ${escapeHtml(x.note||'')}</div>
      </div>
      <div class="row-right">
        <span class="badge ${badgeCls}">${fmt(x.amount||0)}</span>
        <button class="btn-mini danger" data-act="del">حذف</button>
      </div>`;
    el.querySelector('[data-act="del"]').onclick = ()=>{
      if(!confirm('حذف الحركة؟')) return;
      DB[x.__type] = DB[x.__type].filter(t=>t.id!==x.id);
      saveDB(DB); recompute(); refreshAll();
      toast('تم','تم حذف الحركة','ok');
    };
    return el;
  }

  // Reports
  function reportRange(){
    return { from: $('#repFrom').value || '', to: $('#repTo').value || '' };
  }
  function renderReports(){
    const range = reportRange();
    const sort = $('#repSort').value;

    const rows = DB.customers.map(c=>{
      const s = calcScorePct(c.id, DB, range);
      return {
        id:c.id, name:c.name, city:c.city||'—', status:c.status,
        scorePct:s.pct, stars:s.stars, badge:s.badge,
        sales:s.totals.sales, payments:s.totals.payments, returns:s.totals.returns, discounts:s.totals.discounts,
        payRatio:s.totals.payRatio, retRatio:s.totals.retRatio,
        note:c.note||''
      };
    });

    // summary totals
    const totalSales = rows.reduce((a,r)=>a+r.sales,0);
    const totalPayments = rows.reduce((a,r)=>a+r.payments,0);
    const totalReturns = rows.reduce((a,r)=>a+r.returns,0);
    const totalDiscounts = rows.reduce((a,r)=>a+r.discounts,0);
    const payRatio = totalSales>0 ? Math.round((totalPayments/totalSales)*100) : 0;
    const retRatio = totalSales>0 ? Math.round((totalReturns/totalSales)*100) : 0;

    $('#repSummary').innerHTML = `
      <div class="mini-row"><span>إجمالي المبيعات</span><b>${fmt(totalSales)}</b></div>
      <div class="mini-row"><span>إجمالي السداد</span><b>${fmt(totalPayments)} (${clamp(payRatio,0,999)}%)</b></div>
      <div class="mini-row"><span>إجمالي المرتجعات</span><b>${fmt(totalReturns)} (${clamp(retRatio,0,999)}%)</b></div>
      <div class="mini-row"><span>إجمالي الخصومات</span><b>${fmt(totalDiscounts)}</b></div>
    `;

    switch(sort){
      case 'pay_desc': rows.sort((a,b)=>b.payRatio-a.payRatio); break;
      case 'ret_asc': rows.sort((a,b)=>a.retRatio-b.retRatio); break;
      case 'sales_desc': rows.sort((a,b)=>b.sales-a.sales); break;
      default: rows.sort((a,b)=>b.scorePct-a.scorePct);
    }

    const top = rows.slice(0,20);
    const host = $('#repTop'); host.innerHTML='';
    if(!top.length){ host.innerHTML = `<div class="muted small">لا توجد بيانات.</div>`; return; }
    top.forEach(r=>{
      const el=document.createElement('div');
      el.className='row';
      el.innerHTML = `
        <div class="row-main">
          <div class="row-title">${escapeHtml(r.name)}</div>
          <div class="row-sub">مبيعات ${fmt(r.sales)} • سداد ${clamp(r.payRatio,0,999)}% • مرتجعات ${clamp(r.retRatio,0,999)}%</div>
        </div>
        <div class="row-right">
          <div class="stars">${starsText(r.stars)}</div>
          <div class="chip">${r.scorePct}%</div>
          <span class="badge ${r.badge.cls}">${r.badge.label}</span>
        </div>`;
      host.appendChild(el);
    });
  }

  // Users
  function renderUsers(){
    const host=$('#usersList'); host.innerHTML='';
    const users=getUsers();
    users.forEach(u=>{
      const el=document.createElement('div');
      el.className='row';
      el.innerHTML = `
        <div class="row-main">
          <div class="row-title">${escapeHtml(u.username)} <span class="muted small">(${escapeHtml(u.role)})</span></div>
          <div class="row-sub">${escapeHtml(u.name||'—')}</div>
        </div>
        <div class="row-right"><button class="btn-mini" data-act="edit">تعديل</button></div>`;
      el.querySelector('[data-act="edit"]').onclick = ()=>userForm(u);
      host.appendChild(el);
    });
  }

  function userForm(user=null){
    const isEdit=!!user;
    const u=user||{id:uid('u'),username:'',password:'',role:'Viewer',name:''};
    const body = `
      <div class="grid2">
        <label class="field"><span>اسم المستخدم</span><input id="u_user" value="${escapeHtml(u.username)}" ${isEdit&&u.username==='admin'?'disabled':''}/></label>
        <label class="field"><span>الاسم</span><input id="u_name" value="${escapeHtml(u.name||'')}" /></label>
        <label class="field"><span>كلمة المرور</span><input id="u_pass" type="password" value="${escapeHtml(u.password||'')}" /></label>
        <label class="field"><span>الدور</span>
          <select id="u_role" ${isEdit&&u.username==='admin'?'disabled':''}>
            <option value="Admin" ${u.role==='Admin'?'selected':''}>Admin</option>
            <option value="Accountant" ${u.role==='Accountant'?'selected':''}>Accountant</option>
            <option value="Viewer" ${u.role==='Viewer'?'selected':''}>Viewer</option>
          </select>
        </label>
      </div>`;
    const saveBtn = mkBtn('حفظ','primary',()=>{
      const username = ($('#u_user').value||'').trim();
      const name = ($('#u_name').value||'').trim();
      const password = ($('#u_pass').value||'').trim();
      const role = $('#u_role').value;
      if(!username) return toast('خطأ','اسم المستخدم مطلوب','danger');
      if(!password || password.length<4) return toast('خطأ','كلمة المرور قصيرة','danger');
      const users=getUsers();
      if(!isEdit && users.some(x=>x.username.toLowerCase()===username.toLowerCase())) return toast('خطأ','اسم المستخدم موجود','danger');
      if(isEdit){
        setUsers(users.map(x=>x.id===u.id?{...x,username,name,password,role}:x));
      }else{
        users.push({id:uid('u'),username,name,password,role,createdAt:Date.now()});
        setUsers(users);
      }
      modal.close(); toast('تم','تم حفظ المستخدم','ok'); renderUsers();
    });
    const footer=[saveBtn, mkBtn('إلغاء','soft',()=>modal.close())];
    if(isEdit && u.username!=='admin'){
      footer.unshift(mkBtn('حذف','danger',()=>{
        if(!confirm('حذف المستخدم؟')) return;
        setUsers(getUsers().filter(x=>x.id!==u.id));
        modal.close(); toast('تم','تم حذف المستخدم','ok'); renderUsers();
      }));
    }
    modal.open({title:isEdit?'تعديل مستخدم':'إضافة مستخدم', bodyHtml:body, footerButtons:footer});
  }

  // Customer form (includes Notes)
  function customerForm(customer=null){
    const isEdit=!!customer;
    const c=customer||{id:uid('c'),name:'',phone:'',city:'',status:'Active',note:'',createdAt:Date.now()};
    const body=`
      <div class="grid2">
        <label class="field"><span>اسم العميل</span><input id="c_name" value="${escapeHtml(c.name)}" /></label>
        <label class="field"><span>الهاتف</span><input id="c_phone" value="${escapeHtml(c.phone||'')}" /></label>
        <label class="field"><span>المدينة</span><input id="c_city" value="${escapeHtml(c.city||'')}" /></label>
        <label class="field"><span>الحالة</span>
          <select id="c_status">
            <option value="Active" ${c.status==='Active'?'selected':''}>نشط</option>
            <option value="Inactive" ${c.status==='Inactive'?'selected':''}>غير نشط</option>
          </select>
        </label>
      </div>
      <label class="field"><span>ملاحظات العميل</span><textarea id="c_note" placeholder="مثال: يفضّل الدفع تحويل / حساس للتأخير...">${escapeHtml(c.note||'')}</textarea></label>
    `;
    const saveBtn=mkBtn('حفظ','primary',()=>{
      const name=($('#c_name').value||'').trim();
      if(!name) return toast('خطأ','اسم العميل مطلوب','danger');
      c.name=name;
      c.phone=($('#c_phone').value||'').trim();
      c.city=($('#c_city').value||'').trim();
      c.status=$('#c_status').value;
      c.note=($('#c_note').value||'').trim();

      const exists=DB.customers.find(x=>x.id===c.id);
      if(exists) DB.customers=DB.customers.map(x=>x.id===c.id?{...x,...c,updatedAt:Date.now()}:x);
      else DB.customers.push({...c,createdAt:Date.now()});

      saveDB(DB); recompute(); refreshAll();
      modal.close(); toast('تم', isEdit?'تم تحديث العميل':'تم إضافة العميل','ok');
    });
    const footer=[saveBtn, mkBtn('إلغاء','soft',()=>modal.close())];
    if(isEdit){
      footer.unshift(mkBtn('حذف','danger',()=>{
        if(!confirm('حذف العميل سيحذف كل حركاته. متابعة؟')) return;
        const id=c.id;
        DB.customers=DB.customers.filter(x=>x.id!==id);
        for(const col of ['sales','returns','payments','discounts']) DB[col]=DB[col].filter(x=>x.customerId!==id);
        saveDB(DB); recompute(); refreshAll();
        modal.close(); toast('تم','تم حذف العميل','ok');
      }));
    }
    modal.open({title:isEdit?'تعديل عميل':'إضافة عميل', bodyHtml:body, footerButtons:footer});
  }

  // Tx form
  function txForm(type){
    if(!DB.customers.length) return toast('خطأ','أضف عميل أولاً','danger');
    const opts = DB.customers.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar')).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    const body=`
      <div class="grid2">
        <label class="field"><span>العميل</span><select id="t_cust">${opts}</select></label>
        <label class="field"><span>رقم الفاتورة</span><input id="t_inv" placeholder="مثال: INV-1001" /></label>
        <label class="field"><span>المبلغ</span><input id="t_amt" type="number" step="0.01" /></label>
        <label class="field"><span>التاريخ</span><input id="t_date" type="date" value="${isoDate()}" /></label>
      </div>
      <label class="field"><span>ملاحظة</span><input id="t_note" placeholder="اختياري" /></label>`;
    const saveBtn=mkBtn('حفظ','primary',()=>{
      const customerId=$('#t_cust').value;
      const invoiceNo=($('#t_inv').value||'—').trim()||'—';
      const amount=Number($('#t_amt').value);
      if(!amount || amount<=0) return toast('خطأ','المبلغ يجب أن يكون أكبر من صفر','danger');
      const date=$('#t_date').value||isoDate();
      const note=($('#t_note').value||'').trim();
      DB[type].push({id:uid('t'),customerId,invoiceNo,amount,date,note,createdAt:Date.now()});
      saveDB(DB); recompute(); refreshAll();
      modal.close(); toast('تم',`تمت إضافة ${txLabel(type)}`,'ok');
      showRoute('transactions');
    });
    modal.open({title:`إضافة ${txLabel(type)}`, bodyHtml:body, footerButtons:[saveBtn, mkBtn('إلغاء','soft',()=>modal.close())]});
  }

  // Quick statement (modal)
  function quickStatement(customerId){
    const c = DB.customers.find(x=>x.id===customerId);
    if(!c) return;
    const s = calcScorePct(customerId, DB);
    const rows=[];
    const add=(col,label)=>DB[col].filter(x=>x.customerId===customerId).forEach(x=>rows.push({type:label,invoiceNo:x.invoiceNo||'—',date:x.date||'—',amount:x.amount||0,note:x.note||''}));
    add('sales','مبيعات'); add('returns','مرتجعات'); add('payments','سداد'); add('discounts','خصم');
    rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));

    const body=`
      <div class="row" style="margin-bottom:10px">
        <div class="row-main">
          <div class="row-title">${escapeHtml(c.name)}</div>
          <div class="row-sub">${escapeHtml(c.phone||'—')} • ${escapeHtml(c.city||'—')} • سداد ${clamp(s.totals.payRatio,0,999)}% • مرتجعات ${clamp(s.totals.retRatio,0,999)}%</div>
        </div>
        <div class="row-right">
          <div class="stars">${starsText(s.stars)}</div>
          <div class="chip">${s.pct}%</div>
          <span class="badge ${s.badge.cls}">${s.badge.label}</span>
        </div>
      </div>
      ${c.note?`<div class="card" style="margin-bottom:10px"><div class="card-h"><h3>ملاحظات</h3><span class="pill">📝</span></div><div style="padding:12px" class="muted">${escapeHtml(c.note)}</div></div>`:''}
      <div class="mini">
        <div class="mini-row"><span>مبيعات</span><b>${fmt(s.totals.sales)}</b></div>
        <div class="mini-row"><span>سداد</span><b>${fmt(s.totals.payments)} (${clamp(s.totals.payRatio,0,999)}%)</b></div>
        <div class="mini-row"><span>مرتجعات</span><b>${fmt(s.totals.returns)} (${clamp(s.totals.retRatio,0,999)}%)</b></div>
        <div class="mini-row"><span>خصومات</span><b>${fmt(s.totals.discounts)}</b></div>
      </div>
      <div class="card" style="margin-top:10px">
        <div class="card-h"><h3>آخر الحركات</h3><span class="pill">${rows.length}</span></div>
        <div class="list">
          ${rows.slice(0,12).map(r=>`
            <div class="row">
              <div class="row-main">
                <div class="row-title">${escapeHtml(r.type)} • ${escapeHtml(r.invoiceNo)}</div>
                <div class="row-sub">${escapeHtml(r.date)} • ${escapeHtml(r.note||'')}</div>
              </div>
              <div class="row-right"><span class="badge good">${fmt(r.amount||0)}</span></div>
            </div>`).join('')}
        </div>
      </div>`;
    modal.open({title:'تفاصيل العميل', bodyHtml:body, footerButtons:[
      mkBtn('طباعة كشف PDF','primary',()=>{ modal.close(); pdfCustomerStatement(customerId); }),
      mkBtn('إغلاق','soft',()=>modal.close())
    ]});
  }

  // Excel
  function logExcel(msg, obj=null){
    const pre=$('#excelLog');
    const t=new Date().toLocaleString('ar-EG');
    pre.textContent = `[${t}] ${msg}\n` + (obj?JSON.stringify(obj,null,2):'') + `\n` + pre.textContent;
  }

  function downloadTemplate(){
    const wb=XLSX.utils.book_new();
    const sheets={
      customers:[{id:'c_...',name:'اسم العميل',phone:'010...',city:'القاهرة',status:'Active',note:'ملاحظة',createdAt:'2026-02-07'}],
      sales:[{id:'t_...',customerId:'c_...',invoiceNo:'INV-1001',amount:1000,date:'2026-02-07',note:'',createdAt:'2026-02-07'}],
      returns:[{id:'t_...',customerId:'c_...',invoiceNo:'INV-1001',amount:100,date:'2026-02-07',note:'سبب',createdAt:'2026-02-07'}],
      payments:[{id:'t_...',customerId:'c_...',invoiceNo:'INV-1001',amount:500,date:'2026-02-07',note:'نقدي',createdAt:'2026-02-07'}],
      discounts:[{id:'t_...',customerId:'c_...',invoiceNo:'INV-1001',amount:50,date:'2026-02-07',note:'خصم',createdAt:'2026-02-07'}],
    };
    Object.entries(sheets).forEach(([name,rows])=>{
      const ws=XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb,ws,name);
    });
    XLSX.writeFile(wb,'CRM_Score_Template.xlsx');
    logExcel('تم تنزيل القالب: CRM_Score_Template.xlsx');
  }

  function exportExcel(){
    try{
      const wb=XLSX.utils.book_new();
      const add=(name,rows)=>{ const ws=XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb,ws,name); };
      add('customers', DB.customers.map(c=>({
        id:c.id,name:c.name,phone:c.phone,city:c.city,status:c.status,note:c.note||'',
        createdAt:new Date(c.createdAt||Date.now()).toISOString(),
        scorePct:c.scorePct||0,stars:c.stars||0,payRatio:c.payRatio||0,retRatio:c.retRatio||0
      })));
      const txMap=(arr)=>arr.map(x=>({id:x.id,customerId:x.customerId,invoiceNo:x.invoiceNo,amount:x.amount,date:x.date,note:x.note||'',createdAt:new Date(x.createdAt||Date.now()).toISOString()}));
      add('sales', txMap(DB.sales)); add('returns', txMap(DB.returns)); add('payments', txMap(DB.payments)); add('discounts', txMap(DB.discounts));
      XLSX.writeFile(wb, `CRM_Score_Export_${isoDate()}.xlsx`);
      logExcel('تم التصدير بنجاح');
    }catch(e){
      console.error(e); toast('خطأ','تعذر التصدير','danger');
    }
  }

  function exportCustomersOnly(){
    try{
      const wb=XLSX.utils.book_new();
      const ws=XLSX.utils.json_to_sheet(DB.customers.map(c=>({id:c.id,name:c.name,phone:c.phone,city:c.city,status:c.status,note:c.note||''})));
      XLSX.utils.book_append_sheet(wb,ws,'customers');
      XLSX.writeFile(wb, `Customers_${isoDate()}.xlsx`);
      logExcel('تم تصدير العملاء فقط');
    }catch(e){
      console.error(e); toast('خطأ','تعذر التصدير','danger');
    }
  }

  function normalizeDate(v){
    if(!v) return '';
    if(v instanceof Date) return isoDate(v);
    const s=String(v).trim();
    const m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    return s;
  }

  async function importExcel(file){
    try{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array',cellDates:true});
      const read=(name)=>{
        const ws=wb.Sheets[name];
        if(!ws) return [];
        return XLSX.utils.sheet_to_json(ws,{defval:''});
      };
      const newDB={customers:[],sales:[],returns:[],payments:[],discounts:[]};
      newDB.customers = read('customers').map(r=>({
        id:String(r.id||uid('c')),
        name:String(r.name||'').trim(),
        phone:String(r.phone||'').trim(),
        city:String(r.city||'').trim(),
        status:String(r.status||'Active').trim()||'Active',
        note:String(r.note||'').trim(),
        createdAt: Date.parse(r.createdAt)||Date.now()
      })).filter(c=>c.name);

      const tx=(name)=>read(name).map(r=>({
        id:String(r.id||uid('t')),
        customerId:String(r.customerId||'').trim(),
        invoiceNo:String(r.invoiceNo||'—').trim()||'—',
        amount:Number(r.amount||0),
        date: normalizeDate(r.date)||isoDate(),
        note:String(r.note||'').trim(),
        createdAt: Date.parse(r.createdAt)||Date.now()
      })).filter(x=>x.customerId && x.amount>0);

      newDB.sales=tx('sales'); newDB.returns=tx('returns'); newDB.payments=tx('payments'); newDB.discounts=tx('discounts');

      saveDB(newDB); DB=newDB; recompute(); refreshAll();
      logExcel('تم الاستيراد بنجاح',{counts:{customers:newDB.customers.length,sales:newDB.sales.length,returns:newDB.returns.length,payments:newDB.payments.length,discounts:newDB.discounts.length}});
      toast('تم','تم الاستيراد وإعادة الحساب','ok');
    }catch(e){
      console.error(e); toast('خطأ','فشل الاستيراد — تأكد من القالب','danger');
      logExcel('فشل الاستيراد',{error:String(e?.message||e)});
    }finally{
      $('#fileExcel').value='';
    }
  }

  async function importCustomersOnly(file){
    try{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array',cellDates:true});
      const ws=wb.Sheets['customers'] || wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      const incoming = rows.map(r=>({
        id:String(r.id||uid('c')),
        name:String(r.name||'').trim(),
        phone:String(r.phone||'').trim(),
        city:String(r.city||'').trim(),
        status:String(r.status||'Active').trim()||'Active',
        note:String(r.note||'').trim(),
        createdAt: Date.now()
      })).filter(c=>c.name);

      // Merge by id if exists, else add
      const map=new Map(DB.customers.map(c=>[c.id,c]));
      incoming.forEach(c=>{
        if(map.has(c.id)) map.set(c.id, {...map.get(c.id), ...c, updatedAt:Date.now()});
        else map.set(c.id, c);
      });
      DB.customers = Array.from(map.values());
      saveDB(DB); recompute(); refreshAll();
      logExcel('تم استيراد العملاء فقط',{added:incoming.length});
      toast('تم','تم استيراد العملاء فقط','ok');
    }catch(e){
      console.error(e);
      toast('خطأ','فشل استيراد العملاء','danger');
      logExcel('فشل استيراد العملاء',{error:String(e?.message||e)});
    }finally{
      $('#fileCustomers').value='';
    }
  }

  // PDF
  function pdfHeader(doc, title){
    const co=getCompany()||{};
    const right = `${co.name||'—'}\n${[co.phone,co.city].filter(Boolean).join(' • ')}`;
    doc.setFont('helvetica','bold'); doc.setFontSize(14);
    doc.text(title, 14, 18);
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text(right, 196, 18, {align:'right'});
    doc.setDrawColor(29,78,216); doc.setLineWidth(0.6); doc.line(14,23,196,23);
  }

  function pdfTopCustomers(){
    const { jsPDF } = window.jspdf;
    const doc=new jsPDF('p','mm','a4');
    pdfHeader(doc,'أفضل العملاء');
    const list = DB.customers.slice().sort((a,b)=>(b.scorePct||0)-(a.scorePct||0)).slice(0,20);
    const body = list.map((c,i)=>[i+1,c.name,c.city||'—',`${c.scorePct||0}%`,starsText(c.stars||scoreToStars(c.scorePct||0)),`${clamp(c.payRatio||0,0,999)}%`,`${clamp(c.retRatio||0,0,999)}%`,scoreToBadge(c.scorePct||0).label]);
    doc.autoTable({
      startY:28,
      head:[['#','العميل','المدينة','Score','Stars','%السداد','%المرتجعات','التصنيف']],
      body,
      styles:{font:'helvetica',fontSize:9,cellPadding:2},
      headStyles:{fillColor:[29,78,216]},
      margin:{left:14,right:14}
    });
    doc.setFontSize(9); doc.text(`تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}`,14,285);
    doc.save(`Top_Customers_${isoDate()}.pdf`);
  }

  function pdfReports(){
    const range = reportRange();
    const { jsPDF } = window.jspdf;
    const doc=new jsPDF('p','mm','a4');

    const fromTxt = range.from ? range.from : '—';
    const toTxt = range.to ? range.to : '—';

    pdfHeader(doc,'تقرير النِسب');
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text(`الفترة: من ${fromTxt} إلى ${toTxt}`, 14, 30);

    const rows = DB.customers.map(c=>{
      const s = calcScorePct(c.id, DB, range);
      return {
        name:c.name,
        city:c.city||'—',
        sales:s.totals.sales,
        payRatio:s.totals.payRatio,
        retRatio:s.totals.retRatio,
        scorePct:s.pct,
        stars:s.stars
      };
    }).sort((a,b)=>b.scorePct-a.scorePct).slice(0,30);

    const body = rows.map((r,i)=>[
      i+1, r.name, r.city, fmt(r.sales), `${clamp(r.payRatio,0,999)}%`, `${clamp(r.retRatio,0,999)}%`, `${r.scorePct}%`, starsText(r.stars)
    ]);

    doc.autoTable({
      startY:36,
      head:[['#','العميل','المدينة','المبيعات','%السداد','%المرتجعات','Score','Stars']],
      body,
      styles:{font:'helvetica',fontSize:9,cellPadding:2},
      headStyles:{fillColor:[29,78,216]},
      margin:{left:14,right:14}
    });

    const totalSales = rows.reduce((a,r)=>a+r.sales,0);
    const avgPay = rows.length ? Math.round(rows.reduce((a,r)=>a+r.payRatio,0)/rows.length) : 0;
    const avgRet = rows.length ? Math.round(rows.reduce((a,r)=>a+r.retRatio,0)/rows.length) : 0;

    let y = doc.lastAutoTable.finalY + 8;
    doc.setFont('helvetica','bold'); doc.text('ملخص', 14, y);
    doc.setFont('helvetica','normal');
    doc.text(`إجمالي مبيعات (Top): ${fmt(totalSales)}   متوسط %السداد: ${avgPay}%   متوسط %المرتجعات: ${avgRet}%`, 14, y+6);

    doc.setFontSize(9); doc.text(`تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}`,14,285);
    doc.save(`Reports_${isoDate()}.pdf`);
  }

  function pdfCustomerStatement(customerId=null){
    const sel = customerId || $('#pdfCustomer').value;
    if(!sel) return toast('خطأ','اختر عميل أولاً','danger');
    const rangeDays = $('#pdfRange').value || '';
    const c = DB.customers.find(x=>x.id===sel);
    if(!c) return toast('خطأ','عميل غير موجود','danger');

    let rows=[];
    const add=(col,label)=>DB[col].filter(x=>x.customerId===sel).forEach(x=>rows.push({type:label,invoiceNo:x.invoiceNo||'—',date:x.date||'—',amount:Number(x.amount||0),note:x.note||''}));
    add('sales','مبيعات'); add('returns','مرتجعات'); add('payments','سداد'); add('discounts','خصم');

    if(rangeDays){
      const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-Number(rangeDays));
      const cut=isoDate(cutoff);
      rows = rows.filter(r=>(r.date||'')>=cut);
    }
    rows.sort((a,b)=>String(a.date).localeCompare(String(b.date)));

    const s=calcScorePct(sel,DB);
    const { jsPDF } = window.jspdf;
    const doc=new jsPDF('p','mm','a4');
    pdfHeader(doc,'كشف حساب عميل');

    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text(`العميل: ${c.name}`,14,32);
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text(`الهاتف: ${c.phone||'—'}    المدينة: ${c.city||'—'}    الحالة: ${c.status==='Active'?'نشط':'غير نشط'}`,14,38);

    doc.setFont('helvetica','bold');
    doc.text(`Score: ${s.pct}%    Stars: ${starsText(s.stars)}    %السداد: ${clamp(s.totals.payRatio,0,999)}%    %المرتجعات: ${clamp(s.totals.retRatio,0,999)}%`,14,44);
    doc.setFont('helvetica','normal');

    if(c.note){
      doc.setFont('helvetica','bold'); doc.text('ملاحظات:',14,52);
      doc.setFont('helvetica','normal');
      doc.text(String(c.note).slice(0,140), 14, 58);
    }

    const startY = c.note ? 66 : 50;
    const body = rows.map((r,i)=>[i+1,r.date,r.type,r.invoiceNo,fmt(r.amount),r.note||'']);
    doc.autoTable({
      startY,
      head:[['#','التاريخ','النوع','الفاتورة','المبلغ','ملاحظة']],
      body,
      styles:{font:'helvetica',fontSize:9,cellPadding:2},
      headStyles:{fillColor:[29,78,216]},
      columnStyles:{5:{cellWidth:52}},
      margin:{left:14,right:14}
    });

    const y=doc.lastAutoTable.finalY+8;
    doc.setFont('helvetica','bold'); doc.text('ملخص',14,y);
    doc.setFont('helvetica','normal');
    doc.text(`مبيعات: ${fmt(s.totals.sales)}   سداد: ${fmt(s.totals.payments)}   مرتجعات: ${fmt(s.totals.returns)}   خصومات: ${fmt(s.totals.discounts)}`,14,y+6);

    doc.setFontSize(9); doc.text(`تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}`,14,285);
    doc.save(`Statement_${c.name}_${isoDate()}.pdf`);
  }

  // Firestore sync
  async function syncFirestore(){
    const r=initFirebase();
    if(!r.ok) return toast('Firestore غير جاهز','أضف Firebase Config في "بيانات الشركة"','danger');
    try{
      toast('مزامنة','جارِ التحميل من Firestore...','info');
      const pulled={};
      for(const col of COLS) pulled[col]=await fsGetAll(col);

      const sane={customers:[],sales:[],returns:[],payments:[],discounts:[]};
      sane.customers = pulled.customers.map(c=>({
        id:c.id, name:c.name||'', phone:c.phone||'', city:c.city||'', status:c.status||'Active', note:c.note||'',
        createdAt: c.createdAt?.toMillis ? c.createdAt.toMillis() : (Number(c.createdAt)||Date.now())
      })).filter(c=>c.name);

      const txSan=(arr)=>arr.map(x=>({
        id:x.id, customerId:String(x.customerId||'').trim(),
        invoiceNo:String(x.invoiceNo||'—').trim()||'—',
        amount:Number(x.amount||0),
        date: x.date?.toDate ? isoDate(x.date.toDate()) : String(x.date||isoDate()).slice(0,10),
        note:String(x.note||''),
        createdAt: x.createdAt?.toMillis ? x.createdAt.toMillis() : (Number(x.createdAt)||Date.now())
      })).filter(x=>x.customerId && x.amount>0);

      sane.sales=txSan(pulled.sales);
      sane.returns=txSan(pulled.returns);
      sane.payments=txSan(pulled.payments);
      sane.discounts=txSan(pulled.discounts);

      saveDB(sane); DB=sane; recompute(); refreshAll();
      toast('تم','تم جلب البيانات من Firestore','ok');

      toast('مزامنة','جارِ حفظ البيانات إلى Firestore...','info');
      for(const c of DB.customers){
        await fsUpsert('customers', c.id, {name:c.name,phone:c.phone,city:c.city,status:c.status,note:c.note||'',createdAt:new Date(c.createdAt||Date.now())});
      }
      const pushTx = async (col,x)=>fsUpsert(col,x.id,{customerId:x.customerId,invoiceNo:x.invoiceNo,amount:Number(x.amount||0),date:new Date(x.date||Date.now()),note:x.note||'',createdAt:new Date(x.createdAt||Date.now())});
      for(const col of ['sales','returns','payments','discounts']) for(const x of DB[col]) await pushTx(col,x);
      toast('تم','تمت المزامنة بنجاح','ok');
    }catch(e){
      console.error(e);
      toast('خطأ','فشلت المزامنة. تحقق من Security Rules','danger');
    }
  }

  // Events
  $('#btnDownloadTemplate').addEventListener('click', downloadTemplate);
  $('#btnExportExcel').addEventListener('click', exportExcel);
  $('#fileExcel').addEventListener('change',(e)=>{ const file=e.target.files?.[0]; if(file) importExcel(file); });

  $('#btnExportCustomers').addEventListener('click', exportCustomersOnly);
  $('#fileCustomers').addEventListener('change',(e)=>{ const file=e.target.files?.[0]; if(file) importCustomersOnly(file); });

  $('#btnPdfTop').addEventListener('click', pdfTopCustomers);
  $('#btnPdfStatement').addEventListener('click', ()=>pdfCustomerStatement());
  $('#btnPrintReports').addEventListener('click', pdfReports);

  // Company/Firebase forms
  function loadCompanyForm(){
    const co=getCompany()||{};
    $('#coName').value=co.name||'';
    $('#coPhone').value=co.phone||'';
    $('#coCity').value=co.city||'';
    $('#coLogo').value=co.logo||'';
    const sub=[];
    if(co.name) sub.push(co.name);
    if(co.city) sub.push(co.city);
    $('#companySubtitle').textContent = sub.length?sub.join(' — '):'واجهة محلية سريعة';
  }
  function loadFirebaseForm(){
    const cfg=getFirebaseConfig()||{};
    $('#fb_apiKey').value=cfg.apiKey||'';
    $('#fb_authDomain').value=cfg.authDomain||'';
    $('#fb_projectId').value=cfg.projectId||'';
    $('#fb_storageBucket').value=cfg.storageBucket||'';
    $('#fb_messagingSenderId').value=cfg.messagingSenderId||'';
    $('#fb_appId').value=cfg.appId||'';
  }

  $('#btnSaveCompany').addEventListener('click',()=>{
    const c={name:($('#coName').value||'').trim(),phone:($('#coPhone').value||'').trim(),city:($('#coCity').value||'').trim(),logo:($('#coLogo').value||'').trim(),updatedAt:Date.now()};
    setCompany(c); loadCompanyForm(); toast('تم','تم حفظ بيانات الشركة','ok');
  });
  $('#btnTestFirebase').addEventListener('click',()=>{
    const cfg={apiKey:($('#fb_apiKey').value||'').trim(),authDomain:($('#fb_authDomain').value||'').trim(),projectId:($('#fb_projectId').value||'').trim(),storageBucket:($('#fb_storageBucket').value||'').trim(),messagingSenderId:($('#fb_messagingSenderId').value||'').trim(),appId:($('#fb_appId').value||'').trim()};
    setFirebaseConfig(cfg); fbApp=null; fs=null;
    const r=initFirebase();
    $('#fbStatus').textContent = r.ok ? '✅ تم الاتصال بنجاح (Firestore جاهز)' : `❌ فشل الاتصال: ${r.reason}`;
    toast('Firebase', r.ok?'تم الاتصال بنجاح':'فشل الاتصال', r.ok?'ok':'danger');
  });
  $('#btnSync').addEventListener('click', syncFirestore);

  // Actions
  $('#btnAddCustomer').addEventListener('click', ()=>customerForm());
  $('#btnAddSale').addEventListener('click', ()=>txForm('sales'));
  $('#btnAddReturn').addEventListener('click', ()=>txForm('returns'));
  $('#btnAddPayment').addEventListener('click', ()=>txForm('payments'));
  $('#btnAddDiscount').addEventListener('click', ()=>txForm('discounts'));

  $('#btnRecalcAll').addEventListener('click', ()=>{ recompute(); refreshAll(); toast('تم','تمت إعادة الحساب','ok'); });

  $('#btnWipeLocal').addEventListener('click',()=>{
    if(!confirm('مسح كل البيانات المحلية؟')) return;
    localStorage.removeItem(LS.LOCAL_DB);
    DB=loadDB(); recompute(); refreshAll();
    toast('تم','تم مسح البيانات المحلية','ok');
  });

  // Customers search
  $('#btnClearSearch').addEventListener('click', ()=>{
    $('#custSearch').value='';
    $('#searchSuggest').classList.add('hidden');
    renderCustomers();
  });
  $('#custSearch').addEventListener('input', ()=>{
    renderCustomers();
    clearTimeout(suggestTimer);
    suggestTimer=setTimeout(()=>buildSuggestions($('#custSearch').value), 120);
  });
  document.addEventListener('click',(e)=>{
    if(!e.target.closest('#searchSuggest') && !e.target.closest('#custSearch')) $('#searchSuggest').classList.add('hidden');
  });

  $('#custCityFilter').addEventListener('change', renderCustomers);
  $('#custStatusFilter').addEventListener('change', renderCustomers);
  $('#custStarsFilter').addEventListener('change', renderCustomers);
  $('#custSort').addEventListener('change', renderCustomers);

  // Tx filters
  $('#txCustomer').addEventListener('change', renderTx);
  $('#txType').addEventListener('change', renderTx);
  $('#txSearch').addEventListener('input', renderTx);
  $('#txFrom').addEventListener('change', renderTx);
  $('#txTo').addEventListener('change', renderTx);

  // Reports filters
  $('#repFrom').addEventListener('change', renderReports);
  $('#repTo').addEventListener('change', renderReports);
  $('#repSort').addEventListener('change', renderReports);

  // Auth
  const loginView=$('#loginView'), appView=$('#appView');
  const switchToLogin=()=>{ appView.classList.add('hidden'); loginView.classList.remove('hidden'); };
  const switchToApp=()=>{ loginView.classList.add('hidden'); appView.classList.remove('hidden'); };

  let currentUser=null;

  function setUserHeader(u){
    $('#whoName').textContent = u?.name || u?.username || '—';
    $('#whoRole').textContent = u?.role || '—';
    $('#avatar').textContent = (u?.username || 'A').slice(0,1).toUpperCase();
    $('#appVersion').textContent = APP_VERSION;
    loadCompanyForm();
  }

  $('#btnLogin').addEventListener('click',()=>{
    const username=($('#loginUser').value||'').trim();
    const password=($('#loginPass').value||'').trim();
    const u=getUsers().find(x=>x.username.toLowerCase()===username.toLowerCase() && x.password===password);
    if(!u) return toast('خطأ','بيانات الدخول غير صحيحة','danger');
    setSession({userId:u.id, ts:Date.now()});
    boot();
  });

  $('#btnLogout').addEventListener('click',()=>{
    clearSession(); toast('تم','تم تسجيل الخروج','ok'); switchToLogin();
  });

  function seedDemo(){
    const db0=loadDB();
    if(db0.customers.length){ toast('تم','يوجد بيانات بالفعل','ok'); return; }
    const c1={id:uid('c'),name:'شركة الأفق',phone:'01000000001',city:'القاهرة',status:'Active',note:'VIP — يدفع تحويل',createdAt:Date.now()};
    const c2={id:uid('c'),name:'مؤسسة الندى',phone:'01000000002',city:'الجيزة',status:'Active',note:'يرجى متابعة التحصيل أسبوعيًا',createdAt:Date.now()};
    const c3={id:uid('c'),name:'متجر السلام',phone:'01000000003',city:'الإسكندرية',status:'Inactive',note:'مرتجعات مرتفعة',createdAt:Date.now()};
    const tx=(customerId,invoiceNo,amount,date,note)=>({id:uid('t'),customerId,invoiceNo,amount:Number(amount),date,note,createdAt:Date.now()});
    const demo={customers:[c1,c2,c3],
      sales:[tx(c1.id,'INV-1001',12000,'2026-02-01','توريد'),tx(c2.id,'INV-1002',8000,'2026-02-02','بيع'),tx(c1.id,'INV-1003',5000,'2026-02-05','بيع'),tx(c3.id,'INV-1004',2000,'2026-02-03','بيع')],
      returns:[tx(c2.id,'INV-1002',600,'2026-02-04','مرتجع')],
      payments:[tx(c1.id,'INV-1001',7000,'2026-02-02','تحويل'),tx(c2.id,'INV-1002',5000,'2026-02-05','نقدي')],
      discounts:[tx(c1.id,'INV-1003',300,'2026-02-05','خصم'),tx(c3.id,'INV-1004',200,'2026-02-03','خصم')]
    };
    saveDB(demo); DB=demo; recompute(); refreshAll();
    toast('تم','تم إنشاء بيانات تجريبية','ok');
  }
  $('#btnResetDemo').addEventListener('click',()=>{ if(confirm('إنشاء بيانات تجريبية محلية؟')) seedDemo(); });

  function refreshAll(){
    refreshSelects();
    renderDashboard();
    renderCustomers();
    renderTx();
    renderUsers();
    // reports render when opened
  }

  function boot(){
    seedUsers();
    DB=loadDB();
    recompute();
    loadCompanyForm();
    loadFirebaseForm();

    const sess=getSession();
    if(!sess){ currentUser=null; switchToLogin(); return; }
    const u=getUsers().find(x=>x.id===sess.userId);
    if(!u){ clearSession(); switchToLogin(); return; }
    currentUser=u;
    setUserHeader(u);
    applyPerm(u);
    switchToApp();
    showRoute('dashboard');
    refreshAll();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();