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

export function createMailer(config) {
  if (config?.type === "mock") return new MockMailer(config);
  throw new MailerError("disabled", `Mailer '${String(config?.type)}' is disabled. Real email/SMS requires founder approval.`);
}
