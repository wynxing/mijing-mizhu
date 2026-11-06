# 美术参考资产

本目录存放**外部参考图**，用于对齐美术方向，不作为游戏素材直接分发。

| 文件 | 说明 |
|---|---|
| `reference/hex-dungeon-battler-reference.webp` | 用户提供的同品类参考图（2048×1152，六边形迷宫 + 骰子 + 卡牌）。来源不明，仅作内部参考，已列入 `.gitignore`，不随仓库分发 |

## 值得借鉴的部分

- **地块**：暖砂岩实心六边形石板，带厚度侧壁与板缝，浮在纯黑虚空里
- **光源**：角色提灯是唯一光源，地面亮度自脚下向外衰减；墙只在被照到时才有亮边
- **墙**：立在格边上的竖直板块，顶面受光，而不是贴地的一条线
- **卡牌**：实体纸牌质感，费用角标、稀有度描边、统一线稿风格的插画图标
- **骰子**：木质骰体 + 点数 + 序号

## 使用约定

- 参考图**不得**出现在构建产物或发行包中，只能留在 `docs/`。
- 参考图只用于取色、定比例和定风格。

## 生成素材管线（2026-11-05 起）

ImageGen 已可用。游戏素材（石板 albedo / 法线、角色 sprite）由 ImageGen 生成后经
`scripts/process-art.ts`（`npm run art`）处理进 `src/assets/art/`，只有处理后的成品进构建产物。

- 生成图带「AI生成」水印且**不含 alpha 通道**：管线先裁掉底部水印，再按 manifest 指定的
  底色（品红 chroma，或游魂用的纯黑）做边界 flood-fill 抠背、羽化、去溢色，降采样到 512。
- 角色同批次生成，并以一张风格基准图做 image-to-image reference 锁画风；prompt 归档在
  `prompts/`，不进构建。
- 意图字形、血条、出口记号等小元素仍走程序化 Canvas 纹理，不用 ImageGen。
- manifest 与 lock 见 `scripts/art-manifest.json` / `scripts/art-manifest.lock.json`，未变更的条目跳过重处理。
