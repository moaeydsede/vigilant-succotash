import { db, fs, auth, fa } from "./firebase.js";

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

const escapeHtml = (s)=> String(s||"")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const clamp = (v,a,b)=> Math.max(a, Math.min(b,v));
const starsText = (n)=> "⭐".repeat(Math.max(1, Number(n||1)));

const fmtMoney = (n)=>{
  const x = Number(n||0);
  try { return new Intl.NumberFormat("ar-EG",{style:"currency",currency:"EGP",maximumFractionDigits:0}).format(x); }
  catch { return x.toFixed(0); }
};

const scoreEngine = ({ sales=0, returns=0, payments=0, discounts=0 }) => {
  const raw = (sales*0.4) - (returns*0.3) + (payments*0.2) - (discounts*0.1);
  const score = clamp(raw, 0, 100);
  const stars = score>=90?5 : score>=75?4 : score>=60?3 : score>=40?2 : 1;
  const badge = score>=90?{t:"VIP",c:"success"} :
                score>=75?{t:"ممتاز",c:"success"} :
                score>=60?{t:"جيد",c:"warning"} :
                score>=40?{t:"متوسط",c:"warning"} : {t:"خطر",c:"danger"};
  return { raw, score, stars, badge };
};

const toast = (msg)=>{
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(()=> t.hidden = true, 2600);
};

const modal = {
  open(title, bodyHtml, footHtml=""){
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHtml;
    $("#modalFoot").innerHTML = footHtml;
    $("#modal").hidden = false;
  },
  close(){ $("#modal").hidden = true; }
};
$("#modalClose").addEventListener("click", ()=> modal.close());
$("#modalBackdrop").addEventListener("click", ()=> modal.close());

// ===================== Auth + Roles =====================
// users collection: documents keyed by uid: { email, name, role: 'Admin'|'Viewer', isActive, createdAt, updatedAt }
let currentUser = null;
let currentRole = "Viewer";
let isAdmin = false;

function setUiAuthed(authed){
  $("#btnLogout").hidden = !authed;
  // Hide drawer items when not authed
  $("#btnMenu").disabled = !authed;
  $("#btnRefresh").disabled = !authed;
  if(!authed){
    drawer.classList.remove("open");
  }
}

function showLogin(msg=""){
  $$(".view").forEach(v=> v.classList.remove("active"));
  $("#view-login").classList.add("active");
  $("#authMsg").textContent = msg;
  setUiAuthed(false);
}

function showApp(){
  setUiAuthed(true);
}

async function ensureUserDoc(u, displayName=""){
  const ref = fs.doc(db, "users", u.uid);
  const snap = await fs.getDoc(ref);
  if(!snap.exists()){
    await fs.setDoc(ref, {
      email: u.email || "",
      name: displayName || "",
      role: "Viewer",
      isActive: true,
      createdAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp()
    }, { merge:true });
    return { role:"Viewer", isActive:true, name:displayName||"", email:u.email||"" };
  }
  return snap.data();
}

async function refreshRole(){
  if(!currentUser) return;
  const d = await ensureUserDoc(currentUser);
  currentRole = String(d.role || "Viewer");
  isAdmin = (currentRole === "Admin") && (d.isActive !== false);

  // Admin-only nav
  $("#navUsers").hidden = !isAdmin;

  // Permissions (Viewer = read only)
  const ro = !isAdmin;
  const setHidden = (id, hidden)=> { const el = $(id); if(el) el.hidden = hidden; };
  setHidden("#btnAddCustomer", ro);
  setHidden("#btnDeleteCustomer", ro);
  setHidden("#btnAddTxn", ro);
  setHidden("#btnAddGlobalTxn", ro);
  setHidden("#btnExport", false); // export allowed
  setHidden("#btnImport", ro);
  setHidden("#btnSeedDemo", ro);
  setHidden("#btnClearAll", ro);
  setHidden("#btnDownloadTemplate", false);

  showApp();
}

fa.onAuthStateChanged(auth, async (u)=>{
  currentUser = u || null;
  if(!u){
    showLogin("");
    return;
  }
  await ensureUserDoc(u);
  await refreshRole();
  // default route
  route("customers");
});

$("#btnLogin").addEventListener("click", async ()=>{
  const email = ($("#authEmail").value||"").trim();
  const pass = ($("#authPass").value||"").trim();
  if(!email || !pass) return showLogin("اكتب البريد وكلمة المرور");
  try{
    $("#authMsg").textContent = "جاري الدخول…";
    await fa.signInWithEmailAndPassword(auth, email, pass);
  }catch(e){
    console.error(e);
    $("#authMsg").textContent = "فشل الدخول: " + (e?.message || "");
  }
});

$("#btnShowRegister").addEventListener("click", ()=>{
  modal.open("إنشاء حساب", `
    <div class="grid2">
      <div class="field" style="grid-column:1/-1"><label>الاسم</label><input id="rName" type="text" placeholder="اسم المستخدم"></div>
      <div class="field" style="grid-column:1/-1"><label>البريد الإلكتروني</label><input id="rEmail" type="email" placeholder="name@example.com"></div>
      <div class="field" style="grid-column:1/-1"><label>كلمة المرور</label><input id="rPass" type="password" placeholder="••••••••"></div>
    </div>
    <div class="muted small" style="margin-top:10px">سيتم إنشاء الحساب بصلاحية Viewer افتراضيًا.</div>
  `, `<button class="btn" id="rCreate">إنشاء</button><button class="btn ghost" id="rCancel">إلغاء</button>`);
  $("#rCancel").addEventListener("click", ()=> modal.close());
  $("#rCreate").addEventListener("click", async ()=>{
    const name = ($("#rName").value||"").trim();
    const email = ($("#rEmail").value||"").trim();
    const pass = ($("#rPass").value||"").trim();
    if(!email || !pass) return toast("اكتب البريد وكلمة المرور");
    try{
      const cred = await fa.createUserWithEmailAndPassword(auth, email, pass);
      await ensureUserDoc(cred.user, name);
      modal.close();
      toast("تم إنشاء الحساب");
    }catch(e){
      console.error(e);
      toast("فشل إنشاء الحساب: " + (e?.message||""));
    }
  });
});

