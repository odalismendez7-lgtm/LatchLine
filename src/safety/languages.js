// Language support for the safety layer: negation handling and fixed messages.
//
// REVIEW STATUS: Spanish text was written for development and has NOT been
// reviewed by a native speaker or a licensed professional (docs/KNOWN_ISSUES.md,
// KI-12). Add a language only with its own tests.

export const LANGUAGES = {
  en: {
    negators: new Set([
      "no", "not", "never", "without", "nothing", "zero",
      "don't", "dont", "doesn't", "doesnt", "didn't", "didnt",
      "isn't", "isnt", "aren't", "arent", "wasn't", "wasnt",
      "haven't", "havent", "hasn't", "hasnt",
    ]),
    // A nearby negation is unreliable next to these ("not sure if I smell gas").
    uncertain: /\b(?:sure|certain|know|think|thought|if|whether|maybe|might|possibly|could|wonder|unsure|suspect|probably)\b/,
    // Phrases containing a negation word that do not negate the hazard.
    nonNegating: /\bnot (?:just|only|even)\b|\bwithout (?:any )?(?:warning|notice)\b/g,
    messages: {
      intro: "Your safety comes first.",
      followUpNoLead:
        "I can't send help, dispatch anyone, or confirm arrival times, and I haven't sent anything to the business. Your safety comes first.",
      followUpLead:
        "I can't dispatch anyone or confirm arrival times. Once you are safe, I can take your details for the business team to review.",
      appendEmergencyNumber: (n) => ` If anyone is in danger, call ${n} now.`,
    },
  },
  es: {
    negators: new Set(["no", "sin", "nunca", "ni", "tampoco", "nada", "jamas"]),
    uncertain: /\b(?:se|sabe|seguro|segura|si|creo|pienso|quiza|quizas|talvez|puede|podria|duda|parece)\b/,
    nonNegating: /\bno solo\b|\bsin aviso\b/g,
    messages: {
      intro: "Su seguridad es lo primero.",
      followUpNoLead:
        "No puedo enviar ayuda, despachar a nadie ni confirmar horas de llegada, y no he enviado nada al negocio. Su seguridad es lo primero.",
      followUpLead:
        "No puedo despachar a nadie ni confirmar horas de llegada. Cuando esté a salvo, puedo tomar sus datos para que los revise el equipo del negocio.",
      appendEmergencyNumber: (n) => ` Si alguien está en peligro, llame al ${n} ahora.`,
    },
  },
};

export const DEFAULT_LANGUAGE = "en";
