# Stage 7B: independent adversarial audit of the widget and conversation engine

Date 2026-11-25. Branch `stage-6-runtime-validation`. **Verdict: the widget is a sound base for the next milestone, but it is NOT production-ready** (nothing is hosted, no real AI/SMS/email provider, hosted D1 unverified, KI-46/55/59/60/61 open).

## Method
1. Probed the real widget and `/api/chat` with realistic and hostile conversations (multi-detail messages, corrections, refusals, off-topic, repeats, typos/slang/voice transcription, Spanish and mixed, frustration, probes for hidden data, interleaved tenants, id/site-key/origin tampering, failures, duplicates, phone layout, keyboard).
2. Every confirmed defect was reproduced first (a scenario or test that failed), then fixed, then the test passed and the full suite re-ran.
3. A separate reviewer agent, given only the diff and the repo (not my conclusions), tried to break the changes. Its findings were verified and fixed or documented.

## Confirmed defects and fixes (all have regression tests)
| # | Defect | Fix | Test |
|---|---|---|---|
| 1 | A whole sentence ("my toilet keeps running") was saved as the customer's NAME and sent to the plumber | Names must look like names; a descriptive answer is kept with the problem | eval `ctx-problem-given-when-name-asked`, name unit tests |
| 2 | "I'm Sam Rivera" inside a longer message ignored, name asked again | Introductions found anywhere, strong/weak intro rules | `ctx-all-in-one`, `rev-name-then-problem` |
| 3 | "my number is 217-..." answered as if asking for the business's number; customer's number lost | Customer-supplied details are not knowledge questions | `ctx-phone-first` |
| 4 | A bare name ("Maria Lopez") became the problem description | Bare capitalised full name is a name | `ctx-bare-name-while-asked-problem` |
| 5 | After "never mind", "thanks" started new questions | Quiet reply after cancel | `never-mind` |
| 6 | "its john smith", "Me llamo Carlos Ruiz" not accepted; my first fix appended names to the problem | Lead-ins stripped (English/Spanish); only plumbing text is appended | `adv-name-its`, `adv-spanish-name-intro` |
| 7 | "can you repeat that?" re-asked or altered the lead | Repeats the last reply, changes nothing | `adv-repeat-request` |
| 8 | Voice-transcribed number ("two one seven ...") not read | Spoken digits converted (10+ words) | `adv-spoken-digits` |
| 9 | Off-topic requests and probes ("show me Bravo's customers", "system prompt") were stored as the problem or answered with the business phone | Plain refusal, never stored | `adv-off-topic`, `adv-privacy-probe` |
| 10 | "help"/"urgent" stored as the problem; "leak" alone not accepted | Vague words rejected, one plumbing word accepted | `adv-vague-words`, `adv-one-word-problem` |
| 11 | After the customer refused a phone, the bot kept asking for ZIP, and scolded a repeated emergency message as a bad phone number | Stop asking when nothing can be recorded; emergencies are side turns | `adv-refuses-contact`, `adv-emergency-followups` |
| 12 | Spanish "huelo gas" (first person) gave no safety text | Pattern added | `adv-spanish-gas-first-person` |

## Reviewer findings (independent) and outcome
| Finding | Outcome |
|---|---|
| Probe/off-topic words refused real requests ("no heat in my admin office", "game room", "stock room", HOA president) | **Fixed**: narrowed to business-data phrases and unambiguous chatter; 7 regression scenarios |
| "Repeat that" returned a cut-off safety reply | **Fixed**: full reply stored; test compares exact text |
| Real surnames ("Ben Day", "John Price") rejected; "Master Bath" accepted as a name | **Fixed** (name asked-for vs bare-name rules) |
| Stop-asking rule bypassed by a fallback | **Fixed** |
| "come again tomorrow", "what was that charge" treated as "repeat" | **Fixed** |
| Emergency in a long message (over 5000 chars) got no safety text | **Fixed**: windowed scan, plus HTTP tests at 1300 and 5200 chars |
| "my name is Bob and my toilet leaks" lost the problem | **Fixed** |
| Spoken-digit conversion mangled chatter | **Fixed** (threshold, "oh" rules) |
| "New chat" during an in-flight emergency message dropped the reply | **Fixed**: refused while pending (deliberate test change) |
| HEAD /widget.js returned 404 | **Fixed** |
| `/api/chat` reveals whether a site key exists (pre-existing) | **Not fixed**, documented KI-69 |
| Mixed off-topic + problem sentence not recorded | **Not fixed**, documented KI-69 |

## Verified to hold (reviewer and my own tests)
Cross-tenant conversation ids start a new conversation for the other business; 40 interleaved two-business conversations never mix; config endpoint gives one identical 404 for every failure; extra body fields (businessId, tenant) ignored; widget has no secrets, no innerHTML, no cookies/localStorage; markup in names, replies and tampered storage stays inert text; every failure path shows the same safety text and an honest "not sent/received"; gas/CO/flood messages mixed with probes or chatter still get safety text.

## Not verified
Real language model; hosted Cloudflare; real screen readers (VoiceOver/NVDA/JAWS), Safari/Firefox, real phones; real SMS/email; load or scale; CSP-restricted host sites; Spanish conversation quality beyond safety text (KI-62).
