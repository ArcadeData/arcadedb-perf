#!/usr/bin/env python3
"""Regenerates site/fixtures/ in the exact format of the bench Exporter (index.json, latest.json, series/**).

The numbers are synthetic and deterministic. They exist only so the dashboard can be developed and checked without a
results server. Real data never goes through this script.
"""
import json
import os
import random
import shutil
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "site", "fixtures")
RAW = os.path.join(ROOT, "data")
MACHINE = "perf-01"
DAYS = 24
START = datetime(2026, 10, 25, 3, 0, 0, tzinfo=timezone.utc)
TAGS = {6: "26.10.1", 16: "26.11.1"}  # day index -> release tag
FAILED_DAY = 12

# (workload, case, scale, metric, unit, better, base value, variants, failing)
S = [
    ("ingestion", "bulk-import", "M", "records_per_s", "records/s", "higher", 180000, ["jvm", "native"], True),
    ("ingestion", "bulk-import", "M", "total_s", "s", "lower", 55, ["jvm", "native"], True),
    ("ingestion", "tx-insert-8t", "M", "records_per_s", "records/s", "higher", 62000, ["jvm", "native"], False),
    ("graph-oltp", "point-lookup", "M", "queries_per_s", "queries/s", "higher", 41000, ["jvm", "native"], False),
    ("graph-oltp", "two-hop", "M", "queries_per_s", "queries/s", "higher", 9200, ["jvm", "native"], False),
    ("graph-oltp", "two-hop", "M", "p95_ms", "ms", "lower", 6.4, ["jvm", "native"], False),
    ("vector", "knn-k10", "M", "queries_per_s", "queries/s", "higher", 1450, ["jvm", "native"], False),
    ("vector", "knn-k10", "M", "recall_at_10", "ratio", "higher", 0.962, ["jvm", "native"], False),
    ("vector", "knn-k100", "M", "queries_per_s", "queries/s", "higher", 610, ["jvm", "native"], False),
    ("fulltext", "bm25-search", "M", "queries_per_s", "queries/s", "higher", 7800, ["jvm", "native"], False),
    ("fulltext", "hybrid-search", "M", "queries_per_s", "queries/s", "higher", 930, ["jvm", "native"], False),
    ("facet", "facet-count", "M", "queries_per_s", "queries/s", "higher", 2600, ["jvm", "native"], False),
    ("facet", "facet-count", "M", "facet_lag_ms", "ms", "lower", 120, ["jvm", "native"], False),
    ("graph-analytics", "pagerank", "M", "processing_s", "s", "lower", 8.4, ["jvm"], False),
    ("graph-analytics", "wcc", "M", "processing_s", "s", "lower", 3.1, ["jvm"], False),
]
# a case that never produced a metric: only the _status pseudo-metric exists
STATUS_ONLY = ("graph-oltp", "match-pattern", "M", ["jvm"])


def commit_of(day):
    return "%07x%03x" % (0x1e1ad51 + day * 0x9137, day * 7 + 11)


def run_id(day, variant):
    t = START + timedelta(days=day)
    return "%s-%s-%s" % (t.strftime("%Y-%m-%dT%H-%M-%SZ"), commit_of(day), variant)


def stamp(day, variant):
    # native is measured a little after jvm at the same commit
    return (START + timedelta(days=day, minutes=95 if variant == "native" else 0)).strftime("%Y-%m-%dT%H:%M:%SZ")


def point(day, variant, median, status="ok"):
    return {"t": stamp(day, variant), "commit": commit_of(day), "tag": TAGS.get(day), "median": median,
            "status": status, "runId": run_id(day, variant)}


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=False)
        f.write("\n")


def sanitize(s, keep_case=False):
    r = "".join(c if c.isalnum() and c.isascii() or c in "-_" else "_" for c in s)
    return r if keep_case else r.lower()


