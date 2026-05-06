import { useEffect, useRef, useState } from "react";

import styles from "./WaveBackground.module.css";

/**
 * Live animated wireframe-ocean background. Mirrors the static
 * `landing-banner.jpeg` aesthetic but with rolling waves driven by a few
 * stacked sine functions on a plane evaluated in the vertex shader.
 *
 * Pure WebGL2 — no three.js — to keep the bundle small. Falls back to the
 * baked JPEG when WebGL2 is unavailable, and freezes time when the user has
 * `prefers-reduced-motion`.
 */

const VERT_SRC = `#version 300 es
precision highp float;

in vec2 a_pos;            // grid position in plane space (X, Z)
uniform mat4 u_mvp;
uniform vec3 u_eye;
uniform float u_time;

out float v_alpha;

void main() {
  vec2 p = a_pos;
  float t = u_time;

  // Stacked swells — frequencies, amplitudes and drift directions are tuned
  // to feel like an open ocean: one slow heave, two cross-running mid swells,
  // a fast small ripple. Shifting x and z by a small amount per layer keeps
  // the field from settling into a visible repeat axis.
  float h = 0.0;
  h += sin(p.x * 0.20 + t * 0.32) * cos(p.y * 0.16 - t * 0.24) * 0.65;
  h += sin(p.x * 0.45 - p.y * 0.38 + t * 0.50) * 0.25;
  h += sin(p.x * 1.05 + p.y * 0.90 - t * 0.70) * 0.08;
  h += sin((p.x + p.y * 0.55) * 0.11 + t * 0.20) * 0.35;

  vec3 world = vec3(p.x, h, p.y);
  gl_Position = u_mvp * vec4(world, 1.0);

  // Distance fog from the camera so the plane melts into the bg toward the
  // horizon and is brightest in the foreground.
  float distCam = length(world - u_eye);
  float fog = 1.0 - smoothstep(1.5, 32.0, distCam);

  // Horizontal fade so the wireframe lives in the right half of the frame
  // (matches the banner where the top-left is bare bg).
  float xFade = smoothstep(-12.0, 6.0, world.x);

  // Diagonal corner fade: kill the upper-left where the original banner is
  // pure bg. The expression below grows for points that are both far away
  // (low z) AND on the left side (low x), so only the upper-left of the
  // visible plane gets attenuated.
  float diag = (8.0 - world.x) - world.z;
  float cornerFade = 1.0 - smoothstep(25.0, 50.0, diag);

  // Only kill what's actually behind the camera. Anything in front stays
  // fully lit and the fog takes care of distant fade-out.
  float frontFade = smoothstep(u_eye.z + 1.0, u_eye.z - 1.5, world.z);

  v_alpha = fog * xFade * cornerFade * frontFade;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in float v_alpha;
uniform vec3 u_lineColor;
out vec4 outColor;

void main() {
  // Canvas is cleared to the bg colour and we render with additive blending
  // (ONE, ONE), so per-line contribution is a small lift on top of the base
  // bg. Crossing lines stack to brighten the perspective-compressed horizon
  // and wave crests, which is what gives the original its glow.
  float a = clamp(v_alpha, 0.0, 1.0) * 0.28;
  outColor = vec4(u_lineColor * a, 1.0);
}
`;

