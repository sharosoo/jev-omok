"use client";

/*
 * The app's only auth module. One `OAuthClient`, one `TokenStore`, one cached
 * profile — every screen reads this file and nothing else.
 *
 * Signing in is optional by design: a guest plays everything, they just get no
 * `player_stats` row. So nothing here throws for a missing token, a blocked
 * `localStorage` or a provider that cannot be reached; those all resolve to the
 * guest state.
 */

import {
  OAuthClient,
  TokenStore,
  memoryStorage,
  type TokenStorage,
} from "@sharosoo/auth-client/oauth-client";
import { useEffect, useSyncExternalStore } from "react";

import { isRecord } from "@/lib/guards";

export const AUTH_BASE_URL = "https://auth.sharosoo.com";
export const AUDIENCE = "https://omok.sharosoo.com";
export const CLAIM_NAMESPACE = "https://sharosoo.com";
export const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "omok:read",
  "omok:write",
] as const;

/** Records are keyed on this claim; `sub` is the client id on a machine token. */
const USER_ID_CLAIM = `${CLAIM_NAMESPACE}/user-id`;
const USERINFO_URL = `${AUTH_BASE_URL}/api/auth/oauth2/userinfo`;
const PROFILE_KEY = "omok.profile";
const STORAGE_PROBE_KEY = "omok.storage-probe";

const LOCAL_HOSTS: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
  "::1": true,
};

/*
 * This module is evaluated twice: once by `next build`'s static export, where
 * there is no `window` and the value is never used, and once in the browser,
 * which is where the client id and redirect actually get decided.
 */
const origin = typeof window === "undefined" ? AUDIENCE : window.location.origin;
const hostname = typeof window === "undefined" ? "" : window.location.hostname;

/** Two registered clients, one per redirect URI the provider will accept. */
export const CLIENT_ID = Object.hasOwn(LOCAL_HOSTS, hostname) ? "omok-web-dev" : "omok-web";

export const client = new OAuthClient({
  authBaseUrl: AUTH_BASE_URL,
  clientId: CLIENT_ID,
  redirectUri: `${origin}/auth/callback`,
  resource: AUDIENCE,
  scopes: SCOPES,
});

/*
 * Reading `localStorage` throws outright when site data is blocked, so a write
 * probe is the only way to ask. The memory fallback keeps a session working for
 * one tab instead of failing the sign-in.
 */
const openStorage = (): TokenStorage => {
  try {
    localStorage.setItem(STORAGE_PROBE_KEY, "1");
    localStorage.removeItem(STORAGE_PROBE_KEY);
    return localStorage;
  } catch {
    return memoryStorage();
  }
};

const storage = openStorage();

/** Tokens. `accessToken()` refreshes ahead of expiry and is null for a guest. */
export const tokens = new TokenStore(client, "omok", { storage });

/** `fetch` with the bearer token attached, or plain `fetch` for a guest. */
export const authorizedFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => tokens.authorizedFetch(input, init);

export interface AuthProfile {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly image: string | null;
}

export type AuthStatus = "loading" | "signed-in" | "guest";

