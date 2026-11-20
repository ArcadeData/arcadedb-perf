/*
 * ArcadeDB performance dashboard. Plain JS, no build step. Reads index.json, latest.json and series/** relative to this
 * page (the exporter output) and draws them with Apache ECharts. Everything user-visible goes in through textContent,
 * DOM nodes or ECharts options, never innerHTML.
 */
(function () {
  'use strict';

  var PRIMARY = ['records_per_s', 'queries_per_s', 'processing_s', 'recall_at_10'];
  var COMMIT_URL = 'https://github.com/ArcadeData/arcadedb/commit/';
  // Raw result files live in the repo, not on Pages; the local preview serves them from a relative data/ folder.
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  var RAW_BASE = LOCAL ? 'data/' : 'https://github.com/ArcadeData/arcadedb-perf/blob/main/data/';
  var JVM_ONLY_NOTE = 'JVM only: Graphalytics runs embedded';
  var JVM_ONLY = { 'graph-analytics': true };

  var charts = [];
  var redraws = [];

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function getJson(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
      return r.json();
    });
  }

  function setStatus(text, isError) {
    var s = document.getElementById('status');
    if (!s) return;
    s.textContent = text;
    s.hidden = !text;
    s.className = isError ? 'status error' : 'status';
  }

  function safeSeriesPath(file) {
    return typeof file === 'string' && /^series\/[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-]+\.json$/.test(file) ? file : null;
  }

  function fmt(v, unit) {
    if (v === null || v === undefined || isNaN(v)) return 'n/a';
    var n = Number(Number(v).toPrecision(4)).toLocaleString('en-US');
    return unit ? n + ' ' + unit : n;
  }

  function variantColor(v) {
    return css('--' + v) || css('--muted');
  }

  function sortedVariants(a, b) {
    var order = { jvm: 0, native: 1 };
    var x = order[a] === undefined ? 2 : order[a];
    var y = order[b] === undefined ? 2 : order[b];
    return x - y || (a < b ? -1 : a > b ? 1 : 0);
  }

  function lineLabel(line, multiMachine) {
    return multiMachine ? line.machineId + ' / ' + line.variant : line.variant;
  }

  function dayMs(p) {
    return Date.parse(p.t);
  }

  // an ISO instant cut to the minute, in UTC: 2026-10-28 12:05 UTC
  function isoMinute(iso) {
    var ms = Date.parse(iso);
    return isNaN(ms) ? String(iso) : new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  // ---- percent change against the previous release ----
  function deltaInfo(entry, better) {
    var last = entry.last && entry.last.median;
    var ref = entry.previousRelease && entry.previousRelease.median;
    if (last === null || last === undefined) return { text: 'last run failed', cls: 'bad' };
    if (ref === null || ref === undefined || ref === 0) return { text: 'no release to compare', cls: 'flat' };
    var pct = (last - ref) / Math.abs(ref) * 100;
    var tag = entry.previousRelease.tag || 'release';
    if (Math.abs(pct) < 0.5) return { text: '±0% vs ' + tag, cls: 'flat' };
    var improved = better === 'lower' ? pct < 0 : pct > 0;
    var arrow = pct > 0 ? '▲ +' : '▼ ';
    return { text: arrow + pct.toFixed(1) + '% vs ' + tag, cls: improved ? 'good' : 'bad' };
  }

  // ---- ECharts plumbing ----
  function mount(box, buildOption) {
    var chart = echarts.init(box, null, { renderer: 'canvas' });
    charts.push(chart);
    var draw = function () {
      chart.setOption(buildOption(), true);
    };
    redraws.push(draw);
    draw();
    if (window.ResizeObserver) new ResizeObserver(function () { chart.resize(); }).observe(box);
    return chart;
  }

  window.addEventListener('resize', function () {
    charts.forEach(function (c) { c.resize(); });
  });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { redraws.forEach(function (d) { d(); }); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  // Data of a line as [t, median] items; a failed point is a null, so the line breaks instead of interpolating.
  function lineData(points) {
    return points.map(function (p) {
      var ok = p.median !== null && p.median !== undefined;
      var item = { value: [dayMs(p), ok ? p.median : null], p: p };
      if (p.tag) {
        item.symbol = 'diamond';
        item.symbolSize = 10;
      }
      return item;
    });
  }

  function valueRange(lines) {
    var lo = Infinity, hi = -Infinity;
    lines.forEach(function (l) {
      l.points.forEach(function (p) {
        if (p.median !== null && p.median !== undefined) {
          if (p.median < lo) lo = p.median;
          if (p.median > hi) hi = p.median;
        }
      });
    });
    if (lo === Infinity) return { min: 0, max: 1 };
    var pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
    var min = lo - pad;
    if (lo >= 0 && min < 0) min = 0;
    return { min: min, max: hi + pad };
  }

  function tagTimes(lines) {
    var tags = {};
    lines.forEach(function (l) {
      l.points.forEach(function (p) {
        if (p.tag) {
          var t = dayMs(p);
          if (!(p.tag in tags) || t < tags[p.tag]) tags[p.tag] = t;
        }
      });
    });
    return Object.keys(tags).map(function (k) { return { tag: k, t: tags[k] }; });
  }

  function tooltipNode(item, unit, metric) {
    var p = item.p;
    var box = el('div', 'tip');
    var row = function (label, node) {
      var d = el('div');
      d.appendChild(el('span', null, label + ': '));
      d.appendChild(node);
      box.appendChild(d);
    };
    box.appendChild(el('strong', null, item.seriesLabel));
    // t is the date of the measured commit (the X axis); runAt is when it was measured. Older exports have only t.
    box.appendChild(el('div', null, (p.runAt ? 'committed ' : '') + isoMinute(p.t)));
    var failed = p.median === null || p.median === undefined;
    row(metric, el('span', null, failed ? 'no value (' + p.status + ')' : fmt(p.median, unit)));
    if (p.status && p.status !== 'ok' && !failed) row('status', el('span', null, p.status));
    if (p.tag) row('release', el('span', null, p.tag));
    if (typeof p.runAt === 'string' && p.runAt && p.runAt !== p.t) row('measured', el('span', null, isoMinute(p.runAt)));
    if (typeof p.commit === 'string' && /^[0-9a-f]{7,40}$/.test(p.commit)) {
      var a = el('a', null, p.commit);
      a.href = COMMIT_URL + p.commit;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      row('commit', a);
    } else if (p.commit) {
      row('commit', el('span', null, String(p.commit)));
    }
    if (typeof p.benchCommit === 'string' && /^[0-9a-f]{7,40}$/.test(p.benchCommit)) {
      row('bench', el('span', null, p.benchCommit.slice(0, 10)));
    }
    // the raw file sits under the month of its run id (data/YYYY/MM), not of the commit
    var runMonth = typeof p.runId === 'string' ? p.runId : '';
    if (/^[A-Za-z0-9._\-]+$/.test(runMonth) && /^\d{4}-\d{2}/.test(runMonth)) {
      var raw = el('a', null, 'raw JSON');
      raw.href = RAW_BASE + runMonth.slice(0, 4) + '/' + runMonth.slice(5, 7) + '/' + p.runId + '.json';
      raw.target = '_blank';
      raw.rel = 'noopener noreferrer';
      row('data', raw);
    }
    return box;
  }

  function fullOption(series) {
    var lines = series.lines.slice().sort(function (a, b) {
      return a.machineId < b.machineId ? -1 : a.machineId > b.machineId ? 1 : sortedVariants(a.variant, b.variant);
    });
    var machines = {};
    lines.forEach(function (l) { machines[l.machineId] = true; });
    var machineList = Object.keys(machines).sort();
    var multi = machineList.length > 1;
    var range = valueRange(lines);
    var fg = css('--fg'), muted = css('--muted'), grid = css('--grid'), fail = css('--fail');
    var unit = series.unit || '';
    var marks = tagTimes(lines);
    var seriesList = [];
    var legend = [];
    lines.forEach(function (l, i) {
      var label = lineLabel(l, multi);
      var color = variantColor(l.variant);
      legend.push(label);
      var data = lineData(l.points);
      data.forEach(function (d) { d.seriesLabel = label; });
      var s = {
        name: label,
        type: 'line',
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 4,
        data: data,
        color: color,
        lineStyle: { width: 2, color: color, type: machineList.indexOf(l.machineId) > 0 ? 'dashed' : 'solid' },
        itemStyle: { color: color }
      };
      if (i === 0 && marks.length) {
        s.markLine = {
          silent: true,
          symbol: 'none',
          animation: false,
          lineStyle: { color: muted, type: 'dashed', width: 1 },
          label: { show: true, formatter: '{b}', position: 'insideEndTop', color: muted, fontSize: 10, rotate: 90 },
          data: marks.map(function (m) { return { name: m.tag, xAxis: m.t }; })
        };
      }
      seriesList.push(s);
      var failedPts = [];
      l.points.forEach(function (p) {
        if (p.median === null || p.median === undefined) {
          failedPts.push({ value: [dayMs(p), range.min], p: p, seriesLabel: label });
        }
      });
      if (failedPts.length) {
        seriesList.push({
          name: label + ' failed',
          type: 'scatter',
          data: failedPts,
          symbol: 'triangle',
          symbolSize: 12,
          itemStyle: { color: fail },
          z: 5,
          clip: false
        });
      }
    });
    return {
      animation: false,
      textStyle: { color: fg },
      color: lines.map(function (l) { return variantColor(l.variant); }),
      legend: { data: legend, top: 0, textStyle: { color: fg }, icon: 'roundRect' },
      grid: { left: 8, right: 12, top: 34, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        enterable: true,
        confine: true,
        backgroundColor: css('--surface'),
        borderColor: css('--border'),
        textStyle: { color: fg },
        extraCssText: 'max-width:280px;',
        formatter: function (params) {
          return params.data && params.data.p ? tooltipNode(params.data, unit, series.metric) : '';
        }
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: grid } },
        axisLabel: { color: muted, hideOverlap: true },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        min: range.min,
        max: range.max,
        axisLabel: { color: muted, formatter: function (v) { return fmt(v); } },
        splitLine: { lineStyle: { color: grid } }
      },
      series: seriesList
    };
  }

  function sparkOption(series) {
    var lines = series.lines.slice().sort(function (a, b) { return sortedVariants(a.variant, b.variant); });
    var range = valueRange(lines);
    return {
      animation: false,
      grid: { left: 2, right: 2, top: 4, bottom: 4 },
      xAxis: { type: 'time', show: false },
      yAxis: { type: 'value', show: false, min: range.min, max: range.max },
      tooltip: { show: false },
      series: lines.map(function (l) {
        var color = variantColor(l.variant);
        return {
          name: l.variant,
          type: 'line',
          connectNulls: false,
          showSymbol: false,
          silent: true,
          color: color,
          lineStyle: { width: 1.5, color: color },
          data: lineData(l.points).map(function (d) { return { value: d.value }; })
        };
      })
    };
  }

  // ---- index page ----
  function pickMetric(workload, metricName) {
    for (var i = 0; i < workload.cases.length; i++) {
      var c = workload.cases[i];
      for (var j = 0; j < c.metrics.length; j++) {
        if (c.metrics[j].metric === metricName) return { c: c, m: c.metrics[j] };
      }
    }
    return null;
  }

  function renderIndex(index, latest) {
    var cards = document.getElementById('cards');
    index.workloads.forEach(function (w) {
      var card = el('section', 'card');
      var h = el('h2');
      var link = el('a', null, w.workload);
      link.href = 'workload.html?w=' + encodeURIComponent(w.workload);
      h.appendChild(link);
      card.appendChild(h);
      var nCases = w.cases.length;
      card.appendChild(el('p', 'tagline', nCases + (nCases === 1 ? ' case' : ' cases') +
        (JVM_ONLY[w.workload] ? ' - ' + JVM_ONLY_NOTE : '')));
      var shown = 0;
      PRIMARY.forEach(function (name) {
        var pick = pickMetric(w, name);
        var file = pick && safeSeriesPath(pick.m.file);
        if (!file) return;
        shown++;
        var block = el('div', 'metric');
        block.appendChild(el('div', 'mhead', name + ' (' + pick.c.case + ', ' + pick.c.scale + (pick.m.unit ? ', ' + pick.m.unit : '') + ')'));
        var box = el('div', 'spark');
        block.appendChild(box);
        var rows = el('div');
        block.appendChild(rows);
        card.appendChild(block);
        var entries = latest.series.filter(function (e) {
          return e.workload === w.workload && e.case === pick.c.case && e.scale === pick.c.scale && e.metric === name;
        }).sort(function (a, b) { return sortedVariants(a.variant, b.variant); });
        var machines = {};
        entries.forEach(function (e) { machines[e.machineId] = true; });
        var multi = Object.keys(machines).length > 1;
        entries.forEach(function (e) {
          var r = el('div', 'vrow');
          var dot = el('span', 'dot ' + (/^[a-z]+$/.test(e.variant) ? e.variant : ''));
          var lab = el('span', null);
          lab.appendChild(dot);
          lab.appendChild(document.createTextNode(lineLabel(e, multi)));
          r.appendChild(lab);
          r.appendChild(el('span', 'val', fmt(e.last && e.last.median, pick.m.unit)));
          var d = deltaInfo(e, pick.m.better);
          r.appendChild(el('span', 'delta ' + d.cls, d.text));
          rows.appendChild(r);
        });
        getJson(file).then(function (series) {
          mount(box, function () { return sparkOption(series); });
        }).catch(function (err) {
          box.textContent = 'no chart: ' + err.message;
        });
      });
      if (!shown) card.appendChild(el('p', 'tagline', 'No primary metric recorded yet.'));
      cards.appendChild(card);
    });
  }

  // ---- workload page ----
  function metricRank(name) {
    var i = PRIMARY.indexOf(name);
    return i < 0 ? PRIMARY.length : i;
  }

  function renderWorkload(w) {
    var sections = document.getElementById('sections');
    w.cases.forEach(function (c) {
      sections.appendChild(el('h2', null, c.case + ' - scale ' + c.scale));
      var grid = el('div', 'charts');
      sections.appendChild(grid);
      c.metrics.slice().sort(function (a, b) {
        return metricRank(a.metric) - metricRank(b.metric) || (a.metric < b.metric ? -1 : 1);
      }).forEach(function (m) {
        var file = safeSeriesPath(m.file);
        var box = el('div', 'chart-box');
        var title = m.metric === '_status' ? 'status (runs without a measurement)' : m.metric;
        box.appendChild(el('h3', null, title));
        var meta = [];
        if (m.unit) meta.push(m.unit);
        if (m.better) meta.push(m.better + ' is better');
        box.appendChild(el('p', 'meta', meta.join(' - ') || ' '));
        var plot = el('div', 'chart');
        box.appendChild(plot);
        grid.appendChild(box);
        if (!file) {
          plot.textContent = 'invalid series path';
          return;
        }
        getJson(file).then(function (series) {
          mount(plot, function () { return fullOption(series); });
        }).catch(function (err) {
          plot.textContent = 'no chart: ' + err.message;
        });
      });
    });
  }

  // ---- boot ----
  function boot() {
    var page = document.body.getAttribute('data-page');
    Promise.all([getJson('index.json'), getJson('latest.json')]).then(function (res) {
      var index = res[0], latest = res[1];
      var gen = document.getElementById('generated');
      if (gen && index.generatedAt) gen.textContent = 'Data generated ' + index.generatedAt;
      if (!Array.isArray(index.workloads)) throw new Error('index.json has no workloads');
      if (page === 'index') {
        setStatus(index.workloads.length ? '' : 'No results yet.');
        renderIndex(index, latest);
        return;
      }
      var wanted = new URLSearchParams(window.location.search).get('w');
      var w = index.workloads.filter(function (x) { return x.workload === wanted; })[0];
      if (!w) {
        document.getElementById('title').textContent = 'Unknown workload';
        var known = index.workloads.map(function (x) { return x.workload; }).join(', ');
        setStatus('No workload named "' + (wanted === null ? '' : wanted.slice(0, 60)) + '". Known: ' + known, true);
        return;
      }
      document.title = 'ArcadeDB Performance - ' + w.workload;
      document.getElementById('title').textContent = w.workload;
      if (JVM_ONLY[w.workload]) {
        var note = document.getElementById('note');
        note.textContent = JVM_ONLY_NOTE;
        note.hidden = false;
      }
      setStatus('');
      renderWorkload(w);
    }).catch(function (err) {
      setStatus('Cannot load results: ' + err.message, true);
    });
  }

  boot();
})();
