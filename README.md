# EPL Winnings App

- Set `VITE_CSV_URL` in `.env` to load a fixed CSV over HTTPS (CloudFront recommended)
- Or upload a CSV manually in the UI
- View tables showing total winnings and gameweek data
- View line charts showing each user's cumulative winnings over time

## Features

- **Data Tables**: Display total winnings and raw gameweek data
- **Line Charts**: Visualize each user's winnings progression throughout the season
- **CSV Import**: Load data from a remote URL or upload locally

## Dependencies

This app uses:
- React for the UI
- Papa Parse for CSV parsing
- Chart.js and react-chartjs-2 for data visualization

## Commands

```
npm install
npm run dev
npm run build
```
