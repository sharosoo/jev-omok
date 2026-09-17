import { MatchScreen } from "@/components/pvp/MatchScreen";

/*
 * A room code cannot be known at build time, and `output: "export"` only emits
 * HTML for the params returned here. So the export emits exactly one shell for
 * this route, under the reserved param `room` — lowercase and four characters,
 * which no real six-character uppercase code can collide with. In production
 * the Worker serves that shell for every `/pvp/<code>`; the client reads the
 * code back off `location`.
 */
export function generateStaticParams() {
  return [{ code: "room" }];
}

export default function MatchPage() {
  return <MatchScreen />;
}
