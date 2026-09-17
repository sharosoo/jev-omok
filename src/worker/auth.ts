import { createTokenVerifier, tokenUserId } from "@sharosoo/auth-client/verify";

const CLAIM_NAMESPACE = "https://sharosoo.com";
const MAX_GUEST_NAME_LENGTH = 24;

export interface PlayerIdentity {
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
}

interface UserInfo {
  readonly name?: string;
  readonly email?: string;
}

const isUserInfo = (value: unknown): value is UserInfo =>
  typeof value === "object" && value !== null;

export function sanitiseGuestName(value: unknown): string {
  if (typeof value !== "string") return "Guest";
  const printable = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  const capped = Array.from(printable).slice(0, MAX_GUEST_NAME_LENGTH).join("");
  return capped || "Guest";
}

export async function fetchUserInfoName(
  env: CloudflareEnv,
  token: string,
  fallback: string,
): Promise<string> {
  try {
    const response = await fetch(`${env.AUTH_BASE_URL}/api/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return fallback;
    const raw: unknown = await response.json();
    if (!isUserInfo(raw)) return fallback;
    if (typeof raw.name === "string" && raw.name.trim()) return raw.name.trim();
    if (typeof raw.email === "string" && raw.email.trim()) return raw.email.trim();
  } catch {
    return fallback;
  }
  return fallback;
}

export async function verifyPlayerId(env: CloudflareEnv, token: string): Promise<string> {
  const verifier = createTokenVerifier({
    authBaseUrl: env.AUTH_BASE_URL,
    audience: env.API_AUDIENCE,
  });
  const claims = await verifier.verify(token);
  const id = tokenUserId(claims, CLAIM_NAMESPACE);
  if (!id) throw new Error("User access token is required");
  return id;
}

export async function resolveAuthenticatedPlayer(
  env: CloudflareEnv,
  token: string,
  id: string,
): Promise<PlayerIdentity> {
  let cachedName: string | null = null;
  try {
    const row = await env.DB.prepare("SELECT name FROM player_stats WHERE id = ?").bind(id).first<{
      name: string;
    }>();
    cachedName = row?.name ?? null;
  } catch {
    // A profile lookup must not prevent an authenticated player from joining a match.
  }

  return {
    id,
    name: cachedName ?? (await fetchUserInfoName(env, token, id)),
    guest: false,
  };
}

export async function authenticatePlayer(
  env: CloudflareEnv,
  token: string,
): Promise<PlayerIdentity> {
  const id = await verifyPlayerId(env, token);
  return resolveAuthenticatedPlayer(env, token, id);
}

export function createGuestIdentity(guestName: unknown): PlayerIdentity {
  return {
    id: `guest:${crypto.randomUUID()}`,
    name: sanitiseGuestName(guestName),
    guest: true,
  };
}

export const claimNamespace = CLAIM_NAMESPACE;
