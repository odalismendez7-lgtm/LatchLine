// Account mailer adapter (verification, password reset, invitations, and
// contact-verification codes). Mock only: NOTHING IS EVER SENT.
//
//   mailer.simulated  true for the mock
//   mailer.send({ channel: "email" | "sms", to, template, data }) -> { messageId, simulated }
//
// A real sender is added later by implementing this and registering it in
// createMailer() after founder approval. The mock keeps what it "sent" in memory
// so tests and the local dev page can show it, always labeled SIMULATED.

export class MailerError extends Error {
  constructor(code, message) { super(message ?? code); this.name = "MailerError"; this.code = code; }
}

export class MockMailer {
  id = "mock";
  simulated = true;
  outbox = [];
  #n = 0;
  #fail;
  constructor({ fail } = {}) { this.#fail = fail; }
  async send({ channel, to, template, data }) {
    if (channel !== "email" && channel !== "sms") throw new MailerError("invalid_request", "bad channel");
    if (typeof to !== "string" || to.length < 5 || /[\r\n]/.test(to)) throw new MailerError("invalid_request", "bad recipient");
    if (this.#fail) await this.#fail({ channel, to, template });
    const messageId = `mock_mail_${++this.#n}`;
    while (this.outbox.length >= 200) this.outbox.shift();
    this.outbox.push({ messageId, channel, to, template, data, simulated: true });
    return { messageId, simulated: true };
  }
  last(template, to) { return [...this.outbox].reverse().find((m) => (!template || m.template === template) && (!to || m.to === to)); }
}

/**
 * Same mock, but each simulated message is also written to the `simulated_mail` table
 * (migration 0004) so it survives restarts and works across Worker isolates. STILL NOTHING IS SENT.
 * Rows hold raw one-time tokens by design (development only) and are purged after 2 hours.
 */
export class DbMockMailer extends MockMailer {
  #db;
  #now;
  constructor(db, { now = Date.now, fail } = {}) { super({ fail }); this.#db = db; this.#now = now; }
  async send(msg) {
    const r = await super.send(msg);
    const t = this.#now();
    await this.#db.run("INSERT INTO simulated_mail (id, channel, to_addr, template, data, created_at) VALUES (?,?,?,?,?,?)",
      [r.messageId + "_" + t.toString(36), msg.channel, msg.to, msg.template, JSON.stringify(msg.data ?? {}), new Date(t).toISOString()]);
    await this.#db.run("DELETE FROM simulated_mail WHERE created_at < ?", [new Date(t - 2 * 3600_000).toISOString()]);
    return r;
  }
  async list(limit = 50) {
    const rows = await this.#db.all("SELECT id, channel, to_addr, template, data, created_at FROM simulated_mail ORDER BY created_at DESC, rowid DESC LIMIT ?", [Math.min(Math.max(1, limit | 0), 200)]);
    return rows.map((r) => ({ messageId: r.id, channel: r.channel, to: r.to_addr, template: r.template, data: JSON.parse(r.data), simulated: true, createdAt: r.created_at }));
  }
  async lastAsync(template, to) { return (await this.list(200)).find((m) => (!template || m.template === template) && (!to || m.to === to)); }
}

export function createMailer(config) {
  if (config?.type === "mock") return new MockMailer(config);
  throw new MailerError("disabled", `Mailer '${String(config?.type)}' is disabled. Real email/SMS requires founder approval.`);
}
