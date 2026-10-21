# บ้านดี POS

โปรเจกต์ออกแบบระบบขายหน้าร้านสำหรับร้านค้าปลีก ปัจจุบันมี **สเปก MVP** และ **หน้าเว็บตัวอย่างสำหรับทดลองการใช้งาน** ยังไม่มีระบบขายจริงหรือฐานข้อมูลร้าน

## เปิดหน้าเว็บตัวอย่าง

จากโฟลเดอร์โปรเจกต์ รันคำสั่งนี้ใน PowerShell:

```powershell
py -m http.server 4173 --bind 127.0.0.1 --directory mockup
```

แล้วเปิด [http://127.0.0.1:4173/](http://127.0.0.1:4173/) ใน Chrome หรือ Edge กด `Ctrl+C` ในหน้าต่าง PowerShell เพื่อหยุดเซิร์ฟเวอร์ หรือเปิด `mockup/index.html` โดยตรงได้

หน้าเว็บมีข้อมูลตัวอย่างสำหรับลองขายเงินสด ออกใบเสร็จ คืนสินค้าและคืนเงินสดบางส่วนหรือทั้งบิล จัดการสินค้าและสต๊อก ออกใบสั่งซื้อและรับของหลายรอบ ยกเลิกบิล เปิด–ปิดกะ ดูรายงาน และสลับบทบาทเจ้าของร้านกับพนักงานขาย รายละเอียดวิธีลองใช้อยู่ใน [คู่มือ mockup](mockup/README.md)

## ไฟล์สำคัญ

| ตำแหน่ง | เนื้อหา |
| --- | --- |
| [plan/pos-mvp-spec.md](plan/pos-mvp-spec.md) | เป้าหมาย ขอบเขต กติกาธุรกิจ สถาปัตยกรรมที่เสนอ และเกณฑ์รับงาน |
| [plan/pos-returns-refunds-spec.md](plan/pos-returns-refunds-spec.md) | กติกาคืนสินค้าและคืนเงินสด รวมเกณฑ์รับงานของโมดูลนี้ |
| [plan/pos-purchasing-receiving-spec.md](plan/pos-purchasing-receiving-spec.md) | กติกาจัดซื้อ PO ใบรับสินค้า และยอดค้างรับ |
| [plan/production-readiness.md](plan/production-readiness.md) | งานที่ยังต้องทำและเกณฑ์ตรวจรับก่อนใช้ POS ขายจริง |
| [mockup/index.html](mockup/index.html) | หน้าเว็บตัวอย่างภาษาไทย เปิดได้โดยไม่ติดตั้งแพ็กเกจ |
| [mockup/README.md](mockup/README.md) | วิธีใช้หน้าจอ ปุ่มลัด และขอบเขตของตัวอย่าง |
| [mockup/store.test.cjs](mockup/store.test.cjs), [mockup/returns.test.cjs](mockup/returns.test.cjs), [mockup/views.test.cjs](mockup/views.test.cjs), [mockup/purchasing.test.cjs](mockup/purchasing.test.cjs) และ [mockup/purchasing.views.test.cjs](mockup/purchasing.views.test.cjs) | ชุดทดสอบกติกาข้อมูล คืนสินค้า จัดซื้อ และรายงาน |

## ตรวจสอบ

ต้องมี Node.js สำหรับรันชุดทดสอบ จากโฟลเดอร์โปรเจกต์:

```powershell
node --test --test-isolation=none mockup/store.test.cjs mockup/returns.test.cjs mockup/views.test.cjs mockup/purchasing.test.cjs mockup/purchasing.views.test.cjs
```

หน้าเว็บตัวอย่างเก็บข้อมูลใน `localStorage` ของเบราว์เซอร์ สามารถเริ่มข้อมูลตัวอย่างใหม่ได้จากหน้า **ระบบและข้อมูล** ข้อมูลของ URL แบบ `file://` กับ `http://127.0.0.1` แยกจากกัน

สเปกใน `plan/` ยังเป็นฉบับเสนอสำหรับทบทวน ส่วน React, Fastify, SQLite, การยืนยันตัวตนจริง และ cloud backup เป็นงานของระบบจริงที่ยังไม่ได้พัฒนาในโปรเจกต์นี้
