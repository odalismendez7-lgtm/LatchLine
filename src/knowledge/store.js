// Tenant-scoped knowledge store.
//
// The ONLY way to read a business's knowledge is forBusiness(id), which returns
// a frozen handle bound to that one business. The handle holds no reference to
// the store or to any other business, and an unknown id throws; it never falls
// back to another business. Stored data is deep-cloned and frozen so neither
// the caller's original object nor any result can alter it.

import { validateKnowledgeBase, groundingFor, verifiedProcedureOverrides, deepFreeze } from "./schema.js";
import { retrieve } from "./retrieve.js";

export class KnowledgeStore {
  #byId = new Map();

  add(kb) {
    const v = validateKnowledgeBase(kb);
    if (!v.ok) throw new Error(`invalid_knowledge_base: ${v.errors.join("; ")}`);
    if (this.#byId.has(kb.businessId)) throw new Error("duplicate_business");
    this.#byId.set(kb.businessId, deepFreeze(structuredClone(kb)));
  }

  forBusiness(businessId) {
    if (typeof businessId !== "string" || !this.#byId.has(businessId)) {
      throw new Error("unknown_business");
    }
    const kb = this.#byId.get(businessId);
    return Object.freeze({
      businessId: kb.businessId,
      businessName: kb.businessName,
      retrieve: (message) => deepFreeze(retrieve(kb, message)),
      grounding: () => groundingFor(kb),
      procedureOverrides: () => deepFreeze(verifiedProcedureOverrides(kb)),
    });
  }
}
