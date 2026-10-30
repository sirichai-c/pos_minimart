import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '@pos/domain';
import { mapDbError } from '../db/tx.ts';

/** ทุก error ออกเป็น { error: { code, message, details } } */
export function registerErrorHandler(app: FastifyInstance, options: { spaFallback: boolean }): void {
  app.setErrorHandler((raw: FastifyError, req, reply) => {
    if (raw.validation) {
      return reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง', details: { issues: raw.validation.map(v => `${v.instancePath || '/'} ${v.message ?? ''}`.trim()) } } });
    }
    if (raw.statusCode === 415 || raw.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || raw.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || raw.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: 'รูปแบบข้อมูลไม่ถูกต้อง' } });
    }
    const err = mapDbError(raw);
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    req.log.error({ err: raw }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดในระบบ ผลการบันทึกยังไม่แน่ชัด กรุณาตรวจสอบคำขอเดิม' } });
  });

  app.setNotFoundHandler((req, reply) => {
    // หน้า UI ทุก path ที่ไม่ใช่ API และไม่ใช่ไฟล์ asset ใช้ index.html
    if (options.spaFallback && req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'ไม่พบหน้าที่ร้องขอ' } });
  });
}
