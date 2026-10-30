import { createPortal } from 'react-dom';
import type { SaleResponse } from '@pos/contracts';
import { baht, dateTime } from './ui.tsx';

export const STORE_NAME = 'บ้านดี มินิมาร์ท';

export function Receipt({ sale }: { sale: SaleResponse }) {
  return (
    <div className="receipt-paper">
      <div className="receipt-brand">
        <h3>{STORE_NAME}</h3>
        <p>เครื่องขาย 01<br />ใบเสร็จรับเงิน</p>
        <div className="receipt-id">{sale.billNo}</div>
      </div>
      <div className="receipt-meta"><span>{dateTime(sale.createdAt)}</span><span>ผู้ขาย {sale.cashierName}</span></div>
      {sale.voided && (
        <div className="receipt-void">ยกเลิกบิลแล้ว · {dateTime(sale.voided.createdAt)}<br />เหตุผล: {sale.voided.reason} · อนุมัติโดย {sale.voided.approvedByName}</div>
      )}
      <table className="receipt-lines">
        <tbody>
          {sale.items.map((i, index) => (
            <tr key={index}>
              <td>{i.name}<br /><small>{i.sku} · {i.quantity} × {baht(i.unitPrice)}</small></td>
              <td className="num">{baht(i.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="receipt-totals">
        <div className="stat-line total"><span>ยอดชำระ</span><strong className="num">{baht(sale.total)}</strong></div>
        <div className="stat-line"><span>รับเงินสด</span><strong className="num">{baht(sale.tendered)}</strong></div>
        <div className="stat-line"><span>เงินทอน</span><strong className="num">{baht(sale.change)}</strong></div>
      </div>
      <div className="receipt-thanks">ขอบคุณที่อุดหนุน แล้วแวะมาอีกนะคะ</div>
    </div>
  );
}

/** ใบเสร็จสำหรับ browser print; การพิมพ์ล้มเหลวไม่ย้อนการขาย และพิมพ์ซ้ำจากบิลเดิมได้ */
export function PrintableReceipt({ sale }: { sale: SaleResponse | null }) {
  const target = document.getElementById('print-area');
  if (!sale || !target) return null;
  return createPortal(<Receipt sale={sale} />, target);
}

export function printNow(): void {
  // ให้ React วาด portal ก่อนเปิดหน้าต่างพิมพ์
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}
