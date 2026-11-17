// Demo knowledge base for "AquaFlow Plumbing": TEST DATA ONLY.
// Mirrors AQUAFLOW_KNOWLEDGE_BASE.md. Nothing here is a verified business fact,
// so every fact is unverified and the assistant must answer "needs to be
// confirmed by the business team" for all of them.

const unverified = { value: null, verified: false };

export const demoAquaflowKb = {
  schemaVersion: 1,
  businessId: "aquaflow-demo",
  businessName: "AquaFlow Plumbing (demo)",
  industry: "plumbing",
  facts: {
    hours: { ...unverified },
    holiday_hours: { ...unverified },
    after_hours_policy: { ...unverified },
    service_area: { ...unverified },
    services: { ...unverified },
    pricing: { ...unverified },
    diagnostic_fee: { ...unverified },
    emergency_fee: { ...unverified },
    appointments: { ...unverified },
    contact_phone: { ...unverified },
    contact_email: { ...unverified },
    human_escalation: { ...unverified },
  },
  faqs: [],
};
