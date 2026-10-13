#!/usr/bin/env python3
"""
build_daniela_db.py
===================================================================
Rebuilds the "Daniela Database" (the prepared data layer for the
clinical-genomics pipeline visualization) from the raw pipeline
events CSV + the OncoTree key.

Run this whenever the team sends a new/updated raw CSV. It regenerates
everything in the prepared_data/ folder:

    viz_nodes.csv            node table + sample counts (node sizes)
    viz_tree_counts.json     nested hierarchy with counts (for d3.hierarchy)
    viz_category_summary.csv level-1 category x vendor counts (stats panel)
    viz_events_replay.csv    time-sorted enriched event stream (+ .gz)
    viz_meta.json            totals, date range, vendors, label maps

INPUTS
    --raw   path to the raw events CSV
            (default: ./pipeline_events_synthetic.csv)
            Expected columns: file_id, file_type, timestamp,
            clinical_sample_id, oncotree_code, action, vendor_name
    --key   OncoTree lookup JSON (code -> {level, parent, path_codes,
            path_names, root_name, name, color, ...})
            (default: ./OncoTree/oncotree_lookup.json)
    --out   output folder (default: ./prepared_data)

USAGE
    # one-off rebuild:
    python3 build_daniela_db.py

    # explicit paths:
    python3 build_daniela_db.py --raw data/events.csv --key OncoTree/oncotree_lookup.json --out prepared_data

    # auto-rebuild whenever the raw CSV changes (poll every 10s; Ctrl+C to stop):
    python3 build_daniela_db.py --watch

No third-party packages required (standard library only).
===================================================================
"""
import argparse, csv, gzip, json, os, sys, time
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))

REQUIRED_COLS = ["file_id", "file_type", "timestamp", "clinical_sample_id",
                 "oncotree_code", "action", "vendor_name"]