def latest_entry(w, c, s, m, machine, variant, pts):
    n = len(pts)
    prev_rel = next((pts[i] for i in range(n - 2, -1, -1) if pts[i]["tag"]), None)
    return {"workload": w, "case": c, "scale": s, "metric": m, "machineId": machine, "variant": variant,
            "last": pts[-1], "previous": pts[-2] if n > 1 else None, "previousRelease": prev_rel}


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    rnd = random.Random(42)
    index = {}
    latest = []
    for (w, c, s, m, unit, better, base, variants, failing) in S:
        lines = []
        for v in variants:
            factor = 1.0 if v == "jvm" else (0.93 if better == "higher" else 1.08)
            if w == "ingestion" and v == "native":
                factor = 1.05 if better == "higher" else 0.95
            pts = []
            val = base * factor
            for d in range(DAYS):
                trend = 1.0 + (0.006 if better == "higher" else -0.006)
                val *= trend + rnd.uniform(-0.018, 0.018)
                if m == "recall_at_10":
                    val = min(val, 0.995)
                if failing and v == "jvm" and d == FAILED_DAY:
                    pts.append(point(d, v, None, "failed"))
                else:
                    pts.append(point(d, v, round(val, 4 if val < 10 else 1)))
            lines.append({"machineId": MACHINE, "variant": v, "points": pts})
            latest.append(latest_entry(w, c, s, m, MACHINE, v, pts))
        fname = "series/%s/%s__%s__%s.json" % (sanitize(w), sanitize(c), sanitize(s, True), sanitize(m))
        write(os.path.join(OUT, fname), {"metric": m, "unit": unit, "better": better, "lines": lines})
        cases = index.setdefault(w, {})
        cs = cases.setdefault((c, s), {"case": c, "scale": s, "metrics": []})
        cs["metrics"].append({"metric": m, "unit": unit, "better": better, "file": fname})

    w, c, s, variants = STATUS_ONLY
    lines = []
    for v in variants:
        pts = [point(d, v, None, "timeout") for d in (FAILED_DAY, FAILED_DAY + 1, DAYS - 1)]
        lines.append({"machineId": MACHINE, "variant": v, "points": pts})
        latest.append(latest_entry(w, c, s, "_status", MACHINE, v, pts))
    fname = "series/%s/%s__%s___status.json" % (sanitize(w), sanitize(c), s)
    write(os.path.join(OUT, fname), {"metric": "_status", "unit": None, "better": None, "lines": lines})
    index[w].setdefault((c, s), {"case": c, "scale": s, "metrics": []})["metrics"].append(
        {"metric": "_status", "unit": None, "better": None, "file": fname})

    gen = (START + timedelta(days=DAYS - 1, hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    write(os.path.join(OUT, "index.json"), {"generatedAt": gen, "workloads": [
        {"workload": w, "cases": list(cs.values())} for w, cs in sorted(index.items())]})
    write(os.path.join(OUT, "latest.json"), {"generatedAt": gen, "series": latest})

    # one raw result file, the target of the tooltip link for the newest ingestion jvm point
    rid = run_id(DAYS - 1, "jvm")
    raw_median = next(e["last"]["median"] for e in latest if e["workload"] == "ingestion" and e["case"] == "bulk-import"
                      and e["metric"] == "records_per_s" and e["variant"] == "jvm")
    write(os.path.join(RAW, "2026", "11", rid + ".json"), {
        "runId": rid, "source": "bench", "trigger": "nightly",
        "arcadedb": {"commit": commit_of(DAYS - 1), "variant": "jvm", "tag": None},
        "machine": {"id": MACHINE, "cpu": "Intel Core i5-13500", "memGb": 62},
        "results": [{"workload": "ingestion", "case": "bulk-import", "scale": "M", "status": "ok",
                     "metrics": [{"name": "records_per_s", "unit": "records/s", "better": "higher", "median": raw_median}]}],
    })


if __name__ == "__main__":
    main()
