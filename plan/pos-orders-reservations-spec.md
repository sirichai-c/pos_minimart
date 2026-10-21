# POS โมดูล 5 — รับออเดอร์และจองสินค้า

วันที่: 21 ตุลาคม 2026 · ฉบับ 0.1 · สถานะ: สเปกสำหรับทบทวนก่อนแตกงานพัฒนา

เอกสารนี้ขยาย [POS MVP](pos-mvp-spec.md) ให้ร้านรับคำสั่งซื้อจากช่องทางอื่นแบบกรอกเอง จองของที่มีอยู่ และให้ลูกค้ามารับพร้อมชำระเงินสดที่ร้าน ใช้ catalog, stock balance, sale, shift และ idempotency ของ POS เดิม รวมถึงกติกาการนับของจาก [โมดูลตรวจนับสต๊อก](pos-stock-count-spec.md)

## 1. เป้าหมายและขอบเขต

พนักงานรับคำสั่งซื้อทางโทรศัพท์/แชตแล้วบันทึกสินค้า จำนวน ชื่อลูกค้า/ช่องทางติดต่อ และวันหมดเวลาจอง เมื่อยืนยันการจอง ระบบกันจำนวนสินค้าจากการขายหน้าร้าน โดย **ยังไม่ตัดสต๊อกและยังไม่รับเงิน** เมื่อลูกค้ามารับ ร้านขายเงินสดตามบิลที่ผูกกับออเดอร์และเปลี่ยนสถานะเป็นรับแล้ว

รุ่นแรกเป็น **รับเองที่ร้านครั้งเดียวครบทั้งออเดอร์** ใช้สินค้าที่มี on-hand อยู่แล้ว ไม่มี backorder จัดส่ง ผ่อนชำระ มัดจำ ชำระออนไลน์ รับบางส่วน หรือเชื่อม LINE/marketplace อัตโนมัติ ออเดอร์ที่ยังไม่ชำระไม่ใช่ยอดขาย การเปลี่ยนสินค้าหลังยืนยันจองให้ยกเลิกและสร้างออเดอร์ใหม่เพื่อลดความซับซ้อนของการกันของ

**สมมติฐานเพื่อทบทวน:** จองมาตรฐาน 48 ชั่วโมงจากเวลายืนยัน โดย owner เปลี่ยนเวลาได้ก่อนยืนยัน; จำกัดสูงสุด 7 วัน และใช้เวลาเครื่อง API ในร้านเป็นข้อยุติ หากร้านมีนโยบายจองต่างจากนี้ให้แก้ก่อนพัฒนา

## 2. การตัดสินใจเรื่องสต๊อกและราคา

```text
on_hand = ผลรวม stock movements ที่เป็นของจริงในร้าน
reserved = ผลรวมจำนวนในออเดอร์สถานะ reserved/ready ที่ยังไม่หมดเวลา
available_to_sell = on_hand − reserved
```

การจองไม่สร้าง stock movement เพราะของยังอยู่ในร้าน แต่ checkout ปกติและการจองใหม่ต้องตรวจ `available_to_sell` ฝั่ง API ใน transaction เดียว ของจองยังนับเป็นของจริงในรอบตรวจนับ; หากพบของจริงน้อยกว่าจำนวนที่จอง ต้องแก้ปัญหาออเดอร์ก่อนอนุมัติการปรับยอดตามโมดูล 3 การแยก On hand / Committed / Available เป็นแนวทางที่ใช้ใน [Shopify inventory states](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/track-and-adjust-inventory) และการจอง draft order จะกันไม่ให้ขายของชิ้นเดียวกันแก่ลูกค้ารายอื่นตาม [Shopify draft orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft)

ราคาขายของแต่ละรายการ snapshot ตอนยืนยันจองและเป็นราคาที่ใช้ชำระเมื่อมารับ แม้ราคาใน catalog เปลี่ยนภายหลัง พนักงานต้องเห็นราคาที่เคยตกลงก่อนรับเงิน; สินค้าที่ถูกปิดจำหน่ายก่อนรับต้องให้ owner ตัดสินใจยกเลิกออเดอร์ ไม่บังคับขายสินค้า inactive

## 3. สถานะและขั้นตอนใช้งาน

```text
draft ──confirm/reserve──> reserved ──mark-ready──> ready
  │                          │                     │
  └──cancel───────────────────┴──cancel─────────────┘
                             └──expire─────────────┘
                         ready/reserved ──checkout──> completed
```

