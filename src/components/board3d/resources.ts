import * as THREE from "three";

import { BOARD_SIZE } from "@/game/protocol";
import {
  BOARD_EXTENT,
  BORDER_HALF_WIDTH,
  GRID_SPAN,
  GRID_Y,
  LINE_HALF_WIDTH,
  STAR_POINTS,
  STAR_RADIUS,
  STAR_Y,
  STONE_HALF_HEIGHT,
  STONE_RADIUS,
  worldXFromColumn,
  worldZFromRow,
} from "./scene";

/*
 * Every GPU resource below is a lazily built module singleton, shared by every
 * mesh and both stone colours. The scene mounts once per page, the objects are
 * a few KB each, and sharing is what keeps a full 225-stone board at one draw
 * call per colour. Meshes that receive them are marked `dispose={null}` so R3F
 * never tears down an object it does not own.
 */

const COLOR_GRID = "#241709";
const COLOR_WOOD_BASE = "#d8b177";
const COLOR_WOOD_LIGHT = "#e6c795";
const COLOR_WOOD_DARK = "#c59a5f";

let lensProfile: THREE.Vector2[] | undefined;

/**
 * Half-profile of a biconvex go stone: two spherical caps meeting at the rim.
 * `rho` is the cap's sphere radius for the given footprint and height, so the
 * silhouette stays a lens rather than an ellipsoid.
 */
function buildLensProfile(): THREE.Vector2[] {
  const steps = 8;
  const r = STONE_RADIUS;
  const h = STONE_HALF_HEIGHT;
  const rho = (r * r + h * h) / (2 * h);
  const cap = (radius: number): number => Math.sqrt(rho * rho - radius * radius) - (rho - h);

  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const radius = (i / steps) * r;
    points.push(new THREE.Vector2(radius, -cap(radius)));
  }
  for (let i = steps - 1; i >= 0; i--) {
    const radius = (i / steps) * r;
    points.push(new THREE.Vector2(radius, cap(radius)));
  }
  return points;
}

let lensArgs: [points: THREE.Vector2[], segments: number] | undefined;

/** Stable `args` tuple so R3F never rebuilds the lathe on a re-render. */
export const stoneGeometryArgs = (): [points: THREE.Vector2[], segments: number] =>
  (lensArgs ??= [(lensProfile ??= buildLensProfile()), 36]);

let instancedLens: THREE.LatheGeometry | undefined;
let plainLens: THREE.LatheGeometry | undefined;

/** Shared by the two instanced stone meshes. */
export const stoneGeometry = (): THREE.LatheGeometry =>
  (instancedLens ??= new THREE.LatheGeometry(...stoneGeometryArgs()));

/*
 * Deliberately a second buffer with identical contents. WebGL keeps its vertex
 * array state per (geometry, program) pair, and a geometry that an InstancedMesh
 * has already bound leaves per-instance attribute divisors behind, which makes
 * the same buffer draw nothing from a plain mesh.
 */
export const ghostGeometry = (): THREE.LatheGeometry =>
  (plainLens ??= new THREE.LatheGeometry(...stoneGeometryArgs()));

/* ------------------------------------------------------------------ *
 * Board surface
 * ------------------------------------------------------------------ */

let woodTexture: THREE.CanvasTexture | null | undefined;

const hash2 = (x: number, y: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smoothstep(x - xi);
  const ty = smoothstep(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let octave = 0; octave < 4; octave++) {
    sum += valueNoise(fx, fy) * amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
  }
  return sum;
}

/**
 * Procedural kaya-like grain. Generated on a canvas rather than downloaded:
 * the scene must not fetch any texture at runtime.
 */
function buildWoodTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;

  const light = new THREE.Color(COLOR_WOOD_LIGHT);
  const dark = new THREE.Color(COLOR_WOOD_DARK);
  const mixed = new THREE.Color();
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      // Bands are lines of constant U, so the grain runs front to back. The
      // warp only nudges them; a strong warp reads as tiger stripes, not wood.
      const warp = fbm(u * 4.5, v * 1.1) - 0.5;
      const bands = Math.sin((u * 26 + warp * 0.9) * Math.PI * 2);
      const fibre = (valueNoise(u * 520, v * 18) - 0.5) * 0.22;
      const t = 0.5 + 0.22 * bands * Math.abs(bands) + fibre;
      mixed.copy(dark).lerp(light, t < 0 ? 0 : t > 1 ? 1 : t);
      const i = (py * size + px) * 4;
      data[i] = Math.round(mixed.r * 255);
      data[i + 1] = Math.round(mixed.g * 255);
      data[i + 2] = Math.round(mixed.b * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export const getWoodTexture = (): THREE.CanvasTexture | null =>
  (woodTexture === undefined ? (woodTexture = buildWoodTexture()) : woodTexture);

let veneerMaterial: THREE.MeshStandardMaterial | undefined;

export const getVeneerMaterial = (): THREE.MeshStandardMaterial => {
  if (veneerMaterial === undefined) {
    const map = getWoodTexture();
    veneerMaterial = new THREE.MeshStandardMaterial({
      color: map === null ? COLOR_WOOD_BASE : "#ffffff",
      map,
      roughness: 0.62,
      metalness: 0.02,
    });
  }
  return veneerMaterial;
};

let veneerGeometry: THREE.PlaneGeometry | undefined;

/** Inset far enough to stay inside the slab's rounded top edge. */
export const getVeneerGeometry = (): THREE.PlaneGeometry =>
  (veneerGeometry ??= new THREE.PlaneGeometry(BOARD_EXTENT - 0.44, BOARD_EXTENT - 0.44));

let gridGeometry: THREE.BufferGeometry | undefined;
let gridMaterial: THREE.MeshStandardMaterial | undefined;

/**
 * Grid lines and star points merged into one geometry of flat quads/fans. Thin
 * meshes rather than a texture, so the lines stay a crisp constant width at
 * every zoom level instead of blurring through mip levels.
 */
function buildGridGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];

  const quad = (cx: number, cz: number, halfX: number, halfZ: number, y: number): void => {
    const x0 = cx - halfX;
    const x1 = cx + halfX;
    const z0 = cz - halfZ;
    const z1 = cz + halfZ;
    positions.push(x0, y, z0, x1, y, z1, x1, y, z0);
    positions.push(x0, y, z0, x0, y, z1, x1, y, z1);
  };

  const halfSpan = GRID_SPAN / 2;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const edge = i === 0 || i === BOARD_SIZE - 1;
    const half = edge ? BORDER_HALF_WIDTH : LINE_HALF_WIDTH;
    // Extend each line by its own half width so the corners close cleanly.
    quad(worldXFromColumn(i), 0, half, halfSpan + half, 0);
    quad(0, worldZFromRow(i), halfSpan + half, half, 0);
  }

  const starY = STAR_Y - GRID_Y;
  const segments = 20;
  for (const star of STAR_POINTS) {
    const cx = worldXFromColumn(star.x);
    const cz = worldZFromRow(star.y);
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      positions.push(cx, starY, cz);
      positions.push(cx + Math.cos(a1) * STAR_RADIUS, starY, cz + Math.sin(a1) * STAR_RADIUS);
      positions.push(cx + Math.cos(a0) * STAR_RADIUS, starY, cz + Math.sin(a0) * STAR_RADIUS);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

export const getGridGeometry = (): THREE.BufferGeometry => (gridGeometry ??= buildGridGeometry());

export const getGridMaterial = (): THREE.MeshStandardMaterial =>
  (gridMaterial ??= new THREE.MeshStandardMaterial({
    color: COLOR_GRID,
    roughness: 0.42,
    metalness: 0.05,
  }));

/* ------------------------------------------------------------------ *
 * Stones and markers
 * ------------------------------------------------------------------ */

let blackStone: THREE.MeshPhysicalMaterial | undefined;
let whiteStone: THREE.MeshPhysicalMaterial | undefined;

export const getBlackStoneMaterial = (): THREE.MeshPhysicalMaterial =>
  (blackStone ??= new THREE.MeshPhysicalMaterial({
    color: "#0c0c10",
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    reflectivity: 0.6,
  }));

export const getWhiteStoneMaterial = (): THREE.MeshPhysicalMaterial =>
  (whiteStone ??= new THREE.MeshPhysicalMaterial({
    color: "#f4eee1",
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    // Stands in for the waxy translucency of shell stones without paying for
    // real transmission, which instanced meshes would render incorrectly.
    sheen: 0.7,
    sheenColor: "#fff8ec",
    reflectivity: 0.45,
  }));

let ghostMaterial: THREE.MeshPhysicalMaterial | undefined;

export const getGhostMaterial = (): THREE.MeshPhysicalMaterial =>
  (ghostMaterial ??= new THREE.MeshPhysicalMaterial({
    color: "#15151a",
    roughness: 0.22,
    metalness: 0,
    clearcoat: 1,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  }));

const ringCache = new Map<string, THREE.RingGeometry>();

export function getRingGeometry(inner: number, outer: number): THREE.RingGeometry {
  const key = `${inner}:${outer}`;
  const cached = ringCache.get(key);
  if (cached !== undefined) return cached;
  const geometry = new THREE.RingGeometry(inner, outer, 48, 1);
  ringCache.set(key, geometry);
  return geometry;
}

let hoverRingMaterial: THREE.MeshBasicMaterial | undefined;

export const getHoverRingMaterial = (): THREE.MeshBasicMaterial =>
  (hoverRingMaterial ??= new THREE.MeshBasicMaterial({
    color: "#ffe6ab",
    transparent: true,
    opacity: 0.85,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));

let forbiddenMaterial: THREE.MeshBasicMaterial | undefined;

export const getForbiddenMaterial = (): THREE.MeshBasicMaterial =>
  (forbiddenMaterial ??= new THREE.MeshBasicMaterial({
    color: "#e2483a",
    transparent: true,
    opacity: 0.8,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));

let lastMoveMaterial: THREE.MeshBasicMaterial | undefined;

export const getLastMoveMaterial = (): THREE.MeshBasicMaterial =>
  (lastMoveMaterial ??= new THREE.MeshBasicMaterial({
    color: "#ffc94f",
    transparent: true,
    opacity: 0,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));

let winConnectorGeometry: THREE.CylinderGeometry | undefined;

/** Unit cylinder along +Y, scaled and rotated per winning line. */
export const getWinConnectorGeometry = (): THREE.CylinderGeometry =>
  (winConnectorGeometry ??= new THREE.CylinderGeometry(1, 1, 1, 14, 1, false));

let winConnectorMaterial: THREE.MeshBasicMaterial | undefined;

export const getWinConnectorMaterial = (): THREE.MeshBasicMaterial =>
  (winConnectorMaterial ??= new THREE.MeshBasicMaterial({
    color: "#ffd45e",
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));

let winHaloMaterial: THREE.MeshBasicMaterial | undefined;

export const getWinHaloMaterial = (): THREE.MeshBasicMaterial =>
  (winHaloMaterial ??= new THREE.MeshBasicMaterial({
    color: "#ffe9a8",
    transparent: true,
    opacity: 0.5,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));

let contactTexture: THREE.CanvasTexture | null | undefined;

/** Radial falloff used as an alpha map, so one disc reads as a soft blob. */
function buildContactTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.42, "#d8d8d8");
  gradient.addColorStop(1, "#000000");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

let contactGeometry: THREE.CircleGeometry | undefined;

/** Pre-rotated into the XZ plane so instances need no rotation of their own. */
export const getContactShadowGeometry = (): THREE.CircleGeometry => {
  if (contactGeometry === undefined) {
    contactGeometry = new THREE.CircleGeometry(1, 28);
    contactGeometry.rotateX(-Math.PI / 2);
  }
  return contactGeometry;
};

let contactMaterial: THREE.MeshBasicMaterial | undefined;

/*
 * The key light alone cannot seat the stones: a lens only 0.36 units tall
 * throws a cast shadow that hides underneath its own footprint, so the board
 * needs an explicit contact blob per stone.
 */
export const getContactShadowMaterial = (): THREE.MeshBasicMaterial => {
  if (contactMaterial === undefined) {
    contactTexture = contactTexture === undefined ? buildContactTexture() : contactTexture;
    contactMaterial = new THREE.MeshBasicMaterial({
      color: "#2a1c0b",
      alphaMap: contactTexture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
    });
  }
  return contactMaterial;
};

let pickGeometry: THREE.PlaneGeometry | undefined;

/** Exactly one cell wider than the grid, so rounding always lands in range. */
export const getPickGeometry = (): THREE.PlaneGeometry =>
  (pickGeometry ??= new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE));
