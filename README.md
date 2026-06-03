# maplibrestyles

27 finished **MapLibre GL JS** styles for Travlr's self-hosted, token-free map stack.

All styles are baked from [`travlr-earth/style-builder`](https://github.com/travlr-earth/style-builder) — which migrates the original Mapbox GL JS styles to MapLibre via the `preprocessForMapLibre()` pipeline. Tile data comes from [OpenFreeMap](https://openfreemap.org/) (OMT schema). Fonts, terrain DEM, contours, and sprites are self-hosted via jsDelivr CDN.

## Usage

```
https://cdn.jsdelivr.net/gh/travlr-earth/maplibrestyles@main/styles/<id>.json
```

Example:

```js
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://cdn.jsdelivr.net/gh/travlr-earth/maplibrestyles@main/styles/streets.json',
});
```

## Available styles

| ID | Layers |
|----|--------|
| basic | 42 |
| blue-print | 78 |
| comic | 119 |
| dark | 81 |
| decimal | 96 |
| dune | 33 |
| glow | 16 |
| golden-age-travel | 69 |
| ice-cream | 69 |
| light | 47 |
| mineral | 29 |
| moonlight | 137 |
| natural-earth | 16 |
| north-star | 154 |
| osrs | 38 |
| picture-book | 36 |
| purple | 29 |
| satelite | 10 |
| ski | 67 |
| standard-oil | 126 |
| stranger-things | 35 |
| streets | 73 |
| topo | 145 |
| unicorn | 7 |
| vintage | 39 |
| western | 43 |
| winter | 12 |

## Machine-readable index

[`index.json`](./index.json) lists all styles with id, name, and layer count.

## Source

Styles are regenerated from `style-builder` via `node scripts/bake-styles.js`. Never edit the JSON files in this repo directly.
