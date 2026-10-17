import { type Address, PERSONA_NAMES } from "../format.ts";
import { MARIA_HOME, MARIA_HOME_ADDRESS } from "../format-mvp3.ts";
import { alertMail, BOARDS } from "./alerts.ts";
import { days, pay, role } from "./facts.ts";
import { ATS_FOOTER, PERSONAL_FOOTER, RECRUITER_FOOTER_PT } from "./footers.ts";
import { createRandom } from "./random.ts";
import type { MessageSpec } from "./spec.ts";

// Maria's second mailbox (MVP-3 › Fixtures added): her personal address, which she connects in
// S4 and disconnects in S12. A few job emails and a friend's mail, all from sender domains the
// first mailbox already has (so the test stack's RDAP and DNS data cover them), named
// <maria-home-nnnn@sender-domain>. None gets a draft: an alert and an application confirmation
// get no reply, and the recruiter's role is onsite in Lisbon below her minimum pay, which both of
// her profiles cap. Hard conflicts are written against the profile MVP 2 starts with, as
// everywhere else.

const ME: Address = { address: MARIA_HOME_ADDRESS, name: PERSONA_NAMES.maria };

type HomeInput = Omit<
  MessageSpec,
  | "messageId"
  | "folder"
  | "to"
  | "cc"
  | "replyTo"
  | "inReplyTo"
  | "references"
  | "listId"
  | "precedence"
  | "preferences"
  | "invalid"
>;

/** The personal mailbox's messages, in this order (newest first is the files' order). */
export function mariaHome(): MessageSpec[] {
  const rnd = createRandom(20261101);
  const alert = alertMail(rnd, BOARDS[0] as (typeof BOARDS)[number], [
    {
      title: "Backend Developer",
      company: "Tejo Cloud",
      place: { city: "Lisbon", country: "PT", name: "Portugal" },
      mode: "onsite",
      pay: null,
    },
    {
      title: "Senior Backend Engineer",
      company: "Douro Fintech",
      place: { city: "Lisbon", country: "PT", name: "Portugal" },
      mode: "onsite",
      pay: null,
    },
  ]);
  const inputs: HomeInput[] = [
    {
      minutesAgo: days(1.5),
      from: alert.from,
      subject: alert.subject,
      body: alert.body,
      footer: alert.footer,
      listUnsubscribe: alert.listUnsubscribe,
      language: "en",
      stageOne: "job_alert",
      category: "job_alert",
      facts: alert.facts,
      // Onsite in Lisbon, both: she takes onsite work nowhere.
      hardConflicts: [["places"], ["places"]],
    },
    {
      minutesAgo: days(3.2),
      from: { address: "no-reply@teamtailor.com", name: "Alfama Labs" },
      subject: "Thank you for applying to Alfama Labs",
      body: "Hi Maria,\n\nThank you for applying for the Backend Developer position at Alfama Labs. We've received your application and our team is reviewing it now.\n\nWe aim to get back to everyone within two weeks.\n\nBest regards,\nAlfama Labs Recruiting Team",
      footer: ATS_FOOTER,
      listUnsubscribe: null,
      language: "en",
      stageOne: "likely_job",
      category: "application_update",
      facts: [role({ title: "Backend Developer", company: "Alfama Labs" })],
      // No place, work mode or pay stated.
      hardConflicts: [[]],
    },
    {
      minutesAgo: days(4.6),
      from: { address: "rui.almeida@ribeira-rh.example", name: "Rui Almeida" },
      subject: "Engenheira de Backend – presencial em Lisboa",
      body: "Olá Maria,\n\nSou consultor na Ribeira Recrutamento. O nosso cliente, a Mar Azul Logística, procura uma Engenheira de Backend para trabalhar presencialmente no escritório de Lisboa, cinco dias por semana. O salário é de 45.000–55.000 € por ano, com contrato sem termo. A equipa trabalha com Java e PostgreSQL.\n\nTens disponibilidade para falarmos esta semana?\n\nCumprimentos,\nRui Almeida\nConsultor de Recrutamento, Ribeira Recrutamento",
      footer: RECRUITER_FOOTER_PT,
      listUnsubscribe: null,
      language: "pt",
      stageOne: "likely_job",
      category: "recruiter_outreach",
      facts: [
        role({
          title: "Engenheira de Backend",
          company: "Mar Azul Logística",
          agency: { name: "Ribeira Recrutamento", client: "Mar Azul Logística" },
          places: [{ country: "PT", city: "Lisboa" }],
          workMode: "onsite",
          pay: pay(45000, 55000, "EUR", "year", "45.000–55.000 € por ano"),
          contract: "sem termo",
          skills: ["Java", "PostgreSQL"],
        }),
      ],
      // Onsite, and €55,000 at the top is below her €70,000 a year.
      hardConflicts: [["places", "min_pay"]],
    },
    {
      minutesAgo: days(6.1),
      from: { address: "rita.almeida@mail.example", name: "Rita Almeida" },
      subject: "Como está a correr a mudança?",
      body: "Olá Maria!\n\nEntão, já estás instalada na Alemanha? Conta-me tudo: a casa nova, o bairro, se já encontraste um café decente. Por aqui está tudo igual, o gato continua a dormir em cima do teu casaco velho.\n\nLiga-me quando tiveres um tempinho.\n\nBeijinhos,\nRita",
      footer: PERSONAL_FOOTER,
      listUnsubscribe: null,
      language: "pt",
      stageOne: "likely_job",
      category: "not_job",
      facts: null,
      hardConflicts: null,
    },
  ];
  return inputs.map((m, i): MessageSpec => {
    const domain = m.from.address.slice(m.from.address.indexOf("@") + 1);
    return {
      ...m,
      messageId: `<${MARIA_HOME}-${String(i + 1).padStart(4, "0")}@${domain}>`,
      folder: "inbox",
      to: [ME],
      cc: [],
      replyTo: [],
      inReplyTo: null,
      references: [],
      listId: null,
      precedence: null,
      preferences: null,
      invalid: false,
    };
  });
}
