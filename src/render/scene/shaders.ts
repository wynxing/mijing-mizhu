/**
 * 地板 / 墙 / sprite 的 GLSL。
 * 光照一律在逻辑空间算（vLogical 与屏幕精确相等），屏幕上光斑才是圆的。
 * 用 mod/floor 取位而不用位运算，保持在 GLSL ES 1.00（three 默认）下可用。
 */

export const FLOOR_VERT = /* glsl */ `
attribute vec2 aLogical;
attribute float aKind;
attribute float aTone;
attribute float aCliffMask;
attribute float aDir;
attribute float aShade;

uniform float uSinElev;

varying vec2 vLogical;
varying vec3 vNormalW;
varying float vTone;
varying float vKind;
varying float vShade;

void main() {
  vec3 pos = position;
  // 侧壁：邻格是实地（掩码位为 0）的那条边塌陷成零高度，退化不画。
  if (aDir >= 0.0) {
    float bit = mod(floor(aCliffMask / pow(2.0, aDir)), 2.0);
    pos.y *= bit;
  }
  vLogical = aLogical + vec2(position.x, position.z * uSinElev);
  vNormalW = normal;
  vTone = aTone;
  vKind = aKind;
  vShade = aShade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
}
`;

export const FLOOR_FRAG = /* glsl */ `
uniform sampler2D uAlbedo;
uniform sampler2D uNormalMap;
uniform float uTile;
uniform vec2 uPlayerLogical;
uniform float uLanternInner;
uniform float uLanternOuter;
uniform float uMemory;
uniform vec3 uLightDir;
uniform vec3 uHeardTint;

varying vec2 vLogical;
varying vec3 vNormalW;
varying float vTone;
varying float vKind;
varying float vShade;

void main() {
  float d = distance(vLogical, uPlayerLogical);
  float lantern = 1.0 - smoothstep(uLanternInner, uLanternOuter, d);
  // 实地：提灯区内亮、区外落到记忆亮度；只探听到的通路：恒暗、不吃提灯。
  float memLevel = mix(uMemory, uMemory * 0.5, vKind);
  float lit = max(lantern * (1.0 - vKind), memLevel);

  vec2 uv = vLogical / uTile;
  vec3 alb = texture2D(uAlbedo, uv).rgb * mix(0.92, 1.08, vTone);
  vec3 bump = texture2D(uNormalMap, uv).xyz * 2.0 - 1.0;
  vec3 n = normalize(vNormalW + vec3(bump.x, 0.0, bump.y) * 0.35);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);

  vec3 base = alb * (0.35 + 0.65 * diff);
  base = mix(base, uHeardTint * (0.3 + 0.7 * diff), vKind);
  // 侧壁自上而下压暗，给地块一点厚度感
  gl_FragColor = vec4(base * lit * vShade, 1.0);
  #include <colorspace_fragment>
}
`;

export const WALL_VERT = /* glsl */ `
uniform float uSinElev;

varying vec2 vLogical;
varying vec3 vNormalW;

void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vLogical = vec2(world.x, world.z * uSinElev);
  vNormalW = normalize(mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const WALL_FRAG = /* glsl */ `
uniform vec2 uPlayerLogical;
uniform float uLanternInner;
uniform float uLanternOuter;
uniform vec3 uWallLine;
uniform vec3 uWallLit;

varying vec2 vLogical;
varying vec3 vNormalW;

void main() {
  float d = distance(vLogical, uPlayerLogical);
  float lantern = 1.0 - smoothstep(uLanternInner, uLanternOuter, d);
  vec3 color = mix(uWallLine, uWallLit, pow(lantern, 1.4));
  float diff = 0.5 + 0.5 * max(dot(normalize(vNormalW), normalize(vec3(0.3, 1.0, 0.2))), 0.0);
  gl_FragColor = vec4(color * diff, 1.0);
  #include <colorspace_fragment>
}
`;

export const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SPRITE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uLantern;
uniform float uAlpha;
uniform float uHit;
uniform vec3 uHitColor;

varying vec2 vUv;

void main() {
  vec4 t = texture2D(uMap, vUv);
  vec3 rgb = mix(t.rgb * uLantern, uHitColor, uHit);
  gl_FragColor = vec4(rgb, t.a * uAlpha);
  #include <colorspace_fragment>
}
`;
