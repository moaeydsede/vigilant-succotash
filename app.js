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

  function customerCard(c, compact=false){
    const b = badgeFor(c.stars||1);
    const city = c.city ? `<span class="chip">📍 ${escapeHtml(c.city)}</span>` : "";
    const phone = c.phone ? `<span class="chip">📞 ${escapeHtml(c.phone)}</span>` : "";
    const status = c.status === "Inactive" ? `<span class="chip">⛔ غير نشط</span>` : `<span class="chip">✅ نشط</span>`;
    const note = c.note ? `<div class="muted small">${escapeHtml(c.note)}</div>` : "";

    const extra = compact ? "" : `
      <div class="meta">
        <span class="chip">سداد%: ${Number(c.payRatio||0).toFixed(1)}%</span>
        <span class="chip">مرتجعات%: ${Number(c.retRatio||0).toFixed(1)}%</span>
        <span class="chip">Score: ${Number(c.scorePct||0).toFixed(1)}%</span>
      </div>
      ${note}
      <div class="card-actions">
        <button class="btn" data-action="stmt" data-id="${c.id}">كشف حساب</button>
        <button class="btn" data-action="edit" data-id="${c.id}">تعديل</button>
        <button class="btn warn" data-action="delete" data-id="${c.id}">حذف</button>
      </div>
    `;

    return `
      <div class="card">
        <div class="row between">
          <div style="min-width:0">
            <div class="card-title" style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name||"—")}</div>
            <div class="muted small">${escapeHtml(c.id)}</div>
          </div>
          <span class="badge ${b.cls}">${b.label}</span>
        </div>
        <div class="row between" style="margin-top:10px">
          <div class="stars">${starsHtml(c.stars||1)}</div>
          <div class="muted small">${escapeHtml(statusText(c.status))}</div>
        </div>
        <div class="meta">
          ${status}
          ${city}
          ${phone}
        </div>
        ${extra}
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

  // ====== Reports PDF (period) ======
  async function pdfReportPeriod(){
    const { jsPDF } = window.jspdf || {};
    if(!jsPDF){ toast("مكتبة PDF لم تُحمّل بعد.", "err"); return; }

    const from = $("#repFrom").value;
    const to = $("#repTo").value;

    const company = state.company || {};
    const title = company.name ? `تقرير الفترة - ${company.name}` : "تقرير الفترة";

    const doc = new jsPDF({ unit:"pt", format:"a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, 40, 50, { align:"left" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`من: ${from||"—"}  إلى: ${to||"—"}`, 40, 72);

    const salesTotal = state.db.sales.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const retTotal = state.db.returns.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const payTotal = state.db.payments.filter(x => inRange(x.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0);
    const payPct = salesTotal>0 ? (payTotal/salesTotal*100) : 0;
    const retPct = salesTotal>0 ? (retTotal/salesTotal*100) : 0;

    doc.text(`مبيعات: ${salesTotal.toFixed(2)} | سداد: ${payTotal.toFixed(2)} | سداد%: ${payPct.toFixed(1)}% | مرتجعات%: ${retPct.toFixed(1)}%`, 40, 95);

    // Top customers table
    const top = state.db.customers
      .map(c => {
        const s = sumByCustomer(state.db.sales, c.id, from, to);
        const r = sumByCustomer(state.db.returns, c.id, from, to);
        const p = sumByCustomer(state.db.payments, c.id, from, to);
        const payRatio = s>0 ? p/s : 0;
        const retRatio = s>0 ? r/s : 0;
        const score = clamp((payRatio*100) - (retRatio*60), 0, 100);
        return { name:c.name||"—", city:c.city||"", sales:s, payments:p, returns:r, score:Number(score.toFixed(1)) };
      })
      .sort((a,b)=>b.score-a.score)
      .slice(0, 15);

    const rows = top.map((x,i)=>[
      i+1,
      x.name,
      x.city,
      x.sales.toFixed(2),
      x.payments.toFixed(2),
      x.returns.toFixed(2),
      `${x.score.toFixed(1)}%`
    ]);

    doc.autoTable({
      startY: 120,
      head: [["#", "العميل", "المدينة", "مبيعات", "سداد", "مرتجعات", "Score"]],
      body: rows,
      styles: { font:"helvetica", fontSize: 9 },
      headStyles: { fillColor: [20, 30, 55] },
      margin: { left: 40, right: 40 }
    });

    doc.save(`Report_${from||"all"}_${to||"all"}.pdf`);
    logOp("طباعة PDF", "تقرير الفترة");
  }

  // ====== PDF: Top customers ======
  async function pdfTopCustomers(){
    const { jsPDF } = window.jspdf || {};
    if(!jsPDF){ toast("مكتبة PDF لم تُحمّل بعد.", "err"); return; }

    const company = state.company || {};
    const title = company.name ? `أفضل العملاء - ${company.name}` : "أفضل العملاء";

    const doc = new jsPDF({ unit:"pt", format:"a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, 40, 50);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`تاريخ: ${todayISO()}`, 40, 72);

    const top = state.db.customers.slice()
      .sort((a,b) => (b.scorePct||0)-(a.scorePct||0))
      .slice(0, 20);

    const rows = top.map((c,i)=>[
      i+1,
      c.name||"—",
      c.city||"",
      `${Number(c.scorePct||0).toFixed(1)}%`,
      "⭐".repeat(clamp(c.stars||1,1,5))
    ]);

    doc.autoTable({
      startY: 95,
      head: [["#", "العميل", "المدينة", "Score", "Stars"]],
      body: rows,
      styles: { font:"helvetica", fontSize: 10 },
      headStyles: { fillColor: [20, 30, 55] },
      margin: { left: 40, right: 40 }
    });

    doc.save(`Top_Customers_${todayISO()}.pdf`);
    logOp("طباعة PDF", "أفضل العملاء");
  }

  // ====== PDF: Customer statement ======
  async function pdfCustomerStatement(){
    const { jsPDF } = window.jspdf || {};
    if(!jsPDF){ toast("مكتبة PDF لم تُحمّل بعد.", "err"); return; }

    const customerId = $("#stmtCustomer").value;
    if(!customerId){ toast("اختر عميل.", "err"); return; }

    const from = $("#stmtFrom").value;
    const to = $("#stmtTo").value;

    const c = state.db.customers.find(x => x.id === customerId);
    if(!c){ toast("العميل غير موجود.", "err"); return; }

    const company = state.company || {};
    const title = company.name ? `كشف حساب - ${company.name}` : "كشف حساب";

    const doc = new jsPDF({ unit:"pt", format:"a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, 40, 50);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`العميل: ${c.name||"—"}   |   من: ${from||"—"} إلى: ${to||"—"}`, 40, 72);

    const merged = []
      .concat(state.db.sales.map(x => ({...x, _type:"sale", _label:"مبيعات"})))
      .concat(state.db.returns.map(x => ({...x, _type:"return", _label:"مرتجعات"})))
      .concat(state.db.payments.map(x => ({...x, _type:"payment", _label:"سداد"})))
      .concat(state.db.discounts.map(x => ({...x, _type:"discount", _label:"خصم"})))
      .filter(x => x.customerId === customerId)
      .filter(x => inRange(x.date, from, to))
      .sort((a,b) => (a.date||"").localeCompare(b.date||"") || (a.createdAt||0)-(b.createdAt||0));

    const rows = merged.map((t,i)=>[
      i+1,
      t.date||"",
      t._label,
      t.invoiceNo||"",
      Number(t.amount||0).toFixed(2),
      t.note||""
    ]);

    doc.autoTable({
      startY: 92,
      head: [["#", "التاريخ", "النوع", "الفاتورة", "المبلغ", "ملاحظة"]],
      body: rows,
      styles: { font:"helvetica", fontSize: 9 },
      headStyles: { fillColor: [20, 30, 55] },
      margin: { left: 40, right: 40 }
    });

    // Totals summary
    const s = sumByCustomer(state.db.sales, customerId, from, to);
    const r = sumByCustomer(state.db.returns, customerId, from, to);
    const p = sumByCustomer(state.db.payments, customerId, from, to);
    const d = sumByCustomer(state.db.discounts, customerId, from, to);

    const y = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 18 : 740;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`إجمالي مبيعات: ${s.toFixed(2)}   |   سداد: ${p.toFixed(2)}   |   مرتجعات: ${r.toFixed(2)}   |   خصم: ${d.toFixed(2)}`, 40, y);

    doc.save(`Statement_${sanitizeFile(c.name||"customer")}_${from||"all"}_${to||"all"}.pdf`);
    logOp("طباعة PDF", `كشف حساب: ${c.name||"—"}`);
  }

  function sanitizeFile(s){
    return String(s).replace(/[\\\/:*?"<>|]/g, "_").slice(0, 50);
  }

  // ====== Excel ======
  function makeWorkbookTemplate(full=true){
    if(!window.XLSX){ toast("مكتبة Excel لم تُحمّل بعد.", "err"); return null; }
    const wb = XLSX.utils.book_new();

    const customersCols = ["id","name","phone","city","status","note","createdAt","updatedAt","scorePct","stars","payRatio","retRatio"];
    const txCols = ["id","customerId","invoiceNo","amount","date","note","createdAt"];

    const wsCustomers = XLSX.utils.aoa_to_sheet([customersCols]);
    XLSX.utils.book_append_sheet(wb, wsCustomers, "Customers");

    if(full){
      const mkTx = (name) => {
        const ws = XLSX.utils.aoa_to_sheet([txCols]);
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      mkTx("Sales");
      mkTx("Returns");
      mkTx("Payments");
      mkTx("Discounts");
    }
    return wb;
  }

  function downloadWorkbook(wb, filename){
    XLSX.writeFile(wb, filename);
  }

  function exportAll(){
    const wb = XLSX.utils.book_new();

    const db = state.db;

    const addSheet = (name, arr) => {
      const ws = XLSX.utils.json_to_sheet(arr);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    addSheet("Customers", db.customers);
    addSheet("Sales", db.sales);
    addSheet("Returns", db.returns);
    addSheet("Payments", db.payments);
    addSheet("Discounts", db.discounts);

    downloadWorkbook(wb, `CRM_Score_All_${todayISO()}.xlsx`);
    logOp("تصدير Excel", "البيانات كاملة");
    toast("تم تصدير Excel ✅", "ok");
  }

  function exportCustomersOnly(){
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(state.db.customers);
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    downloadWorkbook(wb, `CRM_Score_Customers_${todayISO()}.xlsx`);
    logOp("تصدير Excel", "العملاء فقط");
    toast("تم تصدير العملاء ✅", "ok");
  }

  function readFileAsArrayBuffer(file){
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  function sheetToJson(wb, name){
    const ws = wb.Sheets[name];
    if(!ws) return null;
    const json = XLSX.utils.sheet_to_json(ws, { defval:"" });
    return json;
  }

  async function importAllFromFile(file){
    if(!window.XLSX){ toast("مكتبة Excel لم تُحمّل بعد.", "err"); return; }

    const buf = await readFileAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type:"array" });

    const customers = sheetToJson(wb, "Customers") || [];
    const sales = sheetToJson(wb, "Sales") || [];
    const returns = sheetToJson(wb, "Returns") || [];
    const payments = sheetToJson(wb, "Payments") || [];
    const discounts = sheetToJson(wb, "Discounts") || [];

    // Minimal validation
    if(!Array.isArray(customers)){ toast("ملف غير صحيح: Customers", "err"); return; }

    state.db = {
      customers: normalizeCustomers(customers),
      sales: normalizeTx(sales),
      returns: normalizeTx(returns),
      payments: normalizeTx(payments),
      discounts: normalizeTx(discounts)
    };
    writeLS(K_DB, state.db);
    logOp("استيراد Excel", `كامل • ${file.name}`);
    recalcAll();
  }

  async function importCustomersFromFile(file){
    if(!window.XLSX){ toast("مكتبة Excel لم تُحمّل بعد.", "err"); return; }

    const buf = await readFileAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type:"array" });

    const customers = sheetToJson(wb, "Customers") || [];
    if(!Array.isArray(customers)){ toast("ملف غير صحيح: Customers", "err"); return; }

    // Replace customers only (keep transactions)
    state.db.customers = normalizeCustomers(customers);
    writeLS(K_DB, state.db);
    logOp("استيراد Excel", `عملاء فقط • ${file.name}`);
    recalcAll();
  }

  function normalizeCustomers(list){
    return list.map(x => ({
      id: String(x.id || uid("c")),
      name: String(x.name || "").trim(),
      phone: String(x.phone || "").trim(),
      city: String(x.city || "").trim(),
      status: (String(x.status||"Active").trim() === "Inactive") ? "Inactive" : "Active",
      note: String(x.note || "").trim(),
      createdAt: Number(x.createdAt || Date.now()),
      updatedAt: Number(x.updatedAt || Date.now()),
      scorePct: Number(x.scorePct || 0),
      stars: Number(x.stars || 1),
      payRatio: Number(x.payRatio || 0),
      retRatio: Number(x.retRatio || 0)
    })).filter(c => c.name);
  }

  function normalizeTx(list){
    return (Array.isArray(list) ? list : []).map(x => ({
      id: String(x.id || uid("t")),
      customerId: String(x.customerId || "").trim(),
      invoiceNo: String(x.invoiceNo || "").trim(),
      amount: Number(x.amount || 0),
      date: String(x.date || todayISO()).slice(0,10),
      note: String(x.note || "").trim(),
      createdAt: Number(x.createdAt || Date.now())
    })).filter(t => t.customerId && t.amount);
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
      $("#loginForm").hidden = !staff;
      $("#viewerForm").hidden = staff;
    }));

    // Login submit
    $("#loginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const u = $("#loginUser").value.trim();
      const p = $("#loginPass").value;
      const user = state.users.find(x => x.username.toLowerCase() === u.toLowerCase());
      if(!user || user.password !== p){ toast("بيانات الدخول غير صحيحة.", "err"); return; }
      if(user.active === false){ toast("هذا الحساب موقوف.", "err"); return; }

      setSession({ id:user.id, username:user.username, name:user.name||user.username, role:user.role, at: Date.now() });
      toast("تم تسجيل الدخول ✅", "ok");
      showView("dashboard");
    });

    $("#viewerForm").addEventListener("submit", (e) => {
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
