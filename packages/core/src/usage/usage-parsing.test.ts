import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseTranscriptLine, totalTokens, type UsageEntry } from "./parser.ts";
import { DEFAULT_PRICING, entryCost, mergePricing, priceFor } from "./pricing.ts";
import { localDate, parseResetTime, zonedTimeToUtc } from "./reset-time.ts";

const fixture = readFileSync(new URL("fixtures/transcript.jsonl", import.meta.url), "utf8").split(
  "\n",
);
const parsed = fixture.map(parseTranscriptLine);

describe("parseTranscriptLine", () => {
  it("extrae el consumo con el desglose de caché por duración", () => {
    expect(parsed[1]).toEqual({
      type: "usage",
      entry: {
        messageId: "msg_1",
        requestId: "req_1",
        sessionId: "sess-a",
        timestamp: Date.parse("2026-08-26T14:11:27.000Z"),
        model: "claude-opus-5",
        inputTokens: 2,
        outputTokens: 100,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 1000,
        cacheReadTokens: 5000,
        webSearches: 0,
        fast: false,
        cwd: "/Users/demo/proyecto",
      },
    });
  });

  it("repite el mismo par de ids en las líneas del mismo mensaje (se deduplica al guardar)", () => {
    const [first, second] = [parsed[1], parsed[2]];
    expect(first?.type === "usage" && second?.type === "usage").toBe(true);
    if (first?.type === "usage" && second?.type === "usage") {
      expect([first.entry.messageId, first.entry.requestId]).toEqual([
        second.entry.messageId,
        second.entry.requestId,
      ]);
    }
  });

  it("sin desglose, cuenta toda la escritura de caché como de 5 minutos, y lee búsquedas y modo rápido", () => {
    expect(parsed[3]).toMatchObject({
      entry: { cacheWrite5mTokens: 200, cacheWrite1hTokens: 0, webSearches: 3 },
    });
    expect(parsed[4]).toMatchObject({ entry: { fast: true } });
  });

  it("reconoce el aviso de límite y calcula el reinicio en su zona horaria", () => {
    expect(parsed[5]).toEqual({
      type: "limit",
      event: {
        timestamp: Date.parse("2026-08-26T19:01:07.104Z"),
        sessionId: "sess-a",
        kind: "session",
        // 12:10pm en Hermosillo (UTC-7) = 19:10Z, el mismo día.
        resetsAt: Date.parse("2026-08-26T19:10:00.000Z"),
        message: "You've hit your session limit · resets 12:10pm (America/Hermosillo)",
      },
    });
  });

  it("ignora errores que no son de límite, entradas <synthetic>, otras líneas y basura", () => {
    expect(parsed.slice(6)).toEqual([null, null, null, null, null]);
    expect(parsed[0]).toBeNull();
  });

  it("suma todos los tipos de token", () => {
    const entry = parsed[1]?.type === "usage" ? parsed[1].entry : undefined;
    expect(entry && totalTokens(entry)).toBe(6102);
  });
});

describe("parseResetTime", () => {
  const hermosillo = "America/Hermosillo";

  it.each([
    ["2:20am", "2026-09-25T06:24:58Z", "2026-09-25T09:20:00Z"],
    ["12:10pm", "2026-08-26T19:01:07Z", "2026-08-26T19:10:00Z"],
    ["9am", "2026-08-26T19:01:07Z", "2026-08-27T16:00:00Z"],
    ["12am", "2026-08-26T19:01:07Z", "2026-08-27T07:00:00Z"],
    ["Oct 3, 9am", "2026-09-28T10:00:00Z", "2026-10-03T16:00:00Z"],
    ["Jan 2 at 8:30pm", "2026-12-30T10:00:00Z", "2027-01-03T03:30:00Z"],
  ])("«%s» avisado a las %s → %s", (text, reference, expected) => {
    expect(parseResetTime(text, hermosillo, Date.parse(reference))).toBe(Date.parse(expected));
  });

  it("un aviso emitido en el mismo minuto del reinicio no salta al día siguiente", () => {
    expect(parseResetTime("12:10pm", hermosillo, Date.parse("2026-08-26T19:10:30Z"))).toBe(
      Date.parse("2026-08-26T19:10:00Z"),
    );
  });

  it("respeta el horario de verano de la zona", () => {
    // Nueva York: UTC-4 en verano, UTC-5 en invierno.
    expect(parseResetTime("3pm", "America/New_York", Date.parse("2026-07-01T12:00:00Z"))).toBe(
      Date.parse("2026-07-01T19:00:00Z"),
    );
    expect(parseResetTime("3pm", "America/New_York", Date.parse("2026-12-01T12:00:00Z"))).toBe(
      Date.parse("2026-12-01T20:00:00Z"),
    );
  });

  it("devuelve null si no entiende la hora o la zona", () => {
    expect(parseResetTime("pronto", hermosillo, 0)).toBeNull();
    expect(parseResetTime("25pm", hermosillo, 0)).toBeNull();
    expect(parseResetTime("3pm", "Zona/Inventada", 0)).toBeNull();
  });
});

describe("zonas horarias", () => {
  it("convierte hora local a UTC y agrupa por día local", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 9, day: 26 }, 23, 30, "America/Hermosillo")).toBe(
      Date.parse("2026-09-27T06:30:00Z"),
    );
    expect(localDate(Date.parse("2026-09-27T03:12:00Z"), "America/Hermosillo")).toBe("2026-09-26");
    expect(localDate(Date.parse("2026-09-27T03:12:00Z"), "UTC")).toBe("2026-09-27");
  });
});

describe("pricing", () => {
  const entry: UsageEntry = {
    messageId: "m",
    requestId: "r",
    sessionId: "s",
    timestamp: 0,
    model: "claude-opus-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheWrite5mTokens: 1_000_000,
    cacheWrite1hTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    webSearches: 0,
    fast: false,
    cwd: null,
  };

  it("suma cada tipo de token a su tarifa", () => {
    // 5 + 25 + 6.25 + 10 + 0.5
    expect(entryCost(entry, DEFAULT_PRICING)).toBeCloseTo(46.75);
  });

  it("aplica el modo rápido y las búsquedas web", () => {
    expect(entryCost({ ...entry, fast: true }, DEFAULT_PRICING)).toBeCloseTo(93.5);
    expect(
      entryCost(
        {
          ...entry,
          model: "claude-sonnet-5",
          outputTokens: 0,
          inputTokens: 0,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 0,
          webSearches: 1000,
        },
        DEFAULT_PRICING,
      ),
    ).toBeCloseTo(10);
  });

  it("acepta sufijos de fecha y devuelve null para modelos sin precio", () => {
    expect(priceFor(DEFAULT_PRICING, "claude-opus-5-20260401")).toEqual(
      DEFAULT_PRICING.models["claude-opus-5"],
    );
    expect(entryCost({ ...entry, model: "modelo-nuevo" }, DEFAULT_PRICING)).toBeNull();
  });

  it("combina la tabla del usuario con la de fábrica", () => {
    const table = mergePricing({
      models: {
        "claude-opus-5": { input: 1 },
        "modelo-nuevo": { input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 },
        incompleto: { input: 1 },
      },
      webSearchPer1k: 0,
    });

    expect(table.models["claude-opus-5"]?.input).toBe(1);
    expect(table.models["claude-opus-5"]?.output).toBe(25);
    expect(table.models["modelo-nuevo"]).toBeDefined();
    expect(table.models.incompleto).toBeUndefined();
    expect(table.webSearchPer1k).toBe(0);
  });
});
