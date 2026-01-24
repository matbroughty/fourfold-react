import React from 'react';
import LineChart from './components_LineChart.jsx';
import MultiUserLineChart from './components_MultiUserLineChart.jsx';
import UserWinningsBarChart from './components_UserWinningsBarChart.jsx';
import { useMediaQuery } from './hooks/useMediaQuery.js';

export default function Dashboard({ rawRowsNormalized, people, onBack }) {
  const isMobile = useMediaQuery('(max-width: 639px)');
  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtle">Data visualization and charts</div>
        </div>
        <div className="controls">
          <button
            className="button"
            onClick={onBack}
            title="Return to main view"
          >
            ← Back
          </button>
        </div>
      </div>

      {rawRowsNormalized.length > 0 && people.length > 0 && (
        <div className="grid">
          <div className="card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
              <div>
                <h2 style={{margin:'0 0 4px'}}>Winnings Over Time</h2>
                <div className="subtle">Line charts showing cumulative winnings for each user</div>
              </div>
            </div>
            <div className="charts-grid">
              {people.map(person => (
                <div key={person} className="card">
                  <LineChart userData={rawRowsNormalized} userName={person} />
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
              <div>
                <h2 style={{margin:'0 0 4px'}}>Data Visualization</h2>
                <div className="subtle">Charts showing winnings data across gameweeks</div>
              </div>
            </div>
            <div className="charts-grid">
              <div className="card">
                <MultiUserLineChart userData={rawRowsNormalized} people={people} />
              </div>
              <div className="card">
                <UserWinningsBarChart userData={rawRowsNormalized} people={people} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}