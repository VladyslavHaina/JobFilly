import { describe, expect, it } from "vitest";
import { detectLanguage, loadLanguageWords, tokens } from "./language";

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

  it("names a language without phrase lists too, so its check is marked incomplete", () => {
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
    const languages = loadLanguageWords();
    expect(Object.keys(languages).sort()).toEqual(["de", "en", "es", "fr", "it", "nl", "pt"]);
    for (const l of Object.values(languages)) {
      expect(l.common.length).toBeGreaterThan(10);
      expect(l.negations.length).toBeGreaterThan(0);
    }
  });
});