FILE_TYPE_RELABEL = {"XML": "Epic data"}
ACTION_LABEL = {"landed": "File landed", "QC": "QC passed", "ingested": "Ingested"}


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def parse_ts(s):
    """ISO 8601 -> aware datetime (handles trailing 'Z')."""
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def load_key(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def node_info(key, code):
    """Ancestry-safe accessor. Unknown codes fall back to being their own root."""
    nd = key.get(code)
    if nd:
        pc = nd.get("path_codes") or [code]
        pn = nd.get("path_names") or [nd.get("name", code)]
        return {
            "name": nd.get("name", code), "level": nd.get("level", None),
            "parent": nd.get("parent", "TISSUE"), "mainType": nd.get("mainType", ""),
            "tissue": nd.get("tissue", ""), "color": nd.get("color", ""),
            "root_code": pc[0], "root_name": nd.get("root_name", pn[0] if pn else ""),
            "path_codes": pc, "path_names": pn,
        }
    # unknown code
    return {"name": code, "level": None, "parent": "TISSUE", "mainType": "",
            "tissue": "", "color": "", "root_code": code, "root_name": "(unknown)",
            "path_codes": [code], "path_names": [code]}


def build(raw_path, key_path, out_dir):
    if not os.path.exists(raw_path):
        sys.exit(f"ERROR: raw CSV not found: {raw_path}")
    if not os.path.exists(key_path):
        sys.exit(f"ERROR: OncoTree key not found: {key_path}")
    os.makedirs(out_dir, exist_ok=True)
    key = load_key(key_path)
    log(f"Loaded OncoTree key: {len(key)} codes")

    # ---- read raw ----
    rows = []
    with open(raw_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in REQUIRED_COLS if c not in reader.fieldnames]
        if missing:
            sys.exit(f"ERROR: raw CSV missing columns: {missing}\n"
                     f"       found: {reader.fieldnames}")
        extra = [c for c in reader.fieldnames if c not in REQUIRED_COLS]
        if extra:
            log(f"Note: extra columns present (ignored for now): {extra}")
        for r in reader:
            r["_ts"] = parse_ts(r["timestamp"])
            rows.append(r)
    log(f"Read {len(rows):,} events")
    rows.sort(key=lambda r: r["_ts"])

    # ---- sample-level facts (one code + vendor per sample) ----
    sample_code, sample_vendor = {}, {}
    multi_code, multi_vendor = set(), set()
    for r in rows:
        sid = r["clinical_sample_id"]
        c, v = r["oncotree_code"], r["vendor_name"]
        if sid in sample_code:
            if sample_code[sid] != c:
                multi_code.add(sid)
            if sample_vendor[sid] != v:
                multi_vendor.add(sid)
        else:
            sample_code[sid], sample_vendor[sid] = c, v
    n_samples = len(sample_code)
    log(f"Samples: {n_samples:,} | files: {len({r['file_id'] for r in rows}):,}")
    if multi_code:
        log(f"WARNING: {len(multi_code)} sample(s) have >1 oncotree code "
            f"(used first seen). e.g. {list(multi_code)[:3]}")
    if multi_vendor:
        log(f"WARNING: {len(multi_vendor)} sample(s) have >1 vendor "
            f"(used first seen). e.g. {list(multi_vendor)[:3]}")

    # ---- validate codes against key ----
    used_codes = set(sample_code.values())
    unknown = sorted(c for c in used_codes if c not in key)
    if unknown:
        log(f"WARNING: {len(unknown)} oncotree code(s) not in the OncoTree key "
            f"-> placed under '(unknown)'. e.g. {unknown[:8]}")
        log("         (regenerate the key, or ask the team which version they use)")
    else:
        log(f"All {len(used_codes)} oncotree codes resolve against the key.")

    # ---- node counts: direct + subtree ----
    direct = defaultdict(int)
    for sid, c in sample_code.items():
        direct[c] += 1
    needed = set()
    for c in direct:
        for a in node_info(key, c)["path_codes"]:
            needed.add(a)
    subtree = defaultdict(int)
    for c, n in direct.items():
        for a in node_info(key, c)["path_codes"]:
            subtree[a] += n

    node_cols = ["code", "name", "level", "parent", "mainType", "tissue", "color",
                 "root_code", "root_name", "path_names",
                 "n_samples_direct", "n_samples_subtree"]
    node_rows = []
    for c in sorted(needed, key=lambda x: (node_info(key, x)["level"] or 99, x)):
        nd = node_info(key, c)
        node_rows.append({
            "code": c, "name": nd["name"], "level": nd["level"] if nd["level"] is not None else "",
            "parent": nd["parent"], "mainType": nd["mainType"], "tissue": nd["tissue"],
            "color": nd["color"], "root_code": nd["root_code"], "root_name": nd["root_name"],
            "path_names": " > ".join(nd["path_names"]),
            "n_samples_direct": direct.get(c, 0), "n_samples_subtree": subtree.get(c, 0),
        })
    _write_csv(os.path.join(out_dir, "viz_nodes.csv"), node_cols, node_rows)

    # ---- nested tree with counts (built from parent pointers) ----
    children_of = defaultdict(list)
    roots = []
    for c in needed:
        p = node_info(key, c)["parent"]
        if p in needed:
            children_of[p].append(c)
        else:
            roots.append(c)  # level-1 (parent TISSUE) or orphan

    def nm(c):
        return node_info(key, c)["name"]

    def build_node(c):
        nd = node_info(key, c)
        out = {"code": c, "name": nd["name"], "level": nd["level"],
               "color": nd["color"], "n_direct": direct.get(c, 0),
               "n_subtree": subtree.get(c, 0)}
        kids = sorted(children_of.get(c, []), key=nm)
        if kids:
            out["children"] = [build_node(k) for k in kids]
        return out

    tree = {"code": "TISSUE", "name": "Tissue", "level": 0, "color": "",
            "n_direct": 0, "n_subtree": n_samples,
            "children": [build_node(c) for c in sorted(roots, key=nm)]}
    with open(os.path.join(out_dir, "viz_tree_counts.json"), "w", encoding="utf-8") as fh:
        json.dump(tree, fh, indent=1)

    # ---- category (level-1) x vendor summary ----
    vendors = sorted({v for v in sample_vendor.values()})
    cat_samples = defaultdict(int)
    cat_vendor = defaultdict(lambda: defaultdict(int))
    for sid, c in sample_code.items():
        root = node_info(key, c)["root_name"]
        cat_samples[root] += 1
        cat_vendor[root][sample_vendor[sid]] += 1
    cat_files = defaultdict(set)
    cat_events = defaultdict(int)
    for r in rows:
        root = node_info(key, r["oncotree_code"])["root_name"]
        cat_files[root].add(r["file_id"])
        cat_events[root] += 1
    cat_cols = ["root_name", "n_samples", "n_files", "n_events"] + vendors
    cat_rows = []
    for root in sorted(cat_samples, key=lambda k: cat_samples[k], reverse=True):
        row = {"root_name": root, "n_samples": cat_samples[root],
               "n_files": len(cat_files[root]), "n_events": cat_events[root]}
        for v in vendors:
            row[v] = cat_vendor[root].get(v, 0)
        cat_rows.append(row)
    _write_csv(os.path.join(out_dir, "viz_category_summary.csv"), cat_cols, cat_rows)

    # ---- replay-ready event stream ----
    t0, t1 = rows[0]["_ts"], rows[-1]["_ts"]
    span = (t1 - t0).total_seconds() or 1.0
    # mark earliest ingested-XML event per sample as sample_created
    created_for = set()
    role = {}
    for i, r in enumerate(rows):
        if (r["file_type"] == "XML" and r["action"] == "ingested"
                and r["clinical_sample_id"] not in created_for):
            created_for.add(r["clinical_sample_id"])
            role[i] = "sample_created"
    rp_cols = ["seq", "timestamp", "t_offset_s", "t_norm", "file_id", "file_type",
               "file_type_label", "clinical_sample_id", "oncotree_code", "root_code",
               "level", "action", "action_label", "event_role", "vendor_name"]
    rp_path = os.path.join(out_dir, "viz_events_replay.csv")
    with open(rp_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(rp_cols)
        for i, r in enumerate(rows):
            nd = node_info(key, r["oncotree_code"])
            off = int((r["_ts"] - t0).total_seconds())
            w.writerow([
                i + 1, r["timestamp"], off, round(off / span, 6),
                r["file_id"], r["file_type"], FILE_TYPE_RELABEL.get(r["file_type"], r["file_type"]),
                r["clinical_sample_id"], r["oncotree_code"], nd["root_code"],
                nd["level"] if nd["level"] is not None else "",
                r["action"], ACTION_LABEL.get(r["action"], r["action"]),
                role.get(i, "file_activity"), r["vendor_name"],
            ])
    # gzip copy
    with open(rp_path, "rb") as f_in, gzip.open(rp_path + ".gz", "wb", compresslevel=9) as f_out:
        f_out.writelines(f_in)

    # ---- meta ----
    vendor_counts = defaultdict(int)
    ftype_counts = defaultdict(int)
    for r in rows:
        vendor_counts[r["vendor_name"]] += 1
        ftype_counts[r["file_type"]] += 1
    samples_with_xml = len({r["clinical_sample_id"] for r in rows if r["file_type"] == "XML"})
    meta = {
        "source_file": os.path.basename(raw_path),
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "oncotree_key": os.path.basename(key_path),
        "totals": {"events": len(rows), "files": len({r["file_id"] for r in rows}),
                   "samples": n_samples, "oncotree_codes_used": len(used_codes),
                   "level1_categories": len(cat_samples),
                   "unknown_codes": len(unknown)},
        "time_range_utc": {"start": str(t0), "end": str(t1), "span_days": round(span / 86400, 1)},
        "avg_events_per_day": round(len(rows) / (span / 86400), 1),
        "actions": ACTION_LABEL,
        "file_types": {"counts": dict(sorted(ftype_counts.items())), "relabel": FILE_TYPE_RELABEL},
        "vendors": dict(sorted(vendor_counts.items(), key=lambda kv: kv[1], reverse=True)),
        "sample_created_events": len(created_for),
        "samples_without_xml": n_samples - samples_with_xml,
        "data_quality": {"samples_multi_oncotree": len(multi_code),
                         "samples_multi_vendor": len(multi_vendor),
                         "unknown_oncotree_codes": unknown[:50]},
        "playback_note": ("t_norm is each event's position in [0,1] across the real timeline. "
                          "For a looped TV replay, map t_norm -> loop_seconds (e.g. 0..600 for a "
                          "10-min loop). Spacing already reflects real inter-event gaps."),
    }
    with open(os.path.join(out_dir, "viz_meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    log(f"Done. Wrote 6 files to {out_dir}")
    log(f"  nodes={len(node_rows)}  categories={len(cat_rows)}  "
        f"replay_rows={len(rows):,}  sample_created={len(created_for):,}")
    return meta


def _write_csv(path, cols, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main():
    ap = argparse.ArgumentParser(description="Rebuild the Daniela Database (prepared viz data).")
    ap.add_argument("--raw", default=os.path.join(HERE, "pipeline_events_synthetic.csv"))
    ap.add_argument("--key", default=os.path.join(HERE, "OncoTree", "oncotree_lookup.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "prepared_data"))
    ap.add_argument("--watch", action="store_true",
                    help="keep running and rebuild whenever the raw CSV changes")
    ap.add_argument("--interval", type=float, default=10.0,
                    help="seconds between checks in --watch mode (default 10)")
    args = ap.parse_args()

    log(f"raw = {args.raw}")
    log(f"key = {args.key}")
    log(f"out = {args.out}")
    build(args.raw, args.key, args.out)

    if args.watch:
        log(f"Watching {args.raw} for changes (every {args.interval}s). Ctrl+C to stop.")
        last = os.path.getmtime(args.raw) if os.path.exists(args.raw) else 0
        try:
            while True:
                time.sleep(args.interval)
                if not os.path.exists(args.raw):
                    continue
                m = os.path.getmtime(args.raw)
                if m != last:
                    last = m
                    log("Change detected -> rebuilding...")
                    try:
                        build(args.raw, args.key, args.out)
                    except Exception as e:
                        log(f"ERROR during rebuild: {e}")
        except KeyboardInterrupt:
            log("Stopped watching.")


if __name__ == "__main__":
    main()
