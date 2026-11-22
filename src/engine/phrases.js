// Customer-facing wording for the conversation engine, with VARIANTS so the assistant never repeats the same
// sentence when it has to ask or explain something again. The first variant of each prompt is the original
// Stage 3 wording (existing tests and the widget rely on it); later variants are used on repeats.
//
// Honesty rules that every line here must keep (tested in tests/conversation.*.test.mjs):
//   - never say anything was recorded, sent, booked, dispatched or confirmed unless the engine has just
//     confirmed it from a real result (only the "recorded*" lines in engine.js do, and only after a read-back);
//   - never promise a time, a price, an arrival or a callback;
//   - never claim to be a person.

/** Picks the next variant for `key` and counts the use in `state.used` (small, bounded object). */
export function pick(state, key, variants) {
  state.used = state.used && typeof state.used === "object" ? state.used : {};
  const n = Number.isInteger(state.used[key]) ? state.used[key] : 0;
  state.used[key] = Math.min(n + 1, 1000);
  return variants[n % variants.length];
}

export const PROMPTS = {
  issue: [
    "What is the plumbing problem?",
    "Could you describe what's going on with your plumbing? For example a leak, a clog, or no hot water.",
  ],
  name: ["What is your first and last name?", "Who should the team ask for? A first and last name is enough."],
  phone: ["What is the best phone number to reach you?", "What phone number can the team reach you at?"],
  zip: ["What is the ZIP code of the property?", "And the ZIP code of the property?"],
  urgency: ["Is this happening right now, or can it wait?", "Is it urgent right now, or can it wait?"],
};

export const RETRY = {
  name: [
    "I didn't catch a name. Please type your first and last name.",
    "Sorry, I still don't have a name I can use. A first and last name works, or say \"skip\" to leave it out.",
  ],
  phone: [
    "That doesn't look like a valid US phone number. Please send a 10-digit number, like 512-555-0142.",
    "Sorry, I still can't read that as a valid US phone number. Please send 10 digits like 512-555-0142, or an email address if you prefer.",
  ],
  zip: ["Please send your 5-digit service ZIP code.", "I still need a 5-digit ZIP code like 62701, or say \"skip\" to leave it out."],
  urgency: [
    "Is this happening right now, or can it wait? Please answer \"now\" or \"can wait\".",
    "Just reply \"now\" if it's happening right now, \"can wait\" if it isn't urgent, or \"skip\".",
  ],
  issue: [
    "I need a short description of the problem. For example: a leak, a clog, no hot water, a running toilet.",
    "Tell me in your own words what's wrong, even a few words is enough. Or say \"I want a person\" and I'll record a request for someone at the business.",
  ],
};

/** Why each question is asked (used when the customer is confused or asks "why do you need that?"). */
export const WHY = {
  issue: "I ask so the business team knows what the problem is.",
  name: "I ask so the team knows who to ask for. You can say \"skip\" to leave it out.",
  phone: "I ask so the team has a way to reach you about this request. I can't promise when they will respond.",
  zip: "I ask so the team can check whether the property is in the area the business serves. You can say \"skip\" to leave it out.",
  urgency: "I ask so the team can see whether this is happening right now. You can say \"skip\" to leave it out.",
};

