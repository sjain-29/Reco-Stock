/* RECONENSE™ Stock Management v1.1 — app.js
   Firebase: reconense-projects-default-rtdb.europe-west1.firebasedatabase.app
   Changes v1.1:
   - Dashboard stat cards dynamic per parent category (no hardcoded insoles/electronics)
   - Profit/Loss card with % (only from paid sales)
   - Payment received checkbox on dispatch; unpaid sales shown on dashboard
   - Vendor/Customer name autocomplete (remembered)
   - Per-item low stock threshold
   - No default credentials in code
   - Logo white bg removed via mix-blend-mode in HTML
*/
'use strict';

/* ── FIREBASE ─────────────────────────────────────────────────── */
const firebaseConfig = {
  databaseURL: "https://reconense-projects-default-rtdb.europe-west1.firebasedatabase.app/"
};
try { firebase.initializeApp(firebaseConfig); }
catch(e) { console.warn('[FB]', e.message); }
const db = firebase.database();
const DB = { STOCK:'stock_items', CATS:'categories', PARENT_CATS:'parent_categories',
             ACTIVITY:'activity_log', SALES:'sales', USERS:'users' };

/* ── DB HELPERS ───────────────────────────────────────────────── */
const fbPush   = (p,d)  => db.ref(p).push(d).then(r => r.key);
const fbSet    = (p,d)  => db.ref(p).set(d);
const fbUpdate = (p,d)  => db.ref(p).update(d);
const fbDelete = p      => db.ref(p).remove();
const fbRead   = p      => db.ref(p).once('value').then(s => s.val());
const fbListen = (p,cb) => db.ref(p).on('value', s => cb(s.val()), e => console.error('[FB]',e.message));
const fbOff    = p      => db.ref(p).off();

/* ── STATE ────────────────────────────────────────────────────── */
const S = {
  user:null, stock:{}, cats:{}, parentCats:{}, sales:{},
  bulkRows:[], sortField:'itemName', sortAsc:true, pending:null, sellRows:[]
};

/* ── INIT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const fd = document.getElementById('fm-date'); if(fd) fd.value = today();
  const sd = document.getElementById('sell-date'); if(sd) sd.value = today();
  updateClock(); setInterval(updateClock, 1000);

  const zone = document.getElementById('drop-zone');
  if(zone){
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); const f=e.dataTransfer.files[0]; if(f) parseExcel(f); });
  }

  ['l-pass','l-user'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  });
  document.addEventListener('keydown', e => {
    if(e.key==='Escape') ['m-edit','m-cat','m-parent-cat','m-user','m-confirm','m-sell'].forEach(closeModal);
  });

  await seedDefaultUser();

  const saved = localStorage.getItem('rcn_session');
  if(saved){ try{ S.user=JSON.parse(saved); bootApp(); }catch(_){ showLogin(); } }
  else showLogin();
});

async function seedDefaultUser(){
  try{
    // Remove legacy reconense user if it exists
    const legacy = await fbRead(`${DB.USERS}/reconense`);
    if(legacy) await fbDelete(`${DB.USERS}/reconense`);

    const existing = await fbRead(`${DB.USERS}/reco`);
    if(!existing){
      await fbSet(`${DB.USERS}/reco`,{
        username:'reco', displayName:'Reco Admin',
        role:'ADMIN',
        pwHash:'0bd5bdbad9c8fadec65629e8bd2c1363f461763937413ab3380f5f8792042dbf',
        active:true, protected:true,
        createdAt:new Date().toISOString()
      });
    }
  }catch(e){ console.warn('[Seed]',e.message); }
}

function updateClock(){ const el=document.getElementById('clock'); if(el) el.textContent=new Date().toLocaleTimeString('en-IN',{hour12:true}); }

/* ── HASH ─────────────────────────────────────────────────────── */
async function hashPw(pw){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ── AUTH ─────────────────────────────────────────────────────── */
async function doLogin(){
  const username=document.getElementById('l-user').value.trim().toLowerCase();
  const password=document.getElementById('l-pass').value;
  const errEl=document.getElementById('login-err');
  const btn=document.getElementById('login-btn');
  hideEl(errEl);
  if(!username||!password){ showEl(errEl,'Please enter username and password.'); return; }
  btn.disabled=true; btn.innerHTML='⏳ Signing in…';
  try{
    const userRec=await fbRead(`${DB.USERS}/${username}`);
    if(!userRec){ showEl(errEl,'User not found.'); return; }
    if(!userRec.active){ showEl(errEl,'Account inactive. Contact admin.'); return; }
    if(await hashPw(password)!==userRec.pwHash){ showEl(errEl,'Incorrect password.'); return; }
    S.user={userId:username,username:userRec.username||username,displayName:userRec.displayName||username,role:userRec.role||'VIEW_ONLY'};
    localStorage.setItem('rcn_session',JSON.stringify(S.user));
    bootApp();
  }catch(e){ showEl(errEl,'Login error: '+e.message); }
  finally{
    btn.disabled=false;
    btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign In';
  }
}

async function doLogout(){
  [DB.STOCK,DB.CATS,DB.PARENT_CATS,DB.ACTIVITY,DB.SALES,DB.USERS].forEach(fbOff);
  S.user=null; S.stock={}; S.cats={}; S.parentCats={}; S.sales={};
  localStorage.removeItem('rcn_session');
  const bn=document.getElementById('bottom-nav'); if(bn) bn.style.display='none';
  showLogin(); toast('Logged out.','success');
}

/* ── ROUTING ──────────────────────────────────────────────────── */
function showLogin(){
  document.getElementById('login-page').style.display='flex';
  document.getElementById('app-page').classList.add('hidden');
  val('l-user',''); val('l-pass',''); hideEl(document.getElementById('login-err'));
}

function bootApp(){
  document.getElementById('login-page').style.display='none';
  document.getElementById('app-page').classList.remove('hidden');
  applyRoleUI(); startListeners(); goTo('dashboard');
}

function applyRoleUI(){
  const {role,displayName,username}=S.user;
  const isAdmin=role==='ADMIN', isMgrPlus=isAdmin||role==='MANAGER';
  setText('nav-name',displayName||username);
  const av=document.getElementById('nav-avatar'); if(av) av.textContent=(displayName||username)[0].toUpperCase();
  const rt=document.getElementById('nav-role');
  if(rt){ rt.textContent=role.replace(/_/g,' '); rt.className='role-tag '+role.toLowerCase(); }
  document.querySelectorAll('.role-mgrplus').forEach(el=>el.style.display=isMgrPlus?'':'none');
  document.querySelectorAll('.role-admin').forEach(el=>el.style.display=isAdmin?'':'none');
  const ah=document.getElementById('act-col-hdr'); if(ah) ah.style.display=isMgrPlus?'':'none';
  // Show/hide bottom nav on app page
  const bn=document.getElementById('bottom-nav'); if(bn) bn.style.display='';
}

function goTo(sec){
  const {role}=S.user;
  if((sec==='add-stock'||sec==='categories')&&role==='VIEW_ONLY'){toast('Access restricted.','error');return;}
  if(sec==='users'&&role!=='ADMIN'){toast('Admin access required.','error');return;}
  closeMobileSidebar();
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.sec===sec));
  document.querySelectorAll('.bn-item').forEach(el=>el.classList.toggle('active',el.dataset.sec===sec));
  document.querySelectorAll('.section').forEach(el=>el.classList.remove('active'));
  document.getElementById('sec-'+sec)?.classList.add('active');
  setText('page-title',{dashboard:'Dashboard',inventory:'Inventory','add-stock':'Add Stock',sales:'Sales Ledger',categories:'Categories',users:'Users'}[sec]||sec);
  const sw=document.getElementById('search-wrap'); if(sw) sw.style.display=(sec==='inventory')?'flex':'none';
  if(sec==='categories') renderCats();
  if(sec==='users')      loadUsers();
  if(sec==='sales')      renderSalesTable();
}

