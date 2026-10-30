/** รหัส error ตาม implementation plan ส่วน 4 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PRICE_CHANGED'
  | 'INSUFFICIENT_STOCK'
  | 'NO_OPEN_SHIFT'
  | 'SHIFT_ALREADY_OPEN'
  | 'SHIFT_CLOSED'
  | 'ALREADY_VOIDED'
  | 'VOID_NOT_ALLOWED'
  | 'DUPLICATE_SKU'
  | 'DUPLICATE_BARCODE'
  | 'DUPLICATE_USERNAME'
  | 'SETUP_ALREADY_DONE'
  | 'TENDER_TOO_LOW'
  | 'AMOUNT_OVERFLOW'
  | 'PRODUCT_INACTIVE'
  | 'TOO_MANY_ATTEMPTS'
  | 'MAINTENANCE_MODE'
  | 'DB_BUSY'
  | 'STORAGE_FAILURE'
  | 'INTERNAL';

export const errorStatus: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  PRICE_CHANGED: 409,
  INSUFFICIENT_STOCK: 409,
  NO_OPEN_SHIFT: 409,
  SHIFT_ALREADY_OPEN: 409,
  SHIFT_CLOSED: 409,
  ALREADY_VOIDED: 409,
  VOID_NOT_ALLOWED: 409,
  DUPLICATE_SKU: 409,
  DUPLICATE_BARCODE: 409,
  DUPLICATE_USERNAME: 409,
  SETUP_ALREADY_DONE: 409,
  TENDER_TOO_LOW: 422,
  AMOUNT_OVERFLOW: 422,
  PRODUCT_INACTIVE: 422,
  TOO_MANY_ATTEMPTS: 429,
  MAINTENANCE_MODE: 503,
  DB_BUSY: 503,
  STORAGE_FAILURE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = errorStatus[code];
    this.details = details;
  }
}

export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new AppError(code, message, details);
}
