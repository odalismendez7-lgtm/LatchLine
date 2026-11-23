// Serves the dashboard shell. Strict CSP: only this page's nonce-tagged script and style run;
// no inline handlers, no third-party hosts, no framing, same-origin fetches only.
import { CLIENT_JS } from "./client.js";

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#16202a;--muted:#5a6773;--line:#dde2e8;--brand:#0b5fff;--brand-ink:#fff;--bad:#b42318;--okc:#067647;--warn:#b54708;--urgent:#b42318;--r:10px}
@media (prefers-color-scheme:dark){:root{--bg:#10161c;--card:#18212a;--ink:#e8edf2;--muted:#9aa8b5;--line:#2a3541;--brand:#5b9bff;--brand-ink:#08101a;--bad:#ff8a80;--okc:#5fd39a;--warn:#f5b14c;--urgent:#ff8a80}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
h1,h2,h3{line-height:1.2;margin:.2em 0 .5em}h2{font-size:1.35rem}h3{font-size:1.05rem;margin-top:1.4em}
a{color:var(--brand)}button,input,select,textarea{font:inherit;color:inherit}
.demo{background:#fff4ce;color:#5b4300;padding:.5rem 1rem;font-size:.9rem;border-bottom:1px solid #e6cf7a;text-align:center}
@media (prefers-color-scheme:dark){.demo{background:#3a3000;color:#ffe9a3;border-color:#6b5a00}}
.muted{color:var(--muted)}.bad{color:var(--bad)}.ok{color:var(--okc)}.grow{flex:1}
.auth{display:grid;place-items:start center;padding:2rem 1rem}.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.5rem;width:100%;max-width:26rem}
label{display:block;margin:.8rem 0 0;font-weight:600;font-size:.92rem}label small{display:block;font-weight:400;color:var(--muted)}label.inline{display:flex;gap:.5rem;align-items:flex-start;font-weight:400;margin:.6rem 0}
input:not([type=checkbox]),select,textarea{display:block;width:100%;margin-top:.3rem;padding:.6rem .7rem;border:1px solid var(--line);border-radius:8px;background:var(--card);min-height:44px}
textarea{resize:vertical}input[type=checkbox]{width:20px;height:20px;margin-top:.15rem}input:focus,select:focus,textarea:focus,button:focus-visible,a:focus-visible{outline:3px solid color-mix(in srgb,var(--brand) 55%,transparent);outline-offset:1px}
.btn{display:inline-block;padding:.55rem .95rem;min-height:44px;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:pointer;margin:.6rem .4rem 0 0}.btn.primary{background:var(--brand);color:var(--brand-ink);border-color:var(--brand);font-weight:600}.btn.danger{color:var(--bad);border-color:var(--bad)}
.link{background:none;border:0;padding:0;color:var(--brand);cursor:pointer;text-decoration:underline;min-height:32px;text-align:left}
.msg{min-height:1.3em;margin:.6rem 0 0;font-size:.92rem}.msg.bad{color:var(--bad)}.msg.ok{color:var(--okc)}
.top{display:flex;gap:.75rem;align-items:center;padding:.6rem 1rem;background:var(--card);border-bottom:1px solid var(--line);flex-wrap:wrap}.top select{width:auto;margin:0;min-height:40px}.brand{letter-spacing:.08em}.bizname{font-weight:600}.top .btn{margin:0}
.layout{display:grid;grid-template-columns:13rem 1fr;gap:1rem;max-width:80rem;margin:0 auto;padding:1rem}
.nav{display:flex;flex-direction:column;gap:.25rem;position:sticky;top:1rem;align-self:start}.navbtn{text-align:left;padding:.6rem .8rem;border:0;border-radius:8px;background:none;cursor:pointer;min-height:44px}.navbtn:hover{background:var(--line)}.navbtn.active{background:var(--brand);color:var(--brand-ink);font-weight:600}
main{min-width:0}main#main{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.25rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.75rem;margin:1rem 0}.stat{display:flex;flex-direction:column;gap:.2rem;text-align:left;padding:1rem;border:1px solid var(--line);border-radius:var(--r);background:var(--bg);cursor:pointer}.stat .num{font-size:1.9rem;font-weight:700}.stat.urgent{border-color:var(--urgent)}.stat.urgent .num{color:var(--urgent)}
.alert{background:color-mix(in srgb,var(--warn) 14%,var(--card));border:1px solid var(--warn);border-radius:8px;padding:.7rem .9rem}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:.5rem 0}table{border-collapse:collapse;width:100%;min-width:34rem}th,td{padding:.55rem .6rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:.93rem}th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}tr.row-urgent td{background:color-mix(in srgb,var(--urgent) 8%,transparent)}
.chip{display:inline-block;padding:.05rem .5rem;border-radius:99px;font-size:.78rem;border:1px solid var(--line);background:var(--bg);margin-right:.25rem}.chip.incomplete{border-color:var(--warn);color:var(--warn);font-weight:700}.chip.incomplete{border-color:var(--warn);color:var(--warn);font-weight:700}.chip.urgent{background:var(--urgent);color:#fff;border-color:var(--urgent);font-weight:700}.chip.sim,.chip.warn{border-color:var(--warn);color:var(--warn)}.chip.s-new{border-color:var(--brand);color:var(--brand)}.chip.s-won{border-color:var(--okc);color:var(--okc)}.chip.s-spam,.chip.s-lost{color:var(--muted)}
.filters{display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap}.filters label{margin:0}.filters .btn{margin:0}
.inline-form{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.6rem 0}.inline-form select,.inline-form input{width:auto;margin:0;flex:1 1 10rem}.inline-form .btn{margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.4rem 1.5rem}.kv dt{font-size:.78rem;color:var(--muted);text-transform:uppercase}.kv dd{margin:0 0 .5rem;overflow-wrap:anywhere}
ul.plain{list-style:none;padding:0;margin:.5rem 0}ul.plain li{padding:.5rem 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}.actions .btn{margin:.3rem 0}
.chat{display:flex;flex-direction:column;gap:.5rem;margin:1rem 0}.bubble{max-width:42rem;padding:.5rem .8rem;border-radius:12px;background:var(--bg);border:1px solid var(--line)}.bubble.customer{align-self:flex-start}.bubble.assistant{align-self:flex-end;background:color-mix(in srgb,var(--brand) 10%,var(--card))}.bubble p{margin:.2rem 0;white-space:pre-wrap;overflow-wrap:anywhere}
.empty{color:var(--muted);padding:1rem 0}
.toast{position:fixed;left:50%;bottom:.75rem;transform:translateX(-50%);width:max-content;max-width:min(92vw,30rem);padding:.55rem .9rem;border-radius:8px;color:#fff;z-index:10;font-size:.9rem;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3)}.toast.ok{background:#067647}.toast.bad{background:#b42318}.toast[hidden]{display:none}
@media (max-width:760px){.layout{grid-template-columns:1fr;padding:.6rem}.nav{flex-direction:row;overflow-x:auto;position:static;padding-bottom:.25rem;-webkit-overflow-scrolling:touch}.navbtn{white-space:nowrap;flex:0 0 auto;border:1px solid var(--line)}main#main{padding:.9rem}.who{display:none}.top{padding:.5rem .75rem}}
`;

export function dashboardPage({ devMode = false } = {}) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>LATCHLINE — Dashboard</title><style nonce="${nonce}">${CSS}</style></head><body><div id="root"><noscript>JavaScript is required for the dashboard.</noscript></div><script nonce="${nonce}">window.__DEV__=${devMode ? "true" : "false"};</script><script nonce="${nonce}">${CLIENT_JS.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    },
  });
}
