# Sample Atlas

A vertical (1080 × 1920) live display of the clinical-genomics pipeline.
Clinical samples are grouped by OncoTree code in a radial hierarchy:
tissue sites near the center, subtypes toward the edge. Pipeline events
replay as animated pulses, and a spotlight sweeps each cancer site with
its processing-lab mix.

**Status:** prototype, running on synthetic pipeline events.

## What's on screen

| Element | Meaning |
|---|---|
| Circle size | clinical samples in that OncoTree type (subtree total) |
| Gold pulse + particle from center | new clinical sample created (Epic / XML file ingested); the total ticks up |
| Cyan pulse | file activity: landed, QC, or ingested |
| Outer bars | samples coded directly to each subtype (log scale) |
| Gold wedge / "Now in focus" | rotating spotlight, one cancer site every ~5.6 s |
| Ticker | the most recent events in the loop |

## Repo layout

```
index.html                 built page (self-contained except d3 from jsDelivr)
src/index_template.html    design + code; data gets injected at /*__BUNDLE__*/
tools/build_site.py        prepared_data -> index.html (standard library only)
```

## Updating the data

When the team sends a new raw CSV:

```bash
python3 ../build_daniela_db.py      # raw CSV -> ../prepared_data
python3 tools/build_site.py         # prepared_data -> index.html
```

`--every N` on `build_site.py` sets how many replay events go into the
animation loop (default 1 in 48, about 5,000 events / ~12 minutes).

## Publishing on GitHub Pages

```bash
git init && git add . && git commit -m "Sample Atlas prototype"
git branch -M main
git remote add origin https://github.com/<your-user>/sample-atlas.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Deploy from a branch → main / (root)**.
The page will be at `https://<your-user>.github.io/sample-atlas/`.

On the TV, open that URL full-screen in a browser (kiosk mode). The stage
scales to fit any portrait screen; it also previews on a laptop.

## Design notes

- Fonts: Rajdhani (display), IBM Plex Mono (figures), IBM Plex Sans (text), via Google Fonts.
- Vendor colors use a validated categorical palette (all colorblind and contrast checks pass on the dark surface); every vendor color is also labeled.
- Respects `prefers-reduced-motion` (slower loop, no particles).
