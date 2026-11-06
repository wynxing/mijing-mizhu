/**
 * 生成素材处理管线：ImageGen 原图 → 裁水印 → 抠背 → 裁边 → 缩放 → src/assets/art/。
 * 手动执行：npm run art。manifest 未变更且产物已存在时跳过（lock 记录 sha256）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

interface Entry {
  src: string;
  out: string;
  /** 'auto' = 取边框色做 chroma key；'black' = 纯黑 key（游魂）；null = 不抠背。 */
  key: 'auto' | 'black' | null;
  keyTolerance?: number;
  cropBottomPct: number;
  size: number;
  /** 额外从 albedo 推导一张法线贴图（同名 -normal.png）。 */
  normal?: boolean;
}

interface Manifest {
  entries: Entry[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = resolve(ROOT, 'scripts/art-manifest.json');
const LOCK_PATH = resolve(ROOT, 'scripts/art-manifest.lock.json');

const KEY_TOLERANCE: Record<'auto' | 'black', number> = { auto: 110, black: 18 };

/** 管线逻辑变更时递增，使 lock 失效重处理。 */
const PIPELINE_VERSION = 3;

function abs(p: string): string {
  return resolve(ROOT, p);
}

function cropBottom(png: PNG, pct: number): PNG {
  const cut = Math.floor(png.height * (1 - pct / 100));
  const out = new PNG({ width: png.width, height: cut });
  for (let y = 0; y < cut; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const s = (y * png.width + x) * 4;
      const d = (y * out.width + x) * 4;
      out.data[d] = png.data[s];
      out.data[d + 1] = png.data[s + 1];
      out.data[d + 2] = png.data[s + 2];
      out.data[d + 3] = png.data[s + 3];
    }
  }
  return out;
}

function at(png: PNG, x: number, y: number): number {
  return (y * png.width + x) * 4;
}

/**
 * 背景掩膜。chroma（auto）用全局色匹配：底色是特意挑主体里不存在的颜色，
 * 全局匹配才能吃掉被主体围住的封闭残留。black 用边界 flood-fill：
 * 主体自身的暗部也接近黑，只能靠连通性区分。
 */
function keyBackground(png: PNG, tolerance: number, black: boolean): Uint8Array {
  const { width, height, data } = png;
  const ki = at(png, 2, 2);
  const kr = data[ki];
  const kg = data[ki + 1];
  const kb = data[ki + 2];
  const isBg = (i: number): boolean => {
    if (black) {
      const m = Math.max(data[i], data[i + 1], data[i + 2]);
      return m <= tolerance;
    }
    const dr = data[i] - kr;
    const dg = data[i + 1] - kg;
    const db = data[i + 2] - kb;
    return dr * dr + dg * dg + db * db <= tolerance * tolerance;
  };

  const bg = new Uint8Array(width * height);
  if (!black) {
    for (let p = 0; p < bg.length; p += 1) bg[p] = isBg(p * 4) ? 1 : 0;
    return bg;
  }

  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    const p = y * width + x;
    if (bg[p]) return;
    if (!isBg(p * 4)) return;
    bg[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return bg;
}

/** 背景 alpha 归零；前景与背景交界一圈做 1px 羽化 + 去溢色。 */
function applyAlpha(png: PNG, bg: Uint8Array, despill: boolean): void {
  const { width, height, data } = png;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;
      if (bg[p]) {
        data[i + 3] = 0;
        continue;
      }
      const edge =
        (x > 0 && bg[p - 1]) ||
        (x < width - 1 && bg[p + 1]) ||
        (y > 0 && bg[p - width]) ||
        (y < height - 1 && bg[p + width]);
      data[i + 3] = edge ? 170 : 255;
      if (edge && despill) {
        data[i] = Math.min(data[i], data[i + 1] + 50);
        data[i + 2] = Math.min(data[i + 2], data[i + 1] + 50);
      }
    }
  }
}

function trimAlpha(png: PNG): PNG {
  const { width, height, data } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return png;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = ((minY + y) * width + (minX + x)) * 4;
      const d = (y * w + x) * 4;
      out.data[d] = png.data[s];
      out.data[d + 1] = png.data[s + 1];
      out.data[d + 2] = png.data[s + 2];
      out.data[d + 3] = png.data[s + 3];
    }
  }
  return out;
}

