## London Housing Visualizer

Static web app to explore London housing prices and metrics by borough and outward postcode.

### Run locally
```bash
cd "/Users/W.Zhouhan/GitHub/Website Final"
python3 -m http.server 8000
```
Open `http://localhost:8000`.

### Data inputs/outputs
- Inputs (archived): `WebsiteDataTable.xlsx`, `Master_v2.xlsx`
- Outputs used by the app:
  - `london_postcode_prices.json`
  - `london_borough_prices.json`
  - `london_metrics.json`
  - `london_boroughs.geojson`
  - `london_postcodes.geojson`

### Archive
`Archives/` contains one-off scripts and unused artifacts.
