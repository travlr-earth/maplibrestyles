#!/usr/bin/env node
/**
 * apply-fades.js — port step B (canonical admin filters) and step 9
 * (0.25-zoom-step opacity fades) from style-builder to maplibrestyles.
 *
 * This script only touches layer.filter (for admin boundaries) and
 * layer.paint.*-opacity (for minzoom/maxzoom layers). It does NOT touch
 * layer IDs, sources, or any other properties.
 *
 * Usage:
 *   node scripts/apply-fades.js              # apply in place
 *   node scripts/apply-fades.js --dry-run    # report only, no writes
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT       = path.resolve(__dirname, '..');
const STYLES_DIR = path.join(ROOT, 'styles');
const DRY_RUN    = process.argv.includes('--dry-run');

// ─── Step B: canonical admin boundary filters ─────────────────────────────────

const CANONICAL_FILTERS = {
  'admin-0-boundary': ['all',
    ['==', ['get', 'admin_level'], 2],
    ['==', ['get', 'disputed'],   0],
    ['==', ['get', 'maritime'],   0]],
  'admin-1-boundary': ['all',
    ['==', ['get', 'admin_level'], 4],
    ['==', ['get', 'maritime'],   0]],
};

function applyCanonicalFilters(layers) {
  let changed = 0;
  for (const layer of layers) {
    const canon = CANONICAL_FILTERS[layer.id];
    if (canon && layer['source-layer'] === 'boundary') {
      const before = JSON.stringify(layer.filter ?? null);
      const after  = JSON.stringify(canon);
      if (before !== after) {
        layer.filter = JSON.parse(JSON.stringify(canon));
        changed++;
      }
    }
  }
  return changed;
}

// ─── Step 9: opacity fade normalization ──────────────────────────────────────

const OPACITY_KEY = {
  fill:              'fill-opacity',
  line:              'line-opacity',
  circle:            'circle-opacity',
  background:        'background-opacity',
  raster:            'raster-opacity',
  'fill-extrusion':  'fill-extrusion-opacity',
  heatmap:           'heatmap-opacity',
};

function buildEnvelope(mn, mx) {
  if (mn !== undefined && mx !== undefined && mn + 0.5 > mx) {
    const mid = (mn + mx) / 2;
    return ['interpolate', ['linear'], ['zoom'], mn, 0, mid, 1, mx, 0];
  }
  const st = [];
  if (mn !== undefined) st.push(mn, 0, mn + 0.25, 1);
  if (mx !== undefined) st.push(mx - 0.25, 1, mx, 0);
  return ['interpolate', ['linear'], ['zoom'], ...st];
}

function allNumericStops(stops) {
  return stops.every((v, i) => i % 2 === 0 || typeof v === 'number');
}

function normStops(rawStops, mn, mx) {
  // Evaluate original expression at zoom z (linear interpolation).
  function evalAt(z) {
    if (z <= rawStops[0]) return rawStops[1];
    for (let i = 0; i < rawStops.length - 2; i += 2) {
      if (z <= rawStops[i + 2]) {
        const t = (z - rawStops[i]) / (rawStops[i + 2] - rawStops[i]);
        return rawStops[i + 1] + t * (rawStops[i + 3] - rawStops[i + 1]);
      }
    }
    return rawStops[rawStops.length - 1];
  }

  let pairs = [];
  for (let i = 0; i < rawStops.length; i += 2) pairs.push([rawStops[i], rawStops[i + 1]]);

  if (mn !== undefined) {
    const sv = (pairs[0][1] === 0 && pairs.length > 1) ? pairs[1][1] : pairs[0][1];
    pairs = pairs.filter(([z]) => z > mn + 0.25);
    pairs = [[mn, 0], [mn + 0.25, sv], ...pairs];
  }

  if (mx !== undefined) {
    const sv = evalAt(mx - 0.25);
    if (sv > 0) {
      pairs = pairs.filter(([z]) => z < mx - 0.25);
      pairs.push([mx - 0.25, sv], [mx, 0]);
    }
  }

  return pairs.flatMap(([z, v]) => [z, v]);
}

function normalizeOpacity(existing, mn, mx) {
  if (mn === undefined && mx === undefined) return existing;

  if (existing === undefined || existing === null) return buildEnvelope(mn, mx);

  if (typeof existing === 'number') {
    if (existing === 0) return existing; // intentionally invisible
    const st = [];
    if (mn !== undefined) st.push(mn, 0, mn + 0.25, existing);
    if (mx !== undefined) {
      if (mn !== undefined && mn + 0.25 >= mx - 0.25) st.push(mx, 0);
      else st.push(mx - 0.25, existing, mx, 0);
    }
    return ['interpolate', ['linear'], ['zoom'], ...st];
  }

  if (JSON.stringify(existing).includes('"get"')) {
    return ['*', existing, buildEnvelope(mn, mx)];
  }

  if (Array.isArray(existing) && existing[0] === 'interpolate' &&
      existing[1]?.[0] === 'linear' && existing[2]?.[0] === 'zoom') {
    const stops = existing.slice(3);
    if (allNumericStops(stops)) {
      return ['interpolate', ['linear'], ['zoom'], ...normStops(stops, mn, mx)];
    }
  }

  return ['*', existing, buildEnvelope(mn, mx)];
}

function applyFades(layers) {
  let changed = 0;
  for (const layer of layers) {
    const mn = layer.minzoom, mx = layer.maxzoom;
    if (mn === undefined && mx === undefined) continue;
    if (layer.type === 'hillshade') continue;
    if (!layer.paint) layer.paint = {};

    if (layer.type === 'symbol') {
      for (const key of ['text-opacity', 'icon-opacity']) {
        const before = JSON.stringify(layer.paint[key] ?? null);
        layer.paint[key] = normalizeOpacity(layer.paint[key], mn, mx);
        if (JSON.stringify(layer.paint[key]) !== before) changed++;
      }
    } else {
      const key = OPACITY_KEY[layer.type];
      if (!key) continue;
      const before = JSON.stringify(layer.paint[key] ?? null);
      layer.paint[key] = normalizeOpacity(layer.paint[key], mn, mx);
      if (JSON.stringify(layer.paint[key]) !== before) changed++;
    }
  }
  return changed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const files = fs.readdirSync(STYLES_DIR).filter(f => f.endsWith('.json')).sort();
let totalFilter = 0, totalFade = 0;

for (const file of files) {
  const styleId  = file.replace('.json', '');
  const filePath = path.join(STYLES_DIR, file);
  const style    = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const filterChanges = applyCanonicalFilters(style.layers);
  const fadeChanges   = applyFades(style.layers);

  if (filterChanges === 0 && fadeChanges === 0) continue;

  console.log(`${styleId.padEnd(20)}  filter:${String(filterChanges).padStart(3)}  fades:${String(fadeChanges).padStart(4)}`);
  totalFilter += filterChanges;
  totalFade   += fadeChanges;

  if (!DRY_RUN) {
    fs.writeFileSync(filePath, JSON.stringify(style, null, 2));
  }
}

const mode = DRY_RUN ? '(dry run)' : 'written';
console.log(`\n${mode} — filter fixes: ${totalFilter}  opacity fades: ${totalFade}  across ${files.length} styles`);
