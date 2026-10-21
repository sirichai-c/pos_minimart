(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.POSStockCount=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create(ctx){
    const {getState,request,movement,audit,now,uuid,clone,error,integer,text,safe}=ctx;
    function find(s,id){const c=s.stockCounts.find(c=>c.id===id);if(!c)error('COUNT_NOT_FOUND','ไม่พบรอบนับ');return c;}
    function editable(c){
      if(c.status==='approved')error('COUNT_ALREADY_APPROVED','รอบนับนี้อนุมัติแล้ว');
      if(c.status==='cancelled')error('COUNT_LOCKED','รอบนับนี้ยกเลิกแล้ว');
    }
    function lineOf(c,id){const l=c.lines.find(l=>l.productId===id);if(!l)error('PRODUCT_NOT_IN_COUNT','สินค้าไม่อยู่ในรอบนับ');return l;}
    function details(s,c){return {...clone(c),lines:c.lines.map(l=>{
      const p=s.products.find(p=>p.id===l.productId);
      return {...clone(l),delta:l.countedQty===null?null:safe(l.countedQty-l.expectedQty),
        stale:!['approved','cancelled'].includes(c.status)&&(!p||p.stockVersion!==l.stockVersion),currentQty:p?.stock,
        movements:clone(s.stockMovements.slice(l.movementIndex,c.closedMovementIndex).filter(m=>m.productId===l.productId))};
    })};}
    function complete(s,c){
      if(c.lines.some(l=>l.countedQty===null))error('COUNT_NOT_COMPLETE','กรุณานับสินค้าทุกรายการ รวมสินค้าที่นับได้ศูนย์');
      if(c.lines.some(l=>s.products.find(p=>p.id===l.productId)?.stockVersion!==l.stockVersion))error('COUNT_STALE','มีสต๊อกเคลื่อนไหวหลังเริ่มนับ กรุณาเปิดนับรายการที่เปลี่ยนใหม่');
    }
    return {
      getStockCount(id){const s=getState();return details(s,find(s,id));},
      createStockCount(args){return request('stockCountCreate',args,(s,userId)=>{
        if(s.stockCounts.some(c=>['counting','submitted'].includes(c.status)))error('COUNT_ALREADY_ACTIVE','มีรอบนับที่ยังไม่เสร็จ กรุณาจบรอบเดิมก่อน');
        const name=text(args.name,'ชื่อหรือพื้นที่นับ');
        const ids=args.productIds===undefined?s.products.filter(p=>p.active||p.stock>0).map(p=>p.id):args.productIds;
        if(!Array.isArray(ids)||!ids.length)error('EMPTY_COUNT','เลือกรายการสินค้าอย่างน้อยหนึ่งรายการ');
        const seen=new Set(),id=uuid();
        const lines=ids.map(productId=>{
          if(seen.has(productId))error('DUPLICATE_COUNT_LINE','รายการสินค้าซ้ำ');seen.add(productId);
          const p=s.products.find(p=>p.id===productId);if(!p)error('PRODUCT_NOT_FOUND','ไม่พบสินค้า');
          return {id:uuid(),productId,nameSnapshot:p.name,skuSnapshot:p.sku,barcodeSnapshot:p.barcode,
            expectedQty:p.stock,stockVersion:p.stockVersion,movementIndex:s.stockMovements.length,
            countedQty:null,countedBy:null,countedAt:null,varianceReason:'',revisions:[]};
        });
        const c={id,countNo:'SC1-'+id.replace(/-/g,''),name,status:'counting',scope:args.productIds===undefined?'all':'selected',createdBy:userId,createdAt:now(),lines};
        s.stockCounts.push(c);audit(s,'COUNT_CREATED','เปิดรอบนับ '+c.countNo+' · '+name,userId);return c;
      },true);},
      recordStockCount(args){return request('stockCountRecord',args,(s,userId)=>{
        const c=find(s,args.countId);editable(c);if(c.status!=='counting')error('COUNT_LOCKED','ส่งตรวจแล้ว ต้องให้เจ้าของเปิดนับใหม่ก่อนแก้');
        const l=lineOf(c,args.productId),p=s.products.find(p=>p.id===l.productId);
        if(l.locked)error('COUNT_LOCKED','รายการนี้ส่งตรวจแล้ว ต้องให้เจ้าของเปิดนับรายการนี้ใหม่ก่อนแก้');
        if(!p||p.stockVersion!==l.stockVersion)error('COUNT_STALE','สินค้านี้มี movement ใหม่ ให้เจ้าของเปิดนับใหม่ก่อนกรอก');
        const countedQty=integer(args.countedQty,'ยอดนับจริง'),varianceReason=args.varianceReason===undefined?'':String(args.varianceReason).trim();
        if(l.countedQty!==null)l.revisions.push({kind:'edit',before:{countedQty:l.countedQty,varianceReason:l.varianceReason,countedBy:l.countedBy,countedAt:l.countedAt},after:{countedQty,varianceReason},userId,createdAt:now()});
        Object.assign(l,{countedQty,varianceReason,countedBy:userId,countedAt:now()});
        audit(s,'COUNT_RECORDED',c.countNo+' · '+l.skuSnapshot+' = '+countedQty,userId);return c;
      });},
      reopenStockCountLine(args){return request('stockCountReopen',args,(s,userId)=>{
        const c=find(s,args.countId);editable(c);const l=lineOf(c,args.productId);
        const reason=text(args.reason,'เหตุผลนับใหม่'),p=s.products.find(p=>p.id===l.productId);if(!p)error('PRODUCT_NOT_FOUND','ไม่พบสินค้า');
        const before={expectedQty:l.expectedQty,stockVersion:l.stockVersion,countedQty:l.countedQty,varianceReason:l.varianceReason,countedBy:l.countedBy,countedAt:l.countedAt};
        const after={expectedQty:p.stock,stockVersion:p.stockVersion,countedQty:null};
        l.revisions.push({kind:'recount',before,after:clone(after),reason,userId,createdAt:now()});
        Object.assign(l,after,{locked:false,varianceReason:'',countedBy:null,countedAt:null});
        c.status='counting';audit(s,'COUNT_REOPENED',c.countNo+' · '+l.skuSnapshot+' · '+reason,userId);return c;
      },true);},
      submitStockCount(args){return request('stockCountSubmit',args,(s,userId)=>{
        const c=find(s,args.countId);editable(c);if(c.status!=='counting')error('COUNT_LOCKED','รอบนับนี้ส่งตรวจแล้ว');
        complete(s,c);c.lines.forEach(l=>{l.locked=true;});c.status='submitted';c.submittedAt=now();c.submittedBy=userId;
        audit(s,'COUNT_SUBMITTED','ส่งตรวจ '+c.countNo,userId);return c;
      });},
      approveStockCount(args){return request('stockCountApprove',args,(s,userId)=>{
        const c=find(s,args.countId);editable(c);if(c.status!=='submitted')error('COUNT_NOT_SUBMITTED','ส่งตรวจให้ครบก่อนอนุมัติ');complete(s,c);
        c.lines.forEach(l=>{
          integer(l.countedQty,'ยอดนับจริง');const p=s.products.find(p=>p.id===l.productId);
          if(l.countedQty<integer(p.activeReservedQty??0,'ยอดจอง'))error('RESERVATION_EXCEEDS_STOCK','ยอดนับน้อยกว่ายอดจอง ต้องจัดการรายการจองก่อน');
          if(l.countedQty!==l.expectedQty&&!l.varianceReason.trim())error('VARIANCE_REASON_REQUIRED','ระบุเหตุผลส่วนต่างทุกรายการก่อนอนุมัติ');
        });
        c.lines.forEach(l=>{
          const delta=safe(l.countedQty-l.expectedQty);l.approvedDelta=delta;l.balanceAfter=l.countedQty;
          if(delta!==0){const p=s.products.find(p=>p.id===l.productId);
            const m=movement(s,p,'count_adjustment',delta,l.varianceReason,userId,l.id);m.referenceCountLineId=l.id;l.movementId=m.id;}
        });
        c.closedMovementIndex=s.stockMovements.length;c.status='approved';c.approvedBy=userId;c.approvedAt=now();audit(s,'COUNT_APPROVED','อนุมัติ '+c.countNo,userId);return c;
      },true);},
      cancelStockCount(args){return request('stockCountCancel',args,(s,userId)=>{
        const c=find(s,args.countId);editable(c);c.cancelReason=text(args.reason,'เหตุผลยกเลิก');c.closedMovementIndex=s.stockMovements.length;c.status='cancelled';c.cancelledBy=userId;c.cancelledAt=now();
        audit(s,'COUNT_CANCELLED','ยกเลิก '+c.countNo+' · '+c.cancelReason,userId);return c;
      },true);}
    };
  }
  return {create};
});
