import type { JobFacts } from "../format.ts";
import type { ApplicationStage } from "../format-mvp3.ts";
import type { DeliveryRole, DeliverySource } from "./deliveries.ts";
import { capped } from "./delivery-kit.ts";
import { days, pay, role } from "./facts.ts";
import { ATS_FOOTER, RECRUITER_FOOTER_DE, RECRUITER_FOOTER_EN } from "./footers.ts";

// MVP 3 S6, the threads for the pipeline (MVP-3 › Fixtures added), all delivered by
// `seed deliver S6` into Maria's Inbox, each reply threaded with In-Reply-To and References:
//   - offer:        Lindwurm Robotics' application confirmation → interview invite → offer
//   - rejection:    Mainwelle Energie's confirmation → rejection (in German)
//   - silent:       Brandung Health's confirmation, 25 days old and never answered (the 21-day
//                   flag, F5.2); S6 then moves it to Interview by hand
//   - two-agencies: one Möwe Mobility role sent by two agencies (F5.3: shown once)
// Only recruiter outreach gets replies, so the threads' mail gets no draft; the two agencies'
// role is onsite in Frankfurt, which neither of Maria's profiles takes, so it gets none either.
// Each message's roles name what that message states: the confirmation the title and company, the
// interview and the offer what they add.

const LINDWURM = { title: "Senior Backend Engineer", company: "Lindwurm Robotics" } as const;
const MAINWELLE = { title: "Backend-Entwicklerin (m/w/d)", company: "Mainwelle Energie GmbH" };
const BRANDUNG = { title: "Backend Engineer", company: "Brandung Health" } as const;
const MOEWE = { title: "Senior Backend Engineer", company: "Möwe Mobility GmbH" } as const;

/**
 * A role of mail that gets no reply (F6.1: only recruiter outreach does): no hard conflict, and
 * nothing it states conflicts with the profile MVP 2 starts with, so it scores as a good match.
 */
const noReply = (facts: JobFacts): DeliveryRole => ({
  facts,
  hardConflicts: [],
  fit: "good",
  needs: [],
  draft: false,
  answers: {},
});

const THERESA = { address: "theresa.lang@lindwurm-robotics.example", name: "Theresa Lang" };

