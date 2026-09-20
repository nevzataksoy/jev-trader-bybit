import { describe, expect, it } from "vitest";
import { buildMacroState, isMacroCacheFresh, parseFredCsv } from "./macro";

const csv = `DATE,DGS1,DGS2,DGS10,DFII10,T10YIE
2026-09-11,4.29,4.38,4.78,2.45,2.29
2026-09-14,4.30,4.40,4.80,2.50,2.30
2026-09-15,4.31,4.42,4.82,2.51,2.31
2026-09-16,4.32,4.45,4.84,2.52,2.32
2026-09-17,4.34,4.49,4.86,2.55,2.31
2026-09-18,4.35,4.55,4.90,2.60,2.30`;

describe("official daily macro context", () => {
  it("parses observations and derives curve and regime context", () => {
    const state = buildMacroState(parseFredCsv(csv), new Date("2026-09-18T20:00:00.000Z"));
    expect(state.series.DGS2?.change_1d_bps).toBeCloseTo(6);
    expect(state.curve.slope_10y_2y_bps).toBeCloseTo(35);
    expect(state.gold_real_yield_regime).toBe("restrictive");
    expect(state.data_quality).toBe("complete");
  });

  it("does not turn missing FRED cells into zero-yield observations", () => {
    const rows = parseFredCsv("observation_date,DGS1,DGS2,DGS10,DFII10,T10YIE\n2026-09-18,,,,,2.30");
    const state = buildMacroState(rows, new Date("2026-09-18T20:00:00.000Z"));
    expect(state.series.DGS1).toBeNull();
    expect(state.series.T10YIE?.value_pct).toBe(2.3);
    expect(state.data_quality).toBe("partial");
  });

  it("treats a recently collected daily observation as reusable cache", () => {
    const state = buildMacroState(parseFredCsv(csv), new Date("2026-09-18T20:00:00.000Z"));
    expect(isMacroCacheFresh(state, new Date("2026-09-18T23:00:00.000Z").getTime(), 6)).toBe(true);
    expect(isMacroCacheFresh(state, new Date("2026-09-19T05:00:00.000Z").getTime(), 6)).toBe(false);
  });
});
