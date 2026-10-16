import { type AppliedMark, MESSAGE_GONE_SIGNAL, type SenderCheck } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import {
  checkSender,
  type DomainFacts,
  isFreeMailDomain,
  nameMatchesDomain,
  type SenderCheckInput,
  senderDomain,
} from "./check";
import { detectLanguage } from "./language";

// The sender check's signals, one at a time, their aggregation into a verdict, the incomplete
// cases (F5.3), marks (F5.4) and the two F5.5 cases built like the fixtures.

const NOW = new Date("2026-10-15T12:00:00Z");
const OLD_DOMAIN: DomainFacts = {
  rdap: { registeredAt: "2012-03-01T00:00:00Z" },
  mx: ["mx.example"],
};

const PLAIN_EN =
  "Hello Maria,\n\nI am a recruiter at Tidewater Systems and we are looking for a backend engineer to join our team. Would you be open to a call this week? The role is remote within the EU.\n\nKind regards,\nGrace";

function input(overrides: Partial<SenderCheckInput> = {}): SenderCheckInput {
  return {
    from: { address: "grace.lin@tidewater.example", name: "Grace Lin" },
    category: "recruiter_outreach",
    companies: ["Tidewater Systems"],
    text: PLAIN_EN,
    language: "en",
    domain: OLD_DOMAIN,
    mark: null,
    now: NOW,
    ...overrides,
  };
}

const signals = (check: SenderCheck) => check.reasons.map((r) => r.signal);

describe("a sender with nothing to worry about", () => {
  it("looks fine, complete, with a reason worded as an estimate", () => {
    const check = checkSender(input());
    expect(check).toEqual({
      verdict: "looks_fine",
      complete: true,
      reasons: [
        {
          signal: "no_warning_signs",
          reason: "Looks fine as far as we can tell: no warning signs in the text or the domain",
        },
      ],
      mark: null,
    });
  });
});

describe("message signals (phrase lists in sender/data)", () => {
  it("finds a request for a fee", () => {
    const check = checkSender(
      input({ text: `${PLAIN_EN}\nPlease pay the registration fee of 90 EUR first.` }),
    );
    expect(check.verdict).toBe("high_risk");
    expect(check.reasons[0]).toEqual({
      signal: "asks_for_fee",
      reason:
        'Probably a scam sign: asks for a fee ("registration fee"); real employers rarely charge candidates',
    });
  });

  it("finds a request for a passport scan or ID before an offer", () => {
    const check = checkSender(input({ text: `${PLAIN_EN}\nSend a scan of your passport today.` }));
    expect(check.verdict).toBe("high_risk");
    expect(check.reasons[0]?.signal).toBe("asks_for_id");
    expect(check.reasons[0]?.reason).toContain("asks for a passport scan");
  });

  it("doesn't count ID documents asked for in an offer", () => {
    const check = checkSender(
      input({ category: "offer", text: `${PLAIN_EN}\nPlease bring a copy of your passport.` }),
    );
    expect(signals(check)).not.toContain("asks_for_id");
  });

  it("still counts ID documents asked for in an 'offer' that shows another sign", () => {
    const check = checkSender(
      input({
        category: "offer",
        text: `${PLAIN_EN}\nPlease bring a copy of your passport.`,
        domain: { rdap: { registeredAt: "2026-09-01T00:00:00Z" }, mx: ["mx.example"] },
      }),
    );
    expect(check.verdict).toBe("high_risk");
    expect(signals(check)).toEqual(["asks_for_id", "young_domain"]);
  });

  it("finds chat-only hiring, which alone is caution", () => {
    const check = checkSender(input({ text: `${PLAIN_EN}\nThe interview is on Telegram only.` }));
    expect(check.verdict).toBe("caution");
    expect(signals(check)).toEqual(["chat_only"]);
    expect(check.reasons[0]?.reason).toBe(
      'Possibly risky: wants to hire over chat only ("on telegram")',
    );
  });

  it("reads German and Portuguese phrases too, and a phrase across a line break", () => {
    const de = checkSender(
      input({
        language: "de",
        text: "Hallo Maria, wir suchen Sie. Bitte senden Sie uns eine Kopie Ihres\nReisepasses und die Anmeldegebühr.",
      }),
    );
    expect(signals(de).sort()).toEqual(["asks_for_fee", "asks_for_id"]);
    const pt = checkSender(
      input({ language: "pt", text: "Olá Maria, a entrevista é apenas por WhatsApp." }),
    );
    expect(signals(pt)).toEqual(["chat_only"]);
  });

  it("ignores a phrase said with a negation, as job boards' footers do", () => {
    const check = checkSender(
      input({
        category: "job_alert",
        text: `${PLAIN_EN}\nCheck every listing carefully and never pay a fee or share identity documents to apply.`,
      }),
    );
    expect(check.verdict).toBe("looks_fine");
  });

  it("finds a phrase only as words of their own", () => {
    const check = checkSender(input({ text: `${PLAIN_EN}\nOur upfront feedback loop is fast.` }));
    expect(signals(check)).not.toContain("asks_for_fee");
  });
});

