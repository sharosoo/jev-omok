import { BOARD_SIZE, type Coord } from "@/game/protocol";

/*
 * World-space layout of the board. One cell of the 15x15 grid is exactly one
 * world unit, which keeps every other number here readable as "board units".
 *
 * Mapping (fixed contract with the rest of the scene):
 *   x (column 0..14) -> world X, growing to the right
 *   y (row 0..14)    -> world Z, growing toward the default camera
 * so {x:0,y:0} is the far-left corner and {x:7,y:7} sits on the centre star.
 */
export const CELL = 1;
export const GRID_SPAN = (BOARD_SIZE - 1) * CELL;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

const GRID_CENTRE = (BOARD_SIZE - 1) / 2;

/** Wood that extends past the outermost line, as on a real board. */
export const BOARD_MARGIN = 1.15;
export const BOARD_EXTENT = GRID_SPAN + BOARD_MARGIN * 2;
export const BOARD_THICKNESS = 0.95;

/*
 * Coplanar decals are separated by fixed world offsets instead of
 * polygonOffset: with near=1/far=140 the depth buffer resolves 2mm at this
 * camera distance easily, and real offsets also survive orbiting.
 */
export const BOARD_TOP_Y = 0;
export const VENEER_Y = BOARD_TOP_Y + 0.002;
export const GRID_Y = BOARD_TOP_Y + 0.006;
export const STAR_Y = BOARD_TOP_Y + 0.008;
export const FORBIDDEN_Y = BOARD_TOP_Y + 0.012;
export const LAST_MOVE_Y = BOARD_TOP_Y + 0.014;
export const HOVER_RING_Y = BOARD_TOP_Y + 0.016;
export const WIN_HALO_Y = BOARD_TOP_Y + 0.02;
export const PICK_Y = BOARD_TOP_Y + 0.03;

export const STONE_RADIUS = 0.46;
export const STONE_HALF_HEIGHT = 0.18;

/** Single source of truth: the key light and the contact blob must agree. */
export const KEY_LIGHT_POSITION: readonly [number, number, number] = [8, 12, 7];
export const CONTACT_SHADOW_Y = BOARD_TOP_Y + 0.01;
export const CONTACT_SHADOW_RADIUS = STONE_RADIUS * 1.32;

/*
 * A flat board reads badly under a wide lens: the far edge compresses and far
 * stones shrink. A narrow fov with the camera pushed back keeps the grid close
 * to even, and 50 degrees of elevation is a calm three-quarter view.
 */
export const VIEW_FOV = 26;
export const VIEW_ELEVATION_DEG = 50;

export const LINE_HALF_WIDTH = 0.018;
export const BORDER_HALF_WIDTH = 0.03;
export const STAR_RADIUS = 0.105;

export const worldXFromColumn = (column: number): number => (column - GRID_CENTRE) * CELL;
export const worldZFromRow = (row: number): number => (row - GRID_CENTRE) * CELL;
export const columnFromWorldX = (worldX: number): number => Math.round(worldX / CELL + GRID_CENTRE);
export const rowFromWorldZ = (worldZ: number): number => Math.round(worldZ / CELL + GRID_CENTRE);

/** Stable identity for an intersection, used as the React key and diff key. */
export const cellKey = (column: number, row: number): number => row * BOARD_SIZE + column;

export const isOnBoard = (column: number, row: number): boolean =>
  column >= 0 && column < BOARD_SIZE && row >= 0 && row < BOARD_SIZE;

export const STAR_POINTS: readonly Coord[] = [
  { x: 3, y: 3 },
  { x: 11, y: 3 },
  { x: 7, y: 7 },
  { x: 3, y: 11 },
  { x: 11, y: 11 },
];

/* ------------------------------------------------------------------ *
 * Drop animation
 * ------------------------------------------------------------------ */

export const DROP_HEIGHT = 1.5;
export const FALL_MS = 200;
export const SETTLE_MS = 140;
export const DROP_TOTAL_MS = FALL_MS + SETTLE_MS;

/** Peak vertical compression at impact, as a fraction of the stone height. */
const SQUASH = 0.34;
/** How much of the lost height the stone gains in width. */
const SQUASH_SPREAD = 0.5;

export interface StonePose {
  y: number;
  scaleXZ: number;
  scaleY: number;
}

export const settledPose = (pose: StonePose): StonePose => {
  pose.y = STONE_HALF_HEIGHT;
  pose.scaleXZ = 1;
  pose.scaleY = 1;
  return pose;
};

/**
 * Pose of a stone `elapsed` ms after it appeared. Writes into `pose` so the
 * per-frame loop stays allocation free.
 */
export function dropPose(elapsed: number, pose: StonePose): StonePose {
  if (elapsed >= DROP_TOTAL_MS) return settledPose(pose);

  if (elapsed < FALL_MS) {
    const p = elapsed / FALL_MS;
    // Accelerating fall: the stone is rigid until it touches the wood.
    pose.y = STONE_HALF_HEIGHT + DROP_HEIGHT * (1 - p * p);
    pose.scaleXZ = 1;
    pose.scaleY = 1;
    return pose;
  }

  const q = (elapsed - FALL_MS) / SETTLE_MS;
  // One compression followed by a smaller stretch, both decaying to zero, so
  // the pose is continuous with the end of the fall and with the rest state.
  const squash = SQUASH * Math.sin(q * Math.PI * 1.6) * Math.pow(1 - q, 1.2);
  pose.scaleY = 1 - squash;
  pose.scaleXZ = 1 + squash * SQUASH_SPREAD;
  // Keep the underside planted on the board while the stone deforms.
  pose.y = STONE_HALF_HEIGHT * pose.scaleY;
  return pose;
}

/* ------------------------------------------------------------------ *
 * Win highlight
 * ------------------------------------------------------------------ */

export const WIN_RISE = 0.22;
export const WIN_RISE_MS = 340;
export const WIN_BOB = 0.055;
export const WIN_BOB_PERIOD_MS = 1500;
export const WIN_STAGGER_MS = 70;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Extra height and scale for a winning stone, `elapsed` ms after the win. */
export function winLift(elapsed: number, index: number, reducedMotion: boolean): number {
  if (reducedMotion) return WIN_RISE;
  const local = elapsed - index * WIN_STAGGER_MS;
  if (local <= 0) return 0;
  const rise = WIN_RISE * easeOutCubic(clamp01(local / WIN_RISE_MS));
  const bob = WIN_BOB * Math.sin((local / WIN_BOB_PERIOD_MS) * Math.PI * 2);
  return rise + bob * clamp01(local / WIN_RISE_MS);
}

/** The two most distant stones of a line, i.e. the connector's endpoints. */
export function lineEndpoints(line: readonly Coord[]): readonly [Coord, Coord] | null {
  if (line.length < 2) return null;
  let best = -1;
  let a = line[0];
  let b = line[1];
  if (a === undefined || b === undefined) return null;
  for (let i = 0; i < line.length; i++) {
    for (let j = i + 1; j < line.length; j++) {
      const p = line[i];
      const q = line[j];
      if (p === undefined || q === undefined) continue;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = dx * dx + dy * dy;
      if (d > best) {
        best = d;
        a = p;
        b = q;
      }
    }
  }
  return [a, b];
}
