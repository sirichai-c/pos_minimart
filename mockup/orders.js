(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.POSOrders=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create({getState,request,user,open,movement,audit,gross,summary,now,uuid,clone,error,integer,text,safe}){
    const live=(o,time=Date.now())=>['reserved','ready'].includes(o.status)&&Date.parse(o.expiresAt)>time;
    const find=(s,id)=>{const o=s.orders.find(x=>x.id===id);if(!o)error('ORDER_NOT_FOUND','ไม่พบออเดอร์');return o;};
    function reserved(s,productId,time=Date.now(),excludeOrderId=null){return s.orders.filter(o=>o.id!==excludeOrderId&&live(o,time)).reduce((n,o)=>safe(n+o.lines.filter(l=>l.productId===productId).reduce((v,l)=>safe(v+l.quantity),0)),0);}
    function available(s,productId,time=Date.now()){const p=s.products.find(p=>p.id===productId);if(!p)error('PRODUCT_NOT_FOUND','ไม่พบสินค้า');return safe(p.stock-reserved(s,productId,time));}
    function release(s,order,at){s.reservations.filter(r=>r.orderId===order.id&&!r.releasedAt).forEach(r=>{r.releasedAt=at;});}
    function status(order){return live(order)?order.status:['reserved','ready'].includes(order.status)?'expired':order.status;}
    function lines(s,inputs){
      if(!Array.isArray(inputs)||!inputs.length)error('EMPTY_ORDER','กรุณาเลือกสินค้า');
      const seen=new Set();return inputs.map(input=>{
        const p=s.products.find(p=>p.id===input.productId&&p.active);
        if(!p)error('PRODUCT_UNAVAILABLE','สินค้าไม่พร้อมจำหน่าย');
        if(seen.has(p.id))error('DUPLICATE_ORDER_LINE','สินค้าในออเดอร์ซ้ำ');seen.add(p.id);
        return {id:uuid(),productId:p.id,quantity:integer(input.quantity,'จำนวนสินค้า',1)};
      });
    }
    function saveOrder(args){return request('orderSave',args,(s,userId)=>{
      const old=args.orderId?find(s,args.orderId):null;
      if(old&&old.status!=='draft')error('ORDER_LOCKED','แก้ไขได้เฉพาะออเดอร์ฉบับร่าง');
      const contactName=text(args.contactName,'ชื่อลูกค้า');
      const contactPhone=text(args.contactPhone,'เบอร์ติดต่อ');
      if(contactName.length>100||contactPhone.length>30)error('INVALID_CONTACT','ข้อมูลติดต่อยาวเกินไป');
      if(!['phone','chat','walk_in','other'].includes(args.channel))error('INVALID_CHANNEL','ช่องทางรับออเดอร์ไม่ถูกต้อง');
      const updated={id:old?.id||uuid(),orderNo:old?.orderNo||'OR1-'+uuid().replace(/-/g,''),status:'draft',contactName,contactPhone,channel:args.channel,
        lines:lines(s,args.lines),createdAt:old?.createdAt||now(),createdBy:old?.createdBy||userId,updatedAt:now(),history:old?.history||[]};
      updated.history.push({kind:old?'updated':'draft',at:updated.updatedAt,userId});
      if(old)Object.assign(old,updated);else s.orders.push(updated);
      audit(s,old?'ORDER_UPDATED':'ORDER_DRAFT',updated.orderNo,userId);return updated;
    });}
    function confirmOrder(args){return request('orderConfirm',args,(s,userId)=>{
      const order=find(s,args.orderId);if(order.status!=='draft')error('ORDER_NOT_DRAFT','ออเดอร์นี้ยืนยันแล้ว');
      const hours=args.reserveHours===undefined?48:integer(args.reserveHours,'เวลาจอง',1);
      if(hours>168)error('INVALID_EXPIRY','จองได้ไม่เกิน 7 วัน');
      if(hours!==48)user(s,userId,true);
      const time=now();
      order.lines=order.lines.map(line=>{
        const p=s.products.find(p=>p.id===line.productId&&p.active);
        if(!p)error('PRODUCT_UNAVAILABLE','สินค้าไม่พร้อมจำหน่าย');
        if(available(s,p.id,Date.parse(time))<line.quantity)error('INSUFFICIENT_AVAILABLE_STOCK','สินค้า '+p.name+' ที่ขายได้ไม่พอสำหรับจอง');
        return {...line,name:p.name,sku:p.sku,unitPrice:p.price,total:safe(p.price*line.quantity)};
      });
      order.status='reserved';order.confirmedAt=time;order.expiresAt=new Date(Date.parse(time)+hours*3600000).toISOString();
      order.total=order.lines.reduce((n,l)=>safe(n+l.total),0);
      order.history.push({kind:'reserved',at:time,userId});
      order.lines.forEach(l=>s.reservations.push({id:uuid(),orderId:order.id,orderLineId:l.id,productId:l.productId,quantity:l.quantity,createdAt:time,releasedAt:null}));
      audit(s,'ORDER_RESERVED',order.orderNo,userId);return order;
    });}
    function readyOrder(args){return request('orderReady',args,(s,userId)=>{
      const o=find(s,args.orderId);if(status(o)==='expired')error('ORDER_EXPIRED','ออเดอร์หมดเวลาจองแล้ว');
      if(o.status!=='reserved')error('ORDER_NOT_RESERVED','ออเดอร์ไม่ได้อยู่สถานะจอง');
      o.status='ready';o.readyAt=now();o.history.push({kind:'ready',at:o.readyAt,userId});audit(s,'ORDER_READY',o.orderNo,userId);return o;
    });}
    function cancelOrder(args){return request('orderCancel',args,(s,userId)=>{
      const o=find(s,args.orderId);if(o.status==='completed')error('ORDER_ALREADY_COMPLETED','ออเดอร์ชำระแล้ว');
      if(['cancelled','expired'].includes(o.status))error('ORDER_ALREADY_CLOSED','ออเดอร์ปิดแล้ว');
      if(status(o)==='expired')error('ORDER_EXPIRED','ออเดอร์หมดเวลาจองแล้ว');
      const reason=text(args.reason,'เหตุผลยกเลิก');o.status='cancelled';o.cancelledAt=now();o.cancelReason=reason;release(s,o,o.cancelledAt);
      o.history.push({kind:'cancelled',at:o.cancelledAt,userId});audit(s,'ORDER_CANCELLED',o.orderNo+' · '+reason,userId);return o;
    });}
    function expireOrder(args){return request('orderExpire',args,(s,userId)=>{
      const o=find(s,args.orderId);if(!['reserved','ready'].includes(o.status))error('ORDER_NOT_RESERVED','ออเดอร์ไม่ได้อยู่สถานะจอง');
      if(live(o))error('ORDER_NOT_EXPIRED','ออเดอร์ยังไม่หมดเวลา');
      o.status='expired';o.expiredAt=now();release(s,o,o.expiredAt);o.history.push({kind:'expired',at:o.expiredAt,userId});audit(s,'ORDER_EXPIRED',o.orderNo,userId);return o;
    });}
    function checkoutOrder(args){
      const requestArgs={key:args.key,userId:args.userId,orderId:args.orderId,tendered:args.tendered};
      const sale=request('orderCheckout',requestArgs,(s,userId)=>{
        if(s.pendingCheckout)error('CHECKOUT_UNRESOLVED','กรุณากู้ผลบิลเดิมก่อนขาย');
        if(s.pendingReturn)error('RETURN_UNRESOLVED','กรุณากู้ผลรายการคืนเดิมก่อนขาย');
        const o=find(s,args.orderId);
        if(o.status==='completed')error('ORDER_ALREADY_COMPLETED','ออเดอร์นี้ชำระแล้ว');
        if(status(o)==='expired')error('ORDER_EXPIRED','ออเดอร์หมดเวลาจองแล้ว');
        if(!['reserved','ready'].includes(o.status))error('ORDER_NOT_RESERVED','ออเดอร์ยังไม่จอง');
        const shift=open(s);integer(args.tendered,'เงินรับ');
        if(args.tendered<o.total)error('INSUFFICIENT_CASH','เงินรับไม่พอ');
        for(const l of o.lines){const p=s.products.find(p=>p.id===l.productId);if(!p?.active)error('PRODUCT_INACTIVE','สินค้าปิดจำหน่าย กรุณาให้เจ้าของตรวจออเดอร์');
          if(p.stock-reserved(s,p.id,Date.now(),o.id)<l.quantity)error('INSUFFICIENT_AVAILABLE_STOCK','ของสำหรับออเดอร์ไม่พอ');}
        const id=uuid(),time=now();
        const sale={id,receiptNo:'POS1-'+id.replace(/-/g,''),orderId:o.id,createdAt:time,shiftId:shift.id,userId,
          items:o.lines.map(l=>({id:uuid(),productId:l.productId,name:l.name,sku:l.sku,unitPrice:l.unitPrice,quantity:l.quantity,total:l.total})),
          total:o.total,tendered:args.tendered,change:args.tendered-o.total};
        gross.sale(s,sale);release(s,o,time);o.status='completed';o.completedAt=time;o.saleId=id;o.history.push({kind:'completed',at:time,userId});
        sale.items.forEach(l=>movement(s,s.products.find(p=>p.id===l.productId),'sale',-l.quantity,'รับออเดอร์ '+o.orderNo,userId,id));
        s.sales.push(sale);summary(s,shift.id);audit(s,'ORDER_COMPLETED',o.orderNo+' · '+sale.receiptNo,userId);
        if(args.simulate==='unresolved')s.pendingCheckout={...clone(requestArgs),saleId:id};
        return sale;
      });return args.simulate==='unresolved'?{sale,unresolved:true}:{sale};
    }
    function getOrder(id){return clone({...find(getState(),id),effectiveStatus:status(find(getState(),id))});}
    function orderReport(args={}){user(getState(),args.userId);const s=getState();const counts={draft:0,reserved:0,ready:0,completed:0,cancelled:0,expired:0};let reservedValue=0,reservedQuantity=0;
      for(const o of s.orders){const effective=status(o);counts[effective]++;if(['reserved','ready'].includes(effective)){reservedValue=safe(reservedValue+o.total);reservedQuantity=safe(reservedQuantity+o.lines.reduce((n,l)=>n+l.quantity,0));}}
      return {counts,reservedValue,reservedQuantity,orders:s.orders.map(o=>({...o,effectiveStatus:status(o)}))};}
    return {saveOrder,confirmOrder,readyOrder,cancelOrder,expireOrder,checkoutOrder,getOrder,orderReport,available,reserved};
  }
  return {create};
});
