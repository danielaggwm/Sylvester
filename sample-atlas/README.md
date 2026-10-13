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
| Circle size | patient samples in that cancer type (OncoTree type and everything under it) |
| Rings | inner ring = body site where the cancer starts (e.g. Lung); further out = more specific diagnoses (e.g. Lung Adenocarcinoma) |
| Outer bars | one per specific diagnosis; length = samples coded to it (log scale); flickers when an event reaches it |
| Gold spark | a new patient sample (Epic / XML ingested) travels from the center to its cancer type; the total goes up on arrival |
| Blue ripple | a file update for an existing sample: received, quality-checked, or loaded |
| Gold wedge / "Now in focus" | rotating spotlight, one body site every ~5.6 s, with its lab mix and largest diagnoses |
| Pipeline time | the date/time (ET) of the event being shown, with a progress bar through the loop |

## Timing modes

Both modes play the same ~5,000 events in the same order over a 30-minute loop.

- **Even pace** (default): one event every ~0.35 s, so each is easy to follow.
- **Real timing**: keeps the real gaps between events (≈2.7 years compressed into 30 minutes, about 2 s per day). Overnight batches show up as bursts; quiet hours and weekends go still.

Hover the ⓘ next to each button for the same explanation on screen.

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