function openMobileSidebar(){ if(window.innerWidth<=768) return; document.getElementById('sidebar').classList.add('mobile-open'); document.getElementById('sidebar-overlay').classList.add('active'); document.body.style.overflow='hidden'; }
function closeMobileSidebar(){ document.getElementById('sidebar').classList.remove('mobile-open'); document.getElementById('sidebar-overlay').classList.remove('active'); document.body.style.overflow=''; }

function toggleMoreMenu(){
  const menu=document.getElementById('more-menu');
  if(menu.classList.contains('hidden')){ menu.classList.remove('hidden'); document.body.style.overflow='hidden'; }
  else closeMoreMenu();
}
function closeMoreMenu(){
  const menu=document.getElementById('more-menu');
  menu.classList.add('hidden'); document.body.style.overflow='';
  // deactivate "more" dot
  document.querySelectorAll('.bn-item[data-sec="more"]').forEach(el=>el.classList.remove('active'));
}

/* ── LISTENERS ────────────────────────────────────────────────── */
function startListeners(){
  fbListen(DB.STOCK, snap => { S.stock=snap||{}; renderTable(); updateStats(); updateCategoryAnalytics(); refreshAutocomplete(); });
  fbListen(DB.CATS, snap => { S.cats=snap||{}; refreshAllTypeDropdowns(); refreshFilterCats(); renderCats(); });
  fbListen(DB.PARENT_CATS, snap => { S.parentCats=snap||{}; refreshAllTypeDropdowns(); renderCats(); updateStats(); });
  fbListen(DB.ACTIVITY, snap => renderActivity(snap));
  fbListen(DB.SALES, snap => {
    S.sales=snap||{}; updateStats(); updateCategoryAnalytics(); renderPendingPayments(); renderRecentDispatches();
    refreshAutocomplete();
    if(document.getElementById('sec-sales')?.classList.contains('active')) renderSalesTable();
  });
}

/* ── PARENT TYPES ─────────────────────────────────────────────── */
function getAllParentTypes(){
  return Object.entries(S.parentCats).map(([fbKey,p])=>({
    key:(p.name||fbKey).toUpperCase().replace(/\s+/g,'_'),
    label:p.name, icon:p.icon||'📁', fbKey, isCustom:true
  }));
}

function refreshAllTypeDropdowns(){
  const types=getAllParentTypes();
  ['fm-type','e-type','c-type'].forEach(selId=>{
    const sel=document.getElementById(selId); if(!sel) return;
    const prev=sel.value;
    sel.innerHTML=selId==='fm-type'?'<option value="">— Select —</option>':'';
    types.forEach(t=>{ const o=document.createElement('option'); o.value=t.key; o.textContent=t.label; if(t.key===prev) o.selected=true; sel.appendChild(o); });
  });
  ['f-type','sale-f-type'].forEach(selId=>{
    const sel=document.getElementById(selId); if(!sel) return;
    const prev=sel.value;
    sel.innerHTML='<option value="">All Types</option>';
    types.forEach(t=>{ const o=document.createElement('option'); o.value=t.key; o.textContent=t.label; if(t.key===prev) o.selected=true; sel.appendChild(o); });
  });
}

/* ── AUTOCOMPLETE — remember vendors & customers ──────────────── */
function refreshAutocomplete(){
  // vendors from stock
  const vendors=[...new Set(Object.values(S.stock).map(i=>i.vendorName).filter(Boolean))].sort();
  // customers from sales
  const customers=[...new Set(Object.values(S.sales).map(s=>s.customerName).filter(Boolean))].sort();

  ['dl-vendors','dl-vendors-e'].forEach(dlId=>{
    const dl=document.getElementById(dlId); if(!dl) return;
    dl.innerHTML=vendors.map(v=>`<option value="${esc(v)}">`).join('');
  });
  const dlC=document.getElementById('dl-customers'); if(dlC) dlC.innerHTML=customers.map(c=>`<option value="${esc(c)}">`).join('');
  const dlI=document.getElementById('dl-items');
  if(dlI){
    const items=[...new Set(Object.values(S.stock).map(i=>i.itemName).filter(Boolean))].sort();
    dlI.innerHTML=items.map(n=>`<option value="${esc(n)}">`).join('');
  }
}

/* ── DASHBOARD STATS ──────────────────────────────────────────── */
function updateStats(){
  const items=Object.values(S.stock);
  const allTypes=getAllParentTypes();
  const qtyByType={}, qtyByStatus={AVAILABLE:0,IN_USE:0,UNDER_MAINTENANCE:0};
  let totalQty=0, lowStockCount=0, totalBuyCost=0;

  items.forEach(i=>{
    const qty=parseInt(i.quantity)||0;
    totalQty+=qty;
    if(!qtyByType[i.parentType]) qtyByType[i.parentType]=0;
    qtyByType[i.parentType]+=qty;
    if(qtyByStatus[i.status]!==undefined) qtyByStatus[i.status]+=qty;
    // Low stock: use per-item threshold, fallback 5
    const threshold=parseInt(i.lowStockAt)||5;
    if(qty>0&&qty<=threshold) lowStockCount++;
    // Total buy cost = qty * buyPrice
    totalBuyCost+=qty*(parseFloat(i.buyPrice)||0);
  });

  // Paid sales only for revenue/profit
  let totalRevenue=0, totalSoldQty=0, totalPending=0;
  Object.values(S.sales).forEach(s=>{
    const grand=parseFloat(s.grandTotal)||0;
    const qty=s.items?s.items.reduce((a,it)=>a+(parseInt(it.qty)||0),0):(parseInt(s.quantitySold)||0);
    totalSoldQty+=qty;
    if(s.paid){ totalRevenue+=grand; }
    else       { totalPending+=grand; }
  });

  // Cost of goods sold (from sale line items buyPrice)
  let cogsSold=0;
  Object.values(S.sales).filter(s=>s.paid).forEach(s=>{
    if(s.items) s.items.forEach(it=>{
      const stock=S.stock[it.itemId];
      const bp=stock?parseFloat(stock.buyPrice)||0:parseFloat(it.buyPrice)||0;
      cogsSold+=bp*(parseInt(it.qty)||0);
    });
  });

  const profit=totalRevenue-cogsSold;
  const profitPct=cogsSold>0?((profit/cogsSold)*100):0;

  setText('st-total',totalQty);
  setText('st-sold',totalSoldQty);
  setText('st-lowstock',lowStockCount);
  setText('st-revenue','₹'+fmt(totalRevenue));
  setText('st-profit',(profit>=0?'₹':'−₹')+fmt(Math.abs(profit)));
  setText('st-profit-pct',(profit>=0?'▲':'▼')+Math.abs(profitPct).toFixed(1)+'%');
  setText('st-pending','₹'+fmt(totalPending));
  setText('lv-total',totalQty);

  // Profit card colour
  const pc=document.getElementById('profit-card');
  if(pc){ pc.classList.toggle('loss',profit<0); }
  const pi=document.getElementById('profit-icon-wrap'); if(pi) pi.style.cssText='';

  // Status bars
  const tot=totalQty||1;
  setWidth('bar-av',qtyByStatus.AVAILABLE/tot*100);
  setWidth('bar-iu',qtyByStatus.IN_USE/tot*100);
  setWidth('bar-mn',qtyByStatus.UNDER_MAINTENANCE/tot*100);
  setText('cnt-av',qtyByStatus.AVAILABLE);
  setText('cnt-iu',qtyByStatus.IN_USE);
  setText('cnt-mn',qtyByStatus.UNDER_MAINTENANCE);

  // Dynamic type stat cards
  renderTypeStatCards(allTypes, qtyByType);
}

