# 石板 albedo（floor-albedo）

- 产物：`src/assets/art/floor-albedo.png`（+ `-normal.png` 由管线 Sobel 推导）
- 原图：`docs/visuals/sources/floor-albedo-raw.png`
- manifest：`key: null`（不抠背）、`cropBottomPct: 6`（裁水印）、`size: 512`、`normal: true`
- 管线注意：不抠背的素材走**居中裁方**满幅处理，保证世界坐标平铺时接缝不落在格心。

## ImageGen prompt

> Top-down orthographic texture of a warm sandstone flagstone floor for a dark-fantasy
> hex-grid dungeon game. Irregular polygonal stone slabs in tan, ochre and dusty brown,
> separated by thin darker mortar seams. Even, flat lighting with no cast shadows and no
> vignette, so the tile can repeat seamlessly. Fine grain and shallow cracks on each slab.
> The pattern fills the entire frame edge to edge with no border, no margin, no background,
> no text, no watermark inside the image area. Painterly hand-illustrated game-texture style,
> muted warm palette.

## 复现要点

- 必须「无边界、无留白」：留白会在平铺接缝处变成亮/黑条。
- 必须「无投影、无暗角」：光照由片元 shader 的两项模型负责，原图自带光会叠出双光源。
- 法线不单独生成，由 albedo 亮度 Sobel 推导，保证凹凸与颜色严格对齐。
