export class DatabaseError extends Error {
  constructor(message, code = 'database_error') {
    super(message);
    this.name = 'DatabaseError';
    this.userMessage = message;
    this.code = code;
  }
}

export function safeDatabaseError(error, fallback = '本地数据操作失败，请重试。') {
  if (error instanceof DatabaseError) return error;
  if (error?.name === 'QuotaExceededError') {
    return new DatabaseError('设备可用存储空间不足，数据尚未保存。请腾出空间后重试。', 'storage_quota');
  }
  return new DatabaseError(fallback, 'database_error');
}
