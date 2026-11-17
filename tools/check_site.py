#!/usr/bin/env python3
"""Mechanical check of the dashboard inputs: every file index.json references exists, parses and has the Exporter shape,
and latest.json lines point at series that exist. Usage: check_site.py [dir]  (default: site/fixtures)."""
import json
import os
import re
import sys

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site", "fixtures")
errors = []


def load(rel):
    try:
        with open(os.path.join(root, rel)) as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        errors.append("%s: %s" % (rel, e))
        return None


index = load("index.json")
latest = load("latest.json")
known = set()
n_files = 0
workloads = []
if index:
    for w in index["workloads"]:
        workloads.append(w["workload"])
        for c in w["cases"]:
            for m in c["metrics"]:
                n_files += 1
                known.add((w["workload"], c["case"], c["scale"], m["metric"]))
                s = load(m["file"])
                if not s:
                    continue
                if s["metric"] != m["metric"]:
                    errors.append("%s: metric %s != %s" % (m["file"], s["metric"], m["metric"]))
                for line in s["lines"]:
                    for p in line["points"]:
                        for k in ("t", "commit", "tag", "median", "status", "runId"):
                            if k not in p:
                                errors.append("%s: point lacks %s" % (m["file"], k))
                        if "benchCommit" not in p:
                            errors.append("%s: point lacks benchCommit" % m["file"])
                        elif p["benchCommit"] is not None and not re.fullmatch(r"[0-9a-f]{7,40}", p["benchCommit"]):
                            errors.append("%s: benchCommit %r is not a short or full sha" % (m["file"], p["benchCommit"]))
                        if p["median"] is None and p["status"] == "ok":
                            errors.append("%s: ok point without median" % m["file"])
if latest:
    for e in latest["series"]:
        if (e["workload"], e["case"], e["scale"], e["metric"]) not in known:
            errors.append("latest.json: no series for %s" % ((e["workload"], e["case"], e["scale"], e["metric"]),))
        for k in ("last", "previous", "previousRelease"):
            if k not in e:
                errors.append("latest.json: entry lacks %s" % k)
expected = {"ingestion", "graph-oltp", "vector", "fulltext", "facet", "graph-analytics"}
if index and expected != set(workloads):
    errors.append("workloads %s != %s" % (sorted(workloads), sorted(expected)))
if errors:
    print("FAIL")
    print("\n".join(errors))
    sys.exit(1)
print("OK: %d workloads, %d series files, %d latest lines" % (len(workloads), n_files, len(latest["series"])))
