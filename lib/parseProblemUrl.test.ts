import { describe, expect, it } from "vitest";
import { parseProblemUrl, problemKey } from "./parseProblemUrl";

describe("parseProblemUrl", () => {
  it("parses codeforces contest urls", () => {
    expect(parseProblemUrl("https://codeforces.com/contest/1234/problem/A")).toEqual({
      platform: "codeforces",
      id: "1234A",
    });
  });
  it("parses codeforces problemset urls", () => {
    expect(parseProblemUrl("https://codeforces.com/problemset/problem/1669/A")).toEqual({
      platform: "codeforces",
      id: "1669A",
    });
  });
  it("parses cses urls", () => {
    expect(parseProblemUrl("https://cses.fi/problemset/task/1648")).toEqual({
      platform: "cses",
      id: "1648",
    });
  });
  it("parses atcoder urls", () => {
    expect(parseProblemUrl("https://atcoder.jp/contests/abc214/tasks/abc214_f")).toEqual({
      platform: "atcoder",
      id: "abc214:abc214_f",
    });
  });
  it("rejects malformed input", () => {
    expect(parseProblemUrl("")).toBeNull();
    expect(parseProblemUrl("not a url")).toBeNull();
    expect(parseProblemUrl("https://example.com/foo")).toBeNull();
    expect(parseProblemUrl("https://codeforces.com/contest/abc")).toBeNull();
    expect(parseProblemUrl("https://cses.fi/problemset/task/xyz")).toBeNull();
  });
  it("builds keys", () => {
    expect(problemKey("codeforces", "1234A")).toBe("codeforces:1234A");
  });
});