/** 居中裁最大正方形：地板等不抠背的素材必须满幅，否则 fitSquare 留透明黑边，
 * 世界坐标平铺时接缝会落在格心上变成黑条。 */
function centerCropSquare(png: PNG): PNG {
  const side = Math.min(png.width, png.height);
  const ox = Math.floor((png.width - side) / 2);
  const oy = Math.floor((png.height - side) / 2);
  const out = new PNG({ width: side, height: side });
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const s = ((oy + y) * png.width + (ox + x)) * 4;
      const d = (y * side + x) * 4;
      out.data[d] = png.data[s];
      out.data[d + 1] = png.data[s + 1];
      out.data[d + 2] = png.data[s + 2];
      out.data[d + 3] = png.data[s + 3];
    }
  }
  return out;
}

/** 盒滤波缩放到 size×size 正方形（保持比例，空余留透明）。 */
function fitSquare(png: PNG, size: number): PNG {
  const scale = Math.min(size / png.width, size / png.height);
  const dw = Math.max(1, Math.round(png.width * scale));
  const dh = Math.max(1, Math.round(png.height * scale));
  const out = new PNG({ width: size, height: size });
  const ox = Math.floor((size - dw) / 2);
  const oy = Math.floor((size - dh) / 2);
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const sx0 = Math.floor((x * png.width) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * png.width) / dw));
      const sy0 = Math.floor((y * png.height) / dh);
      const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * png.height) / dh));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const s = (sy * png.width + sx) * 4;
          r += png.data[s];
          g += png.data[s + 1];
          b += png.data[s + 2];
          a += png.data[s + 3];
          n += 1;
        }
      }
      const d = ((oy + y) * size + (ox + x)) * 4;
      out.data[d] = Math.round(r / n);
      out.data[d + 1] = Math.round(g / n);
      out.data[d + 2] = Math.round(b / n);
      out.data[d + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** 由 albedo 亮度做 Sobel 推导切线空间法线。 */
function normalFromAlbedo(png: PNG): PNG {
  const { width, height, data } = png;
  const lum = (x: number, y: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    const i = (cy * width + cx) * 4;
    return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  };
  const out = new PNG({ width, height });
  const strength = 2.2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx =
        lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1) -
        (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const dy =
        lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1) -
        (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const d = (y * width + x) * 4;
      out.data[d] = Math.round((nx * 0.5 + 0.5) * 255);
      out.data[d + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out.data[d + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out.data[d + 3] = 255;
    }
  }
  return out;
}

function processEntry(entry: Entry): string[] {
  const written: string[] = [];
  const srcPath = abs(entry.src);
  let png: PNG = PNG.sync.read(readFileSync(srcPath));
  png = cropBottom(png, entry.cropBottomPct);
  if (entry.key) {
    const black = entry.key === 'black';
    const bg = keyBackground(png, entry.keyTolerance ?? KEY_TOLERANCE[entry.key], black);
    applyAlpha(png, bg, !black);
    png = trimAlpha(png);
  } else {
    png = centerCropSquare(png);
  }
  png = fitSquare(png, entry.size);

  const outPath = abs(entry.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, PNG.sync.write(png));
  written.push(entry.out);

  if (entry.normal) {
    const normalPath = outPath.replace(/\.png$/, '-normal.png');
    writeFileSync(normalPath, PNG.sync.write(normalFromAlbedo(png)));
    written.push(normalPath.replace(ROOT + '/', '').replace(ROOT + '\\', ''));
  }
  return written;
}

function main(): void {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  const lock: Record<string, string> = existsSync(LOCK_PATH)
    ? (JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as Record<string, string>)
    : {};

  for (const entry of manifest.entries) {
    const hash = createHash('sha256')
      .update(String(PIPELINE_VERSION))
      .update(readFileSync(abs(entry.src)))
      .update(JSON.stringify(entry))
      .digest('hex');
    const normalPath = abs(entry.out).replace(/\.png$/, '-normal.png');
    const done =
      lock[entry.out] === hash && existsSync(abs(entry.out)) &&
      (!entry.normal || existsSync(normalPath));
    if (done) {
      console.log(`skip  ${entry.out}`);
      continue;
    }
    const written = processEntry(entry);
    lock[entry.out] = hash;
    console.log(`write ${written.join(', ')}`);
  }

  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
}

main();
