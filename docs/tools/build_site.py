#!/usr/bin/env python3
"""
build_site.py — rebuild the Sample Atlas page (index.html) from the
"Daniela Database" (the prepared_data folder made by build_daniela_db.py).

The page replays the most recent N days of the pipeline log. Every event
in that window plays (no sampling). Circles, bars and the sample counter
start at the state *before* the window and grow by one for each sample
that arrives during it, ending exactly at today's totals.

When does a sample "arrive"? At its "sample created" event (its XML /
Epic file is ingested). Samples that never get one in the log arrive at
their first file event instead (open question for the pipeline team).

USAGE (from the docs/ folder):
    python3 tools/build_site.py
    python3 tools/build_site.py --days 30 --loop-min 30

    --data      folder with viz_tree_counts.json, viz_meta.json,
                viz_category_summary.csv, viz_events_replay.csv
                (default: ../prepared_data)
    --days      replay window: the last N days of the log (default 30)
    --loop-min  minutes the window takes to play once on screen (default 30)

Full refresh when new raw data arrives:
    python3 ../build_daniela_db.py      # raw CSV -> ../prepared_data
    python3 tools/build_site.py         # prepared_data -> index.html
Standard library only.
"""
import argparse, csv, json, os, sys
from collections import Counter
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def parse_ts(s):
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    d = datetime.fromisoformat(s.replace(" ", "T"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def iso(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build(data_dir, days, loop_min):
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

    # pass 1: read the (time-sorted) log; find each sample's arrival event
    rows = []
    first_idx, created_idx, sample_code = {}, {}, {}
    with open(os.path.join(data_dir, "viz_events_replay.csv"), newline="", encoding="utf-8") as fh:
        for i, row in enumerate(csv.DictReader(fh)):
            s = row["clinical_sample_id"]
            rows.append((parse_ts(row["timestamp"]), row["oncotree_code"], vidx.get(row["vendor_name"], 0), s))
            if s not in first_idx:
                first_idx[s] = i
                sample_code[s] = row["oncotree_code"]
            if row["event_role"] == "sample_created" and s not in created_idx:
                created_idx[s] = i
    if not rows:
        sys.exit("ERROR: the replay file has no events")
    arrival = {s: created_idx.get(s, first_idx[s]) for s in first_idx}
    arrival_events = set(arrival.values())

    # replay window = last N days of the log
    t_end = rows[-1][0]
    t_start = max(rows[0][0], t_end - timedelta(days=days))
    w0 = next(i for i, r in enumerate(rows) if r[0] >= t_start)
    span = (t_end - t_start).total_seconds() or 1.0

    # starting state: samples that arrived before the window, per oncotree code
    base = Counter(sample_code[s] for s, i in arrival.items() if i < w0)

    events = []
    for i in range(w0, len(rows)):
        ts, code, v, s = rows[i]
        events.append([code, 1 if i in arrival_events else 0, v,
                       round((ts - t_start).total_seconds() / span, 6)])

    n_new = sum(e[1] for e in events)
    no_xml = sum(1 for s in first_idx if s not in created_idx)
    bundle = {
        "meta": {"totalSamples": meta["totals"]["samples"], "totalEvents": meta["totals"]["events"],
                 "totalFiles": meta["totals"]["files"], "codesUsed": meta["totals"]["oncotree_codes_used"],
                 "nCategories": meta["totals"]["level1_categories"],
                 "baseSamples": sum(base.values()), "newInWindow": n_new,
                 "eventsInWindow": len(events), "windowDays": round(span / 86400, 1),
                 "loopMin": loop_min, "samplesWithoutXml": no_xml,
                 "tStart": iso(t_start), "tEnd": iso(t_end),
                 "dateStart": iso(t_start)[:10], "dateEnd": iso(t_end)[:10]},
        "vendors": vendors, "vendorTotals": meta["vendors"],
        "tree": tree, "categories": cats, "events": events, "base": dict(base),
    }
    if bundle["meta"]["baseSamples"] + n_new != bundle["meta"]["totalSamples"]:
        print("WARNING: start + new samples does not equal the total; check the log.")

    tpl_path = os.path.join(REPO, "src", "index_template.html")
    tpl = open(tpl_path, encoding="utf-8").read()
    if "/*__BUNDLE__*/" not in tpl:
        sys.exit("ERROR: template is missing the /*__BUNDLE__*/ marker")
    out = tpl.replace("/*__BUNDLE__*/", json.dumps(bundle, separators=(",", ":")))
    out_path = os.path.join(REPO, "index.html")
    open(out_path, "w", encoding="utf-8").write(out)
    m = bundle["meta"]
    print(f"Built {out_path}  ({len(out):,} bytes)")
    print(f"  window {m['dateStart']} -> {m['dateEnd']} ({m['windowDays']} days) in a {loop_min}-min loop")
    print(f"  events={m['eventsInWindow']:,}  samples: start {m['baseSamples']:,} + new {n_new:,} = {m['baseSamples'] + n_new:,} "
          f"(total {m['totalSamples']:,})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Rebuild Sample Atlas index.html from prepared_data.")
    ap.add_argument("--data", default=os.path.join(REPO, "..", "prepared_data"))
    ap.add_argument("--days", type=float, default=30)
    ap.add_argument("--loop-min", type=float, default=30)
    a = ap.parse_args()
    build(os.path.abspath(a.data), max(0.5, a.days), max(1.0, a.loop_min))
