import { describe, expect, it } from "vitest";
import { getSafeErrorMessage } from "./errors";

describe("getSafeErrorMessage", () => {
  it("reads normal errors and thrown strings", () => {
    expect(getSafeErrorMessage(new Error("network failed"), "fallback")).toBe("network failed");
    expect(getSafeErrorMessage("socket closed", "fallback")).toBe("socket closed");
  });

  it("summarizes the plain HTTP objects thrown by the Bybit SDK", () => {
    const result = getSafeErrorMessage({
      code: 403,
      message: "Forbidden",
      body: "<html><body>Request blocked for this region</body></html>",
      headers: { authorization: "secret" },
      requestOptions: { key: "secret" },
    }, "fallback");

    expect(result).toBe("HTTP 403: Forbidden: Request blocked for this region");
    expect(result).not.toContain("secret");
  });

  it("uses structured provider messages without serializing request metadata", () => {
    expect(getSafeErrorMessage({ code: 429, body: { retMsg: "Too many requests" } }, "fallback"))
      .toBe("HTTP 429: Too many requests");
    expect(getSafeErrorMessage({ headers: { key: "secret" } }, "fallback")).toBe("fallback");
  });
});
