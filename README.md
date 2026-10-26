# บ้านดี POS

โปรเจกต์ออกแบบระบบขายหน้าร้านสำหรับร้านค้าปลีก ปัจจุบันมี **สเปก MVP** และ **หน้าเว็บตัวอย่าง 13 หน้าสำหรับทดลองการใช้งาน** ยังไม่มีระบบขายจริงหรือฐานข้อมูลร้าน

## เปิดหน้าเว็บตัวอย่าง

จากโฟลเดอร์โปรเจกต์ รันคำสั่งนี้ใน PowerShell:

```powershell
py -m http.server 4173 --bind 127.0.0.1 --directory mockup
```

แล้วเปิด [http://127.0.0.1:4173/](http://127.0.0.1:4173/) ใน Chrome หรือ Edge กด `Ctrl+C` ในหน้าต่าง PowerShell เพื่อหยุดเซิร์ฟเวอร์ หรือเปิด `mockup/index.html` โดยตรงได้

หน้าเว็บมีข้อมูลตัวอย่างสำหรับลองขายเงินสด ออกใบเสร็จ คืนสินค้า จัดซื้อและรับของ ตรวจนับสต๊อก ดูกำไรขั้นต้น รับออเดอร์จองสินค้า และสะสม/ใช้แต้มสมาชิก รายละเอียดวิธีลองใช้อยู่ใน [คู่มือ mockup](mockup/README.md)

ไฟล์หน้าเว็บอยู่ที่ `mockup/index.html` โดยแยกสไตล์ไว้ใน `mockup/assets/css/`, JavaScript ใน `mockup/assets/js/` และภาพสินค้าใน `mockup/assets/products/` ข้อมูลทดลองเก็บใน `localStorage` ของเบราว์เซอร์

## สถานะโมดูล

| โมดูล | สิ่งที่ทดลองได้ใน mockup | สเปก |
| --- | --- | --- |
| 1 คืนสินค้าและคืนเงินสด | คืนบางรายการหรือข้ามกะ, แยกของขายต่อได้/เสียหาย, พิมพ์เอกสารเดิม | [รายละเอียด](plan/pos-returns-refunds-spec.md) |
| 2 จัดซื้อและรับสินค้า | ซัพพลายเออร์, PO, รับบางส่วน, ยอดค้างรับและรายงาน | [รายละเอียด](plan/pos-purchasing-receiving-spec.md) |
| 3 ตรวจนับสต๊อก | เปิดรอบนับ, กรอก/ส่งตรวจ, นับใหม่, อนุมัติและดู movement | [รายละเอียด](plan/pos-stock-count-spec.md) |
| 4 กำไรขั้นต้น | ชั้นต้นทุน FIFO, ต้นทุนไม่ทราบ, รายงานแยกสินค้า/วัน/กะ | [รายละเอียด](plan/pos-gross-profit-spec.md) |
| 5 ออเดอร์และจองสินค้า | กันจำนวนที่ขายได้, เตรียมของ, รับเงินและออกบิลเมื่อมารับ | [รายละเอียด](plan/pos-orders-reservations-spec.md) |
| 6 สมาชิกและแต้ม | สมัครสมาชิก, ใช้/รับแต้ม, กลับแต้มเมื่อคืนหรือยกเลิกบิล | [รายละเอียด](plan/pos-membership-points-spec.md) |

ทั้ง 6 โมดูลเป็นการจำลองในเบราว์เซอร์ แผนงานที่ยังต้องทำก่อนใช้ขายจริงอยู่ใน [production-readiness.md](plan/production-readiness.md)

## ไฟล์สำคัญ

| ตำแหน่ง | เนื้อหา |
| --- | --- |
| [plan/pos-mvp-spec.md](plan/pos-mvp-spec.md) | เป้าหมาย ขอบเขต กติกาธุรกิจ สถาปัตยกรรมที่เสนอ และเกณฑ์รับงาน |
| [plan/pos-returns-refunds-spec.md](plan/pos-returns-refunds-spec.md) | กติกาคืนสินค้าและคืนเงินสด รวมเกณฑ์รับงานของโมดูลนี้ |
| [plan/pos-purchasing-receiving-spec.md](plan/pos-purchasing-receiving-spec.md) | กติกาจัดซื้อ PO ใบรับสินค้า และยอดค้างรับ |
| [plan/production-readiness.md](plan/production-readiness.md) | งานที่ยังต้องทำและเกณฑ์ตรวจรับก่อนใช้ POS ขายจริง |
| [plan/implementation-plan.md](plan/implementation-plan.md) | โครงไฟล์ interfaces งานย่อย และคำสั่งตรวจรับของระบบจริง |
| [plan/pos-stock-count-spec.md](plan/pos-stock-count-spec.md) | รอบตรวจนับ ส่งตรวจ อนุมัติส่วนต่าง และตรวจสต๊อกที่เคลื่อนไหวระหว่างนับ |
| [plan/pos-gross-profit-spec.md](plan/pos-gross-profit-spec.md) | กติกาต้นทุน FIFO และรายงานกำไรขั้นต้น |
| [plan/pos-orders-reservations-spec.md](plan/pos-orders-reservations-spec.md) | กติกาออเดอร์และการจองสินค้า |
| [plan/pos-membership-points-spec.md](plan/pos-membership-points-spec.md) | กติกาสมาชิก ส่วนลด และแต้มสะสม |
| [mockup/index.html](mockup/index.html) | หน้าเว็บตัวอย่างภาษาไทย เปิดได้โดยไม่ติดตั้งแพ็กเกจ |
| [mockup/README.md](mockup/README.md) | วิธีใช้หน้าจอ ปุ่มลัด และขอบเขตของตัวอย่าง |
| ไฟล์ `mockup/*.test.cjs` | ชุดทดสอบกติกาขาย คืนสินค้า จัดซื้อ ตรวจนับ กำไรขั้นต้น ออเดอร์จอง สมาชิก/แต้ม และหน้าจอ |

## ตรวจสอบ

ต้องมี Node.js สำหรับรันชุดทดสอบ จากโฟลเดอร์โปรเจกต์:

```powershell
node --test --test-isolation=none mockup/store.test.cjs mockup/returns.test.cjs mockup/views.test.cjs mockup/purchasing.test.cjs mockup/purchasing.views.test.cjs mockup/stock-count.test.cjs mockup/stock-count.views.test.cjs mockup/gross-profit.test.cjs mockup/orders.test.cjs mockup/orders.views.test.cjs mockup/loyalty.test.cjs mockup/loyalty.views.test.cjs
```

ผลตรวจล่าสุด (22 ต.ค. 2026): ผ่าน 85/85 รายการ

หน้าเว็บตัวอย่างเก็บข้อมูลใน `localStorage` ของเบราว์เซอร์ สามารถเริ่มข้อมูลตัวอย่างใหม่ได้จากหน้า **ระบบและข้อมูล** ข้อมูลของ URL แบบ `file://` กับ `http://127.0.0.1` แยกจากกัน

สเปกใน `plan/` ยังเป็นฉบับเสนอสำหรับทบทวน ส่วน React, Fastify, SQLite, การยืนยันตัวตนจริง และ cloud backup เป็นงานของระบบจริงที่ยังไม่ได้พัฒนาในโปรเจกต์นี้
