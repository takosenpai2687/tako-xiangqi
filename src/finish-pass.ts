import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// Display-space vignette and fine film grain, applied after tone mapping.
export class FinishPass extends ShaderPass {
  private readonly time = new THREE.Uniform(0);

  constructor() {
    super(new THREE.ShaderMaterial({
      name: "Finish",
      uniforms: {
        tDiffuse: new THREE.Uniform<THREE.Texture | null>(null),
        uTime: new THREE.Uniform(0),
      },
      vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = vUv - 0.5;
  float vignette = 1.0 - 0.32 * smoothstep(0.3, 0.85, length(d * vec2(1.0, 0.9)));
  float grain = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = c.rgb * vignette + grain * 0.028 * (1.0 - luma * 0.5);
  gl_FragColor = c;
}`,
      depthTest: false,
      depthWrite: false,
    }));
    this.uniforms.uTime = this.time;
  }

  update(elapsed: number): void {
    this.time.value = elapsed;
  }
}
