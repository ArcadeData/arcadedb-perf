# arcadedb-perf

Continuous performance results for [ArcadeDB](https://github.com/ArcadeData/arcadedb): the raw result files and a static
dashboard (GitHub Pages, Apache ECharts).

## What is measured

Every night (scale `M`, 5 repetitions after 2 warm-ups) and on each release (scale `L`), the same commit is measured twice:
as the JVM image and as the native image.

| Workload | What it covers | Main metrics |
|---|---|---|
| `ingestion` | bulk import, transactional insert at 1/N threads | `records_per_s`, `total_s` |
| `graph-oltp` | Cypher and SQL point lookups, 1-3 hop traversals, MATCH patterns | `queries_per_s`, latency percentiles |
| `vector` | k-NN search with the recall of the result | `queries_per_s`, `recall_at_10` |
| `fulltext` | full-text and hybrid search | `queries_per_s` |
| `facet` | faceted counts, facet lag | `queries_per_s`, `facet_lag_ms` |
| `graph-analytics` | LDBC Graphalytics (PR, WCC, BFS, LCC, CDLP, SSSP). JVM only: Graphalytics runs embedded | `processing_s` |

Every metric carries a unit and a direction (higher or lower is better). Peak RSS and on-disk size are recorded as well.
A case that fails is kept as data: it shows as a red marker on the charts and the line is never interpolated across it.
Different machines never share a line.

## The machine

Results come from `perf-01`: bare metal, Ubuntu 24.04 LTS, Intel Core i5-13500 (6 P-cores, 8 E-cores), 62 GB RAM, NVMe
RAID. The server under test is pinned to the P-core threads, the benchmark client to the E-cores, the CPU governor is set
to `performance` and turbo is off during a run. The exact values of each run are stored in its `machine` and `config`
fields. The machine does nothing else while a run is going.

## Rerun locally

Build or download the bench CLI from the ArcadeDB repository, then:

```
java -jar arcadedb-bench-<ver>-cli.jar run --workload all --scale S --image jvm --out ./out
java -jar arcadedb-bench-<ver>-cli.jar list
```

A laptop run is valid data but is a different machine: its numbers must not be compared with `perf-01`.

## Layout

- `data/<yyyy>/<mm>/<run-id>.json`: the raw result files, unchanged. **This is the source of truth.** The charts are
  derived from it and can be rebuilt from it.
- `site/`: the static dashboard (`index.html`, `workload.html?w=<workload>`, `app.js`, `style.css`). No build step.
- `site/series/`, `site/index.json`, `site/latest.json`: written and committed by the nightly export (publish step of the
  private infra repo), deployed by Pages. Not edited by hand.
- `site/fixtures/`: hand-built sample data in the exact export format, for developing the dashboard. Synthetic numbers.
  Regenerate with `tools/gen_fixtures.py`. It is deployed with the site but nothing links to it.
- `data/2026/11/<run-id>.json`: a sample raw file that the fixture tooltips point at. It is not a real result.

## Develop the dashboard

```
./serve-fixtures.sh          # http://localhost:8000, serves a git-ignored copy in site-preview/ with the fixtures
python3 tools/check_site.py  # every file referenced by index.json exists and parses
node --check site/app.js
```

ECharts 5.5.0 is loaded from cdnjs with a subresource integrity hash and a Content-Security-Policy that allows scripts from
this origin and cdnjs only.

## Owed

- Step 5: after the first real nightly, open the Pages URL and check the latest point's commit against the native image's
  `org.opencontainers.image.revision` label from that night.
- Enable GitHub Pages (source: GitHub Actions) when the repo is created.
- ECharts 5.5.1 is not on cdnjs (the path 404s and the API lists no files). The pages load 5.5.0 with its SRI hash.
  Move to 5.6.0 or newer and recompute the hash when wanted.
