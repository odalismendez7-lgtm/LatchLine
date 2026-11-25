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
    "water_heater_hazard",
    "flooding",
    "sewage",
    "unspecified_emergency",
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
      R("\\b(?:got|been|was|were|is|gets)\\s+scalded\\b"),
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
    // ---- water heater / boiler hazards (steam, banging, spraying relief valve) ----
    { id: "wh-noise-steam", category: "water_heater_hazard", patterns: [
      R("\\b(?:water\\s+heater|boiler|hot\\s+water\\s+tank)\\b[^.!?]{0,60}\\b(?:banging|bang|bangs|boom|booming|rumbling|screaming|whistling|hissing|steam(?:ing|s|y)?|exploding|about\\s+to\\s+(?:explode|burst|blow))\\b"),
      R("\\b(?:banging|bang|bangs|boom|booming|rumbling|screaming|whistling|hissing|steam(?:ing)?)\\b[^.!?]{0,60}\\b(?:water\\s+heater|boiler|hot\\s+water\\s+tank)\\b"),
    ], exempt: [R("\\bsteam\\s+(?:boiler|heat|heating|radiators?|system)\\b")] },
    { id: "wh-relief-valve", category: "water_heater_hazard", patterns: [
      R("\\b(?:pressure\\s+relief|temperature\\s+and\\s+pressure|t\\s*&\\s*p|t/p)\\s+valve\\b[^.!?]{0,40}\\b(?:spraying|blowing|shooting|gushing|screaming)\\b"),
    ] },

    // ---- unspecified emergencies: catches wording no specific rule covers ----
    // Stands alone only when no specific hazard matched. Questions ABOUT emergency
    // service (fees, hours, whether we handle it) are exempt.
    { id: "unspecified", category: "unspecified_emergency", patterns: [
      R("\\bemergenc(?:y|ies)\\b"),
      R("\\b(?:dangerous|danger|unsafe|life[- ]threatening)\\b"),
      R("\\b911\\b"),
      R("\\bevacuat(?:e|ed|ing|ion)\\b"),
      R("\\b(?:someone|somebody|anyone)\\s+(?:could|might|will|can)\\s+(?:get\\s+)?(?:hurt|injured|killed)\\b"),
    ], exempt: [
      R("\\b(?:how\\s+much|what(?:'s|\\s+is|\\s+are)|do\\s+you|does\\s+your|is\\s+there|how\\s+do\\s+you\\s+charge)\\b[^.!?,;]{0,40}\\bemergenc(?:y|ies)\\b"),
      R("\\bemergenc(?:y|ies)\\s+(?:fee|fees|rate|rates|hours|pricing|surcharge|charge|charges)\\b"),
      R("\\bemergenc(?:y|ies)\\s+shut\\s*-?\\s*off\\b"),
      R("\\bis\\s+it\\s+(?:dangerous|unsafe)\\s+to\\s+wait\\b"),
    ] },

    // ================= Spanish (lang: "es"). Text is accent-stripped before matching. =================
    { id: "es-gas", category: "gas_leak", lang: "es", patterns: [
      R("\\bhuel[eo]\\s+(?:a\\s+)?gas\\b"), R("\\bolor\\s+a\\s+gas\\b"),
      R("\\b(?:fuga|escape)\\s+de\\s+gas\\b"), R("\\bgas\\s+(?:se\\s+)?(?:esta\\s+)?escapando\\b"),
    ] },
    { id: "es-co", category: "carbon_monoxide", lang: "es", patterns: [
      R("\\b(?:alarma|detector|sensor|monitor)\\s+de\\s+(?:co|monoxido(?:\\s+de\\s+carbono)?)\\b[^.!?]{0,40}\\b(?:suena|sono|sonando|pitando|pita|activado|activo|alarma|disparo)\\b"),
      R("\\bmonoxido\\s+de\\s+carbono\\b[^.!?]{0,40}\\b(?:alarma|suena|sonando|fuga|intoxicacion|mareo|dolor\\s+de\\s+cabeza)\\b"),
      R("\\bfuga\\s+de\\s+monoxido\\b"),
    ] },
    { id: "es-fire", category: "fire_smoke", lang: "es", patterns: [
      R("\\bincendio\\b"), R("\\b(?:esta|hay)\\s+(?:en\\s+)?(?:fuego|llamas)\\b"),
      R("\\bhumo\\b[^.!?]{0,40}\\b(?:calentador|caldera|boiler|horno|tablero|enchufe|aparato)\\b"),
      R("\\b(?:calentador|caldera|boiler|tablero|enchufe|aparato)\\b[^.!?]{0,40}\\bhumo\\b"),
      R("\\b(?:huele|olor)\\s+a\\s+(?:quemado|humo)\\b"),
    ] },
    { id: "es-electric", category: "electrical_hazard", lang: "es", patterns: [
      R("\\b(?:chispas|chispazo)\\b"), R("\\bdescarga\\s+electrica\\b"),
      R("\\bcables?\\s+(?:vivos?|pelados?|expuestos?)\\b"),
      R("\\b(?:me|nos|le)\\s+(?:dio|dieron)\\s+(?:un\\s+)?(?:toque|choque|descarga)\\b"),
      R("\\bagua\\b[^.!?]{0,60}\\b(?:enchufe|tomacorriente|tablero|panel\\s+electrico|caja\\s+de\\s+fusibles)\\b"),
      R("\\b(?:enchufe|tomacorriente|tablero|panel\\s+electrico|caja\\s+de\\s+fusibles)\\b[^.!?]{0,60}\\bagua\\b"),
    ] },
    { id: "es-life", category: "life_threat", lang: "es", patterns: [
      R("\\b(?:inconsciente|no\\s+respira|no\\s+puede\\s+respirar|no\\s+puedo\\s+respirar|desmayado|desmayo|convulsiones|dolor\\s+de\\s+pecho|electrocutado)\\b"),
    ] },
    { id: "es-water-heater", category: "water_heater_hazard", lang: "es", patterns: [
      R("\\b(?:calentador|boiler|caldera|tanque)\\b[^.!?]{0,60}\\b(?:golpeteo|golpes|ruido\\s+fuerte|vapor|silbido|explot\\w+|hirviendo)\\b"),
      R("\\b(?:golpeteo|vapor|silbido)\\b[^.!?]{0,60}\\b(?:calentador|boiler|caldera|tanque)\\b"),
    ] },
    { id: "es-flood", category: "flooding", lang: "es", patterns: [
      R("\\b(?:se\\s+)?inund(?:o|a|ando|andose|acion)\\b"),
      R("\\b(?:tuberia|tubo|caneria|cañeria|manguera)\\s+(?:se\\s+)?(?:rota|reventada|revento|rompio|rompida)\\b"),
      R("\\bse\\s+(?:revento|rompio)\\s+(?:una|la|el)\\s+(?:tuberia|tubo|caneria|manguera)\\b"),
      R("\\bagua\\s+(?:esta\\s+)?(?:saliendo|brotando|cayendo)\\s+(?:a\\s+chorros|por\\s+el\\s+techo|por\\s+las\\s+paredes)\\b"),
      R("\\bagua\\s+por\\s+(?:todos\\s+lados|todas\\s+partes|todo\\s+el\\s+piso)\\b"),
      R("\\bno\\s+(?:puedo|podemos|se\\s+puede)\\s+(?:cerrar|apagar|parar)\\s+(?:el\\s+|la\\s+)?(?:agua|llave|valvula)\\b"),
      R("\\bfuga\\s+(?:grande|fuerte|grave)\\s+de\\s+agua\\b"),
    ], exempt: [R("\\b(?:zona|zonas|seguro|mapa|riesgo)\\s+de\\s+inundacion\\b"), R("\\binundacion\\s+(?:seguro|zona)\\b")] },
    { id: "es-sewage", category: "sewage", lang: "es", patterns: [
      R("\\baguas\\s+negras\\b"),
      R("\\b(?:drenaje|alcantarilla|desague|alcantarillado)\\s+(?:esta\\s+)?(?:desbordado|desbordandose|reventado|regresando|subiendo)\\b"),
      R("\\b(?:inodoro|excusado|sanitario|taza|wc)\\s+(?:se\\s+)?(?:esta\\s+)?(?:desbordando|rebosando|desborda)\\b"),
    ] },
    { id: "es-unspecified", category: "unspecified_emergency", lang: "es", patterns: [
      R("\\bemergencias?\\b"), R("\\bpeligro(?:so|sa)?\\b"),
    ], exempt: [
      R("\\b(?:atienden|hacen|ofrecen|tienen|manejan|dan)\\s+(?:servicio\\s+de\\s+)?emergencias?\\b"),
      R("\\b(?:servicio|costo|tarifa|precio|horario|cargo)s?\\s+(?:de\\s+)?emergencias?\\b"),
      R("\\bcuanto\\s+(?:cuesta|cobran)[^.!?,;]{0,40}\\bemergencias?\\b"),
    ] },
  ],

  // Default (unreviewed) approved procedures, one per category.
  // `translations` holds non-English text (also unreviewed, KI-12).
  procedures: {
    life_threat: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "If anyone is unconscious, struggling to breathe, or badly hurt, call 911 now and follow the operator's instructions.",
      translations: { es: "Si alguien está inconsciente, no puede respirar o está gravemente herido, llame al 911 ahora y siga las instrucciones del operador." },
    },
    gas_leak: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "This may be a gas emergency. Leave the building now and take everyone with you. Don't use light switches, appliances, or open flames, and don't use a phone inside. Once you are outside and away from the building, call 911 and your gas utility's emergency line.",
      translations: { es: "Posible emergencia por gas. Salga del edificio ahora y lleve a todos con usted. No use interruptores, aparatos ni llamas, y no use el teléfono dentro. Cuando esté afuera y lejos del edificio, llame al 911 y a la línea de emergencias de su compañía de gas." },
    },
    carbon_monoxide: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "Get everyone, including pets, outside to fresh air now. Call 911 from outside. Don't go back in until emergency responders say it is safe. If anyone feels dizzy, sick, confused, or has a headache, tell the 911 operator.",
      translations: { es: "Saque a todos, incluidas las mascotas, al aire libre ahora. Llame al 911 desde afuera. No vuelva a entrar hasta que los servicios de emergencia digan que es seguro. Si alguien se siente mareado, enfermo, confundido o con dolor de cabeza, dígaselo al operador del 911." },
    },
    fire_smoke: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "If there is fire or smoke, get everyone out and call 911 from outside. Do not try to put out a fire at an appliance yourself.",
      translations: { es: "Si hay fuego o humo, saque a todos y llame al 911 desde afuera. No intente apagar el fuego de un aparato usted mismo." },
    },
    electrical_hazard: {
      severity: "life_safety",
      callEmergencyServices: true,
      text: "Stay away from the electrical hazard and from any water near it. Don't touch the equipment, outlets, or standing water. If anyone has been shocked or there is fire, call 911.",
      translations: { es: "Manténgase alejado del peligro eléctrico y del agua cercana. No toque el equipo, los enchufes ni el agua estancada. Si alguien recibió una descarga o hay fuego, llame al 911." },
    },
    flooding: {
      severity: "urgent",
      callEmergencyServices: false,
      text: "Water can become dangerous quickly. If it is safe and you know where it is, shut off the main water valve. Stay out of standing water if outlets or electrical equipment could be affected, and keep children and pets away.",
      translations: { es: "El agua puede volverse peligrosa rápidamente. Si es seguro y sabe dónde está, cierre la llave principal de agua. Manténgase fuera del agua estancada si hay enchufes o equipo eléctrico cerca, y aleje a niños y mascotas." },
    },
    sewage: {
      severity: "urgent",
      callEmergencyServices: false,
      text: "Sewage can carry germs. Avoid contact with the water, keep children and pets away, and avoid using sinks, toilets, and drains until it has been looked at.",
      translations: { es: "Las aguas negras pueden contener gérmenes. Evite el contacto con el agua, mantenga alejados a niños y mascotas, y evite usar lavabos, inodoros y desagües hasta que se revise." },
    },
    water_heater_hazard: {
      severity: "urgent",
      callEmergencyServices: false,
      text: "Keep everyone away from the water heater. Don't touch it or the pipes connected to it. If you can't stay clear of steam or hot water, or anyone is hurt, call 911.",
      translations: { es: "Mantenga a todos alejados del calentador de agua. No lo toque ni toque las tuberías conectadas. Si no puede mantenerse alejado del vapor o del agua caliente, o si alguien está herido, llame al 911." },
    },
    unspecified_emergency: {
      severity: "urgent",
      callEmergencyServices: true,
      text: "If anyone is in immediate danger, call 911 now. Please tell me what is happening so I can understand how urgent it is.",
      translations: { es: "Si alguien está en peligro inmediato, llame al 911 ahora. Por favor, dígame qué está pasando para entender qué tan urgente es." },
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
