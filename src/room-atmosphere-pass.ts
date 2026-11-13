import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

export class RoomAtmospherePass extends ShaderPass {
  private readonly time = new THREE.Uniform(0);
  private readonly texel = new THREE.Uniform(new THREE.Vector2(1, 1));
  private readonly blurScale = new THREE.Uniform(1);

  constructor(
    camera: THREE.PerspectiveCamera,
    depth: THREE.DepthTexture,
    focus: THREE.Vector3,
    light: THREE.SpotLight,
    volume: THREE.Box3,
  ) {
    super(new THREE.ShaderMaterial({
      name: "QuietRoomAtmosphere",
      uniforms: {
        tDiffuse: new THREE.Uniform<THREE.Texture | null>(null),
        tDepth: new THREE.Uniform(depth),
        uInverseProjection: new THREE.Uniform(camera.projectionMatrixInverse),
        uCameraMatrix: new THREE.Uniform(camera.matrixWorld),
        uViewMatrix: new THREE.Uniform(camera.matrixWorldInverse),
        uFocus: new THREE.Uniform(focus),
        uTexel: new THREE.Uniform(new THREE.Vector2(1, 1)),
        uBlurScale: new THREE.Uniform(1),
        uTime: new THREE.Uniform(0),
        uVolumeMin: new THREE.Uniform(volume.min),
        uVolumeMax: new THREE.Uniform(volume.max),
        uLightPosition: new THREE.Uniform(light.position),
        uLightTarget: new THREE.Uniform(light.target.position),
        uLightColor: new THREE.Uniform(light.color),
        uLightIntensity: new THREE.Uniform(light.intensity),
        uCone: new THREE.Uniform(new THREE.Vector2(
          Math.cos(light.angle), Math.cos(light.angle * (1 - light.penumbra)),
        )),
      },
      vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform mat4 uViewMatrix;
uniform vec3 uFocus;
uniform vec2 uTexel;
uniform float uBlurScale;
uniform float uTime;
uniform vec3 uVolumeMin;
uniform vec3 uVolumeMax;
uniform vec3 uLightPosition;
uniform vec3 uLightTarget;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform vec2 uCone;
varying vec2 vUv;
vec3 viewPosition(vec2 uv) {
  float depth = textureLod(tDepth, uv, 0.0).r;
  vec4 p = uInverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
vec3 roomScattering(vec3 ray, float distance, vec3 color) {
  vec3 origin = uCameraMatrix[3].xyz;
  vec3 inverseRay = sign(ray + 0.0000001) / max(abs(ray), vec3(0.0000001));
  vec3 a = (uVolumeMin - origin) * inverseRay;
  vec3 b = (uVolumeMax - origin) * inverseRay;
  vec3 entry = min(a, b);
  vec3 exit = max(a, b);
  float start = max(0.0, max(entry.x, max(entry.y, entry.z)));
  float end = min(distance, min(exit.x, min(exit.y, exit.z)));
  if (end <= start) return color;
  float stepSize = (end - start) / 32.0;
  vec3 lightDirection = normalize(uLightTarget - uLightPosition);
  float transmission = 1.0;
  vec3 scattering = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    vec3 p = origin + ray * (start + (float(i) + 0.5) * stepSize);
    // An even haze with only a slow, shallow drift.
    float flow = 0.86 + 0.07 * sin(p.x * 0.43 + p.y * 0.28 + uTime * 0.007)
      + 0.07 * sin(p.z * 0.38 - p.y * 0.21 - uTime * 0.005);
    vec3 fromLight = p - uLightPosition;
    vec3 fromLightDirection = fromLight / max(length(fromLight), 0.0001);
    float cone = smoothstep(uCone.x, uCone.y, dot(fromLightDirection, lightDirection));
    // Soft shafts fanning out from the paper shade.
    float azimuth = atan(fromLight.z, fromLight.x);
    float shafts = 0.72 + 0.28 * sin(azimuth * 7.0 + 1.3) * sin(azimuth * 3.0 + 0.4);
    // A thin haze: enough to carry the lamp's shafts without veiling the far walls.
    float opacity = 1.0 - exp(-flow * 0.007 * stepSize);
    float illumination = min(3.0, uLightIntensity * 0.09 / (dot(fromLight, fromLight) + 0.6));
    vec3 radiance = vec3(0.03, 0.023, 0.016) + uLightColor * cone * shafts * illumination;
    scattering += transmission * opacity * radiance;
    transmission *= 1.0 - opacity;
  }
  return color * transmission + scattering;
}
void main() {
  vec4 original = textureLod(tDiffuse, vUv, 0.0);
  vec3 view = viewPosition(vUv);
  vec3 world = (uCameraMatrix * vec4(view, 1.0)).xyz;
  // Depth of field affects the room, not the game or tea. It stays under one pixel
  // so the shoji lattice and wall texture remain crisp.
  bool foreground = world.y >= -0.4 && abs(world.x) < 9.1 && abs(world.z) < 6.5;
  float focusDepth = -(uViewMatrix * vec4(uFocus, 1.0)).z;
  float radius = foreground
    ? 0.0
    : smoothstep(6.0, 30.0, abs(-view.z - focusDepth)) * 0.9 * uBlurScale;
  vec3 color = original.rgb;
  float total = 1.0;
  for (int i = 0; i < 16; i++) {
    float angle = float(i) * 2.399963;
    float ring = sqrt((float(i) + 0.5) / 16.0);
    vec2 uv = vUv + vec2(cos(angle), sin(angle)) * uTexel * radius * ring;
    float delta = viewPosition(uv).z - view.z;
    float weight = 0.6 / (1.0 + delta * delta * 8.0);
    color += textureLod(tDiffuse, uv, 0.0).rgb * weight;
    total += weight;
  }
  color /= total;
  vec3 ray = normalize(mat3(uCameraMatrix) * view);
  gl_FragColor = vec4(roomScattering(ray, length(view), color), original.a);
}`,
      depthTest: false,
      depthWrite: false,
    }));
    this.uniforms.uTime = this.time;
    this.uniforms.uTexel = this.texel;
    this.uniforms.uBlurScale = this.blurScale;
  }

  update(elapsed: number): void {
    this.time.value = elapsed;
  }

  override setSize(width: number, height: number): void {
    this.texel.value.set(1 / width, 1 / height);
    this.blurScale.value = height / 900;
  }
}
