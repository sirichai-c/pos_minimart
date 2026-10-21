(function(){
  'use strict';
  const V=window.POSViews,{h,date,number,actor,badge,icon,empty}=V;
  const labels={counting:'กำลังนับ',submitted:'รออนุมัติ',approved:'อนุมัติแล้ว',cancelled:'ยกเลิกแล้ว'};
  const button=(action,label,id='',product='',primary=false,disabled=false)=>`<button type="button" class="button ${primary?'primary':''}" data-action="${action}" data-id="${h(id)}" data-product="${h(product)}" ${disabled?'disabled':''}>${h(label)}</button>`;
  const signed=n=>(n>0?'+':'')+number(n);
  function chosen(state,id){return state.stockCounts.find(c=>c.id===id)||state.stockCounts.find(c=>['counting','submitted'].includes(c.status))||state.stockCounts.at(-1);}
  function historyLine(r,state){return `<li>${date(r.createdAt,true)} · ${h(actor(state,r.userId))} · ${r.kind==='recount'?'นับใหม่':'แก้ยอด'} ${r.before.countedQty===null?'ยังไม่ได้นับ':number(r.before.countedQty)} → ${r.after.countedQty===null?'รอนับใหม่':number(r.after.countedQty)}${r.reason?' · '+h(r.reason):''}${r.before.varianceReason?' · เหตุผลเดิม: '+h(r.before.varianceReason):''}</li>`;}
  function page(ctx,selected='',query=''){
    const {state,store,user}=ctx,owner=user.role==='owner',current=chosen(state,selected),active=state.stockCounts.some(c=>['counting','submitted'].includes(c.status));
    const head=`<div class="page-heading"><div><h1>ตรวจนับสต๊อก</h1><p>นับของจริง ส่งตรวจ แล้วให้เจ้าของอนุมัติก่อนปรับยอด</p></div><div class="page-actions">${owner?button('sc-create','เปิดรอบนับ','','',true,active):badge('พนักงาน · นับและส่งตรวจ','gray')}</div></div>`;
    const history=`<section class="panel sc-panel"><h2>รอบนับทั้งหมด</h2><div class="sc-session-list">${state.stockCounts.slice().reverse().map(c=>button('sc-open',c.name+' · '+labels[c.status],c.id,'',current?.id===c.id)).join('')||'<p class="muted">ยังไม่มีรอบนับ</p>'}</div></section>`;
    if(!current)return head+history+empty('ยังไม่มีรอบนับ','เจ้าของร้านเปิดรอบนับและเลือกสินค้าก่อนเริ่มนับ','box');
    const c=store.getStockCount(current.id),locked=['approved','cancelled'].includes(c.status),stale=c.lines.filter(l=>l.stale).length;
    const entered=c.lines.filter(l=>l.countedQty!==null).length,variances=c.lines.filter(l=>l.delta!==null&&l.delta!==0).length;
    const q=query.trim().toLowerCase(),lines=c.lines.filter(l=>!q||[l.nameSnapshot,l.skuSnapshot,l.barcodeSnapshot].some(v=>String(v||'').toLowerCase().includes(q)));
    const rows=lines.map(l=>`<tr><td><strong>${h(l.nameSnapshot)}</strong><small class="purchase-subline muted">${h(l.skuSnapshot)} · ${h(l.barcodeSnapshot)}</small></td><td class="right num">${number(l.expectedQty)}</td><td class="right num">${l.countedQty===null?'<span class="muted">ยังไม่ได้นับ</span>':number(l.countedQty)}</td><td class="right num">${l.delta===null?'—':signed(l.delta)}</td><td>${l.stale?badge('ต้องนับใหม่','amber'):l.countedQty===null?badge('รอนับ','gray'):badge('นับแล้ว','green')}<small class="purchase-subline">${h(l.varianceReason||'—')}</small></td><td><div class="sc-row-actions">${!locked&&c.status==='counting'&&!l.locked&&!l.stale?button('sc-record','กรอกยอดนับ',c.id,l.productId):''}${!locked&&owner&&(l.stale||l.locked||c.status==='submitted')?button('sc-reopen','เปิดนับใหม่',c.id,l.productId):''}</div></td></tr>${l.movements.length||l.revisions.length?`<tr><td colspan="6"><details class="sc-evidence"><summary>ประวัติ ${number(l.revisions.length)} ครั้ง · movement ${number(l.movements.length)} รายการ</summary><ul>${l.revisions.map(r=>historyLine(r,state)).join('')}${l.movements.map(m=>`<li>${date(m.createdAt,true)} · ${h(actor(state,m.userId))} · ${h(m.reason||m.kind)} · ${signed(m.quantity)} ชิ้น</li>`).join('')}</ul></details></td></tr>`:''}`).join('');
    const controls=locked?button('sc-print','พิมพ์ผลรอบนับ',c.id):
      (c.status==='counting'?button('sc-submit','ส่งตรวจ',c.id,'',true,entered!==c.lines.length||stale>0):owner?button('sc-approve','อนุมัติและปรับสต๊อก',c.id,'',true,stale>0):'')+
      (owner?button('sc-cancel','ยกเลิกรอบนับ',c.id):'');
    return head+history+`<section class="panel sc-panel"><div class="section-heading"><div><h2>${h(c.name)}</h2><small class="muted sc-id">${h(c.countNo)}</small><p>${badge(labels[c.status],c.status==='approved'?'green':'gray')} · เปิดโดย ${h(actor(state,c.createdBy))} · ${date(c.createdAt,true)}</p></div><div class="sc-row-actions">${controls}</div></div><div class="sc-summary"><span>นับแล้ว ${entered} / ${c.lines.length} SKU</span><span>มีส่วนต่าง ${variances} SKU</span><span>ผลต่างสุทธิ ${signed(c.lines.reduce((n,l)=>n+(l.delta??0),0))} ชิ้น</span>${stale?`<strong class="text-amber">ต้องนับใหม่ ${stale} SKU</strong>`:''}</div>${!locked?'<p class="subtle-note">กรอกยอดรวมที่เห็นจริง รวมค่า 0 · ยังไม่กรอกจะไม่ถือเป็น 0 · ต้องมีเหตุผลเมื่อยอดต่างกันก่อนอนุมัติ</p>':''}${stale?'<p role="alert" class="inline-info">มีสต๊อกเคลื่อนไหวหลัง snapshot ให้เจ้าของเปิดนับใหม่เฉพาะรายการที่เปลี่ยน</p>':''}<div class="toolbar"><div class="search-box">${icon('search')}<input id="sc-search" type="search" value="${h(query)}" placeholder="สแกนบาร์โค้ด หรือค้น SKU / ชื่อสินค้า" aria-label="ค้นสินค้าในรอบนับ"></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>สินค้า</th><th class="right">ระบบ ณ เริ่มนับ</th><th class="right">นับจริง</th><th class="right">ส่วนต่าง</th><th>สถานะ / เหตุผล</th><th>จัดการ</th></tr></thead><tbody>${rows||'<tr><td colspan="6">ไม่พบสินค้าในรอบนับ</td></tr>'}</tbody></table></div>${c.approvedAt?`<p>อนุมัติโดย ${h(actor(state,c.approvedBy))} · ${date(c.approvedAt,true)} · เอกสารนี้แก้ย้อนหลังไม่ได้</p>`:''}${c.cancelReason?`<p>เหตุผลยกเลิก: ${h(c.cancelReason)} · ${h(actor(state,c.cancelledBy))} · ${date(c.cancelledAt,true)}</p>`:''}</section><p class="muted sc-note">ข้อมูลทดลองในเบราว์เซอร์ · กรุณาใช้แท็บเดียว · ยังไม่มี SQLite transaction หรือการล็อกข้อมูลระหว่างเครื่อง</p>`;
  }
  function documentView(c,state){
    const summary=`<p class="receipt-thanks">จำนวน SKU ${number(c.lines.length)} · SKU มีส่วนต่าง ${number(c.lines.filter(l=>l.delta!==null&&l.delta!==0).length)} · ผลต่างสุทธิ ${signed(c.lines.reduce((n,l)=>n+(l.delta??0),0))} ชิ้น</p>`;
    return summary+`<section class="receipt-paper"><div class="receipt-brand"><h3>ผลตรวจนับสต๊อก</h3><p>${h(c.name)} · ${h(labels[c.status])}</p></div><div class="receipt-id">${h(c.countNo)}<br>เปิดโดย ${h(actor(state,c.createdBy))} · ${date(c.createdAt,true)}${c.approvedAt?`<br>อนุมัติโดย ${h(actor(state,c.approvedBy))} · ${date(c.approvedAt,true)}`:''}${c.submittedAt?`<br>ส่งตรวจโดย ${h(actor(state,c.submittedBy))} · ${date(c.submittedAt,true)}`:''}</div>${c.lines.map(l=>`<div class="purchase-document-line"><strong>${h(l.nameSnapshot)} · ${h(l.skuSnapshot)}</strong><span>ระบบ ${number(l.expectedQty)} → นับจริง ${l.countedQty===null?'ยังไม่ได้นับ':number(l.countedQty)} · ส่วนต่าง ${l.delta===null?'—':signed(l.delta)}</span><small>ผู้นับ ${h(actor(state,l.countedBy))} · ${date(l.countedAt,true)} · ${h(l.varianceReason||'ไม่มีส่วนต่าง')}<br>movement: ${h(l.movementId||'ไม่มีการปรับยอด')}</small>${l.revisions.length?`<ul>${l.revisions.map(r=>historyLine(r,state)).join('')}</ul>`:''}</div>`).join('')}${c.cancelReason?`<p>ยกเลิก: ${h(c.cancelReason)}</p>`:''}<p class="receipt-thanks">เอกสารตัวอย่าง · จำนวนเป็นชิ้น ไม่แสดงมูลค่ากำไรหรือขาดทุน</p></section>`;
  }
  function install(api){
    const {store,render,showDialog,closeDialog,field,cancelButton,submitButton,uuid,toast,showError}=api;
    let selected='',query='';
    V.pages['stock-count']=ctx=>page(ctx,selected,query);
    function context(){const state=store.getState();return {state,user:state.users.find(u=>u.id===state.currentUserId)};}
    const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${h(value)}">`;
    function form(mode,title,body,id='',product=''){
      showDialog(title,'สต๊อกจะเปลี่ยนเฉพาะเมื่อเจ้าของอนุมัติทั้งรอบ',hidden('key',uuid())+hidden('countId',id)+hidden('productId',product)+body,cancelButton+submitButton(title),'sc-'+mode);
    }
    const actions={
      'sc-create':()=>{const {state}=context();form('create','เปิดรอบนับ',`${field('ชื่อ / พื้นที่นับ','name','','text','required maxlength="100"')}<label class="field"><span>ขอบเขต</span><select name="scope" id="sc-scope"><option value="all">ทั้งร้าน (รวมสินค้าปิดจำหน่ายที่มีคงเหลือ)</option><option value="selected">เลือกบางสินค้า</option></select></label><div id="sc-product-picker" class="sc-product-picker" hidden>${state.products.map(p=>`<label class="checkbox-field"><input type="checkbox" name="products" value="${h(p.id)}"><span>${h(p.name)} · ${h(p.sku)}${p.active?'':' · ปิดจำหน่าย'}</span></label>`).join('')}</div>`);},
      'sc-open':el=>{selected=el.dataset.id;query='';render();},
      'sc-record':el=>{const c=store.getStockCount(el.dataset.id),l=c.lines.find(l=>l.productId===el.dataset.product);form('record','บันทึกยอดนับ',`<p>${h(l.nameSnapshot)} · ${h(l.skuSnapshot)}</p>${field('ยอดรวมที่เห็นจริง (ชิ้น)','countedQty',l.countedQty??'','number','required min="0" step="1" inputmode="numeric"')}<label class="field"><span>เหตุผลส่วนต่าง (ต้องระบุก่อนอนุมัติ)</span><textarea name="varianceReason" maxlength="300">${h(l.varianceReason)}</textarea></label>`,c.id,l.productId);},
      'sc-reopen':el=>form('reopen','เปิดนับใหม่','<p>เก็บยอดนับเดิมในประวัติ แล้วใช้ยอดระบบปัจจุบันเป็น snapshot ใหม่ กรุณานับของจริงอีกครั้ง</p><label class="field"><span>เหตุผลนับใหม่</span><textarea name="reason" required maxlength="300"></textarea></label>',el.dataset.id,el.dataset.product),
      'sc-submit':el=>form('submit','ส่งตรวจ','<p>ส่งแล้วจะแก้ยอดไม่ได้จนกว่าเจ้าของเปิดนับใหม่ สต๊อกยังไม่เปลี่ยน</p>',el.dataset.id),
      'sc-approve':el=>form('approve','อนุมัติและปรับสต๊อก','<p>ตรวจยอดจริงและเหตุผลส่วนต่างครบแล้ว ระบบจะตรวจ movement อีกครั้งและปรับทุกรายการพร้อมกัน</p><label class="checkbox-field"><input type="checkbox" required><span>ยืนยันตรวจยอดและเหตุผลทุกรายการแล้ว</span></label>',el.dataset.id),
      'sc-cancel':el=>form('cancel','ยกเลิกรอบนับ','<label class="field"><span>เหตุผลยกเลิก</span><textarea name="reason" required maxlength="300"></textarea></label>',el.dataset.id),
      'sc-print':el=>{document.getElementById('print-area').innerHTML=documentView(store.getStockCount(el.dataset.id),store.getState());window.print();}
    };
    document.addEventListener('click',event=>{const el=event.target.closest('[data-action]'),action=el&&actions[el.dataset.action];if(!action||el.disabled)return;event.preventDefault();try{action(el);}catch(e){showError(e);}});
    document.addEventListener('input',event=>{if(event.target.id==='sc-search'){query=event.target.value;render();}});
    document.addEventListener('change',event=>{if(event.target.id==='sc-scope')document.getElementById('sc-product-picker').hidden=event.target.value!=='selected';});
    document.addEventListener('keydown',event=>{if(event.target.id!=='sc-search'||event.key!=='Enter')return;event.preventDefault();
      const c=chosen(store.getState(),selected);if(!c)return;const q=query.trim().toLowerCase(),l=store.getStockCount(c.id).lines.find(l=>[l.skuSnapshot,l.barcodeSnapshot].some(v=>String(v).toLowerCase()===q));
      if(l&&c.status==='counting'&&!l.locked&&!l.stale)actions['sc-record']({dataset:{id:c.id,product:l.productId}});else toast('ไม่พบสินค้าที่พร้อมกรอกยอด กรุณาตรวจรอบนับ',true);
    });
    document.addEventListener('submit',event=>{
      const f=event.target,mode=f.dataset.form;if(!mode?.startsWith('sc-'))return;event.preventDefault();
      const d=new FormData(f),value=k=>String(d.get(k)??''),a={key:value('key'),userId:context().user.id,countId:value('countId')};
      try{
        let c;
        if(mode==='sc-create')c=store.createStockCount({key:a.key,userId:a.userId,name:value('name'),...(value('scope')==='selected'?{productIds:d.getAll('products')}: {})});
        else if(mode==='sc-record'){
          if(!/^\d+$/.test(value('countedQty')))throw Error('กรุณากรอกจำนวนเต็มตั้งแต่ 0');
          c=store.recordStockCount({...a,productId:value('productId'),countedQty:Number(value('countedQty')),varianceReason:value('varianceReason')});
        }else if(mode==='sc-reopen')c=store.reopenStockCountLine({...a,productId:value('productId'),reason:value('reason')});
        else if(mode==='sc-submit')c=store.submitStockCount(a);
        else if(mode==='sc-approve')c=store.approveStockCount(a);
        else if(mode==='sc-cancel')c=store.cancelStockCount({...a,reason:value('reason')});
        selected=c.id;closeDialog();render();toast(mode==='sc-approve'?'อนุมัติแล้ว สต๊อกปรับตามผลนับ':'บันทึกรอบนับแล้ว');
      }catch(e){showError(e);}
    });
  }
  V.pages['stock-count']=ctx=>page(ctx);
  window.POSStockCountUI={page,document:documentView,install};
})();
