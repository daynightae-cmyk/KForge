import { describe, expect, it } from "vitest";
import { parseNetstatListenerPids, attributeListenerPort } from "./listenerAttribution";

// Real `netstat -ano -p TCP` shapes captured on Windows 10 while KForge owned
// the listener. The header rows and unrelated connections are part of the same
// output, so the parser must not treat them as evidence.
const TABLE = [
  "Active Internet connections (w/o servers)",
  "Proto Local Address          Foreign Address        State           PID",
  "  TCP    127.0.0.1:59499        0.0.0.0:0              LISTENING       8216",
  "  TCP    127.0.0.1:59500        0.0.0.0:0              LISTENING       8217",
  "  TCP    127.0.0.1:59499        127.0.0.1:52310        ESTABLISHED     8216",
  "  TCP    127.0.0.1:52310        127.0.0.1:59499        ESTABLISHED     9001",
  "  TCP    10.0.0.5:445           10.0.0.9:52113         ESTABLISHED     4",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012",
  "  TCP    [::]:445               [::]:0                 LISTENING       4",
  "  TCP    [::1]:43123            [::]:0                 LISTENING       7777",
].join("\r\n");

describe("Windows netstat listener table parsing", () => {
  it("attributes the listening owner without the transient connection rows", () => {
    expect(parseNetstatListenerPids(TABLE, 59499)).toEqual([8216]);
  });

  it("does not confuse a prefix port with the probed port", () => {
    expect(parseNetstatListenerPids(TABLE, 5950)).toEqual([]);
    expect(parseNetstatListenerPids(TABLE, 59500)).toEqual([8217]);
  });

  it("reads bracketed IPv6 and wildcard local addresses", () => {
    expect(parseNetstatListenerPids(TABLE, 43123)).toEqual([7777]);
    expect(parseNetstatListenerPids(TABLE, 135)).toEqual([1012]);
    expect(parseNetstatListenerPids(TABLE, 445)).toEqual([4]);
  });

  it("reports every distinct owner so a shared port is never guessed", () => {
    const shared = [
      "  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       111",
      "  TCP    [::1]:8080             [::]:0                 LISTENING       222",
    ].join("\r\n");
    expect(parseNetstatListenerPids(shared, 8080).sort((a, b) => a - b)).toEqual([111, 222]);
  });

  it("ignores malformed rows, non-TCP protocols and unusable PIDs", () => {
    const noise = [
      "  UDP    0.0.0.0:5353           *:*                                    1234",
      "  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING",
      "  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       not-a-pid",
      "  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       0",
      "  TCP    unexpected",
    ].join("\r\n");
    expect(parseNetstatListenerPids(noise, 8080)).toEqual([]);
  });

  it("returns nothing for an empty table or an invalid port", () => {
    expect(parseNetstatListenerPids("", 8080)).toEqual([]);
    for (const port of [0, -1, 65_536, 80.5, Number.NaN]) expect(parseNetstatListenerPids(TABLE, port)).toEqual([]);
  });

  it("refuses to attribute an invalid port instead of querying the OS", async () => {
    const attribution = await attributeListenerPort(0, process.pid);
    expect(attribution.relation).toBe("UNAVAILABLE");
    expect(attribution.pid).toBeUndefined();
    expect(attribution.source).toBe("invalid port");
  });
});