export const PIPELINE_DELIVERIES: readonly DeliverySource[] = [
  {
    id: "lindwurm-applied",
    step: "S6",
    minutesAgo: days(20),
    from: { address: "no-reply@greenhouse-mail.io", name: "Lindwurm Robotics Recruiting" },
    subject: "We received your application for Senior Backend Engineer",
    body: "Hi Maria,\n\nThank you for applying for the Senior Backend Engineer position at Lindwurm Robotics. We've received your application and our team is reviewing it now.\n\nWe aim to get back to everyone within two weeks.\n\nBest regards,\nLindwurm Robotics Recruiting Team",
    footer: ATS_FOOTER,
    language: "en",
    sender: "looks_fine",
    category: "application_update",
    roles: [noReply(role({ ...LINDWURM, seniority: "Senior" }))],
  },
  {
    id: "lindwurm-interview",
    step: "S6",
    minutesAgo: days(12),
    from: THERESA,
    subject: "Interview invitation: Senior Backend Engineer at Lindwurm Robotics",
    body: "Hi Maria,\n\nThanks again for your application for the Senior Backend Engineer role. We'd like to invite you to a technical interview with two engineers from our motion-planning team.\n\nThe interview is a 60-minute video call. Would Monday at 10:00 CET or Wednesday at 15:00 CET work for you?\n\nThe role is remote within the EU on a permanent contract.\n\nBest regards,\nTheresa Lang\nTalent Acquisition, Lindwurm Robotics",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    category: "interview",
    thread: ["lindwurm-applied"],
    roles: [
      noReply(
        role({
          ...LINDWURM,
          workMode: "remote",
          remoteScope: "within the EU",
          contract: "permanent",
          seniority: "Senior",
        }),
      ),
    ],
  },
  {
    id: "lindwurm-offer",
    step: "S6",
    minutesAgo: days(3),
    from: THERESA,
    subject: "Your offer from Lindwurm Robotics",
    body: "Hi Maria,\n\nThank you for your time in the interviews. We're delighted to offer you the position of Senior Backend Engineer at Lindwurm Robotics.\n\nThe main terms:\n- Salary: €92,000 a year\n- Contract: permanent\n- Work mode: remote within the EU\n- Start date: 1 February\n\nI'll send the formal contract as soon as you confirm. Please let us know by the end of next week whether you accept, and call me with any questions.\n\nWarm regards,\nTheresa Lang\nTalent Acquisition, Lindwurm Robotics",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    category: "offer",
    thread: ["lindwurm-applied", "lindwurm-interview"],
    roles: [
      noReply(
        role({
          ...LINDWURM,
          workMode: "remote",
          remoteScope: "within the EU",
          pay: pay(92000, 92000, "EUR", "year", "€92,000 a year"),
          contract: "permanent",
          seniority: "Senior",
        }),
      ),
    ],
  },
  {
    id: "mainwelle-applied",
    step: "S6",
    minutesAgo: days(18),
    from: { address: "noreply@personio.de", name: "Mainwelle Energie GmbH" },
    subject: "Ihre Bewerbung als Backend-Entwicklerin (m/w/d)",
    body: "Hallo Frau Santos,\n\nvielen Dank für Ihre Bewerbung als Backend-Entwicklerin (m/w/d) bei der Mainwelle Energie GmbH. Wir haben Ihre Unterlagen erhalten und melden uns innerhalb von zwei Wochen bei Ihnen.\n\nMit freundlichen Grüßen\nIhr Recruiting-Team der Mainwelle Energie GmbH",
    footer: ATS_FOOTER,
    language: "de",
    sender: "looks_fine",
    category: "application_update",
    roles: [noReply(role(MAINWELLE))],
  },
  {
    id: "mainwelle-rejected",
    step: "S6",
    minutesAgo: days(6),
    from: { address: "noreply@personio.de", name: "Mainwelle Energie GmbH" },
    subject: "Ihre Bewerbung bei der Mainwelle Energie GmbH",
    body: "Hallo Frau Santos,\n\nvielen Dank für Ihr Interesse an der Stelle als Backend-Entwicklerin (m/w/d) und die Zeit, die Sie in Ihre Bewerbung gesteckt haben. Nach sorgfältiger Prüfung haben wir uns entschieden, die Stelle intern zu besetzen. Wir können Ihnen daher leider keine Zusage geben.\n\nWir wünschen Ihnen für Ihre weitere Suche alles Gute.\n\nMit freundlichen Grüßen\nIhr Recruiting-Team der Mainwelle Energie GmbH",
    footer: ATS_FOOTER,
    language: "de",
    sender: "looks_fine",
    category: "rejection",
    thread: ["mainwelle-applied"],
    roles: [noReply(role(MAINWELLE))],
  },
  {
    id: "brandung-applied",
    step: "S6",
    minutesAgo: days(25),
    from: { address: "no-reply@hire.lever.co", name: "Brandung Health" },
    subject: "Thank you for applying to Brandung Health",
    body: "Hi Maria,\n\nThank you for applying for the Backend Engineer position at Brandung Health. We've received your application and our team is reviewing it now.\n\nWe aim to get back to everyone within two weeks.\n\nBest regards,\nBrandung Health Recruiting Team",
    footer: ATS_FOOTER,
    language: "en",
    sender: "looks_fine",
    category: "application_update",
    roles: [noReply(role(BRANDUNG))],
  },
  {
    id: "moewe-elbe",
    step: "S6",
    minutesAgo: days(6),
    from: { address: "sven.brandt@elbe-talent.example", name: "Sven Brandt" },
    subject: "Senior Backend Engineer – onsite in Frankfurt",
    body: "Hi Maria,\n\nI'm a consultant at Elbe Talent Partners. My client, Möwe Mobility GmbH, is hiring a Senior Backend Engineer for its booking platform. The role is onsite in Frankfurt, five days a week, at €85,000–95,000 a year on a permanent contract. The stack is Go and PostgreSQL.\n\nWould you like to hear more?\n\nBest regards,\nSven Brandt\nSenior Consultant, Elbe Talent Partners",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      capped(
        // Onsite in Frankfurt: she takes onsite work nowhere.
        ["places"],
        role({
          ...MOEWE,
          agency: { name: "Elbe Talent Partners", client: MOEWE.company },
          places: [{ country: "DE", city: "Frankfurt" }],
          workMode: "onsite",
          pay: pay(85000, 95000, "EUR", "year", "€85,000–95,000 a year"),
          contract: "permanent",
          seniority: "Senior",
          skills: ["Go", "PostgreSQL"],
        }),
      ),
    ],
  },
  {
    id: "moewe-nordstern",
    step: "S6",
    minutesAgo: days(4),
    from: { address: "lea.schubert@nordstern-personal.example", name: "Lea Schubert" },
    subject: "Senior Backend Engineer bei Möwe Mobility – Frankfurt",
    body: "Hallo Frau Santos,\n\nich bin Beraterin bei Nordstern Personalberatung. Für die Möwe Mobility GmbH suche ich eine:n Senior Backend Engineer. Die Stelle ist vor Ort in Frankfurt, fünf Tage pro Woche, unbefristet, mit 85.000–95.000 € brutto pro Jahr. Gearbeitet wird mit Go und PostgreSQL.\n\nDarf ich Ihnen mehr erzählen?\n\nViele Grüße\nLea Schubert\nNordstern Personalberatung",
    footer: RECRUITER_FOOTER_DE,
    language: "de",
    sender: "looks_fine",
    roles: [
      capped(
        // Onsite in Frankfurt: she takes onsite work nowhere.
        ["places"],
        role({
          ...MOEWE,
          agency: { name: "Nordstern Personalberatung", client: MOEWE.company },
          places: [{ country: "DE", city: "Frankfurt" }],
          workMode: "onsite",
          pay: pay(85000, 95000, "EUR", "year", "85.000–95.000 € brutto pro Jahr"),
          contract: "unbefristet",
          seniority: "Senior",
          skills: ["Go", "PostgreSQL"],
        }),
      ),
    ],
  },
];

/** One pipeline item S6 checks, by its deliveries (the Message-IDs come from deliveries.json). */
export interface PipelineItemSource {
  id: string;
  deliveries: string[];
  title: string;
  company: string;
  stage: ApplicationStage;
  flagged: boolean;
}

export const PIPELINE_ITEMS: readonly PipelineItemSource[] = [
  {
    id: "offer",
    deliveries: ["lindwurm-applied", "lindwurm-interview", "lindwurm-offer"],
    ...LINDWURM,
    stage: "offer",
    flagged: false,
  },
  {
    id: "rejection",
    deliveries: ["mainwelle-applied", "mainwelle-rejected"],
    ...MAINWELLE,
    stage: "rejected",
    flagged: false,
  },
  {
    id: "silent",
    deliveries: ["brandung-applied"],
    ...BRANDUNG,
    stage: "applied",
    flagged: true,
  },
  {
    id: "two-agencies",
    deliveries: ["moewe-elbe", "moewe-nordstern"],
    ...MOEWE,
    stage: "new",
    flagged: false,
  },
];

/** The item S6 moves by hand, and where to: Brandung Health called her for an interview. */
export const MANUAL_STAGE = { item: "silent", stage: "interview" } as const;
