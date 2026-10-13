/**
 * Coarse description of the browser that made a request, derived from the User-Agent client hints and the
 * User-Agent header: whether it is a phone, its platform family, and its browser family. No device model, OS
 * version, or raw user agent string is kept, so the result can go in logs; it exists so run failures can be
 * sliced by mobile versus desktop.
 */
export interface ClientInfo {
  readonly mobile: boolean;
  readonly platform: "ios" | "android" | "macos" | "windows" | "linux" | "chromeos" | "other";
  readonly browser: "safari" | "chrome" | "firefox" | "edge" | "samsung" | "other";
}

/** Reads the request's `sec-ch-ua-*` hints when present and falls back to the User-Agent string. */
export function describeClient(headers: Headers): ClientInfo {
  const ua = headers.get("user-agent") ?? "";
  const hintMobile = headers.get("sec-ch-ua-mobile");
  const hintPlatform = (headers.get("sec-ch-ua-platform") ?? "").replace(/"/gu, "").toLowerCase();
  const platform = platformFrom(hintPlatform, ua);
  const mobile = hintMobile === "?1" || (hintMobile !== "?0" && (platform === "ios" || /\bmobile\b|\bandroid\b.*\bmobile\b/iu.test(ua)));
  return { mobile, platform, browser: browserFrom(ua) };
}

function platformFrom(hint: string, ua: string): ClientInfo["platform"] {
  if (hint === "ios") return "ios";
  if (hint === "android") return "android";
  if (hint === "macos") return "macos";
  if (hint === "windows") return "windows";
  if (hint === "chrome os" || hint === "chromeos") return "chromeos";
  if (hint === "linux") return "linux";
  // iPadOS Safari reports itself as a Mac; a Mac with touch points is an iPad, but the header cannot tell, so it stays macOS.
  if (/\b(?:iPhone|iPad|iPod)\b/u.test(ua)) return "ios";
  if (/\bAndroid\b/u.test(ua)) return "android";
  if (/\bCrOS\b/u.test(ua)) return "chromeos";
  if (/\bWindows\b/u.test(ua)) return "windows";
  if (/\bMac OS X\b|\bMacintosh\b/u.test(ua)) return "macos";
  if (/\bLinux\b/u.test(ua)) return "linux";
  return "other";
}

function browserFrom(ua: string): ClientInfo["browser"] {
  if (/\bEdg(?:e|A|iOS)?\/\d/u.test(ua)) return "edge";
  if (/\bSamsungBrowser\/\d/u.test(ua)) return "samsung";
  if (/\b(?:Firefox|FxiOS)\/\d/u.test(ua)) return "firefox";
  if (/\b(?:Chrome|CriOS)\/\d/u.test(ua)) return "chrome";
  if (/\bSafari\/\d/u.test(ua) && /\bVersion\/\d/u.test(ua)) return "safari";
  return "other";
}
