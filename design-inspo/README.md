# design-inspo

This folder holds visual references used to drive design rounds for the Cafe Kadhem site. Each subfolder is one round: drop in posters, screenshots, photos, type specimens, anything that captures the direction you want.

## Folder convention

```
design-inspo/
  YYYY-MM-DD-short-name/
    image1.jpg
    image2.png
    ...
    README.md         ← describes the brief: mood, references, do's and don'ts
```

The date prefix keeps history sortable; the short name is for you, so you can tell rounds apart at a glance ("warm-mediterranean", "bold-retro-pastiche", etc.).

## How a round works

1. You create a new subfolder, drop in references, and write a short brief in its `README.md` (mood, references, anything that's a hard yes or hard no).
2. Claude reads the folder and generates a handful of static design directions as preview pages under `/admin/design-preview/...`. Each preview renders with a sample event so you can see typography, color, layout, button placement in motion — not just a description.
3. You browse the previews, pick one.
4. Claude does the real restyle on a fresh `design/<chosen-name>` branch, so reverting is a one-click affair if it doesn't land.

## Why commit the images

These images are spec material — same as a design doc. Future rounds may reference earlier ones ("more like the May round, less like the June one"), so keeping the trail in git is useful. If a round's images are very large, prefer compressed formats (`.webp`, optimized `.png`).
