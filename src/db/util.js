import { wrapDbError } from "./errors.js";

export const nowIso = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
export const json = (v) => JSON.stringify(v ?? {});
export const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export async function guard(fn) {
  try { return await fn(); } catch (e) { throw wrapDbError(e); }
}