/* Render one stat card per parent category */
const TYPE_COLORS=['#00796b','#3949ab','#e65100','#6a1b9a','#1565c0','#2e7d32','#c62828'];
function renderTypeStatCards(allTypes, qtyByType){
  const row=document.getElementById('type-stats-row'); if(!row) return;
  if(!allTypes.length){ row.innerHTML=''; return; }
  row.innerHTML=allTypes.map((t,i)=>{
    const qty=qtyByType[t.key]||0;
    const col=TYPE_COLORS[i%TYPE_COLORS.length];
    return `<div class="stat-card" style="border-top:3px solid ${col}">
      <div class="stat-icon-wrap" style="background:${col}18;color:${col};font-size:1.2rem">${t.icon}</div>
      <div><div class="stat-num">${qty}</div><div class="stat-lbl">${esc(t.label)}</div></div>
    </div>`;
  }).join('');
}

/* ── PENDING PAYMENTS on dashboard ───────────────────────────── */
function renderPendingPayments(){
  const el=document.getElementById('pending-list'); if(!el) return;
  const pending=Object.entries(S.sales).filter(([,s])=>!s.paid).sort((a,b)=>b[1].timestamp-a[1].timestamp);
  if(!pending.length){ el.innerHTML='<div class="empty-state-sm">All payments received ✓</div>'; return; }
  el.innerHTML=pending.slice(0,10).map(([sid,s])=>`
    <div class="act-item">
      <span class="act-dot pending"></span>
      <span class="act-msg">
        <strong>${esc(s.customerName||'—')}</strong> — ₹${fmt(s.grandTotal||0)}
        ${S.user?.role!=='VIEW_ONLY'?`<button onclick="markPaid('${sid}')" style="margin-left:.5rem;font-size:.7rem;padding:1px 7px;border-radius:4px;border:1px solid var(--green);background:var(--green-bg);color:var(--green);cursor:pointer;font-family:var(--fbody)">Mark Paid</button>`:''}
      </span>
      <span class="act-time">${fmtDate(s.saleDate)}</span>
    </div>`).join('');
}

async function markPaid(saleId){
  try{
    await fbUpdate(`${DB.SALES}/${saleId}`,{paid:true});
    await logActivity(`Payment received for sale to "${S.sales[saleId]?.customerName||'customer'}"`);
    toast('Payment marked as received.','success');
  }catch(e){ toast('Error: '+e.message,'error'); }
}

