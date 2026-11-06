import {
  Color,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import albedoUrl from '../../assets/art/floor-albedo.png';
import normalUrl from '../../assets/art/floor-albedo-normal.png';
import { PALETTE } from '../palette';

export interface FloorTextures {
  albedo: Texture;
  normal: Texture;
}

/**
 * 地板贴图。uv = vLogical / uTile 是绝对逻辑坐标，会远超 [0,1]，
 * 因此必须 RepeatWrapping，否则整片地面会被 clamp 成边缘一个纹素。
 */
export function loadFloorTextures(): FloorTextures {
  const loader = new TextureLoader();
  const albedo = loader.load(albedoUrl);
  albedo.colorSpace = SRGBColorSpace;
  albedo.wrapS = RepeatWrapping;
  albedo.wrapT = RepeatWrapping;
  const normal = loader.load(normalUrl);
  normal.colorSpace = NoColorSpace;
  normal.wrapS = RepeatWrapping;
  normal.wrapT = RepeatWrapping;
  return { albedo, normal };
}

/** palette hex → three.Color（颜色管理开启时存的是线性值，与 sRGB 贴图一致）。 */
export function paletteColor(key: keyof typeof PALETTE): Color {
  return new Color(PALETTE[key] as string);
}
