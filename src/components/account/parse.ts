/*
 * The record screens read D1-backed JSON, so the payload is parsed once here
 * into the `realtime` types. A row that does not fit the contract is dropped
 * rather than rendered half-empty: a wrong number in a record is worse than a
 * shorter list.
 */

import type { RuleSet } from "@/game/protocol";
import type {
  EndReason,
  MatchRecord,
  PlayerInfo,
  PlayerStats,
  ProfileResponse,
  Seat,
} from "@/game/realtime";
import { isRecord } from "@/lib/guards";

/* Keyed by the unions so a new EndReason or RuleSet fails to compile here. */
const END_REASONS: Record<EndReason, true> = {
  five: true,
  resign: true,
  timeout: true,
  abandoned: true,
  draw: true,
};

const RULE_SETS: Record<RuleSet, true> = { freestyle: true, double_three_ban: true };

const SEATS: Record<Seat, true> = { black: true, white: true };

const isEndReason = (value: unknown): value is EndReason =>
  typeof value === "string" && Object.hasOwn(END_REASONS, value);

const isRuleSet = (value: unknown): value is RuleSet =>
  typeof value === "string" && Object.hasOwn(RULE_SETS, value);

const isSeat = (value: unknown): value is Seat =>
  typeof value === "string" && Object.hasOwn(SEATS, value);

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

export const parsePlayerStats = (value: unknown): PlayerStats | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const name = value["name"];
  if (typeof id !== "string" || typeof name !== "string") return null;

  const wins = count(value["wins"]);
  const losses = count(value["losses"]);
  const draws = count(value["draws"]);
  const played = count(value["played"]);
  const streak = count(value["streak"]);
  const bestStreak = count(value["bestStreak"]);
  if (
    wins === null ||
    losses === null ||
    draws === null ||
    played === null ||
    streak === null ||
    bestStreak === null
  ) {
    return null;
  }

  const lastPlayedAt = value["lastPlayedAt"];
  return {
    id,
    name,
    wins,
    losses,
    draws,
    played,
    streak,
    bestStreak,
    lastPlayedAt: typeof lastPlayedAt === "number" ? lastPlayedAt : null,
  };
};

const parsePlayerInfo = (value: unknown): PlayerInfo | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const name = value["name"];
  if (typeof id !== "string" || typeof name !== "string") return null;
  return {
    id,
    name,
    guest: value["guest"] === true,
    connected: value["connected"] === true,
  };
};

const parseMatchRecord = (value: unknown): MatchRecord | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const code = value["code"];
  const rule = value["rule"];
  const blackId = value["blackId"];
  const blackName = value["blackName"];
  const whiteId = value["whiteId"];
  const whiteName = value["whiteName"];
  const winnerRaw = value["winner"];
  const reason = value["reason"];
  const moves = value["moves"];
  if (
    typeof id !== "string" ||
    typeof code !== "string" ||
    typeof blackId !== "string" ||
    typeof blackName !== "string" ||
    typeof whiteId !== "string" ||
    typeof whiteName !== "string" ||
    typeof moves !== "string"
  ) {
    return null;
  }
  if (!isRuleSet(rule) || !isEndReason(reason)) return null;
  // `undefined` marks an off-contract seat; `null` is the legitimate draw.
  const winner = winnerRaw === null ? null : isSeat(winnerRaw) ? winnerRaw : undefined;
  if (winner === undefined) return null;

  const plies = count(value["plies"]);
  const startedAt = count(value["startedAt"]);
  const finishedAt = count(value["finishedAt"]);
  if (plies === null || startedAt === null || finishedAt === null) return null;

  return {
    id,
    code,
    rule,
    blackId,
    blackName,
    whiteId,
    whiteName,
    winner,
    reason,
    plies,
    startedAt,
    finishedAt,
    moves,
  };
};

export const parseProfileResponse = (value: unknown): ProfileResponse | null => {
  if (!isRecord(value)) return null;
  const player = parsePlayerInfo(value["player"]);
  if (player === null) return null;

  const recent = value["recent"];
  const rows = Array.isArray(recent)
    ? recent.map(parseMatchRecord).filter((row): row is MatchRecord => row !== null)
    : [];

  return { player, stats: parsePlayerStats(value["stats"]), recent: rows };
};