export const SAY = {
  greeting: (biz) => [
    `Hi! I'm an automated assistant${biz ? ` for ${biz}` : ""}. I can answer questions from the business's verified information or record a plumbing request for the team. What's going on?`,
    "Hello again. Tell me what you need: a question about the business, or the plumbing problem you'd like the team to look at.",
  ],
  thanksOpen: ["You're welcome.", "Happy to help."],
  thanksDone: ["You're welcome. Is there anything else I can help with?", "Glad to help. If something else comes up, just ask."],
  ack: ["Got it.", "Thanks."],
  ackName: (n) => [`Thanks, ${n}.`, `Got it, ${n}.`],
  skipped: ["No problem, we can leave that out.", "That's fine, I'll leave that out."],
  dontKnowOptional: ["That's okay, we can leave that out.", "No worries, I'll skip it."],
  mildFrustration: ["Sorry about that. I'll keep this short.", "I'm sorry, I'll keep this quick."],
  strongFrustration: ["I'm sorry this has been frustrating.", "I'm sorry I haven't been more help."],
  frustrationOffer: "If you'd rather have a person follow up, just say so and I'll record a request for someone at the business. I can't transfer you live.",
  frustrationHandoff: "I can't transfer you live from this chat.",
  confusionGeneric: [
    "Sorry for the confusion. I'm an automated assistant: I can answer questions from the business's verified information and record a request for the team. What would you like help with?",
    "Let me put it simply: tell me the plumbing problem, or ask a question about the business, and I'll take it from there.",
  ],
  identity: "I'm an automated text assistant, not a person. I can answer questions from the business's verified information and record a request for the team to review.",
  statusBefore: "I can't dispatch anyone, see arrival times, or check on visits from this chat. I can record your request for the business team to review once I have your details.",
  statusAfter: "Your request is recorded for the business team to review. I can't see whether anyone has acted on it, and I can't promise when they will respond.",
  dispatchNote: "I can't dispatch anyone from this chat, but I can record your request for the business team.",
  bookingNote: "I can't book or schedule visits from this chat. The business team confirms appointments.",
  changeNote: "I can't see, confirm, change, or cancel appointments from this chat. Please contact the business directly.",
  abandonOpen: "No problem. Nothing has been recorded from this chat. If you need anything later, I'm here.",
  abandonDone: "Understood. Your request stays recorded for the business team to review.",
  falseAlarm: (num) => `I'm glad to hear that. Because a safety concern came up, please keep following the safety steps above and call ${num} if you're unsure.`,
  reset: "Okay, starting over. Nothing has been recorded yet.",
  resetDone: "Your request is already recorded, and this chat can't take a second one. To send something different, please contact the business directly or start a new chat.",
  correctedAfterSave: "I can't change a request that's already recorded from this chat. Please contact the business directly to correct it.",
  repeatKnown: [
    "I've shared everything I have verified on that above.",
    "That's all I have verified on that topic, and I don't want to guess.",
  ],
  repeatUnknown: [
    "I don't have verified information on that, and I don't want to guess.",
    "I still don't have a verified answer to that, so I won't guess.",
  ],
  offerPerson: "I can record a request for a person at the business to follow up on it. Would you like that? Reply yes or no.",
  offerDeclined: "Okay, I won't.",
  loopBreak: "I don't want to keep repeating myself.",
  stuckContact: "I'm having trouble getting a phone number or email I can use, so I can't record a request from this chat.",
  stuckIssue: "I'll skip the description. I can still record a request for a person at the business if I have your contact details.",
  recoveredStuck: "Thanks, that worked.",
  nearLimit: "This chat is close to its length limit.",
  emergencyReminder: (num, lifeSafety) => [
    lifeSafety ? `Please keep following the safety steps I gave above. If anyone is in danger or you can't follow them, call ${num} now.` : "Please keep following the safety steps I gave above.",
    lifeSafety ? `The safety steps above still apply. If you or anyone else may be in danger, call ${num} now.` : "The safety steps above still apply.",
  ],
  junk: ["I couldn't read that. Could you say it a different way?", "Sorry, that didn't come through clearly. Could you type it again?"],
  updated: ["Thanks, I've updated that.", "Got it, I've changed that."],
  fixing: ["Okay, let's fix that.", "No problem, let's correct that."],
  autoHandoff: "I've flagged this conversation so a person at the business can look at it. I can't promise when anyone will respond, and I need a phone number or email to pass anything on.",
  noContactCannotRecord: "Without a phone number or email I can't record a request for the team.",
  nearLimitHint: "This chat is close to its length limit, so please send your phone number now if you want a request recorded.",
  noContactAdviceGeneric: "Please try again in a few minutes, or contact the business another way.",
};

export const FIELD_LABEL = { phone: "phone number", email: "email address", zip: "ZIP code", name: "name", urgency: "urgency", issue: "description" };