describe("company signals", () => {
  it("notices a free-mail address writing for a company", () => {
    const check = checkSender(
      input({ from: { address: "globex.careers@gmail.com", name: "Globex Talent" } }),
    );
    expect(check.verdict).toBe("caution");
    expect(check.reasons).toEqual([
      {
        signal: "free_mail_company",
        reason:
          "Possibly not from Tidewater Systems: writes as a company recruiter from a free-mail address (gmail.com)",
      },
    ]);
  });

  it("notices a sender whose domain doesn't match the company", () => {
    const check = checkSender(
      input({ from: { address: "hr@quickhire-jobs.example", name: null } }),
    );
    expect(check.verdict).toBe("caution");
    expect(check.reasons[0]?.reason).toBe(
      "Possibly not from Tidewater Systems: the sender's domain quickhire-jobs.example doesn't seem to belong to it",
    );
  });

  it("accepts an agency's own domain and lenient spellings of the name", () => {
    expect(nameMatchesDomain("Talentbrücke Recruiting", "talentbruecke.example")).toBe(true);
    expect(nameMatchesDomain("Harbour Recruitment", "harbour-rec.example")).toBe(true);
    expect(nameMatchesDomain("Atlântico Talent", "atlantico-talent.example")).toBe(true);
    expect(nameMatchesDomain("Quayside Bank", "quaysidebank.example")).toBe(true);
    expect(nameMatchesDomain("Tidewater Systems", "quickhire.example")).toBe(false);
    const agency = checkSender(
      input({
        from: { address: "lea.hoffmann@talentbruecke.example", name: "Lea" },
        companies: ["Spreeblick Mobility GmbH", "Talentbrücke Recruiting"],
      }),
    );
    expect(agency.verdict).toBe("looks_fine");
  });

  it("only applies to recruiters writing for a company", () => {
    const alert = checkSender(
      input({ category: "job_alert", from: { address: "alerts@jobs.example", name: null } }),
    );
    expect(alert.verdict).toBe("looks_fine");
    const noCompany = checkSender(
      input({ companies: [], from: { address: "x@gmail.com", name: null } }),
    );
    expect(noCompany.verdict).toBe("looks_fine");
  });

  it("reads the free-mail list from data", () => {
    expect(isFreeMailDomain("GMAIL.com")).toBe(true);
    expect(isFreeMailDomain("tidewater.example")).toBe(false);
    expect(senderDomain("Grace@Tidewater.Example")).toBe("tidewater.example");
    expect(senderDomain("no-domain")).toBeNull();
  });
});

describe("domain signals (RDAP and MX)", () => {
  it("notices a young domain", () => {
    const check = checkSender(
      input({ domain: { rdap: { registeredAt: "2026-09-25T00:00:00Z" }, mx: ["mx.example"] } }),
    );
    expect(check.verdict).toBe("caution");
    expect(check.reasons).toEqual([
      {
        signal: "young_domain",
        reason: "Possibly risky: the domain tidewater.example seems to be only 20 days old",
      },
    ]);
  });

  it("notices a domain without MX records", () => {
    const check = checkSender(input({ domain: { rdap: OLD_DOMAIN.rdap, mx: [] } }));
    expect(check.verdict).toBe("caution");
    expect(signals(check)).toEqual(["no_mx"]);
    expect(check.reasons[0]?.reason).toBe(
      "Possibly risky: the domain tidewater.example seems to have no mail servers",
    );
  });

  it("makes three medium signs high risk", () => {
    const check = checkSender(
      input({
        from: { address: "hr@quickhire-jobs.example", name: null },
        domain: { rdap: { registeredAt: "2026-10-01T00:00:00Z" }, mx: [] },
      }),
    );
    expect(check.verdict).toBe("high_risk");
    expect(signals(check).sort()).toEqual(["no_mx", "sender_mismatch", "young_domain"]);
  });
});

describe("incomplete checks (F5.3)", () => {
  it("a failed RDAP lookup is incomplete and never looks fine", () => {
    const check = checkSender(input({ domain: { rdap: "failed", mx: ["mx.example"] } }));
    expect(check).toMatchObject({ verdict: "caution", complete: false });
    expect(check.reasons).toEqual([
      {
        signal: "lookup_failed",
        reason:
          "Couldn't look up when tidewater.example was registered, so this check is incomplete",
      },
    ]);
  });

  it("a failed MX lookup is incomplete and never looks fine", () => {
    const check = checkSender(input({ domain: { rdap: OLD_DOMAIN.rdap, mx: "failed" } }));
    expect(check).toMatchObject({ verdict: "caution", complete: false });
    expect(signals(check)).toEqual(["lookup_failed"]);
  });

  it("a message in a language without phrase lists is incomplete", () => {
    const fr = checkSender(
      input({
        language: "fr",
        text: "Bonjour Maria, nous cherchons une collègue pour notre équipe.",
      }),
    );
    expect(fr).toMatchObject({ verdict: "caution", complete: false });
    expect(fr.reasons[0]?.reason).toBe(
      "Can't read French text for warning signs yet, so this check is incomplete",
    );
    const unknown = checkSender(input({ language: null }));
    expect(unknown).toMatchObject({ verdict: "caution", complete: false });
    expect(signals(unknown)).toEqual(["language_not_checked"]);
  });

  it("a message gone from the mailbox is incomplete, with the message_gone reason", () => {
    const check = checkSender(input({ text: null }));
    expect(check).toMatchObject({ verdict: "caution", complete: false });
    expect(signals(check)).toEqual([MESSAGE_GONE_SIGNAL]);
  });

  it("a strong sign is still high risk when something else couldn't be checked", () => {
    const check = checkSender(
      input({
        text: `${PLAIN_EN} Pay the processing fee.`,
        domain: { rdap: "failed", mx: "failed" },
      }),
    );
    expect(check).toMatchObject({ verdict: "high_risk", complete: false });
    expect(signals(check)).toEqual(["asks_for_fee", "lookup_failed", "lookup_failed"]);
  });
});