$("#btnLogout").addEventListener("click", async ()=>{
  await fa.signOut(auth);
  toast("تم تسجيل الخروج");
});



// Drawer
const drawer = $("#drawer");
const openDrawer = ()=> { drawer.classList.add("open"); drawer.setAttribute("aria-hidden","false"); };
const closeDrawer = ()=> { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden","true"); };
$("#btnMenu").addEventListener("click", openDrawer);
$("#btnCloseDrawer").addEventListener("click", closeDrawer);
drawer.addEventListener("click", (e)=>{
  const btn = e.target.closest(".nav-item");
  if(!btn) return;
  $$(".nav-item").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  route(btn.dataset.route);
  closeDrawer();
});

function route(name){
  if(!currentUser){ return showLogin(""); }
  if(name==="users" && !isAdmin){ toast("غير مصرح"); return route("customers"); }

  $$(".view").forEach(v=> v.classList.remove("active"));
  $("#view-"+name).classList.add("active");
  if(name==="customers") loadCustomers();
  if(name==="transactions") loadGlobalTxns();
  if(name==="invoices") loadInvoices();
  if(name==="company") loadCompany();
}
$("#btnRefresh").addEventListener("click", ()=>{ toast("تم التحديث"); loadCustomers(); });

// Firestore refs
const col = (name)=> fs.collection(db,name);
const docCompany = ()=> fs.doc(db,"settings","company");

function parseDateInput(sel, end=false){
  const v = $(sel).value;
  if(!v) return null;
  return new Date(v + (end ? "T23:59:59" : "T00:00:00"));
}
function inRange(ts, from, to){
  const dt = ts?.toDate ? ts.toDate() : null;
  if(!dt) return true;
  if(from && dt < from) return false;
  if(to && dt > to) return false;
  return true;
}
async function listCol(name, limitN=5000){
  const out=[];
  const snap = await fs.getDocs(fs.query(col(name), fs.limit(limitN)));
  snap.forEach(d=> out.push({ id:d.id, ...d.data() }));
  return out;
}
async function sumByCustomer(name, customerId, from=null, to=null){
  const snap = await fs.getDocs(fs.query(col(name), fs.where("customerId","==",customerId), fs.limit(5000)));
  let total=0;
  snap.forEach(d=>{
    const r=d.data();
    if(!inRange(r.date, from, to)) return;
    total += Number(r.amount||0);
  });
  return total;
}
async function recomputeCustomer(customerId){
  const [sales, returns, payments, discounts] = await Promise.all([
    sumByCustomer("sales", customerId),
    sumByCustomer("returns", customerId),
    sumByCustomer("payments", customerId),
    sumByCustomer("discounts", customerId),
  ]);
  const se = scoreEngine({ sales, returns, payments, discounts });
  await fs.updateDoc(fs.doc(db,"customers",customerId), {
    score: se.score, stars: se.stars, badgeText: se.badge.t, badgeClass: se.badge.c,
    updatedAt: fs.serverTimestamp()
  });
  return { sales, returns, payments, discounts, ...se };
}

// Customers
let customersCache=[];
let currentCustomerId=null;
let currentAgg=null;

async function fillCustomerSelects(){
  const opts = customersCache.map(c=>`<option value="${c.id}">${escapeHtml(c.name||"")}</option>`).join("");
  $("#gCustomer").innerHTML = `<option value="">(كل العملاء)</option>` + opts;
  $("#invCustomer").innerHTML = `<option value="">(كل العملاء)</option>` + opts;
}

async function loadCustomers(){
  $("#customersGrid").innerHTML="";
  $("#customersEmpty").hidden=true;

  const snap = await fs.getDocs(fs.query(col("customers"), fs.orderBy("createdAt","desc"), fs.limit(2000)));
  customersCache=[];
  snap.forEach(d=> customersCache.push({ id:d.id, ...d.data() }));

  const cities = Array.from(new Set(customersCache.map(c=>(c.city||"").trim()).filter(Boolean))).sort();
  const sel=$("#fCity"); const keep=sel.value;
  sel.innerHTML = '<option value="">الكل</option>' + cities.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  sel.value = keep;

  await fillCustomerSelects();
  renderCustomers();
}

function renderCustomers(){
  const q = ($("#qCustomer").value||"").trim().toLowerCase();
  const fCity=$("#fCity").value;
  const fStatus=$("#fStatus").value;
  const fStars=$("#fStars").value ? Number($("#fStars").value) : null;
  const sort=$("#sSort").value;

  let list = customersCache.slice();
  if(q) list = list.filter(c=> (`${c.name||""} ${c.city||""} ${c.phone||""}`.toLowerCase()).includes(q));
  if(fCity) list = list.filter(c=> (c.city||"")===fCity);
  if(fStatus) list = list.filter(c=> (c.status||"")===fStatus);
  if(fStars) list = list.filter(c=> Number(c.stars||0)===fStars);
  if(sort==="name_asc") list.sort((a,b)=> (a.name||"").localeCompare(b.name||""));
  if(sort==="created_desc") list.sort((a,b)=> (b.createdAt?.toDate?b.createdAt.toDate().getTime():0)-(a.createdAt?.toDate?a.createdAt.toDate().getTime():0));
  if(sort==="score_desc") list.sort((a,b)=> Number(b.score||0)-Number(a.score||0));

  const grid=$("#customersGrid"); grid.innerHTML="";
  if(list.length===0){ $("#customersEmpty").hidden=false; return; }

  list.forEach(c=>{
    const score = (typeof c.score==="number") ? c.score : null;
    const stars = (typeof c.stars==="number") ? c.stars : null;
    const badgeText = c.badgeText || "—";
    const badgeClass = c.badgeClass || "warning";

    const el=document.createElement("div");
    el.className="card";
    el.innerHTML = `
      <div class="card-head">
        <div>
          <div class="title">${escapeHtml(c.name||"بدون اسم")}</div>
          <div class="sub">${escapeHtml(c.city||"")}${c.phone ? " • "+escapeHtml(c.phone):""}</div>
          <div class="starline">${stars?starsText(stars):"—"}</div>
          <div class="scoreline">${score!==null?score.toFixed(0)+"%":"جاري…"}</div>
        </div>
        <div class="badge ${badgeClass}">${escapeHtml(badgeText)}</div>
      </div>
    `;
    el.addEventListener("click", ()=> openCustomer(c.id));
    grid.appendChild(el);

    if(score===null || stars===null || !c.badgeText){
      recomputeCustomer(c.id).then(p=>{
        const idx = customersCache.findIndex(x=>x.id===c.id);
        if(idx>=0) customersCache[idx] = { ...customersCache[idx], score:p.score, stars:p.stars, badgeText:p.badge.t, badgeClass:p.badge.c };
        renderCustomers();
      }).catch(()=>{});
    }
  });
}

["#qCustomer","#fCity","#fStatus","#fStars","#sSort"].forEach(sel=> $(sel).addEventListener(sel==="#qCustomer"?"input":"change", renderCustomers));

$("#btnAddCustomer").addEventListener("click", ()=>{
  modal.open("إضافة عميل", `
    <div class="grid2">
      <div class="field"><label>اسم العميل</label><input id="mName" type="text" placeholder="محمد أحمد"></div>
      <div class="field"><label>الهاتف</label><input id="mPhone" type="text" placeholder="010…"></div>
      <div class="field"><label>المدينة</label><input id="mCity" type="text" placeholder="القاهرة"></div>
      <div class="field"><label>الحالة</label><select id="mStatus"><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
    </div>
  `, `<button class="btn" id="mSave">حفظ</button><button class="btn ghost" id="mCancel">إلغاء</button>`);
  $("#mCancel").addEventListener("click", ()=> modal.close());
  $("#mSave").addEventListener("click", async ()=>{
    const name = ($("#mName").value||"").trim();
    if(!name) return toast("اكتب اسم العميل");
    await fs.addDoc(col("customers"), {
      name,
      phone: ($("#mPhone").value||"").trim(),
      city: ($("#mCity").value||"").trim(),
      status: $("#mStatus").value,
      createdAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp(),
      score: 0, stars: 1, badgeText:"جديد", badgeClass:"warning"
    });
    modal.close(); toast("تمت إضافة العميل"); loadCustomers();
  });
});

async function openCustomer(id){
  currentCustomerId=id;
  route("customer");
  const d = await fs.getDoc(fs.doc(db,"customers",id));
  if(!d.exists()){ toast("العميل غير موجود"); return route("customers"); }
  $("#custName").textContent = d.data().name || "تفاصيل العميل";
  await loadCustomerDetails();
}
$("#btnBack").addEventListener("click", ()=> route("customers"));

async function loadCustomerDetails(from=null,to=null){
  const [sales, returns, payments, discounts] = await Promise.all([
    sumByCustomer("sales", currentCustomerId, from, to),
    sumByCustomer("returns", currentCustomerId, from, to),
    sumByCustomer("payments", currentCustomerId, from, to),
    sumByCustomer("discounts", currentCustomerId, from, to),
  ]);
  currentAgg = { sales, returns, payments, discounts, ...scoreEngine({ sales, returns, payments, discounts }) };
  $("#custSummaryCards").innerHTML = `
    <div class="card"><div class="title">المبيعات</div><div class="kpi"><div class="k">المبلغ</div><div class="v">${fmtMoney(sales)}</div></div></div>
    <div class="card"><div class="title">المرتجعات</div><div class="kpi"><div class="k">المبلغ</div><div class="v">${fmtMoney(returns)}</div></div></div>
    <div class="card"><div class="title">السداد</div><div class="kpi"><div class="k">المبلغ</div><div class="v">${fmtMoney(payments)}</div></div></div>
    <div class="card"><div class="title">الخصومات</div><div class="kpi"><div class="k">المبلغ</div><div class="v">${fmtMoney(discounts)}</div></div></div>
    <div class="card"><div class="title">التقييم</div><div class="sub">${escapeHtml(currentAgg.badge.t)}</div><div class="starline">${starsText(currentAgg.stars)}</div><div class="scoreline">${currentAgg.score.toFixed(0)}%</div></div>
  `;
  await loadCustomerTxns("sales", from, to);
  setActiveTab("sales");
}

function setActiveTab(t){ $$(".tab").forEach(x=>x.classList.toggle("active", x.dataset.tab===t)); }
$$(".tab").forEach(t=> t.addEventListener("click", ()=>{ setActiveTab(t.dataset.tab); loadCustomerTxns(t.dataset.tab); }));

async function loadCustomerTxns(type, from=null, to=null){
  const rows = (await listCol(type, 5000))
    .filter(r=> r.customerId===currentCustomerId && inRange(r.date, from, to))
    .sort((a,b)=> (b.date?.toDate?b.date.toDate().getTime():0)-(a.date?.toDate?a.date.toDate().getTime():0));

  if(rows.length===0){ $("#custTxns").innerHTML='<div class="center muted">لا توجد حركات.</div>'; return; }

  const head = type==="payments"
    ? "<tr><th>التاريخ</th><th>المرجع</th><th>الطريقة</th><th>المبلغ</th></tr>"
    : "<tr><th>التاريخ</th><th>رقم الفاتورة</th><th>ملاحظة</th><th>المبلغ</th></tr>";

  const html = rows.map(r=>{
    const dt=r.date?.toDate ? r.date.toDate().toLocaleDateString("ar-EG") : "";
    const inv=escapeHtml(r.invoiceNo||"");
    const note=escapeHtml(r.note||r.reason||r.type||"");
    const amount=fmtMoney(r.amount||0);
    if(type==="payments") return `<tr><td>${dt}</td><td>${inv||escapeHtml(r.ref||"")}</td><td>${escapeHtml(r.method||"")}</td><td>${amount}</td></tr>`;
    return `<tr><td>${dt}</td><td>${inv}</td><td>${note}</td><td>${amount}</td></tr>`;
  }).join("");
  const total = rows.reduce((a,b)=>a+Number(b.amount||0),0);
  $("#custTxns").innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="badge">${escapeHtml(type)}</div><div class="badge">${fmtMoney(total)} إجمالي</div></div><table class="table"><thead>${head}</thead><tbody>${html}</tbody></table>`;
}

$("#btnCustFilterDate").addEventListener("click", ()=>{
  const from=parseDateInput("#custDateFrom",false);
  const to=parseDateInput("#custDateTo",true);
  loadCustomerDetails(from,to);
});

$("#btnDeleteCustomer").addEventListener("click", ()=>{
  modal.open("تأكيد الحذف", `<div class="prose"><p>سيتم حذف العميل فقط (لن تُحذف الحركات تلقائيًا).</p></div>`,
    `<button class="btn danger" id="mDel">حذف</button><button class="btn ghost" id="mCancel">إلغاء</button>`);
  $("#mCancel").addEventListener("click", ()=> modal.close());
  $("#mDel").addEventListener("click", async ()=>{
    await fs.deleteDoc(fs.doc(db,"customers",currentCustomerId));
    modal.close(); toast("تم الحذف"); route("customers");
  });
});

function txnModal(prefCustomerId=null){
  const opts = customersCache.map(c=>`<option value="${c.id}">${escapeHtml(c.name||"")}</option>`).join("");
  modal.open("إضافة حركة", `
    <div class="grid2">
      <div class="field"><label>نوع الحركة</label>
        <select id="tType"><option value="sales">Sales</option><option value="returns">Returns</option><option value="payments">Payments</option><option value="discounts">Discounts</option></select>
      </div>
      <div class="field"><label>العميل</label><select id="tCustomer">${opts}</select></div>
      <div class="field"><label>رقم الفاتورة / المرجع</label><input id="tInvoice" type="text" placeholder="S-1001"></div>
      <div class="field"><label>المبلغ</label><input id="tAmount" type="number" placeholder="0"></div>
      <div class="field"><label>التاريخ</label><input id="tDate" type="date"></div>
      <div class="field" id="tExtra"></div>
      <div class="field" style="grid-column:1/-1"><label>ملاحظة / سبب</label><input id="tNote" type="text" placeholder="ملاحظة…"></div>
    </div>
  `, `<button class="btn" id="tSave">حفظ</button><button class="btn ghost" id="tCancel">إلغاء</button>`);

  $("#tDate").value = new Date().toISOString().slice(0,10);
  if(prefCustomerId) $("#tCustomer").value = prefCustomerId;

  const renderExtra=()=>{
    const type=$("#tType").value;
    const ex=$("#tExtra");
    if(type==="payments"){
      ex.innerHTML = `<label>طريقة الدفع</label><select id="tMethod"><option value="Cash">Cash</option><option value="Transfer">Transfer</option><option value="Card">Card</option></select>`;
    }else if(type==="discounts"){
      ex.innerHTML = `<label>نوع الخصم</label><input id="tDiscType" type="text" placeholder="خصم كمية">`;
    }else{
      ex.innerHTML = `<label>&nbsp;</label><div class="muted small">—</div>`;
    }
  };
  renderExtra();
  $("#tType").addEventListener("change", renderExtra);

  $("#tCancel").addEventListener("click", ()=> modal.close());
  $("#tSave").addEventListener("click", async ()=>{
    const type=$("#tType").value;
    const customerId=$("#tCustomer").value;
    const amount=Number($("#tAmount").value||0);
    if(!customerId) return toast("اختر عميل");
    if(!amount || amount<=0) return toast("اكتب مبلغ صحيح");
    const date=$("#tDate").value ? new Date($("#tDate").value+"T10:00:00") : new Date();
    const base={ customerId, invoiceNo:($("#tInvoice").value||"").trim(), amount, date: fs.Timestamp.fromDate(date), note:($("#tNote").value||"").trim() };
    if(type==="returns") base.reason = base.note;
    if(type==="payments"){ base.method = $("#tMethod")?.value || "Cash"; base.ref = base.invoiceNo; }
    if(type==="discounts") base.type = ($("#tDiscType").value||"").trim();

    await fs.addDoc(col(type), base);
    await recomputeCustomer(customerId);

    modal.close(); toast("تمت إضافة الحركة");
    await loadCustomers();
    if(currentCustomerId===customerId) await loadCustomerDetails();
  });
}
$("#btnAddTxn").addEventListener("click", ()=> txnModal(currentCustomerId));
$("#btnAddGlobalTxn").addEventListener("click", ()=> txnModal(null));

$("#btnViewInvoices").addEventListener("click", ()=>{
  $("#invCustomer").value = currentCustomerId || "";
  route("invoices");
  loadInvoices();
});

// Global txns
$("#btnLoadGlobalTxns").addEventListener("click", loadGlobalTxns);
async function loadGlobalTxns(){
  const type=$("#gTxnType").value;
  const cid=$("#gCustomer").value || null;
  const from=parseDateInput("#gFrom",false);
  const to=parseDateInput("#gTo",true);

  let rows = await listCol(type, 5000);
  rows = rows.filter(r=>{
    if(cid && r.customerId!==cid) return false;
    return inRange(r.date, from, to);
  }).sort((a,b)=> (b.date?.toDate?b.date.toDate().getTime():0)-(a.date?.toDate?a.date.toDate().getTime():0));

  const mapName = new Map(customersCache.map(c=>[c.id,c.name||""]));
  if(rows.length===0){ $("#globalTxns").innerHTML='<div class="center muted">لا توجد نتائج.</div>'; return; }

  const head = type==="payments"
    ? "<tr><th>التاريخ</th><th>العميل</th><th>المرجع</th><th>الطريقة</th><th>المبلغ</th></tr>"
    : "<tr><th>التاريخ</th><th>العميل</th><th>رقم الفاتورة</th><th>ملاحظة</th><th>المبلغ</th></tr>";

  const html = rows.map(r=>{
    const dt=r.date?.toDate ? r.date.toDate().toLocaleDateString("ar-EG") : "";
    const name=escapeHtml(mapName.get(r.customerId)||"");
    const inv=escapeHtml(r.invoiceNo||"");
    const note=escapeHtml(r.note||r.reason||r.type||"");
    const amount=fmtMoney(r.amount||0);
    if(type==="payments") return `<tr><td>${dt}</td><td>${name}</td><td>${inv||escapeHtml(r.ref||"")}</td><td>${escapeHtml(r.method||"")}</td><td>${amount}</td></tr>`;
    return `<tr><td>${dt}</td><td>${name}</td><td>${inv}</td><td>${note}</td><td>${amount}</td></tr>`;
  }).join("");

  const total=rows.reduce((a,b)=>a+Number(b.amount||0),0);
  $("#globalTxns").innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="badge">${escapeHtml(type)}</div><div class="badge">${fmtMoney(total)} إجمالي</div></div><table class="table"><thead>${head}</thead><tbody>${html}</tbody></table>`;
}

// Invoices
$("#btnLoadInvoices").addEventListener("click", loadInvoices);
$("#btnRecalcInvoices").addEventListener("click", ()=>{ toast("تم التحديث"); loadInvoices(); });

async function loadInvoices(){
  const cid=$("#invCustomer").value || null;
  const qInv=($("#invQuery").value||"").trim().toLowerCase();
  const from=parseDateInput("#invFrom",false);
  const to=parseDateInput("#invTo",true);

  const [sales, returns, payments, discounts] = await Promise.all([
    listCol("sales",5000), listCol("returns",5000), listCol("payments",5000), listCol("discounts",5000)
  ]);

  const rows = [
    ...sales.map(x=>({...x,_t:"sales"})),
    ...returns.map(x=>({...x,_t:"returns"})),
    ...payments.map(x=>({...x,_t:"payments"})),
    ...discounts.map(x=>({...x,_t:"discounts"})),
  ].filter(r=>{
    if(cid && r.customerId!==cid) return false;
    const inv=(r.invoiceNo||"").toLowerCase();
    if(qInv && !inv.includes(qInv)) return false;
    if(!inRange(r.date, from, to)) return false;
    return true;
  });

  const map=new Map();
  for(const r of rows){
    const inv=(r.invoiceNo||"").trim();
    if(!inv) continue;
    const key=r.customerId+"||"+inv;
    if(!map.has(key)) map.set(key,{customerId:r.customerId,invoiceNo:inv,date:null,sales:0,returns:0,payments:0,discounts:0});
    const it=map.get(key);
    it[r._t]+=Number(r.amount||0);
    const dt=r.date?.toDate ? r.date.toDate() : null;
    if(dt && (!it.date || dt < it.date)) it.date=dt;
  }

  const invoices=Array.from(map.values()).sort((a,b)=> (b.date?.getTime()||0)-(a.date?.getTime()||0));
  const grid=$("#invoicesGrid"); grid.innerHTML="";
  $("#invoicesEmpty").hidden = invoices.length!==0;

  const mapName=new Map(customersCache.map(c=>[c.id,c.name||""]));
  invoices.forEach(i=>{
    const se=scoreEngine(i);
    const el=document.createElement("div");
    el.className="card";
    el.innerHTML = `
      <div class="card-head">
        <div>
          <div class="title">${escapeHtml(i.invoiceNo)}</div>
          <div class="sub">${escapeHtml(mapName.get(i.customerId)||"")} • ${i.date?i.date.toLocaleDateString("ar-EG"):""}</div>
          <div class="starline">${starsText(se.stars)}</div>
          <div class="scoreline">${se.score.toFixed(0)}%</div>
        </div>
        <div class="badge ${se.badge.c}">${escapeHtml(se.badge.t)}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="k">Sales</div><div class="v">${fmtMoney(i.sales)}</div></div>
        <div class="kpi"><div class="k">Returns</div><div class="v">${fmtMoney(i.returns)}</div></div>
        <div class="kpi"><div class="k">Payments</div><div class="v">${fmtMoney(i.payments)}</div></div>
        <div class="kpi"><div class="k">Discounts</div><div class="v">${fmtMoney(i.discounts)}</div></div>
      </div>
    `;
    grid.appendChild(el);
  });
}

// Company
let companyCache={name:"",phone:"",address:"",logoUrl:""};
async function loadCompany(){
  const d=await fs.getDoc(docCompany());
  if(d.exists()) companyCache=d.data();
  $("#coName").value=companyCache.name||"";
  $("#coPhone").value=companyCache.phone||"";
  $("#coAddress").value=companyCache.address||"";
  $("#coLogo").value=companyCache.logoUrl||"";
  renderCompanyPreview();
}
function renderCompanyPreview(){
  const name=escapeHtml($("#coName").value||"اسم الشركة");
  const phone=escapeHtml($("#coPhone").value||"");
  const address=escapeHtml($("#coAddress").value||"");
  const logoUrl=($("#coLogo").value||"").trim();
  $("#companyPreview").innerHTML = `
    <div class="print-header">
      <div>
        <div class="print-title">${name}</div>
        <div class="muted small">${address}</div>
        <div class="muted small">${phone}</div>
      </div>
      ${logoUrl?`<img class="print-logo" src="${escapeHtml(logoUrl)}" alt="Logo">`:`<div class="badge">LOGO</div>`}
    </div>
    <div class="muted small">هذه المعاينة ستظهر في الطباعة و PDF.</div>
  `;
}
["coName","coPhone","coAddress","coLogo"].forEach(id=> $("#"+id).addEventListener("input", renderCompanyPreview));
$("#btnSaveCompany").addEventListener("click", async ()=>{
  const doc={
    name:($("#coName").value||"").trim(),
    phone:($("#coPhone").value||"").trim(),
    address:($("#coAddress").value||"").trim(),
    logoUrl:($("#coLogo").value||"").trim(),
    updatedAt: fs.serverTimestamp()
  };
  await fs.setDoc(docCompany(), doc, { merge:true });
  companyCache={...companyCache,...doc};
  toast("تم حفظ بيانات الشركة");
});

// Print/PDF
async function renderPrint(title, html){
  const d=await fs.getDoc(docCompany());
  const co=d.exists()?d.data():companyCache;
  const logo = co.logoUrl ? `<img class="print-logo" src="${escapeHtml(co.logoUrl)}" alt="Logo">` : "";
  $("#printArea").innerHTML = `
    <div style="padding:14px;font-family:'Cairo',Arial;direction:rtl;">
      <div class="print-header">
        <div>
          <div class="print-title">${escapeHtml(co.name||"الشركة")}</div>
          <div class="muted small">${escapeHtml(co.address||"")}</div>
          <div class="muted small">${escapeHtml(co.phone||"")}</div>
        </div>
        ${logo}
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;margin:8px 0 12px">
        <div style="font-weight:900">${escapeHtml(title)}</div>
        <div class="muted small">${new Date().toLocaleString("ar-EG")}</div>
      </div>
      <hr>
      ${html}
    </div>
  `;
}
async function exportPdf(filename){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  await doc.html($("#printArea"), { x:24, y:24, width:548, windowWidth:900, callback:(pdf)=> pdf.save(filename) });
}
const slug=(s)=> String(s||"").trim().replace(/[\s\/\\]+/g,"_").replace(/[^\w\u0600-\u06FF_]+/g,"").slice(0,40)||"file";

$("#btnPrintCustomer").addEventListener("click", async ()=>{
  if(!currentCustomerId) return;
  const name=$("#custName").textContent||"Customer";
  const html = `
    <div class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,.10)">
      <div class="title">${escapeHtml(name)}</div>
      <div class="starline">${starsText(currentAgg?.stars||1)}</div>
      <div class="scoreline">${Number(currentAgg?.score||0).toFixed(0)}%</div>
      <div class="kpis" style="margin-top:12px">
        <div class="kpi"><div class="k">Sales</div><div class="v">${fmtMoney(currentAgg?.sales||0)}</div></div>
        <div class="kpi"><div class="k">Returns</div><div class="v">${fmtMoney(currentAgg?.returns||0)}</div></div>
        <div class="kpi"><div class="k">Payments</div><div class="v">${fmtMoney(currentAgg?.payments||0)}</div></div>
        <div class="kpi"><div class="k">Discounts</div><div class="v">${fmtMoney(currentAgg?.discounts||0)}</div></div>
      </div>
    </div>
    <div style="margin-top:12px">${$("#custTxns").innerHTML}</div>
  `;
  await renderPrint("تقرير العميل", html);
  modal.open("طباعة / PDF", `<div class="prose"><p>اختر:</p><div class="row"><button class="btn" id="doPrint">طباعة A4</button><button class="btn ghost" id="doPdf">PDF</button></div></div>`);
  $("#doPrint").addEventListener("click", ()=>{ modal.close(); window.print(); });
  $("#doPdf").addEventListener("click", async ()=>{ modal.close(); await exportPdf(`Customer_${slug(name)}_${new Date().toISOString().slice(0,10)}.pdf`); });
});
$("#btnPrintGlobalTxns").addEventListener("click", async ()=>{ await renderPrint("تقرير الحركات", $("#globalTxns").innerHTML||""); window.print(); });
$("#btnPrintInvoices").addEventListener("click", async ()=>{ await renderPrint("تقرير الفواتير", $("#invoicesGrid").innerHTML||""); window.print(); });

// Excel Export/Import + template + demo + clear
$("#btnExport").addEventListener("click", exportExcel);
$("#btnImport").addEventListener("click", importExcel);
$("#btnDownloadTemplate").addEventListener("click", downloadTemplate);
$("#btnSeedDemo").addEventListener("click", seedDemo);
$("#btnClearAll").addEventListener("click", clearAll);

async function exportExcel(){
  $("#importLog").textContent="جاري التصدير…";
  const toPlain = (rows)=> rows.map(r=>{
    const o={...r};
    if(o.date?.toDate) o.date=o.date.toDate().toISOString();
    if(o.createdAt?.toDate) o.createdAt=o.createdAt.toDate().toISOString();
    if(o.updatedAt?.toDate) o.updatedAt=o.updatedAt.toDate().toISOString();
    return o;
  });
  const [customers,sales,returns,payments,discounts]=await Promise.all([
    listCol("customers"),listCol("sales"),listCol("returns"),listCol("payments"),listCol("discounts")
  ]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toPlain(customers)),"customers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toPlain(sales)),"sales");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toPlain(returns)),"returns");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toPlain(payments)),"payments");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toPlain(discounts)),"discounts");
  XLSX.writeFile(wb, `CRM_Score_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
  $("#importLog").textContent="تم التصدير ✅"; toast("تم تصدير Excel");
}
function parseAnyDate(v){ if(!v) return null; if(v instanceof Date) return v; const d=new Date(String(v)); return isNaN(d.getTime())?null:d; }

async function importExcel(){
  const file=$("#fileExcel").files?.[0];
  if(!file) return toast("اختر ملف Excel");
  $("#importLog").textContent="جاري قراءة الملف…";
  const wb=XLSX.read(await file.arrayBuffer(), {type:"array"});
  const getSheet=(n)=> wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], {defval:""}) : [];
  const sheets={
    customers:getSheet("customers"),
    sales:getSheet("sales"),
    returns:getSheet("returns"),
    payments:getSheet("payments"),
    discounts:getSheet("discounts"),
  };
  $("#importLog").textContent="جاري الرفع…";
  let count=0;

  for(const row of sheets.customers){
    const id=String(row.id||"").trim();
    const name=String(row.name||"").trim();
    if(!name) continue;
    const doc={
      name,
      phone:String(row.phone||"").trim(),
      city:String(row.city||"").trim(),
      status:String(row.status||"Active").trim()||"Active",
      score: row.score===""?0:Number(row.score||0),
      stars: row.stars===""?1:Number(row.stars||1),
      badgeText:String(row.badgeText||"").trim(),
      badgeClass:String(row.badgeClass||"").trim(),
      createdAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp()
    };
    const created=parseAnyDate(row.createdAt); const updated=parseAnyDate(row.updatedAt);
    if(created) doc.createdAt=fs.Timestamp.fromDate(created);
    if(updated) doc.updatedAt=fs.Timestamp.fromDate(updated);
    if(id) await fs.setDoc(fs.doc(db,"customers",id), doc, {merge:true});
    else await fs.addDoc(col("customers"), doc);
    count++;
  }

  const importTxn = async (rows, targetName, extraFn=()=>({}))=>{
    for(const row of rows){
      const customerId=String(row.customerId||"").trim();
      const amount=Number(row.amount||0);
      if(!customerId || !amount) continue;
      const dt=parseAnyDate(row.date) || new Date();
      const doc={
        customerId,
        invoiceNo:String(row.invoiceNo||"").trim(),
        amount,
        date: fs.Timestamp.fromDate(dt),
        note:String(row.note||row.reason||"").trim(),
        ...extraFn(row)
      };
      await fs.addDoc(col(targetName), doc);
      count++;
    }
  };
  await importTxn(sheets.sales,"sales");
  await importTxn(sheets.returns,"returns", r=>({reason:String(r.reason||"").trim()}));
  await importTxn(sheets.payments,"payments", r=>({method:String(r.method||"Cash").trim(), ref:String(r.ref||"").trim()}));
  await importTxn(sheets.discounts,"discounts", r=>({type:String(r.type||"").trim()}));

  $("#importLog").textContent=`تم الاستيراد ✅ (سجلات: ${count})`;
  toast("تم استيراد Excel");
  await loadCustomers();
};

function downloadTemplate(){
  const nowIso=new Date().toISOString();
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {id:"",name:"محمد أحمد",phone:"010xxxxxxx",city:"القاهرة",status:"Active"},
    {id:"",name:"أحمد",phone:"",city:"الجيزة",status:"Active"},
    {id:"",name:"خالد",phone:"",city:"الإسكندرية",status:"Inactive"},
  ]),"customers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {customerId:"PUT_CUSTOMER_ID",invoiceNo:"S-1001",amount:2500,date:nowIso,note:"طلبية أدوات"}
  ]),"sales");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {customerId:"PUT_CUSTOMER_ID",invoiceNo:"S-1001",amount:200,date:nowIso,reason:"مرتجع"}
  ]),"returns");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {customerId:"PUT_CUSTOMER_ID",invoiceNo:"S-1001",amount:1000,date:nowIso,method:"Cash",ref:""}
  ]),"payments");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {customerId:"PUT_CUSTOMER_ID",invoiceNo:"S-1001",amount:100,date:nowIso,type:"خصم"}
  ]),"discounts");
  XLSX.writeFile(wb,"CRM_Score_Template.xlsx");
}

async function seedDemo(){
  modal.open("تأكيد", `<div class="prose"><p>سيتم إضافة بيانات تجريبية. هل تريد المتابعة؟</p></div>`,
    `<button class="btn" id="seedOk">إضافة</button><button class="btn ghost" id="seedCancel">إلغاء</button>`);
  $("#seedCancel").addEventListener("click", ()=> modal.close());
  $("#seedOk").addEventListener("click", async ()=>{
    modal.close();
    const custs=[
      {name:"أحمد",phone:"01000000001",city:"القاهرة",status:"Active"},
      {name:"محمد",phone:"01000000002",city:"الجيزة",status:"Active"},
      {name:"خالد",phone:"01000000003",city:"الإسكندرية",status:"Inactive"},
    ];
    const ids=[];
    for(const c of custs){
      const r=await fs.addDoc(col("customers"),{...c,createdAt:fs.serverTimestamp(),updatedAt:fs.serverTimestamp(),score:0,stars:1,badgeText:"جديد",badgeClass:"warning"});
      ids.push(r.id);
    }
    const mk=(days)=>{const d=new Date();d.setDate(d.getDate()-days);return fs.Timestamp.fromDate(d);};
    for(let i=0;i<10;i++) await fs.addDoc(col("sales"),{customerId:ids[i%3],invoiceNo:`S-${1000+i}`,amount:500+i*120,date:mk(15-i),note:"بيع"});
    for(let i=0;i<3;i++) await fs.addDoc(col("returns"),{customerId:ids[i%3],invoiceNo:`S-${1000+i}`,amount:80+i*30,date:mk(10-i),reason:"مرتجع",note:"مرتجع"});
    for(let i=0;i<6;i++) await fs.addDoc(col("payments"),{customerId:ids[i%3],invoiceNo:`S-${1000+i}`,amount:200+i*150,date:mk(12-i),method:"Cash",ref:""});
    for(let i=0;i<4;i++) await fs.addDoc(col("discounts"),{customerId:ids[i%3],invoiceNo:`S-${1000+i}`,amount:30+i*20,date:mk(9-i),type:"خصم"});
    for(const id of ids) await recomputeCustomer(id);
    toast("تمت إضافة بيانات تجريبية");
    await loadCustomers();
  });
}

async function clearAll(){
  modal.open("تحذير", `<div class="prose"><p><strong>سيتم حذف كل البيانات</strong>.</p></div>`,
    `<button class="btn danger" id="cOk">حذف الكل</button><button class="btn ghost" id="cCancel">إلغاء</button>`);
  $("#cCancel").addEventListener("click", ()=> modal.close());
  $("#cOk").addEventListener("click", async ()=>{
    modal.close();
    const wipe=async(n)=>{
      const snap=await fs.getDocs(fs.query(col(n), fs.limit(5000)));
      const tasks=[]; snap.forEach(d=> tasks.push(fs.deleteDoc(fs.doc(db,n,d.id))));
      await Promise.all(tasks);
    };
    await wipe("customers"); await wipe("sales"); await wipe("returns"); await wipe("payments"); await wipe("discounts");
    toast("تم حذف كل البيانات");
    await loadCustomers();
  });
}


// ===================== Users Management (Admin) =====================
async function loadUsers(){
  if(!isAdmin){ $("#usersList").innerHTML = '<div class="center muted">غير مصرح.</div>'; return; }
  const snap = await fs.getDocs(fs.query(fs.collection(db,"users"), fs.limit(2000)));
  const rows = [];
  snap.forEach(d=> rows.push({ id:d.id, ...d.data() }));
  rows.sort((a,b)=> (b.createdAt?.toDate?b.createdAt.toDate().getTime():0) - (a.createdAt?.toDate?a.createdAt.toDate().getTime():0));

  if(rows.length===0){
    $("#usersList").innerHTML = '<div class="center muted">لا يوجد مستخدمون.</div>';
    return;
  }

  $("#usersList").innerHTML = rows.map(u=>{
    const role = String(u.role||"Viewer");
    const active = u.isActive !== false;
    return `
      <div class="card" style="margin-bottom:10px">
        <div class="card-head">
          <div>
            <div class="title">${escapeHtml(u.name || u.email || u.id)}</div>
            <div class="sub">${escapeHtml(u.email||"")}</div>
          </div>
          <div class="badge ${active ? "success":"danger"}">${active ? "Active":"Inactive"}</div>
        </div>

        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label>Role</label>
            <select data-uid="${u.id}" class="uRole">
              <option value="Admin" ${role==="Admin"?"selected":""}>Admin</option>
              <option value="Viewer" ${role!=="Admin"?"selected":""}>Viewer</option>
            </select>
          </div>
          <div class="field">
            <label>الحالة</label>
            <select data-uid="${u.id}" class="uActive">
              <option value="1" ${active?"selected":""}>Active</option>
              <option value="0" ${!active?"selected":""}>Inactive</option>
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>اسم</label>
            <input data-uid="${u.id}" class="uName" type="text" value="${escapeHtml(u.name||"")}" />
          </div>
        </div>

        <div class="row" style="margin-top:12px">
          <button class="btn ghost uSave" data-uid="${u.id}">حفظ</button>
        </div>
      </div>
    `;
  }).join("");

  $$(".uSave").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const uid = btn.dataset.uid;
      const role = $(`.uRole[data-uid="${uid}"]`)?.value || "Viewer";
      const active = ($(`.uActive[data-uid="${uid}"]`)?.value || "1") === "1";
      const name = $(`.uName[data-uid="${uid}"]`)?.value || "";
      await fs.setDoc(fs.doc(db,"users",uid), {
        role, isActive: active, name, updatedAt: fs.serverTimestamp()
      }, { merge:true });
      toast("تم الحفظ");
      // if editing yourself, refresh permissions
      if(currentUser && uid === currentUser.uid) await refreshRole();
    });
  });
}

$("#btnReloadUsers").addEventListener("click", loadUsers);

$("#btnAddUser").addEventListener("click", ()=>{
  if(!isAdmin) return toast("غير مصرح");
  modal.open("إضافة مستخدم (يدوي)", `
    <div class="prose">
      <p>مهم: لا يمكن إنشاء حسابات Firebase Auth لمستخدمين آخرين من داخل المتصفح بدون سيرفر.</p>
      <p>الحل العملي:</p>
      <ol>
        <li>المستخدم ينشئ حسابه من شاشة (إنشاء حساب).</li>
        <li>ثم أنت كـ Admin تدخل هنا وتغيّر Role إلى Admin أو Viewer.</li>
      </ol>
    </div>
  `, `<button class="btn ghost" id="uOk">حسناً</button>`);
  $("#uOk").addEventListener("click", ()=> modal.close());
});

// عندما تفتح صفحة المستخدمين
const _routeOrig = route;
route = function(name){
  _routeOrig(name);
  if(name==="users") loadUsers();
};


// Boot
(async function init(){
  try{
    // سيتم التحميل بعد تسجيل الدخول
    showLogin("");
  }catch(e){
    console.error(e);
    modal.open("تنبيه", `<div class="prose"><p>لم يتم الاتصال بـ Firestore.</p><p class="muted small">عدل firebaseConfig داخل firebase.js ثم أعد التحميل.</p></div>`, `<button class="btn ghost" id="mOk">حسناً</button>`);
    $("#mOk").addEventListener("click", ()=> modal.close());
  }
})();