import { describe, expect, it } from "vitest";
import { describeClient } from "@/lib/client-info";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

describe("describeClient", () => {
  it("recognizes phones from the user agent when no client hints are sent", () => {
    expect(describeClient(new Headers({ "user-agent": IPHONE_SAFARI }))).toEqual({ mobile: true, platform: "ios", browser: "safari" });
    expect(describeClient(new Headers({ "user-agent": ANDROID_CHROME }))).toEqual({ mobile: true, platform: "android", browser: "chrome" });
  });

  it("recognizes desktops and the browsers that embed Chrome's token", () => {
    expect(describeClient(new Headers({ "user-agent": MAC_CHROME }))).toEqual({ mobile: false, platform: "macos", browser: "chrome" });
    expect(describeClient(new Headers({ "user-agent": WINDOWS_EDGE }))).toEqual({ mobile: false, platform: "windows", browser: "edge" });
  });

  it("prefers the client hints over the user agent", () => {
    const hinted = new Headers({ "user-agent": MAC_CHROME, "sec-ch-ua-mobile": "?1", "sec-ch-ua-platform": '"Android"' });
    expect(describeClient(hinted)).toEqual({ mobile: true, platform: "android", browser: "chrome" });
    const desktop = new Headers({ "user-agent": ANDROID_CHROME, "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Chrome OS"' });
    expect(describeClient(desktop)).toEqual({ mobile: false, platform: "chromeos", browser: "chrome" });
  });

  it("falls back to other for an unknown or missing user agent", () => {
    expect(describeClient(new Headers())).toEqual({ mobile: false, platform: "other", browser: "other" });
    expect(describeClient(new Headers({ "user-agent": "curl/8.4.0" }))).toEqual({ mobile: false, platform: "other", browser: "other" });
  });
});
