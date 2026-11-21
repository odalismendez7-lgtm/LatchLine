// TEST-ONLY wrapper around the REAL Worker entry (src/index.js). It emulates a platform that refuses
// PBKDF2 above a cap (Cloudflare has said production Workers cap Web Crypto PBKDF2 at 100,000 iterations;
// the open-source workerd that runs locally has no such cap, so the cap cannot be reproduced locally any
// other way). The error is EMULATED: the real production error text is unknown. No product code is changed.
import worker from "../../src/index.js";

let patched = false;
function patch(cap) {
  if (patched) return; patched = true;
  const real = crypto.subtle.deriveBits.bind(crypto.subtle);
  crypto.subtle.deriveBits = async function (alg, ...rest) {
    if (alg && alg.name === "PBKDF2" && alg.iterations > cap) throw new DOMException(`iteration counts above ${cap} are not supported (emulated cap)`, "NotSupportedError");
    return real(alg, ...rest);
  };
}

export default {
  fetch(request, env, ctx) { patch(Number(env.PBKDF2_CAP || 100000)); return worker.fetch(request, env, ctx); },
  scheduled(event, env, ctx) { patch(Number(env.PBKDF2_CAP || 100000)); return worker.scheduled(event, env, ctx); },
};
