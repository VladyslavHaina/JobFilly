import type { Pay } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import {
  countryName,
  formatAgency,
  formatPay,
  formatPlace,
  formatTimeZones,
  parseAmount,
  safeLink,
} from "./format";

const pay = (p: Partial<Pay>): Pay => ({
  min: null,
  max: null,
  currency: null,
  period: null,
  asWritten: "as written",
  ...p,
});

describe("formatPay", () => {
  it("writes a range with the currency once and the period in words", () => {
    expect(formatPay(pay({ min: 450, max: 550, currency: "EUR", period: "day" }))).toBe(
      "€450–550 per day",
    );
    expect(formatPay(pay({ min: 75000, max: 85000, currency: "EUR", period: "year" }))).toBe(
      "€75,000–85,000 per year",
    );
  });

  it("says from and up to for open ranges, and one amount when both ends agree", () => {
    expect(formatPay(pay({ min: 30, currency: "GBP", period: "hour" }))).toBe("from £30 per hour");
    expect(formatPay(pay({ max: 5000, currency: "USD", period: "month" }))).toBe(
      "up to $5,000 per month",
    );
    expect(formatPay(pay({ min: 70000, max: 70000, currency: "EUR", period: "year" }))).toBe(
      "€70,000 per year",
    );
  });

  it("keeps cents when the mail states them, and leaves out what it doesn't state", () => {
    expect(formatPay(pay({ min: 30.5, max: 32, currency: "GBP", period: "hour" }))).toBe(
      "£30.50–32.00 per hour",
    );
    expect(formatPay(pay({ min: 450, max: 550 }))).toBe("450–550");
    expect(formatPay(pay({ min: 450, currency: "EUR" }))).toBe("from €450");
  });

  it("has nothing to normalise when the mail states no amount", () => {
    expect(
      formatPay(pay({ currency: "EUR", period: "year", asWritten: "competitive" })),
    ).toBeNull();
  });
});

describe("places and countries", () => {
  it("names countries from their ISO code", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("PT")).toBe("Portugal");
    expect(countryName("NL")).toBe("Netherlands");
  });

  it("writes the city and the country, or whichever is stated", () => {
    expect(formatPlace({ city: "Berlin", country: "DE" })).toBe("Berlin, Germany");
    expect(formatPlace({ city: null, country: "GB" })).toBe("United Kingdom");
    expect(formatPlace({ city: "Manchester", country: null })).toBe("Manchester");
  });
});

describe("other facts", () => {
  it("writes time zones and agencies", () => {
    expect(formatTimeZones({ from: "UTC+00:00", to: "UTC+02:00" })).toBe("UTC+00:00 to UTC+02:00");
    expect(formatTimeZones({ from: "UTC+01:00", to: "UTC+01:00" })).toBe("UTC+01:00");
    expect(formatAgency({ name: "Talent Partners", client: "Nordlicht" })).toBe(
      "Talent Partners (for Nordlicht)",
    );
    expect(formatAgency({ name: null, client: null })).toBeNull();
  });

  it("only links web addresses", () => {
    expect(safeLink("https://jobs.example/apply?id=1")).toBe("https://jobs.example/apply?id=1");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("not a url")).toBeNull();
  });
});

describe("parseAmount", () => {
  const read = (text: string, locale?: string) => parseAmount(text, locale);
  const amount = (n: number) => ({ ok: true, amount: n });

  it("reads the UI's own English amounts", () => {
    expect(read("70000")).toEqual(amount(70000));
    expect(read("70,000")).toEqual(amount(70000));
    expect(read("1,234.56")).toEqual(amount(1234.56));
    expect(read(" 450.5 ")).toEqual(amount(450.5));
    expect(read("70 000")).toEqual(amount(70000));
  });

  describe("in a dot-decimal locale (en)", () => {
    it("refuses what another locale writes, instead of reading the wrong number", () => {
      for (const text of ["450,50", "70.000", "1.234,56"]) {
        expect(read(text, "en"), text).toEqual({
          ok: false,
          message: "Retype the amount, written like 1,234.50",
        });
      }
    });

    it("refuses three digits after the decimal sign and groups in the wrong place", () => {
      for (const text of ["1234.567", "1,23,456", "12,3456", "450.", ",500"]) {
        expect(read(text, "en").ok, text).toBe(false);
      }
    });
  });

  describe("in a comma-decimal locale (de)", () => {
    it("reads its own amounts", () => {
      expect(read("450,50", "de")).toEqual(amount(450.5));
      expect(read("70.000", "de")).toEqual(amount(70000));
      expect(read("1.234,56", "de")).toEqual(amount(1234.56));
    });

    it("refuses what it can't read for certain", () => {
      for (const text of ["1,234.56", "450.50", "70,000"]) {
        expect(read(text, "de"), text).toEqual({
          ok: false,
          message: "Retype the amount, written like 1.234,50",
        });
      }
    });
  });

  it("asks for a number when there is none", () => {
    for (const text of ["", "  ", "seventy", "-5", "€70,000"]) {
      expect(read(text), text).toEqual({ ok: false, message: "Enter the amount as a number" });
    }
  });
});