type Vec3 = readonly [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Column-major perspective projection (right-handed, OpenGL-style). */
const perspective = (
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array => {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
};

const lookAt = (eye: Vec3, target: Vec3, up: Vec3): Float32Array => {
  const f = norm(sub(target, eye));
  const s = norm(cross(f, up));
  const u = cross(s, f);
  const m = new Float32Array(16);
  m[0] = s[0]; m[4] = s[1]; m[8] = s[2]; m[12] = -dot(s, eye);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -dot(u, eye);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = dot(f, eye);
  m[15] = 1;
  return m;
};

const mul = (a: Float32Array, b: Float32Array): Float32Array => {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let acc = 0;
      for (let k = 0; k < 4; k++) acc += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = acc;
    }
  }
  return r;
};

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader | null => {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram | null => {
  const v = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
};

/* Plane footprint in world units. Kept tight in X (so the visible cells
 * stay fine at our grid resolution) and long in Z (so we get a deep
 * receding horizon). `Z_OFFSET` pushes the centre back into the distance.
 * `X_OFFSET` shifts the plane to the right of the camera so the wireframe
 * lives in the right half of the frame. */
const PLANE_W = 32;
const PLANE_H = 50;
const Z_OFFSET = -18;
const X_OFFSET = 3;

/* Camera framing — chosen empirically to land the densest wireframe area in
 * the lower-right and a soft horizon roughly 25% from the top, matching
 * `landing-banner.jpeg`. ~12° pitch + low eye gives strong foreshorten so
 * the perspective-compressed cells densify toward the horizon. */
const EYE: Vec3 = [-3, 2.0, 7];
const TARGET: Vec3 = [3, -1.5, -8];
const UP: Vec3 = [0, 1, 0];
const FOV = (60 * Math.PI) / 180;

/* Bg colour painted into the canvas itself (matches the surrounding overlay
 * so the boundary is invisible). */
const BG_COLOR: Vec3 = [0.024, 0.118, 0.11];

/* Brighter teal than the bg — the fragment shader scales each line's
 * contribution way down so crossing lines are what builds visible density.
 * Tuned so a single foreground line is faintly readable and a dense horizon
 * cluster lifts to near full saturation. */
const LINE_COLOR: Vec3 = [0.55, 1.0, 0.85];

export default function WaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      setFailed(true);
      return;
    }

    const program = createProgram(gl, VERT_SRC, FRAG_SRC);
    if (!program) {
      setFailed(true);
      return;
    }

    /* Mobile gets a coarser grid + lower DPR cap to stay smooth on weaker
     * GPUs without changing the visual character. */
    const isSmall = window.matchMedia("(max-width: 640px)").matches;
    const GRID_W = isSmall ? 140 : 220;
    const GRID_H = isSmall ? 200 : 320;
    const dprCap = isSmall ? 1.5 : 2;

    const positions = new Float32Array(GRID_W * GRID_H * 2);
    {
      let i = 0;
      for (let z = 0; z < GRID_H; z++) {
        for (let x = 0; x < GRID_W; x++) {
          positions[i++] = (x / (GRID_W - 1) - 0.5) * PLANE_W + X_OFFSET;
          positions[i++] = (z / (GRID_H - 1) - 0.5) * PLANE_H + Z_OFFSET;
        }
      }
    }

    /* Index buffer: each interior vertex contributes a "right" and a
     * "forward" line segment, producing a full grid. UNSIGNED_INT is fine in
     * WebGL2 (no extension needed) so 19k+ vertex grids work directly. */
    const lineCount = (GRID_W - 1) * GRID_H + GRID_W * (GRID_H - 1);
    const indices = new Uint32Array(lineCount * 2);
    {
      let i = 0;
      for (let z = 0; z < GRID_H; z++) {
        for (let x = 0; x < GRID_W; x++) {
          const v = z * GRID_W + x;
          if (x < GRID_W - 1) {
            indices[i++] = v;
            indices[i++] = v + 1;
          }
          if (z < GRID_H - 1) {
            indices[i++] = v;
            indices[i++] = v + GRID_W;
          }
        }
      }
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uMvp = gl.getUniformLocation(program, "u_mvp");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uEye = gl.getUniformLocation(program, "u_eye");
    const uLineColor = gl.getUniformLocation(program, "u_lineColor");

    gl.useProgram(program);
    gl.uniform3f(uEye, EYE[0], EYE[1], EYE[2]);
    gl.uniform3f(uLineColor, LINE_COLOR[0], LINE_COLOR[1], LINE_COLOR[2]);

    /* Additive blending over an opaque base. The fragment shader writes
     * `lineColor * alpha` with output alpha = 1, so `(SRC_ALPHA, ONE)` would
     * double-count alpha. Instead we use `(ONE, ONE)` since the per-pixel
     * weighting already lives in the colour term. */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(BG_COLOR[0], BG_COLOR[1], BG_COLOR[2], 1.0);

    const viewM = lookAt(EYE, TARGET, UP);

    let canvasW = 0;
    let canvasH = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (w === canvasW && h === canvasH) return;
      canvasW = w;
      canvasH = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      const projM = perspective(FOV, w / h, 0.1, 100);
      const mvp = mul(projM, viewM);
      gl.uniformMatrix4fv(uMvp, false, mvp);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frozenTime = reduced.matches ? 6.0 : null;
    const onMotionChange = () => {
      frozenTime = reduced.matches ? 6.0 : null;
    };
    reduced.addEventListener("change", onMotionChange);

    let raf = 0;
    let visible = !document.hidden;
    const start = performance.now();

    const draw = () => {
      const t =
        frozenTime !== null ? frozenTime : (performance.now() - start) / 1000;
      gl.uniform1f(uTime, t);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.LINES, indices.length, gl.UNSIGNED_INT, 0);
    };

    const loop = () => {
      if (!visible) {
        raf = 0;
        return;
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();

    const onVisibility = () => {
      visible = !document.hidden;
      if (visible && raf === 0) loop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      reduced.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(idxBuf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, []);

  if (failed) return <div className={styles.fallback} aria-hidden="true" />;
  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
