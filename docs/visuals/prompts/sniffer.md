# 嗅犬 sprite（sniffer）

- 产物：`src/assets/art/sniffer.png`
- 原图：`docs/visuals/sources/sniffer-raw.png`
- manifest：`key: auto`（品红 chroma 抠背）、`cropBottomPct: 6`（裁水印）、`size: 512`
- 画风锁定：与 `floor-albedo` 同批次、同一 painterly 手绘风格；后续角色以本图为
  image-to-image reference 锁画风。

## ImageGen prompt

> Single game sprite of a blind dungeon hound ("sniffer") for a dark-fantasy hex-grid
> roguelite, full body, side-three-quarter view, standing pose. Lean muscular dog with
> pale bone-white fur, no eyes, oversized twitching nostrils and tall ears; faint scent
> wisps curling from its snout. Painterly hand-illustrated style matching a warm sandstone
> dungeon texture, muted palette with one cool accent on the scent wisps.
> The creature is centered on a flat solid magenta (#ff00ff) background that fills the whole
> frame; the magenta is a chroma key and must not appear anywhere on the creature itself.
> No ground, no shadow, no border, no text, no watermark inside the image area.

## 复现要点

- 底色必须是**纯品红且主体上不含品红**：管线用全局色匹配抠背，主体沾品红会被吃掉。
- 不画地面与投影：接触阴影由渲染层在脚锚处贴径向渐变 quad，原图自带投影会穿帮。
- 主体四周留足品红边距，便于 flood-fill 与羽化。
