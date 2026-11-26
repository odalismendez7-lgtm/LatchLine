# Transactional email setup (Resend)

Status: the Resend email adapter is implemented and its HTTP behavior is tested with mocked responses. No Resend account, API key, sender domain, live email, or delivery webhook is connected.

## What the adapter does

- Uses Resend's `POST https://api.resend.com/emails` endpoint.
- Sends plain-text email only; it does not send SMS.
- Forwards the outbox's stable idempotency key in the `Idempotency-Key` header.
- Uses server-side secrets only, bounds request time, maps provider errors to safe codes, and never logs provider response bodies.
- Reports provider acceptance as `sent`, not `delivered`. A delivery webhook/status integration is still needed to confirm delivery.

Official references:
- [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend error handling](https://resend.com/docs/api-reference/errors)

## Opt-in configuration

The Worker remains on mock notifications unless all of these are set:

```dotenv
LATCHLINE_EMAIL_PROVIDER="resend"
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="LATCHLINE <alerts@your-verified-domain.example>"
```

For local development, put values in `.dev.vars` (never commit that file). For Cloudflare, set `LATCHLINE_EMAIL_PROVIDER` and `RESEND_FROM_EMAIL` as Worker variables and `RESEND_API_KEY` as an encrypted Worker secret.

Resend requires a verified sender domain before production sending. Do not use a personal mailbox as a substitute for domain verification.

## Guardrails that remain active

- The dispatcher sends only to business contacts marked as genuinely verified in LATCHLINE; a simulated verification code is not enough.
- The mock remains the default. Resend must be explicitly enabled.
- No email is sent merely because a customer opened the widget.
- Resend acceptance does not prove delivery. The dashboard must not present it as delivered.
- Retries reuse the same outbox idempotency key. Resend documents a 24-hour idempotency window; LATCHLINE's retry schedule must remain within that window or treat later retries as at-least-once.
- Real emails contain customer inquiry details. Before live use, review Resend's current data processing/retention terms, LATCHLINE's privacy notice, customer disclosure, sender-domain authentication, suppression/bounce handling, and emergency escalation procedures.
- Set provider usage alerts and test with founder-controlled addresses before enabling any customer tenant.

This adapter does not make LATCHLINE production-ready. Hosted D1, authentication/runtime constraints, delivery receipts/webhooks, privacy and security review, and real end-to-end tests remain open.
