import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound URL guard for user-configured destinations (webhooks).
 * Blocks: non-HTTPS, embedded credentials, localhost/internal names, and any hostname that
 * resolves to a private, loopback, link-local, CGNAT or cloud-metadata address. Checked again at
 * send time (DNS can change after the URL was saved). Redirects are never followed by the caller.
 */
export class UnsafeUrlError extends Error {}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd)/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
  }
  return true; // not an IP at all → treat as unsafe here
}

export function assertSafeUrlSyntax(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (u.protocol !== "https:") throw new UnsafeUrlError("Only https:// destinations are allowed");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    (!host.includes(".") && !isIP(host))
  ) {
    throw new UnsafeUrlError("Internal hostnames are not allowed");
  }
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError("Private or reserved IP addresses are not allowed");
  if (u.port && !["443", "8443"].includes(u.port)) throw new UnsafeUrlError("Only ports 443 and 8443 are allowed");
  return u;
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  const u = assertSafeUrlSyntax(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return u;
  const addrs = await lookup(host, { all: true, verbatim: true }).catch(() => {
    throw new UnsafeUrlError("Hostname does not resolve");
  });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
    throw new UnsafeUrlError("Hostname resolves to a private or reserved address");
  return u;
}
