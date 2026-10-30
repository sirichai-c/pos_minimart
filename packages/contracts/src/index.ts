// TypeBox schemas ของ request และ type ของ response ใช้ร่วม server/web
import { Type, type Static } from '@sinclair/typebox';
import type { PricedLine, Satang } from '@pos/domain';

const Id = Type.String({ minLength: 1, maxLength: 64 });
const Money = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const PositiveMoney = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const Reason = Type.String({ minLength: 1, maxLength: 500 });
const Password = Type.String({ minLength: 8, maxLength: 200 });
const Username = Type.String({ minLength: 3, maxLength: 40, pattern: '^[A-Za-z0-9._-]+$' });
const DisplayName = Type.String({ minLength: 1, maxLength: 80 });
const Role = Type.Union([Type.Literal('owner'), Type.Literal('cashier')]);

export const SetupOwnerBody = Type.Object({ username: Username, displayName: DisplayName, password: Password }, { additionalProperties: false });
export const LoginBody = Type.Object({ username: Type.String({ minLength: 1, maxLength: 40 }), password: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false });
export const CreateUserBody = Type.Object({ username: Username, displayName: DisplayName, password: Password, role: Role }, { additionalProperties: false });
export const UpdateUserBody = Type.Object({
  displayName: Type.Optional(DisplayName), active: Type.Optional(Type.Boolean()),
  role: Type.Optional(Role), password: Type.Optional(Password),
}, { additionalProperties: false, minProperties: 1 });

export const CreateProductBody = Type.Object({
  sku: Type.String({ minLength: 1, maxLength: 40 }),
  barcode: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  price: Money,
  openingQuantity: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000_000 })),
}, { additionalProperties: false });
export const UpdateProductBody = Type.Object({
  sku: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  barcode: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  price: Type.Optional(Money),
  active: Type.Optional(Type.Boolean()),
}, { additionalProperties: false, minProperties: 1 });

export const ReceiptBody = Type.Object({ productId: Id, quantity: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }), reason: Reason }, { additionalProperties: false });
export const AdjustmentBody = Type.Object({ productId: Id, countedQuantity: Type.Integer({ minimum: 0, maximum: 1_000_000_000 }), reason: Reason }, { additionalProperties: false });

export const OpenShiftBody = Type.Object({ openingCash: Money }, { additionalProperties: false });
export const CashMovementBody = Type.Object({ direction: Type.Union([Type.Literal('in'), Type.Literal('out')]), amount: PositiveMoney, reason: Reason }, { additionalProperties: false });
export const CloseShiftBody = Type.Object({ countedCash: Money }, { additionalProperties: false });

export const CheckoutBody = Type.Object({
  items: Type.Array(Type.Object({
    productId: Id,
    quantity: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    expectedUnitPrice: Money,
  }, { additionalProperties: false }), { minItems: 1, maxItems: 200 }),
  tendered: Money,
}, { additionalProperties: false });
export const VoidBody = Type.Object({ reason: Reason, cashReturned: Type.Literal(true), goodsReturned: Type.Literal(true) }, { additionalProperties: false });

export const BackupBody = Type.Object({}, { additionalProperties: false });

export type SetupOwnerRequest = Static<typeof SetupOwnerBody>;
export type LoginRequest = Static<typeof LoginBody>;
export type CreateUserRequest = Static<typeof CreateUserBody>;
export type UpdateUserRequest = Static<typeof UpdateUserBody>;
export type CreateProductRequest = Static<typeof CreateProductBody>;
export type UpdateProductRequest = Static<typeof UpdateProductBody>;
export type ReceiptRequest = Static<typeof ReceiptBody>;
export type AdjustmentRequest = Static<typeof AdjustmentBody>;
export type OpenShiftRequest = Static<typeof OpenShiftBody>;
export type CashMovementRequest = Static<typeof CashMovementBody>;
export type CloseShiftRequest = Static<typeof CloseShiftBody>;
export type CheckoutRequest = Static<typeof CheckoutBody>;
export type VoidRequest = Static<typeof VoidBody>;

export type RoleName = 'owner' | 'cashier';

export interface ApiErrorBody { error: { code: string; message: string; details?: Record<string, unknown> } }

export interface UserView { id: string; username: string; displayName: string; role: RoleName; active: boolean; createdAt: string }

export interface ProductView {
  id: string; sku: string; barcode: string | null; name: string; price: Satang;
  active: boolean; onHand: number; createdAt: string; updatedAt: string;
}

export interface StockMovementView {
  id: string; productId: string; kind: 'opening' | 'receipt' | 'adjustment' | 'sale' | 'void';
  quantity: number; balanceAfter: number; sourceType: string; sourceId: string;
  reason: string | null; userId: string; userName: string; createdAt: string;
}

export interface InventoryChangeResult { movement: StockMovementView | null; product: ProductView }

export interface CashMovementView { id: string; shiftId: string; direction: 'in' | 'out'; amount: Satang; reason: string; userId: string; createdAt: string }

export interface ShiftSummary {
  opening: Satang; gross: Satang; voids: Satang; refunds: Satang; net: Satang;
  cashIn: Satang; cashOut: Satang; expectedCash: Satang; saleCount: number; voidCount: number;
}

export interface ShiftView {
  id: string; openedBy: string; openedByName: string; openedAt: string; openingCash: Satang;
  closedBy: string | null; closedAt: string | null;
  expectedCash: Satang | null; countedCash: Satang | null; variance: Satang | null;
  summary: ShiftSummary;
  cashMovements: CashMovementView[];
}

export interface SaleResponse {
  id: string; billNo: string; shiftId: string; cashierId: string; cashierName: string; createdAt: string;
  items: PricedLine[]; total: Satang; tendered: Satang; change: Satang;
  voided: null | { reason: string; approvedBy: string; approvedByName: string; createdAt: string };
}

export interface SaleListItem {
  id: string; billNo: string; shiftId: string; cashierName: string; createdAt: string;
  total: Satang; itemCount: number; voided: boolean;
}

export interface DailyReport {
  date: string; saleCount: number; voidCount: number; gross: Satang; voids: Satang; net: Satang;
  cashIn: Satang; cashOut: Satang;
  shifts: { id: string; openedAt: string; closedAt: string | null; crossesDay: boolean }[];
}

export interface AuditEventView { id: number; action: string; entityType: string; entityId: string; userId: string | null; userName: string | null; data: unknown; createdAt: string }

export interface BackupRunView {
  id: string; kind: 'interval' | 'shift_close' | 'daily' | 'manual'; startedAt: string; finishedAt: string | null;
  fileName: string | null; sizeBytes: number | null; sha256: string | null; schemaVersion: number;
  status: 'running' | 'ok' | 'failed'; error: string | null;
  uploadedAt: string | null; uploadAttempts: number; uploadError: string | null;
}

export interface SystemStatus {
  appVersion: string; schemaVersion: number; dbPath: string; now: string;
  disk: { freeBytes: number | null; totalBytes: number | null };
  lastSnapshot: BackupRunView | null; lastFailedSnapshot: BackupRunView | null;
  lastUpload: BackupRunView | null; pendingUploads: number; uploadTarget: string | null;
  openShiftId: string | null;
}

export interface MeResponse { user: UserView }
export interface SetupStatus { needsOwner: boolean }