1. `cashier` หรือ `owner` สร้าง draft จากสินค้าใน catalog จำนวนเต็มบวก ช่องทางที่ได้รับคำสั่งซื้อ และข้อมูลติดต่อเท่าที่จำเป็น Draft ยังไม่กันของและแก้ไข/ยกเลิกได้
2. ตรวจราคาและยอดคงเหลือแล้วกด `confirm` API ตรวจ `on_hand − reserved` ใหม่และจองทุก line พร้อมกัน หรือปฏิเสธทั้งออเดอร์หากของไม่พอ บันทึก `expires_at` และเลขออเดอร์ถาวร
3. พนักงานค้นออเดอร์จากเลขออเดอร์/ชื่อลูกค้า/เบอร์ติดต่อ ทำเครื่องหมาย `ready` เมื่อตระเตรียมของแล้ว สถานะนี้ยังกันสต๊อกเหมือน `reserved`
4. เมื่อมารับ ต้องมีกะขายเปิดอยู่ พนักงานเปิดออเดอร์ ตรวจของและยอดราคา รับเงินสด แล้วส่งคำสั่ง checkout เฉพาะออเดอร์ API สร้าง sale ตาม POS เดิม ใช้ราคาที่จอง ตัด on-hand และปล่อย reservation ใน transaction เดียว พร้อมเชื่อม `sale_id` กลับออเดอร์
5. ออเดอร์ที่หมดเวลา/ถูกยกเลิกปล่อย reservation โดยไม่สร้าง sale หรือ stock movement หากลูกค้ายังต้องการของ ให้สร้างออเดอร์ใหม่และตรวจราคากับสต๊อกปัจจุบัน
6. ออเดอร์ที่ `completed` ไม่ยกเลิกผ่านหน้าออเดอร์ ถ้าบิลขายผิดใช้ void ตามกติกา POS หรือคืนสินค้าใน [โมดูล 1](pos-returns-refunds-spec.md); ไม่คืนสถานะจองเดิมอัตโนมัติ

หากออเดอร์ผูกสมาชิกในโมดูล 6 ให้ใช้ member id ที่ยืนยันแล้วเป็นข้อมูลประกอบ การไม่เป็นสมาชิกไม่ขัดขวางการรับออเดอร์

## 4. กติกาธุรกิจและ invariants

| รหัส | กติกา |
| --- | --- |
| OR01 | ออเดอร์ที่จองแล้วทุก line ต้องมีจำนวนเต็มบวกและสินค้าไม่ซ้ำ; `Σ active_reserved(product) ≤ on_hand(product)` หลังทุกธุรกรรมที่ลด on-hand |
| OR02 | draft ไม่จอง ไม่ขาย ไม่แตะกะ; `confirm` จองทั้งออเดอร์แบบ atomic และ snapshot ราคา/ชื่อ/SKU/จำนวน |
| OR03 | checkout ปกติใช้ `available_to_sell`; checkout ของออเดอร์ใช้ reservation ของออเดอร์นั้นและห้ามดึง reservation ของคนอื่น |
| OR04 | `checkoutOrder` ตรวจสถานะยังไม่หมดเวลา, สินค้าครบ, กะเปิด, cash tendered และสิทธิ์ แล้วบันทึก sale, sale lines, payment, stock movements, reserve release, order completed, audit และ idempotency result ใน transaction เดียว |
| OR05 | หนึ่งออเดอร์สร้าง sale ได้สูงสุดหนึ่งใบ: `UNIQUE(sale.order_id)`; คำขอซ้ำ key/payload เดิมคืน sale เดิม; key ใหม่หลัง completed ต้องไม่ขายซ้ำ |
| OR06 | ยกเลิกหรือหมดเวลาจองปล่อย reserve ครั้งเดียว; status transition ต้อง atomic/idempotent; ออเดอร์ที่ completed ห้าม cancel/expire |
| OR07 | ทุก API ที่คำนวณ available ต้องทำให้ reservation หมดเวลาที่ถึงกำหนดถูกปล่อยหรือไม่นับก่อนตรวจ ทั้งตอน service เริ่มและเมื่อมีคำขอ ไม่พึ่ง timer เบราว์เซอร์ |
| OR08 | การคืน/void ของ sale ที่มาจากออเดอร์ทำตามกติกาบิลขาย ไม่สร้าง reservation กลับอัตโนมัติ; ประวัติออเดอร์ยังลิงก์บิล/return ได้ |
| OR09 | เมื่อมี count/adjustment ที่ทำให้ `on_hand < reserved` ให้ปฏิเสธหรือจัดการออเดอร์ก่อน ไม่ปล่อย `available_to_sell` ติดลบแบบเงียบ ๆ |
| OR10 | ข้อมูลติดต่อใช้เพื่อประสานรับของเท่านั้นในรุ่นนี้ จำกัดการอ่านตามบทบาท และไม่ใส่ข้อมูลติดต่อเต็มใน log ทั่วไป |

## 5. โมเดลข้อมูลและ API ที่เสนอ

| ตาราง/ส่วน | ฟิลด์สำคัญ | ข้อบังคับ |
| --- | --- | --- |
| `customer_orders` | `id`, `order_no`, `status`, `source_channel`, `contact_name`, `contact_phone`, `created_by`, `confirmed_at`, `expires_at`, `completed_at`, `sale_id` | เลขออเดอร์ไม่ซ้ำ; `sale_id` unique nullable |
| `customer_order_lines` | `id`, `order_id`, `product_id`, `sku_snapshot`, `name_snapshot`, `quantity`, `unit_price_cents` | `UNIQUE(order_id, product_id)`; จำนวนบวก |
| `inventory_reservations` | `id`, `order_line_id`, `product_id`, `quantity`, `status`, `released_at` | active reserve ต่อ order line ไม่ซ้ำ; release ครั้งเดียว |
| `sales` | เพิ่ม `order_id` nullable | `UNIQUE(order_id)` สำหรับบิลจากออเดอร์ |
| `idempotency_requests` / `audit_log` | action `order_confirm/order_cancel/order_expire/order_checkout` | เก็บผลคำขอเดิมและผู้ทำ |

