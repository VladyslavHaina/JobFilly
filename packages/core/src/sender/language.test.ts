import { describe, expect, it } from "vitest";
import { loadLanguageWords } from "./data";
import { detectLanguage, tokens } from "./language";

// The body's language from data/language-words.json (F2.3, F5.3).

describe("detectLanguage", () => {
  it("tells English, German and Portuguese job mail apart", () => {
    expect(
      detectLanguage(
        "Hello Maria, we are looking for a backend engineer to join our team. Would you be open to a call? Kind regards",
      ),
    ).toBe("en");
    expect(
      detectLanguage(
        "Hallo Maria, wir suchen für unser Team in Berlin eine Backend-Entwicklerin. Hätten Sie Zeit für ein Gespräch? Mit freundlichen Grüßen",
      ),
    ).toBe("de");
    expect(
      detectLanguage(
        "Olá Maria, estamos à procura de uma engenheira backend para a nossa equipa em Lisboa. Tem disponibilidade para uma conversa? Muito obrigado e cumprimentos",
      ),
    ).toBe("pt");
  });

  it("reads the message's own text first, not the job board's English footer", () => {
    const footer = [
      "You are receiving job alert emails because you created a job alert. You can change how often you receive these alerts, edit your search or stop the alert at any time from your alert settings.",
      "Jobs are listed by the employers and recruiters who post them; check every listing carefully: a genuine employer never asks for money or identity documents before an offer.",
      "This email was sent to you by the job platform. Our privacy policy explains how we use your search activity to recommend jobs. To stop receiving all marketing and alert emails, use the unsubscribe link in your settings.",
    ].join("\n\n");
    const xing = [
      "Wir haben 3 neue Jobs im Bereich Softwareentwicklung für Sie gefunden.",
      "Softwareentwickler Backend (m/w/d)\nCopperleaf Analytics · Berlin, Deutschland · Hybrid\nZur Stelle: https://jobs.example/1",
      footer,
    ].join("\n\n");
    const stepstone = [
      'Ihr Jobagent "Backend" hat 3 neue passende Stellenangebote gefunden.',
      "Backend-Entwickler (m/w/d)\nSpreeblick Mobility GmbH · Berlin\nZur Stelle: https://jobs.example/2",
      footer,
    ].join("\n\n");
    expect(detectLanguage(xing)).toBe("de");
    expect(detectLanguage(stepstone)).toBe("de");
    // The footer alone, or an English message, is still English.
    expect(detectLanguage(footer)).toBe("en");
    expect(detectLanguage(`Hi Maria,\n\nWe are looking for a backend engineer.\n\n${footer}`)).toBe(
      "en",
    );
  });

  it("names every language with common words, whether or not it has phrase lists", () => {
    expect(
      detectLanguage(
        "Hallo Maria, wij zoeken een backend engineer voor ons team in Amsterdam. Heb je zin in een gesprek? Met vriendelijke groet",
      ),
    ).toBe("nl");
  });

  it("is null when the text is too short or too mixed to tell", () => {
    expect(detectLanguage("Hi")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage("the and you der die und")).toBeNull();
  });

  it("keeps apostrophes inside words", () => {
    expect(tokens("Don’t pay — it's free")).toEqual(["don't", "pay", "it's", "free"]);
  });

  it("has common words and negations for each language, lower case", () => {
    const { languages } = loadLanguageWords();
    expect(Object.keys(languages).sort()).toEqual(["de", "en", "es", "fr", "it", "nl", "pt"]);
    for (const l of Object.values(languages)) {
      expect(l.common.length).toBeGreaterThan(10);
      expect(l.negations.length).toBeGreaterThan(0);
    }
  });
});
