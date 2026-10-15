import { type Address, PERSONA_ADDRESSES, PERSONA_NAMES } from "../format.ts";
import { newsletters, personal as personalMail, receipts } from "./everyday.ts";
import { days, pay, role } from "./facts.ts";
import { ALERT_FOOTER, ATS_FOOTER, RECRUITER_FOOTER_EN } from "./footers.ts";
import { createRandom } from "./random.ts";
import { MessageBook, type MessageSpec, type PersonaSource } from "./spec.ts";

// Tom Okafor, nurse in Manchester: about 150 messages and only four job emails, the thin-inbox
// case. No job fact value appears in more than two of his messages and none of his replies states
// a preference, so every intake answer is empty ("Not enough evidence").

const ME: Address = { address: PERSONA_ADDRESSES.tom, name: PERSONA_NAMES.tom };

const quote = (text: string) =>
  text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

export function tom(): PersonaSource {
  const rnd = createRandom(20261002);
  const book = new MessageBook("tom");
  const anyTime = () => rnd.int(days(0.1), days(88));
  const inbox = (
    m: { from: Address; subject: string; body: string; footer: readonly string[] },
    extra: Partial<MessageSpec> & Pick<MessageSpec, "category" | "facts">,
  ) =>
    book.add({
      folder: "inbox",
      minutesAgo: anyTime(),
      to: [ME],
      stageOne: "likely_job",
      preferences: null,
      invalid: false,
      ...m,
      ...extra,
    });

  const nhsRoles = [
    role({
      title: "Staff Nurse – Acute Medical Unit",
      company: "Northfield NHS Foundation Trust",
      places: [{ country: "GB", city: "Manchester" }],
      pay: pay(35392, 42618, "GBP", "year", "£35,392 to £42,618 a year"),
      contract: "Permanent",
      seniority: "Band 6",
      applyUrl: "https://www.jobs.nhs.uk/candidate/jobadvert/C9301-26-0412",
    }),
    role({
      title: "Clinical Nurse Specialist – Respiratory",
      company: "Irwell Valley NHS Trust",
      places: [{ country: "GB", city: "Salford" }],
      contract: "Fixed term: 12 months",
      seniority: "Band 7",
      applyUrl: "https://www.jobs.nhs.uk/candidate/jobadvert/C9302-26-0877",
    }),
  ];
  inbox(
    {
      from: { address: "alerts@jobs.nhs.uk", name: "NHS Jobs" },
      subject: "NHS Jobs: 2 new jobs match your saved search",
      body: 'Hello Tom,\n\n2 new jobs match your saved search "nurse" near Manchester.\n\nStaff Nurse – Acute Medical Unit\nNorthfield NHS Foundation Trust · Manchester, United Kingdom\nBand 6 · £35,392 to £42,618 a year · Permanent\nhttps://www.jobs.nhs.uk/candidate/jobadvert/C9301-26-0412\n\nClinical Nurse Specialist – Respiratory\nIrwell Valley NHS Trust · Salford, United Kingdom\nBand 7 · Fixed term: 12 months\nhttps://www.jobs.nhs.uk/candidate/jobadvert/C9302-26-0877',
      footer: ALERT_FOOTER,
    },
    {
      stageOne: "job_alert",
      category: "job_alert",
      facts: nhsRoles,
      listUnsubscribe: "<https://www.jobs.nhs.uk/candidate/alerts/unsubscribe?id=55120>",
    },
  );

  const totaljobsRoles = [
    role({
      title: "Theatre Practitioner",
      company: "Pennine Day Surgery",
      places: [{ country: "GB", city: "Stockport" }],
      workMode: "onsite",
      contract: "Full-time, permanent",
      applyUrl:
        "https://www.totaljobs.com/job/theatre-practitioner/pennine-day-surgery-job104882113",
    }),
    role({
      title: "Community Staff Nurse",
      company: "Medlock Community Care",
      places: [{ country: "GB", city: "Oldham" }],
      seniority: "Band 5",
      applyUrl:
        "https://www.totaljobs.com/job/community-staff-nurse/medlock-community-care-job104890077",
    }),
  ];
  inbox(
    {
      from: { address: "jobalerts@totaljobs.com", name: "Totaljobs" },
      subject: "2 new Nurse jobs near Manchester",
      body: 'Hi Tom,\n\nHere are the latest jobs for your alert "Nurse" within 15 miles of Manchester.\n\nTheatre Practitioner – Pennine Day Surgery\nStockport, United Kingdom · On-site · Full-time, permanent\nhttps://www.totaljobs.com/job/theatre-practitioner/pennine-day-surgery-job104882113\n\nCommunity Staff Nurse – Medlock Community Care\nOldham, United Kingdom · Band 5\nhttps://www.totaljobs.com/job/community-staff-nurse/medlock-community-care-job104890077',
      footer: ALERT_FOOTER,
    },
    {
      stageOne: "job_alert",
      category: "job_alert",
      facts: totaljobsRoles,
      listUnsubscribe: "<https://www.totaljobs.com/alerts/unsubscribe?id=88231>",
    },
  );

  inbox(
    {
      from: { address: "nadia.ellis@carelinknursing.example", name: "Nadia Ellis" },
      subject: "Agency shifts this week",
      body: "Hi Tom,\n\nWe have agency shifts for registered general nurses this week at three hospitals within 10 miles of you. Day and night shifts are available, paid at £32–£38 an hour depending on the shift.\n\nReply with your availability and I'll book you in.\n\nThanks,\nNadia Ellis\nCareLink Nursing",
      footer: RECRUITER_FOOTER_EN,
    },
    {
      category: "recruiter_outreach",
      facts: [
        role({
          title: "Registered General Nurse (agency shifts)",
          agency: { name: "CareLink Nursing", client: null },
          workMode: "onsite",
          pay: pay(32, 38, "GBP", "hour", "£32–£38 an hour"),
          contract: "Agency",
        }),
      ],
    },
  );

  inbox(
    {
      from: { address: "no-reply@smartrecruiters.com", name: "Kersal Private Hospital Careers" },
      subject: "Your application: Staff Nurse, Ward 4",
      body: "Dear Tom,\n\nThank you for applying for the Staff Nurse, Ward 4 position at Kersal Private Hospital. We have received your application and will review it shortly.\n\nKind regards,\nKersal Private Hospital Recruitment",
      footer: ATS_FOOTER,
    },
    {
      category: "application_update",
      facts: [role({ title: "Staff Nurse, Ward 4", company: "Kersal Private Hospital" })],
    },
  );

  for (const m of newsletters(rnd, "tom", 125)) {
    inbox(m, {
      stageOne: "not_job",
      category: "not_job",
      facts: null,
      listId: m.listId ?? null,
      listUnsubscribe: m.listUnsubscribe ?? null,
      precedence: m.precedence ?? null,
    });
  }
  for (const m of receipts(rnd, "tom", 8)) inbox(m, { category: "not_job", facts: null });
  personalMail(rnd, "tom", 7).forEach((m, i) => {
    const original = inbox(m, { category: "not_job", facts: null });
    if (i >= 6) return;
    book.add({
      folder: "sent",
      minutesAgo: original.minutesAgo - rnd.int(20, 600),
      from: ME,
      to: [original.from],
      subject: `Re: ${original.subject}`,
      body: `${m.reply}\n\nTom\n\n${original.from.name} wrote:\n${quote(original.body)}`,
      footer: original.footer.map(quote),
      inReplyTo: original.messageId,
      references: [original.messageId],
      stageOne: "own_reply",
      category: "not_job",
      facts: null,
      preferences: {},
      invalid: false,
    });
  });

  return {
    persona: "tom",
    address: ME.address,
    messages: book.messages,
    profile: {
      target_roles: [],
      seniority: [],
      places: [],
      remote: [],
      contracts: [],
      min_pay: [],
      languages: [],
      work_permits: [],
      reply_to: [],
      deal_breakers: [],
    },
    intake: { questions: [] },
  };
}
