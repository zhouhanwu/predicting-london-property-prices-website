import json
import math
import pandas as pd

# Input/Output
input_file = 'WebsiteDataTable.xlsx'
metrics_input_file = 'Master_v2.xlsx'
output_file = 'london_postcode_prices.json'
borough_output_file = 'london_borough_prices.json'
flat_output_file = 'london_data_records.json'
metrics_output_file = 'london_metrics.json'

YEARS = list(range(2015, 2027))
TYPE_MAP = {
    'D': 'detached',
    'S': 'semi',
    'T': 'terraced',
    'F': 'flat'
}

def process():
    df = pd.read_excel(input_file)

    df['outward'] = df['outward'].astype(str).str.strip().str.upper()
    df['borough'] = df['borough'].astype(str).str.strip().str.lower()
    df['area_bin'] = df['area_bin'].astype(str).str.strip().str.upper()
    df['propertytype'] = (
        df['propertytype']
        .astype(str)
        .str.strip()
        .str.upper()
        .map(TYPE_MAP)
        .fillna(df['propertytype'].astype(str).str.strip().str.lower())
    )

    postcodes = {}
    boroughs = {}
    borough_sums = {}
    borough_counts = {}
    flat_records = []

    for row in df.to_dict(orient='records'):
        outward = row.get('outward', '').strip().upper()
        if not outward:
            continue
        borough = row.get('borough', '').strip().lower()
        area_bin = row.get('area_bin', '').strip().upper()
        p_type = row.get('propertytype', '').strip().lower()

        postcodes.setdefault(outward.lower(), {
            'prices': {}
        })

        for year in YEARS:
            value = row.get(f'{year}_price')
            price = None
            if value is not None and not (isinstance(value, float) and math.isnan(value)):
                price = int(round(float(value)))
                if price > 2500000:
                    price = None

            flat_records.append({
                'outward': outward,
                'year': year,
                'propertytype': p_type,
                'area_bin': area_bin,
                'price': price
            })

            if price is None:
                continue

            year_key = str(year)
            prices = postcodes[outward.lower()]['prices']
            prices.setdefault(year_key, {})
            prices[year_key].setdefault(area_bin, {})
            prices[year_key][area_bin][p_type] = price

            if borough:
                borough_sums.setdefault(borough, {})
                borough_counts.setdefault(borough, {})
                borough_sums[borough].setdefault(year_key, {})
                borough_counts[borough].setdefault(year_key, {})
                borough_sums[borough][year_key].setdefault(area_bin, {})
                borough_counts[borough][year_key].setdefault(area_bin, {})
                borough_sums[borough][year_key][area_bin][p_type] = (
                    borough_sums[borough][year_key][area_bin].get(p_type, 0) + price
                )
                borough_counts[borough][year_key][area_bin][p_type] = (
                    borough_counts[borough][year_key][area_bin].get(p_type, 0) + 1
                )

    for borough, year_map in borough_sums.items():
        boroughs.setdefault(borough, {'prices': {}})
        for year_key, size_map in year_map.items():
            boroughs[borough]['prices'].setdefault(year_key, {})
            for size_key, type_map in size_map.items():
                boroughs[borough]['prices'][year_key].setdefault(size_key, {})
                for p_type, total in type_map.items():
                    count = borough_counts[borough][year_key][size_key].get(p_type, 0)
                    if count > 0:
                        boroughs[borough]['prices'][year_key][size_key][p_type] = round(total / count)

    with open(output_file, 'w') as f:
        json.dump({'postcodes': postcodes}, f, indent=2)

    with open(borough_output_file, 'w') as f:
        json.dump({'boroughs': boroughs}, f, indent=2)

    with open(flat_output_file, 'w') as f:
        json.dump(flat_records, f, indent=2)

    metrics_cols = ['borough', 'postcode', 'year', 'crime_lagged_1yr', 'central', 'culture']
    metrics_df = pd.read_excel(metrics_input_file, usecols=metrics_cols)
    metrics_df['borough'] = metrics_df['borough'].astype(str).str.strip().str.lower()
    metrics_df['postcode'] = metrics_df['postcode'].astype(str).str.strip().str.upper()

    def outward_from_postcode(postcode):
        if not postcode:
            return ''
        return postcode.split(' ')[0].strip().upper()

    borough_crime_sums = {}
    borough_crime_counts = {}
    borough_central_sums = {}
    borough_central_counts = {}
    borough_culture_sums = {}
    borough_culture_counts = {}
    outward_crime_sums = {}
    outward_crime_counts = {}
    outward_central_sums = {}
    outward_central_counts = {}
    outward_culture_sums = {}
    outward_culture_counts = {}

    for row in metrics_df.to_dict(orient='records'):
        borough = row.get('borough', '').strip().lower()
        outward = outward_from_postcode(row.get('postcode', ''))
        year = row.get('year')
        crime = row.get('crime_lagged_1yr')
        central = row.get('central')
        culture = row.get('culture')

        if borough and year and not (isinstance(crime, float) and math.isnan(crime)):
            year_key = str(int(year))
            borough_crime_sums.setdefault(borough, {}).setdefault(year_key, 0.0)
            borough_crime_counts.setdefault(borough, {}).setdefault(year_key, 0)
            borough_crime_sums[borough][year_key] += float(crime)
            borough_crime_counts[borough][year_key] += 1

        if outward and year and not (isinstance(crime, float) and math.isnan(crime)):
            year_key = str(int(year))
            outward_key = outward.lower()
            outward_crime_sums.setdefault(outward_key, {}).setdefault(year_key, 0.0)
            outward_crime_counts.setdefault(outward_key, {}).setdefault(year_key, 0)
            outward_crime_sums[outward_key][year_key] += float(crime)
            outward_crime_counts[outward_key][year_key] += 1

        if borough and not (isinstance(central, float) and math.isnan(central)):
            borough_central_sums[borough] = borough_central_sums.get(borough, 0.0) + float(central)
            borough_central_counts[borough] = borough_central_counts.get(borough, 0) + 1

        if outward and not (isinstance(central, float) and math.isnan(central)):
            outward_key = outward.lower()
            outward_central_sums[outward_key] = outward_central_sums.get(outward_key, 0.0) + float(central)
            outward_central_counts[outward_key] = outward_central_counts.get(outward_key, 0) + 1

        if borough and not (isinstance(culture, float) and math.isnan(culture)):
            borough_culture_sums[borough] = borough_culture_sums.get(borough, 0.0) + float(culture)
            borough_culture_counts[borough] = borough_culture_counts.get(borough, 0) + 1

        if outward and not (isinstance(culture, float) and math.isnan(culture)):
            outward_key = outward.lower()
            outward_culture_sums[outward_key] = outward_culture_sums.get(outward_key, 0.0) + float(culture)
            outward_culture_counts[outward_key] = outward_culture_counts.get(outward_key, 0) + 1

    metrics = {'boroughs': {}, 'postcodes': {}}

    for borough, year_map in borough_crime_sums.items():
        metrics['boroughs'].setdefault(borough, {})
        metrics['boroughs'][borough].setdefault('crime', {})
        for year_key, total in year_map.items():
            count = borough_crime_counts[borough][year_key]
            metrics['boroughs'][borough]['crime'][year_key] = total / count if count else None

    for outward, year_map in outward_crime_sums.items():
        metrics['postcodes'].setdefault(outward, {})
        metrics['postcodes'][outward].setdefault('crime', {})
        for year_key, total in year_map.items():
            count = outward_crime_counts[outward][year_key]
            metrics['postcodes'][outward]['crime'][year_key] = total / count if count else None

    for borough, total in borough_central_sums.items():
        count = borough_central_counts.get(borough, 0)
        if count:
            metrics['boroughs'].setdefault(borough, {})
            metrics['boroughs'][borough]['central'] = total / count

    for outward, total in outward_central_sums.items():
        count = outward_central_counts.get(outward, 0)
        if count:
            metrics['postcodes'].setdefault(outward, {})
            metrics['postcodes'][outward]['central'] = total / count

    for borough, total in borough_culture_sums.items():
        count = borough_culture_counts.get(borough, 0)
        if count:
            metrics['boroughs'].setdefault(borough, {})
            metrics['boroughs'][borough]['culture'] = total / count

    for outward, total in outward_culture_sums.items():
        count = outward_culture_counts.get(outward, 0)
        if count:
            metrics['postcodes'].setdefault(outward, {})
            metrics['postcodes'][outward]['culture'] = total / count

    with open(metrics_output_file, 'w') as f:
        json.dump(metrics, f, indent=2)

    print(f"Processed {len(postcodes)} postcodes and {len(boroughs)} boroughs.")

if __name__ == '__main__':
    process()
