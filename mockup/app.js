(function () {
  'use strict';
  const V = window.POSViews;
  const app = document.getElementById('app');
  const dialog = document.getElementById('app-dialog');
  const draftKey = 'baandee-pos-draft-v1';
  const returnDraftKey = 'baandee-pos-return-draft-v1';
  const goodsReceiptDraftKey = 'baandee-pos-goods-receipt-draft-v1';
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
  let category='ทั้งหมด',query='',catalogPage=0,inventoryQuery='',historyQuery='',historyDate=V.dayKey(),historyStatus='all',reportDate=V.dayKey(),reportShift='',returnQuery='',purchasingQuery='',purchasingSupplier='',purchasingProduct='',purchasingDate=V.dayKey();
  let returnDraft=null;
  try { returnDraft=JSON.parse(window.localStorage.getItem(returnDraftKey)||'null'); } catch (_) { returnDraft=null; }
  let goodsReceiptDraft=null;
  try { goodsReceiptDraft=JSON.parse(window.localStorage.getItem(goodsReceiptDraftKey)||'null'); } catch (_) { goodsReceiptDraft=null; }
  let poLineIndex=0;
  let scenario='none',busy=false,toastTimer=null,lastFocus=null;
  function getContext(){const state=store.getState();return{state,user:state.users.find(u=>u.id===state.currentUserId),store,cart,category,query,catalogPage,inventoryQuery,historyQuery,historyDate,historyStatus,reportDate,reportShift,returnQuery,returnDraft,purchasingQuery,purchasingSupplier,purchasingProduct,purchasingDate,scenario};}
  function render(){
    const focus=document.activeElement;
    const focusId=focus?.id;
    const focusData=focus&&app.contains(focus)&&!focusId?{tag:focus.tagName,href:focus.getAttribute('href'),dataset:{...focus.dataset}}:null;
    let selection=null;
    if(focusId&&focus instanceof HTMLInputElement){try{selection=[focus.selectionStart,focus.selectionEnd]}catch(_){}}
    const ctx=getContext();
    if(!ctx.user){throw new Error('ไม่พบผู้ใช้งานตัวอย่าง');}
    if(ctx.user.role!=='owner'&&['inventory','returns','gross-profit','purchasing','members','users','system'].includes(page)){page='sales';history.replaceState(null,'','#sales');}
    app.innerHTML=V.shell(page,ctx);
    document.getElementById('page-content').tabIndex=-1;
    document.title='บ้านดี POS · '+({'stock-count':'ตรวจนับสต๊อก','gross-profit':'กำไรขั้นต้น',orders:'ออเดอร์และจองสินค้า',members:'สมาชิกและแต้ม',sales:'ขายหน้าร้าน',inventory:'สินค้าและสต๊อก',history:'ประวัติการขาย',returns:'คืนสินค้า',shifts:'กะและเงินสด',reports:'รายงานการขาย',purchasing:'จัดซื้อและรับสินค้า',users:'ผู้ใช้งาน',system:'ระบบและข้อมูล'}[page]);
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
  function saveReturnDraft(payload) {
    const previous=returnDraft;
    const comparable=value=>JSON.stringify({userId:value.userId,saleId:value.saleId,lines:value.lines,reason:value.reason,cashPaidConfirmed:value.cashPaidConfirmed});
    const next={...payload,key:previous&&comparable(previous)===comparable(payload)?previous.key:uuid()};
    window.localStorage.setItem(returnDraftKey,JSON.stringify(next));
    returnDraft=next;
    return next;
  }
  function clearReturnDraft(){window.localStorage.removeItem(returnDraftKey);returnDraft=null;}
  function saveGoodsReceiptDraft(payload) {
    const comparable=value=>JSON.stringify({userId:value.userId,poId:value.poId,deliveryRef:value.deliveryRef,lines:value.lines});
    const previous=goodsReceiptDraft;
    const next={...payload,key:previous&&comparable(previous)===comparable(payload)?previous.key:uuid()};
    window.localStorage.setItem(goodsReceiptDraftKey,JSON.stringify(next));
    goodsReceiptDraft=next;
    return next;
  }
  function clearGoodsReceiptDraft(){window.localStorage.removeItem(goodsReceiptDraftKey);goodsReceiptDraft=null;}
  function cartTotal(){return cart.reduce((sum,i)=>sum+i.unitPrice*i.quantity,0);}
  function ensureCartEditable(){if(store.getPendingCheckout())throw new Error('กรุณาตรวจสอบผลรายการเดิมก่อนแก้ไขตะกร้า');}
  function addProduct(id){
    ensureCartEditable();const p=store.getState().products.find(p=>p.id===id);if(!p||!p.active)throw new Error('สินค้านี้ปิดจำหน่ายแล้ว');
    const items=cart.map(i=>({...i}));const item=items.find(i=>i.productId===id);
    const available=store.availableToSell(id);if((item?.quantity||0)+1>available)throw new Error(`สินค้า ${p.name} ขายได้ ${available} ชิ้น`);
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
    showDialog('รับชำระเงิน','ตรวจสอบยอด รับเงินสด แล้วคืนเงินทอนให้ลูกค้า',`<div class="payment-method">${V.icon('cash')}เงินสด · ${cart.reduce((n,i)=>n+i.quantity,0)} ชิ้น</div><div class="payment-total"><span>ยอดสินค้าก่อนลด</span><strong class="num">${V.money(total)}</strong></div><label class="field"><span>เบอร์สมาชิก (ไม่บังคับ)</span><input id="checkout-member-phone" name="memberPhone" type="tel" autocomplete="off" placeholder="ค้นด้วยเบอร์โทร"></label><input type="hidden" name="memberId" id="checkout-member-id"><p id="checkout-member-result" class="muted">ไม่ผูกสมาชิก</p>${field('ใช้แต้ม (1 แต้ม = 1 สตางค์)','redeemPoints','0','number','min="0" step="1" inputmode="numeric"')}<div class="stat-line"><span>ส่วนลดแต้ม</span><strong id="checkout-discount">${V.money(0)}</strong></div><div class="payment-total"><span>เงินสดที่ต้องชำระ</span><strong class="num" id="checkout-due">${V.money(total)}</strong></div><p id="checkout-earned" class="muted">ไม่สะสมแต้ม</p><label class="field"><span>รับเงินจากลูกค้า</span><div class="cash-input"><input id="cash-tendered" name="tendered" type="number" min="0" step="0.01" placeholder="0.00" required inputmode="decimal" autocomplete="off" aria-label="เงินสดที่รับจากลูกค้า"><span>บาท</span></div></label><div class="cash-presets">${amounts.map((n,i)=>`<button type="button" data-action="cash-preset" data-amount="${n}">${i===0?'พอดี':V.money(n)}</button>`).join('')}</div><div class="change-preview"><span>เงินทอน</span><strong id="change-value" class="num">฿0.00</strong></div>`,cancelButton+submitButton('ยืนยันการขาย','check'),'checkout');
    document.getElementById('dialog-submit').disabled=true;
    document.getElementById('cash-tendered').focus();
  }
  function updateChange(){const input=document.getElementById('cash-tendered');if(!input)return;let amount=-1;try{amount=POSData.parseMoney(input.value)}catch(_){}
    const phone=document.getElementById('checkout-member-phone').value.trim(),memberInput=document.getElementById('checkout-member-id'),result=document.getElementById('checkout-member-result');
    let member=null;if(phone){try{member=store.lookupMember({phone,userId:store.getState().currentUserId});}catch(_){} }
    memberInput.value=member?.active?member.id:'';result.textContent=!phone?'ไม่ผูกสมาชิก':member?.active?`${member.name} · ${member.phoneMasked} · มี ${member.balance} แต้ม`:'ไม่พบสมาชิกที่ใช้งานได้';
    const raw=document.querySelector('form[data-form="checkout"] [name="redeemPoints"]').value,redeem=raw===''?0:Number(raw),gross=cartTotal();
    const valid=Number.isSafeInteger(redeem)&&redeem>=0&&redeem<=gross&&(!redeem||!!memberInput.value&&member.balance>=redeem);
    const due=gross-(valid?redeem:0);
    document.getElementById('checkout-discount').textContent=V.money(valid?redeem:0);document.getElementById('checkout-due').textContent=V.money(due);
    document.getElementById('checkout-earned').textContent=memberInput.value?`จะได้ ${Math.floor(due/100)} แต้ม`:'ไม่สะสมแต้ม';
    document.getElementById('change-value').textContent=V.money(Math.max(0,amount-due));document.getElementById('dialog-submit').disabled=busy||!valid||!!phone&&!memberInput.value||amount<due;
  }
  function receipt(id,success=false){
    const state=store.getState();const sale=state.sales.find(s=>s.id===id);if(!sale)throw new Error('ไม่พบบิลที่ต้องการ');
    const info=store.getReturnable(sale.id);
    const canVoid=getContext().user.role==='owner'&&!sale.voidedAt&&!info.returns.length&&V.shift(state)?.id===sale.shiftId;
    const canReturn=getContext().user.role==='owner'&&!sale.voidedAt&&info.status!=='full'&&!!V.shift(state)&&!state.pendingReturn;
    const successHtml=success?`<div class="receipt-success"><span class="success-mark">${V.icon('check')}</span><h3>ขายสำเร็จแล้ว</h3><p>รับเงิน ${V.money(sale.tendered)} · ทอน ${V.money(sale.change)}</p></div>`:'';
    showDialog(success?'เรียบร้อย พร้อมบิลต่อไป':'รายละเอียดบิล',success?'บันทึกยอดขายและอัปเดตสต๊อกแล้ว':V.shortBill(sale),successHtml+V.receipt(sale,state)+`<div class="return-recap"><strong>สถานะคืน: ${info.status==='full'?'คืนครบ':info.status==='partial'?'คืนบางส่วน':'ยังไม่คืน'}</strong><span>คืนแล้ว ${V.money(info.refunded)}</span>${info.returns.map(r=>`<button type="button" class="plain-button" data-action="return-document" data-id="${V.h(r.id)}">${V.h(r.returnNo)}</button>`).join('')}</div>`,`${canVoid?`<button type="button" class="button danger" data-action="void" data-id="${V.h(sale.id)}">ยกเลิกบิล</button>`:''}${canReturn?`<button type="button" class="button" data-action="return-open" data-id="${V.h(sale.id)}">รับคืนสินค้า</button>`:''}<button type="button" class="button" data-action="print" data-id="${V.h(sale.id)}">${V.icon('printer')}พิมพ์ใบเสร็จ</button><button type="button" class="button primary" data-action="dialog-close">${success?'ขายบิลถัดไป':'ปิด'}</button>`);
  }
  function returnPayload(form) {
    const data=new FormData(form);
    const saleId=String(data.get('saleId')||'');
    const source=store.getReturnable(saleId);
    const lines=source.lines.map((line,index)=>({saleLineId:line.id,quantity:Number(data.get('quantity-'+index)||0),restockQuantity:Number(data.get('restock-'+index)||0),damagedQuantity:Number(data.get('damaged-'+index)||0)})).filter(line=>line.quantity||line.restockQuantity||line.damagedQuantity);
    return {saleId,userId:store.getState().currentUserId,lines,reason:String(data.get('reason')||''),cashPaidConfirmed:data.has('cashPaidConfirmed')};
  }
  function updateReturnPreview(form) {
    const source=store.getReturnable(form.elements.saleId.value);
    const payload=returnPayload(form);
    const total=store.refundPreview(payload.saleId,payload.lines).total;
    const shift=V.shift(store.getState());
    const expected=shift?store.shiftSummary(shift.id).expected-total:null;
    form.querySelector('#return-total').textContent=V.money(total);
    form.querySelector('#return-expected').textContent=expected===null?'—':V.money(expected);
  }
  function returnForm(id) {
    const state=store.getState();
    if(state.pendingReturn){showDialog('ตรวจสอบรายการคืนเดิม','ยังไม่ทราบผลการบันทึกครั้งก่อน','<div class="inline-info">ตรวจรายการเดิมก่อนจ่ายเงินหรือบันทึกรายการใหม่</div>','<button type="button" class="button primary" data-action="return-recover">ตรวจสอบรายการเดิม</button>');return;}
    if(!V.shift(state))throw new Error('กรุณาเปิดกะก่อนคืนเงิน');
    const info=store.getReturnable(id);
    if(info.sale.voidedAt||info.status==='full')throw new Error('บิลนี้คืนสินค้าไม่ได้');
    const draft=returnDraft?.saleId===id?returnDraft:null;
    const rows=info.lines.map((line,index)=>{
      if(line.remainingQuantity===0)return '';
      const saved=draft?.lines.find(item=>item.saleLineId===line.id);
      return `<div class="return-line"><div class="return-line-title"><strong>${V.h(line.name)}</strong><span>${V.money(line.unitPrice)} / ชิ้น</span></div><small>${V.h(line.sku)} · ซื้อ ${line.quantity} · คืนแล้ว ${line.returnedQuantity} · คืนได้ ${line.remainingQuantity}</small><input type="hidden" name="saleLineId-${index}" value="${V.h(line.id)}"><div class="return-quantities">${field('รับคืน','quantity-'+index,saved?.quantity||0,'number',`class="return-input" min="0" max="${line.remainingQuantity}" step="1" required`)}${field('ขายต่อได้','restock-'+index,saved?.restockQuantity||0,'number','class="return-input" min="0" step="1" required')}${field('เสียหาย','damaged-'+index,saved?.damagedQuantity||0,'number','class="return-input" min="0" step="1" required')}</div></div>`;
    }).join('');
    const body=`<input type="hidden" name="saleId" value="${V.h(id)}"><div class="inline-info">บิล ${V.h(info.sale.receiptNo)} · ขาย ${V.date(info.sale.createdAt,true)}<br>ยอดคืนสะสม ${V.money(info.refunded)} · คืนได้ตามรายการด้านล่าง</div>${rows}<label class="field"><span>เหตุผลที่คืนสินค้า</span><textarea name="reason" required maxlength="300" placeholder="ระบุเหตุผลให้ตรวจย้อนหลังได้">${V.h(draft?.reason||'')}</textarea></label><div class="payment-total"><span>เงินสดที่จะคืน</span><strong id="return-total">${V.money(0)}</strong></div><div class="change-preview"><span>เงินสดคาดหวังหลังกำหนดคืน</span><strong id="return-expected">—</strong></div><p class="muted">ตรวจธนบัตรในลิ้นชักจริงก่อนจ่าย หากไม่พอ ให้บันทึกเงินนำเข้าตามเหตุการณ์จริง</p><label class="checkbox-field"><input type="checkbox" name="cashPaidConfirmed" required ${draft?.cashPaidConfirmed?'checked':''}><span>จ่ายเงินสดให้ลูกค้าตามยอดที่แสดงแล้ว</span></label><label class="field"><span>ลองสถานการณ์ (mockup)</span><select name="simulate"><option value="none">บันทึกตามปกติ</option><option value="unresolved">บันทึกแล้ว แต่ผลตอบกลับหาย</option><option value="failure">จำลองบันทึกไม่สำเร็จ</option></select></label>`;
    showDialog('รับคืนสินค้า',V.shortBill(info.sale)+' · กะจ่ายเงิน '+V.date(V.shift(state).openedAt,true),body,cancelButton+submitButton('ยืนยันคืนเงินสด','refresh'),'return');
    updateReturnPreview(dialog.querySelector('form'));
  }
  function returnDocument(id) {
    const state=store.getState();const record=state.returns.find(r=>r.id===id);
    if(!record)throw new Error('ไม่พบเอกสารคืนสินค้า');
    showDialog('เอกสารคืนสินค้า',record.returnNo,V.returnDocument(record,state),`<button type="button" class="button" data-action="return-print" data-id="${V.h(id)}">${V.icon('printer')}พิมพ์ซ้ำ</button><button type="button" class="button primary" data-action="dialog-close">ปิด</button>`);
  }
  function recoverReturn(){const record=store.recoverReturn();if(!record){toast('ไม่พบรายการคืนที่ต้องตรวจสอบ');render();return;}clearReturnDraft();render();returnDocument(record.id);toast('พบเอกสารคืนเดิมแล้ว ไม่มีการคืนเงินซ้ำ');}
  function priceChanged(){
    const state=store.getState();const changed=cart.filter(i=>state.products.find(p=>p.id===i.productId)?.price!==i.unitPrice);
    showDialog('ราคาสินค้ามีการเปลี่ยนแปลง','ยังไม่มีการขาย กรุณาตรวจราคาใหม่ก่อนยืนยัน',`<div class="stat-list">${changed.map(i=>{const p=state.products.find(p=>p.id===i.productId);return `<div class="stat-line"><span>${V.h(p?.name||'สินค้า')}</span><strong>${V.money(i.unitPrice)} → ${V.money(p?.price||0)}</strong></div>`}).join('')}</div>`,cancelButton+'<button type="button" class="button primary" data-action="accept-prices">ใช้ราคาล่าสุด</button>');
  }
  function recover(){const sale=store.recoverCheckout();if(!sale){toast('ไม่พบรายการที่ต้องตรวจสอบ');render();return;}saveDraft([]);render();receipt(sale.id,true);toast('พบรายการขายเดิมแล้ว ไม่มีการขายซ้ำ');}
  function productForm(id){
    const p=store.getState().products.find(p=>p.id===id);
    showDialog(p?'แก้ไขสินค้า':'เพิ่มสินค้าใหม่',p?'การเปลี่ยนราคาจะไม่แก้ยอดในบิลที่ขายไปแล้ว':'ใส่ข้อมูลสินค้าเพื่อเตรียมขึ้นชั้นและเริ่มขาย',`<input type="hidden" name="id" value="${V.h(p?.id||'')}"><div class="form-grid">${field('ชื่อสินค้า','name',p?.name||'','text','required maxlength="100"',true)}${field('SKU','sku',p?.sku||'','text','required maxlength="40" placeholder="เช่น DRINK-001"')}${field('ราคาขาย (บาท)','price',p?POSData.money(p.price).replace(/,/g,''):'','number','required min="0" step="0.01" inputmode="decimal"')}${field('บาร์โค้ด <small>ไม่บังคับ</small>','barcode',p?.barcode||'','text','maxlength="40" inputmode="numeric"',true)}<label class="field"><span>หมวดหมู่</span><select name="category">${V.categories.slice(1).map(c=>`<option ${p?.category===c?'selected':''}>${c}</option>`).join('')}</select></label>${p?`<label class="field"><span>สถานะจำหน่าย</span><select name="active"><option value="true" ${p.active?'selected':''}>เปิดจำหน่าย</option><option value="false" ${!p.active?'selected':''}>ปิดจำหน่าย</option></select></label>`:field('คงเหลือตั้งต้น (ชิ้น)','stock','0','number','required min="0" step="1"')}</div>${p?'<div class="subtle-note">'+V.icon('info')+'หากต้องการเปลี่ยนยอดคงเหลือ ให้ใช้รับเข้า / ปรับสต๊อก เพื่อเก็บประวัติ</div>':''}`,cancelButton+submitButton('บันทึกสินค้า'),'product');
  }
  function stockForm(id){const p=store.getState().products.find(p=>p.id===id);if(!p)return;showDialog('รับเข้า / ปรับสต๊อก',p.name+` · คงเหลือ ${p.stock} ชิ้น`,`<input type="hidden" name="productId" value="${V.h(id)}"><div class="form-grid"><label class="field full"><span>ประเภทการเปลี่ยนยอด</span><select name="kind" id="stock-kind"><option value="receive">รับเข้าด้วยมือ (ยอดตั้งต้น/เหตุพิเศษ)</option><option value="count">ปรับเป็นยอดที่นับได้จริง</option></select></label>${field('จำนวน (ชิ้น)','quantity','','number','required min="0" step="1"',true)}<label class="field full"><span>เหตุผล / ที่มาของสินค้า</span><textarea name="reason" placeholder="เช่น ยอดตั้งต้น หรือปรับตามการนับจริง" required maxlength="300"></textarea></label></div><div class="subtle-note">${V.icon('info')}สินค้าที่ซื้อจากซัพพลายเออร์ให้รับผ่านหน้า จัดซื้อและรับสินค้า เพื่อผูกกับ PO และใบรับ</div>`,cancelButton+submitButton('บันทึกสต๊อก'),'stock');}
  function stockHistory(id){const state=store.getState();const p=state.products.find(p=>p.id===id);const moves=state.stockMovements.filter(m=>m.productId===id).slice().reverse();showDialog('ประวัติสต๊อก',`${p.name} · คงเหลือ ${p.stock} ชิ้น`,moves.length?`<div class="movement-list">${moves.map(m=>`<div class="movement-row">${V.icon(m.quantity>=0?'arrowDown':'arrowUp')}<div><strong>${V.h(m.reason||m.kind)}</strong><p>${V.date(m.createdAt,true)} · ${V.h(V.actor(state,m.userId))}</p></div><span class="num ${m.quantity>=0?'text-green':'text-amber'}">${m.quantity>0?'+':''}${m.quantity}<small class="muted" style="display:block;font-size:9px;margin-top:4px">คงเหลือ ${m.balance}</small></span></div>`).join('')}</div>`:V.empty('ยังไม่มีประวัติ','รายการรับเข้า ขาย และปรับยอดจะปรากฏที่นี่','box'),'<button type="button" class="button primary" data-action="dialog-close">ปิด</button>');}
  function supplierForm(id) {
    const supplier=store.getState().suppliers.find(item=>item.id===id);
    showDialog(supplier?'แก้ไขซัพพลายเออร์':'เพิ่มซัพพลายเออร์','ข้อมูลติดต่อสำหรับใบสั่งซื้อ',`<input type="hidden" name="id" value="${V.h(supplier?.id||'')}"><div class="form-grid">${field('รหัสภายใน','code',supplier?.code||'','text','required maxlength="40"',true)}${field('ชื่อซัพพลายเออร์','name',supplier?.name||'','text','required maxlength="100"',true)}${field('ข้อมูลติดต่อ','contact',supplier?.contact||'','text','maxlength="160"',true)}<label class="field full"><span>สถานะ</span><select name="active"><option value="true" ${!supplier||supplier.active?'selected':''}>ใช้งาน</option><option value="false" ${supplier&&!supplier.active?'selected':''}>ปิดใช้งาน</option></select></label></div><p class="subtle-note">PO เดิมยังเปิดดูได้แม้ปิดใช้งานซัพพลายเออร์</p>`,cancelButton+submitButton('บันทึกซัพพลายเออร์'),'supplier');
  }
  function poLineRow(line={}) {
    const state=store.getState(),index=poLineIndex++;
    return `<div class="purchase-entry po-entry" data-line-index="${index}"><label class="field purchase-product"><span>สินค้า</span><select name="productId" required><option value="">เลือกสินค้า</option>${state.products.filter(p=>p.active||p.id===line.productId).map(p=>`<option value="${V.h(p.id)}" ${p.id===line.productId?'selected':''}>${V.h(p.name)} · ${V.h(p.sku)}</option>`).join('')}</select></label>${field('จำนวนสั่ง (ชิ้น)','quantity',line.orderedQty||1,'number','required min="1" step="1"')}${field('ทุนตกลง / ชิ้น (บาท)','agreedUnitCost',line.agreedUnitCost==null?'':POSData.money(line.agreedUnitCost),'number','required min="0" step="0.01" inputmode="decimal"')}<button type="button" class="icon-button purchase-remove" data-action="po-remove-line" aria-label="ลบรายการสินค้า">${V.icon('trash')}</button></div>`;
  }
  function purchaseForm(id) {
    const state=store.getState(),po=state.purchaseOrders.find(item=>item.id===id);
    if(po&&po.status!=='draft')throw new Error('แก้ไขได้เฉพาะ PO ฉบับร่าง');
    if(!state.suppliers.some(item=>item.active)){supplierForm();toast('เพิ่มซัพพลายเออร์ก่อนสร้าง PO');return;}
    poLineIndex=0;
    const lines=po?.lines?.length?po.lines:[{}];
    showDialog(po?'แก้ไข PO ฉบับร่าง':'สร้างใบสั่งซื้อ','PO ยังไม่เพิ่มสต๊อกหรือเปลี่ยนเงินกะ',`<input type="hidden" name="id" value="${V.h(po?.id||'')}"><label class="field"><span>ซัพพลายเออร์</span><select name="supplierId" required><option value="">เลือกซัพพลายเออร์</option>${state.suppliers.filter(item=>item.active||item.id===po?.supplierId).map(item=>`<option value="${V.h(item.id)}" ${item.id===po?.supplierId?'selected':''}>${V.h(item.name)} (${V.h(item.code)})</option>`).join('')}</select></label><div class="purchase-lines"><div class="section-heading"><h3>รายการสินค้า</h3><button type="button" class="button small" data-action="po-add-line">${V.icon('plus')}เพิ่มรายการ</button></div><div id="po-line-list">${lines.map(poLineRow).join('')}</div></div><label class="field"><span>หมายเหตุ</span><textarea name="note" maxlength="300" placeholder="เช่น ส่งสินค้ารอบเช้า">${V.h(po?.note||'')}</textarea></label>`,cancelButton+submitButton('บันทึกฉบับร่าง'),'purchase-order');
  }
  function purchaseDetail(id) {
    const state=store.getState(),po=store.getPurchaseOrder(id);
    const receipts=po.receipts.length?`<div class="purchase-detail-receipts"><h3>ประวัติใบรับของ</h3>${po.receipts.map(receipt=>`<button type="button" class="purchase-list-row" data-action="purchase-receipt-open" data-id="${V.h(receipt.id)}"><span><strong>${V.h(receipt.receiptNo)}</strong><small>${V.h(receipt.deliveryRef)} · ${V.date(receipt.receivedAt,true)}</small></span><span>${V.money(receipt.acceptedValue)} ${V.icon('chevronRight')}</span></button>`).join('')}</div>`:'';
    const actions=po.status==='draft'?`<button type="button" class="button" data-action="purchase-edit" data-id="${V.h(id)}">แก้ไขฉบับร่าง</button><button type="button" class="button primary" data-action="purchase-issue" data-id="${V.h(id)}">ออก PO</button>`:
      ['issued','partially_received'].includes(po.status)?`<button type="button" class="button primary" data-action="purchase-receive" data-id="${V.h(id)}">รับของ</button><button type="button" class="button" data-action="purchase-close-form" data-id="${V.h(id)}">ปิดยอดค้าง</button>`:'';
    const cancel=po.status==='draft'||(po.status==='issued'&&!po.receipts.length)?`<button type="button" class="button danger" data-action="purchase-cancel-form" data-id="${V.h(id)}">ยกเลิก PO</button>`:'';
    showDialog(po.poNo||'PO ฉบับร่าง',`${po.supplierNameSnapshot} · ${po.lines.length} รายการ`,`<div class="purchase-document">${V.purchaseOrderDocument(po,state)}</div>${receipts}`,`<button type="button" class="button" data-action="purchase-print-po" data-id="${V.h(id)}">${V.icon('printer')}พิมพ์</button>${cancel}${actions}<button type="button" class="button" data-action="dialog-close">ปิด</button>`);
  }
  function purchaseCloseForm(id,mode) {
    const po=store.getPurchaseOrder(id);
    showDialog(mode==='cancel'?'ยกเลิก PO':'ปิดยอดค้าง',po.poNo||'PO ฉบับร่าง',`<input type="hidden" name="poId" value="${V.h(id)}"><input type="hidden" name="mode" value="${mode}"><p class="dialog-subtext">${mode==='cancel'?'ยกเลิกได้เมื่อยังไม่มีใบรับของ':'รับสินค้าเพิ่มไม่ได้หลังปิดยอดค้าง'} ประวัติเดิมยังดูได้</p><label class="field"><span>เหตุผล</span><textarea name="reason" required maxlength="300"></textarea></label>`,cancelButton+submitButton(mode==='cancel'?'ยืนยันยกเลิก':'ยืนยันปิดยอดค้าง'),'purchase-close');
  }
  function goodsReceiptForm(id) {
    if(store.getPendingGoodsReceipt())throw new Error('ตรวจผลใบรับเดิมก่อนเริ่มใบใหม่');
    const po=store.getPurchaseOrder(id);
    if(!['issued','partially_received'].includes(po.status))throw new Error('PO นี้รับสินค้าเพิ่มไม่ได้');
    const draft=goodsReceiptDraft?.poId===id?goodsReceiptDraft:null;
    const rows=po.lines.filter(line=>line.outstandingQty>0).map(line=>{
      const saved=draft?.lines?.find(item=>item.poLineId===line.id);
      return `<div class="purchase-entry purchase-receive-line" data-line-id="${V.h(line.id)}"><div class="purchase-receive-name"><strong>${V.h(line.nameSnapshot)}</strong><small>สั่ง ${V.number(line.orderedQty)} · รับแล้ว ${V.number(line.acceptedQty)} · ค้าง ${V.number(line.outstandingQty)} ชิ้น · ทุน PO ${V.money(line.agreedUnitCost)}</small></div>${field('รับเข้าสต๊อก','acceptedQty',saved?.acceptedQty??0,'number',`required min="0" max="${line.outstandingQty}" step="1"`)}${field('ปฏิเสธ/เสียหาย','rejectedQty',saved?.rejectedQty??0,'number','required min="0" step="1"')}${field('ทุนจริง/ชิ้น (บาท)','actualUnitCost',POSData.money(saved?.actualUnitCost??line.agreedUnitCost),'number','required min="0" step="0.01" inputmode="decimal"')}${field('เหตุผลถ้าทุนต่าง','varianceReason',saved?.varianceReason||'','text','maxlength="200"')}</div>`;
    }).join('');
    showDialog('รับสินค้าตาม PO',`${po.poNo} · ${po.supplierNameSnapshot}`,`<input type="hidden" name="poId" value="${V.h(id)}">${field('เลขเอกสารส่งของ / รหัสรับภายใน','deliveryRef',draft?.deliveryRef||'','text','required maxlength="100"',true)}<div class="purchase-lines"><h3>จำนวนจากการส่งครั้งนี้</h3>${rows}</div><div class="subtle-note">รับเข้าสต๊อกเฉพาะจำนวนที่ตรวจรับแล้ว ของปฏิเสธยังค้างรับ</div><details class="purchase-scenario"><summary>ทดลองกรณีผลตอบกลับหาย</summary><select name="simulate"><option value="none">บันทึกปกติ</option><option value="unresolved">บันทึกแล้ว แต่ผลตอบกลับหาย</option><option value="failure">จำลองบันทึกล้มเหลว</option></select></details>`,cancelButton+submitButton('ยืนยันใบรับของ'),'goods-receipt');
  }
  function goodsReceiptPayload(form,userId) {
    const lines=Array.from(form.querySelectorAll('.purchase-receive-line')).map(row=>({poLineId:row.dataset.lineId,
      acceptedQty:Number(row.querySelector('[name="acceptedQty"]').value),rejectedQty:Number(row.querySelector('[name="rejectedQty"]').value),
      actualUnitCost:POSData.parseMoney(row.querySelector('[name="actualUnitCost"]').value),
      varianceReason:row.querySelector('[name="varianceReason"]').value.trim()})).filter(line=>line.acceptedQty||line.rejectedQty);
    return {userId,poId:form.elements.poId.value,deliveryRef:form.elements.deliveryRef.value.trim(),lines};
  }
  function goodsReceiptDocument(id) {
    const state=store.getState(),receipt=state.goodsReceipts.find(item=>item.id===id);
    if(!receipt)throw new Error('ไม่พบใบรับสินค้า');
    const po=store.getPurchaseOrder(receipt.poId);
    showDialog(receipt.receiptNo,`${po.poNo} · ${receipt.deliveryRef}`,`<div class="purchase-document">${V.goodsReceiptDocument(receipt,po,state)}</div>`,`<button type="button" class="button" data-action="purchase-print-receipt" data-id="${V.h(id)}">${V.icon('printer')}พิมพ์</button><button type="button" class="button primary" data-action="purchase-open" data-id="${V.h(po.id)}">ดู PO</button><button type="button" class="button" data-action="dialog-close">ปิด</button>`);
  }
  function recoverGoodsReceipt() {
    const receipt=store.recoverGoodsReceipt();
    if(!receipt){toast('ไม่พบใบรับที่ต้องตรวจสอบ');return;}
    clearGoodsReceiptDraft();render();goodsReceiptDocument(receipt.id);toast('พบใบรับเดิมแล้ว ไม่มีการเพิ่มสต๊อกซ้ำ');
  }
  function openShift(){const current=V.shift(store.getState());if(current){toast('มีกะเปิดอยู่แล้ว');return;}showDialog('เปิดกะใหม่','นับเงินทอนตั้งต้นก่อนเริ่มขาย',`<div class="inline-info">หลังเปิดกะ รายการขายและเงินสดทั้งหมดจะถูกบันทึกอยู่ในกะนี้</div>${field('เงินทอนตั้งต้น (บาท)','opening','1000.00','number','required min="0" step="0.01" inputmode="decimal"')}`,cancelButton+submitButton('เปิดกะ','clock'),'open-shift');}
  function closeShift(){const state=store.getState();const current=V.shift(state);if(!current)throw new Error('ไม่มีกะที่เปิดอยู่');const s=store.shiftSummary(current.id);showDialog('นับเงินและปิดกะ','ปิดกะแล้วจะขายหรือยกเลิกบิลในกะนี้ต่อไม่ได้',`<div class="payment-total"><span>เงินสดที่ควรมี</span><strong>${V.money(s.expected)}</strong></div>${field('เงินสดที่นับได้จริง (บาท)','counted','','number','id="counted-cash" required min="0" step="0.01" inputmode="decimal"')}<div class="change-preview"><span>เงินเกิน / ขาด</span><strong id="cash-difference">—</strong></div><label class="checkbox-field"><input type="checkbox" name="confirmed" required><span>นับเงินครบแล้ว และยืนยันปิดกะนี้</span></label>`,cancelButton+submitButton('ยืนยันปิดกะ','lock'),'close-shift');}
  function cashMovement(kind){if(!V.shift(store.getState()))throw new Error('เปิดกะก่อนบันทึกเงินเข้า–ออก');showDialog(kind==='in'?'นำเงินเข้าลิ้นชัก':'นำเงินออกจากลิ้นชัก','รายการนี้จะเปลี่ยนยอดเงินสดในกะ แต่ไม่เปลี่ยนยอดขาย',`<input type="hidden" name="kind" value="${kind}"><div class="form-grid">${field('จำนวนเงิน (บาท)','amount','','number','required min="0.01" step="0.01" inputmode="decimal"',true)}<label class="field full"><span>เหตุผล</span><textarea name="reason" required maxlength="300" placeholder="เช่น เพิ่มเงินทอน หรือนำเงินเก็บเข้าตู้เซฟ"></textarea></label></div>`,cancelButton+submitButton('บันทึกรายการ','cash'),'cash');}
  function voidForm(id){const state=store.getState();const sale=state.sales.find(s=>s.id===id);if(!sale)return;showDialog('ยกเลิกทั้งบิล',`${V.shortBill(sale)} · ยอด ${V.money(sale.total)}`,`<input type="hidden" name="saleId" value="${V.h(id)}"><div class="inline-info">การยกเลิกจะคืนยอดสินค้าและกลับยอดเงินสดในข้อมูล กรุณาคืนเงินและตรวจสินค้าจริงให้ครบก่อนยืนยัน</div><label class="field"><span>เหตุผลที่ยกเลิกบิล</span><textarea name="reason" required maxlength="300" placeholder="ระบุเหตุผลให้ตรวจย้อนหลังได้"></textarea></label><label class="checkbox-field"><input type="checkbox" name="cashReturned" required><span>คืนเงินสดครบ ${V.money(sale.total)} ให้ลูกค้าแล้ว</span></label><label class="checkbox-field"><input type="checkbox" name="goodsReturned" required><span>ได้รับสินค้ากลับมาครบในสภาพจำหน่ายได้ หรือยังไม่ได้ส่งมอบสินค้า</span></label>`,cancelButton+'<button type="submit" class="button danger" id="dialog-submit">ยืนยันยกเลิกทั้งบิล</button>','void');}
  function userForm(id){const u=store.getState().users.find(u=>u.id===id);showDialog(u?'แก้ไขพนักงาน':'เพิ่มพนักงานขาย','พนักงานขายมีสิทธิ์เปิด–ปิดกะ ขายสินค้า และดูบิล',`<input type="hidden" name="id" value="${V.h(u?.id||'')}"><div class="form-grid">${field('ชื่อที่แสดง','name',u?.name||'','text','required maxlength="60"',true)}${field('ชื่อบัญชี','username',u?.username||'','text','required pattern="[A-Za-z0-9_.-]+" maxlength="40" placeholder="เช่น cashier02"',true)}<label class="field full"><span>สถานะบัญชี</span><select name="active"><option value="true" ${!u||u.active?'selected':''}>เปิดใช้งาน</option><option value="false" ${u&&!u.active?'selected':''}>ปิดบัญชี</option></select></label></div><div class="subtle-note">${V.icon('info')}บัญชีใน mockup ใช้สลับบทบาทสำหรับทดลอง ไม่มีการเก็บรหัสผ่านจริง</div>`,cancelButton+submitButton('บันทึกพนักงาน'),'user');}
  function profile(){const state=store.getState();if(state.pendingCheckout||state.pendingReturn||state.pendingGoodsReceipt)throw new Error('ตรวจสอบรายการที่ยังไม่ทราบผลก่อนเปลี่ยนผู้ใช้งาน');showDialog('เลือกผู้ใช้งานตัวอย่าง','ลองมุมมองเจ้าของร้านและพนักงานขาย',`<div class="role-selection">${state.users.filter(u=>u.active).map(u=>`<button type="button" class="role-option ${u.id===state.currentUserId?'active':''}" data-action="switch-user" data-id="${V.h(u.id)}"><span class="avatar">${V.h(u.name.slice(0,1))}</span><span class="role-text"><strong>${V.h(u.name)}</strong><small>${u.role==='owner'?'เจ้าของร้าน · จัดการได้ทุกส่วน':'พนักงานขาย · ขายสินค้าและจัดการกะ'}</small></span>${u.id===state.currentUserId?V.icon('check'):V.icon('chevronRight')}</button>`).join('')}</div>`);}
  function confirmDialog(title,subtitle,action,label='ยืนยัน'){showDialog(title,'',`<p class="dialog-subtext">${V.h(subtitle)}</p>`,cancelButton+`<button type="button" class="button primary" data-action="${action}">${V.h(label)}</button>`);}
  function download(filename,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportReport(){
    const state=store.getState();
    const events=V.reportEvents(state,reportDate,reportShift);
    const cell=v=>{const value=String(v);return '"'+(/^-?\d+(?:\.\d+)?$/.test(value)?value:value.replace(/^[=+\-@]/,"'$&")).replace(/"/g,'""')+'"';};
    const rows=[['เลขเอกสาร','เวลา','ผู้ทำรายการ','รายการ','ยอดบาท'],...events.map(e=>[e.kind==='return'?e.return.returnNo:e.sale.receiptNo,V.date(e.createdAt,true),V.actor(state,e.userId),e.kind==='return'?'คืนสินค้า':e.kind==='void'?'ยกเลิกบิล':'ขาย',POSData.money(e.amount)])];
    download(`baandee-report-${reportShift||reportDate}.csv`,'\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
    toast('ส่งออกรายงานแล้ว');
  }
  const actions={
    menu:()=>app.querySelector('.app-shell').classList.toggle('menu-open'),
    'focus-search':()=>{document.getElementById('product-search').focus();toast('พร้อมรับรหัสจากเครื่องสแกนแบบคีย์บอร์ด');},
    add:el=>addProduct(el.dataset.id),
    quantity:el=>{ensureCartEditable();const id=el.dataset.id;const delta=Number(el.dataset.delta);const items=cart.map(i=>({...i}));const item=items.find(i=>i.productId===id);if(!item)return;const available=store.availableToSell(id);if(item.quantity+delta>available)throw new Error(`สินค้าขายได้ ${available} ชิ้น`);item.quantity+=delta;saveDraft(items.filter(i=>i.quantity>0));render();},
    remove:el=>{ensureCartEditable();saveDraft(cart.filter(i=>i.productId!==el.dataset.id));render();},
    category:el=>{category=el.dataset.category;catalogPage=0;render();},
    'catalog-page':el=>{catalogPage=Math.max(0,catalogPage+Number(el.dataset.delta));render();},
    'clear-cart':()=>{ensureCartEditable();if(cart.length)confirmDialog('ล้างตะกร้า?','นำสินค้าในบิลที่ยังไม่ชำระออกจากตะกร้าทั้งหมด','confirm-clear','ล้างตะกร้า');},
    'confirm-clear':()=>{saveDraft([]);closeDialog();render();},
    checkout:openCheckout,recover,
    'cash-preset':el=>{const input=document.getElementById('cash-tendered');input.value=(Number(el.dataset.amount)/100).toFixed(2);updateChange();input.focus();},
    'accept-prices':()=>{const state=store.getState();saveDraft(cart.map(i=>({...i,unitPrice:state.products.find(p=>p.id===i.productId)?.price??i.unitPrice})));render();openCheckout();},
    'new-product':()=>productForm(), 'edit-product':el=>productForm(el.dataset.id), stock:el=>stockForm(el.dataset.id), 'stock-history':el=>stockHistory(el.dataset.id),
    'supplier-new':()=>supplierForm(),'supplier-edit':el=>supplierForm(el.dataset.id),
    'purchase-new':()=>purchaseForm(),'purchase-edit':el=>purchaseForm(el.dataset.id),'purchase-open':el=>purchaseDetail(el.dataset.id),
    'po-add-line':()=>document.getElementById('po-line-list')?.insertAdjacentHTML('beforeend',poLineRow()),
    'po-remove-line':el=>{const rows=document.querySelectorAll('.po-entry');if(rows.length>1)el.closest('.po-entry')?.remove();else toast('PO ต้องมีสินค้าอย่างน้อยหนึ่งรายการ',true);},
    'purchase-issue':el=>{const id=el.dataset.id;store.issuePurchaseOrder({key:uuid(),userId:getContext().user.id,poId:id});render();purchaseDetail(id);toast('ออก PO แล้ว สต๊อกยังไม่เปลี่ยน');},
    'purchase-cancel-form':el=>purchaseCloseForm(el.dataset.id,'cancel'),
    'purchase-close-form':el=>purchaseCloseForm(el.dataset.id,'close'),
    'purchase-receive':el=>goodsReceiptForm(el.dataset.id),
    'purchase-receipt-open':el=>goodsReceiptDocument(el.dataset.id),
    'purchase-recover':recoverGoodsReceipt,
    'purchase-report-all':()=>{purchasingDate='';render();},
    'purchase-print-po':el=>{const state=store.getState(),po=store.getPurchaseOrder(el.dataset.id);document.getElementById('print-area').innerHTML=V.purchaseOrderDocument(po,state);window.print();},
    'purchase-print-receipt':el=>{const state=store.getState(),receipt=state.goodsReceipts.find(item=>item.id===el.dataset.id);if(!receipt)return;document.getElementById('print-area').innerHTML=V.goodsReceiptDocument(receipt,store.getPurchaseOrder(receipt.poId),state);window.print();},
    receipt:el=>receipt(el.dataset.id),void:el=>voidForm(el.dataset.id),
    'return-open':el=>returnForm(el.dataset.id),
    'return-document':el=>returnDocument(el.dataset.id),
    'return-recover':recoverReturn,
    'return-resume':()=>{if(returnDraft?.saleId)returnForm(returnDraft.saleId);},
    'return-print':el=>{const state=store.getState();const record=state.returns.find(r=>r.id===el.dataset.id);if(!record)return;document.getElementById('print-area').innerHTML=V.returnDocument(record,state);window.print();},
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
    'confirm-reset':()=>{store.reset();saveDraft([]);clearReturnDraft();clearGoodsReceiptDraft();scenario='none';category='ทั้งหมด';query='';catalogPage=0;reportShift='';closeDialog();render();toast('เริ่มข้อมูลตัวอย่างใหม่แล้ว');},
    'export-report':exportReport,
    'dialog-close':closeDialog
  };
  document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(!el||el.disabled)return;const handler=actions[el.dataset.action];if(!handler)return;event.preventDefault();try{handler(el)}catch(error){if(dialog.open)showError(error);else toast(error.message,true);}});
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='product-search'){query=el.value;catalogPage=0;render();}
    else if(el.id==='inventory-search'){inventoryQuery=el.value;render();}
    else if(el.id==='history-search'){historyQuery=el.value;render();}
    else if(el.id==='return-search'){returnQuery=el.value;render();}
    else if(el.id==='purchasing-search'){purchasingQuery=el.value;render();}
    else if(el.closest('form[data-form="return"]')){const form=el.closest('form');saveReturnDraft(returnPayload(form));updateReturnPreview(form);}
    else if(el.id==='cash-tendered'||el.id==='checkout-member-phone'||el.name==='redeemPoints')updateChange();
    else if(el.id==='counted-cash'){let value;try{value=POSData.parseMoney(el.value)}catch(_){value=null}const current=V.shift(store.getState());const diff=value===null?null:value-store.shiftSummary(current.id).expected;const output=document.getElementById('cash-difference');output.textContent=diff===null?'—':(diff>0?'+':'')+V.money(diff);output.className=diff<0?'text-red':diff>0?'text-amber':'text-green';}
  });
  document.addEventListener('change',event=>{const el=event.target;if(el.id==='history-date'){historyDate=el.value;render();}else if(el.id==='history-status'){historyStatus=el.value;render();}else if(el.id==='purchasing-supplier'){purchasingSupplier=el.value;render();}else if(el.id==='purchase-report-product'){purchasingProduct=el.value;render();}else if(el.id==='purchase-report-date'){purchasingDate=el.value;render();}else if(el.id==='report-date'){if(!el.value){el.value=reportDate;toast('กรุณาเลือกวันที่สำหรับรายงาน',true);return;}reportDate=el.value;reportShift='';render();}else if(el.id==='report-shift'){reportShift=el.value;render();}else if(el.id==='checkout-scenario'){scenario=el.value;toast('ตั้งค่าสถานการณ์ตัวอย่างแล้ว');}else if(el.closest('form[data-form="return"]')){const form=el.closest('form');saveReturnDraft(returnPayload(form));updateReturnPreview(form);}});
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
          updateChange();const tendered=POSData.parseMoney(value('tendered'));
          const memberId=value('memberId')||undefined,redeemPoints=Number(value('redeemPoints')||0),due=cartTotal()-redeemPoints;
          if(value('memberPhone')&&!memberId)throw new Error('ไม่พบสมาชิกที่ใช้งานได้');
          if(tendered<due)throw new Error('เงินที่รับต้องไม่น้อยกว่ายอดชำระ');
          const key=requestKey||uuid();saveDraft(cart,key);busy=true;
          const button=document.getElementById('dialog-submit');button.disabled=true;button.innerHTML='<span class="loading-spinner"></span>กำลังบันทึก…';
          await new Promise(resolve=>setTimeout(resolve,350));
          const mode=scenario;scenario='none';
          const result=store.checkout({key,userId:user.id,items:cart.map(i=>({...i})),tendered,memberId,redeemPoints,simulate:mode});
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
        case 'supplier':{
          store.saveSupplier({...(value('id')?{id:value('id')}:{}),code:value('code'),name:value('name'),contact:value('contact'),active:value('active')==='true'},user.id);
          closeDialog();render();toast('บันทึกซัพพลายเออร์แล้ว');break;
        }
        case 'purchase-order':{
          const lines=Array.from(form.querySelectorAll('.po-entry')).map(row=>({productId:row.querySelector('[name="productId"]').value,
            quantity:Number(row.querySelector('[name="quantity"]').value),agreedUnitCost:POSData.parseMoney(row.querySelector('[name="agreedUnitCost"]').value)}));
          const po=store.savePurchaseOrder({key:uuid(),userId:user.id,...(value('id')?{id:value('id')}:{}),supplierId:value('supplierId'),lines,note:value('note')});
          closeDialog();render();purchaseDetail(po.id);toast('บันทึก PO ฉบับร่างแล้ว');break;
        }
        case 'purchase-close':{
          const id=value('poId');
          if(value('mode')==='cancel')store.cancelPurchaseOrder({key:uuid(),userId:user.id,poId:id,reason:value('reason')});
          else store.closePurchaseOrder({key:uuid(),userId:user.id,poId:id,reason:value('reason')});
          closeDialog();render();purchaseDetail(id);toast('อัปเดตสถานะ PO แล้ว');break;
        }
        case 'goods-receipt':{
          const payload=saveGoodsReceiptDraft(goodsReceiptPayload(form,user.id));
          busy=true;const button=document.getElementById('dialog-submit');button.disabled=true;button.innerHTML='<span class="loading-spinner"></span>กำลังบันทึก…';
          await new Promise(resolve=>setTimeout(resolve,350));
          const result=store.receivePurchaseOrder({...payload,simulate:value('simulate')});
          busy=false;
          if(result.unresolved){closeDialog();render();showDialog('ยังไม่ทราบผลใบรับ','ตรวจเอกสารเดิมก่อนรับสินค้าอีกครั้ง','<div class="inline-info">ระบบจำลองว่าบันทึกใบรับแล้ว แต่ผลตอบกลับหาย การตรวจสอบจะเปิดใบรับเดิมโดยไม่เพิ่มสต๊อกซ้ำ</div>','<button type="button" class="button primary" data-action="purchase-recover">ตรวจสอบใบรับเดิม</button>');}
          else{clearGoodsReceiptDraft();closeDialog();render();goodsReceiptDocument(result.receipt.id);}
          return;
        }
        case 'open-shift':store.openShift({key:uuid(),opening:POSData.parseMoney(value('opening')),userId:user.id});closeDialog();render();toast('เปิดกะแล้ว พร้อมเริ่มขาย');break;
        case 'close-shift':{const closed=store.closeShift({key:uuid(),counted:POSData.parseMoney(value('counted')),userId:user.id});closeDialog();render();toast('ปิดกะและบันทึกยอดนับจริงแล้ว');break;}
        case 'cash':store.addCashMovement({key:uuid(),kind:value('kind'),amount:POSData.parseMoney(value('amount')),reason:value('reason'),userId:user.id});closeDialog();render();toast('บันทึกเงิน'+(value('kind')==='in'?'นำเข้า':'นำออก')+'แล้ว');break;
        case 'void':{const id=value('saleId');store.voidSale({key:uuid(),saleId:id,reason:value('reason'),cashReturned:data.has('cashReturned'),goodsReturned:data.has('goodsReturned'),userId:user.id});closeDialog();render();receipt(id);toast('ยกเลิกบิลและคืนยอดสินค้าแล้ว');break;}
        case 'return':{
          const payload=saveReturnDraft(returnPayload(form));
          busy=true;const button=document.getElementById('dialog-submit');button.disabled=true;button.innerHTML='<span class="loading-spinner"></span>กำลังบันทึก…';
          await new Promise(resolve=>setTimeout(resolve,350));
          const result=store.createReturn({...payload,simulate:value('simulate')});
          busy=false;
          if(result.unresolved){closeDialog();render();showDialog('ยังไม่ทราบผลรายการคืน','อย่าจ่ายเงินซ้ำ ตรวจด้วยคำขอเดิมก่อนทำรายการใหม่','<div class="inline-info">ระบบบันทึกรายการแล้ว แต่จำลองว่าผลตอบกลับหาย กดตรวจสอบเพื่อเปิดเอกสารเดิม</div>','<button type="button" class="button primary" data-action="return-recover">ตรวจสอบรายการเดิม</button>');}
          else{clearReturnDraft();closeDialog();render();returnDocument(result.return.id);}
          return;
        }
        case 'user':{const id=value('id');store.saveUser({...(id?{id}:{}),name:value('name'),username:value('username'),role:'cashier',active:value('active')==='true'},user.id);closeDialog();render();toast('บันทึกพนักงานแล้ว');break;}
      }
    }catch(error){busy=false;if(error.code==='PRICE_CHANGED'){priceChanged();return;}showError(error);const button=document.getElementById('dialog-submit');if(button&&form.dataset.form==='checkout'){button.disabled=false;button.innerHTML=V.icon('check')+'ยืนยันการขาย';updateChange();}else if(button&&form.dataset.form==='return'){button.disabled=false;button.innerHTML=V.icon('refresh')+'ยืนยันคืนเงินสด';}else if(button&&form.dataset.form==='goods-receipt'){button.disabled=false;button.innerHTML=V.icon('check')+'ยืนยันใบรับของ';}}
  });
  document.querySelector('.skip-link')?.addEventListener('click',event=>{event.preventDefault();document.getElementById('page-content')?.focus({preventScroll:false});});
  function navigate(){const next=location.hash.slice(1);if(next==='page-content'){document.getElementById('page-content')?.focus();return;}page=Object.hasOwn(V.pages,next)?next:store.getPendingReturn()?'returns':'sales';render();window.scrollTo({top:0});}
  window.addEventListener('hashchange',navigate);
  window.addEventListener('storage',event=>{if(event.key===dataKey)toast('ข้อมูลเปลี่ยนจากอีกแท็บ กรุณารีเฟรชก่อนทำรายการต่อ',true);});
  window.POSStockCountUI.install({store,V,render,showDialog,closeDialog,field,cancelButton,submitButton,uuid,toast,showError});
  window.POSGrossProfitUI.install({store,V,render,showDialog,closeDialog,field,cancelButton,submitButton,uuid,toast,showError});
  window.POSOrdersUI.install({store,V,render,showDialog,closeDialog,field,cancelButton,submitButton,uuid,toast,showError});
  window.POSLoyaltyUI.install({store,V,render,showDialog,closeDialog,field,cancelButton,submitButton,uuid,toast,showError});
  navigate();
  window.BaanPOS={store,getCart:()=>cart.map(i=>({...i})),getPage:()=>page};
})();