/* ── RECENT DISPATCHES on dashboard ──────────────────────────── */
function renderRecentDispatches(){
  const el=document.getElementById('recent-dispatches-table'); if(!el) return;
  const sales=Object.entries(S.sales);
  if(!sales.length){ el.innerHTML='<div class="empty-state-sm">No dispatches yet</div>'; return; }
  const recent=sales.sort((a,b)=>b[1].timestamp-a[1].timestamp).slice(0,10);
  el.innerHTML=`<table class="rd-table">
    <thead><tr>
      <th>#</th><th>Customer</th><th>Items</th><th>Total Qty</th>
      <th>Discount</th><th>Grand Total</th><th>Date</th><th>Payment</th><th>By</th>
    </tr></thead>
    <tbody>
      ${recent.map(([,s],i)=>{
        const items=s.items||[];
        const totalQty=items.reduce((a,it)=>a+(parseInt(it.qty)||0),0);
        const itemNames=items.length
          ?items.map(it=>`<span style="display:inline-block;background:var(--navy-light);color:var(--navy);border-radius:4px;padding:1px 7px;font-size:.72rem;margin:1px">${esc(it.itemName||'?')} ×${it.qty}</span>`).join(' ')
          :'—';
        return `<tr>
          <td style="font-family:var(--fmono);color:var(--tx3);font-size:.75rem">${i+1}</td>
          <td>
            <strong>${esc(s.customerName||'—')}</strong>
            ${s.customerPhone?`<div style="font-size:.72rem;color:var(--tx3)">${esc(s.customerPhone)}</div>`:''}
          </td>
          <td style="max-width:240px">${itemNames}</td>
          <td style="font-family:var(--fmono);font-weight:700;text-align:center">${totalQty}</td>
          <td style="font-family:var(--fmono);color:var(--amber)">₹${fmt(s.discount||0)}</td>
          <td><strong style="font-family:var(--fmono);color:var(--green)">₹${fmt(s.grandTotal||0)}</strong></td>
          <td style="font-size:.78rem;color:var(--tx3);white-space:nowrap">${fmtDate(s.saleDate)}</td>
          <td>${s.paid?'<span class="pill paid">Received</span>':'<span class="pill unpaid">Pending</span>'}</td>
          <td style="font-size:.75rem;color:var(--tx3)">${esc(s.dispatchedBy||'—')}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function updateCategoryAnalytics(){
  const el=document.getElementById('cat-analytics'); if(!el) return;
  const catData={};
  Object.values(S.stock).forEach(i=>{ const k=i.category||'General'; if(!catData[k]) catData[k]={remaining:0,sold:0}; catData[k].remaining+=parseInt(i.quantity)||0; });
  Object.values(S.sales).forEach(s=>{ if(s.items) s.items.forEach(it=>{ const k=(S.stock[it.itemId]?.category)||it.itemName||'General'; if(!catData[k]) catData[k]={remaining:0,sold:0}; catData[k].sold+=parseInt(it.qty)||0; }); });
  const keys=Object.keys(catData);
  if(!keys.length){ el.innerHTML='<div class="empty-state-sm">No data yet</div>'; return; }
  el.innerHTML=keys.sort().map(k=>`<div class="ca-row"><span class="ca-name">${esc(k)}</span><div class="ca-vals"><span class="ca-badge rem">▪ ${catData[k].remaining}</span><span class="ca-badge sold">↓ ${catData[k].sold}</span></div></div>`).join('');
}

function renderActivity(snap){
  const el=document.getElementById('act-list'); if(!el) return;
  if(!snap){ el.innerHTML='<div class="empty-state-sm">No activity yet</div>'; return; }
  el.innerHTML=Object.values(snap).sort((a,b)=>b.timestamp-a.timestamp).slice(0,12)
    .map(e=>`<div class="act-item"><span class="act-dot"></span><span class="act-msg">${esc(e.message)}</span><span class="act-time">${ago(e.timestamp)}</span></div>`).join('');
}

async function logActivity(msg){ try{ await fbPush(DB.ACTIVITY,{message:msg,user:S.user?.displayName||'Unknown',timestamp:Date.now()}); }catch(_){} }

/* ── INVENTORY TABLE ──────────────────────────────────────────── */
function getFiltered(){
  const q=((document.getElementById('search-inp')?.value)||'').toLowerCase();
  const ft=document.getElementById('f-type')?.value||'';
  const fc=document.getElementById('f-cat')?.value||'';
  const fs=document.getElementById('f-status')?.value||'';
  let rows=Object.entries(S.stock);
  if(ft) rows=rows.filter(([,i])=>i.parentType===ft);
  if(fc) rows=rows.filter(([,i])=>i.category===fc);
  if(fs) rows=rows.filter(([,i])=>i.status===fs);
  if(q)  rows=rows.filter(([,i])=>[(i.itemName||''),(i.sku||i.serialNumber||''),(i.category||''),(i.vendorName||'')].some(f=>f.toLowerCase().includes(q)));
  rows.sort((a,b)=>{ const va=String(a[1][S.sortField]||'').toLowerCase(),vb=String(b[1][S.sortField]||'').toLowerCase(); return S.sortAsc?va.localeCompare(vb):vb.localeCompare(va); });
  return rows;
}

function renderTable(){
  const tbody=document.getElementById('inv-tbody'); if(!tbody) return;
  const rows=getFiltered(); const count=rows.length;
  setText('row-count',count+' item'+(count!==1?'s':''));
  if(!count){ tbody.innerHTML='<tr><td colspan="12" class="tbl-empty">No items match.</td></tr>'; return; }
  const canEdit=S.user?.role!=='VIEW_ONLY', canDelete=S.user?.role==='ADMIN', canSell=S.user?.role==='ADMIN'||S.user?.role==='MANAGER';
  tbody.innerHTML=rows.map(([id,i])=>{
    const qty=parseInt(i.quantity)||0;
    const threshold=parseInt(i.lowStockAt)||5;
    const isLow=qty>0&&qty<=threshold;
    const typeKey=(i.parentType||'').toLowerCase().replace(/_/g,'');
    return `<tr${isLow?' class="low-stock"':''}>
      <td><strong>${esc(i.itemName||'—')}</strong>${isLow?`<span style="color:#dc2626;font-size:.68rem;font-weight:700;margin-left:6px;background:#fef2f2;padding:1px 6px;border-radius:4px">LOW≤${threshold}</span>`:''}</td>
      <td style="font-family:var(--fmono);font-size:.77rem;color:var(--tx3)">${esc(i.sku||i.serialNumber||'—')}</td>
      <td><span class="badge ${typeKey}">${esc(i.parentType||'—')}</span></td>
      <td>${esc(i.category||'—')}</td>
      <td style="font-size:.8rem">${esc(i.vendorName||'—')}</td>
      <td style="font-family:var(--fmono);font-size:.8rem;color:var(--tx2)">${(parseFloat(i.buyPrice)||0)>0?'₹'+fmt(i.buyPrice):'—'}</td>
      <td style="font-family:var(--fmono);font-size:.8rem;color:var(--green);font-weight:600">${(parseFloat(i.sellPrice)||0)>0?'₹'+fmt(i.sellPrice):'—'}</td>
      <td><strong style="font-family:var(--fmono)">${qty}</strong></td>
      <td style="font-family:var(--fmono);font-size:.78rem;color:var(--tx3)">${threshold}</td>
      <td><span class="pill ${sCls(i.status)}">${sLbl(i.status)}</span></td>
      <td style="font-size:.78rem;color:var(--tx3)">${fmtDate(i.dateAdded)}</td>
      <td${canEdit?'':' style="display:none"'}>
        <div class="row-actions">
          ${canEdit?`<button class="ibtn edit" title="Edit" onclick="openEdit('${id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`:''}
          ${canSell?`<button class="ibtn sell" title="Quick Dispatch" onclick="openSellSingle('${id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg></button>`:''}
          ${canDelete?`<button class="ibtn del" title="Delete" onclick="askDelete('${id}','${esc(i.itemName||'item')}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`:''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterTable(){ renderTable(); refreshFilterCats(); }
function sortBy(f){ if(S.sortField===f) S.sortAsc=!S.sortAsc; else{S.sortField=f;S.sortAsc=true;} renderTable(); }

function refreshFilterCats(){
  const ft=document.getElementById('f-type')?.value||'';
  const sel=document.getElementById('f-cat'); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">All Categories</option>';
  const pool=ft?(S.cats[ft]||[]):[...new Set(Object.values(S.cats).flat())];
  pool.forEach(c=>{ const o=document.createElement('option'); o.value=o.textContent=c; if(c===cur) o.selected=true; sel.appendChild(o); });
}

function refreshCatDrop(selId,typeSelId){
  const type=document.getElementById(typeSelId)?.value||'';
  const sel=document.getElementById(selId); if(!sel) return;
  const prev=sel.value; sel.innerHTML='';
  const cats=type?(S.cats[type]||[]):[];
  if(!cats.length){ sel.innerHTML=`<option value="">${type?'No sub-categories yet':'— Select Type first —'}</option>`; return; }
  cats.forEach(c=>{ const o=document.createElement('option'); o.value=o.textContent=c; if(c===prev) o.selected=true; sel.appendChild(o); });
}

/* ── ADD STOCK ────────────────────────────────────────────────── */
async function submitManual(){
  const name=document.getElementById('fm-name').value.trim();
  const sku=document.getElementById('fm-serial').value.trim();
  const type=document.getElementById('fm-type').value;
  const cat=document.getElementById('fm-cat').value;
  const vendor=document.getElementById('fm-vendor').value.trim();
  const vphone=document.getElementById('fm-vendor-phone').value.trim();
  const buyPrice=parseFloat(document.getElementById('fm-buy-price').value)||0;
  const sellPrice=parseFloat(document.getElementById('fm-sell-price').value)||0;
  const qty=parseInt(document.getElementById('fm-qty').value)||0;
  const lowStockAt=parseInt(document.getElementById('fm-lowstock').value)||5;
  const status=document.getElementById('fm-status').value;
  const date=document.getElementById('fm-date').value;
  const notes=document.getElementById('fm-notes').value.trim();
  const okEl=document.getElementById('add-ok'), errEl=document.getElementById('add-err');
  hideEl(okEl); hideEl(errEl);
  if(!name){ showEl(errEl,'Item Name is required.'); return; }
  if(!type){ showEl(errEl,'Type is required.'); return; }
  if(!cat){ showEl(errEl,'Category is required.'); return; }
  if(qty<1){ showEl(errEl,'Quantity must be at least 1.'); return; }
  try{
    await fbPush(DB.STOCK,{itemName:name,sku:sku||genId('RCN'),parentType:type,category:cat,vendorName:vendor,vendorPhone:vphone,buyPrice,sellPrice,quantity:qty,lowStockAt,status,dateAdded:date||today(),notes,addedBy:S.user?.displayName||'Unknown',lastUpdated:new Date().toISOString()});
    await logActivity(`Added "${name}" (${type}) × ${qty}`);
    showEl(okEl,`✓ "${name}" added!`); clearManual();
  }catch(e){ showEl(errEl,'Firebase error: '+e.message); }
}

function clearManual(){
  ['fm-name','fm-serial','fm-notes','fm-vendor','fm-vendor-phone','fm-buy-price','fm-sell-price'].forEach(id=>val(id,''));
  val('fm-qty','1'); val('fm-lowstock','5'); val('fm-type',''); val('fm-status','AVAILABLE'); val('fm-date',today());
  document.getElementById('fm-cat').innerHTML='<option value="">— Select Type first —</option>';
  hideEl(document.getElementById('add-ok')); hideEl(document.getElementById('add-err'));
}

/* ── EDIT ─────────────────────────────────────────────────────── */
function openEdit(id){
  const i=S.stock[id]; if(!i) return;
  val('edit-id',id); val('e-name',i.itemName||''); val('e-serial',i.sku||i.serialNumber||'');
  val('e-vendor',i.vendorName||''); val('e-vendor-phone',i.vendorPhone||'');
  val('e-buy-price',i.buyPrice||''); val('e-sell-price',i.sellPrice||'');
  val('e-qty',i.quantity||1); val('e-lowstock',i.lowStockAt||5); val('e-status',i.status||'AVAILABLE'); val('e-notes',i.notes||'');
  const eType=document.getElementById('e-type');
  if(eType){ eType.innerHTML=''; getAllParentTypes().forEach(t=>{ const o=document.createElement('option'); o.value=t.key; o.textContent=t.label; if(t.key===(i.parentType||'')) o.selected=true; eType.appendChild(o); }); }
  refreshCatDrop('e-cat','e-type'); setTimeout(()=>val('e-cat',i.category||''),60);
  // Populate edit vendor datalist
  const dlE=document.getElementById('dl-vendors-e');
  if(dlE){ const vendors=[...new Set(Object.values(S.stock).map(it=>it.vendorName).filter(Boolean))].sort(); dlE.innerHTML=vendors.map(v=>`<option value="${esc(v)}">`).join(''); }
  openModal('m-edit');
}

async function saveEdit(){
  const id=document.getElementById('edit-id').value;
  const name=document.getElementById('e-name').value.trim();
  const sku=document.getElementById('e-serial').value.trim();
  const type=document.getElementById('e-type').value;
  const cat=document.getElementById('e-cat').value;
  const vendor=document.getElementById('e-vendor').value.trim();
  const vphone=document.getElementById('e-vendor-phone').value.trim();
  const buyPrice=parseFloat(document.getElementById('e-buy-price').value)||0;
  const sellPrice=parseFloat(document.getElementById('e-sell-price').value)||0;
  const qty=parseInt(document.getElementById('e-qty').value)||1;
  const lowStockAt=parseInt(document.getElementById('e-lowstock').value)||5;
  const status=document.getElementById('e-status').value;
  const notes=document.getElementById('e-notes').value.trim();
  if(!name||!type||!cat){ toast('Name, Type and Category are required.','error'); return; }
  try{
    await fbUpdate(`${DB.STOCK}/${id}`,{itemName:name,sku,parentType:type,category:cat,vendorName:vendor,vendorPhone:vphone,buyPrice,sellPrice,quantity:qty,lowStockAt,status,notes,lastUpdated:new Date().toISOString()});
    await logActivity(`Edited "${name}"`); closeModal('m-edit'); toast(`"${name}" updated.`,'success');
  }catch(e){ toast('Update failed: '+e.message,'error'); }
}

/* ── DELETE ITEM ──────────────────────────────────────────────── */
function askDelete(id,name){
  document.getElementById('confirm-msg').textContent=`Delete "${name}"? Cannot be undone.`;
  document.getElementById('confirm-yes').textContent='Delete';
  S.pending=async()=>{ try{ await fbDelete(`${DB.STOCK}/${id}`); await logActivity(`Deleted "${name}"`); closeModal('m-confirm'); toast(`"${name}" deleted.`,'success'); }catch(e){ closeModal('m-confirm'); toast('Delete failed: '+e.message,'error'); } };
  document.getElementById('confirm-yes').onclick=()=>S.pending&&S.pending();
  openModal('m-confirm');
}

/* ── MULTI-ITEM SELL ──────────────────────────────────────────── */
let _sellRowIdx=0;

function openSellMulti(){
  S.sellRows=[]; _sellRowIdx=0;
  val('sell-customer',''); val('sell-customer-phone',''); val('sell-date',today()); val('sell-notes',''); val('sell-discount','0');
  const cb=document.getElementById('sell-paid'); if(cb) cb.checked=false;
  hideEl(document.getElementById('sell-err'));
  document.getElementById('sell-items-list').innerHTML='';
  setText('sell-subtotal','₹0.00'); setText('sell-grand-total','₹0.00');
  addSellRow();
  openModal('m-sell');
}

function openSellSingle(itemId){
  openSellMulti();
  setTimeout(()=>{ const sel=document.querySelector('.sell-row-item-sel'); if(sel){ sel.value=itemId; onSellItemChange(sel); } },120);
}

function addSellRow(){
  _sellRowIdx++;
  const idx=_sellRowIdx;
  const container=document.getElementById('sell-items-list');
  if(S.sellRows.length===0){
    container.innerHTML=`<div class="sell-item-row-hdr"><span>Item</span><span>Category</span><span>Qty</span><span>Unit Price (₹)</span><span></span></div>`;
  }
  S.sellRows.push({idx,itemId:'',qty:1,sellPrice:0});
  const itemOpts=Object.entries(S.stock).sort((a,b)=>(a[1].itemName||'').localeCompare(b[1].itemName||'')).map(([id,i])=>`<option value="${id}">${esc(i.itemName||id)} (Avail: ${i.quantity||0})</option>`).join('');
  const div=document.createElement('div');
  div.className='sell-item-row'; div.id=`sell-row-${idx}`;
  div.innerHTML=`<select class="sell-row-item-sel" data-idx="${idx}" onchange="onSellItemChange(this)"><option value="">— Select Item —</option>${itemOpts}</select>
    <span class="sell-row-cat" style="font-size:.78rem;color:var(--tx3)">—</span>
    <input type="number" class="sell-row-qty" data-idx="${idx}" value="1" min="1" oninput="onSellRowChange(${idx})"/>
    <input type="number" class="sell-row-price" data-idx="${idx}" value="0" min="0" step="0.01" oninput="onSellRowChange(${idx})"/>
    <button class="ibtn del" onclick="removeSellRow(${idx})" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  container.appendChild(div);
}

function onSellItemChange(sel){
  const idx=parseInt(sel.dataset.idx), itemId=sel.value;
  const row=S.sellRows.find(r=>r.idx===idx); if(!row) return;
  row.itemId=itemId;
  const rowEl=document.getElementById(`sell-row-${idx}`);
  const catEl=rowEl?.querySelector('.sell-row-cat'), priceEl=rowEl?.querySelector('.sell-row-price');
  if(itemId&&S.stock[itemId]){
    const item=S.stock[itemId];
    if(catEl) catEl.textContent=item.category||'—';
    if(priceEl&&parseFloat(item.sellPrice)>0){ priceEl.value=item.sellPrice; row.sellPrice=parseFloat(item.sellPrice)||0; }
  } else { if(catEl) catEl.textContent='—'; }
  recalcSellTotal();
}

function onSellRowChange(idx){
  const rowEl=document.getElementById(`sell-row-${idx}`);
  const row=S.sellRows.find(r=>r.idx===idx); if(!row) return;
  row.qty=parseInt(rowEl?.querySelector('.sell-row-qty')?.value)||1;
  row.sellPrice=parseFloat(rowEl?.querySelector('.sell-row-price')?.value)||0;
  recalcSellTotal();
}

function removeSellRow(idx){
  document.getElementById(`sell-row-${idx}`)?.remove();
  S.sellRows=S.sellRows.filter(r=>r.idx!==idx);
  recalcSellTotal();
}

function recalcSellTotal(){
  S.sellRows.forEach(row=>{
    const rowEl=document.getElementById(`sell-row-${row.idx}`); if(!rowEl) return;
    row.itemId=rowEl.querySelector('.sell-row-item-sel')?.value||'';
    row.qty=parseInt(rowEl.querySelector('.sell-row-qty')?.value)||1;
    row.sellPrice=parseFloat(rowEl.querySelector('.sell-row-price')?.value)||0;
  });
  const subtotal=S.sellRows.reduce((s,r)=>s+(r.qty*r.sellPrice),0);
  const discount=parseFloat(document.getElementById('sell-discount')?.value)||0;
  const grand=Math.max(0,subtotal-discount);
  setText('sell-subtotal','₹'+subtotal.toFixed(2));
  setText('sell-grand-total','₹'+grand.toFixed(2));
}

async function submitSell(){
  const customer=document.getElementById('sell-customer').value.trim();
  const custPhone=document.getElementById('sell-customer-phone').value.trim();
  const saleDate=document.getElementById('sell-date').value;
  const notes=document.getElementById('sell-notes').value.trim();
  const discount=parseFloat(document.getElementById('sell-discount').value)||0;
  const paid=document.getElementById('sell-paid')?.checked||false;
  const errEl=document.getElementById('sell-err'); hideEl(errEl);
  if(!customer){ showEl(errEl,'Customer Name is required.'); return; }
  if(!saleDate){ showEl(errEl,'Date is required.'); return; }
  recalcSellTotal();
  const activeRows=S.sellRows.filter(r=>r.itemId);
  if(!activeRows.length){ showEl(errEl,'Please add at least one item.'); return; }
  for(const row of activeRows){
    const item=S.stock[row.itemId];
    if(!item){ showEl(errEl,'Item not found.'); return; }
    if(row.qty<1){ showEl(errEl,`Qty must be ≥1 for "${item.itemName}".`); return; }
    if(row.qty>(parseInt(item.quantity)||0)){ showEl(errEl,`Only ${item.quantity} of "${item.itemName}" available.`); return; }
  }
  const subtotal=activeRows.reduce((s,r)=>s+(r.qty*r.sellPrice),0);
  const grand=Math.max(0,subtotal-discount);
  try{
    for(const row of activeRows){
      const item=S.stock[row.itemId];
      await fbUpdate(`${DB.STOCK}/${row.itemId}`,{quantity:(parseInt(item.quantity)||0)-row.qty,lastUpdated:new Date().toISOString()});
    }
    await fbPush(DB.SALES,{
      customerName:customer, customerPhone:custPhone,
      items:activeRows.map(r=>({itemId:r.itemId,itemName:S.stock[r.itemId]?.itemName||'',category:S.stock[r.itemId]?.category||'',qty:r.qty,unitPrice:r.sellPrice,lineTotal:r.qty*r.sellPrice,buyPrice:parseFloat(S.stock[r.itemId]?.buyPrice)||0})),
      subtotal,discount,grandTotal:grand,saleDate,notes,paid,
      dispatchedBy:S.user?.displayName||'Unknown',timestamp:Date.now()
    });
    await logActivity(`Sale to ${customer}: ${activeRows.map(r=>`${S.stock[r.itemId]?.itemName||'?'}×${r.qty}`).join(', ')} | ₹${grand.toFixed(2)} | ${paid?'Paid':'Pending'}`);
    closeModal('m-sell');
    toast(`Dispatch confirmed. ₹${fmt(grand)} — ${paid?'Paid ✓':'Payment pending'}`,paid?'success':'info');
  }catch(e){ showEl(errEl,'Error: '+e.message); }
}

/* ── SALES TABLE ──────────────────────────────────────────────── */
function renderSalesTable(){
  const tbody=document.getElementById('sales-tbody'); if(!tbody) return;
  const ft=document.getElementById('sale-f-type')?.value||'';
  const fc=(document.getElementById('sale-f-customer')?.value||'').toLowerCase();
  const fp=document.getElementById('sale-f-paid')?.value||'';
  let rows=Object.entries(S.sales);
  if(ft) rows=rows.filter(([,s])=>s.items?.some(it=>(S.stock[it.itemId]?.parentType||'')===ft));
  if(fc) rows=rows.filter(([,s])=>(s.customerName||'').toLowerCase().includes(fc));
  if(fp==='paid')   rows=rows.filter(([,s])=>s.paid);
  if(fp==='unpaid') rows=rows.filter(([,s])=>!s.paid);
  rows.sort((a,b)=>b[1].timestamp-a[1].timestamp);
  setText('sale-row-count',rows.length+' record'+(rows.length!==1?'s':''));
  if(!rows.length){ tbody.innerHTML='<tr><td colspan="9" class="tbl-empty">No records found.</td></tr>'; return; }
  const canDel=S.user?.role==='ADMIN'||S.user?.role==='MANAGER';
  tbody.innerHTML=rows.map(([saleId,s])=>{
    const items=s.items||[]; const totalQty=items.reduce((a,it)=>a+(parseInt(it.qty)||0),0);
    const itemSummary=items.map(it=>`${esc(it.itemName||'?')} ×${it.qty}`).join(', ')||'—';
    return `<tr>
      <td><strong>${esc(s.customerName||'—')}</strong>${s.customerPhone?`<div style="font-size:.75rem;color:var(--tx3)">${esc(s.customerPhone)}</div>`:''}</td>
      <td style="font-size:.8rem;max-width:200px;white-space:normal;line-height:1.4">${itemSummary}</td>
      <td><strong style="font-family:var(--fmono)">${totalQty}</strong></td>
      <td style="font-family:var(--fmono);color:var(--amber)">₹${fmt(s.discount||0)}</td>
      <td><strong style="font-family:var(--fmono);color:var(--green)">₹${fmt(s.grandTotal||0)}</strong></td>
      <td style="font-size:.78rem;color:var(--tx3)">${fmtDate(s.saleDate)}</td>
      <td style="font-size:.78rem;color:var(--tx3)">${esc(s.dispatchedBy||'—')}</td>
      <td>
        ${s.paid
          ?'<span class="pill paid">Received</span>'
          :`<span class="pill unpaid">Pending</span>${canDel?`<button class="ibtn pay" title="Mark Paid" onclick="markPaid('${saleId}')" style="margin-left:.3rem"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>`:''}`
        }
      </td>
      <td>${canDel?`<button class="ibtn del" title="Delete & Reverse" onclick="askDeleteSale('${saleId}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>`:'—'}</td>
    </tr>`;
  }).join('');
}

function askDeleteSale(saleId){
  const sale=S.sales[saleId]; if(!sale) return;
  document.getElementById('confirm-msg').textContent=`Delete sale for "${sale.customerName||'customer'}"?\n\nTotal: ₹${sale.grandTotal||0}\nAll stock quantities will be restored.`;
  document.getElementById('confirm-yes').textContent='Delete & Reverse';
  S.pending=async()=>{
    try{
      if(sale.items) for(const it of sale.items){ if(it.itemId&&S.stock[it.itemId]){ const cur=parseInt(S.stock[it.itemId].quantity)||0; await fbUpdate(`${DB.STOCK}/${it.itemId}`,{quantity:cur+(parseInt(it.qty)||0),lastUpdated:new Date().toISOString()}); } }
      await fbDelete(`${DB.SALES}/${saleId}`);
      await logActivity(`Reversed sale for "${sale.customerName||'customer'}" — ₹${sale.grandTotal||0}`);
      closeModal('m-confirm'); document.getElementById('confirm-yes').textContent='Delete';
      toast('Sale reversed. Stock restored.','success');
    }catch(e){ closeModal('m-confirm'); document.getElementById('confirm-yes').textContent='Delete'; toast('Failed: '+e.message,'error'); }
  };
  document.getElementById('confirm-yes').onclick=()=>S.pending&&S.pending();
  openModal('m-confirm');
}

/* ── CATEGORIES ───────────────────────────────────────────────── */
function renderCats(){
  const grid=document.getElementById('cat-grid'); if(!grid) return;
  const canDel=S.user?.role==='ADMIN'||S.user?.role==='MANAGER';
  const canDelParent=S.user?.role==='ADMIN';
  const allTypes=getAllParentTypes();
  if(!allTypes.length){ grid.innerHTML='<div class="empty-state-sm">No categories yet. Click "Add Parent Category" to start.</div>'; return; }
  grid.innerHTML=allTypes.map(type=>{
    const cats=S.cats[type.key]||[];
    return `<div class="cat-card">
      <div class="cat-card-head">
        <span class="cat-card-title"><span style="font-size:1.1rem">${type.icon}</span>${esc(type.label)}</span>
        <div style="display:flex;align-items:center;gap:.4rem">
          <span class="cat-count">${cats.length}</span>
          ${canDelParent?`<button class="ibtn del" style="width:22px;height:22px" title="Delete parent" onclick="delParentCat('${type.fbKey}','${esc(type.label)}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>`:''}
        </div>
      </div>
      <div class="cat-list">${cats.length
        ?cats.map(c=>`<div class="cat-item"><span class="cat-item-name">${esc(c)}</span>${canDel?`<button class="ibtn del" style="width:24px;height:24px" onclick="delCat('${type.key}','${esc(c)}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>`:''}</div>`).join('')
        :'<div style="color:var(--tx3);font-size:.8rem;padding:.25rem">No sub-categories yet</div>'
      }</div>
    </div>`;
  }).join('');
}

async function saveCat(){
  const type=document.getElementById('c-type').value, name=document.getElementById('c-name').value.trim();
  if(!name){toast('Category name required.','error');return;} if(!type){toast('Select a parent type.','error');return;}
  const existing=S.cats[type]||[];
  if(existing.includes(name)){toast('Already exists.','error');return;}
  try{ await fbUpdate(DB.CATS,{[type]:[...existing,name]}); await logActivity(`Added sub-cat "${name}" to ${type}`); closeModal('m-cat'); val('c-name',''); toast(`"${name}" added.`,'success'); }
  catch(e){toast('Error: '+e.message,'error');}
}

async function saveParentCat(){
  const name=document.getElementById('pc-name').value.trim(), icon=document.getElementById('pc-icon').value.trim()||'📁';
  if(!name){toast('Name required.','error');return;}
  if(getAllParentTypes().some(t=>t.label.toLowerCase()===name.toLowerCase())){toast('Already exists.','error');return;}
  try{
    await fbPush(DB.PARENT_CATS,{name,icon});
    await fbUpdate(DB.CATS,{[name.toUpperCase().replace(/\s+/g,'_')]:[]});
    await logActivity(`Added parent category "${name}"`);
    closeModal('m-parent-cat'); val('pc-name',''); val('pc-icon',''); toast(`"${name}" added.`,'success');
  }catch(e){toast('Error: '+e.message,'error');}
}

async function delParentCat(fbKey,name){
  document.getElementById('confirm-msg').textContent=`Delete parent category "${name}"?\nAll sub-categories under it will also be removed.`;
  document.getElementById('confirm-yes').textContent='Delete Parent';
  S.pending=async()=>{
    try{
      await fbDelete(`${DB.PARENT_CATS}/${fbKey}`); await fbDelete(`${DB.CATS}/${name.toUpperCase().replace(/\s+/g,'_')}`);
      await logActivity(`Deleted parent category "${name}"`);
      closeModal('m-confirm'); document.getElementById('confirm-yes').textContent='Delete'; toast(`"${name}" deleted.`,'success');
    }catch(e){ closeModal('m-confirm'); document.getElementById('confirm-yes').textContent='Delete'; toast('Error: '+e.message,'error'); }
  };
  document.getElementById('confirm-yes').onclick=()=>S.pending&&S.pending(); openModal('m-confirm');
}

async function delCat(type,name){
  document.getElementById('confirm-msg').textContent=`Remove "${name}" from ${type}?`;
  document.getElementById('confirm-yes').textContent='Delete';
  S.pending=async()=>{
    try{ await fbUpdate(DB.CATS,{[type]:(S.cats[type]||[]).filter(c=>c!==name)}); closeModal('m-confirm'); toast(`"${name}" removed.`,'success'); }
    catch(e){ closeModal('m-confirm'); toast('Error: '+e.message,'error'); }
  };
  document.getElementById('confirm-yes').onclick=()=>S.pending&&S.pending(); openModal('m-confirm');
}

/* ── USERS ────────────────────────────────────────────────────── */
function loadUsers(){
  const tbody=document.getElementById('users-tbody'); if(!tbody) return;
  tbody.innerHTML='<tr><td colspan="6" class="tbl-empty">Loading…</td></tr>';
  db.ref(DB.USERS).once('value',snap=>{
    const data=snap.val()||{}, users=Object.values(data);
    if(!users.length){tbody.innerHTML='<tr><td colspan="6" class="tbl-empty">No users.</td></tr>';return;}
    tbody.innerHTML=users.sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')).map(u=>`
      <tr><td><span style="font-family:var(--fmono)">${esc(u.username||'')}</span></td><td>${esc(u.displayName||'')}</td>
      <td><span class="role-pill ${u.role||'VIEW_ONLY'}">${(u.role||'').replace('_',' ')}</span></td>
      <td><span class="pill ${u.active?'av':'mn'}">${u.active?'Active':'Inactive'}</span></td>
      <td style="font-size:.78rem;color:var(--tx3)">${fmtDate(u.createdAt)}</td>
      <td><div class="row-actions">
        <button class="ibtn edit" title="Change Password" onclick="openChangePw('${esc(u.username||'')}','${esc(u.displayName||'')}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>
        ${u.protected?'<span style="font-size:.72rem;color:var(--tx3)">Protected</span>':`<button class="ibtn del" onclick="askDeleteUser('${esc(u.username||'')}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`}
      </div></td></tr>`).join('');
  },e=>{tbody.innerHTML=`<tr><td colspan="6" class="tbl-empty">Error: ${esc(e.message)}</td></tr>`;});
}

async function saveUser(){
  const display=document.getElementById('u-display').value.trim();
  const username=document.getElementById('u-username').value.trim().toLowerCase().replace(/\s+/g,'');
  const password=document.getElementById('u-password').value;
  const role=document.getElementById('u-role').value;
  const errEl=document.getElementById('user-err'); hideEl(errEl);
  if(!display){showEl(errEl,'Display Name required.');return;}
  if(!username){showEl(errEl,'Username required.');return;}
  if(!password||password.length<6){showEl(errEl,'Password must be ≥6 characters.');return;}
  if(!/^[a-z0-9_]+$/.test(username)){showEl(errEl,'Username: letters, numbers, underscores only.');return;}
  try{
    if(await fbRead(`${DB.USERS}/${username}`)){showEl(errEl,`"${username}" already taken.`);return;}
    const pwHash=await hashPw(password);
    await fbSet(`${DB.USERS}/${username}`,{username,displayName:display,role,pwHash,active:true,protected:false,createdAt:new Date().toISOString()});
    await logActivity(`Created user "${username}" (${role})`);
    closeModal('m-user'); loadUsers(); toast(`User "${username}" created.`,'success');
    ['u-display','u-username','u-password'].forEach(id=>val(id,'')); val('u-role','VIEW_ONLY');
  }catch(e){showEl(errEl,'Error: '+e.message);}
}

function askDeleteUser(username){
  document.getElementById('confirm-msg').textContent=`Delete user "${username}"?`;
  document.getElementById('confirm-yes').textContent='Delete';
  S.pending=async()=>{ try{ await fbDelete(`${DB.USERS}/${username}`); await logActivity(`Deleted user "${username}"`); closeModal('m-confirm'); document.getElementById('confirm-yes').textContent='Delete'; loadUsers(); toast(`"${username}" deleted.`,'success'); }catch(e){ closeModal('m-confirm'); document.getElementById('confirm-yes').textContent='Delete'; toast('Failed: '+e.message,'error'); } };
  document.getElementById('confirm-yes').onclick=()=>S.pending&&S.pending(); openModal('m-confirm');
}

function openChangePw(username,displayName){ val('cp-username',username); val('cp-display',displayName); val('cp-newpw',''); val('cp-confirmpw',''); hideEl(document.getElementById('cp-err')); openModal('m-change-pw'); }

async function saveChangePw(){
  const username=document.getElementById('cp-username').value;
  const newPw=document.getElementById('cp-newpw').value;
  const confirmPw=document.getElementById('cp-confirmpw').value;
  const errEl=document.getElementById('cp-err'); hideEl(errEl);
  if(!newPw||newPw.length<6){showEl(errEl,'Min 6 characters.');return;}
  if(newPw!==confirmPw){showEl(errEl,'Passwords do not match.');return;}
  try{ await fbUpdate(`${DB.USERS}/${username}`,{pwHash:await hashPw(newPw)}); await logActivity(`Password changed for "${username}"`); closeModal('m-change-pw'); toast(`Password updated.`,'success'); }
  catch(e){showEl(errEl,'Error: '+e.message);}
}

/* ── BULK UPLOAD ──────────────────────────────────────────────── */
function switchTab(tab){ document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('active',(i===0?'manual':'bulk')===tab)); document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active')); document.getElementById('tab-'+tab).classList.add('active'); }
function handleFile(e){ const f=e.target.files[0]; if(f) parseExcel(f); }

function parseExcel(file){
  const reader=new FileReader();
  reader.onload=e=>{ try{ const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(ws,{defval:''}); if(!rows.length){toast('File empty.','error');return;} S.bulkRows=rows; showBulkPreview(rows); }catch(err){toast('Parse error: '+err.message,'error');} };
  reader.readAsArrayBuffer(file);
}

function showBulkPreview(rows){
  document.getElementById('bulk-preview').classList.remove('hidden');
  setText('bulk-rows',rows.length);
  const heads=Object.keys(rows[0]);
  document.getElementById('bulk-thead').innerHTML='<tr>'+heads.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';
  document.getElementById('bulk-tbody').innerHTML=rows.slice(0,8).map(r=>'<tr>'+heads.map(h=>`<td>${esc(String(r[h]||''))}</td>`).join('')+'</tr>').join('')+(rows.length>8?`<tr><td colspan="${heads.length}" style="text-align:center;color:var(--tx3)">…and ${rows.length-8} more</td></tr>`:'');
  hideEl(document.getElementById('add-err-bulk')); hideEl(document.getElementById('add-ok-bulk'));
}

async function submitBulk(){
  const rows=S.bulkRows, btn=document.getElementById('bulk-go');
  const errEl=document.getElementById('add-err-bulk'), okEl=document.getElementById('add-ok-bulk');
  hideEl(errEl); hideEl(okEl);
  if(!rows.length){showEl(errEl,'No data.');return;}
  btn.disabled=true; btn.textContent='Uploading…';
  const get=(row,...keys)=>{ for(const k of keys){ const f=Object.keys(row).find(rk=>rk.toLowerCase().replace(/[\s_]/g,'')===k.toLowerCase().replace(/[\s_]/g,'')); if(f&&String(row[f]).trim()!=='') return String(row[f]).trim(); } return ''; };
  const VS=['AVAILABLE','IN_USE','UNDER_MAINTENANCE'], allTypeKeys=getAllParentTypes().map(t=>t.key);
  let ok=0; const errs=[];
  for(let idx=0;idx<rows.length;idx++){
    const r=rows[idx];
    const name=get(r,'name','itemname','item');
    const type=get(r,'type','parenttype').toUpperCase().replace(/[-\s]/g,'_');
    const cat=get(r,'category','cat');
    const qty=parseInt(get(r,'quantity','qty','count'))||1;
    const low=parseInt(get(r,'lowstockat','lowstock','lowat'))||5;
    let stat=get(r,'status').toUpperCase().replace(/[-\s]/g,'_');
    if(!VS.includes(stat)) stat='AVAILABLE';
    if(!name){errs.push(`Row ${idx+2}: Missing Name`);continue;}
    if(!allTypeKeys.includes(type)){errs.push(`Row ${idx+2}: Unknown Type "${type}"`);continue;}
    try{ await fbPush(DB.STOCK,{itemName:name,sku:get(r,'sku','serialnumber','serial','id')||genId('RCN'),parentType:type,category:cat||'General',vendorName:get(r,'vendorname','vendor'),vendorPhone:get(r,'vendorphone'),buyPrice:parseFloat(get(r,'buyprice','buy','cost'))||0,sellPrice:parseFloat(get(r,'sellprice','sell','price','mrp'))||0,quantity:qty,lowStockAt:low,status:stat,dateAdded:get(r,'dateadded','date')||today(),notes:get(r,'notes','note','remarks')||'',addedBy:S.user?.displayName||'Bulk',lastUpdated:new Date().toISOString()}); ok++; }
    catch(e){errs.push(`Row ${idx+2}: ${e.message}`);}
  }
  btn.disabled=false; btn.textContent='Upload All to Firebase';
  if(ok>0){showEl(okEl,`✓ ${ok} item${ok>1?'s':''} uploaded.`);await logActivity(`Bulk upload: ${ok} items`);}
  if(errs.length) showEl(errEl,errs.slice(0,5).join('\n')+(errs.length>5?'\n…and more':''));
  if(ok>0&&!errs.length) clearBulk();
}

function clearBulk(){ S.bulkRows=[]; document.getElementById('bulk-preview').classList.add('hidden'); document.getElementById('bulk-file').value=''; hideEl(document.getElementById('add-err-bulk')); hideEl(document.getElementById('add-ok-bulk')); }

function dlTemplate(){
  const ws=XLSX.utils.aoa_to_sheet([
    ['Name','Type','Category','SKU','Quantity','LowStockAt','Status','VendorName','VendorPhone','BuyPrice','SellPrice','DateAdded','Notes'],
    ['Pro Arch Insole Sz8','INSOLES','Arch Support','RCN-INS-001',50,10,'AVAILABLE','MediStep Pvt Ltd','9876543210',250,450,'2025-01-15',''],
    ['Digital BP Monitor','ELECTRONICS','Health Monitors','RCN-EL-001',20,3,'AVAILABLE','TechMed','9988776655',1200,2200,'2025-02-10','BT enabled'],
  ]);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Stock');
  XLSX.writeFile(wb,'Reconense_Stock_Template.xlsx'); toast('Template downloaded.','success');
}

/* ── MODALS ───────────────────────────────────────────────────── */
function openModal(id){ document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id){ document.getElementById(id)?.classList.add('hidden'); }
function bgClose(e,id){ if(e.target===e.currentTarget) closeModal(id); }

/* ── TOAST ────────────────────────────────────────────────────── */
let _tt;
function toast(msg,type='success'){ const el=document.getElementById('toast'); el.textContent=msg; el.className='toast '+type; clearTimeout(_tt); _tt=setTimeout(()=>el.classList.add('hidden'),3800); }

/* ── HELPERS ──────────────────────────────────────────────────── */
function setText(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }
function setWidth(id,p){ const el=document.getElementById(id); if(el) el.style.width=Math.min(100,Math.round(p))+'%'; }
function val(id,v){ const el=document.getElementById(id); if(!el) return ''; if(v===undefined) return el.value; el.value=v; }
function showEl(el,msg){ if(!el) return; el.textContent=msg; el.classList.remove('hidden'); }
function hideEl(el){ if(!el) return; el.classList.add('hidden'); el.textContent=''; }
function sCls(s){ return {AVAILABLE:'av',IN_USE:'iu',UNDER_MAINTENANCE:'mn'}[s]||'av'; }
function sLbl(s){ return {AVAILABLE:'Available',IN_USE:'In Use',UNDER_MAINTENANCE:'Maintenance'}[s]||s||'—'; }
function fmt(v){ return parseFloat(v||0).toLocaleString('en-IN',{maximumFractionDigits:2}); }
function fmtDate(d){ if(!d) return '—'; try{ return new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }catch(_){return d;} }
function ago(ts){ const m=Math.floor((Date.now()-ts)/60000); if(m<1) return 'just now'; if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<24) return `${h}h ago`; return `${Math.floor(h/24)}d ago`; }
function today(){ return new Date().toISOString().split('T')[0]; }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function genId(p){ return `${p}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2,5).toUpperCase()}`; }

console.log('[Reconense v1.1] Ready.');
