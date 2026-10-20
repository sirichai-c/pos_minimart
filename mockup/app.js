(function () {
  'use strict';
  const V = window.POSViews;
  const app = document.getElementById('app');
  const dialog = document.getElementById('app-dialog');
  const draftKey = 'baandee-pos-draft-v1';
  const dataKey = 'baandee-pos-demo-v1';
  const uuid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
  let store;
  try { store = POSData.createStore({storage:window.localStorage,key:dataKey}); }
  catch (error) {
    app.innerHTML='<div class="startup"><h1>ยังเปิดข้อมูลตัวอย่างไม่ได้</h1><p>กรุณาอนุญาตการจัดเก็บข้อมูลในเบราว์เซอร์ แล้วเปิดหน้านี้ใหม่</p><small>'+V.h(error.message)+'</small></div>';
    return;
  }
  const initialState=store.getState();
  let cart=[];
  let requestKey=null;
  try {
    const existing=window.localStorage.getItem(draftKey);
    if(existing){const draft=JSON.parse(existing);cart=Array.isArray(draft.items)?draft.items.filter(i=>initialState.products.some(p=>p.id===i.productId)&&Number.isInteger(i.quantity)&&i.quantity>0&&Number.isSafeInteger(i.unitPrice)&&i.unitPrice>=0):[];requestKey=draft.key||null;}
    else {cart=initialState.products.filter(p=>p.active&&p.stock>1).slice(0,2).map((p,i)=>({productId:p.id,quantity:i+1,unitPrice:p.price}));window.localStorage.setItem(draftKey,JSON.stringify({items:cart,key:null}));}
  } catch (_) {cart=[];requestKey=null;}
  let page='sales';
  let category='ทั้งหมด',query='',catalogPage=0,inventoryQuery='',historyQuery='',historyDate=V.dayKey(),historyStatus='all',reportDate=V.dayKey(),reportShift='';
  let scenario='none',busy=false,toastTimer=null,lastFocus=null;
  function getContext(){const state=store.getState();return{state,user:state.users.find(u=>u.id===state.currentUserId),store,cart,category,query,catalogPage,inventoryQuery,historyQuery,historyDate,historyStatus,reportDate,reportShift,scenario};}
  function render(){
    const focus=document.activeElement;
    const focusId=focus?.id;
    const focusData=focus&&app.contains(focus)&&!focusId?{tag:focus.tagName,href:focus.getAttribute('href'),dataset:{...focus.dataset}}:null;
    let selection=null;
    if(focusId&&focus instanceof HTMLInputElement){try{selection=[focus.selectionStart,focus.selectionEnd]}catch(_){}}
    const ctx=getContext();
    if(!ctx.user){throw new Error('ไม่พบผู้ใช้งานตัวอย่าง');}
    if(ctx.user.role!=='owner'&&['inventory','users','system'].includes(page)){page='sales';history.replaceState(null,'','#sales');}
    app.innerHTML=V.shell(page,ctx);
    document.getElementById('page-content').tabIndex=-1;
    document.title='บ้านดี POS · '+({sales:'ขายหน้าร้าน',inventory:'สินค้าและสต๊อก',history:'ประวัติการขาย',shifts:'กะและเงินสด',reports:'รายงานการขาย',users:'ผู้ใช้งาน',system:'ระบบและข้อมูล'}[page]);
    if(focusId){const next=document.getElementById(focusId);if(next){next.focus({preventScroll:true});if(selection&&selection[0]!=null){try{next.setSelectionRange(...selection)}catch(_){}}}}
    else if(focusData){
      const candidates=app.querySelectorAll(focusData.href?'a[href]':'[data-action]');
      const next=Array.from(candidates).find(el=>el.tagName===focusData.tag&&el.getAttribute('href')===focusData.href&&Object.entries(focusData.dataset).every(([key,value])=>el.dataset[key]===value));
      if(next)next.focus({preventScroll:true});
      else if(page==='sales')document.getElementById('product-search')?.focus({preventScroll:true});
    }
  }
  function toast(message,error=false){const region=document.getElementById('toast-region');clearTimeout(toastTimer);region.innerHTML=`<div class="toast ${error?'error':''}">${V.icon(error?'alert':'check')}<span>${V.h(message)}</span></div>`;toastTimer=setTimeout(()=>{region.innerHTML=''},4200);}
  function saveDraft(items,key=null){window.localStorage.setItem(draftKey,JSON.stringify({items,key}));cart=items;requestKey=key;}
  function cartTotal(){return cart.reduce((sum,i)=>sum+i.unitPrice*i.quantity,0);}
  function ensureCartEditable(){if(store.getPendingCheckout())throw new Error('กรุณาตรวจสอบผลรายการเดิมก่อนแก้ไขตะกร้า');}
  function addProduct(id){
    ensureCartEditable();const p=store.getState().products.find(p=>p.id===id);if(!p||!p.active)throw new Error('สินค้านี้ปิดจำหน่ายแล้ว');
    const items=cart.map(i=>({...i}));const item=items.find(i=>i.productId===id);
    if((item?.quantity||0)+1>p.stock)throw new Error(`สินค้า ${p.name} มีคงเหลือ ${p.stock} ชิ้น`);
    if(item)item.quantity++;else items.push({productId:id,quantity:1,unitPrice:p.price});
    saveDraft(items);render();
  }
  function showDialog(title,subtitle,body,footer='',form=''){
    if(!dialog.open)lastFocus=document.activeElement;
    if(dialog.open)dialog.close();
    const inner=`<div class="dialog-head"><div><h2 id="dialog-title">${V.h(title)}</h2>${subtitle?`<p>${V.h(subtitle)}</p>`:''}</div><button type="button" class="icon-button" data-action="dialog-close" aria-label="ปิดหน้าต่าง">${V.icon('close')}</button></div><div class="dialog-body"><div id="form-error" class="form-error" role="alert"></div>${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
    dialog.innerHTML=form?`<form data-form="${form}">${inner}</form>`:inner;
    dialog.showModal();
  }
  const cancelButton='<button type="button" class="button" data-action="dialog-close">ยกเลิก</button>';
  const submitButton=(label,symbol='check')=>`<button type="submit" class="button primary" id="dialog-submit">${V.icon(symbol)}${V.h(label)}</button>`;
  function closeDialog(){if(busy)return;dialog.close();if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});}
  function showError(error){const el=document.getElementById('form-error');if(el){el.textContent=error.message||String(error);el.scrollIntoView({block:'nearest'});}else toast(error.message||String(error),true);}
  function field(label,name,value='',type='text',extra='',full=false){return `<label class="field ${full?'full':''}"><span>${label}</span><input type="${type}" name="${name}" value="${V.h(value)}" ${extra}></label>`;}
  function openCheckout(){
    const state=store.getState();
    if(state.pendingCheckout){recover();return;}
    if(!V.shift(state)){openShift();return;}
    if(!cart.length){toast('เลือกสินค้าใส่ตะกร้าก่อนรับชำระเงิน',true);return;}
    const total=cartTotal();
    const amounts=[...new Set([total,Math.ceil(total/10000)*10000,50000,100000])].filter(n=>n>=total);
    showDialog('รับชำระเงิน','ตรวจสอบยอด รับเงินสด แล้วคืนเงินทอนให้ลูกค้า',`<div class="payment-method">${V.icon('cash')}เงินสด · ${cart.reduce((n,i)=>n+i.quantity,0)} ชิ้น</div><div class="payment-total"><span>ยอดที่ต้องชำระ</span><strong class="num">${V.money(total)}</strong></div><label class="field"><span>รับเงินจากลูกค้า</span><div class="cash-input"><input id="cash-tendered" name="tendered" type="number" min="0" step="0.01" placeholder="0.00" required inputmode="decimal" autocomplete="off" aria-label="เงินสดที่รับจากลูกค้า"><span>บาท</span></div></label><div class="cash-presets">${amounts.map((n,i)=>`<button type="button" data-action="cash-preset" data-amount="${n}">${i===0?'พอดี':V.money(n)}</button>`).join('')}</div><div class="change-preview"><span>เงินทอน</span><strong id="change-value" class="num">฿0.00</strong></div>`,cancelButton+submitButton('ยืนยันการขาย','check'),'checkout');
    document.getElementById('dialog-submit').disabled=true;
    document.getElementById('cash-tendered').focus();
  }
  function updateChange(){const input=document.getElementById('cash-tendered');if(!input)return;let amount=-1;try{amount=POSData.parseMoney(input.value)}catch(_){}const total=cartTotal();document.getElementById('change-value').textContent=V.money(Math.max(0,amount-total));document.getElementById('dialog-submit').disabled=busy||amount<total;}
  function receipt(id,success=false){
    const state=store.getState();const sale=state.sales.find(s=>s.id===id);if(!sale)throw new Error('ไม่พบบิลที่ต้องการ');
    const canVoid=getContext().user.role==='owner'&&!sale.voidedAt&&V.shift(state)?.id===sale.shiftId;
    const successHtml=success?`<div class="receipt-success"><span class="success-mark">${V.icon('check')}</span><h3>ขายสำเร็จแล้ว</h3><p>รับเงิน ${V.money(sale.tendered)} · ทอน ${V.money(sale.change)}</p></div>`:'';
    showDialog(success?'เรียบร้อย พร้อมบิลต่อไป':'รายละเอียดบิล',success?'บันทึกยอดขายและอัปเดตสต๊อกแล้ว':V.shortBill(sale),successHtml+V.receipt(sale,state),`${canVoid?`<button type="button" class="button danger" data-action="void" data-id="${V.h(sale.id)}">ยกเลิกบิล</button>`:''}<button type="button" class="button" data-action="print" data-id="${V.h(sale.id)}">${V.icon('printer')}พิมพ์ใบเสร็จ</button><button type="button" class="button primary" data-action="dialog-close">${success?'ขายบิลถัดไป':'ปิด'}</button>`);
  }
  function priceChanged(){
    const state=store.getState();const changed=cart.filter(i=>state.products.find(p=>p.id===i.productId)?.price!==i.unitPrice);
    showDialog('ราคาสินค้ามีการเปลี่ยนแปลง','ยังไม่มีการขาย กรุณาตรวจราคาใหม่ก่อนยืนยัน',`<div class="stat-list">${changed.map(i=>{const p=state.products.find(p=>p.id===i.productId);return `<div class="stat-line"><span>${V.h(p?.name||'สินค้า')}</span><strong>${V.money(i.unitPrice)} → ${V.money(p?.price||0)}</strong></div>`}).join('')}</div>`,cancelButton+'<button type="button" class="button primary" data-action="accept-prices">ใช้ราคาล่าสุด</button>');
  }
  function recover(){const sale=store.recoverCheckout();if(!sale){toast('ไม่พบรายการที่ต้องตรวจสอบ');render();return;}saveDraft([]);render();receipt(sale.id,true);toast('พบรายการขายเดิมแล้ว ไม่มีการขายซ้ำ');}
  function productForm(id){
    const p=store.getState().products.find(p=>p.id===id);
    showDialog(p?'แก้ไขสินค้า':'เพิ่มสินค้าใหม่',p?'การเปลี่ยนราคาจะไม่แก้ยอดในบิลที่ขายไปแล้ว':'ใส่ข้อมูลสินค้าเพื่อเตรียมขึ้นชั้นและเริ่มขาย',`<input type="hidden" name="id" value="${V.h(p?.id||'')}"><div class="form-grid">${field('ชื่อสินค้า','name',p?.name||'','text','required maxlength="100"',true)}${field('SKU','sku',p?.sku||'','text','required maxlength="40" placeholder="เช่น DRINK-001"')}${field('ราคาขาย (บาท)','price',p?POSData.money(p.price).replace(/,/g,''):'','number','required min="0" step="0.01" inputmode="decimal"')}${field('บาร์โค้ด <small>ไม่บังคับ</small>','barcode',p?.barcode||'','text','maxlength="40" inputmode="numeric"',true)}<label class="field"><span>หมวดหมู่</span><select name="category">${V.categories.slice(1).map(c=>`<option ${p?.category===c?'selected':''}>${c}</option>`).join('')}</select></label>${p?`<label class="field"><span>สถานะจำหน่าย</span><select name="active"><option value="true" ${p.active?'selected':''}>เปิดจำหน่าย</option><option value="false" ${!p.active?'selected':''}>ปิดจำหน่าย</option></select></label>`:field('คงเหลือตั้งต้น (ชิ้น)','stock','0','number','required min="0" step="1"')}</div>${p?'<div class="subtle-note">'+V.icon('info')+'หากต้องการเปลี่ยนยอดคงเหลือ ให้ใช้รับเข้า / ปรับสต๊อก เพื่อเก็บประวัติ</div>':''}`,cancelButton+submitButton('บันทึกสินค้า'),'product');
  }
  function stockForm(id){const p=store.getState().products.find(p=>p.id===id);if(!p)return;showDialog('รับเข้า / ปรับสต๊อก',p.name+` · คงเหลือ ${p.stock} ชิ้น`,`<input type="hidden" name="productId" value="${V.h(id)}"><div class="form-grid"><label class="field full"><span>ประเภทการเปลี่ยนยอด</span><select name="kind" id="stock-kind"><option value="receive">รับสินค้าเข้า</option><option value="count">ปรับเป็นยอดที่นับได้จริง</option></select></label>${field('จำนวน (ชิ้น)','quantity','','number','required min="0" step="1"',true)}<label class="field full"><span>เหตุผล / ที่มาของสินค้า</span><textarea name="reason" placeholder="เช่น รับสินค้าเข้าร้าน หรือปรับตามการนับจริง" required maxlength="300"></textarea></label></div><div class="subtle-note">${V.icon('info')}การปรับยอดนับจริงหมายถึงจำนวนทั้งหมดที่นับได้ ไม่ใช่จำนวนที่เพิ่มหรือลด</div>`,cancelButton+submitButton('บันทึกสต๊อก'),'stock');}
  function stockHistory(id){const state=store.getState();const p=state.products.find(p=>p.id===id);const moves=state.stockMovements.filter(m=>m.productId===id).slice().reverse();showDialog('ประวัติสต๊อก',`${p.name} · คงเหลือ ${p.stock} ชิ้น`,moves.length?`<div class="movement-list">${moves.map(m=>`<div class="movement-row">${V.icon(m.quantity>=0?'arrowDown':'arrowUp')}<div><strong>${V.h(m.reason||m.kind)}</strong><p>${V.date(m.createdAt,true)} · ${V.h(V.actor(state,m.userId))}</p></div><span class="num ${m.quantity>=0?'text-green':'text-amber'}">${m.quantity>0?'+':''}${m.quantity}<small class="muted" style="display:block;font-size:9px;margin-top:4px">คงเหลือ ${m.balance}</small></span></div>`).join('')}</div>`:V.empty('ยังไม่มีประวัติ','รายการรับเข้า ขาย และปรับยอดจะปรากฏที่นี่','box'),'<button type="button" class="button primary" data-action="dialog-close">ปิด</button>');}
  function openShift(){const current=V.shift(store.getState());if(current){toast('มีกะเปิดอยู่แล้ว');return;}showDialog('เปิดกะใหม่','นับเงินทอนตั้งต้นก่อนเริ่มขาย',`<div class="inline-info">หลังเปิดกะ รายการขายและเงินสดทั้งหมดจะถูกบันทึกอยู่ในกะนี้</div>${field('เงินทอนตั้งต้น (บาท)','opening','1000.00','number','required min="0" step="0.01" inputmode="decimal"')}`,cancelButton+submitButton('เปิดกะ','clock'),'open-shift');}
  function closeShift(){const state=store.getState();const current=V.shift(state);if(!current)throw new Error('ไม่มีกะที่เปิดอยู่');const s=store.shiftSummary(current.id);showDialog('นับเงินและปิดกะ','ปิดกะแล้วจะขายหรือยกเลิกบิลในกะนี้ต่อไม่ได้',`<div class="payment-total"><span>เงินสดที่ควรมี</span><strong>${V.money(s.expected)}</strong></div>${field('เงินสดที่นับได้จริง (บาท)','counted','','number','id="counted-cash" required min="0" step="0.01" inputmode="decimal"')}<div class="change-preview"><span>เงินเกิน / ขาด</span><strong id="cash-difference">—</strong></div><label class="checkbox-field"><input type="checkbox" name="confirmed" required><span>นับเงินครบแล้ว และยืนยันปิดกะนี้</span></label>`,cancelButton+submitButton('ยืนยันปิดกะ','lock'),'close-shift');}
  function cashMovement(kind){if(!V.shift(store.getState()))throw new Error('เปิดกะก่อนบันทึกเงินเข้า–ออก');showDialog(kind==='in'?'นำเงินเข้าลิ้นชัก':'นำเงินออกจากลิ้นชัก','รายการนี้จะเปลี่ยนยอดเงินสดในกะ แต่ไม่เปลี่ยนยอดขาย',`<input type="hidden" name="kind" value="${kind}"><div class="form-grid">${field('จำนวนเงิน (บาท)','amount','','number','required min="0.01" step="0.01" inputmode="decimal"',true)}<label class="field full"><span>เหตุผล</span><textarea name="reason" required maxlength="300" placeholder="เช่น เพิ่มเงินทอน หรือนำเงินเก็บเข้าตู้เซฟ"></textarea></label></div>`,cancelButton+submitButton('บันทึกรายการ','cash'),'cash');}
  function voidForm(id){const state=store.getState();const sale=state.sales.find(s=>s.id===id);if(!sale)return;showDialog('ยกเลิกทั้งบิล',`${V.shortBill(sale)} · ยอด ${V.money(sale.total)}`,`<input type="hidden" name="saleId" value="${V.h(id)}"><div class="inline-info">การยกเลิกจะคืนยอดสินค้าและกลับยอดเงินสดในข้อมูล กรุณาคืนเงินและตรวจสินค้าจริงให้ครบก่อนยืนยัน</div><label class="field"><span>เหตุผลที่ยกเลิกบิล</span><textarea name="reason" required maxlength="300" placeholder="ระบุเหตุผลให้ตรวจย้อนหลังได้"></textarea></label><label class="checkbox-field"><input type="checkbox" name="cashReturned" required><span>คืนเงินสดครบ ${V.money(sale.total)} ให้ลูกค้าแล้ว</span></label><label class="checkbox-field"><input type="checkbox" name="goodsReturned" required><span>ได้รับสินค้ากลับมาครบในสภาพจำหน่ายได้ หรือยังไม่ได้ส่งมอบสินค้า</span></label>`,cancelButton+'<button type="submit" class="button danger" id="dialog-submit">ยืนยันยกเลิกทั้งบิล</button>','void');}
  function userForm(id){const u=store.getState().users.find(u=>u.id===id);showDialog(u?'แก้ไขพนักงาน':'เพิ่มพนักงานขาย','พนักงานขายมีสิทธิ์เปิด–ปิดกะ ขายสินค้า และดูบิล',`<input type="hidden" name="id" value="${V.h(u?.id||'')}"><div class="form-grid">${field('ชื่อที่แสดง','name',u?.name||'','text','required maxlength="60"',true)}${field('ชื่อบัญชี','username',u?.username||'','text','required pattern="[A-Za-z0-9_.-]+" maxlength="40" placeholder="เช่น cashier02"',true)}<label class="field full"><span>สถานะบัญชี</span><select name="active"><option value="true" ${!u||u.active?'selected':''}>เปิดใช้งาน</option><option value="false" ${u&&!u.active?'selected':''}>ปิดบัญชี</option></select></label></div><div class="subtle-note">${V.icon('info')}บัญชีใน mockup ใช้สลับบทบาทสำหรับทดลอง ไม่มีการเก็บรหัสผ่านจริง</div>`,cancelButton+submitButton('บันทึกพนักงาน'),'user');}
  function profile(){const state=store.getState();if(state.pendingCheckout)throw new Error('ตรวจสอบรายการที่ยังไม่ทราบผลก่อนเปลี่ยนผู้ใช้งาน');showDialog('เลือกผู้ใช้งานตัวอย่าง','ลองมุมมองเจ้าของร้านและพนักงานขาย',`<div class="role-selection">${state.users.filter(u=>u.active).map(u=>`<button type="button" class="role-option ${u.id===state.currentUserId?'active':''}" data-action="switch-user" data-id="${V.h(u.id)}"><span class="avatar">${V.h(u.name.slice(0,1))}</span><span class="role-text"><strong>${V.h(u.name)}</strong><small>${u.role==='owner'?'เจ้าของร้าน · จัดการได้ทุกส่วน':'พนักงานขาย · ขายสินค้าและจัดการกะ'}</small></span>${u.id===state.currentUserId?V.icon('check'):V.icon('chevronRight')}</button>`).join('')}</div>`);}
  function confirmDialog(title,subtitle,action,label='ยืนยัน'){showDialog(title,'',`<p class="dialog-subtext">${V.h(subtitle)}</p>`,cancelButton+`<button type="button" class="button primary" data-action="${action}">${V.h(label)}</button>`);}
  function download(filename,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportReport(){
    const state=store.getState();
    const events=V.reportEvents(state,reportDate,reportShift);
    const cell=v=>{const value=String(v);return '"'+(/^-?\d+(?:\.\d+)?$/.test(value)?value:value.replace(/^[=+\-@]/,"'$&")).replace(/"/g,'""')+'"';};
    const rows=[['เลขบิล','เวลา','ผู้ทำรายการ','รายการ','ยอดบาท'],...events.map(e=>[e.sale.receiptNo,V.date(e.createdAt,true),V.actor(state,e.userId),e.kind==='void'?'ยกเลิกบิล':'ขาย',(e.kind==='void'?'-':'')+POSData.money(e.sale.total)])];
    download(`baandee-report-${reportShift||reportDate}.csv`,'\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
    toast('ส่งออกรายงานแล้ว');
  }
  const actions={
    menu:()=>app.querySelector('.app-shell').classList.toggle('menu-open'),
    'focus-search':()=>{document.getElementById('product-search').focus();toast('พร้อมรับรหัสจากเครื่องสแกนแบบคีย์บอร์ด');},
    add:el=>addProduct(el.dataset.id),
    quantity:el=>{ensureCartEditable();const id=el.dataset.id;const delta=Number(el.dataset.delta);const items=cart.map(i=>({...i}));const item=items.find(i=>i.productId===id);if(!item)return;const p=store.getState().products.find(p=>p.id===id);if(item.quantity+delta>p.stock)throw new Error(`สินค้ามีคงเหลือ ${p.stock} ชิ้น`);item.quantity+=delta;saveDraft(items.filter(i=>i.quantity>0));render();},
    remove:el=>{ensureCartEditable();saveDraft(cart.filter(i=>i.productId!==el.dataset.id));render();},
    category:el=>{category=el.dataset.category;catalogPage=0;render();},
    'catalog-page':el=>{catalogPage=Math.max(0,catalogPage+Number(el.dataset.delta));render();},
    'clear-cart':()=>{ensureCartEditable();if(cart.length)confirmDialog('ล้างตะกร้า?','นำสินค้าในบิลที่ยังไม่ชำระออกจากตะกร้าทั้งหมด','confirm-clear','ล้างตะกร้า');},
    'confirm-clear':()=>{saveDraft([]);closeDialog();render();},
    checkout:openCheckout,recover,
    'cash-preset':el=>{const input=document.getElementById('cash-tendered');input.value=(Number(el.dataset.amount)/100).toFixed(2);updateChange();input.focus();},
    'accept-prices':()=>{const state=store.getState();saveDraft(cart.map(i=>({...i,unitPrice:state.products.find(p=>p.id===i.productId)?.price??i.unitPrice})));render();openCheckout();},
    'new-product':()=>productForm(), 'edit-product':el=>productForm(el.dataset.id), stock:el=>stockForm(el.dataset.id), 'stock-history':el=>stockHistory(el.dataset.id),
    receipt:el=>receipt(el.dataset.id),void:el=>voidForm(el.dataset.id),
    print:el=>{const state=store.getState();const sale=state.sales.find(s=>s.id===el.dataset.id);if(!sale)return;document.getElementById('print-area').innerHTML=V.receipt(sale,state);window.print();},
    'history-all':()=>{historyDate='';render();},
    'open-shift':openShift,'close-shift':closeShift,'cash-movement':el=>cashMovement(el.dataset.kind),
    'new-user':()=>userForm(),'edit-user':el=>userForm(el.dataset.id),profile,
    'switch-user':el=>{store.setUser(el.dataset.id);closeDialog();render();toast('เปลี่ยนผู้ใช้งานแล้ว');},
    network:()=>{const next=!store.getState().online;store.setOnline(next);render();toast(next?'เชื่อมต่ออินเทอร์เน็ตแล้ว':'ออฟไลน์: ยังขายเงินสดและพิมพ์ใบเสร็จได้');},
    backup:()=>{store.recordBackup({cloud:store.getState().online},getContext().user.id);render();toast(store.getState().online?'จำลองสำรองและส่งข้อมูลสำเร็จ':'จำลองสร้างสำเนาแล้ว รอส่งเมื่อออนไลน์');},
    'export-data':()=>{download(`baandee-demo-${V.dayKey()}.json`,JSON.stringify(store.getState(),null,2),'application/json');toast('ส่งออกข้อมูลตัวอย่างแล้ว');},
    'restore-info':()=>showDialog('การกู้คืนข้อมูล','ขั้นตอนสำหรับเจ้าของร้านและผู้ดูแล',`<div class="dialog-subtext"><p>ในระบบจริงต้องหยุดขายและเข้าสู่ <strong>โหมดบำรุงรักษา</strong> ก่อนกู้คืน</p><ol><li>เก็บสำเนาข้อมูลเดิม และเลือก backup ที่ตรวจสอบได้</li><li>ตรวจ checksum และเวอร์ชันข้อมูล แล้วกู้ลงตำแหน่งสะอาด</li><li>ตรวจจำนวนบิล ยอดเงิน กะ และข้อมูลล่าสุดให้ตรงกับจุดสำรอง</li><li>ล็อกอินใหม่ กระทบยอดเงินจริง แล้วจึงกลับมาขาย</li></ol><p>mockup นี้ไม่มีฐานข้อมูล SQLite หรือการกู้คืนข้อมูลร้านจริง ปุ่มส่งออกเก็บเฉพาะข้อมูลตัวอย่างจากเบราว์เซอร์</p></div>`,'<button type="button" class="button primary" data-action="dialog-close">เข้าใจแล้ว</button>'),
    'reset-demo':()=>confirmDialog('เริ่มข้อมูลตัวอย่างใหม่?','รายการที่คุณลองขาย ปรับสต๊อก และจัดการกะใน mockup จะถูกแทนที่ด้วยข้อมูลเริ่มต้น','confirm-reset','เริ่มใหม่'),
    'confirm-reset':()=>{store.reset();saveDraft([]);scenario='none';category='ทั้งหมด';query='';catalogPage=0;reportShift='';closeDialog();render();toast('เริ่มข้อมูลตัวอย่างใหม่แล้ว');},
    'export-report':exportReport,
    'dialog-close':closeDialog
  };
  document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(!el||el.disabled)return;const handler=actions[el.dataset.action];if(!handler)return;event.preventDefault();try{handler(el)}catch(error){if(dialog.open)showError(error);else toast(error.message,true);}});
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='product-search'){query=el.value;catalogPage=0;render();}
    else if(el.id==='inventory-search'){inventoryQuery=el.value;render();}
    else if(el.id==='history-search'){historyQuery=el.value;render();}
    else if(el.id==='cash-tendered')updateChange();
    else if(el.id==='counted-cash'){let value;try{value=POSData.parseMoney(el.value)}catch(_){value=null}const current=V.shift(store.getState());const diff=value===null?null:value-store.shiftSummary(current.id).expected;const output=document.getElementById('cash-difference');output.textContent=diff===null?'—':(diff>0?'+':'')+V.money(diff);output.className=diff<0?'text-red':diff>0?'text-amber':'text-green';}
  });
  document.addEventListener('change',event=>{const el=event.target;if(el.id==='history-date'){historyDate=el.value;render();}else if(el.id==='history-status'){historyStatus=el.value;render();}else if(el.id==='report-date'){if(!el.value){el.value=reportDate;toast('กรุณาเลือกวันที่สำหรับรายงาน',true);return;}reportDate=el.value;reportShift='';render();}else if(el.id==='report-shift'){reportShift=el.value;render();}else if(el.id==='checkout-scenario'){scenario=el.value;toast('ตั้งค่าสถานการณ์ตัวอย่างแล้ว');}});
  document.addEventListener('keydown',event=>{
    if(event.key==='F2'&&!dialog.open){event.preventDefault();if(page!=='sales'){location.hash='sales';setTimeout(()=>document.getElementById('product-search')?.focus(),0)}else document.getElementById('product-search')?.focus();}
    if(event.key==='F8'&&!dialog.open){event.preventDefault();try{openCheckout()}catch(error){toast(error.message,true)}}
    if(event.key==='Enter'&&event.target.id==='product-search'){event.preventDefault();const state=store.getState();const code=query.trim();const p=state.products.find(p=>p.active&&(p.barcode===code||p.sku.toLowerCase()===code.toLowerCase()));if(p){try{addProduct(p.id);query='';render();document.getElementById('product-search').focus()}catch(error){toast(error.message,true)}}else toast('ไม่พบบาร์โค้ดหรือ SKU นี้',true);}
  });
  dialog.addEventListener('cancel',event=>{if(busy){event.preventDefault();toast('กำลังบันทึกรายการ กรุณารอสักครู่');}});
  dialog.addEventListener('click',event=>{if(event.target!==dialog||busy)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();});
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.dataset.form)return;event.preventDefault();if(busy)return;
    const data=new FormData(form);const value=name=>String(data.get(name)||'');const state=store.getState();const user=state.users.find(u=>u.id===state.currentUserId);
    const errorBox=document.getElementById('form-error');if(errorBox)errorBox.textContent='';
    try{
      switch(form.dataset.form){
        case 'checkout':{
          const tendered=POSData.parseMoney(value('tendered'));if(tendered<cartTotal())throw new Error('เงินที่รับต้องไม่น้อยกว่ายอดชำระ');
          const key=requestKey||uuid();saveDraft(cart,key);busy=true;
          const button=document.getElementById('dialog-submit');button.disabled=true;button.innerHTML='<span class="loading-spinner"></span>กำลังบันทึก…';
          await new Promise(resolve=>setTimeout(resolve,350));
          const mode=scenario;scenario='none';
          const result=store.checkout({key,userId:user.id,items:cart.map(i=>({...i})),tendered,simulate:mode});
          busy=false;
          if(result.unresolved){closeDialog();render();showDialog('ยังไม่ทราบผลยืนยัน','กรุณาตรวจสอบรายการเดิมก่อนเริ่มขายใหม่',`<div class="inline-info">${V.icon('info')} ระบบยังไม่ได้รับผลยืนยันรายการนี้ คุณสามารถตรวจสอบบิลเดิมได้โดยไม่ทำรายการขายซ้ำ</div>`,'<button type="button" class="button primary" data-action="recover">ตรวจสอบรายการเดิม</button>');}
          else{saveDraft([]);closeDialog();render();receipt(result.sale.id,true);}
          return;
        }
        case 'product':{
          const id=value('id');const previous=state.products.find(p=>p.id===id);
          const cat=value('category');const defaultImage={'เครื่องดื่ม':'water','อาหารแห้ง':'noodles','ขนมและเบเกอรี่':'snack','ของใช้':'soap','วัตถุดิบ':'rice'}[cat]||'rice';
          const product={name:value('name'),sku:value('sku'),barcode:value('barcode'),price:POSData.parseMoney(value('price')),category:cat,image:previous?.image||defaultImage,active:value('active')!=='false'};
          if(id)product.id=id;else product.stock=Number(value('stock'));
          store.saveProduct(product,user.id);closeDialog();render();toast('บันทึกสินค้าแล้ว');break;
        }
        case 'stock':store.adjustStock({key:uuid(),productId:value('productId'),kind:value('kind'),quantity:Number(value('quantity')),reason:value('reason'),userId:user.id});closeDialog();render();toast('บันทึกสต๊อกและประวัติแล้ว');break;
        case 'open-shift':store.openShift({key:uuid(),opening:POSData.parseMoney(value('opening')),userId:user.id});closeDialog();render();toast('เปิดกะแล้ว พร้อมเริ่มขาย');break;
        case 'close-shift':{const closed=store.closeShift({key:uuid(),counted:POSData.parseMoney(value('counted')),userId:user.id});closeDialog();render();toast('ปิดกะและบันทึกยอดนับจริงแล้ว');break;}
        case 'cash':store.addCashMovement({key:uuid(),kind:value('kind'),amount:POSData.parseMoney(value('amount')),reason:value('reason'),userId:user.id});closeDialog();render();toast('บันทึกเงิน'+(value('kind')==='in'?'นำเข้า':'นำออก')+'แล้ว');break;
        case 'void':{const id=value('saleId');store.voidSale({key:uuid(),saleId:id,reason:value('reason'),cashReturned:data.has('cashReturned'),goodsReturned:data.has('goodsReturned'),userId:user.id});closeDialog();render();receipt(id);toast('ยกเลิกบิลและคืนยอดสินค้าแล้ว');break;}
        case 'user':{const id=value('id');store.saveUser({...(id?{id}:{}),name:value('name'),username:value('username'),role:'cashier',active:value('active')==='true'},user.id);closeDialog();render();toast('บันทึกพนักงานแล้ว');break;}
      }
    }catch(error){busy=false;if(error.code==='PRICE_CHANGED'){priceChanged();return;}showError(error);const button=document.getElementById('dialog-submit');if(button&&form.dataset.form==='checkout'){button.disabled=false;button.innerHTML=V.icon('check')+'ยืนยันการขาย';updateChange();}}
  });
  document.querySelector('.skip-link')?.addEventListener('click',event=>{event.preventDefault();document.getElementById('page-content')?.focus({preventScroll:false});});
  function navigate(){const next=location.hash.slice(1);if(next==='page-content'){document.getElementById('page-content')?.focus();return;}page=Object.hasOwn(V.pages,next)?next:'sales';render();window.scrollTo({top:0});}
  window.addEventListener('hashchange',navigate);
  window.addEventListener('storage',event=>{if(event.key===dataKey)toast('ข้อมูลเปลี่ยนจากอีกแท็บ กรุณารีเฟรชก่อนทำรายการต่อ',true);});
  navigate();
  window.BaanPOS={store,getCart:()=>cart.map(i=>({...i})),getPage:()=>page};
})();
