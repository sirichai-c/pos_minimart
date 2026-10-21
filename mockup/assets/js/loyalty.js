(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.POSLoyalty=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create({getState,request,user,audit,now,uuid,clone,error,integer,text,safe}){
    const POLICY='LO-1';
    function normalize(phone){if(typeof phone!=='string')error('INVALID_PHONE','เบอร์โทรศัพท์ไม่ถูกต้อง');let digits=phone.replace(/[\s()+-]/g,'');
      if(/^66\d{9}$/.test(digits))digits='0'+digits.slice(2);
      if(!/^0\d{8,9}$/.test(digits))error('INVALID_PHONE','กรุณาระบุเบอร์โทรศัพท์ที่ถูกต้อง');return digits;}
    function balance(s,id){return s.loyaltyEntries.filter(e=>e.memberId===id).reduce((n,e)=>safe(n+e.delta),0);}
    function entry(s,memberId,sourceType,sourceId,kind,delta){if(!delta)return;
      if(s.loyaltyEntries.some(e=>e.sourceType===sourceType&&e.sourceId===sourceId&&e.kind===kind))error('LOYALTY_DUPLICATE','รายการแต้มซ้ำ');
      s.loyaltyEntries.push({id:uuid(),memberId,sourceType,sourceId,kind,delta,createdAt:now()});}
    function saveMember(args){return request('memberSave',args,(s,userId)=>{
      const old=args.memberId?s.members.find(m=>m.id===args.memberId):null;
      if(args.memberId&&!old)error('MEMBER_NOT_FOUND','ไม่พบสมาชิก');
      if(!old&&args.consent!==true)error('CONSENT_REQUIRED','ต้องได้รับความยินยอมก่อนสมัครสมาชิก');
      const name=text(args.name,'ชื่อสมาชิก'),phone=normalize(args.phone);
      if(name.length>100)error('INVALID_NAME','ชื่อสมาชิกยาวเกินไป');
      if(s.members.some(m=>m.id!==old?.id&&m.phone===phone))error('DUPLICATE_MEMBER_PHONE','เบอร์นี้มีสมาชิกแล้ว');
      if(args.active!==undefined&&typeof args.active!=='boolean')error('INVALID_STATUS','สถานะสมาชิกไม่ถูกต้อง');
      const updated={id:old?.id||uuid(),memberNo:old?.memberNo||'MB1-'+uuid().replace(/-/g,''),name,phone,active:args.active===undefined?old?.active!==false:args.active,
        consentAt:old?.consentAt||now(),createdAt:old?.createdAt||now(),updatedAt:now()};
      if(old)Object.assign(old,updated);else s.members.push(updated);
      audit(s,old?'MEMBER_UPDATED':'MEMBER_CREATED',updated.memberNo,userId);return updated;
    },true);}
    function lookupMember(args){user(getState(),args.userId);const s=getState(),phone=normalize(args.phone),m=s.members.find(m=>m.phone===phone);
      if(!m)return null;return {id:m.id,memberNo:m.memberNo,name:m.name,phoneMasked:m.phone.slice(0,3)+'****'+m.phone.slice(-3),active:m.active,balance:balance(s,m.id)};}
    function getMember(args){user(getState(),args.userId,true);const s=getState(),m=s.members.find(m=>m.id===args.memberId);if(!m)error('MEMBER_NOT_FOUND','ไม่พบสมาชิก');
      return {...clone(m),balance:balance(s,m.id),history:clone(s.loyaltyEntries.filter(e=>e.memberId===m.id))};}
    function pointsBalance(memberId){const s=getState();if(!s.members.some(m=>m.id===memberId))error('MEMBER_NOT_FOUND','ไม่พบสมาชิก');return balance(s,memberId);}
    function distribute(sale,discount){
      const gross=sale.items.reduce((n,l)=>safe(n+l.total),0);
      const shares=sale.items.map(l=>{const numerator=BigInt(discount)*BigInt(l.total),denominator=BigInt(gross||1);
        return {line:l,base:Number(numerator/denominator),remainder:numerator%denominator};});
      let left=discount-shares.reduce((n,x)=>n+x.base,0);
      shares.sort((a,b)=>a.remainder===b.remainder?a.line.id.localeCompare(b.line.id):a.remainder>b.remainder?-1:1);
      for(const x of shares){x.line.discount=x.base+(left>0?1:0);if(left>0)left--;}
      for(const l of sale.items){const base=Math.floor(l.discount/l.quantity),remainder=l.discount%l.quantity;
        l.unitDiscounts=Array.from({length:l.quantity},(_,i)=>({ordinal:i+1,discount:base+(i<remainder?1:0),returnedBy:null}));
        l.netTotal=safe(l.total-l.discount);
        if(l.unitDiscounts.some(u=>u.discount>l.unitPrice))error('INVALID_REDEMPTION','ส่วนลดต่อหน่วยเกินราคา');
      }
    }
    function onSale(s,sale,args={}){
      const memberId=args.memberId||null,redeem=integer(args.redeemPoints??0,'แต้มที่ใช้');
      let member=null;if(memberId){member=s.members.find(m=>m.id===memberId);if(!member)error('MEMBER_NOT_FOUND','ไม่พบสมาชิก');if(!member.active)error('MEMBER_INACTIVE','สมาชิกปิดใช้งาน');}
      else if(redeem)error('INVALID_REDEMPTION','ต้องเลือกสมาชิกก่อนใช้แต้ม');
      const gross=sale.items.reduce((n,l)=>safe(n+l.total),0);
      if(redeem>gross)error('INVALID_REDEMPTION','ส่วนลดเกินยอดสินค้า');
      if(member&&balance(s,memberId)<redeem)error('INSUFFICIENT_POINTS','แต้มไม่พอใช้');
      const due=safe(gross-redeem);
      sale.memberId=memberId;sale.loyaltyPolicyVersion=member?POLICY:null;sale.gross=gross;sale.discount=redeem;sale.cashDue=due;
      sale.redeemPoints=redeem;sale.pointsEarned=member?Math.floor(due/100):0;sale.total=due;
      distribute(sale,redeem);
      if(member){entry(s,memberId,'sale',sale.id,'REDEEM',-redeem);entry(s,memberId,'sale',sale.id,'EARN',sale.pointsEarned);}
      return due;
    }
    function refundPreview(sale,inputs){let total=0,restored=0;const details=[];
      for(const input of inputs){const l=sale.items.find(x=>x.id===input.saleLineId);if(!l)error('INVALID_RETURN_LINE','ไม่พบรายการขาย');
        const count=integer(input.quantity,'จำนวนคืน');const units=(l.unitDiscounts||Array.from({length:l.quantity},(_,i)=>({ordinal:i+1,discount:0,returnedBy:null}))).filter(u=>!u.returnedBy).slice(0,count);
        if(units.length!==count)error('RETURN_QUANTITY_EXCEEDED','จำนวนคืนเกินยอด');
        const discount=units.reduce((n,u)=>n+u.discount,0),cash=safe(count*l.unitPrice-discount);
        details.push({saleLineId:l.id,ordinals:units.map(u=>u.ordinal),discount,cash});total=safe(total+cash);restored=safe(restored+discount);
      }return {total,pointsRestored:restored,details};
    }
    function onReturn(s,sale,record){const preview=refundPreview(sale,record.lines);
      record.lines.forEach((line,i)=>{const d=preview.details[i],source=sale.items.find(l=>l.id===line.saleLineId);
        line.discount=d.discount;line.total=d.cash;line.unitOrdinals=d.ordinals;
        if(source.unitDiscounts)for(const unit of source.unitDiscounts)if(d.ordinals.includes(unit.ordinal))unit.returnedBy=line.id;
      });
      record.total=preview.total;record.pointsRestored=preview.pointsRestored;record.pointsReversed=0;
      if(sale.memberId){
        const prior=s.returns.filter(r=>r.saleId===sale.id).reduce((n,r)=>safe(n+r.total),0),retained=safe(sale.total-prior-record.total);
        const target=Math.floor(retained/100),reversedSoFar=s.loyaltyEntries.filter(e=>e.sourceType==='return'&&e.kind==='EARN_REVERSAL'&&s.returns.some(r=>r.id===e.sourceId&&r.saleId===sale.id)).reduce((n,e)=>n-e.delta,0);
        const delta=sale.pointsEarned-reversedSoFar-target;
        if(delta<0)error('LOYALTY_MISMATCH','ยอดแต้มคืนไม่ตรงกับบิล');
        record.pointsReversed=delta;entry(s,sale.memberId,'return',record.id,'REDEEM_RESTORE',preview.pointsRestored);
        entry(s,sale.memberId,'return',record.id,'EARN_REVERSAL',-delta);
      }
    }
    function onVoid(s,sale){if(!sale.memberId)return;
      entry(s,sale.memberId,'void',sale.id,'REDEEM_RESTORE',sale.redeemPoints);
      entry(s,sale.memberId,'void',sale.id,'EARN_REVERSAL',-sale.pointsEarned);
    }
    function report(args={}){user(getState(),args.userId,true);const s=getState(),active=s.members.filter(m=>m.active).length;
      const totals={earned:0,redeemed:0,restored:0,reversed:0};for(const e of s.loyaltyEntries){if(e.kind==='EARN')totals.earned+=e.delta;
        if(e.kind==='REDEEM')totals.redeemed-=e.delta;if(e.kind==='REDEEM_RESTORE')totals.restored+=e.delta;
        if(e.kind==='EARN_REVERSAL')totals.reversed-=e.delta;}
      return {active,balances:s.members.map(m=>({memberId:m.id,name:m.name,balance:balance(s,m.id)})),totals};}
    return {saveMember,lookupMember,getMember,pointsBalance,onSale,onReturn,onVoid,refundPreview,report};
  }
  return {create};
});
