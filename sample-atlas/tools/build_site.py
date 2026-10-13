#!/usr/bin/env python3
"""
build_site.py — rebuild the Sample Atlas page (index.html) from the
"Daniela Database" (the prepared_data folder made by build_daniela_db.py).

It reads the prepared files, packs them into a compact data bundle,
and injects that bundle into src/index_template.html -> index.html.

USAGE (from the repo folder):
    python3 tools/build_site.py
    python3 tools/build_site.py --data ../prepared_data --every 48

    --data   folder with viz_tree_counts.json, viz_meta.json,
             viz_category_summary.csv, viz_events_replay.csv
             (default: ../prepared_data, i.e. Sylvester/prepared_data)
    --every  keep 1 of every N replay events for the animation loop
             (default 48 -> ~5,000 events, ~12 minute loop)

Full refresh when new raw data arrives:
    python3 ../build_daniela_db.py      # raw CSV -> prepared_data
    python3 tools/build_site.py         # prepared_data -> index.html
Standard library only.
"""
import argparse, csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def build(data_dir, every):
    need = ["viz_tree_counts.json", "viz_meta.json", "viz_category_summary.csv", "viz_events_replay.csv"]
    for f in need:
        if not os.path.exists(os.path.join(data_dir, f)):
            sys.exit(f"ERROR: missing {f} in {data_dir} (run build_daniela_db.py first)")
    tree = json.load(open(os.path.join(data_dir, "viz_tree_counts.json"), encoding="utf-8"))
    meta = json.load(open(os.path.join(data_dir, "viz_meta.json"), encoding="utf-8"))

    cats = []
    with open(os.path.join(data_dir, "viz_category_summary.csv"), newline="", encoding="utf-8") as fh:
        r = csv.DictReader(fh)
        vcols = [c for c in r.fieldnames if c not in ("root_name", "n_samples", "n_files", "n_events")]
        for row in r:
            cats.append({"root": row["root_name"], "n_samples": int(row["n_samples"]),
                         "n_files": int(row["n_files"]), "n_events": int(row["n_events"]),
                         "vendors": {v: int(row[v]) for v in vcols}})

    vendors = list(meta["vendors"].keys())
    vidx = {v: i for i, v in enumerate(vendors)}
    events = []
    with open(os.path.join(data_dir, "viz_events_replay.csv"), newline="", encoding="utf-8") as fh:
        for i, row in enumerate(csv.DictReader(fh)):
            if i % every:
                continue
            events.append([row["oncotree_code"], 1 if row["event_role"] == "sample_created" else 0,
                           vidx.get(row["vendor_name"], 0)])

    bundle = {
        "meta": {"totalSamples": meta["totals"]["samples"], "totalEvents": meta["totals"]["events"],
                 "totalFiles": meta["totals"]["files"], "codesUsed": meta["totals"]["oncotree_codes_used"],
                 "nCategories": meta["totals"]["level1_categories"],
                 "spanDays": meta["time_range_utc"]["span_days"],
                 "dateStart": meta["time_range_utc"]["start"][:10], "dateEnd": meta["time_range_utc"]["end"][:10]},
        "vendors": vendors, "vendorTotals": meta["vendors"],
        "tree": tree, "categories": cats, "events": events,
    }
    tpl_path = os.path.join(REPO, "src", "index_template.html")
    tpl = open(tpl_path, encoding="utf-8").read()
    if "/*__BUNDLE__*/" not in tpl:
        sys.exit("ERROR: template is missing the /*__BUNDLE__*/ marker")
    out = tpl.replace("/*__BUNDLE__*/", json.dumps(bundle, separators=(",", ":")))
    out_path = os.path.join(REPO, "index.html")
    open(out_path, "w", encoding="utf-8").write(out)
    print(f"Built {out_path}  ({len(out):,} bytes)")
    print(f"  samples={bundle['meta']['totalSamples']:,}  categories={len(cats)}  "
          f"loop events={len(events):,}  (sample_created={sum(e[1] for e in events):,})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Rebuild Sample Atlas index.html from prepared_data.")
    ap.add_argument("--data", default=os.path.join(REPO, "..", "prepared_data"))
    ap.add_argument("--every", type=int, default=48)
    a = ap.parse_args()
    build(os.path.abspath(a.data), max(1, a.every))
