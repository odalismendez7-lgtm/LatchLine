// Deterministic reading of ONE customer message: what kind of turn is this?
//
// Pure code: no database, no AI, no network, no state. The engine combines these signals with the
// conversation state to decide what to say. Everything here is a heuristic over English (with a few
// Spanish greetings/thanks); it is tested with positive AND false-positive cases but it is NOT a
// language model and will miss unusual phrasing (docs/KNOWN_ISSUES.md KI-46).
//
// Bias: the costly mistakes differ by signal.
//   - frustration / handoff: a missed signal leaves an upset customer talking to a bot, a false one adds an
//     unnecessary "person at the business" flag. So bot-directed anger is "strong", bare swearing is only "mild"
//     (people swear at faucets, not at the assistant).
//   - status / dispatch / booking asks: a missed one risks an invented promise, so these are broad.

const MAX = 600; // signals only need the start of a message (the engine caps messages at 1200)

const clean = (raw) => String(raw ?? "").slice(0, MAX).normalize("NFC").replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();

const GREETING = /^(?:hi+|hello+|hey+|hiya|howdy|yo|good (?:morning|afternoon|evening)|hola|buenas(?: (?:tardes|dias|días|noches))?)(?: (?:there|team|guys|everyone|all|friend))?[!.,? ]*$/i;
const THANKS = /^(?:(?:ok(?:ay)?|great|perfect|cool)[, ]+)?(?:thanks|thank you|thank u|thx|ty|cheers|gracias|much appreciated|i appreciate it|appreciate it)(?:[, ]+(?:so much|a lot|very much|again|anyway|though))?(?:[, ]+(?:bye|goodbye))?[!. ]*$/i;
const ACK = /^(?:ok(?:ay)?|k+|alright|all right|sure|fine|got it|i see|understood|cool|great|good|yep|yeah|yes|yup|uh huh|mhm|no|nope|nah|hmm+|um+|uh+|idk|i don'?t know|dunno|maybe|lol|haha|bye|goodbye|y|n)[.!, ]*$/i;
const YES = /^(?:yes|yeah|yep|yup|yea|sure|ok(?:ay)?|please|please do|yes please|y|i do|sounds good|that would be (?:great|good|fine)|go ahead|do it)[.!, ]*$/i;
const NO = /^(?:no|nope|nah|n|no thanks|no thank you|not now|not really|i don'?t|don'?t)[.!, ]*$/i;

const FRUSTRATION_STRONG = [
  /\b(?:you(?: people| guys| all)?(?:'re| are)|this (?:is|chat is|bot is|thing is)|that(?:'s| is)) (?:so |really |completely |totally |just )?(?:useless|stupid|dumb|worthless|pointless|ridiculous|a joke|garbage|terrible|awful|horrible|trash)\b/,
  /\b(?:useless|worthless|stupid|dumb|idiotic|pathetic) (?:bot|chat|chatbot|assistant|robot|machine|thing|service|ai)\b/,
  /\byou(?:'re| are) not (?:listening|helping|understanding|helpful|getting it)\b|\b(?:are|were) you (?:even |actually )?listening\b|\bnot listening to me\b/,
  /\bwaste of (?:my )?time\b|\bthis is (?:a )?(?:joke|ridiculous|unacceptable|insane|absurd)\b|\bi give up\b|\bgive up\b|\bforget it\b|\bscrew (?:this|you)\b|\bfed up\b|\bsick of (?:this|you|it|talking)\b|\bworst (?:chat|bot|service|experience|company)\b|\bunacceptable\b/,
  /\b(?:fuck(?:ing)? (?:you|this|bot|chat)|wtf|stfu|bullshit|piss(?:ed)? off)\b/,
];
const FRUSTRATION_MILD = [
  /\b(?:i|i've|i have|we|we've)(?: already| just)? (?:told|said|gave|sent|typed|wrote|provided|answered) (?:you|that|this|it|them)?\b/,
  /\bwhy (?:do|are) you (?:keep|keep on|have to keep) (?:asking|repeating)\b|\bstop (?:asking|repeating)\b|\bkeep (?:asking|repeating)\b|\bsame question\b|\byou (?:already )?asked (?:me )?(?:that|this)\b|\bover and over\b/,
  /\b(?:this|that|it) (?:isn'?t|is not|doesn'?t|does not) help(?:ing)?\b|\bthis (?:chat |bot )?(?:isn'?t|is not|doesn'?t) work\b|\bnot (?:very )?helpful\b|\bdoesn'?t help\b|\bnot what i (?:asked|said|meant|wanted)\b|\byou (?:don'?t|do not) (?:understand|get it|get what)\b|\bwhatever\b/,
  /\b(?:annoying|annoyed|frustrat\w*|irritat\w*|ugh+|seriously|come on|ridiculous|unbelievable|exhausting)\b/,
  /\b(?:damn|dammit|goddamn|crap|shit|ffs|jeez)\b/,
  /[!?]{3,}/,
];

const CONFUSION = [
  /\bwhat do you mean\b|\bwhat does that mean\b|\bi (?:don'?t|do not) (?:understand|get (?:it|what)|know what you(?:'re| are) (?:asking|saying))\b|\bi'?m (?:confused|lost)\b|\bi am (?:confused|lost)\b|\bconfus\w+\b/,
  /\b(?:can|could|would) you (?:explain|clarify|rephrase|say that (?:again|differently))\b|\bwhat(?:'s| is) (?:that|this|it|the \w+|my \w+) for\b|\bwhat for\b|\bhuh\b/,
  /\bwhy (?:do|would|did) you (?:need|want|ask)\b|\bwhy (?:is|are) (?:that|this|it) (?:needed|necessary|required)\b|\bwhy (?:do )?you need (?:that|this|it|my)\b/,
];
const WHY_ASKED = /\bwhy (?:do|would|did) you (?:need|want|ask)\b|\bwhy (?:is|are) (?:that|this|it) (?:needed|necessary|required)\b|\bwhat(?:'s| is) (?:that|this|it|the \w+|my \w+) for\b|\bwhat for\b/;

const STATUS = [
  /\b(?:when|what time)\b[^?.!]{0,40}\b(?:arrive|get here|come|coming|be here|show up|stop by|call me|call back|respond|reply|hear back|get back to me)\b/,
  /\bhow (?:soon|fast|quickly|long)\b[^?.!]{0,40}\b(?:get here|arrive|come|be here|respond|call|reply|take to (?:get|arrive|respond|call))\b/,
  /\b(?:is|are) (?:someone|somebody|anyone|anybody|a (?:plumber|tech\w*)|the (?:plumber|tech\w*|team|crew)) (?:coming|on (?:the|their|his|her) way|on way|headed|dispatched|going to come)\b/,
  /\b(?:did|has|have|will) (?:you|anyone|someone|somebody|the (?:team|business|plumber|owner)) (?:send|sent|dispatch\w*|notif\w*|get my|got my|receive\w*|see my|call\w*|respond\w*|contact\w*|come|arrive)\b/,
  /\b(?:status|update)\b[^?.!]{0,30}\b(?:request|lead|inquiry|call|order|ticket|appointment|visit|message)\b|\bany (?:update|news)\b|\bhas (?:anyone|somebody) (?:called|responded|replied)\b/,
];
const DISPATCH = /\b(?:send|dispatch|get|need|want)\s+(?:a |an |the |some )?(?:plumber|tech\w*|someone|somebody|crew|team|help)\s*(?:out|over|here|now|asap|today|right now|immediately|to (?:my|the) (?:house|home|place|address))\b|\bsend (?:a |someone |somebody )?(?:out|over)\b|\bcome out (?:now|today|tonight|right now|asap)\b/;
const BOOKING = /\b(?:book|schedule|set up|make|reserve|get)\s+(?:me\s+)?(?:an?\s+)?(?:appointment|visit|time|slot|booking)\b|\bcan i (?:book|schedule)\b|\bbook (?:me|us|a)\b/;
const CHANGE = /\b(?:cancel|reschedule|change|confirm|move|verify)\s+(?:my|the|our)\s+(?:appointment|visit|booking|request|service|reservation)\b/;

const IDENTITY = [
  /\b(?:are|r) (?:you|u) (?:a |an |really |actually )?(?:real |live |actual )?(?:person|human|bot|robot|ai|chatbot|machine|automated|computer|program)\b/,
  /\bam i (?:talking|speaking|chatting|typing) (?:to|with) (?:a |an )?(?:real |live |actual )?(?:person|human|bot|robot|ai|machine|computer)\b/,
  /\bis this (?:a |an )?(?:real |live |actual )?(?:person|human|bot|robot|ai|automated|chatbot|machine)\b|\bis (?:anyone|somebody) (?:there|real)\b/,
];

const RESET = /\b(?:start over|start again|begin again|from the beginning|scratch that|clear (?:this|everything|it all)|(?:reset|restart) (?:this|the chat|our chat|this chat|everything|it all|the conversation))\b|^(?:reset|restart)[.! ]*$/;
const ABANDON_ANYWHERE = /\b(?:never ?mind|nvm|cancel (?:this|that|it|everything)|forget (?:it|this|that)|leave me alone|don'?t (?:need|want) (?:help|this|anything|it)|no longer need)\b/;
// Soft endings only count as "I'm leaving" when they are most of the message ("nothing else works" is a description).
const ABANDON_SHORT = /^(?:(?:ok(?:ay)?|no|nope|nah|thanks|thank you)[, ]+)?(?:i(?:'ll| will) (?:just )?(?:call|go elsewhere|find someone else|figure it out)\b|that'?s all|that is all|nothing else|i'?m done|no that'?s all)/;
const ABANDON = [ABANDON_ANYWHERE, /^(?:stop|quit|exit|bye|goodbye)[.! ]*$/];
const FALSE_ALARM = /\b(?:false alarm|(?:it|that)(?:'s| is| was) (?:nothing|fine|ok(?:ay)?|okay now|a false)|(?:all|everything)(?: is| seems)? (?:good|fine|ok(?:ay)?) now|(?:it )?stopped (?:now|already|on its own)|resolved (?:itself|now)|went away|turned it off|shut (?:it|the (?:water|gas|valve|main))(?: off)?|(?:no longer|not) (?:leaking|smelling))\b/;

const CORRECTION = /\b(?:actually|i meant|i mean|correction|oops|typo|let me (?:correct|fix)|that'?s (?:not right|wrong|not correct|incorrect)|(?:that|it) was (?:wrong|a typo)|(?:not|isn'?t) (?:my|the) (?:phone|number|name|zip|address|email)|wrong (?:phone|number|name|zip|email)|(?:change|update|fix) (?:my|the) (?:phone|number|name|zip|email|address|issue|problem)|my (?:phone|number|name|zip|email) (?:is|should be) (?:actually|really|now)|sorry,? (?:it'?s|its|my|that))\b|^no[,.! ]+(?:it'?s|its|my|the|that'?s|that is)\b|^wait\b/;
const WRONG_VALUE = /\b(?:wrong|incorrect|not (?:my|the)|typo) (?:phone|number|zip|email|name)\b|\b(?:phone|number|zip|email|name) (?:is|was) (?:wrong|incorrect|a typo)\b|\bthat'?s not (?:my|the) (?:phone|number|zip|email|name)\b/;

const SKIP = /\b(?:skip(?: it| that| this| that one)?|pass|rather not|prefer not|don'?t want to (?:give|share|say|provide|answer)|not comfortable|not giving|won'?t give|refuse to|no thanks|i won'?t|none of your business|prefer to keep (?:it|that) private|decline|not sharing)\b/;
const DONT_KNOW = /\b(?:i don'?t know|dunno|not sure|no idea|idk|unsure|can'?t say|can'?t tell)\b/;

const SUMMARY = /\bwhat (?:do you|have you|did you) (?:have|got|record(?:ed)?|saved?|collect(?:ed)?)\b|\bwhat did i (?:tell|say|give)\b|\b(?:do you|did you) (?:have|get|catch|save|record) my\b|\bread (?:it |that |everything )?back\b|\bsummar\w+\b|\bwhat(?:'s| is) on file\b/;

const WH_START = /^(?:who|what|when|where|why|how|do|does|did|can|could|would|will|is|are|am|should|may)\b/;

/** Letters only, lowercased, for comparing "did the customer just repeat themselves". */
export const fingerprint = (raw) => clean(raw).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function isAllCapsShout(t) {
  const words = t.split(" ").filter((w) => /^[A-Z]{3,}[!?.,]*$/.test(w));
  const letters = t.replace(/[^A-Za-z]/g, "");
  return words.length >= 3 && letters.length >= 12 && letters === letters.toUpperCase();
}

function isNoise(t) {
  if (!/[\p{L}\p{N}]/u.test(t)) return true; // punctuation or emoji only
  if (/^(.)\1{5,}$/u.test(t.replace(/\s+/g, ""))) return true; // "aaaaaaaa"
  const tokens = t.split(" ");
  if (tokens.length === 1 && /^[\p{L}]{5,}$/u.test(t) && /(?:asd|sdf|dfg|fgh|ghj|hjk|jkl|qwe|wer|ert|zxc|xcv|cvb|vbn)/i.test(t)) return true; // keyboard mashing
  return tokens.length === 1 && /^[\p{L}]{6,}$/u.test(t) && !/[aeiouyáéíóúü]/i.test(t); // "bcdfghjk"
}

/**
 * @param {string} raw one normalized customer message
 * @returns {object} flags (all booleans unless noted)
 */
export function analyze(raw) {
  const t = clean(raw);
  const lower = t.toLowerCase();
  const words = t.split(" ").filter(Boolean);
  const strong = FRUSTRATION_STRONG.filter((r) => r.test(lower)).length;
  let mild = FRUSTRATION_MILD.filter((r) => r.test(lower)).length;
  if (isAllCapsShout(t)) mild += 1;
  const frustration = strong > 0 ? 2 : mild >= 2 ? 2 : mild === 1 ? 1 : 0; // 0 none, 1 mild, 2 strong

  const status = STATUS.some((r) => r.test(lower));
  const dispatch = DISPATCH.test(lower);
  const booking = BOOKING.test(lower);
  const change = CHANGE.test(lower);

  return {
    wordCount: words.length,
    greeting: GREETING.test(lower),
    thanks: THANKS.test(lower),
    ack: ACK.test(lower),
    yes: YES.test(lower),
    no: NO.test(lower),
    frustration,
    angry: strong > 0,
    alreadyTold: /\b(?:i|we)(?: already| just)? (?:told|said|gave|sent|provided) (?:you|that|this|it)\b|\balready (?:told|gave|said|sent|provided)\b/.test(lower),
    confusion: CONFUSION.some((r) => r.test(lower)) || /^(?:\?+|what\??|wut\??|eh\??)$/.test(lower),
    whyAsked: WHY_ASKED.test(lower),
    status, dispatch, booking, change,
    actionAsk: status || dispatch || booking || change, // asks for something this assistant cannot do or see
    identity: IDENTITY.some((r) => r.test(lower)),
    reset: RESET.test(lower),
    abandon: ABANDON.some((r) => r.test(lower)) || (ABANDON_SHORT.test(lower) && words.length <= 7),
    falseAlarm: FALSE_ALARM.test(lower) && !/\b(?:still|but|however|though|yet|keeps?|won'?t stop|not stopp\w+)\b/.test(lower),
    correction: CORRECTION.test(lower),
    wrongValue: WRONG_VALUE.test(lower),
    skip: SKIP.test(lower),
    dontKnow: DONT_KNOW.test(lower) || /^(?:idk|dunno|maybe)[.!, ]*$/.test(lower),
    summaryAsk: SUMMARY.test(lower),
    question: /\?\s*$/.test(t) || (WH_START.test(lower) && words.length >= 3),
    noise: isNoise(t),
    smalltalkOnly: GREETING.test(lower) || THANKS.test(lower) || ACK.test(lower),
  };
}