export interface AuthState {
  readonly profile: AuthProfile | null;
  readonly status: AuthStatus;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/*
 * Read for display only. Whoever receives the token verifies its signature, so
 * checking it here would buy nothing and cost a JWKS fetch plus `jose` in the
 * browser bundle.
 */
const jwtClaims = (jwt: string): Record<string, unknown> | null => {
  const payload = jwt.split(".")[1];
  if (payload === undefined) return null;
  try {
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    // A Hangul display name only survives the base64 hop as UTF-8 bytes.
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const value: unknown = JSON.parse(decoded);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

/** Shapes an id-token payload or a userinfo body into a profile. */
const profileFromClaims = (claims: Record<string, unknown>): AuthProfile | null => {
  const id = text(claims[USER_ID_CLAIM]) ?? text(claims["sub"]);
  if (id === null) return null;
  const email = text(claims["email"]);
  return {
    id,
    // No display name anywhere is possible; the id is ugly but it is true.
    name: text(claims["name"]) ?? text(claims["preferred_username"]) ?? email ?? id,
    email,
    image: text(claims["picture"]),
  };
};

const profileFromCache = (value: Record<string, unknown>): AuthProfile | null => {
  const id = text(value["id"]);
  const name = text(value["name"]);
  if (id === null || name === null) return null;
  return { id, name, email: text(value["email"]), image: text(value["image"]) };
};

const LOADING: AuthState = { profile: null, status: "loading" };
const GUEST: AuthState = { profile: null, status: "guest" };

let state: AuthState = LOADING;
const listeners = new Set<() => void>();

const publish = (next: AuthState): void => {
  state = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = (): AuthState => state;
const serverSnapshot = (): AuthState => LOADING;

/** The cached profile. Synchronous, so a header can render without a spinner. */
export const readProfile = (): AuthProfile | null => {
  const raw = storage.getItem(PROFILE_KEY);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? profileFromCache(value) : null;
  } catch {
    return null;
  }
};

const cacheProfile = (profile: AuthProfile | null): void => {
  if (profile === null) storage.removeItem(PROFILE_KEY);
  else storage.setItem(PROFILE_KEY, JSON.stringify(profile));
};

const adopt = (profile: AuthProfile | null): AuthProfile | null => {
  cacheProfile(profile);
  publish(profile === null ? GUEST : { profile, status: "signed-in" });
  return profile;
};

/**
 * Refreshes the cached profile. The access token carries no display name, so
 * the name comes from the id token at sign-in, and from userinfo on any later
 * load where only the access token survived.
 */
export const syncProfile = async (idToken?: string): Promise<AuthProfile | null> => {
  if (idToken !== undefined) {
    const claims = jwtClaims(idToken);
    const fromIdToken = claims === null ? null : profileFromClaims(claims);
    if (fromIdToken !== null) return adopt(fromIdToken);
  }

  const token = await tokens.accessToken();
  if (token === null) return adopt(null);

  // A token in hand means signed in, so a failed userinfo downgrades the name,
  // never the session.
  const claims = jwtClaims(token);
  const fallback = claims === null ? null : profileFromClaims(claims);

  try {
    const response = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!response.ok) return adopt(fallback);
    const body: unknown = await response.json();
    const fromUserinfo = isRecord(body) ? profileFromClaims(body) : null;
    return adopt(fromUserinfo ?? fallback);
  } catch {
    return adopt(fallback);
  }
};

let bootstrap: Promise<void> | null = null;

const bootstrapOnce = (): Promise<void> => {
  bootstrap ??= (async () => {
    const token = await tokens.accessToken();
    if (token === null) {
      adopt(null);
      return;
    }
    const cached = readProfile();
    if (cached !== null) {
      publish({ profile: cached, status: "signed-in" });
      return;
    }
    await syncProfile();
  })();
  return bootstrap;
};

/**
 * The URL the provider is asked for. Exported so a sign-in problem can be read
 * off the query string instead of guessed at.
 */
export const buildAuthorizeUrl = (returnTo?: string): Promise<string> =>
  client.buildAuthorizeUrl(
    returnTo ?? `${window.location.pathname}${window.location.search}`,
  );

export const login = async (returnTo?: string): Promise<void> => {
  window.location.assign(await buildAuthorizeUrl(returnTo));
};

/**
 * Local sign-out only: the provider session stays, so signing back in is one
 * click rather than a fresh password prompt.
 */
export const logout = (): void => {
  tokens.clear();
  bootstrap = null;
  adopt(null);
};

/**
 * Where the browser goes after a sign-in. `returnTo` comes back from a
 * redirect, so it is only ever an in-app path: `//evil.example` is a
 * protocol-relative URL, not a path, and an absolute URL is an open redirect.
 */
export const safeReturnTo = (returnTo: string | null): string =>
  returnTo !== null && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";

/** Finishes the PKCE exchange. Returns the unvalidated `returnTo` it was given. */
export const completeLogin = async (search?: string): Promise<string | null> => {
  const result = await client.handleCallback(search);
  tokens.write(result.tokens);
  await syncProfile(result.tokens.idToken);
  return result.returnTo;
};

export interface UseAuth extends AuthState {
  readonly login: (returnTo?: string) => Promise<void>;
  readonly logout: () => void;
}

export const useAuth = (): UseAuth => {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    void bootstrapOnce();

    // Signing out in one tab must not leave another tab showing a name and
    // firing requests that 401.
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== tokens.storageKey && event.key !== PROFILE_KEY) {
        return;
      }
      bootstrap = null;
      void bootstrapOnce();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { profile: current.profile, status: current.status, login, logout };
};
