import {
  ASSISTANT_ANY_TURN,
  type AssistantAnswer,
  type AssistantAnswerFile,
  type AssistantRequest,
  assistantMessageKey,
} from "../format.ts";

// The assistant's fixtures (F8): the ten requests of the real-AI quality run with the change each
// should produce (assistant/requests.json), and the fake AI's assistant.v1 answers
// (ai/assistant.json) for those and for the messages the scenarios type (S8, S9). Changes are
// packages/schema Changes; rules use only RULE_FACTS and RULE_OPS, offsets like "UTC+05:00".

const hideRule = (description: string, when: unknown[]) => ({
  op: "add",
  target: "rule",
  rule: { description, when, then: "hide", enabled: true },
});

const ASIAN_TIME_ZONES = hideRule("Hide roles whose working hours are UTC+5 or later", [
  { fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } },
]);

/** The ten requests, in English, German and Portuguese. */
const REQUESTS: readonly (AssistantRequest & { reply: string; summary: string })[] = [
  {
    language: "en",
    text: "Lately I don't want jobs in Asian time zones anymore, ignore them",
    expected: [ASIAN_TIME_ZONES],
    summary: "Hide roles whose working hours are UTC+5 or later",
    reply: "I can hide roles on Asian time zones for you. Here is a proposal.",
  },
  {
    language: "en",
    text: "Ask me first before replying to anyone from hirewave.example",
    expected: [
      {
        op: "add",
        target: "rule",
        rule: {
          description: "Ask me before drafting a reply to mail from hirewave.example",
          when: [{ fact: "sender.domain", op: "in", value: ["hirewave.example"] }],
          then: "ask_first",
          enabled: true,
        },
      },
    ],
    summary: "Ask you before drafting a reply to mail from hirewave.example",
    reply: "Sure. From now on I'll ask you before drafting a reply to hirewave.example.",
  },
  {
    language: "en",
    text: "Stop showing me roles in the Netherlands",
    expected: [
      hideRule("Hide roles in the Netherlands", [
        { fact: "places.country", op: "in", value: ["NL"] },
      ]),
    ],
    summary: "Hide roles in the Netherlands",
    reply: "Here is a rule that hides roles in the Netherlands.",
  },
  {
    language: "en",
    text: "I'd now also take a hybrid job in Munich",
    expected: [
      {
        op: "add",
        target: "entry",
        key: "places",
        value: [{ country: "DE", city: "Munich", mode: "hybrid" }],
      },
    ],
    summary: "Add Munich, hybrid to the places you'd work",
    reply: "I'll add Munich, hybrid, to the places you'd work.",
  },
  {
    language: "en",
    text: "Raise my minimum salary to €75,000 a year",
    expected: [
      {
        op: "update",
        target: "entry",
        key: "min_pay",
        value: [
          { amount: 75000, currency: "EUR", period: "year", asWritten: "€75,000 a year" },
          { amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" },
        ],
      },
    ],
    summary: "Raise your minimum pay to €75,000 a year; your day rate stays €450",
    reply: "Here is the change: €75,000 a year, and your day rate stays as it is.",
  },
  {
    language: "de",
    text: "Zeig mir keine befristeten Stellen mehr",
    expected: [
      hideRule("Stellen mit befristetem Vertrag ausblenden", [
        // Not "befristet" alone: "unbefristet" (permanent) contains it.
        {
          fact: "contract",
          op: "contains",
          value: ["befristet auf", "fixed-term", "tijdelijk", "a termo"],
        },
      ]),
    ],
    summary: "Stellen mit befristetem Vertrag ausblenden",
    reply: "Gern. Mit dieser Regel blende ich befristete Stellen aus.",
  },
  {
    language: "de",
    text: "Ich spreche inzwischen auch Deutsch, nimm das bitte in mein Profil auf",
    expected: [{ op: "add", target: "entry", key: "languages", value: ["German"] }],
    summary: "Deutsch zu deinen Sprachen hinzufügen",
    reply: "Ich füge Deutsch zu deinen Sprachen hinzu.",
  },
  {
    language: "de",
    text: "Entwürfe bitte nur noch ab einem Fit-Score von 80",
    expected: [{ op: "update", target: "entry", key: "reply_threshold", value: [80] }],
    summary: "Automatische Entwürfe erst ab einem Fit-Score von 80",
    reply: "Verstanden: Automatische Entwürfe gibt es dann erst ab einem Fit-Score von 80.",
  },
  {
    language: "pt",
    text: "Só quero rascunhos para emails dos últimos 7 dias",
    expected: [{ op: "update", target: "entry", key: "reply_window_days", value: [7] }],
    summary: "Rascunhos automáticos só para emails dos últimos 7 dias",
    reply: "Combinado: só crio rascunhos automáticos para emails dos últimos 7 dias.",
  },
  {
    language: "pt",
    text: "Esconde as vagas presenciais, só quero híbrido ou remoto",
    expected: [
      hideRule("Esconder vagas presenciais", [{ fact: "workMode", op: "in", value: ["onsite"] }]),
    ],
    summary: "Esconder vagas presenciais",
    reply: "Aqui está uma regra que esconde as vagas presenciais.",
  },
];

const proposal = (reply: string, summary: string, changes: unknown[]): AssistantAnswer => ({
  reply,
  clarify: null,
  proposal: { summary, changes },
});

const say = (reply: string): AssistantAnswer => ({ reply, clarify: null, proposal: null });

/** The choices S9's clarifying question offers, each with the proposal it leads to. */
const BAD_JOB_CHOICES: readonly [string, AssistantAnswer][] = [
  [
    "Hide roles that pay below my minimum",
    proposal(
      "Here is a rule that hides roles paying less than €70,000 a year.",
      "Hide roles that pay below €70,000 a year",
      [
        hideRule("Hide roles that pay below €70,000 a year", [
          { fact: "pay", op: "below", value: { amount: 70000, currency: "EUR", period: "year" } },
        ]),
      ],
    ),
  ],
  [
    "Hide onsite roles",
    proposal("Here is a rule that hides onsite roles.", "Hide onsite roles", [
      hideRule("Hide onsite roles", [{ fact: "workMode", op: "in", value: ["onsite"] }]),
    ]),
  ],
  [
    "Hide job alerts",
    proposal("Here is a rule that hides job alerts.", "Hide job alerts", [
      hideRule("Hide job alerts", [{ fact: "category", op: "in", value: ["job_alert"] }]),
    ]),
  ],
];

/** The scenarios' other messages: a clarifying question, things it can't do, German. */
const SCENARIO_ANSWERS: readonly [string, AssistantAnswer][] = [
  [
    "stop showing me bad jobs",
    {
      reply: "I can do that, but what makes a job bad for you?",
      clarify: {
        question: "Which jobs should I stop showing you?",
        choices: BAD_JOB_CHOICES.map(([choice]) => choice),
      },
      proposal: null,
    },
  ],
  ...BAD_JOB_CHOICES,
  [
    "send my reply to the Berlin recruiter",
    say(
      "I can't send mail. Your reply to the Berlin recruiter is waiting on the Drafts page and in your mailbox's Drafts folder; review it there and send it from your mail app.",
    ),
  ],
  [
    "invite Tom as an editor",
    say("I can't invite people. An admin invites members under Settings › Members."),
  ],
  [
    "delete all my data",
    say("I can't delete data. Removing mail, CVs or your account is done in Settings."),
  ],
  [
    "switch my AI provider",
    say("I can't change the AI settings. An admin changes them under Settings › AI."),
  ],
  [
    "Welche Regeln habe ich gerade?",
    say(
      "Ich kann dein Profil und deine Regeln ändern, wenn du mir sagst, was du möchtest. Deine Regeln stehen auf der Profilseite unter „Regeln“.",
    ),
  ],
];

/** ai/assistant.json: every message above, at any turn. */
export function assistantAnswers(): AssistantAnswerFile {
  const file: AssistantAnswerFile = {};
  const add = (text: string, answer: AssistantAnswer) => {
    const key = assistantMessageKey(text);
    if (file[key]) throw new Error(`two assistant answers for "${text}"`);
    file[key] = { [ASSISTANT_ANY_TURN]: answer };
  };
  for (const r of REQUESTS) add(r.text, proposal(r.reply, r.summary, r.expected ?? []));
  for (const [text, answer] of SCENARIO_ANSWERS) add(text, answer);
  return file;
}

/** assistant/requests.json. */
export function assistantRequests(): AssistantRequest[] {
  return REQUESTS.map(({ language, text, expected }) => ({ language, text, expected }));
}
