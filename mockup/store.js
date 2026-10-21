(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POSData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  function error(code, message) { const err = new Error(message); err.code = code; throw err; }
  function integer(value, label, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) error('INVALID_NUMBER', label + 'ต้องเป็นจำนวนเต็มที่ถูกต้อง');
    return value;
  }
  function safe(value) {
    if (!Number.isSafeInteger(value)) error('AMOUNT_OVERFLOW', 'จำนวนเงินหรือจำนวนสินค้าเกินขอบเขต');
    return value;
  }
  function text(value, label) {
    if (typeof value !== 'string' || !value.trim()) error('REQUIRED', 'กรุณาระบุ' + label);
    return value.trim();
  }
  function uuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }
  function money(cents) {
    if (!Number.isSafeInteger(cents)) error('INVALID_NUMBER', 'จำนวนเงินไม่ถูกต้อง');
    const absolute = Math.abs(cents);
    return (cents < 0 ? '-' : '') + Math.floor(absolute / 100).toLocaleString('en-US') + '.' + String(absolute % 100).padStart(2, '0');
  }
  function parseMoney(value) {
    if (typeof value !== 'string') error('INVALID_MONEY', 'กรุณาระบุจำนวนเงิน');
    const s = value.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s)) error('INVALID_MONEY', 'จำนวนเงินต้องมีทศนิยมไม่เกินสองตำแหน่ง');
    const [whole, fraction = ''] = s.replace(/,/g, '').split('.');
    return integer(Number(whole) * 100 + Number(fraction.padEnd(2, '0')), 'จำนวนเงิน');
  }
  function dateKey(timestamp) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function seed() {
    const createdAt = now();
    const dayStart = new Date(dateKey(createdAt) + 'T00:00:00+07:00').getTime();
    const timestamp = n => new Date(Math.max(dayStart, Date.now() - n * 60000)).toISOString();
    const catalog = [
      ['milk','นมสดรสจืด 250 มล.','MILK-250','8851000000011',1500,36,'เครื่องดื่ม','milk'],
      ['water','น้ำดื่ม 600 มล.','WATER-600','8851000000028',700,72,'เครื่องดื่ม','water'],
      ['coffee','กาแฟกระป๋อง 180 มล.','COFFEE-180','8851000000035',1700,24,'เครื่องดื่ม','coffee'],
      ['tea','ชาเขียว 500 มล.','TEA-500','8851000000042',2000,30,'เครื่องดื่ม','tea'],
      ['soda','น้ำอัดลม 325 มล.','SODA-325','8851000000059',1500,40,'เครื่องดื่ม','soda'],
      ['noodles','บะหมี่กึ่งสำเร็จรูป รสต้มยำ','NOODLE-TOM','8851000000066',700,80,'อาหารแห้ง','noodles'],
      ['rice','ข้าวหอมมะลิ 1 กก.','RICE-1KG','8851000000073',4500,18,'อาหารแห้ง','rice'],
      ['oil','น้ำมันถั่วเหลือง 1 ลิตร','OIL-1L','8851000000080',5800,12,'วัตถุดิบ','oil'],
      ['fish','ปลากระป๋องในซอสมะเขือเทศ','FISH-155','8851000000097',2200,32,'อาหารแห้ง','fish'],
      ['bread','ขนมปังแผ่น 240 กรัม','BREAD-240','8851000000103',3500,10,'ขนมและเบเกอรี่','bread'],
      ['snack','มันฝรั่งทอด รสดั้งเดิม','SNACK-ORI','8851000000110',2000,25,'ขนมและเบเกอรี่','snack'],
      ['soap','สบู่ก้อน กลิ่นสะอาด','SOAP-100','8851000000127',1800,22,'ของใช้','soap'],
      ['shampoo','แชมพู 180 มล.','SHAMPOO-180','8851000000134',6900,8,'ของใช้','shampoo'],
      ['tissue','กระดาษทิชชู 120 แผ่น','TISSUE-120','8851000000141',2500,16,'ของใช้','tissue'],
      ['eggs','ไข่ไก่ เบอร์ 2 แพ็ก 6 ฟอง','EGG-6','8851000000158',3000,14,'วัตถุดิบ','eggs'],
      ['sugar','น้ำตาลทรายขาว 1 กก.','SUGAR-1KG','8851000000165',2800,20,'วัตถุดิบ','sugar'],
      ['milk-soy','นมถั่วเหลือง 300 มล.','SOYMILK-300','8851000000172',1200,4,'เครื่องดื่ม','milk'],
      ['noodles-pork','บะหมี่กึ่งสำเร็จรูป รสหมูสับ','NOODLE-PORK','8851000000189',700,45,'อาหารแห้ง','noodles'],
      ['snack-seaweed','ขนมข้าวอบกรอบ รสสาหร่าย','SNACK-SEA','8851000000196',1000,3,'ขนมและเบเกอรี่','snack'],
      ['tea-lemon','ชามะนาว 350 มล.','TEA-LEMON','8851000000202',1500,0,'เครื่องดื่ม','tea']
    ];
    const products = catalog.map(([id,name,sku,barcode,price,stock,category,image]) => ({id,name,sku,barcode,price,stock,category,image,active:true}));
    const shift = { id: uuid(), openedAt: timestamp(180), closedAt: null, opening: 100000, userId: 'owner' };
    const state = { version: 5, stockCounts:[], products, users: [
      { id:'owner', name:'พิมพ์ · เจ้าของร้าน', username:'owner', role:'owner', active:true },
      { id:'cashier', name:'เมย์ · พนักงานขาย', username:'cashier', role:'cashier', active:true }
    ], currentUserId:'owner', shifts:[shift], activeShiftId:shift.id, sales:[], returns:[], cashRefunds:[], stockMovements:[], cashMovements:[],
      audit:[], backup:{lastSnapshot:null,lastUpload:null,pending:0,history:[]}, online:true, pendingCheckout:null, pendingReturn:null,
      suppliers:[], purchaseOrders:[], goodsReceipts:[], pendingGoodsReceipt:null, requests:{} };
    products.forEach(p => state.stockMovements.push({id:uuid(),productId:p.id,kind:'initial',quantity:p.stock,balance:p.stock,reason:'ยอดตั้งต้นร้านตัวอย่าง',createdAt:timestamp(181),userId:'owner',reference:'demo-opening'}));
    const baskets = [[['water',2],['bread',1]],[['coffee',1],['noodles',3]],[['milk',2],['snack',1]],[['rice',1],['fish',2]]];
    baskets.forEach((basket,index) => {
      const saleId = uuid();
      const items = basket.map(([id,quantity]) => {
        const p = products.find(p => p.id === id);
        p.stock -= quantity;
        state.stockMovements.push({id:uuid(),productId:id,kind:'sale',quantity:-quantity,balance:p.stock,reason:'ขายหน้าร้าน',createdAt:timestamp(120-index*20),userId:'cashier',reference:saleId});
        return {id:uuid(),productId:id,name:p.name,sku:p.sku,unitPrice:p.price,quantity,total:p.price*quantity};
      });
      const total = items.reduce((s,i) => s+i.total,0);
      const tendered = Math.ceil(total/10000)*10000;
      const sale = {id:saleId,receiptNo:'POS1-'+saleId.replace(/-/g,''),createdAt:timestamp(120-index*20),shiftId:shift.id,userId:'cashier',items,total,tendered,change:tendered-total};
      state.sales.push(sale);
      state.audit.push({id:uuid(),action:'SALE',description:'ขาย '+sale.receiptNo,userId:'cashier',createdAt:sale.createdAt});
    });
    products.forEach(p=>{p.stockVersion=state.stockMovements.filter(m=>m.productId===p.id).length;});
    const grossModule = typeof module==='object'&&module.exports ? require('./gross-profit.js') : globalThis.POSGrossProfit;
    grossModule.create({now,uuid,safe,error}).initialize(state);
    return state;
  }
  function createStore(options = {}) {
    const key = options.key || 'baan-ran-pos-demo-v1';
    let storage;
    try { storage = options.storage || globalThis.localStorage; }
    catch (_) { error('STORAGE_FAILED','เปิดพื้นที่บันทึกไม่ได้ กรุณาอนุญาตพื้นที่จัดเก็บของเบราว์เซอร์'); }
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') error('STORAGE_FAILED','ไม่มีพื้นที่บันทึก กรุณาใช้เบราว์เซอร์ที่รองรับ localStorage');
    let state;
    function persist(next) {
      try { storage.setItem(key, JSON.stringify(next)); }
      catch (_) { error('STORAGE_FAILED','บันทึกไม่สำเร็จ ข้อมูลยังไม่เปลี่ยน กรุณาตรวจพื้นที่เบราว์เซอร์แล้วลองรายการเดิม'); }
      state = next;
    }
    let saved;
    try { saved = storage.getItem(key); }
    catch (_) { error('STORAGE_FAILED','อ่านข้อมูลไม่ได้ กรุณาตรวจสิทธิ์พื้นที่จัดเก็บของเบราว์เซอร์'); }
    if (saved) {
      let loaded;
      try {
        loaded = JSON.parse(saved);
        if (![1,2,3,4,5].includes(loaded.version) || !Array.isArray(loaded.products) || !Array.isArray(loaded.sales) || !loaded.requests || typeof loaded.requests!=='object' || Array.isArray(loaded.requests) || !Array.isArray(loaded.users) || !Array.isArray(loaded.shifts) || !Array.isArray(loaded.stockMovements) || !Array.isArray(loaded.cashMovements)) throw new Error();
        if (loaded.sales.some(sale=>typeof sale.id!=='string'||!Array.isArray(sale.items)||sale.items.some(line=>typeof line.productId!=='string'||!Number.isSafeInteger(line.quantity)||!Number.isSafeInteger(line.unitPrice)))) throw new Error();
        if (loaded.version === 2 && (!Array.isArray(loaded.returns) || !Array.isArray(loaded.cashRefunds))) throw new Error();
        if (loaded.version >= 3 && (!Array.isArray(loaded.returns) || !Array.isArray(loaded.cashRefunds) || !Array.isArray(loaded.suppliers) || !Array.isArray(loaded.purchaseOrders) || !Array.isArray(loaded.goodsReceipts))) throw new Error();
        if (loaded.version >= 4 && (!Array.isArray(loaded.stockCounts) || loaded.products.some(p=>!Number.isSafeInteger(p.stockVersion)||p.stockVersion<0))) throw new Error();
        if (loaded.version === 5 && (!Array.isArray(loaded.costLayers)||!Array.isArray(loaded.costWriteoffs))) throw new Error();
      } catch (_) { error('STORAGE_INVALID','ข้อมูลตัวอย่างที่บันทึกไว้ไม่ถูกต้อง กรุณาตรวจข้อมูลก่อนล้างข้อมูลตัวอย่าง'); }
      if (loaded.version < 4) {
        const migrated = clone(loaded);
        if (loaded.version === 1) {
          migrated.sales.forEach(sale => sale.items.forEach((line,index) => { if (!line.id) line.id = sale.id + '-line-' + (index + 1); }));
          migrated.shifts.forEach(shift=>{if(shift.summary){shift.summary.refunds??=0;shift.summary.returnCount??=0;}});
          Object.values(migrated.requests).forEach(entry=>{
            if(entry?.action!=='checkout'||!entry.result?.id)return;
            const sale=migrated.sales.find(item=>item.id===entry.result.id);
            if(sale)entry.result=clone(sale);
          });
          migrated.returns = [];
          migrated.cashRefunds = [];
          migrated.pendingReturn = null;
        }
        migrated.version = 5;
        migrated.stockCounts = [];
        migrated.products.forEach(p=>{p.stockVersion=migrated.stockMovements.filter(m=>m.productId===p.id).length;});
        if (loaded.version < 3) {
          migrated.suppliers = [];
          migrated.purchaseOrders = [];
          migrated.goodsReceipts = [];
          migrated.pendingGoodsReceipt = null;
        }
        const grossModule=typeof module==='object'&&module.exports?require('./gross-profit.js'):globalThis.POSGrossProfit;
        grossModule.create({now,uuid,safe,error}).initialize(migrated);
        // Keep the old key and only replace it after the entire migration can be written.
        persist(migrated);
      } else state = loaded;
      if(state.version<5){const next=clone(state);next.version=5;
        const grossModule=typeof module==='object'&&module.exports?require('./gross-profit.js'):globalThis.POSGrossProfit;
        grossModule.create({now,uuid,safe,error}).initialize(next);persist(next);
      }
    } else persist(seed());
    function transaction(work) {
      const next = clone(state);
      const result = work(next);
      persist(next);
      return clone(result === undefined ? next : result);
    }
    function user(s, userId, owner = false) {
      const actor = s.users.find(u => u.id === (userId || s.currentUserId) && u.active);
      if (!actor) error('INVALID_USER','บัญชีนี้ปิดใช้งานหรือไม่พบผู้ใช้');
      if (owner && actor.role !== 'owner') error('FORBIDDEN','รายการนี้ทำได้เฉพาะเจ้าของร้าน');
      return actor;
    }
    function open(s) {
      const shift = s.shifts.find(sh => sh.id === s.activeShiftId && !sh.closedAt);
      if (!shift) error('NO_OPEN_SHIFT','กรุณาเปิดกะก่อนทำรายการ');
      return shift;
    }
    function audit(s, action, description, userId) { s.audit.push({id:uuid(),action,description,userId,createdAt:now()}); }
    function movement(s, product, kind, quantity, reason, userId, reference) {
      product.stock = integer(safe(product.stock + quantity), 'คงเหลือ');
      product.stockVersion = safe((product.stockVersion??0)+1);
      const entry = {id:uuid(),productId:product.id,kind,quantity,balance:product.stock,reason,createdAt:now(),userId,reference};
      s.stockMovements.push(entry); gross.movement(s,entry); return entry;
    }
    function request(action, args, work, owner = false) {
      const actor = user(state,args.userId,owner);
      const requestKey = text(args.key,'รหัสคำขอ');
      const payload = canonical({...args,userId:actor.id,key:undefined,simulate:undefined});
      const previous = state.requests['request:'+requestKey];
      if (previous) {
        if (previous.action !== action || previous.payload !== payload) error('IDEMPOTENCY_CONFLICT','รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว กรุณาตรวจรายการเดิม');
        return clone(previous.result);
      }
      return transaction(s => {
        const result = work(s,actor.id);
        s.requests['request:'+requestKey] = {action,payload,result:clone(result)};
        return result;
      });
    }
    function totals(sales) {
      return sales.reduce((r,s) => { r.gross=safe(r.gross+s.total); if(s.voidedAt) r.voids=safe(r.voids+s.total); r.saleCount++; r.net=r.gross-r.voids; return r; },{gross:0,voids:0,net:0,saleCount:0});
    }
    function returnable(s,saleId) {
      const sale=s.sales.find(entry=>entry.id===saleId);
      if(!sale)error('SALE_NOT_FOUND','ไม่พบบิล');
      const returns=s.returns.filter(entry=>entry.saleId===saleId);
      const lines=sale.items.map(line=>{
        const returnedQuantity=returns.reduce((count,entry)=>safe(count+entry.lines.filter(item=>item.saleLineId===line.id).reduce((n,item)=>safe(n+item.quantity),0)),0);
        return {...clone(line),returnedQuantity,remainingQuantity:safe(line.quantity-returnedQuantity)};
      });
      const refunded=returns.reduce((sum,entry)=>safe(sum+entry.total),0);
      const status=returns.length===0?'none':lines.every(line=>line.remainingQuantity===0)?'full':'partial';
      return {sale:clone(sale),lines,returns:clone(returns),refunded,status};
    }
    function summary(s, shiftId) {
      const shift = s.shifts.find(sh => sh.id === shiftId);
      if (!shift) error('SHIFT_NOT_FOUND','ไม่พบกะ');
      if (shift.summary) return clone(shift.summary);
      const result = {opening:shift.opening,...totals(s.sales.filter(sale=>sale.shiftId===shift.id)),refunds:0,returnCount:0,cashIn:0,cashOut:0,counted:null,difference:null};
      s.cashRefunds.filter(refund=>refund.shiftId===shift.id).forEach(refund=>{result.refunds=safe(result.refunds+refund.amount);result.returnCount++;});
      result.net=safe(result.net-result.refunds);
      s.cashMovements.filter(m=>m.shiftId===shift.id).forEach(m => { const field=m.kind==='in'?'cashIn':'cashOut'; result[field]=safe(result[field]+m.amount); });
      result.expected=safe(safe(safe(result.opening+result.net)+result.cashIn)-result.cashOut);
      return result;
    }
    function purchaseDetails(s, po) {
      if (!po) error('PO_NOT_FOUND','ไม่พบใบสั่งซื้อ');
      const receipts=s.goodsReceipts.filter(receipt=>receipt.poId===po.id);
      const lines=po.lines.map(line=>{
        const entries=receipts.flatMap(receipt=>receipt.lines.filter(item=>item.poLineId===line.id));
        const acceptedQty=entries.reduce((sum,item)=>safe(sum+item.acceptedQty),0);
        const rejectedQty=entries.reduce((sum,item)=>safe(sum+item.rejectedQty),0);
        return {...clone(line),acceptedQty,rejectedQty,outstandingQty:safe(line.orderedQty-acceptedQty)};
      });
      return {...clone(po),lines,receipts:clone(receipts),orderedValue:lines.reduce((sum,line)=>safe(sum+safe(line.orderedQty*line.agreedUnitCost)),0),
        acceptedValue:receipts.reduce((sum,receipt)=>safe(sum+receipt.acceptedValue),0)};
    }
    const countModule = typeof module==='object'&&module.exports ? require('./stock-count.js') : globalThis.POSStockCount;
    const counts=countModule.create({getState:()=>state,request,movement,audit,now,uuid,clone,error,integer,text,safe});
    const grossModule = typeof module==='object'&&module.exports ? require('./gross-profit.js') : globalThis.POSGrossProfit;
    const gross=grossModule.create({getState:()=>state,request,user,now,uuid,clone,error,integer,safe,dateKey});
    return {
      ...counts,
      grossProfitReport: gross.report,
      setOpeningCost(args){return request('openingCost',args,(s,userId)=>{
        const layer=s.costLayers.find(l=>l.id===args.layerId&&l.source==='opening'&&l.remaining>0);
        if(!layer)error('OPENING_LAYER_NOT_FOUND','ไม่พบยอดตั้งต้นที่ยังเหลือ');
        if(layer.unitCost!==null)error('OPENING_COST_LOCKED','ตั้งราคาทุนยอดนี้แล้ว');
        layer.unitCost=integer(args.unitCost,'ราคาทุนตั้งต้น');
        audit(s,'OPENING_COST_SET','ตั้งต้นทุน SKU '+s.products.find(p=>p.id===layer.productId)?.sku,userId);
        return layer;
      },true);},
      getState: () => clone(state),
      getPendingCheckout: () => clone(state.pendingCheckout),
      getPendingReturn: () => clone(state.pendingReturn),
      getPendingGoodsReceipt: () => clone(state.pendingGoodsReceipt),
      getPurchaseOrder(poId) { return purchaseDetails(state,state.purchaseOrders.find(po=>po.id===poId)); },
      getReturnable(saleId) { return clone(returnable(state,saleId)); },
      setUser(userId) { user(state,userId); if(state.pendingCheckout||state.pendingReturn||state.pendingGoodsReceipt)error('RECOVERY_REQUIRED','กรุณาตรวจผลรายการที่ยังไม่ทราบก่อนเปลี่ยนผู้ใช้'); return transaction(s=>{s.currentUserId=userId;return s.users.find(u=>u.id===userId);}); },
      reset() { const next=seed();persist(next);return clone(next); },
      checkout(args) {
        const actor=user(state,args.userId);
        const simulation=args.simulate || 'none';
        if (!['none','unresolved','failure'].includes(simulation)) error('INVALID_SIMULATION','รูปแบบทดสอบไม่ถูกต้อง');
        const requestArgs={key:args.key,userId:actor.id,items:args.items,tendered:args.tendered};
        const previous=state.requests['request:'+text(args.key,'รหัสคำขอ')];
        // Replayed checkout is resolved before price/stock/open-shift validation.
        if (previous) return {sale:request('checkout',requestArgs,()=>{})};
        if (state.pendingCheckout) error('CHECKOUT_UNRESOLVED','กรุณากู้ผลการขายเดิมก่อนเริ่มบิลใหม่');
        if (state.pendingReturn) error('RETURN_UNRESOLVED','กรุณากู้ผลรายการคืนเดิมก่อนเริ่มบิลใหม่');
        if (simulation==='failure') error('CHECKOUT_FAILED','จำลองบันทึกล้มเหลว ยังไม่มีการขาย กรุณาลองคำขอเดิม');
        const sale=request('checkout',requestArgs,(s,userId)=>{
          const shift=open(s);
          integer(args.tendered,'เงินรับ');
          if (!Array.isArray(args.items) || !args.items.length) error('EMPTY_CART','กรุณาเลือกสินค้า');
          const aggregated=new Map();
          args.items.forEach(line=>{
            integer(line.quantity,'จำนวนสินค้า',1);integer(line.unitPrice,'ราคา');
            const p=s.products.find(p=>p.id===line.productId && p.active);
            if(!p) error('PRODUCT_UNAVAILABLE','สินค้าไม่พร้อมจำหน่าย');
            if(p.price!==line.unitPrice) error('PRICE_CHANGED','ราคาสินค้าเปลี่ยน กรุณาตรวจและยืนยันราคาใหม่');
            aggregated.set(p.id,safe((aggregated.get(p.id)||0)+line.quantity));
          });
          const items=Array.from(aggregated,([productId,quantity])=>{
            const p=s.products.find(p=>p.id===productId);
            if(p.stock<quantity) error('INSUFFICIENT_STOCK','สินค้า '+p.name+' มีคงเหลือไม่พอ');
            return {id:uuid(),productId,name:p.name,sku:p.sku,unitPrice:p.price,quantity,total:safe(p.price*quantity)};
          });
          const total=items.reduce((sum,line)=>safe(sum+line.total),0);
          if(args.tendered<total) error('INSUFFICIENT_CASH','เงินรับไม่พอชำระยอดบิล');
          const id=uuid();
          const sale={id,receiptNo:'POS1-'+id.replace(/-/g,''),createdAt:now(),shiftId:shift.id,userId,items,total,tendered:args.tendered,change:args.tendered-total};
          gross.sale(s,sale);
          items.forEach(line=>movement(s,s.products.find(p=>p.id===line.productId),'sale',-line.quantity,'ขาย '+sale.receiptNo,userId,id));
          s.sales.push(sale);summary(s,shift.id);audit(s,'SALE','ขาย '+sale.receiptNo,userId);
          if(simulation==='unresolved') s.pendingCheckout={...clone(requestArgs),saleId:id};
          return sale;
        });
        return simulation==='unresolved'?{sale,unresolved:true}:{sale};
      },
      recoverCheckout() {
        if(!state.pendingCheckout)return null;
        const pending=state.pendingCheckout;
        const sale=state.sales.find(s=>s.id===pending.saleId);
        if(!sale) error('RECOVERY_FAILED','ยังไม่พบผลบิลเดิม กรุณาตรวจข้อมูลก่อนขายซ้ำ');
        return transaction(s=>{s.pendingCheckout=null;return sale;});
      },
      createReturn(args) {
        const actor=user(state,args.userId,true);
        const simulation=args.simulate||'none';
        if(!['none','unresolved','failure'].includes(simulation))error('INVALID_SIMULATION','รูปแบบทดสอบไม่ถูกต้อง');
        const requestArgs={key:args.key,userId:actor.id,saleId:args.saleId,lines:args.lines,reason:args.reason,cashPaidConfirmed:args.cashPaidConfirmed};
        const previous=state.requests['request:'+text(args.key,'รหัสคำขอ')];
        if(previous)return {return:request('return',requestArgs,()=>{})};
        if(state.pendingReturn)error('RETURN_UNRESOLVED','กรุณากู้ผลรายการคืนเดิมก่อนเริ่มรายการใหม่');
        if(state.pendingCheckout)error('CHECKOUT_UNRESOLVED','กรุณากู้ผลการขายเดิมก่อนเริ่มรายการคืน');
        if(simulation==='failure')error('RETURN_FAILED','จำลองบันทึกคืนสินค้าไม่สำเร็จ กรุณาลองคำขอเดิม');
        const result=request('return',requestArgs,(s,userId)=>{
          const shift=open(s);
          const source=returnable(s,args.saleId);
          if(source.sale.voidedAt)error('SALE_VOIDED','บิลนี้ยกเลิกแล้ว คืนสินค้าไม่ได้');
          const reason=text(args.reason,'เหตุผลคืนสินค้า');
          if(args.cashPaidConfirmed!==true)error('CASH_CONFIRMATION_REQUIRED','กรุณายืนยันว่าจ่ายเงินสดให้ลูกค้าแล้ว');
          if(!Array.isArray(args.lines)||!args.lines.length)error('INVALID_RETURN_LINE','กรุณาเลือกสินค้าที่รับคืน');
          const seen=new Set();
          const id=uuid();
          const lines=args.lines.map(input=>{
            const original=source.lines.find(line=>line.id===input.saleLineId);
            if(!original||seen.has(input.saleLineId))error('INVALID_RETURN_LINE','รายการสินค้าคืนไม่ตรงกับบิลหรือซ้ำกัน');
            seen.add(input.saleLineId);
            integer(input.quantity,'จำนวนคืน',1);
            integer(input.restockQuantity,'จำนวนขายต่อได้');
            integer(input.damagedQuantity,'จำนวนเสียหาย');
            if(safe(input.restockQuantity+input.damagedQuantity)!==input.quantity)error('INVALID_RETURN_LINE','จำนวนขายต่อได้รวมกับเสียหายต้องเท่าจำนวนคืน');
            if(input.quantity>original.remainingQuantity)error('RETURN_QUANTITY_EXCEEDED','จำนวนคืนมากกว่าที่บิลยังคืนได้');
            return {id:uuid(),returnId:id,saleLineId:original.id,productId:original.productId,name:original.name,sku:original.sku,
              unitPrice:original.unitPrice,quantity:input.quantity,restockQuantity:input.restockQuantity,damagedQuantity:input.damagedQuantity,
              total:safe(input.quantity*original.unitPrice)};
          });
          const total=lines.reduce((sum,line)=>safe(sum+line.total),0);
          const entry={id,returnNo:'RT1-'+id.replace(/-/g,''),saleId:source.sale.id,receiptNo:source.sale.receiptNo,shiftId:shift.id,
            createdAt:now(),userId,reason,total,lines};
          gross.returned(s,entry,source.sale,s.returns.filter(r=>r.saleId===source.sale.id));
          s.returns.push(entry);
          s.cashRefunds.push({id:uuid(),returnId:id,shiftId:shift.id,amount:total,confirmedBy:userId,createdAt:entry.createdAt});
          lines.filter(line=>line.restockQuantity>0).forEach(line=>{
            const product=s.products.find(p=>p.id===line.productId);
            if(!product)error('PRODUCT_NOT_FOUND','ไม่พบสินค้าต้นทาง');
            movement(s,product,'return_restock',line.restockQuantity,'คืนสินค้า '+entry.returnNo,userId,line.id);
          });
          summary(s,shift.id);
          audit(s,'RETURN_CREATED','คืน '+entry.returnNo+' จาก '+source.sale.receiptNo+' · '+reason,userId);
          if(simulation==='unresolved')s.pendingReturn={...clone(requestArgs),returnId:id};
          return entry;
        },true);
        return simulation==='unresolved'?{return:result,unresolved:true}:{return:result};
      },
      recoverReturn() {
        if(!state.pendingReturn)return null;
        const entry=state.returns.find(item=>item.id===state.pendingReturn.returnId);
        if(!entry)error('RECOVERY_FAILED','ยังไม่พบผลรายการคืนเดิม กรุณาตรวจข้อมูลก่อนจ่ายเงินซ้ำ');
        return transaction(s=>{s.pendingReturn=null;return entry;});
      },
      saveSupplier(input, actorId) {
        const actor=user(state,actorId,true);
        return transaction(s=>{
          const existing=input.id?s.suppliers.find(item=>item.id===input.id):null;
          if(input.id&&!existing)error('SUPPLIER_NOT_FOUND','ไม่พบซัพพลายเออร์');
          const code=text(input.code,'รหัสซัพพลายเออร์').toUpperCase();
          const name=text(input.name,'ชื่อซัพพลายเออร์');
          if(s.suppliers.some(item=>item.id!==input.id&&item.code===code))error('DUPLICATE_SUPPLIER_CODE','รหัสซัพพลายเออร์ซ้ำ');
          if(input.contact!=null&&typeof input.contact!=='string')error('INVALID_CONTACT','ข้อมูลติดต่อไม่ถูกต้อง');
          if(input.active!==undefined&&typeof input.active!=='boolean')error('INVALID_STATUS','สถานะซัพพลายเออร์ไม่ถูกต้อง');
          const updated={id:existing?.id||uuid(),code,name,contact:(input.contact||'').trim(),active:input.active!==false,
            createdAt:existing?.createdAt||now(),updatedAt:now()};
          if(existing)Object.assign(existing,updated);else s.suppliers.push(updated);
          audit(s,existing?'SUPPLIER_UPDATED':'SUPPLIER_CREATED',code+' · '+name,actor.id);
          return updated;
        });
      },
      savePurchaseOrder(args) { return request('purchaseOrderSave',args,(s,userId)=>{
        const existing=args.id?s.purchaseOrders.find(po=>po.id===args.id):null;
        if(args.id&&!existing)error('PO_NOT_FOUND','ไม่พบใบสั่งซื้อ');
        if(existing&&existing.status!=='draft')error('PO_NOT_DRAFT','แก้ไขได้เฉพาะใบสั่งซื้อฉบับร่าง');
        const supplier=s.suppliers.find(item=>item.id===args.supplierId&&item.active);
        if(!supplier)error('SUPPLIER_UNAVAILABLE','ซัพพลายเออร์ไม่พร้อมใช้งาน');
        if(!Array.isArray(args.lines)||!args.lines.length)error('EMPTY_PO','กรุณาเลือกสินค้าอย่างน้อยหนึ่งรายการ');
        const seen=new Set();
        const lines=args.lines.map(input=>{
          const product=s.products.find(item=>item.id===input.productId&&item.active);
          if(!product)error('PRODUCT_UNAVAILABLE','สินค้าไม่พร้อมสั่งซื้อ');
          if(seen.has(product.id))error('DUPLICATE_PO_LINE','สินค้าใน PO ซ้ำกัน');
          seen.add(product.id);
          const orderedQty=integer(input.quantity,'จำนวนสั่ง',1);
          const agreedUnitCost=integer(input.agreedUnitCost,'ราคาทุน');
          safe(orderedQty*agreedUnitCost);
          return {id:uuid(),productId:product.id,skuSnapshot:product.sku,nameSnapshot:product.name,orderedQty,agreedUnitCost};
        });
        lines.reduce((sum,line)=>safe(sum+safe(line.orderedQty*line.agreedUnitCost)),0);
        if(args.note!=null&&typeof args.note!=='string')error('INVALID_NOTE','หมายเหตุไม่ถูกต้อง');
        const po=existing||{id:uuid(),poNo:null,status:'draft',createdAt:now(),createdBy:userId};
        Object.assign(po,{supplierId:supplier.id,supplierNameSnapshot:supplier.name,lines,note:(args.note||'').trim(),updatedAt:now()});
        if(!existing)s.purchaseOrders.push(po);
        audit(s,existing?'PO_DRAFT_UPDATED':'PO_DRAFT_CREATED','ใบสั่งซื้อฉบับร่าง · '+supplier.name,userId);
        return po;
      },true); },
      issuePurchaseOrder(args) { return request('purchaseOrderIssue',args,(s,userId)=>{
        const po=s.purchaseOrders.find(item=>item.id===args.poId);
        if(!po)error('PO_NOT_FOUND','ไม่พบใบสั่งซื้อ');
        if(po.status!=='draft')error('PO_NOT_DRAFT','ออกเอกสารได้เฉพาะฉบับร่าง');
        const supplier=s.suppliers.find(item=>item.id===po.supplierId&&item.active);
        if(!supplier)error('SUPPLIER_UNAVAILABLE','ซัพพลายเออร์ไม่พร้อมใช้งาน');
        po.lines.forEach(line=>{
          const product=s.products.find(item=>item.id===line.productId);
          if(!product)error('PRODUCT_NOT_FOUND','ไม่พบสินค้าในใบสั่งซื้อ');
          line.skuSnapshot=product.sku;line.nameSnapshot=product.name;
        });
        po.poNo='PO1-'+po.id.replace(/-/g,'');po.supplierNameSnapshot=supplier.name;
        po.status='issued';po.issuedAt=now();po.issuedBy=userId;
        audit(s,'PO_ISSUED','ออกใบสั่งซื้อ '+po.poNo,userId);
        return po;
      },true); },
      cancelPurchaseOrder(args) { return request('purchaseOrderCancel',args,(s,userId)=>{
        const po=s.purchaseOrders.find(item=>item.id===args.poId);
        if(!po)error('PO_NOT_FOUND','ไม่พบใบสั่งซื้อ');
        if(s.goodsReceipts.some(receipt=>receipt.poId===po.id))error('PO_HAS_RECEIPTS','มีใบรับของแล้ว ยกเลิกใบสั่งซื้อไม่ได้');
        if(!['draft','issued'].includes(po.status))error('PO_CLOSED','ใบสั่งซื้อนี้ปิดแล้ว');
        po.closeReason=text(args.reason,'เหตุผลยกเลิก');po.status='cancelled';po.closedAt=now();po.closedBy=userId;
        audit(s,'PO_CANCELLED','ยกเลิก '+(po.poNo||po.id)+' · '+po.closeReason,userId);
        return po;
      },true); },
      closePurchaseOrder(args) { return request('purchaseOrderClose',args,(s,userId)=>{
        const po=s.purchaseOrders.find(item=>item.id===args.poId);
        if(!po)error('PO_NOT_FOUND','ไม่พบใบสั่งซื้อ');
        if(!['issued','partially_received'].includes(po.status))error('PO_CLOSED','ใบสั่งซื้อนี้ปิดแล้วหรือยังไม่ออกเอกสาร');
        if(purchaseDetails(s,po).lines.every(line=>line.outstandingQty===0))error('PO_FULLY_RECEIVED','ใบสั่งซื้อรับครบแล้ว');
        po.closeReason=text(args.reason,'เหตุผลปิดยอดค้าง');po.status='closed_short';po.closedAt=now();po.closedBy=userId;
        audit(s,'PO_CLOSED_SHORT','ปิดยอดค้าง '+po.poNo+' · '+po.closeReason,userId);
        return po;
      },true); },
      receivePurchaseOrder(args) {
        const actor=user(state,args.userId,true);
        const simulation=args.simulate||'none';
        if(!['none','unresolved','failure'].includes(simulation))error('INVALID_SIMULATION','รูปแบบทดสอบไม่ถูกต้อง');
        const requestArgs={key:args.key,userId:actor.id,poId:args.poId,deliveryRef:args.deliveryRef,lines:args.lines};
        const previous=state.requests['request:'+text(args.key,'รหัสคำขอ')];
        if(previous)return {receipt:request('goodsReceipt',requestArgs,()=>{},true)};
        if(state.pendingGoodsReceipt)error('RECEIPT_UNRESOLVED','กรุณาตรวจใบรับของเดิมก่อนรับครั้งใหม่');
        if(simulation==='failure')error('RECEIPT_FAILED','จำลองบันทึกใบรับไม่สำเร็จ กรุณาลองคำขอเดิม');
        const receipt=request('goodsReceipt',requestArgs,(s,userId)=>{
          const po=s.purchaseOrders.find(item=>item.id===args.poId);
          if(!po)error('PO_NOT_FOUND','ไม่พบใบสั่งซื้อ');
          if(po.status==='draft')error('PO_NOT_ISSUED','กรุณาออกใบสั่งซื้อก่อนรับของ');
          if(!['issued','partially_received'].includes(po.status))error('PO_CLOSED','ใบสั่งซื้อนี้ปิดแล้ว');
          const deliveryRef=text(args.deliveryRef,'เลขเอกสารส่งของ');
          if(s.goodsReceipts.some(item=>item.poId===po.id&&item.deliveryRef.toUpperCase()===deliveryRef.toUpperCase()))
            error('DUPLICATE_DELIVERY_REF','เลขเอกสารส่งของนี้เคยรับใน PO แล้ว');
          if(!Array.isArray(args.lines)||!args.lines.length)error('EMPTY_RECEIPT','กรุณาระบุรายการรับของ');
          const details=purchaseDetails(s,po),seen=new Set(),id=uuid();
          const lines=args.lines.map(input=>{
            const source=details.lines.find(line=>line.id===input.poLineId);
            if(!source)error('PRODUCT_NOT_IN_PO','สินค้าไม่อยู่ใน PO');
            if(seen.has(source.id))error('DUPLICATE_RECEIPT_LINE','สินค้าในใบรับซ้ำกัน');
            seen.add(source.id);
            const acceptedQty=integer(input.acceptedQty,'จำนวนรับ');
            const rejectedQty=integer(input.rejectedQty,'จำนวนปฏิเสธ');
            if(acceptedQty===0&&rejectedQty===0)error('EMPTY_RECEIPT_LINE','กรุณาระบุจำนวนรับหรือปฏิเสธ');
            if(acceptedQty>source.outstandingQty)error('RECEIPT_QUANTITY_EXCEEDED','จำนวนรับเกินยอดค้างใน PO');
            const actualUnitCost=integer(input.actualUnitCost,'ราคาทุนจริง');
            const varianceReason=(input.varianceReason||'').trim();
            if(actualUnitCost!==source.agreedUnitCost&&!varianceReason)error('COST_VARIANCE_REASON_REQUIRED','กรุณาระบุเหตุผลราคาทุนต่างจาก PO');
            const acceptedValue=safe(acceptedQty*actualUnitCost);
            return {id:uuid(),receiptId:id,poLineId:source.id,productId:source.productId,skuSnapshot:source.skuSnapshot,
              nameSnapshot:source.nameSnapshot,acceptedQty,rejectedQty,agreedUnitCost:source.agreedUnitCost,
              actualUnitCost,varianceReason,acceptedValue};
          });
          const acceptedValue=lines.reduce((sum,line)=>safe(sum+line.acceptedValue),0);
          const entry={id,receiptNo:'GR1-'+id.replace(/-/g,''),poId:po.id,poNo:po.poNo,deliveryRef,
            receivedAt:now(),receivedBy:userId,lines,acceptedValue};
          s.goodsReceipts.push(entry);
          lines.filter(line=>line.acceptedQty>0).forEach(line=>{
            const product=s.products.find(item=>item.id===line.productId);
            if(!product)error('PRODUCT_NOT_FOUND','ไม่พบสินค้าในใบรับ');
            movement(s,product,'purchase_receipt',line.acceptedQty,'รับตาม '+entry.receiptNo,userId,line.id);
          });
          const after=purchaseDetails(s,po);
          po.status=after.lines.every(line=>line.outstandingQty===0)?'fully_received':
            after.lines.some(line=>line.acceptedQty>0)?'partially_received':'issued';
          audit(s,'GOODS_RECEIPT','รับสินค้า '+entry.receiptNo+' จาก '+po.poNo,userId);
          if(simulation==='unresolved')s.pendingGoodsReceipt={...clone(requestArgs),receiptId:id};
          return entry;
        },true);
        return simulation==='unresolved'?{receipt,unresolved:true}:{receipt};
      },
      recoverGoodsReceipt() {
        if(!state.pendingGoodsReceipt)return null;
        const receipt=state.goodsReceipts.find(item=>item.id===state.pendingGoodsReceipt.receiptId);
        if(!receipt)error('RECOVERY_FAILED','ยังไม่พบใบรับเดิม กรุณาตรวจเอกสารก่อนรับซ้ำ');
        return transaction(s=>{s.pendingGoodsReceipt=null;return receipt;});
      },
      saveProduct(input,userId) {
        const actor=user(state,userId,true);
        return transaction(s=>{
          const existing=input.id?s.products.find(p=>p.id===input.id):null;
          if(input.id&&!existing)error('PRODUCT_NOT_FOUND','ไม่พบสินค้า');
          const name=text(input.name,'ชื่อสินค้า');const sku=text(input.sku,'SKU').toUpperCase();
          if(input.barcode!=null&&typeof input.barcode!=='string')error('INVALID_BARCODE','บาร์โค้ดต้องเป็นข้อความเพื่อรักษาศูนย์นำหน้า');
          const barcode=input.barcode==null?'':input.barcode.trim();
          if(s.products.some(p=>p.id!==input.id&&p.sku.toUpperCase()===sku))error('DUPLICATE_SKU','SKU ซ้ำกับสินค้าอื่น');
          if(barcode&&s.products.some(p=>p.id!==input.id&&p.barcode===barcode))error('DUPLICATE_BARCODE','บาร์โค้ดซ้ำกับสินค้าอื่น');
          integer(input.price,'ราคา');
          if(existing&&input.stock!==undefined&&input.stock!==existing.stock)error('STOCK_LEDGER_REQUIRED','กรุณาใช้รับสินค้าเข้าหรือปรับยอดนับจริงเพื่อเปลี่ยนสต๊อก');
          if(input.active!==undefined&&typeof input.active!=='boolean')error('INVALID_STATUS','สถานะสินค้าไม่ถูกต้อง');
          const product={id:existing?existing.id:uuid(),name,sku,barcode,price:input.price,stock:existing?existing.stock:0,category:input.category||'ของใช้',image:input.image||'snack',active:input.active!==false};
          if(existing)Object.assign(existing,product);else {
            s.products.push(product);
            movement(s,product,'initial',integer(input.stock??0,'ยอดตั้งต้น'),'ยอดตั้งต้นสินค้า',actor.id,product.id);
          }
          audit(s,existing?'PRODUCT_UPDATED':'PRODUCT_CREATED',(existing?'แก้ไขสินค้า ':'เพิ่มสินค้า ')+name,actor.id);
          return product;
        });
      },
      adjustStock(args) { return request('stock',args,(s,userId)=>{
        const product=s.products.find(p=>p.id===args.productId);
        if(!product)error('PRODUCT_NOT_FOUND','ไม่พบสินค้า');
        if(!['receive','count'].includes(args.kind))error('INVALID_KIND','ชนิดปรับสต๊อกไม่ถูกต้อง');
        integer(args.quantity,'จำนวนสินค้า',args.kind==='receive'?1:0);
        const reason=text(args.reason,'เหตุผล');
        const quantity=args.kind==='count'?args.quantity-product.stock:args.quantity;
        const entry=movement(s,product,args.kind==='receive'?'manual_receive':args.kind,quantity,reason,userId,args.key);
        if(quantity>0&&args.unitCost!==undefined){const layer=s.costLayers.find(l=>l.sourceId===entry.id);layer.unitCost=integer(args.unitCost,'ราคาทุน');}
        audit(s,'STOCK_'+args.kind.toUpperCase(),product.name+' '+quantity+' · '+reason,userId);return entry;
      },true); },
      voidSale(args) { return request('void',args,(s,userId)=>{
        const shift=open(s);const sale=s.sales.find(sale=>sale.id===args.saleId);
        if(!sale)error('SALE_NOT_FOUND','ไม่พบบิล');
        if(sale.shiftId!==shift.id)error('WRONG_SHIFT','ยกเลิกได้เฉพาะบิลในกะเดิมที่ยังเปิดอยู่');
        if(sale.voidedAt)error('ALREADY_VOIDED','บิลนี้ยกเลิกแล้ว ไม่มีการคืนเงินหรือสต๊อกซ้ำ');
        if(s.returns.some(entry=>entry.saleId===sale.id))error('VOID_BLOCKED_BY_RETURN','บิลนี้มีรายการคืนแล้ว ยกเลิกทั้งบิลไม่ได้');
        const reason=text(args.reason,'เหตุผลยกเลิก');
        if(args.cashReturned!==true||args.goodsReturned!==true)error('RETURN_CONFIRMATION_REQUIRED','กรุณายืนยันคืนเงินครบและรับสินค้าคืนครบ');
        sale.voidedAt=now();sale.voidReason=reason;sale.voidedBy=userId;
        gross.voided(s,sale);
        sale.items.forEach(line=>movement(s,s.products.find(p=>p.id===line.productId),'void',line.quantity,reason,userId,sale.id));
        audit(s,'SALE_VOIDED','ยกเลิก '+sale.receiptNo+' · '+reason,userId);return sale;
      },true); },
      openShift(args) { return request('openShift',args,(s,userId)=>{
        if(s.activeShiftId)error('SHIFT_OPEN','มีกะเปิดอยู่แล้ว กรุณาปิดกะเดิมก่อน');
        const shift={id:uuid(),openedAt:now(),closedAt:null,opening:integer(args.opening,'เงินตั้งต้น'),userId};
        s.shifts.push(shift);s.activeShiftId=shift.id;audit(s,'SHIFT_OPENED','เปิดกะ เงินตั้งต้น '+money(shift.opening),userId);return shift;
      }); },
      closeShift(args) { return request('closeShift',args,(s,userId)=>{
        if(s.pendingCheckout)error('CHECKOUT_UNRESOLVED','กรุณากู้ผลการขายเดิมก่อนปิดกะ');
        if(s.pendingReturn)error('RETURN_UNRESOLVED','กรุณากู้ผลรายการคืนเดิมก่อนปิดกะ');
        const shift=open(s);const counted=integer(args.counted,'เงินนับจริง');
        const snapshot=summary(s,shift.id);snapshot.counted=counted;snapshot.difference=safe(counted-snapshot.expected);
        Object.assign(shift,{closedAt:now(),closedBy:userId,counted,expected:snapshot.expected,difference:snapshot.difference,summary:snapshot});
        s.activeShiftId=null;audit(s,'SHIFT_CLOSED','ปิดกะ ส่วนต่าง '+money(shift.difference),userId);return shift;
      }); },
      addCashMovement(args) { return request('cash',args,(s,userId)=>{
        const shift=open(s);
        if(!['in','out'].includes(args.kind))error('INVALID_KIND','ชนิดรายการเงินไม่ถูกต้อง');
        const entry={id:uuid(),shiftId:shift.id,kind:args.kind,amount:integer(args.amount,'จำนวนเงิน',1),reason:text(args.reason,'เหตุผล'),createdAt:now(),userId};
        s.cashMovements.push(entry);summary(s,shift.id);audit(s,'CASH_'+args.kind.toUpperCase(),entry.reason+' '+money(entry.amount),userId);return entry;
      },true); },
      shiftSummary(shiftId) { return clone(summary(state,shiftId)); },
      dailySummary(day) {
        if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))error('INVALID_DATE','วันที่ไม่ถูกต้อง');
        const calendarDate=new Date(day+'T00:00:00+07:00');
        if(Number.isNaN(calendarDate.getTime())||dateKey(calendarDate)!==day)error('INVALID_DATE','วันที่ไม่ถูกต้อง');
        const sales=state.sales.filter(s=>dateKey(s.createdAt)===day);
        const result={opening:0,...totals(sales),refunds:0,returnCount:0,cashIn:0,cashOut:0,counted:null,difference:null};
        // A void belongs to the calendar day it was recorded, including shifts crossing midnight.
        result.voids=state.sales.filter(s=>s.voidedAt&&dateKey(s.voidedAt)===day).reduce((sum,s)=>safe(sum+s.total),0);
        state.cashRefunds.filter(refund=>dateKey(refund.createdAt)===day).forEach(refund=>{result.refunds=safe(result.refunds+refund.amount);result.returnCount++;});
        result.net=safe(safe(result.gross-result.voids)-result.refunds);
        state.shifts.filter(s=>dateKey(s.openedAt)===day).forEach(s=>{result.opening=safe(result.opening+s.opening);});
        state.cashMovements.filter(m=>dateKey(m.createdAt)===day).forEach(m=>{const f=m.kind==='in'?'cashIn':'cashOut';result[f]=safe(result[f]+m.amount);});
        const closed=state.shifts.filter(s=>s.closedAt&&dateKey(s.closedAt)===day);
        if(closed.length){result.counted=closed.reduce((sum,s)=>safe(sum+s.counted),0);result.difference=closed.reduce((sum,s)=>safe(sum+s.difference),0);}
        result.expected=safe(safe(safe(result.opening+result.net)+result.cashIn)-result.cashOut);return result;
      },
      saveUser(input,actorId) {
        const actor=user(state,actorId,true);
        return transaction(s=>{
          const existing=input.id?s.users.find(u=>u.id===input.id):null;
          if(input.id&&!existing)error('USER_NOT_FOUND','ไม่พบผู้ใช้');
          const name=text(input.name,'ชื่อผู้ใช้');const username=text(input.username,'ชื่อเข้าระบบ').toLowerCase();
          if(!['owner','cashier'].includes(input.role))error('INVALID_ROLE','สิทธิ์ผู้ใช้ไม่ถูกต้อง');
          if(input.active!==undefined&&typeof input.active!=='boolean')error('INVALID_STATUS','สถานะผู้ใช้ไม่ถูกต้อง');
          if(s.users.some(u=>u.id!==input.id&&u.username.toLowerCase()===username))error('DUPLICATE_USERNAME','ชื่อเข้าระบบซ้ำ');
          const updated={id:existing?existing.id:uuid(),name,username,role:input.role,active:input.active!==false};
          if(existing)Object.assign(existing,updated);else s.users.push(updated);
          if(!s.users.some(u=>u.role==='owner'&&u.active))error('LAST_OWNER','ต้องมีเจ้าของร้านที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี');
          if(!s.users.some(u=>u.id===s.currentUserId&&u.active))s.currentUserId=s.users.find(u=>u.role==='owner'&&u.active).id;
          audit(s,'USER_UPDATED','จัดการผู้ใช้ '+name+' · '+input.role,actor.id);return updated;
        });
      },
      recordBackup(input = {},actorId) {
        const actor=user(state,actorId,true);
        return transaction(s=>{
          const createdAt=now();const uploaded=!!input.cloud&&s.online;
          s.backup.lastSnapshot=createdAt;
          if(uploaded){s.backup.lastUpload=createdAt;s.backup.pending=0;}else s.backup.pending++;
          const description=uploaded?'จำลองสำรองและอัปโหลดสำเร็จ':'จำลองสร้างสำเนา รออัปโหลด';
          s.backup.history.push({id:uuid(),createdAt,status:uploaded?'uploaded':'pending',simulated:true,action:'DEMO_BACKUP',description,userId:actor.id});
          audit(s,'DEMO_BACKUP',description,actor.id);return s.backup;
        });
      },
      setOnline(online) { if(typeof online!=='boolean')error('INVALID_STATUS','สถานะเครือข่ายไม่ถูกต้อง');return transaction(s=>{s.online=online;return online;}); }
    };
  }
  return {createStore,money,parseMoney};
});
