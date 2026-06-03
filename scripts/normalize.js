#!/usr/bin/env node
/**
 * normalize.js — canonical layer ID normalization for maplibrestyles
 *
 * Layers describing the same feature get the same ID across all 27 styles.
 * Only layer.id changes; paint/layout/filter are untouched.
 *
 * Conflict resolution (two-pass):
 *   Pass 1 — compute every canonical ID independently.
 *   Pass 2 — resolve same-style conflicts with -2/-3 suffixes, but only after
 *             accounting for layers that *vacate* their ID through renaming.
 *
 * Usage:
 *   node scripts/normalize.js              # normalise in place
 *   node scripts/normalize.js --dry-run    # print rename map, no writes
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT       = path.resolve(__dirname, '..');
const STYLES_DIR = path.join(ROOT, 'styles');
const DRY_RUN    = process.argv.includes('--dry-run');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterAdminLevel(f, n) {
  const s = JSON.stringify(f ?? null);
  // Match admin_level value n: appears after a comma, and is followed by comma or ]
  return s.includes('"admin_level"') &&
    new RegExp(',' + n + '[,\\]]').test(s);
}

function idHas(id, ...terms) {
  const l = id.toLowerCase();
  return terms.some(t => l.includes(t.toLowerCase()));
}

// ─── Canonical ID logic ────────────────────────────────────────────────────────
function canonical(layer) {
  const sl   = layer['source-layer'] ?? null;
  const type = layer.type;
  const f    = layer.filter ?? null;
  const id   = layer.id;
  const lid  = id.toLowerCase();

  // ── Background ───────────────────────────────────────────────────────────────
  if (!sl && type === 'background') return 'background';

  // ── Injected / GeoJSON fills (no source-layer, type=fill) ────────────────────
  if (!sl && type === 'fill') return null;

  // ── Hillshade ────────────────────────────────────────────────────────────────
  if (type === 'hillshade') {
    if (id === '__ml-hillshade') return 'hillshade';
    return null; // multi-layer hillshade stays as designed
  }

  // ── Water fills ──────────────────────────────────────────────────────────────
  if (sl === 'water' && type === 'fill') {
    if (id === '__ml-water') return 'water';
    if (idHas(id, 'shadow'))                   return 'water-shadow';
    if (idHas(id, 'pattern'))                  return 'water-pattern';
    // depth / bathymetry layers keep their names (distinct data bands)
    if (idHas(id, 'depth','bathymetry'))        return null;
    // vintage artistic texture layers keep their names
    if (idHas(id, 'texture','water2','water3','water4','water5')) return null;
    if (idHas(id, 'background','bg'))           return 'water-background';
    if (lid === 'water' || lid === 'water fill' || lid === 'water-fill') return 'water';
    return null;
  }

  // ── Water outlines ───────────────────────────────────────────────────────────
  if (sl === 'water' && type === 'line') return 'water-line';

  // ── Waterway lines ───────────────────────────────────────────────────────────
  if (sl === 'waterway' && type === 'line') {
    if (idHas(id,'shadow','case','bg'))    return 'waterway-shadow';
    if (idHas(id,'small'))                 return 'waterway-small';
    // Use ID keywords only (filter content varies too much across styles)
    if (idHas(id,'river','canal') && !idHas(id,'stream','drain','ditch')) return 'waterway-river-canal';
    if (idHas(id,'stream','drain','ditch')) return 'waterway-stream';
    return 'waterway';
  }

  // ── Waterway labels ──────────────────────────────────────────────────────────
  if (sl === 'waterway' && type === 'symbol') return 'waterway-label';

  // ── Water-body labels (water_name) ───────────────────────────────────────────
  if (sl === 'water_name' && type === 'symbol') {
    const isLine = idHas(id,'-ln','-line','line');
    const size   = idHas(id,'-lg','large','big',' (big)') ? '-lg'
                 : idHas(id,'-sm','small')                ? '-sm'
                 : idHas(id,'-md','medium','other',' (other)') ? '-md'
                 : '';
    return (isLine ? 'water-label-line' : 'water-label-point') + size;
  }

  // ── Boundary fills ───────────────────────────────────────────────────────────
  if (sl === 'boundary' && type === 'fill') return 'admin-0-boundary-fill';

  // ── Boundary lines ───────────────────────────────────────────────────────────
  if (sl === 'boundary' && type === 'line') {
    // Use ID keywords only — filter content is unreliable (exclusion filters
    // reference 'disputed'/'maritime' but mean the OPPOSITE).
    const disputed = idHas(id,'disputed','disagree','dispute');
    const bg       = idHas(id,'-bg',' bg','shadow','case','cover') && !idHas(id,'case-simple');
    const maritime = idHas(id,'maritime');

    // Determine admin level from filter first (most reliable), then ID
    const level =
      filterAdminLevel(f, 2)                                          ? 0
      : filterAdminLevel(f, 4)                                        ? 1
      : filterAdminLevel(f, 6) || filterAdminLevel(f, 8)             ? 2
      : idHas(id,'admin-0','admin_l2',' l2 ','country','ne-countries',
               'country lines','country-borders','admin_maritime',
               'admin_maritime_cover','water lines',' admin ')        ? 0
      : idHas(id,'admin-1','admin_l3','state','natural-earth-states',
               'state lines','admin-boundaries-states',
               'ne_10m_admin_1','ne-10m-admin-1','boundaries')        ? 1
      : idHas(id,'admin-2','admin-3','admin-4','border-admin-2',
               'border-admin-3','border-admin-4','admin-3-4',
               'admin-2-boundaries','admin-3-4-boundaries',
               'border-admin-3-4')                                     ? 2
      : null;

    if (level === null) return null;
    if (maritime) return 'maritime-boundary';
    const base = ['admin-0','admin-1','admin-2'][level];
    if (disputed) return base + '-boundary-disputed';
    if (bg)       return base + '-boundary-bg';
    return base + '-boundary';
  }

  // ── Buildings ────────────────────────────────────────────────────────────────
  if (sl === 'building' && type === 'fill') {
    if (idHas(id,'shadow'))                    return 'building-shadow';
    if (idHas(id,'pattern'))                   return 'building-pattern';
    if (idHas(id,'train-station','train_station')) return null;
    if (idHas(id,'uusima'))                    return null;
    return 'building';
  }
  if (sl === 'building' && type === 'line') {
    if (idHas(id,'train-station','train_station')) return null;
    return 'building-outline';
  }

  // ── Land cover ───────────────────────────────────────────────────────────────
  if (sl === 'landcover' && type === 'fill') {
    if (idHas(id,'grass'))                     return 'landcover-grass';
    if (idHas(id,'wood','forest'))             return 'landcover-wood';
    if (idHas(id,'snow','ice','glacier'))       return 'landcover-snow';
    if (idHas(id,'crop','farm'))               return 'landcover-crop';
    if (idHas(id,'scrub','brush'))             return 'landcover-scrub';
    // Fall back to filter for catch-all layers
    const fstr = JSON.stringify(f ?? '');
    if (fstr.includes('"grass"'))              return 'landcover-grass';
    if (fstr.includes('"wood"') || fstr.includes('"forest"')) return 'landcover-wood';
    if (fstr.includes('"ice"') || fstr.includes('"snow"'))    return 'landcover-snow';
    if (fstr.includes('"crop"'))               return 'landcover-crop';
    if (fstr.includes('"scrub"'))              return 'landcover-scrub';
    return 'landcover';
  }
  if (sl === 'landcover' && type === 'symbol') return null; // keep style-specific icons

  // ── Land use ─────────────────────────────────────────────────────────────────
  if (sl === 'landuse' && type === 'fill') {
    // ID-first; filter as fallback for catch-alls
    const fstr = JSON.stringify(f ?? '');
    const hasF = (v) => fstr.includes('"' + v + '"');
    // parking BEFORE park (avoid 'park' matching 'parking')
    if (idHas(id,'parking') || hasF('parking'))                                 return 'landuse-parking';
    if (idHas(id,'park','national') || hasF('park') || hasF('national_park'))   return 'landuse-park';
    if (idHas(id,'cemetery') || hasF('cemetery'))                               return 'landuse-cemetery';
    if (idHas(id,'hospital') || hasF('hospital'))                               return 'landuse-hospital';
    if (idHas(id,'school','education') || hasF('school') || hasF('college'))    return 'landuse-school';
    if (idHas(id,'industrial') || hasF('industrial'))                           return 'landuse-industrial';
    if (idHas(id,'residential') || hasF('residential'))                         return 'landuse-residential';
    if (idHas(id,'commercial') || hasF('commercial'))                           return 'landuse-commercial';
    if (idHas(id,'pitch') || hasF('pitch'))                                     return 'landuse-pitch';
    if (idHas(id,'sand','beach') || hasF('sand') || hasF('beach'))              return 'landuse-sand';
    if (idHas(id,'rock') || hasF('rock'))                                       return 'landuse-rock';
    if (idHas(id,'wood','forest') || hasF('wood') || hasF('forest'))            return 'landuse-wood';
    if (idHas(id,'scrub','grass') || hasF('scrub'))                             return 'landuse-scrub';
    if (idHas(id,'glacier bg','glacier pattern'))                               return null;
    if (idHas(id,'ice','glacier','snow') || hasF('glacier') || hasF('ice'))     return 'landuse-snow';
    if (idHas(id,'crop','farm') || hasF('crop') || hasF('farmland'))            return 'landuse-crop';
    if (idHas(id,'wetland') || hasF('wetland'))                                 return 'wetland';
    return 'landuse';
  }
  if (sl === 'landuse' && type === 'line') {
    if (idHas(id,'pitch')) return 'landuse-pitch-outline';
    return null;
  }

  // ── Parks (park source-layer) ─────────────────────────────────────────────────
  if (sl === 'park' && type === 'fill') {
    if (idHas(id,'wetland','overlay_wetland')) return 'wetland';
    if (idHas(id,'breakwater','pier'))         return null;
    if (idHas(id,'glacier'))                   return 'landuse-glacier';
    return 'national-park';
  }

  // ── Aeroway ──────────────────────────────────────────────────────────────────
  if (sl === 'aeroway' && type === 'fill')  return 'aeroway-polygon';
  if (sl === 'aeroway' && type === 'line') {
    if (idHas(id,'runway'))  return 'aeroway-runway';
    if (idHas(id,'taxiway')) return 'aeroway-taxiway';
    // Fall back to filter
    const fstr = JSON.stringify(f ?? '');
    if (fstr.includes('"runway"'))  return 'aeroway-runway';
    if (fstr.includes('"taxiway"')) return 'aeroway-taxiway';
    return 'aeroway-line';
  }

  // ── Mountain peak labels ──────────────────────────────────────────────────────
  if (sl === 'mountain_peak' && type === 'symbol') {
    if (idHas(id,'hillshade-big','hillshade-little','hillshade_big','hillshade_little')) return null;
    return 'mountain-peak-label';
  }

  // ── Contours ──────────────────────────────────────────────────────────────────
  if (sl === 'contours') {
    if (type === 'symbol') return 'contour-label';
    if (type === 'line') {
      if (idHas(id,'index','major','loud','index')) return 'contour-index';
      // Check filter for level=1 (index contour)
      if (JSON.stringify(f ?? '').includes('"level",1')) return 'contour-index';
      return 'contour';
    }
  }

  // ── Place labels ──────────────────────────────────────────────────────────────
  if (sl === 'place' && type === 'symbol') {
    // Already canonical — leave unchanged
    if (lid.startsWith('settlement-major') ||
        lid.startsWith('settlement-minor') ||
        lid.startsWith('settlement-subdivision')) return null;

    // Continent
    if (lid.includes('continent')) return 'place-continent';

    // Country — use ID keywords only (filter is too noisy)
    if (lid.includes('country') || lid === 'country') {
      if (idHas(id,'-lg','-large',' big',' lg',' large')) return 'place-country-lg';
      if (idHas(id,'-sm','-small','abbr',' sm',' small')) return 'place-country-sm';
      if (idHas(id,'-md','-medium',' md',' medium'))      return 'place-country-md';
      return 'place-country';
    }

    // State / province / region
    if (lid.includes('state') || lid === 'place-region' || lid.includes('region')) {
      if (idHas(id,'-lg','-large',' lg',' large')) return 'place-state-lg';
      if (idHas(id,'-sm','-small','abbr',' sm',' small')) return 'place-state-sm';
      if (idHas(id,'-md','-medium',' md',' medium'))      return 'place-state-md';
      return 'place-state';
    }

    // Islands
    if (lid.includes('island') || lid.includes('islet') || lid.includes('archipelago'))
      return 'place-island';

    // Cities → settlement-major-label
    if (lid.includes('city') || lid.includes('place_label_city') || lid === 'city names')
      return 'settlement-major-label';

    // Towns / villages / hamlets → settlement-minor-label
    if (lid.includes('town') || lid.includes('village') || lid.includes('hamlet') ||
        lid === 'settlements' || lid === 'place label' || lid === 'place-label')
      return 'settlement-minor-label';
    if (lid.startsWith('place-label') && !lid.includes('country') && !lid.includes('state'))
      return 'settlement-minor-label';

    // Suburb / neighbourhood → settlement-subdivision-label
    if (lid.includes('suburb') || lid.includes('neighbourhood') || lid.includes('neighborhood') ||
        lid.includes('subdivision'))
      return 'settlement-subdivision-label';

    // Custom/unique — keep
    if (idHas(id,'block-number','block_number','destinations-labels')) return null;

    return null;
  }

  // ── POI labels ────────────────────────────────────────────────────────────────
  if (sl === 'poi' && type === 'symbol') {
    // Western's individual typed POIs are unique
    const WESTERN_POIS = ['baitshop','barber','butcher','camp site','doctor','forts',
      'general store','hotel','photo studio','post office','prisons','saloon','show',
      'stable','stagecoach','tailor','trapper','viewpoints'];
    if (WESTERN_POIS.some(p => lid.includes(p))) return null;
    // Park / nature labels
    if (idHas(id,'park-label','park label','national-park','national_park','forest',
               'glacier labels','peak labels')) return 'park-label';
    return 'poi-label';
  }
  if (sl === 'poi' && type === 'circle') return null;

  // ── Airport / transit / road labels ──────────────────────────────────────────
  if (sl === 'aerodrome_label' && type === 'symbol') return 'airport-label';

  if (sl === 'transportation_name' && type === 'symbol') {
    if (idHas(id,'transit','station','stations','rail-station')) return 'transit-label';
    if (idHas(id,'road','path','chairlift','aerialway','label')) return 'road-label';
    return null;
  }

  // ── Housenumber labels ────────────────────────────────────────────────────────
  if (sl === 'housenumber' && type === 'symbol') return 'housenumber-label';

  // ── Transportation lines — normalise underscore→hyphen, spaces→hyphens ────────
  if (sl === 'transportation' && type === 'line') {
    // Keep clearly unique / style-specific names unchanged
    const KEEP = ['major road','minor road','railway line','railway dot','paths',
                  'gondola','gondola dots','chair_lift','piste','cycleway','footway',
                  'ferries','ski run','chair lift'];
    if (KEEP.some(k => lid.includes(k))) return null;
    const norm = id.replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();
    return norm !== id ? norm : null;
  }

  // ── Transportation symbols ────────────────────────────────────────────────────
  if (sl === 'transportation' && type === 'symbol') {
    const norm = id.replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();
    return norm !== id ? norm : null;
  }

  // ── Transportation fills ──────────────────────────────────────────────────────
  if (sl === 'transportation' && type === 'fill') {
    if (id === 'road_pedestrian') return 'road-pedestrian-polygon-fill';
    return null;
  }

  return null;
}

// ─── Process each style ────────────────────────────────────────────────────────

const files = fs.readdirSync(STYLES_DIR).filter(f => f.endsWith('.json')).sort();
let totalRenamed = 0;

for (const file of files) {
  const styleId  = file.replace('.json', '');
  const filePath = path.join(STYLES_DIR, file);
  const style    = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const layers   = style.layers;

  // ── Pass 1: compute raw canonical ID for every layer ──────────────────────
  const rawCanon = layers.map(l => canonical(l)); // null = keep original

  // ── Pass 2: resolve conflicts ──────────────────────────────────────────────
  //   "Permanent" IDs = layers that keep their original ID (no rename).
  //   A renamed layer vacates its original ID, making it available for others.
  const permanentIds = new Set(
    layers
      .filter((l, i) => !rawCanon[i] || rawCanon[i] === l.id)
      .map(l => l.id)
  );

  const renames   = {}; // old → new
  const claimedIds = new Set(permanentIds); // grows as we assign canonical IDs

  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const target = rawCanon[i];
    if (!target || target === l.id) continue;

    // Find a free ID starting from target
    let resolved = target;
    let suffix = 2;
    while (claimedIds.has(resolved)) {
      resolved = target + '-' + suffix++;
    }

    renames[l.id] = resolved;
    claimedIds.add(resolved);
  }

  if (Object.keys(renames).length === 0) continue;

  // Print report
  console.log('\n' + styleId);
  for (const [old, nw] of Object.entries(renames)) {
    console.log('  ' + old.padEnd(54) + '→ ' + nw);
  }

  if (!DRY_RUN) {
    for (const l of layers) {
      if (renames[l.id]) l.id = renames[l.id];
    }
    fs.writeFileSync(filePath, JSON.stringify(style, null, 2));
    totalRenamed += Object.keys(renames).length;
  }
}

if (!DRY_RUN) {
  console.log(`\nNormalised ${totalRenamed} layer IDs across ${files.length} styles.`);
} else {
  console.log('\n(dry run — no files written)');
}
