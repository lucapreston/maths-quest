# Maths Quest reels

Vertical (1080×1920) curiosity-hook reels, built as HTML + three.js and rendered to MP4.

| Reel | Hook |
|---|---|
| `neg-times-neg/` | Why does negative × negative make a positive? |
| `lower-grades/` | Why are your maths grades lower than they should be? |

## Render

```sh
NODE_PATH=$(npm root -g) node render.js neg-times-neg/reel.html neg-times-neg/out.mp4
# stills at chosen times, for checking frames:
NODE_PATH=$(npm root -g) node render.js neg-times-neg/reel.html /tmp/frame 30 2.5,10,20
```

Needs Playwright (Chromium) and ffmpeg. A full reel takes a few minutes.

## Preview live

Serve this folder over HTTP (image textures don't load from `file://`), then open a reel:

```sh
python3 -m http.server -d marketing/reels 8000   # → http://localhost:8000/neg-times-neg/reel.html
```

## Making a new reel

Copy a `reel.html` and change its captions, 3D objects and camera keys. Shared pieces live in `lib/kit.js`:

- `stage({duration, captions})`: scene, particles, captions, progress bar, `ring()` highlights, `camPath()`
- `roundedBox`, `plane` (canvas-textured), `phone`, `mats`
- `mqQuestion` / `mqScript` / `loadBrand`: the app's question screen and the "5 a day" → question → wrong → right phone sequence

`lib/assets/five-a-day.png` is a real app screenshot. `lib/fonts/` has Bricolage Grotesque (OFL), the closest match to the app's type.
