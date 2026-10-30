# Runbook: อัปเกรดและถอยกลับ

ทำช่วงปิดร้านเท่านั้น และทดสอบกับสำเนาข้อมูลก่อนทุกครั้ง (R08)

## อัปเกรด

1. ปิดกะให้เรียบร้อย แล้วหยุด server: `Stop-ScheduledTask -TaskName BaandeePOS`
2. เก็บโฟลเดอร์โปรแกรมเดิมไว้ทั้งชุด (เช่น เปลี่ยนชื่อเป็น `pos-0.1.0`)
3. วางโปรแกรมรุ่นใหม่ แล้วติดตั้งตาม lockfile และ build
   ```powershell
   npm ci
   npm run check
   npm run build
   ```
4. รัน migration (คำสั่งสร้าง snapshot ก่อน migrate เสมอ ถ้า snapshot ไม่สำเร็จจะไม่ migrate)
   ```powershell
   $env:POS_DATA_DIR = "$env:ProgramData\BaandeePOS"
   npm run migrate
   ```
5. เปิด server: `Start-ScheduledTask -TaskName BaandeePOS` ล็อกอิน เปิดกะทดลอง ขาย 1 บิล แล้วยกเลิกบิลนั้น
6. ตรวจหน้า **ระบบและสำรองข้อมูล** ว่า schema เป็นเลขใหม่และ snapshot ล่าสุดสำเร็จ

## ถอยกลับ

- ถ้ารุ่นใหม่ **ไม่ได้** เปลี่ยน schema: หยุด server แล้วสลับกลับไปโฟลเดอร์โปรแกรมเดิม
- ถ้ารุ่นใหม่เปลี่ยน schema แล้ว: **ห้าม** ใช้โปรแกรมรุ่นเก่ากับฐานข้อมูลใหม่ (server รุ่นเก่าจะปฏิเสธเอง) ให้สลับโปรแกรมกลับ แล้ว `npm run restore` ด้วย snapshot ที่ `npm run migrate` สร้างไว้ก่อน migrate จากนั้นกระทบยอดรายการที่ทำหลังอัปเกรดตาม [restore](restore.md)
