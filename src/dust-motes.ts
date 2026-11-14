import * as THREE from "three";

const COUNT = 140;

// Sparse warm specks drifting in the lamp light; motion is computed on the GPU.
export class DustMotes {
  readonly points: THREE.Points;
  private readonly time = new THREE.Uniform(0);

  constructor(center: THREE.Vector3, size: THREE.Vector3) {
    const seeds = new Float32Array(COUNT * 4);
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = center.x + (Math.random() - 0.5) * size.x;
      positions[i * 3 + 1] = center.y + (Math.random() - 0.5) * size.y;
      positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * size.z;
      for (let j = 0; j < 4; j++) seeds[i * 4 + j] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
    this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uTime: this.time },
      vertexShader: `
attribute vec4 seed;
uniform float uTime;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * (0.05 + seed.w * 0.06);
  p.x += sin(t + seed.x * 6.28) * 0.5;
  p.y += sin(t * 0.8 + seed.y * 6.28) * 0.35 - mod(uTime * 0.01 * (0.3 + seed.z), 1.0) * 0.2;
  p.z += cos(t + seed.z * 6.28) * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (2.0 + seed.w * 3.0) * 8.0 / max(-mv.z, 1.0);
  vAlpha = 0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * 0.3 + seed.x * 12.0));
}`,
      fragmentShader: `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(1.0, 0.86, 0.66, a * a * vAlpha * 0.28);
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  update(elapsed: number): void {
    this.time.value = elapsed;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
