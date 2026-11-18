// Database errors. Callers treat ANY DbError (or any thrown error) from the
// data layer as "not saved" and must say so honestly to the customer.

export class DbError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "DbError";
    this.code = code; // db_unavailable | constraint | invalid_data | not_persisted | unknown_business | not_found
    if (cause !== undefined) this.cause = cause;
  }
}

export function wrapDbError(e, fallbackCode = "db_unavailable") {
  if (e instanceof DbError) return e;
  const msg = String(e?.message ?? e);
  const code = /constraint|FOREIGN KEY|CHECK|UNIQUE|append-only/i.test(msg) ? "constraint" : fallbackCode;
  return new DbError(code, msg, e);
}
