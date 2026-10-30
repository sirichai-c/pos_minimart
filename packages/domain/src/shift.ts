import { addSatang, type Satang } from './money.ts';

export interface ShiftTotals { opening: Satang; gross: Satang; voids: Satang; refunds: Satang; cashIn: Satang; cashOut: Satang }

/** R05: เงินตั้งต้น + ยอดขาย − ยอดยกเลิก − คืนเงิน + นำเข้า − นำออก */
export function expectedCash(t: ShiftTotals): Satang {
  let result = addSatang(t.opening, t.gross);
  result = addSatang(result, -t.voids);
  result = addSatang(result, -t.refunds);
  result = addSatang(result, t.cashIn);
  return addSatang(result, -t.cashOut);
}

export function cashVariance(counted: Satang, expected: Satang): Satang {
  return addSatang(counted, -expected);
}