API ตัวอย่าง: `POST /api/orders`, `GET /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/confirm`, `POST /api/orders/{id}/ready`, `POST /api/orders/{id}/cancel`, `POST /api/orders/{id}/checkout`, `GET /api/products/{id}/availability` ทุกคำสั่งเปลี่ยนสถานะใช้ request key ตาม POS; owner/cashier ใช้ตามบทบาทที่กำหนด และตรวจ session ฝั่ง API

ข้อผิดพลาดหลัก: `INSUFFICIENT_AVAILABLE_STOCK`, `ORDER_EXPIRED`, `ORDER_ALREADY_COMPLETED`, `ORDER_NOT_RESERVED`, `PRODUCT_INACTIVE`, `NO_OPEN_SHIFT`, `PRICE_CHANGED_BEFORE_CONFIRM`, `IDEMPOTENCY_CONFLICT` และข้อผิดพลาดการบันทึกเดิม

## 6. ตัวอย่างและรายงาน

มีน้ำ 10 ขวด ลูกค้า A จอง 4: `on_hand=10, reserved=4, available=6` ลูกค้า B จองอีก 6 ได้ แต่ขายหน้าร้านขวดที่ 11 ไม่ได้ เมื่อลูกค้า A มารับและชำระ: สร้าง sale 4 ขวด, `on_hand=6, reserved=6, available=0` ถ้า B หมดเวลาจอง: `on_hand=6, reserved=0, available=6` โดยไม่มี stock movement จากการหมดเวลาจอง

รายงานออเดอร์แสดงจำนวน `draft/reserved/ready/completed/cancelled/expired`, จำนวนสินค้าและยอดมูลค่าที่กำลังจอง, ออเดอร์ใกล้หมดเวลา, ออเดอร์ที่แปลงเป็นบิลขายแล้ว และประวัติสถานะ ไม่เอามูลค่าออเดอร์ที่ยังไม่ชำระไปรวมยอดขายหรือเงินสดคาดหวัง

## 7. ลำดับส่งมอบและเกณฑ์ตรวจรับ

1. เพิ่มการคำนวณ `available = on_hand − reserved` ในเส้นทาง checkout และ stock adjustment ที่เกี่ยวข้องก่อนเปิดใช้การจอง
2. ทำ schema/API/state machine พร้อม transaction/idempotency บน production SQLite แล้วเชื่อม UI ค้น/รับออเดอร์และ checkout
3. ทดสอบ race ระหว่างสองออเดอร์/ออเดอร์กับขายหน้าร้าน/หมดเวลากับ checkout/void และคืน
4. Pilot การจองที่ยกเลิก หมดเวลา และชำระจริง พร้อมกระทบยอดสต๊อกและเงินกะ

| กรณีตรวจรับ | ผลที่ต้องได้ |
| --- | --- |
| on-hand 10 จอง 4 | on-hand 10, reserved 4, available 6; เงินสด/ยอดขายยังไม่เปลี่ยน |
| สองคำขอจอง 7 จากของ 10 พร้อมกัน | สำเร็จได้หนึ่งออเดอร์ อีกคำขอของไม่พอ ไม่มี oversell |
| ขายหน้าร้านหลังจอง 4 จากของ 10 | ขายได้สูงสุด 6; ของจองไม่ถูกใช้ |
| ลูกค้ามารับและจ่ายเงินสด | sale หนึ่งใบ, stock movement ลดครั้งเดียว, reservation ปล่อยครั้งเดียว, กะรับเงินตามยอดขาย |
| checkout response หายแล้วส่ง key เดิม | ได้ sale เดิม ไม่ตัด stock/เงินซ้ำ |
| หมดเวลาแข่งกับ checkout | สำเร็จได้อย่างใดอย่างหนึ่ง; ไม่เกิด sale ที่ไม่มีของหรือปล่อยของสองครั้ง |
| ยกเลิก/หมดเวลาจอง | available กลับมา; ไม่เกิด sale/stock movement |
| ปิดสินค้าใน catalog ก่อนรับ | ห้าม checkout อัตโนมัติ; owner ตัดสินใจยกเลิกออเดอร์ |
| คืน/void บิลจากออเดอร์ | ใช้กติกาบิลเดิม ไม่สร้าง reservation ใหม่ |

**เกณฑ์พร้อมใช้จริง:** ร้านไม่ขายหรือจองของเกิน on-hand, ไม่มีเงินจากออเดอร์ที่ยังไม่ชำระในรายงานขาย, checkout ออเดอร์เป็นธุรกรรมเดียวกับ POS, และสถานะที่หมดเวลา/คำขอซ้ำตรวจได้บน SQLite จริง
