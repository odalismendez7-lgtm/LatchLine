// Industry pack: residential plumbing.
//
// Industry-specific content (emergency rules, approved default procedures,
// intake fields) lives here as DATA so the core platform stays industry-neutral
// and new industries can be added as new packs (see docs/ARCHITECTURE.md).
//
// REVIEW STATUS: the default procedure texts below are generic, widely
// published safety guidance written for development. They have NOT been
// reviewed by a licensed professional or by any plumbing business. Each real
// business must review and approve its own procedures (stored in its knowledge
// base) before real customers use the product. See docs/SECURITY.md.

// "co" must not match inside words or hyphenated words (e.g. "co-worker").
const CO = "(?:(?<![\\w-])co(?![\\w-])|carbon\\s+monoxide)";
const R = (src) => new RegExp(src, "gi");

export const plumbingPack = {
  id: "plumbing",
  version: "0.1.0",
  locale: "US",
  emergencyNumber: "911",

  // Higher-priority categories are listed first.
  categoryOrder: [
    "life_threat",
    "gas_leak",
    "carbon_monoxide",
    "fire_smoke",
    "electrical_hazard",
    "flooding",
    "sewage",
  ],

  // Rules run on normalized lowercase text. `exempt` patterns suppress a match
  // when they overlap it (e.g. "flood zone" is not a flood).
  rules: [
    // ---- gas ----
    { id: "gas-smell", category: "gas_leak", patterns: [R("\\bsmell(?:s|ed|ing)?\\s+(?:of\\s+|like\\s+)?(?:natural\\s+|propane\\s+)?gas+\\b")] },
    { id: "gas-leak", category: "gas_leak", patterns: [R("\\bgas+\\s+(?:leak(?:s|ing|ed)?|smell|odou?r|fumes?)\\b"), R("\\bleak(?:s|ing|ed)?\\s+(?:natural\\s+|propane\\s+)?gas\\b")] },
    { id: "gas-rotten-eggs", category: "gas_leak", patterns: [R("\\b(?:rotten|sulfur|sulphur)\\s+eggs?\\b"), R("\\breek(?:s|ed|ing)?\\s+of\\s+gas+\\b")] },
    { id: "gas-escaping", category: "gas_leak", patterns: [R("\\bgas+\\s+(?:is\\s+|was\\s+|keeps\\s+)?(?:leaking|escaping)\\b")] },
    { id: "gas-hiss", category: "gas_leak", patterns: [R("\\bhiss(?:ing|es)?\\s+(?:sound\\s+)?(?:coming\\s+)?(?:from|near|at|by)\\s+(?:the\\s+|my\\s+)?gas\\b"), R("\\bgas\\s+line\\s+(?:is\\s+)?(?:broken|cut|ruptured|hissing)\\b")] },

    // ---- carbon monoxide ----
    { id: "co-alarm", category: "carbon_monoxide", patterns: [R(`\\b${CO}\\s+(?:alarm|detector|monitor|sensor)s?\\b[^.!?]{0,40}\\b(?:going\\s+off|goes\\s+off|went\\s+off|beeping|beeps|sounding|sounded|alarming|triggered|blaring|screaming|chirping|alerting)\\b`)] },
    { id: "co-leak", category: "carbon_monoxide", patterns: [R(`\\b${CO}\\s+(?:is\\s+)?(?:leak(?:s|ing)?|poisoning|exposure)\\b`), R(`\\bleak(?:s|ing)?\\s+${CO}\\b`)] },
    { id: "co-symptoms", category: "carbon_monoxide", patterns: [
      R(`\\b${CO}\\b[^.!?]{0,60}\\b(?:headaches?|dizz(?:y|iness)|nauseous|nausea|symptoms)\\b`),
      R(`\\b(?:headaches?|dizz(?:y|iness)|nauseous|nausea)\\b[^.!?]{0,60}\\b${CO}\\b`),
      R("\\b(?:headaches?|dizz(?:y|iness)|nauseous|nausea)\\b[^.!?]{0,60}\\b(?:furnace|boiler|water\\s+heater|heater|stove|generator)\\b"),
      R("\\b(?:furnace|boiler|water\\s+heater|heater|stove|generator)\\b[^.!?]{0,60}\\b(?:headaches?|dizz(?:y|iness)|nauseous|nausea)\\b"),
    ] },

    // ---- electrical hazard (alone, or near water) ----
    { id: "elec-direct", category: "electrical_hazard", patterns: [
      R("\\b(?:live|exposed|downed)\\s+wires?\\b"),
      R("\\belectric(?:al)?\\s+shock(?:ed)?\\b"),
      R("\\b(?:got|been|get|was|am|were)\\s+shocked\\b"),
      R("\\bsparking\\b"),
      R("\\bsparks?\\s+(?:are\\s+)?(?:coming|flying|shooting)\\b"),
      R("\\bsparks?\\s+(?:from|out\\s+of|near)\\b"),
    ] },
    { id: "elec-water", category: "electrical_hazard", patterns: [
      R("\\b(?:water|flood(?:ing|ed)?|leak(?:s|ing)?|dripping|wet|puddle)\\b[^.!?]{0,60}\\b(?:outlets?|sockets?|electrical\\s+panel|breaker\\s+(?:box|panel)|fuse\\s+box|panel|wiring|power\\s+strip|extension\\s+cord|light\\s+fixtures?|ceiling\\s+fan)\\b"),
      R("\\b(?:outlets?|sockets?|electrical\\s+panel|breaker\\s+(?:box|panel)|fuse\\s+box|panel|wiring|power\\s+strip|extension\\s+cord|light\\s+fixtures?|ceiling\\s+fan)\\b[^.!?]{0,60}\\b(?:water|wet|flood(?:ing|ed)?|leak(?:s|ing)?|dripping)\\b"),
    ] },

    // ---- fire / smoke ----
    { id: "fire", category: "fire_smoke", patterns: [
      R("\\b(?:on|caught|catching)\\s+fire\\b"),
      R("\\bsee\\s+(?:flames|fire)\\b"),
      R("\\bsmok(?:e|ing)\\s+(?:is\\s+)?(?:coming|pouring|rising)\\s+(?:from|out\\s+of|off)\\b"),
      R("\\bsmok(?:e|ing)\\s+from\\b"),
      R("\\b(?:water\\s+heater|furnace|boiler|panel|outlet|appliance)\\s+(?:is\\s+)?smok(?:ing|es)\\b"),
      R("\\bsmell(?:s|ing)?\\s+(?:of\\s+|like\\s+)?(?:something\\s+)?burn(?:ing|t)\\b"),
      R("\\bburning\\s+(?:smell|odou?r)\\b"),
    ] },

    // ---- someone may be hurt ----
    { id: "life-threat", category: "life_threat", patterns: [
      R("\\b(?:unconscious|unresponsive|not\\s+breathing|trouble\\s+breathing|difficulty\\s+breathing|chest\\s+pain|passed\\s+out|collapsed|seizure|electrocuted)\\b"),
      R("\\b(?:can't|cannot|can\\s+not)\\s+breathe\\b"),
      R("\\b(?:severely|badly)\\s+(?:injured|burned|hurt)\\b"),
    ] },

    // ---- flooding / burst pipes ----
    { id: "flood-word", category: "flooding", patterns: [R("\\bflood(?:s|ed|ing)?\\b")],
      exempt: [R("\\bflood\\s+(?:insurance|zones?|maps?|plains?|lights?|lamps?)\\b")] },
    { id: "burst", category: "flooding", patterns: [
      R("\\b(?:burst|bursting|ruptured|exploded|busted)\\s+(?:water\\s+)?(?:pipe|line|main|hose)\\b"),
      R("\\b(?:pipe|water\\s+main|supply\\s+line|water\\s+line|water\\s+heater)\\s+(?:has\\s+|just\\s+)?(?:burst|broke|ruptured|exploded|busted)\\b"),
    ] },
    { id: "frozen-ceiling", category: "flooding", patterns: [
      R("\\b(?:cracked|split)\\s+(?:water\\s+)?(?:pipe|line)s?\\b"),
      R("\\bpipes?\\s+(?:froze|frozen|freezing)\\b[^.!?]{0,20}\\b(?:crack\\w*|burst|split\\w*)\\b"),
      R("\\bceiling\\b[^.!?]{0,30}\\b(?:collaps\\w*|caving|sagging|bulging)\\b"),
      R("\\bwater\\s+(?:is\\s+)?(?:coming|bubbling|seeping|pouring)\\s+up\\s+(?:from|through|out\\s+of)\\b"),
    ] },
    { id: "gushing", category: "flooding", patterns: [
      R("\\bwater\\s+(?:is\\s+)?(?:gushing|pouring|spraying|shooting|streaming|rushing|everywhere)\\b"),
      R("\\b(?:gushing|spraying)\\s+water\\b"),
      R("\\bwater\\s+(?:is\\s+)?(?:coming|pouring|running|leaking|dripping)\\s+(?:down\\s+)?(?:through|from|out\\s+of)\\s+(?:the\\s+|my\\s+)?(?:ceiling|light\\s+fixture|walls?)\\b"),
    ] },
    { id: "cant-shut-off", category: "flooding", patterns: [
      R("\\b(?:can't|cannot|can\\s+not|unable\\s+to)\\s+(?:shut|turn)\\s+(?:off\\s+)?(?:the\\s+|my\\s+)?(?:water|main\\s+valve|valve)\\b"),
      R("\\bwater\\s+(?:won't|will\\s+not|doesn't|cannot|can't)\\s+(?:stop|turn\\s+off|shut\\s+off)\\b"),
      R("\\b(?:shut\\s*off|shutoff)\\s+valve\\s+(?:is\\s+)?(?:stuck|broken|not\\s+working)\\b"),
    ] },
    { id: "major-leak", category: "flooding", patterns: [
      R("\\b(?:major|serious|huge|big|bad|severe)\\s+(?:water\\s+)?leak\\b"),
      R("\\bleak(?:ing|s)?\\s+(?:badly|everywhere|heavily|a\\s+lot|like\\s+crazy)\\b"),
      R("\\b(?:inches|feet|foot)\\s+of\\s+(?:standing\\s+)?water\\b(?!\\s+(?:line|pipe|main|supply|hose))"),
      R("\\bstanding\\s+water\\b"),
      R("\\b(?:basement|garage|kitchen|bathroom|floor|house)\\s+(?:is\\s+)?(?:filling|filled)\\s+(?:up\\s+)?(?:with\\s+)?water\\b"),
    ] },

    // ---- sewage ----
    { id: "sewage", category: "sewage", patterns: [
      R("\\bsewage\\b"),
      R("\\bsewer\\s+(?:line\\s+|drain\\s+)?(?:is\\s+|has\\s+)?(?:back(?:ing|ed)?\\s*up|backup|overflow(?:ing|ed)?|burst|break|broke)\\b"),
      R("\\b(?:toilets?|drains?|tub|shower|floor\\s+drain)\\s+(?:is\\s+|are\\s+)?(?:overflowing|backing\\s+up|bubbling\\s+up)\\b"),
    ] },
  ],

  // Default (unreviewed) approved procedures, one per category.
  procedures: {
    life_threat: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "If anyone is unconscious, struggling to breathe, or badly hurt, call 911 now and follow the operator's instructions.",
    },
    gas_leak: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "This may be a gas emergency. Leave the building now and take everyone with you. Don't use light switches, appliances, or open flames, and don't use a phone inside. Once you are outside and away from the building, call 911 and your gas utility's emergency line.",
    },
    carbon_monoxide: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "Get everyone, including pets, outside to fresh air now. Call 911 from outside. Don't go back in until emergency responders say it is safe. If anyone feels dizzy, sick, confused, or has a headache, tell the 911 operator.",
    },
    fire_smoke: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "If there is fire or smoke, get everyone out and call 911 from outside. Do not try to put out a fire at an appliance yourself.",
    },
    electrical_hazard: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "Stay away from the electrical hazard and from any water near it. Don't touch the equipment, outlets, or standing water. If anyone has been shocked or there is fire, call 911.",
    },
    flooding: {
      severity: "urgent",
      callEmergencyServices: false,
      text: "Water can become dangerous quickly. If it is safe and you know where it is, shut off the main water valve. Stay out of standing water if outlets or electrical equipment could be affected, and keep children and pets away.",
    },
    sewage: {
      severity: "urgent",
      callEmergencyServices: false,
      text: "Sewage can carry germs. Avoid contact with the water, keep children and pets away, and avoid using sinks, toilets, and drains until it has been looked at.",
    },
  },

  // Fields the conversation engine will collect (used from Stage 3).
  intakeFields: [
    { key: "name", label: "Full name", required: true },
    { key: "phone", label: "Phone number", required: true },
    { key: "email", label: "Email address", required: false },
    { key: "zip", label: "Service ZIP code", required: true },
    { key: "issue", label: "Plumbing issue", required: true },
    { key: "urgency", label: "Happening now or can wait", required: true },
    { key: "preferredContact", label: "Preferred contact method", required: false },
    { key: "preferredTime", label: "Preferred appointment time (not a booking)", required: false },
  ],
};
