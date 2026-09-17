"use client";

import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { memo, useEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";

import {
  BOARD_EXTENT,
  BOARD_THICKNESS,
  BOARD_TOP_Y,
  VIEW_ELEVATION_DEG,
  VIEW_FOV,
} from "./scene";

type OrbitControlsApi = ComponentRef<typeof OrbitControls>;

const ELEVATION = THREE.MathUtils.degToRad(VIEW_ELEVATION_DEG);
const VIEW_DIRECTION = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
const HALF_FOV_TAN = Math.tan(THREE.MathUtils.degToRad(VIEW_FOV) / 2);

/** Share of the viewport half-extent the board is allowed to occupy. */
const FILL = 0.92;
const SOLVER_PASSES = 10;

const ZOOM_IN_LIMIT = 0.75;
const ZOOM_OUT_LIMIT = 1.3;

function boardCorners(): THREE.Vector3[] {
  const half = BOARD_EXTENT / 2;
  const corners: THREE.Vector3[] = [];
  for (const y of [BOARD_TOP_Y, BOARD_TOP_Y - BOARD_THICKNESS]) {
    for (const x of [-half, half]) {
      for (const z of [-half, half]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners;
}

/**
 * Frames the slab and clamps the orbit.
 *
 * The framing rule is solved rather than hard-coded: project the eight slab
 * corners, pan the orbit target until the projected bounding box is centred on
 * the viewport, then push the camera back until the box's larger half-extent
 * fills `FILL` of the viewport. Both steps use the live canvas aspect, so a
 * tall phone gets the same even margin as a wide side-panel layout. A fixed
 * camera position cannot do this: an obliquely viewed flat board projects to a
 * box whose centre is not the board's centre, so it always drifts.
 */
const CameraRig = memo(function CameraRig() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const domElement = useThree((state) => state.gl.domElement);
  const controls = useRef<OrbitControlsApi>(null);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (size.width === 0 || size.height === 0) return;

    const corners = boardCorners();
    const target = new THREE.Vector3(0, BOARD_TOP_Y, 0);
    const ndc = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    // Own the projection inputs rather than trusting whatever R3F applied last.
    const aspect = size.width / size.height;
    camera.aspect = aspect;
    camera.fov = VIEW_FOV;

    let distance = BOARD_EXTENT * 2;
    const place = (): void => {
      camera.position.copy(VIEW_DIRECTION).multiplyScalar(distance).add(target);
      camera.lookAt(target);
      camera.near = Math.max(0.5, distance * 0.2);
      camera.far = distance * 4;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    };

    for (let pass = 0; pass < SOLVER_PASSES; pass++) {
      place();

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const corner of corners) {
        ndc.copy(corner).project(camera);
        if (ndc.x < minX) minX = ndc.x;
        if (ndc.x > maxX) maxX = ndc.x;
        if (ndc.y < minY) minY = ndc.y;
        if (ndc.y > maxY) maxY = ndc.y;
      }

      // Moving the target inside the camera's screen plane is a pure pan: the
      // camera is always placed at target + direction * distance.
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const halfViewHeight = distance * HALF_FOV_TAN;
      target.addScaledVector(right, ((minX + maxX) / 2) * halfViewHeight * aspect);
      target.addScaledVector(up, ((minY + maxY) / 2) * halfViewHeight);

      distance *= Math.max((maxX - minX) / 2, (maxY - minY) / 2) / FILL;
    }
    place();

    const orbit = controls.current;
    if (orbit !== null) {
      orbit.target.copy(target);
      orbit.minDistance = distance * ZOOM_IN_LIMIT;
      orbit.maxDistance = distance * ZOOM_OUT_LIMIT;
      orbit.update();
    }
  }, [camera, size]);

  useEffect(() => {
    // OrbitControls pins `touch-action: none` on connect, which would eat
    // one-finger page scrolling. This effect belongs to the parent of the
    // controls, so it lands after their connect effect.
    domElement.style.touchAction = "pan-y";
  }, [domElement]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.09}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
      minPolarAngle={Math.PI * 0.16}
      maxPolarAngle={Math.PI * 0.42}
      minAzimuthAngle={-Math.PI * 0.2}
      maxAzimuthAngle={Math.PI * 0.2}
    />
  );
});

export default CameraRig;
