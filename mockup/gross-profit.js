(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.POSGrossProfit=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create({getState,request,user,now,uuid,clone,error,integer,safe,dateKey}){
    function initialize(s){
      s.costLayers=s.products.filter(p=>p.stock>0).map(p=>({id:uuid(),productId:p.id,remaining:p.stock,unitCost:null,source:'opening',createdAt:now()}));
      s.costWriteoffs=[];s.costActivatedAt=now();
    }
    function addLayer(s,productId,quantity,unitCost,source,sourceId){
      if(quantity>0)s.costLayers.push({id:uuid(),productId,remaining:quantity,unitCost,source,sourceId,createdAt:now()});
    }
    function consume(s,productId,quantity){
      let rest=quantity;const allocations=[];
      for(const layer of s.costLayers){
        if(layer.productId!==productId||layer.remaining===0)continue;
        const take=Math.min(rest,layer.remaining);if(!take)break;
        layer.remaining-=take;rest-=take;
        allocations.push({layerId:layer.id,quantity:take,unitCost:layer.unitCost});
        if(!rest)break;
      }
      if(rest)error('COST_LAYER_MISMATCH','ยอดชั้นต้นทุนไม่ตรงกับสต๊อก กรุณาตรวจข้อมูลก่อนทำรายการ');
      return allocations;
    }
    function movement(s,entry){
      if(entry.quantity===0||['sale','void','return_restock'].includes(entry.kind))return;
      if(entry.quantity>0){
        let cost=null;
        if(entry.kind==='purchase_receipt'){
          const line=s.goodsReceipts.flatMap(r=>r.lines).find(l=>l.id===entry.reference);
          if(!line)error('COST_SOURCE_MISSING','ไม่พบต้นทุนจากใบรับสินค้า');
          cost=line.actualUnitCost;
        }
        addLayer(s,entry.productId,entry.quantity,cost,entry.kind,entry.id);
      }else{
        const allocations=consume(s,entry.productId,-entry.quantity);
        entry.costAllocations=allocations;
        s.costWriteoffs.push({id:uuid(),productId:entry.productId,movementId:entry.id,createdAt:entry.createdAt,kind:entry.kind,
          quantity:-entry.quantity,amount:allocations.some(a=>a.unitCost===null)?null:safe(allocations.reduce((n,a)=>safe(n+safe(a.quantity*a.unitCost)),0))});
      }
    }
    function sale(s,sale){sale.items.forEach(line=>{line.costAllocations=consume(s,line.productId,line.quantity);});}
    function reversedAllocations(source,prior,quantity){
      const spent=new Map();for(const r of prior)for(const a of r.costAllocations||[])spent.set(a.layerId,(spent.get(a.layerId)||0)+a.quantity);
      let rest=quantity,result=[];
      for(const a of (source.costAllocations||[]).slice().reverse()){
        const available=a.quantity-(spent.get(a.layerId)||0),take=Math.min(rest,available);
        if(take>0){result.push({layerId:a.layerId,quantity:take,unitCost:a.unitCost});rest-=take;}
        if(!rest)break;
      }
      if(rest&&source.costAllocations)error('COST_REVERSAL_MISMATCH','ยอดต้นทุนคืนสินค้าเกินยอดที่ขาย');
      return result;
    }
    function restore(s,productId,allocations,restockQuantity,sourceId,damagedQuantity){
      let rest=restockQuantity;
      for(const a of allocations){
        const take=Math.min(rest,a.quantity);
        addLayer(s,productId,take,a.unitCost,'return',sourceId);rest-=take;
      }
      if(rest>0)addLayer(s,productId,rest,null,'return',sourceId);
      if(damagedQuantity>0){
        let skip=restockQuantity,amount=0,unknown=false;
        for(const a of allocations){const used=Math.max(0,Math.min(a.quantity,skip));skip-=used;const qty=a.quantity-used;
          if(qty){if(a.unitCost===null)unknown=true;else amount=safe(amount+safe(qty*a.unitCost));}}
        s.costWriteoffs.push({id:uuid(),productId,returnLineId:sourceId,createdAt:now(),kind:'damaged_return',quantity:damagedQuantity,amount:unknown||!allocations.length?null:amount});
      }
    }
    function returned(s,entry,source,priorReturns){
      entry.lines.forEach(line=>{
        const original=source.items.find(item=>item.id===line.saleLineId);
        const prior=priorReturns.flatMap(r=>r.lines.filter(l=>l.saleLineId===line.saleLineId));
        line.costAllocations=reversedAllocations(original,prior,line.quantity);
        restore(s,line.productId,line.costAllocations,line.restockQuantity,line.id,line.damagedQuantity);
      });
    }
    function voided(s,sale){sale.items.forEach(line=>{
      if(line.costAllocations)for(const a of line.costAllocations)addLayer(s,line.productId,a.quantity,a.unitCost,'void',sale.id);
      else addLayer(s,line.productId,line.quantity,null,'void',sale.id);
    });}
    function report(args={}){
      user(getState(),args.userId,true);
      const s=getState(),groupBy=args.groupBy||'day';
      if(!['day','product','shift'].includes(groupBy))error('INVALID_GROUP','กลุ่มรายงานไม่ถูกต้อง');
      if(args.from&&(!/^\d{4}-\d{2}-\d{2}$/.test(args.from)||Number.isNaN(Date.parse(args.from))))error('INVALID_DATE','วันที่เริ่มไม่ถูกต้อง');
      if(args.to&&(!/^\d{4}-\d{2}-\d{2}$/.test(args.to)||Number.isNaN(Date.parse(args.to))))error('INVALID_DATE','วันที่สิ้นสุดไม่ถูกต้อง');
      const rows=new Map();
      function add(timestamp,productId,shiftId,reference,kind,revenue,allocations,quantity){
        const day=dateKey(timestamp);if(args.from&&day<args.from||args.to&&day>args.to)return;
        const key=groupBy==='day'?day:groupBy==='product'?productId:shiftId;
        if(!rows.has(key))rows.set(key,{key,revenue:0,cogsKnown:0,knownQuantity:0,unknownQuantity:0,quantity:0,events:[]});
        const row=rows.get(key),known=(allocations||[]).filter(a=>a.unitCost!==null);
        const unknown=Math.abs(quantity)-known.reduce((n,a)=>n+a.quantity,0);
        const cost=known.reduce((n,a)=>safe(n+safe(a.quantity*a.unitCost)),0);
        row.revenue=safe(row.revenue+revenue);row.cogsKnown=safe(row.cogsKnown+Math.sign(quantity)*cost);
        row.knownQuantity+=Math.sign(quantity)*known.reduce((n,a)=>n+a.quantity,0);row.unknownQuantity+=Math.sign(quantity)*unknown;row.quantity+=quantity;
        row.events.push({timestamp,reference,kind,productId,revenue,cogs:unknown?null:Math.sign(quantity)*cost,quantity});
      }
      for(const sale of s.sales){for(const line of sale.items){
        if(!line.costAllocations)continue; // Sales before activation have no historical cost snapshot.
        add(sale.createdAt,line.productId,sale.shiftId,sale.receiptNo,'sale',line.netTotal??line.total,line.costAllocations,line.quantity);
        if(sale.voidedAt)add(sale.voidedAt,line.productId,sale.shiftId,sale.receiptNo,'void',-(line.netTotal??line.total),line.costAllocations,-line.quantity);
      }}
      for(const entry of s.returns){const sale=s.sales.find(x=>x.id===entry.saleId);if(!sale)continue;
        for(const line of entry.lines)if(line.costAllocations?.length)add(entry.createdAt,line.productId,entry.shiftId,entry.returnNo,'return',-line.total,line.costAllocations,-line.quantity);
      }
      const result=[...rows.values()].sort((a,b)=>String(a.key).localeCompare(String(b.key))).map(row=>({...row,cogs:row.unknownQuantity?null:row.cogsKnown,
        profit:row.unknownQuantity?null:safe(row.revenue-row.cogsKnown),coverage:row.quantity===0?1:row.knownQuantity/row.quantity}));
      return {groupBy,from:args.from||null,to:args.to||null,activatedAt:s.costActivatedAt,rows:result,writeoffs:clone(s.costWriteoffs)};
    }
    return {initialize,addLayer,movement,sale,returned,voided,report,consume};
  }
  return {create};
});
