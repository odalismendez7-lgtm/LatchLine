// Contact management + verification workflow for a business's notification contacts.
// Callers must already have authorized the user for this business (see authz.js).
//
// Honesty rule: a code sent by the MOCK mailer proves nothing about the address, so
// entering it only records `simulated_verified_at`. `verified_at` is set only when the
// code was delivered by a non-simulated provider.
import { randomCode, sha256Hex } from "../auth/crypto.js";
import { DbError } from "../db/errors.js";

const DEFAULTS = { codeTtlMs: 10 * 60_000, cooldownMs: 60_000, dailyCap: 5 };

export function createContactService({ T, mailer, now = Date.now, cfg = {} }) {
  const C = { ...DEFAULTS, ...cfg };
  const iso = () => new Date(now()).toISOString();
  const state = (c) => (c.verified_at ? "verified" : c.simulated_verified_at ? "simulated_verified" : "unverified");
  const view = (c) => ({ id: c.id, channel: c.channel, address: c.address, enabled: !!c.enabled, state: state(c), verifiedAt: c.verified_at ?? null, simulatedVerifiedAt: c.simulated_verified_at ?? null });

  return {
    view,
    async list() { return (await T.notifications.contacts.list()).map(view); },
    async add(actorId, { channel, address }) {
      let r;
      try { r = await T.notifications.contacts.add({ channel, address, verified: false, now: iso() }); }
      catch (e) { if (e instanceof DbError && e.code === "invalid_data") return { ok: false, code: "invalid_contact" }; if (/UNIQUE|constraint/i.test(String(e?.message))) return { ok: false, code: "duplicate" }; throw e; }
      await T.members.record(actorId, "contact_added_by_user", r.id, { channel });
      return { ok: true, id: r.id, state: "unverified" };
    },
    async remove(actorId, id) {
      try { await T.notifications.contacts.remove(id); } catch (e) { if (e?.code === "not_found") return { ok: false, code: "not_found" }; throw e; }
      await T.members.record(actorId, "contact_removed_by_user", id);
      return { ok: true };
    },
    async setEnabled(actorId, id, enabled) {
      try { await T.notifications.contacts.setEnabled(id, !!enabled); } catch (e) { if (e?.code === "not_found") return { ok: false, code: "not_found" }; throw e; }
      await T.members.record(actorId, enabled ? "contact_enabled" : "contact_disabled", id);
      return { ok: true };
    },
    async sendCode(actorId, id) {
      const c = await T.notifications.contacts.get(id);
      if (!c) return { ok: false, code: "not_found" };
      if (c.verified_at) return { ok: false, code: "already_verified" };
      const code = randomCode(6), t = iso();
      const started = await T.contactVerify.start({ actorId, contactId: id, codeHash: await sha256Hex(`${id}:${code}`), expiresAt: new Date(now() + C.codeTtlMs).toISOString(), simulated: !!mailer.simulated, now: t, cooldownMs: C.cooldownMs, dailyCap: C.dailyCap });
      if (!started.ok) return started;
      try { await mailer.send({ channel: c.channel, to: c.address, template: "contact_verification", data: { code, minutes: Math.round(C.codeTtlMs / 60_000) } }); }
      catch { return { ok: false, code: "send_failed" }; }
      return { ok: true, simulated: !!mailer.simulated, expiresInMinutes: Math.round(C.codeTtlMs / 60_000),
        notice: mailer.simulated ? "SIMULATED: no message was sent. Entering the code only marks this contact as simulated-verified; it will not receive real notifications." : "A code was sent to this address." };
    },
    async confirmCode(actorId, id, code) {
      const c = await T.notifications.contacts.get(id);
      if (!c) return { ok: false, code: "not_found" };
      if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return { ok: false, code: "wrong_code" };
      const r = await T.contactVerify.check({ actorId, contactId: id, codeHash: await sha256Hex(`${id}:${code.trim()}`), now: iso() });
      if (!r.ok) { await T.members.record(actorId, "contact_verification_failed", id, { reason: r.code }); return r; }
      if (r.simulated) await T.notifications.contacts.markSimulatedVerified(id, iso());
      else await T.notifications.contacts.markVerified(id, iso());
      await T.members.record(actorId, r.simulated ? "contact_simulated_verified" : "contact_verified", id);
      return { ok: true, state: r.simulated ? "simulated_verified" : "verified", simulated: r.simulated };
    },
  };
}
