
  function debounce(fn, ms){
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

/* Customer Evaluation – CRM Score v2.3.0 VIP
   Frontend Only (LocalStorage) + RTL + Mobile First
   Admin only user management */

(() => {
  "use strict";

  // ====== Storage keys ======
  const K_USERS   = "crm_users_v2";
  const K_SESSION = "crm_session_v2";
  const K_COMPANY = "crm_company_v2";
  const K_FIREBASE= "crm_firebase_v2";
  const K_DB      = "crm_local_db_v2";
  const K_LOG     = "crm_ops_log_v2";

  // ====== Roles ======
  const ROLES = {
    ADMIN: "Admin",
    ACCOUNTANT: "Accountant",
    VIEWER: "Viewer"
  };

  // ====== Defaults ======
  const DEFAULT_ADMIN = { id:"u_admin", username:"admin", password:"admin123", role:ROLES.ADMIN, name:"Admin", active:true, createdAt: Date.now() };
  const DEFAULT_COMPANY = { name:"", phone:"", city:"", logoUrl:"", viewerCode:"", updatedAt: Date.now() };
  const DEFAULT_DB = { customers:[], sales:[], returns:[], payments:[], discounts:[] };

  // ====== Helpers ======

  function seedDefaultAdmin(){
    const users = JSON.parse(localStorage.getItem(K_USERS)||"[]");
    if(!users.length){
      localStorage.setItem(K_USERS, JSON.stringify([DEFAULT_ADMIN]));
    }
  }

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const fmt = new Intl.NumberFormat("ar-EG");
  const fmtMoney = (n) => fmt.format(Number(n||0));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const todayISO = () => new Date().toISOString().slice(0,10);
  const uid = (p) => `${p}_${Math.random().toString(16).slice(2,9)}${Date.now().toString(16).slice(6)}`;
  const safeJsonParse = (s, fallback) => { try{ return JSON.parse(s); } catch { return fallback; } };

  function readLS(key, fallback){
    const v = localStorage.getItem(key);
    if(!v) return fallback;
    return safeJsonParse(v, fallback);
  }
  function writeLS(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  }
  function logOp(title, detail=""){
    const list = readLS(K_LOG, []);
    const row = { at: Date.now(), title, detail };
    list.unshift(row);
    writeLS(K_LOG, list.slice(0, 200));
    renderOpsLog();
  }

  // ====== State ======
  const state = {
    session: null,
    users: [],
    company: { ...DEFAULT_COMPANY },
    fbConfig: {},
    db: { ...DEFAULT_DB },
    report: { from:"", to:"" },
    ui: { loginTab: "staff", deferredPrompt: null }
  };

  // ====== Init (first run) ======
  function ensureBootstrap(){
    const users = readLS(K_USERS, null);
    if(!users || !Array.isArray(users) || users.length === 0){
      writeLS(K_USERS, [DEFAULT_ADMIN]);
    }
    const company = readLS(K_COMPANY, null);
    if(!company || typeof company !== "object"){
      writeLS(K_COMPANY, DEFAULT_COMPANY);
    }
    const db = readLS(K_DB, null);
    if(!db || typeof db !== "object"){
      writeLS(K_DB, DEFAULT_DB);
    }
    const fb = readLS(K_FIREBASE, null);
    if(!fb || typeof fb !== "object"){
      writeLS(K_FIREBASE, {});
    }
    const log = readLS(K_LOG, null);
    if(!Array.isArray(log)){
      writeLS(K_LOG, []);
    }
  }

  function loadAll(){
    state.users = readLS(K_USERS, [DEFAULT_ADMIN]);
    state.session = readLS(K_SESSION, null);
    state.company = readLS(K_COMPANY, { ...DEFAULT_COMPANY });
    state.db = readLS(K_DB, { ...DEFAULT_DB });
    state.fbConfig = readLS(K_FIREBASE, {});
  }

  // ====== Auth ======
  function setSession(sess){
    state.session = sess;
    if(sess) writeLS(K_SESSION, sess);
    else localStorage.removeItem(K_SESSION);
    reflectSessionUI();
  }

  function can(role){
    const s = state.session;
    if(!s) return false;
    if(s.role === ROLES.ADMIN) return true;
    if(role === ROLES.ACCOUNTANT) return s.role === ROLES.ACCOUNTANT;
    if(role === ROLES.VIEWER) return s.role === ROLES.VIEWER;
    return false;
  }

  function requireLoggedIn(){
    if(!state.session){
      showView("login");
      return false;
    }
    return true;
  }

  function isAdmin(){
    return state.session?.role === ROLES.ADMIN;
  }

  // ====== Score Engine ======
  function sumByCustomer(list, customerId, from="", to=""){
    return list
      .filter(x => x.customerId === customerId)
      .filter(x => inRange(x.date, from, to))
      .reduce((a,b) => a + Number(b.amount||0), 0);
  }

  function inRange(dateISO, fromISO, toISO){
    if(!dateISO) return true;
    if(fromISO && dateISO < fromISO) return false;
    if(toISO && dateISO > toISO) return false;
    return true;
  }

  
  function badgeForScore(score){
    const s = Number(score||0);
    if(s >= 90) return { label:"VIP", cls:"badge-vip" };
    if(s >= 75) return { label:"جيد", cls:"" };
    if(s >= 60) return { label:"متوسط", cls:"" };
    if(s >= 40) return { label:"تنبيه", cls:"badge-warn" };
    return { label:"خطر", cls:"badge-danger" };
  }

function computeStars(scorePct){
    const s = Number(scorePct||0);
    if(s >= 90) return 5;
    if(s >= 75) return 4;
    if(s >= 60) return 3;
    if(s >= 40) return 2;
    return 1;
  }

  function badgeFor(stars){
    if(stars >= 5) return { label:"VIP", cls:"vip" };
    if(stars === 4) return { label:"جيد جدًا", cls:"good" };
    if(stars === 3) return { label:"متوسط", cls:"mid" };
    if(stars === 2) return { label:"تنبيه", cls:"warn" };
    return { label:"خطر", cls:"warn" };
  }

  function recalcAll(){
    const db = state.db;
    const customers = db.customers;

    // Compute for each customer based on lifetime totals
    for(const c of customers){
      const sales = sumByCustomer(db.sales, c.id);
      const returns = sumByCustomer(db.returns, c.id);
      const payments = sumByCustomer(db.payments, c.id);

      const payRatio = sales > 0 ? (payments / sales) : 0;
      const retRatio = sales > 0 ? (returns / sales) : 0;

      // Score logic:
      // + payment ratio (max 100%)
      // - return ratio penalty
      const score = clamp((payRatio*100) - (retRatio*60), 0, 100);

      c.payRatio = Number((payRatio*100).toFixed(2)); // percent
      c.retRatio = Number((retRatio*100).toFixed(2)); // percent
      c.scorePct = Number(score.toFixed(2));
      c.stars = computeStars(c.scorePct);
      c.updatedAt = Date.now();
    }

    writeLS(K_DB, db);
    state.db = db;
    logOp("إعادة حساب التقييم", "تم تحديث Score و Stars لكل العملاء.");
    renderAll();
    toast("تمت إعادة الحساب بنجاح ✅", "ok");
  }

  // ====== Views ======
  function showView(view){
    // Body class for per-view styling (fix mobile overlays)
    document.body.className = '';
    document.body.classList.add(view + '-view');

    // Close any overlays when switching views
    try{ document.getElementById('modal').hidden = true; }catch(e){}
    try{ document.getElementById('backdrop').hidden = true; }catch(e){}
    try{ document.getElementById('sidebar').classList.remove('open'); }catch(e){}

    // Gate users view
    if(view === "users" && !isAdmin()){
      toast("لا تملك صلاحية الوصول لهذه الصفحة.", "err");
      view = "dashboard";
    }

    $$(".view").forEach(v => v.hidden = v.dataset.view !== view);

    // Tabbar visibility
    $("#tabbar").hidden = (view === "login");

    // Active state (tabbar + sidebar)
    $$(".tabbtn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));

    // Login view needs topbar actions disabled-ish
    const loggedIn = !!state.session;
    $("#btnRecalc").style.display = loggedIn ? "" : "none";
    $("#btnLogout").style.display = loggedIn ? "" : "none";

    // If not logged in, always show login
    if(!loggedIn && view !== "login"){
      return showView("login");
    }

    // Auto render when switching
    if(view !== "login"){
      renderAll();
    }

    closeMenu();
    if(view === "ratios") renderRatios();
  }

  // ====== Sidebar ======
  function openMenu(){
    $("#sidebar").classList.add("open");
    $("#sidebar").setAttribute("aria-hidden", "false");
    $("#backdrop").hidden = false;
  }
  function closeMenu(){
    $("#sidebar").classList.remove("open");
    $("#sidebar").setAttribute("aria-hidden", "true");
    $("#backdrop").hidden = true;
  }

  // ====== UI: Toast & Modal ======
  let toastTimer = null;
  function toast(msg, type="ok"){
    const t = $("#toast");
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  function openModal({ title, body, foot }){
    $("#modalTitle").textContent = title || "";
    const mb = $("#modalBody");
    const mf = $("#modalFoot");
    mb.innerHTML = "";
    mf.innerHTML = "";

    if(typeof body === "string"){
      mb.innerHTML = body;
    } else if(body instanceof HTMLElement){
      mb.appendChild(body);
    }

    if(Array.isArray(foot)){
      for(const btn of foot) mf.appendChild(btn);
    } else if(foot instanceof HTMLElement){
      mf.appendChild(foot);
    }
    $("#modal").hidden = false;
  }
  function closeModal(){ $("#modal").hidden = true; }

  function mkBtn(text, cls="btn", onClick=()=>{}){
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  // ====== Render ======
  function reflectSessionUI(){
    const s = state.session;
    const sub = $("#brandSub");
    const name = $("#sessionName");
    const role = $("#sessionRole");
    const av = $("#sessionAvatar");

    if(!s){
      sub.textContent = "VIP v2.3.0";
      name.textContent = "—";
      role.textContent = "—";
      av.textContent = "—";
      $$(".admin-only").forEach(x => x.style.display = "none");
      return;
    }

    sub.textContent = `${state.company?.name ? state.company.name + " • " : ""}${s.role}`;
    name.textContent = s.name || s.username;
    role.textContent = s.role;
    av.textContent = (s.name || s.username || "A").trim().slice(0,1).toUpperCase();

    // Admin-only items
    $$(".admin-only").forEach(x => x.style.display = (s.role === ROLES.ADMIN) ? "" : "none");
  }

  function renderAll(){
    if(!state.session) return;
    reflectSessionUI();
    renderDashboard();
    renderCustomers();
    renderTransactions();
    renderReports();
    renderCompany();
    renderUsers();
    renderStatementCustomers();
    renderCityFilter();
    renderOpsLog();
  }

  function renderDashboard(){
    const db = state.db;
    const customers = db.customers.slice().sort((a,b) => (b.scorePct||0) - (a.scorePct||0));
    const salesTotal = db.sales.reduce((a,b)=>a+Number(b.amount||0),0);
    const payTotal = db.payments.reduce((a,b)=>a+Number(b.amount||0),0);

    $("#kpiCustomers").textContent = fmtMoney(customers.length);
    $("#kpiSales").textContent = fmtMoney(salesTotal);
    $("#kpiPayments").textContent = fmtMoney(payTotal);
    const payPct = salesTotal>0 ? (payTotal/salesTotal*100) : 0;
    $("#kpiPayRatio").textContent = `${payPct.toFixed(1)}%`;

    const top = customers.slice(0, 6);
    $("#topCustomersList").innerHTML = top.map(c => customerCard(c, true)).join("") || emptyState("لا يوجد عملاء بعد.");
    hookCustomerCardActions($("#topCustomersList"));
    // VIP customer cards on dashboard
    try{
      const box = document.getElementById("dashCustomers") || document.getElementById("dashTopCustomers") || null;
      if(box){
        const top = state.db.customers.slice().sort((a,b)=>(b.scorePct||0)-(a.scorePct||0)).slice(0, 12);
        box.innerHTML = top.map(c => customerCard(c, "dash")).join("");
      }
    }catch(e){}

  }

  function renderCityFilter(){
    const cities = Array.from(new Set(state.db.customers.map(c => (c.city||"").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ar"));
    const sel = $("#custCityFilter");
    const cur = sel.value;
    sel.innerHTML = `<option value="">كل المدن</option>` + cities.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    sel.value = cur;
  }

  function renderCustomers(){
    const q = ($("#custSearch").value||"").trim().toLowerCase();
    const city = $("#custCityFilter").value;
    const status = $("#custStatusFilter").value;

    let list = state.db.customers.slice().sort((a,b) => (b.scorePct||0) - (a.scorePct||0));

    if(q){
      list = list.filter(c =>
        (c.name||"").toLowerCase().includes(q) ||
        (c.phone||"").toLowerCase().includes(q) ||
        (c.city||"").toLowerCase().includes(q) ||
        (c.note||"").toLowerCase().includes(q)
      );
    }
    if(city) list = list.filter(c => (c.city||"") === city);
    if(status) list = list.filter(c => (c.status||"") === status);

    $("#customersList").innerHTML = list.map(c => customerCard(c, false)).join("") || emptyState("لا توجد نتائج.");
    hookCustomerCardActions($("#customersList"));

    // Disable edit/delete for viewer
    if(state.session.role === ROLES.VIEWER){
      $$("#customersList [data-action='edit'], #customersList [data-action='delete']").forEach(b => b.disabled = true);
    }
  }

  function renderTransactions(){
    const q = ($("#txSearch").value||"").trim().toLowerCase();
    const from = $("#txFrom").value;
    const to = $("#txTo").value;

    const merged = []
      .concat(state.db.sales.map(x => ({...x, _type:"sale", _label:"مبيعات"})))
      .concat(state.db.returns.map(x => ({...x, _type:"return", _label:"مرتجعات"})))
      .concat(state.db.payments.map(x => ({...x, _type:"payment", _label:"سداد"})))
      .concat(state.db.discounts.map(x => ({...x, _type:"discount", _label:"خصم"})))
      .sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.createdAt||0) - (a.createdAt||0));

    let list = merged;

    if(q){
      list = list.filter(t =>
        (t.invoiceNo||"").toLowerCase().includes(q) ||
        (t.note||"").toLowerCase().includes(q)
      );
    }
    if(from || to){
      list = list.filter(t => inRange(t.date, from, to));
    }

    $("#txList").innerHTML = list.map(t => txCard(t)).join("") || emptyState("لا توجد حركات.");
    hookTxCardActions($("#txList"));

    if(state.session.role === ROLES.VIEWER){
      $$("#txList [data-action='delete']").forEach(b => b.disabled = true);
    }
  }

  
  function filterCustomersForRatios(list, q){
    const s = String(q||"").trim().toLowerCase();
    if(!s) return list;
    return list.filter(c => {
      const hay = `${c.name||""} ${c.phone||""} ${c.city||""}`.toLowerCase();
      return hay.includes(s);
    });
  }

  function renderRatios(){
    const from = $("#ratFrom")?.value || "";
    const to = $("#ratTo")?.value || "";
    const q = $("#ratSearch")?.value || "";
    const sort = $("#ratSort")?.value || "scoreDesc";

    let list = state.db.customers.slice();

    list = list.map(c => {
      const s = sumByCustomer(state.db.sales, c.id, from, to);
      const p = sumByCustomer(state.db.payments, c.id, from, to);
      const r = sumByCustomer(state.db.returns, c.id, from, to);
      const payRatio = s>0 ? (p/s*100) : 0;
      const retRatio = s>0 ? (r/s*100) : 0;
      return { ...c, _rangeSales:s, _rangePayRatio:payRatio, _rangeRetRatio:retRatio };
    });

    list = filterCustomersForRatios(list, q);

    if(sort === "paymentsDesc"){
      list.sort((a,b)=> (b._rangePayRatio - a._rangePayRatio) || ((b.scorePct||0)-(a.scorePct||0)));
    }else if(sort === "returnsAsc"){
      list.sort((a,b)=> (a._rangeRetRatio - b._rangeRetRatio) || ((b.scorePct||0)-(a.scorePct||0)));
    }else{
      list.sort((a,b)=> ((b.scorePct||0)-(a.scorePct||0)) || (b._rangePayRatio - a._rangePayRatio));
    }

    const box = $("#ratList");
    if(!box) return;
    box.innerHTML = list.map(c => {
      const tmp = { ...c, payRatio: c._rangePayRatio, retRatio: c._rangeRetRatio };
      return customerCard(tmp, "dash") + `<div class="row gap" style="margin-top:-6px;margin-bottom:8px;justify-content:flex-end"><button class="btn primary" data-action="ratio" data-id="${c.id}">تقارير النِسب للعميل</button></div>`;
    }).join("");

    hookCustomerCardActions(box);
  }


  function renderReports(){
    const from = $("#repFrom").value;
    const to = $("#repTo").value;

    const salesTotal = state.db.sales.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const retTotal = state.db.returns.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const payTotal = state.db.payments.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);

    const payPct = salesTotal>0 ? (payTotal/salesTotal*100) : 0;
    const retPct = salesTotal>0 ? (retTotal/salesTotal*100) : 0;

    $("#repSales").textContent = fmtMoney(salesTotal);
    $("#repPayments").textContent = fmtMoney(payTotal);
    $("#repPayPct").textContent = `${payPct.toFixed(1)}%`;
    $("#repRetPct").textContent = `${retPct.toFixed(1)}%`;

    // Top customers by score within range (range recalculation)
    const top = state.db.customers
      .map(c => {
        const s = sumByCustomer(state.db.sales, c.id, from, to);
        const r = sumByCustomer(state.db.returns, c.id, from, to);
        const p = sumByCustomer(state.db.payments, c.id, from, to);
        const payRatio = s>0 ? p/s : 0;
        const retRatio = s>0 ? r/s : 0;
        const score = clamp((payRatio*100) - (retRatio*60), 0, 100);
        const stars = computeStars(score);
        return { ...c, _rangeSales:s, _rangePayments:p, _rangeReturns:r, _rangeScore:Number(score.toFixed(2)), _rangeStars:stars };
      })
      .sort((a,b) => (b._rangeScore||0) - (a._rangeScore||0))
      .slice(0, 9);

    $("#repTopCustomers").innerHTML = top.map(c => reportCustomerCard(c)).join("") || emptyState("لا يوجد بيانات ضمن الفترة.");
  }

  function renderCompany(){
    $("#coName").value = state.company.name || "";
    $("#coPhone").value = state.company.phone || "";
    $("#coCity").value = state.company.city || "";
    $("#coLogoUrl").value = state.company.logoUrl || "";
    $("#viewerCodeSetting").value = state.company.viewerCode || "";
    $("#fbConfig").value = JSON.stringify(state.fbConfig || {}, null, 2);
  }

  function renderUsers(){
    if(!state.session || state.session.role !== ROLES.ADMIN){
      $("#usersList").innerHTML = emptyState("هذه الصفحة متاحة فقط للأدمن.");
      return;
    }
    const list = state.users.slice().sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    $("#usersList").innerHTML = list.map(u => userCard(u)).join("") || emptyState("لا يوجد مستخدمون.");
    hookUserActions($("#usersList"));
  }

  function renderStatementCustomers(){
    const sel = $("#stmtCustomer");
    const cur = sel.value;
    const list = state.db.customers.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"ar"));
    sel.innerHTML = `<option value="">اختر...</option>` + list.map(c => `<option value="${c.id}">${escapeHtml(c.name||"—")}</option>`).join("");
    sel.value = cur;
  }

  function renderOpsLog(){
    const el = $("#opsLog");
    if(!el) return;
    const list = readLS(K_LOG, []);
    el.innerHTML = list.length ? list.map(x => {
      const d = new Date(x.at);
      const ts = d.toLocaleString("ar-EG");
      return `<div>• <b>${escapeHtml(x.title)}</b> <span class="muted">(${escapeHtml(ts)})</span><br><span>${escapeHtml(x.detail||"")}</span></div>`;
    }).join("<hr style='border:none;border-top:1px solid var(--line);margin:8px 0'>") : `<div class="muted">لا يوجد عمليات بعد.</div>`;
  }

  // ====== Cards ======
  function starsHtml(n){
    const s = clamp(Number(n||1),1,5);
    return "⭐".repeat(s) + "☆".repeat(5-s);
  }

  function customerCard(c, mode='full'){
    const stars = "⭐".repeat(clamp(c.stars||1,1,5));
    const badge = badgeForScore(c.scorePct||0);
    const note = (c.note||"").trim() ? `<div class="muted small" style="margin-top:6px">${escapeHtml(c.note)}</div>` : "";

    // Modes:
    // full: shows totals + ratios + actions
    // data: shows only customer data (no totals)
    // dash: VIP summary for dashboard (ratios + stars)
    const showTotals = (mode === "full");
    const showDash = (mode === "dash");

    const salesT = showTotals ? sumByCustomer(state.db.sales, c.id) : 0;
    const returnsT = showTotals ? sumByCustomer(state.db.returns, c.id) : 0;
    const paymentsT = showTotals ? sumByCustomer(state.db.payments, c.id) : 0;
    const discountsT = showTotals ? sumByCustomer(state.db.discounts, c.id) : 0;
    const balanceT = showTotals ? (salesT - (returnsT + paymentsT + discountsT)) : 0;

    const kpis = (showTotals || showDash) ? `
      <div class="kpi-row">
        <span class="kpi-pill ${badge.cls}"><b>${badge.label}</b> • Score: ${Number(c.scorePct||0).toFixed(1)}%</span>
        <span class="kpi-pill"><b>سداد%</b> ${Number(c.payRatio||0).toFixed(1)}%</span>
        <span class="kpi-pill"><b>مرتجعات%</b> ${Number(c.retRatio||0).toFixed(1)}%</span>
        <span class="kpi-pill"><b>النجوم</b> <span class="stars">${stars}</span></span>
      </div>
    ` : "";

    const totals = showTotals ? `
      <div class="kpi-row">
        <span class="kpi-pill"><b>مبيعات</b> ${fmtMoney(salesT)}</span>
        <span class="kpi-pill"><b>سداد</b> ${fmtMoney(paymentsT)}</span>
        <span class="kpi-pill"><b>مرتجعات</b> ${fmtMoney(returnsT)}</span>
        <span class="kpi-pill"><b>خصم</b> ${fmtMoney(discountsT)}</span>
        <span class="kpi-pill"><b>الرصيد</b> ${fmtMoney(balanceT)}</span>
      </div>
    ` : "";

    const actions = (mode === "full") ? `
      <div class="card-actions">
        <button class="btn" data-action="stmt" data-id="${c.id}">كشف حساب</button>
        <button class="btn primary" data-action="ratio" data-id="${c.id}">تقارير النِسب</button>
        <button class="btn" data-action="edit" data-id="${c.id}">تعديل</button>
        <button class="btn warn" data-action="delete" data-id="${c.id}">حذف</button>
      </div>
    ` : (mode === "data" ? `
      <div class="card-actions">
        <button class="btn" data-action="edit" data-id="${c.id}">تعديل</button>
        <button class="btn warn" data-action="delete" data-id="${c.id}">حذف</button>
      </div>
    ` : "");

    const phone = c.phone ? `<span class="muted small">${escapeHtml(c.phone)}</span>` : "";
    const city = c.city ? `<span class="muted small">• ${escapeHtml(c.city)}</span>` : "";
    const status = `<span class="muted small">• ${c.status==="Inactive"?"غير نشط":"نشط"}</span>`;

    return `
      <div class="card vip">
        <div class="card-title">${escapeHtml(c.name||"—")}</div>
        <div class="muted small">${phone} ${city} ${status}</div>
        ${kpis}
        ${totals}
        ${note}
        ${actions}
      </div>
    `;
  }

  function reportCustomerCard(c){
    const b = badgeFor(c._rangeStars||1);
    return `
      <div class="card">
        <div class="row between">
          <div style="min-width:0">
            <div class="card-title" style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name||"—")}</div>
            <div class="muted small">Score: ${Number(c._rangeScore||0).toFixed(1)}%</div>
          </div>
          <span class="badge ${b.cls}">${b.label}</span>
        </div>
        <div class="meta">
          <span class="chip">مبيعات: ${fmtMoney(c._rangeSales||0)}</span>
          <span class="chip">سداد: ${fmtMoney(c._rangePayments||0)}</span>
          <span class="chip">مرتجعات: ${fmtMoney(c._rangeReturns||0)}</span>
        </div>
      </div>
    `;
  }

  function txCard(t){
    const c = state.db.customers.find(x => x.id === t.customerId);
    const custName = c?.name || "—";
    const typeBadge = {
      sale: { label:"مبيعات", cls:"vip" },
      return: { label:"مرتجعات", cls:"warn" },
      payment: { label:"سداد", cls:"good" },
      discount: { label:"خصم", cls:"mid" }
    }[t._type] || { label:"حركة", cls:"mid" };

    const inv = t.invoiceNo ? `<span class="chip">🧾 ${escapeHtml(t.invoiceNo)}</span>` : "";
    const note = t.note ? `<div class="muted small">${escapeHtml(t.note)}</div>` : "";

    return `
      <div class="card">
        <div class="row between">
          <div style="min-width:0">
            <div class="card-title" style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(custName)}</div>
            <div class="muted small">${escapeHtml(t.date||"")}</div>
          </div>
          <span class="badge ${typeBadge.cls}">${typeBadge.label}</span>
        </div>
        <div class="meta">
          ${inv}
          <span class="chip">💰 ${fmtMoney(t.amount||0)}</span>
        </div>
        ${note}
        <div class="card-actions">
          <button class="btn warn" data-action="delete" data-type="${t._type}" data-id="${t.id}">حذف</button>
        </div>
      </div>
    `;
  }

  function userCard(u){
    const isRoot = (u.username === "admin");
    const roleLabel = u.role === ROLES.ADMIN ? "Admin" : (u.role === ROLES.ACCOUNTANT ? "Accountant" : "Viewer");
    return `
      <div class="card">
        <div class="row between">
          <div>
            <div class="card-title" style="margin:0">${escapeHtml(u.name || u.username)}</div>
            <div class="muted small">@${escapeHtml(u.username)} • ${escapeHtml(roleLabel)}</div>
          </div>
          <span class="badge ${u.role===ROLES.ADMIN?"vip":(u.role===ROLES.ACCOUNTANT?"good":"mid")}">${escapeHtml(roleLabel)}</span>
        </div>
        <div class="meta">
          <span class="chip">${u.active !== false ? "✅ نشط" : "⛔ موقوف"}</span>
          <span class="chip">ID: ${escapeHtml(u.id||"")}</span>
        </div>
        <div class="card-actions">
          <button class="btn" data-action="resetpass" data-id="${u.id}" ${isRoot?"disabled":""}>تغيير كلمة المرور</button>
          <button class="btn" data-action="toggle" data-id="${u.id}" ${isRoot?"disabled":""}>تفعيل/إيقاف</button>
          <button class="btn warn" data-action="delete" data-id="${u.id}" ${isRoot?"disabled":""}>حذف</button>
        </div>
      </div>
    `;
  }

  function emptyState(msg){
    return `<div class="card soft"><div class="muted">${escapeHtml(msg)}</div></div>`;
  }

  function statusText(s){
    return s === "Inactive" ? "غير نشط" : "نشط";
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // ====== Actions: Customers ======
  function hookCustomerCardActions(root){
    $$( "[data-action='edit']", root).forEach(btn => btn.addEventListener("click", () => openCustomerModal(btn.dataset.id)));
    $$( "[data-action='delete']", root).forEach(btn => btn.addEventListener("click", () => deleteCustomer(btn.dataset.id)));
    $$( "[data-action='stmt']", root).forEach(btn => btn.addEventListener("click", () => {
      $("#stmtCustomer").value = btn.dataset.id;
      showView("pdf");
      $("#stmtCustomer").focus();
    
    $$( "[data-action='ratio']", root).forEach(btn => btn.addEventListener("click", () => openCustomerRatioModal(btn.dataset.id)));
}));
  }

  function openCustomerModal(customerId=null){
    if(state.session.role === ROLES.VIEWER){
      toast("وضع العرض فقط لا يسمح بالتعديل.", "err");
      return;
    }

    const isEdit = !!customerId;
    const c = isEdit ? state.db.customers.find(x => x.id === customerId) : null;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field"><label>اسم العميل</label><input id="m_c_name" type="text" placeholder="اسم العميل" value="${escapeHtml(c?.name||"")}"></div>
      <div class="field"><label>الهاتف</label><input id="m_c_phone" type="text" placeholder="0100..." value="${escapeHtml(c?.phone||"")}"></div>
      <div class="field"><label>المدينة</label><input id="m_c_city" type="text" placeholder="القاهرة" value="${escapeHtml(c?.city||"")}"></div>
      <div class="field"><label>الحالة</label>
        <select id="m_c_status" class="select">
          <option value="Active">نشط</option>
          <option value="Inactive">غير نشط</option>
        </select>
      </div>
      <div class="field"><label>ملاحظات</label><input id="m_c_note" type="text" placeholder="اختياري" value="${escapeHtml(c?.note||"")}"></div>
    `;
    const sel = wrap.querySelector("#m_c_status");
    sel.value = c?.status || "Active";

    const btnSave = mkBtn("حفظ", "btn primary", () => {
      const name = $("#m_c_name", wrap).value.trim();
      if(!name){ toast("اسم العميل مطلوب.", "err"); return; }
      const phone = $("#m_c_phone", wrap).value.trim();
      const city = $("#m_c_city", wrap).value.trim();
      const status = $("#m_c_status", wrap).value;
      const note = $("#m_c_note", wrap).value.trim();

      if(isEdit){
        c.name = name; c.phone = phone; c.city = city; c.status = status; c.note = note; c.updatedAt = Date.now();
        logOp("تعديل عميل", name);
      } else {
        const nc = {
          id: uid("c"),
          name, phone, city,
          status,
          note,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          scorePct: 0, stars: 1, payRatio: 0, retRatio: 0
        };
        state.db.customers.push(nc);
        logOp("إضافة عميل", name);
      }
      writeLS(K_DB, state.db);
      closeModal();
      recalcAll(); // keep score fresh
    });

    const btnCancel = mkBtn("إلغاء", "btn", () => closeModal());

    openModal({
      title: isEdit ? "تعديل عميل" : "إضافة عميل",
      body: wrap,
      foot: [btnSave, btnCancel]
    });
  }

  function deleteCustomer(customerId){
    if(state.session.role === ROLES.VIEWER){
      toast("وضع العرض فقط لا يسمح بالحذف.", "err");
      return;
    }
    const c = state.db.customers.find(x => x.id === customerId);
    if(!c) return;

    openModal({
      title: "تأكيد الحذف",
      body: `<div>هل تريد حذف العميل <b>${escapeHtml(c.name)}</b>؟<br><span class="muted small">* سيتم حذف كل الحركات الخاصة به أيضًا.</span></div>`,
      foot: [
        mkBtn("حذف", "btn warn", () => {
          state.db.customers = state.db.customers.filter(x => x.id !== customerId);
          for(const k of ["sales","returns","payments","discounts"]){
            state.db[k] = state.db[k].filter(x => x.customerId !== customerId);
          }
          writeLS(K_DB, state.db);
          logOp("حذف عميل", c.name);
          closeModal();
          recalcAll();
        }),
        mkBtn("إلغاء", "btn", () => closeModal())
      ]
    });
  }

  // ====== Actions: Transactions ======
  function hookTxCardActions(root){
    $$( "[data-action='delete']", root).forEach(btn => btn.addEventListener("click", () => deleteTx(btn.dataset.type, btn.dataset.id)));
  }

  function openTxModal(type){
    if(state.session.role === ROLES.VIEWER){
      toast("وضع العرض فقط لا يسمح بالإضافة.", "err");
      return;
    }

    const map = {
      sale: { title:"إضافة مبيعات", bucket:"sales", label:"مبيعات" },
      return: { title:"إضافة مرتجعات", bucket:"returns", label:"مرتجعات" },
      payment: { title:"إضافة سداد", bucket:"payments", label:"سداد" },
      discount: { title:"إضافة خصم", bucket:"discounts", label:"خصم" }
    }[type];

    if(!map) return;

    const customers = state.db.customers.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"ar"));
    if(customers.length === 0){
      toast("أضف عميل أولاً.", "warn");
      showView("customers");
      return;
    }

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field">
        <label>العميل</label>
        <select id="m_t_customer" class="select">
          ${customers.map(c => `<option value="${c.id}">${escapeHtml(c.name||"—")}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>المبلغ</label>
        <input id="m_t_amount" type="number" min="0" step="0.01" placeholder="0" />
      </div>
      <div class="field">
        <label>التاريخ</label>
        <input id="m_t_date" type="date" value="${todayISO()}" />
      </div>
      <div class="field">
        <label>رقم الفاتورة</label>
        <input id="m_t_inv" type="text" placeholder="INV-1001" />
      </div>
      <div class="field">
        <label>ملاحظة</label>
        <input id="m_t_note" type="text" placeholder="اختياري" />
      </div>
    `;

    const btnSave = mkBtn("حفظ", "btn primary", () => {
      const customerId = $("#m_t_customer", wrap).value;
      const amount = Number($("#m_t_amount", wrap).value || 0);
      const date = $("#m_t_date", wrap).value || todayISO();
      const invoiceNo = $("#m_t_inv", wrap).value.trim();
      const note = $("#m_t_note", wrap).value.trim();

      if(!customerId){ toast("اختر عميل.", "err"); return; }
      if(!(amount > 0)){ toast("المبلغ يجب أن يكون أكبر من 0.", "err"); return; }

      const tx = { id: uid("t"), customerId, invoiceNo, amount, date, note, createdAt: Date.now() };
      state.db[map.bucket].push(tx);
      writeLS(K_DB, state.db);
      logOp(`إضافة ${map.label}`, `${invoiceNo||"—"} • ${amount}`);

      closeModal();
      recalcAll();
      showView("transactions");
    });

    openModal({
      title: map.title,
      body: wrap,
      foot: [btnSave, mkBtn("إلغاء","btn",closeModal)]
    });
  }

  function deleteTx(type, id){
    if(state.session.role === ROLES.VIEWER){
      toast("وضع العرض فقط لا يسمح بالحذف.", "err");
      return;
    }

    const map = {
      sale: { bucket:"sales", label:"مبيعات" },
      return: { bucket:"returns", label:"مرتجعات" },
      payment: { bucket:"payments", label:"سداد" },
      discount: { bucket:"discounts", label:"خصم" }
    }[type];
    if(!map) return;

    const list = state.db[map.bucket];
    const tx = list.find(x => x.id === id);
    if(!tx) return;

    openModal({
      title: "تأكيد الحذف",
      body: `<div>هل تريد حذف <b>${escapeHtml(map.label)}</b> بقيمة <b>${fmtMoney(tx.amount)}</b>؟</div>`,
      foot: [
        mkBtn("حذف", "btn warn", () => {
          state.db[map.bucket] = list.filter(x => x.id !== id);
          writeLS(K_DB, state.db);
          logOp(`حذف ${map.label}`, tx.invoiceNo||tx.id);
          closeModal();
          recalcAll();
        }),
        mkBtn("إلغاء", "btn", () => closeModal())
      ]
    });
  }

  
  // ====== Printing (Arabic-safe) ======
  function openPrintWindow({ title, subtitle, htmlBody }){
    const w = window.open("", "_blank");
    if(!w){ toast("السماح بالنوافذ المنبثقة مطلوب للطباعة.", "err"); return; }

    const css = `
      :root{ --bg:#ffffff; --text:#0b1220; --muted:#334155; --line:#e5e7eb; }
      *{ box-sizing:border-box; }
      body{ margin:0; font-family: Tahoma, Arial, sans-serif; direction: rtl; color: var(--text); background: var(--bg); }
      .page{ padding: 24px 28px; }
      .head{ display:flex; justify-content:space-between; gap:12px; align-items:flex-start; border-bottom:1px solid var(--line); padding-bottom:12px; }
      .title{ font-size:18px; font-weight:900; }
      .sub{ margin-top:6px; color: var(--muted); font-size: 12px; line-height:1.6; }
      .brand{ text-align:left; color: var(--muted); font-size:12px; }
      table{ width:100%; border-collapse: collapse; margin-top: 14px; }
      th, td{ border:1px solid var(--line); padding:8px 8px; font-size: 12px; vertical-align: top; }
      th{ background:#f8fafc; font-weight:900; }
      .grid{ display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
      .kpi{ border:1px solid var(--line); border-radius: 10px; padding: 10px; background:#fff; }
      .kpi .k{ color: var(--muted); font-size: 11px; }
      .kpi .v{ margin-top: 6px; font-weight: 900; }
      .footer{ margin-top: 16px; color: var(--muted); font-size: 11px; }
      @media print{
        .no-print{ display:none !important; }
        .page{ padding: 18px 18px; }
      }
    `;

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>${escapeHtml(title||"طباعة")}</title>
        <style>${css}</style>
      </head>
      <body>
        <div class="page">
          <div class="head">
            <div>
              <div class="title">${escapeHtml(title||"")}</div>
              <div class="sub">${escapeHtml(subtitle||"")}</div>
            </div>
            <div class="brand">
              CRM Score • VIP v2.3.0<br/>
              ${escapeHtml(todayISO())}
            </div>
          </div>
          ${htmlBody||""}
          <div class="footer">تم إنشاء التقرير من النظام (Frontend Only).</div>
          <div class="no-print" style="margin-top:10px; display:flex; gap:8px;">
            <button onclick="window.print()" style="padding:10px 14px;font-weight:900;border-radius:10px;border:1px solid #e5e7eb;background:#0b1220;color:#fff;cursor:pointer">طباعة</button>
            <button onclick="window.close()" style="padding:10px 14px;font-weight:900;border-radius:10px;border:1px solid #e5e7eb;background:#fff;color:#0b1220;cursor:pointer">إغلاق</button>
          </div>
        </div>
      </body>
      </html>
    `);
    w.document.close();
    w.focus();
  }

  function toTable({ head, rows }){
    const th = `<tr>${head.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
    const tr = rows.map(r => `<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
    return `<table>${th}${tr}</table>`;
  }

// ====== Reports PDF (period) ======
  async function pdfReportPeriod(){
    const from = $("#repFrom").value;
    const to = $("#repTo").value;

    const company = state.company || {};
    const title = company.name ? `تقرير الفترة - ${company.name}` : "تقرير الفترة";
    const subtitle = `من: ${from||"—"}  إلى: ${to||"—"}`;

    const salesTotal = state.db.sales.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const retTotal   = state.db.returns.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const payTotal   = state.db.payments.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const discTotal  = state.db.discounts.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);

    const payPct = salesTotal>0 ? (payTotal/salesTotal*100) : 0;
    const retPct = salesTotal>0 ? (retTotal/salesTotal*100) : 0;
    const discPct= salesTotal>0 ? (discTotal/salesTotal*100) : 0;

    const kpis = `
      <div class="grid">
        <div class="kpi"><div class="k">مبيعات الفترة</div><div class="v">${fmtMoney(salesTotal)}</div></div>
        <div class="kpi"><div class="k">سداد الفترة</div><div class="v">${fmtMoney(payTotal)} (${payPct.toFixed(1)}%)</div></div>
        <div class="kpi"><div class="k">مرتجعات الفترة</div><div class="v">${fmtMoney(retTotal)} (${retPct.toFixed(1)}%)</div></div>
        <div class="kpi"><div class="k">خصومات الفترة</div><div class="v">${fmtMoney(discTotal)} (${discPct.toFixed(1)}%)</div></div>
      </div>
    `;

    const top = state.db.customers
      .map(c => {
        const s = sumByCustomer(state.db.sales, c.id, from, to);
        const r = sumByCustomer(state.db.returns, c.id, from, to);
        const p = sumByCustomer(state.db.payments, c.id, from, to);
        const d = sumByCustomer(state.db.discounts, c.id, from, to);
        const payRatio = s>0 ? p/s : 0;
        const retRatio = s>0 ? r/s : 0;
        const discRatio= s>0 ? d/s : 0;
        const score = clamp((payRatio*100) - (retRatio*60) - (discRatio*30), 0, 100);
        const stars = computeStars(score);
        return { name:c.name||"—", city:c.city||"", sales:s, payments:p, returns:r, discounts:d, score:Number(score.toFixed(1)), stars };
      })
      .sort((a,b)=>b.score-a.score)
      .slice(0, 25);

    const table = toTable({
      head: ["#", "العميل", "المدينة", "مبيعات", "سداد", "مرتجعات", "خصومات", "الناتج Score", "النجوم"],
      rows: top.map((x,i)=>[
        String(i+1),
        x.name,
        x.city,
        x.sales.toFixed(2),
        x.payments.toFixed(2),
        x.returns.toFixed(2),
        x.discounts.toFixed(2),
        x.score.toFixed(1)+"%",
        "⭐".repeat(clamp(x.stars,1,5))
      ])
    });

    openPrintWindow({ title, subtitle, htmlBody: kpis + table });
    logOp("طباعة", "تقرير الفترة (PRO)");
  }

  // ====== PDF: Top customers ======
  async function pdfTopCustomers(){
    const company = state.company || {};
    const title = company.name ? `أفضل العملاء - ${company.name}` : "أفضل العملاء";
    const subtitle = `تاريخ: ${todayISO()}`;

    const top = state.db.customers.slice()
      .sort((a,b) => (b.scorePct||0)-(a.scorePct||0))
      .slice(0, 50);

    const table = toTable({
      head: ["#", "العميل", "المدينة", "Score%", "النجوم", "سداد%", "مرتجعات%"],
      rows: top.map((c,i)=>[
        String(i+1),
        c.name||"—",
        c.city||"",
        Number(c.scorePct||0).toFixed(1)+"%",
        "⭐".repeat(clamp(c.stars||1,1,5)),
        Number(c.payRatio||0).toFixed(1)+"%",
        Number(c.retRatio||0).toFixed(1)+"%"
      ])
    });

    openPrintWindow({ title, subtitle, htmlBody: table });
    logOp("طباعة", "أفضل العملاء (PRO)");
  }

  // ====== PDF: Customer statement ======
  async function pdfCustomerStatement(){
    const customerId = $("#stmtCustomer").value;
    if(!customerId){ toast("اختر عميل.", "err"); return; }

    const from = $("#stmtFrom").value;
    const to = $("#stmtTo").value;

    const c = state.db.customers.find(x => x.id === customerId);
    if(!c){ toast("العميل غير موجود.", "err"); return; }

    const company = state.company || {};
    const title = company.name ? `كشف حساب عميل - ${company.name}` : "كشف حساب عميل";
    const subtitle = `العميل: ${c.name||"—"} | من: ${from||"—"} إلى: ${to||"—"} | التقييم: ${"⭐".repeat(clamp(c.stars||1,1,5))} | Score: ${Number(c.scorePct||0).toFixed(1)}%`;

    const merged = []
      .concat(state.db.sales.map(x => ({...x, _label:"مبيعات", _dc:"debit"})))
      .concat(state.db.returns.map(x => ({...x, _label:"مرتجعات", _dc:"credit"})))
      .concat(state.db.payments.map(x => ({...x, _label:"سداد", _dc:"credit"})))
      .concat(state.db.discounts.map(x => ({...x, _label:"خصم", _dc:"credit"})))
      .filter(x => x.customerId === customerId)
      .filter(x => inRange(x.date, from, to))
      .sort((a,b) => (a.date||"").localeCompare(b.date||"") || (a.createdAt||0)-(b.createdAt||0));

    let balance = 0;
    const rows = merged.map((t,i)=>{
      const amt = Number(t.amount||0);
      const debit = (t._dc === "debit") ? amt : 0;
      const credit = (t._dc === "credit") ? amt : 0;
      balance += (debit - credit);
      return [
        String(i+1),
        t.date||"",
        t._label,
        t.invoiceNo||"",
        debit ? debit.toFixed(2) : "",
        credit ? credit.toFixed(2) : "",
        balance.toFixed(2),
        t.note||""
      ];
    });

    const table = toTable({
      head: ["#", "التاريخ", "النوع", "الفاتورة", "مدين", "دائن", "الرصيد", "ملاحظة"],
      rows: rows.length ? rows : [["", "", "لا توجد حركات ضمن الفترة", "", "", "", "", ""]]
    });

    const s = sumByCustomer(state.db.sales, customerId, from, to);
    const r = sumByCustomer(state.db.returns, customerId, from, to);
    const p = sumByCustomer(state.db.payments, customerId, from, to);
    const d = sumByCustomer(state.db.discounts, customerId, from, to);
    const net = s - (r + p + d);

    const kpis = `
      <div class="grid">
        <div class="kpi"><div class="k">إجمالي المبيعات</div><div class="v">${fmtMoney(s)}</div></div>
        <div class="kpi"><div class="k">إجمالي السداد</div><div class="v">${fmtMoney(p)}</div></div>
        <div class="kpi"><div class="k">إجمالي المرتجعات</div><div class="v">${fmtMoney(r)}</div></div>
        <div class="kpi"><div class="k">إجمالي الخصم</div><div class="v">${fmtMoney(d)}</div></div>
        <div class="kpi" style="grid-column:1/-1"><div class="k">الرصيد النهائي (مبيعات - سداد - مرتجعات - خصم)</div><div class="v">${fmtMoney(net)}</div></div>
      </div>
    `;

    openPrintWindow({ title, subtitle, htmlBody: kpis + table });
    logOp("طباعة", `كشف حساب (PRO): ${c.name||"—"}`);
  }


  
  // ====== PDF: Ratio Reports (3 separate reports) ======
  function starsText(n){ return "⭐".repeat(clamp(Number(n||1),1,5)); }

  function getRangeForPdfReports(){
    const from = (document.getElementById("pdfRepFrom")?.value) || "";
    const to = (document.getElementById("pdfRepTo")?.value) || "";
    return { from, to };
  }

  function buildCustomerRatioRows(kind, from, to){
    // kind: "returns" | "payments" | "discounts"
    const bucketMap = {
      returns: { list: state.db.returns, label: "مرتجعات" },
      payments: { list: state.db.payments, label: "سداد" },
      discounts:{ list: state.db.discounts, label: "خصومات" }
    }[kind];

    const rows = state.db.customers.map(c => {
      const sales = sumByCustomer(state.db.sales, c.id, from, to);
      const other = sumByCustomer(bucketMap.list, c.id, from, to);
      const ratio = sales > 0 ? (other / sales * 100) : 0;
      return {
        name: c.name || "—",
        city: c.city || "",
        sales,
        other,
        ratio: Number(ratio.toFixed(1)),
        stars: starsText(c.stars || 1),
        score: Number(c.scorePct || 0)
      };
    }).filter(x => x.sales > 0 || x.other > 0);

    // Sorting: for payments higher is better, for returns/discounts lower is better
    rows.sort((a,b)=>{
      if(kind === "payments") return (b.ratio - a.ratio) || (b.sales - a.sales);
      return (a.ratio - b.ratio) || (b.sales - a.sales);
    });

    return { rows, label: bucketMap.label };
  }

  async function pdfRatioReport(kind){
    const { from, to } = getRangeForPdfReports();
    const company = state.company || {};

    const info = buildCustomerRatioRows(kind, from, to);

    const titleCore =
      kind === "returns" ? "تقرير المبيعات ↔ المرتجعات" :
      kind === "payments" ? "تقرير المبيعات ↔ السداد" :
      "تقرير المبيعات ↔ الخصومات";

    const title = company.name ? `${titleCore} - ${company.name}` : titleCore;
    const subtitle = `الفترة: من ${from||"—"} إلى ${to||"—"}`;

    const table = toTable({
      head: ["#", "العميل", "المدينة", "المبيعات", info.label, "النسبة%", "النجوم", "Score%"],
      rows: info.rows.map((x,i)=>[
        String(i+1),
        x.name,
        x.city,
        Number(x.sales||0).toFixed(2),
        Number(x.other||0).toFixed(2),
        `${Number(x.ratio||0).toFixed(1)}%`,
        x.stars,
        Number(x.score||0).toFixed(1)
      ])
    });

    openPrintWindow({ title, subtitle, htmlBody: table });
    logOp("طباعة", titleCore + " (PRO)");
  }

  function sanitizeFile(s){
    return String(s).replace(/[\\\/:*?"<>|]/g, "_").slice(0, 50);
  }

  // ====== Excel (PRO Import/Export) ======
  const EXCEL = {
    sheets: {
      Customers: ["المعرف","اسم العميل","الهاتف","المدينة","الحالة","ملاحظات","تاريخ الإضافة","تاريخ التحديث","Score%","النجوم","سداد%","مرتجعات%"],
      Sales: ["المعرف","معرف العميل","اسم العميل","رقم الفاتورة","المبلغ","التاريخ","ملاحظة","تاريخ الإضافة"],
      Returns: ["المعرف","معرف العميل","اسم العميل","رقم الفاتورة","المبلغ","التاريخ","ملاحظة","تاريخ الإضافة"],
      Payments: ["المعرف","معرف العميل","اسم العميل","رقم الفاتورة","المبلغ","التاريخ","ملاحظة","تاريخ الإضافة"],
      Discounts: ["المعرف","معرف العميل","اسم العميل","رقم الفاتورة","المبلغ","التاريخ","ملاحظة","تاريخ الإضافة"]
    },
    mapCustomers: {
      id: ["id","المعرف","ID"],
      name: ["name","اسم العميل","الاسم","اسم"],
      phone: ["phone","الهاتف","تليفون","موبايل"],
      city: ["city","المدينة","مدينة"],
      status: ["status","الحالة"],
      note: ["note","ملاحظات","ملاحظة"],
      createdAt: ["createdAt","تاريخ الإضافة"],
      updatedAt: ["updatedAt","تاريخ التحديث"],
      scorePct: ["scorePct","Score%","التقييم%"],
      stars: ["stars","النجوم"],
      payRatio: ["payRatio","سداد%"],
      retRatio: ["retRatio","مرتجعات%"]
    },
    mapTx: {
      id: ["id","المعرف","ID"],
      customerId: ["customerId","معرف العميل"],
      customerName: ["customerName","اسم العميل","العميل"],
      invoiceNo: ["invoiceNo","رقم الفاتورة","الفاتورة"],
      amount: ["amount","المبلغ","قيمة","Amount"],
      date: ["date","التاريخ","Date"],
      note: ["note","ملاحظة","ملاحظات"],
      createdAt: ["createdAt","تاريخ الإضافة"]
    }
  };

  function xlsxMust(){
    if(!window.XLSX){ toast("مكتبة Excel لم تُحمّل بعد. جرّب إعادة فتح الصفحة.", "err"); return false; }
    return true;
  }

  function pick(obj, keys){
    for(const k of keys){
      if(Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== "") return obj[k];
    }
    return "";
  }

  function normalizeStatus(v){
    const s = String(v||"").trim().toLowerCase();
    if(["inactive","غير نشط","متوقف","0","false","no"].includes(s)) return "Inactive";
    return "Active";
  }

  function parseNumber(v){
    const s = String(v ?? "").replace(/[^\d\.\-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseDateISO(v){
    if(!v) return todayISO();
    if(typeof v === "string"){
      const t = v.trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
      const d = new Date(t);
      if(!isNaN(d.getTime())) return d.toISOString().slice(0,10);
      return todayISO();
    }
    if(v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0,10);
    if(typeof v === "number"){
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + v * 86400000);
      return isNaN(d.getTime()) ? todayISO() : d.toISOString().slice(0,10);
    }
    return todayISO();
  }

  function makeSheetAOA(headers, rows){
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = headers.map(h => ({ wch: Math.max(12, String(h).length + 2) }));
    return ws;
  }

  function makeWorkbookTemplate(full=true){
    if(!xlsxMust()) return null;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, makeSheetAOA(EXCEL.sheets.Customers, []), "Customers");
    if(full){
      for(const s of ["Sales","Returns","Payments","Discounts"]){
        XLSX.utils.book_append_sheet(wb, makeSheetAOA(EXCEL.sheets[s], []), s);
      }
    }
    return wb;
  }

  function downloadWorkbook(wb, filename){
    XLSX.writeFile(wb, filename);
  }

  function exportCustomersOnly(){
    if(!xlsxMust()) return;
    const wb = XLSX.utils.book_new();
    const rows = state.db.customers.map(c => ([
      c.id,
      c.name||"",
      c.phone||"",
      c.city||"",
      (c.status==="Inactive")?"غير نشط":"نشط",
      c.note||"",
      c.createdAt||"",
      c.updatedAt||"",
      Number(c.scorePct||0),
      Number(c.stars||1),
      Number(c.payRatio||0),
      Number(c.retRatio||0)
    ]));
    XLSX.utils.book_append_sheet(wb, makeSheetAOA(EXCEL.sheets.Customers, rows), "Customers");
    downloadWorkbook(wb, `CRM_Customers_${todayISO()}.xlsx`);
    logOp("تصدير Excel", "عملاء فقط (PRO)");
    toast("تم تصدير العملاء ✅", "ok");
  }

  function exportAll(){
    if(!xlsxMust()) return;
    const wb = XLSX.utils.book_new();

    const cRows = state.db.customers.map(c => ([
      c.id,
      c.name||"",
      c.phone||"",
      c.city||"",
      (c.status==="Inactive")?"غير نشط":"نشط",
      c.note||"",
      c.createdAt||"",
      c.updatedAt||"",
      Number(c.scorePct||0),
      Number(c.stars||1),
      Number(c.payRatio||0),
      Number(c.retRatio||0)
    ]));
    XLSX.utils.book_append_sheet(wb, makeSheetAOA(EXCEL.sheets.Customers, cRows), "Customers");

    const addTxSheet = (sheetName, list) => {
      const rows = list.map(t => {
        const c = state.db.customers.find(x=>x.id===t.customerId);
        return [t.id, t.customerId, c?.name||"", t.invoiceNo||"", Number(t.amount||0), t.date||"", t.note||"", t.createdAt||""];
      });
      XLSX.utils.book_append_sheet(wb, makeSheetAOA(EXCEL.sheets[sheetName], rows), sheetName);
    };

    addTxSheet("Sales", state.db.sales);
    addTxSheet("Returns", state.db.returns);
    addTxSheet("Payments", state.db.payments);
    addTxSheet("Discounts", state.db.discounts);

    downloadWorkbook(wb, `CRM_All_${todayISO()}.xlsx`);
    logOp("تصدير Excel", "البيانات كاملة (PRO)");
    toast("تم تصدير Excel ✅", "ok");
  }

  function sheetToRows(wb, sheetName){
    const ws = wb.Sheets[sheetName];
    if(!ws) return null;
    return XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
  }

  function rowsToObjects(aoa){
    if(!aoa || aoa.length < 1) return [];
    const head = aoa[0].map(h=>String(h||"").trim());
    const out = [];
    for(let i=1;i<aoa.length;i++){
      const row = aoa[i];
      if(!row || row.every(v => String(v||"").trim()==="")) continue;
      const obj = {};
      for(let j=0;j<head.length;j++){
        const k = head[j] || `col_${j}`;
        obj[k] = row[j];
      }
      out.push(obj);
    }
    return out;
  }

  function readFileAsArrayBuffer(file){
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  function resolveCustomerId(rowObj){
    let cid = String(pick(rowObj, EXCEL.mapTx.customerId) || "").trim();
    const cname = String(pick(rowObj, EXCEL.mapTx.customerName) || "").trim();

    if(cid && state.db.customers.some(c => c.id === cid)) return cid;

    if(cname){
      const found = state.db.customers.find(c => (c.name||"").trim() === cname);
      if(found) return found.id;

      const nc = { id: uid("c"), name: cname, phone:"", city:"", status:"Active", note:"", createdAt: Date.now(), updatedAt: Date.now(), scorePct:0, stars:1, payRatio:0, retRatio:0 };
      state.db.customers.push(nc);
      return nc.id;
    }
    return "";
  }

  function normalizeCustomersFromObjects(list){
    return list.map(x => {
      const id = String(pick(x, EXCEL.mapCustomers.id) || uid("c")).trim();
      const name = String(pick(x, EXCEL.mapCustomers.name) || "").trim();
      const phone = String(pick(x, EXCEL.mapCustomers.phone) || "").trim();
      const city = String(pick(x, EXCEL.mapCustomers.city) || "").trim();
      const status = normalizeStatus(pick(x, EXCEL.mapCustomers.status));
      const note = String(pick(x, EXCEL.mapCustomers.note) || "").trim();
      const createdAt = parseNumber(pick(x, EXCEL.mapCustomers.createdAt)) || Date.now();
      const updatedAt = parseNumber(pick(x, EXCEL.mapCustomers.updatedAt)) || Date.now();
      const scorePct = parseNumber(pick(x, EXCEL.mapCustomers.scorePct));
      const stars = parseNumber(pick(x, EXCEL.mapCustomers.stars)) || 1;
      const payRatio = parseNumber(pick(x, EXCEL.mapCustomers.payRatio));
      const retRatio = parseNumber(pick(x, EXCEL.mapCustomers.retRatio));
      return { id, name, phone, city, status, note, createdAt, updatedAt, scorePct, stars, payRatio, retRatio };
    }).filter(c => c.name);
  }

  function normalizeTxFromObjects(list){
    return (Array.isArray(list)?list:[]).map(x => {
      const id = String(pick(x, EXCEL.mapTx.id) || uid("t")).trim();
      const customerId = resolveCustomerId(x);
      const invoiceNo = String(pick(x, EXCEL.mapTx.invoiceNo) || "").trim();
      const amount = parseNumber(pick(x, EXCEL.mapTx.amount));
      const date = parseDateISO(pick(x, EXCEL.mapTx.date));
      const note = String(pick(x, EXCEL.mapTx.note) || "").trim();
      const createdAt = parseNumber(pick(x, EXCEL.mapTx.createdAt)) || Date.now();
      return { id, customerId, invoiceNo, amount, date, note, createdAt };
    }).filter(t => t.customerId && t.amount);
  }

  async function importAllFromFile(file){
    if(!xlsxMust()) return;

    const buf = await readFileAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type:"array" });

    const names = wb.SheetNames || [];
    const pickSheet = (cands) => cands.find(n => names.includes(n)) || null;

    const sCustomers = pickSheet(["Customers","العملاء","عملاء"]);
    const sSales     = pickSheet(["Sales","المبيعات","مبيعات"]);
    const sReturns   = pickSheet(["Returns","المرتجعات","مرتجعات"]);
    const sPayments  = pickSheet(["Payments","السداد","سداد"]);
    const sDiscounts = pickSheet(["Discounts","الخصومات","خصومات","خصم"]);

    state.db = state.db || { customers:[], sales:[], returns:[], payments:[], discounts:[] };

    const custObjs = rowsToObjects(sheetToRows(wb, sCustomers) || []);
    state.db.customers = normalizeCustomersFromObjects(custObjs);

    const salesObjs = rowsToObjects(sheetToRows(wb, sSales) || []);
    const retObjs   = rowsToObjects(sheetToRows(wb, sReturns) || []);
    const payObjs   = rowsToObjects(sheetToRows(wb, sPayments) || []);
    const discObjs  = rowsToObjects(sheetToRows(wb, sDiscounts) || []);

    state.db.sales     = normalizeTxFromObjects(salesObjs);
    state.db.returns   = normalizeTxFromObjects(retObjs);
    state.db.payments  = normalizeTxFromObjects(payObjs);
    state.db.discounts = normalizeTxFromObjects(discObjs);

    writeLS(K_DB, state.db);
    logOp("استيراد Excel", `كامل (PRO) • ${file.name}`);
    recalcAll();
  }

  async function importCustomersFromFile(file){
    if(!xlsxMust()) return;

    const buf = await readFileAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type:"array" });

    const names = wb.SheetNames || [];
    const sCustomers = (["Customers","العملاء","عملاء"].find(n => names.includes(n))) || "Customers";

    state.db.customers = normalizeCustomersFromObjects(rowsToObjects(sheetToRows(wb, sCustomers) || []));
    writeLS(K_DB, state.db);
    logOp("استيراد Excel", `عملاء فقط (PRO) • ${file.name}`);
    recalcAll();
  }


  // ====== Users (Admin only) ======
  function addUserModal(){
    if(!isAdmin()){ toast("Admin فقط.", "err"); return; }

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field"><label>الاسم</label><input id="m_u_name" type="text" placeholder="اسم المستخدم"></div>
      <div class="field"><label>Username</label><input id="m_u_username" type="text" placeholder="username"></div>
      <div class="field"><label>Password</label><input id="m_u_password" type="password" placeholder="كلمة المرور"></div>
      <div class="field"><label>Role</label>
        <select id="m_u_role" class="select">
          <option value="${ROLES.ACCOUNTANT}">Accountant</option>
          <option value="${ROLES.VIEWER}">Viewer</option>
          <option value="${ROLES.ADMIN}">Admin</option>
        </select>
      </div>
    `;

    const btnSave = mkBtn("إضافة", "btn primary", () => {
      const name = $("#m_u_name", wrap).value.trim();
      const username = $("#m_u_username", wrap).value.trim();
      const password = $("#m_u_password", wrap).value;
      const role = $("#m_u_role", wrap).value;

      if(!username || !password){ toast("اسم المستخدم وكلمة المرور مطلوبة.", "err"); return; }
      if(state.users.some(u => u.username.toLowerCase() === username.toLowerCase())){ toast("Username موجود بالفعل.", "err"); return; }

      const u = { id: uid("u"), name: name||username, username, password, role, active:true, createdAt: Date.now() };
      state.users.push(u);
      writeLS(K_USERS, state.users);
      logOp("إضافة مستخدم", `${username} • ${role}`);
      closeModal();
      renderUsers();
      toast("تمت إضافة المستخدم ✅", "ok");
    });

    openModal({
      title: "إضافة مستخدم",
      body: wrap,
      foot: [btnSave, mkBtn("إلغاء","btn",closeModal)]
    });
  }

  function hookUserActions(root){
    $$( "[data-action='delete']", root).forEach(b => b.addEventListener("click", ()=> deleteUser(b.dataset.id)));
    $$( "[data-action='toggle']", root).forEach(b => b.addEventListener("click", ()=> toggleUser(b.dataset.id)));
    $$( "[data-action='resetpass']", root).forEach(b => b.addEventListener("click", ()=> resetUserPass(b.dataset.id)));
  }

  function deleteUser(userId){
    const u = state.users.find(x => x.id === userId);
    if(!u) return;
    if(u.username === "admin"){ toast("لا يمكن حذف الحساب الرئيسي.", "err"); return; }

    openModal({
      title: "تأكيد الحذف",
      body: `<div>حذف المستخدم <b>${escapeHtml(u.username)}</b>؟</div>`,
      foot: [
        mkBtn("حذف", "btn warn", () => {
          state.users = state.users.filter(x => x.id !== userId);
          writeLS(K_USERS, state.users);
          logOp("حذف مستخدم", u.username);
          closeModal();
          renderUsers();
        }),
        mkBtn("إلغاء","btn",closeModal)
      ]
    });
  }

  function toggleUser(userId){
    const u = state.users.find(x => x.id === userId);
    if(!u) return;
    if(u.username === "admin"){ toast("لا يمكن إيقاف الحساب الرئيسي.", "err"); return; }

    u.active = !(u.active !== false); // toggle
    writeLS(K_USERS, state.users);
    logOp("تفعيل/إيقاف مستخدم", `${u.username} => ${u.active ? "Active":"Inactive"}`);
    renderUsers();
  }

  function resetUserPass(userId){
    const u = state.users.find(x => x.id === userId);
    if(!u) return;
    if(u.username === "admin"){ toast("لا يمكن تغيير كلمة مرور الحساب الرئيسي من هنا.", "err"); return; }

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field"><label>المستخدم</label><input value="${escapeHtml(u.username)}" disabled></div>
      <div class="field"><label>كلمة مرور جديدة</label><input id="m_new_pass" type="password" placeholder="••••••"></div>
    `;
    openModal({
      title: "تغيير كلمة المرور",
      body: wrap,
      foot: [
        mkBtn("حفظ", "btn primary", () => {
          const p = $("#m_new_pass", wrap).value;
          if(!p){ toast("أدخل كلمة مرور.", "err"); return; }
          u.password = p;
          writeLS(K_USERS, state.users);
          logOp("تغيير كلمة المرور", u.username);
          closeModal();
          toast("تم تغيير كلمة المرور ✅", "ok");
        }),
        mkBtn("إلغاء","btn",closeModal)
      ]
    });
  }

  // ====== Company save ======
  function saveCompany(){
    state.company.name = $("#coName").value.trim();
    state.company.phone = $("#coPhone").value.trim();
    state.company.city = $("#coCity").value.trim();
    state.company.logoUrl = $("#coLogoUrl").value.trim();
    state.company.viewerCode = $("#viewerCodeSetting").value.trim();
    state.company.updatedAt = Date.now();

    writeLS(K_COMPANY, state.company);

    // firebase config parse
    const fbText = $("#fbConfig").value.trim();
    let fb = {};
    if(fbText){
      try{ fb = JSON.parse(fbText); }
      catch{ toast("JSON غير صحيح لإعدادات Firebase.", "err"); return; }
    }
    state.fbConfig = fb;
    writeLS(K_FIREBASE, fb);

    reflectSessionUI();
    logOp("حفظ بيانات الشركة", state.company.name || "—");
    toast("تم الحفظ ✅", "ok");
  }

  function previewLogo(){
    const url = ($("#coLogoUrl").value||"").trim();
    if(!url){ toast("أدخل رابط الشعار.", "warn"); return; }
    $("#logoPreviewImg").src = url;
    $("#logoPreview").hidden = false;
  }

  // ====== Wipe local data ======
  function wipeAllLocal(){
    if(!isAdmin()){
      toast("المسح متاح للأدمن فقط.", "err");
      return;
    }
    openModal({
      title: "مسح البيانات المحلية",
      body: `<div>
        سيتم مسح <b>كل</b> البيانات داخل هذا الجهاز (عملاء/حركات/مستخدمين/شركة).<br>
        <span class="muted small">الحساب الرئيسي سيعود: admin / admin123</span>
      </div>`,
      foot: [
        mkBtn("مسح الآن", "btn warn", () => {
          localStorage.removeItem(K_SESSION);
          localStorage.setItem(K_USERS, JSON.stringify([DEFAULT_ADMIN]));
          localStorage.setItem(K_COMPANY, JSON.stringify(DEFAULT_COMPANY));
          localStorage.setItem(K_DB, JSON.stringify(DEFAULT_DB));
          localStorage.setItem(K_FIREBASE, JSON.stringify({}));
          localStorage.setItem(K_LOG, JSON.stringify([]));
          closeModal();
          loadAll();
          setSession(null);
          toast("تم المسح ✅", "ok");
        }),
        mkBtn("إلغاء","btn",closeModal)
      ]
    });
  }

  // ====== Demo seed ======
  function seedDemo(){
    const cities = ["القاهرة","الجيزة","الإسكندرية","المنصورة","طنطا","أسيوط"];
    const names = ["محمد","أحمد","محمود","عمر","يوسف","مصطفى","ياسر","سعيد","حسن","خالد","إبراهيم","طارق"];
    const db = { ...DEFAULT_DB, customers:[], sales:[], returns:[], payments:[], discounts:[] };

    for(let i=0;i<18;i++){
      const name = `${names[i%names.length]} ${["السيد","علي","حسين","حمدي","عبدالله"][i%5]}`;
      db.customers.push({
        id: uid("c"),
        name,
        phone: "01" + Math.floor(100000000 + Math.random()*899999999),
        city: cities[i%cities.length],
        status: (i%9===0)?"Inactive":"Active",
        note: (i%4===0)?"عميل VIP محتمل":"—",
        createdAt: Date.now()-Math.floor(Math.random()*30)*86400000,
        updatedAt: Date.now(),
        scorePct: 0, stars: 1, payRatio: 0, retRatio: 0
      });
    }

    const randDate = () => {
      const d = new Date(Date.now() - Math.floor(Math.random()*120)*86400000);
      return d.toISOString().slice(0,10);
    };

    for(const c of db.customers){
      const nSales = 1 + Math.floor(Math.random()*6);
      for(let s=0;s<nSales;s++){
        const amount = 500 + Math.random()*4500;
        db.sales.push({ id: uid("t"), customerId: c.id, invoiceNo:`INV-${Math.floor(1000+Math.random()*9000)}`, amount: Number(amount.toFixed(2)), date: randDate(), note:"", createdAt: Date.now() });
        if(Math.random() < 0.25){
          const r = amount*(0.05+Math.random()*0.25);
          db.returns.push({ id: uid("t"), customerId: c.id, invoiceNo:`RET-${Math.floor(1000+Math.random()*9000)}`, amount: Number(r.toFixed(2)), date: randDate(), note:"", createdAt: Date.now() });
        }
        if(Math.random() < 0.9){
          const p = amount*(0.5+Math.random()*0.6);
          db.payments.push({ id: uid("t"), customerId: c.id, invoiceNo:`PAY-${Math.floor(1000+Math.random()*9000)}`, amount: Number(p.toFixed(2)), date: randDate(), note:"", createdAt: Date.now() });
        }
        if(Math.random() < 0.2){
          const d = amount*(0.02+Math.random()*0.08);
          db.discounts.push({ id: uid("t"), customerId: c.id, invoiceNo:`DISC-${Math.floor(1000+Math.random()*9000)}`, amount: Number(d.toFixed(2)), date: randDate(), note:"", createdAt: Date.now() });
        }
      }
    }

    state.db = db;
    writeLS(K_DB, db);
    logOp("بيانات تجريبية", "تم إنشاء بيانات VIP تجريبية.");
    recalcAll();
    toast("تمت إضافة بيانات تجريبية ✅", "ok");
  }

  // ====== Wiring ======
  function wire(){
    // Menu
    $("#btnMenu").addEventListener("click", openMenu);
    $("#btnCloseMenu").addEventListener("click", closeMenu);
    $("#backdrop").addEventListener("click", closeMenu);

    // Sidebar nav
    $$(".nav-item").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
    // Tabbar nav
    $$(".tabbtn").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));

    // Actions
    $("#btnRecalc").addEventListener("click", recalcAll);
    $("#btnLogout").addEventListener("click", () => { setSession(null); showView("login"); toast("تم تسجيل الخروج.", "ok"); });
    $("#btnWipeLocal").addEventListener("click", wipeAllLocal);

    // Dashboard
    $("#btnGoCustomers").addEventListener("click", () => showView("customers"));

    // Customers filters
    $("#custSearch").addEventListener("input", renderCustomers);
    $("#custCityFilter").addEventListener("change", renderCustomers);
    $("#custStatusFilter").addEventListener("change", renderCustomers);
    $("#btnAddCustomer").addEventListener("click", () => openCustomerModal());

    // Transactions
    $$( "[data-add-tx]" ).forEach(b => b.addEventListener("click", () => openTxModal(b.dataset.addTx)));
    $("#txSearch").addEventListener("input", renderTransactions);
    $("#txFrom").addEventListener("change", renderTransactions);
    $("#txTo").addEventListener("change", renderTransactions);
    $("#btnTxClearDates").addEventListener("click", () => { $("#txFrom").value=""; $("#txTo").value=""; renderTransactions(); });

    // Reports
    $("#btnRepApply").addEventListener("click", renderReports);
    $("#btnRepClear").addEventListener("click", () => { $("#repFrom").value=""; $("#repTo").value=""; renderReports(); });
    $("#btnReportPdf").addEventListener("click", pdfReportPeriod);
// Excel
    $("#btnDownloadTemplate").addEventListener("click", () => {
      const wb = makeWorkbookTemplate(true);
      if(wb){ downloadWorkbook(wb, "CRM_Score_Template_Full.xlsx"); logOp("تحميل قالب", "قالب كامل"); }
    });
    $("#btnDownloadCustomersTemplate").addEventListener("click", () => {
      const wb = makeWorkbookTemplate(false);
      if(wb){ downloadWorkbook(wb, "CRM_Score_Template_Customers.xlsx"); logOp("تحميل قالب", "عملاء فقط"); }
    });
    $("#btnExportAll").addEventListener("click", exportAll);
    $("#btnExportCustomersOnly").addEventListener("click", exportCustomersOnly);

    $("#btnImportAll").addEventListener("click", () => $("#fileImportAll").click());
    $("#btnImportCustomersOnly").addEventListener("click", () => $("#fileImportCustomers").click());

    $("#fileImportAll").addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if(!f) return;
      await importAllFromFile(f);
      e.target.value = "";
    });
    $("#fileImportCustomers").addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if(!f) return;
      await importCustomersFromFile(f);
      e.target.value = "";
    });

    $("#btnClearLog").addEventListener("click", () => {
      writeLS(K_LOG, []);
      renderOpsLog();
      toast("تم مسح السجل.", "ok");
    });

    // PDF
    $("#btnPdfTop").addEventListener("click", pdfTopCustomers);
    $("#btnPdfStatement").addEventListener("click", pdfCustomerStatement);
    $("#stmtFrom").value = "";
    $("#stmtTo").value = "";

    $("#pdfRepFrom").value = "";
    $("#pdfRepTo").value = "";


    // PDF ratio reports (3 separate)
    $("#btnPdfSalesReturns").addEventListener("click", () => pdfRatioReport("returns"));
    $("#btnPdfSalesPayments").addEventListener("click", () => pdfRatioReport("payments"));
    $("#btnPdfSalesDiscounts").addEventListener("click", () => pdfRatioReport("discounts"));
    $("#btnPdfRepClear").addEventListener("click", () => { $("#pdfRepFrom").value=""; $("#pdfRepTo").value=""; });


    // Company
    $("#btnSaveCompany").addEventListener("click", saveCompany);
    $("#btnPreviewLogo").addEventListener("click", previewLogo);

    // Users
    $("#btnAddUser").addEventListener("click", addUserModal);

    // Modal
    $("#modalClose").addEventListener("click", closeModal);
    $("#modal").addEventListener("click", (e) => { if(e.target.id === "modal") closeModal(); });

    // Login tabs
    $$(".tab[data-login-tab]").forEach(t => t.addEventListener("click", () => {
      $$(".tab[data-login-tab]").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      state.ui.loginTab = t.dataset.loginTab;
      const staff = state.ui.loginTab === "staff";
      if($("#loginForm")) $("#loginForm").hidden = !staff;
      if($("#viewerForm")) $("#viewerForm").hidden = staff;
    }));

    // Login submit
    const loginForm = $("#loginForm");
    const loginErr  = $("#loginError");
    const btnLogin  = $("#btnLogin") || $("#loginForm button[type='submit']");
    const remember  = $("#rememberMe");

    function setLoginError(msg){
      if(!loginErr) { toast(msg, "err"); return; }
      loginErr.textContent = msg;
      loginErr.hidden = !msg;
    }
    function setLoginBusy(b){
      try{
        if(btnLogin){
          btnLogin.disabled = !!b;
          btnLogin.textContent = b ? "جارٍ الدخول..." : "دخول";
        }
      }catch(e){}
    }

    loginForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      setLoginError("");
      setLoginBusy(true);

      // in case storage was cleared while the app is open
      try{ ensureBootstrap(); loadAll(); }catch(e){}

      const u = ($("#loginUser")?.value || "").trim();
      const p = ($("#loginPass")?.value || "").trim();

      if(!u || !p){
        setLoginBusy(false);
        setLoginError("اكتب اسم المستخدم وكلمة المرور ثم اضغط دخول.");
        return;
      }

      const user = (state.users||[]).find(x => (x.username||"").toLowerCase() === u.toLowerCase());

      if(!user){
        setLoginBusy(false);
        setLoginError("اسم المستخدم غير موجود. جرّب: admin");
        return;
      }
      if(String(user.password||"") !== String(p)){
        setLoginBusy(false);
        setLoginError("كلمة المرور غير صحيحة. جرّب: admin123");
        return;
      }
      if(user.active === false){
        setLoginBusy(false);
        setLoginError("هذا الحساب موقوف. تواصل مع Admin.");
        return;
      }

      // session
      setSession({ id:user.id, username:user.username, name:user.name||user.username, role:user.role, at: Date.now() });

      // remember me: if unchecked, we store session in memory only (remove from LS)
      if(remember && !remember.checked){
        try{ localStorage.removeItem(K_SESSION); }catch(e){}
      }

      setLoginBusy(false);
      toast("تم تسجيل الدخول ✅", "ok");
      renderAll();
      showView("dashboard");
    });

    // Clear fields
    $("#btnClearLogin")?.addEventListener("click", () => {
      try{
        $("#loginUser").value = "";
        $("#loginPass").value = "";
        setLoginError("");
        $("#loginUser").focus();
      }catch(e){}
    });

    // Toggle password visibility
    $("#togglePass")?.addEventListener("click", () => {
      const inp = $("#loginPass");
      const btn = $("#togglePass");
      if(!inp || !btn) return;
      const on = inp.type === "password";
      inp.type = on ? "text" : "password";
      btn.classList.toggle("is-on", on);
    });


    $("#viewerForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = ($("#viewerCode").value||"").trim();
      const required = (state.company.viewerCode||"").trim();
      if(required && code !== required){
        toast("رمز العرض غير صحيح.", "err");
        return;
      }
      setSession({ id:"viewer", username:"viewer", name:"Viewer", role:ROLES.VIEWER, at: Date.now() });
      toast("تم الدخول (عرض فقط) ✅", "ok");
      showView("dashboard");
    });

    // Demo
    $("#btnSeedDemo").addEventListener("click", () => {
      if(!confirm("إضافة بيانات تجريبية؟ (لن تحذف بياناتك الحالية)")) return;
      seedDemo();
    });

    // PWA install
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      state.ui.deferredPrompt = e;
      $("#btnInstallPwa").style.display = "";
    });
    $("#btnInstallPwa").addEventListener("click", async () => {
      const p = state.ui.deferredPrompt;
      if(!p){
        toast("التثبيت غير متاح الآن. افتح القائمة في المتصفح واختر (إضافة للشاشة الرئيسية).", "warn");
        return;
      }
      p.prompt();
      await p.userChoice;
      state.ui.deferredPrompt = null;
      toast("تم إرسال طلب التثبيت ✅", "ok");
    });

    // ===== Ratios Page wiring =====
    $("#btnRatiosRefresh")?.addEventListener("click", () => { recalcAll(); renderRatios(); toast("تمت إعادة الحساب ✅","ok"); });
    $("#btnRatClear")?.addEventListener("click", () => { $("#ratFrom").value=""; $("#ratTo").value=""; renderRatios(); });
    $("#ratFrom")?.addEventListener("change", renderRatios);
    $("#ratTo")?.addEventListener("change", renderRatios);
    $("#ratSearch")?.addEventListener("input", debounce(renderRatios, 180));
    $("#ratSort")?.addEventListener("change", renderRatios);

    $("#btnRatPrintReturns")?.addEventListener("click", () => { try{ $("#pdfRepFrom").value=$("#ratFrom").value; $("#pdfRepTo").value=$("#ratTo").value; }catch(e){} pdfRatioReport("returns"); });
    $("#btnRatPrintPayments")?.addEventListener("click", () => { try{ $("#pdfRepFrom").value=$("#ratFrom").value; $("#pdfRepTo").value=$("#ratTo").value; }catch(e){} pdfRatioReport("payments"); });
    $("#btnRatPrintDiscounts")?.addEventListener("click", () => { try{ $("#pdfRepFrom").value=$("#ratFrom").value; $("#pdfRepTo").value=$("#ratTo").value; }catch(e){} pdfRatioReport("discounts"); });

  }

  // ====== Service Worker ======
  async function registerSW(){
    if(!("serviceWorker" in navigator)) return;
    try{
      await navigator.serviceWorker.register("./sw.js");
    }catch(e){
      // ignore on file://
    }
  }

  // ====== Start ======
  function start(){
    ensureBootstrap();
    loadAll();
    wire();
    registerSW();

    // Update logo in login if company logo exists
    if(state.company?.logoUrl){
      $("#loginLogo").src = state.company.logoUrl;
    }

    // Enter last view
    if(state.session){
      reflectSessionUI();
      showView("dashboard");
    }else{
      showView("login");
    }

    // Initial render
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
