# arcadedb-perf

Continuous performance results for [ArcadeDB](https://github.com/ArcadeData/arcadedb): the raw result files and a static
dashboard (GitHub Pages, Apache ECharts).

## What is measured

Every night (scale `M`) and on each release (scale `M`, then scale `L`), the same commit is measured twice: as the JVM
image and as the native image. Each case runs 2 warm-ups and then 5 repetitions; a chart point is the median of the 5. See
[Scales](#scales) for what `M` and `L` mean.

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

The X axis is the date of the measured commit, not the day it was measured: a release benchmarked today sits at the date of
its code, between the nightlies of the commits around it. The tooltip shows both dates. Runs recorded before 2026-11-21
were dated afterwards, from the GitHub API.

## Scales

A scale is the size of the data set every workload generates before it measures. The data is synthetic and deterministic
(a fixed seed): two runs at the same scale load exactly the same records. Only runs at the same scale share a chart line,
so each section of a workload page names its scale.

| Scale | Used by | Typical length (both variants) |
|---|---|---|
| `XS` | the bench's own tests and quick local checks, never published | minutes |
| `S` | local runs and dry runs of the runner | about 1 hour |
| `M` | the nightly, and each release (so the nightly lines get a release point) | about 3 hours |
| `L` | each release only: the release benchmark | several hours |

What each workload loads at each scale:

| Workload | What the scale sets | `XS` | `S` | `M` | `L` |
|---|---|---:|---:|---:|---:|
| `ingestion` | rows imported (`bulk-import-csv`) and inserted (`tx-insert-1t`, `tx-insert-8t`) | 10 k | 200 k | 2 M | 10 M |
| `graph-oltp` | users | 1 k | 20 k | 200 k | 1 M |
| | friendships (edges between users), plus 1 photo and 5 likes per user | 5 k | 200 k | 2 M | 10 M |
| `vector` | 128-dimension vectors, cosine similarity | 2 k | 20 k | 200 k | 1 M |
| | k=10 queries per repetition, checked against an exact brute-force answer | 50 | 200 | 1 k | 1 k |
| `fulltext` | documents of 200 words, each with a 128-dimension embedding for `hybrid` | 2 k | 50 k | 500 k | 2 M |
| `facet` | records | 10 k | 200 k | 2 M | 10 M |
| `graph-analytics` | not scaled: always the LDBC Graphalytics graph `datagen-7_5-fb` (34 M edges), shown as its scale | | | | |

Fixed at every scale:

- **Queries per repetition**: 1,000 for `graph-oltp` and `fulltext`, 200 for `facet`, and the `vector` row above.
- **Vectors** are drawn like real embeddings: 64 clusters in a 16-dimension latent space projected into 128 dimensions,
  with a little noise. Queries come from the same space and run with the engine's default search settings, so the
  `vector` charts show what a user gets out of the box. A `knn-k10` case whose `recall_at_10` falls under 0.9 is
  recorded as failed, with its numbers, so a fast but wrong index never looks like an improvement.
- **The server under test**: one container per variant, limited to 16 GB of memory with an 8 GB heap, pinned to the
  P-cores (see [The machine](#the-machine)). A case that runs longer than 30 minutes is recorded as timed out.

The sizes are defined in the bench sources of the ArcadeDB repository (`bench/src/main/java/com/arcadedb/bench/workload/`,
one `*Workload` class per workload); each result file records the bench commit that produced it (`config.benchCommit`).
A change of size or of data shape keeps the same chart line, but the points before and after it are not comparable: the
tooltip of every point shows its bench commit. The vector data changed on 2026-11-20 (uniform vectors before, embedding-like
after, ArcadeData/arcadedb#12614).

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