describe("marks (F5.4)", () => {
  const trusted: AppliedMark = {
    mark: "trusted",
    scope: "address",
    value: "globex.careers@gmail.com",
  };
  const blocked: AppliedMark = { mark: "blocked", scope: "domain", value: "tidewater.example" };

  it("a trusted mark makes the sender look fine and is named first", () => {
    const check = checkSender(
      input({
        from: { address: "globex.careers@gmail.com", name: null },
        mark: trusted,
        domain: { rdap: null, mx: null },
      }),
    );
    expect(check.verdict).toBe("looks_fine");
    expect(check.mark).toBe("trusted");
    expect(check.complete).toBe(true);
    expect(check.reasons[0]).toEqual({
      signal: "marked_trusted",
      reason:
        "Trusted: the address globex.careers@gmail.com is marked trusted in this workspace, so the signs below are set aside",
    });
    expect(signals(check)).toEqual(["marked_trusted", "free_mail_company"]);
  });

  it("a blocked mark makes the sender high risk and is named first", () => {
    const check = checkSender(input({ mark: blocked, domain: { rdap: null, mx: null } }));
    expect(check).toMatchObject({ verdict: "high_risk", mark: "blocked", complete: true });
    expect(check.reasons).toEqual([
      {
        signal: "marked_blocked",
        reason: "Blocked: the domain tidewater.example is marked blocked in this workspace",
      },
    ]);
  });
});

describe("the F5.5 cases, built like the fixtures", () => {
  const SCAM =
    "Dear Candidate,\n\nCongratulations! After reviewing your profile we are pleased to offer you the position of Remote Software Engineer with a salary of USD 6,500 per month. No interview is needed.\n\nTo complete your hiring, please pay a one-time processing fee of €150 for your work visa and equipment, and send a clear scan of your passport (both sides) to this email address within 24 hours.\n\nAfter payment we will send your contract and start date.\n\nRegards,\nHR Department\nGlobal Careers International";

  it("the fee-and-passport scam is high risk with both reasons", () => {
    const check = checkSender(
      input({
        from: { address: "hr.department@globalcareers-mail.example", name: "Global Careers HR" },
        companies: ["Global Careers International"],
        text: SCAM,
        language: detectLanguage(SCAM),
      }),
    );
    expect(check.verdict).toBe("high_risk");
    const reasons = check.reasons.map((r) => r.reason).join("\n");
    expect(reasons).toContain("asks for a fee");
    expect(reasons).toContain("asks for a passport scan");
    expect(signals(check).slice(0, 2)).toEqual(["asks_for_fee", "asks_for_id"]);
  });

  it("the scam stays high risk with both reasons when the model calls it an offer", () => {
    const check = checkSender(
      input({
        from: { address: "hr.department@globalcareers-mail.example", name: "Global Careers HR" },
        category: "offer",
        companies: ["Global Careers International"],
        text: SCAM,
        language: detectLanguage(SCAM),
      }),
    );
    expect(check.verdict).toBe("high_risk");
    const reasons = check.reasons.map((r) => r.reason).join("\n");
    expect(reasons).toContain("asks for a fee");
    expect(reasons).toContain("asks for a passport scan");
    expect(signals(check).slice(0, 2)).toEqual(["asks_for_fee", "asks_for_id"]);
  });

  it("the free-mail 'recruiter' for a large company is caution", () => {
    const text =
      "Hi Maria,\n\nI am a talent partner for Globex Corporation, one of the largest companies in the world. We would love to talk to you about a senior backend role. Are you available for a quick call?\n\nBest regards,\nJordan";
    const check = checkSender(
      input({
        from: { address: "globex.talent.partner@gmail.com", name: "Globex Talent" },
        companies: ["Globex Corporation"],
        text,
        language: detectLanguage(text),
        domain: { rdap: null, mx: null },
      }),
    );
    expect(check.verdict).toBe("caution");
    expect(signals(check)).toEqual(["free_mail_company"]);
  });
});
