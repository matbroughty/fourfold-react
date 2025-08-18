import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Array of colors for different gameweeks
const CHART_COLORS = [
  'rgb(255, 99, 132)',   // Red
  'rgb(54, 162, 235)',   // Blue
  'rgb(255, 206, 86)',   // Yellow
  'rgb(75, 192, 192)',   // Teal
  'rgb(153, 102, 255)',  // Purple
  'rgb(255, 159, 64)',   // Orange
  'rgb(76, 230, 100)',   // Green
  'rgb(255, 99, 255)',   // Pink
  'rgb(128, 128, 128)',  // Gray
  'rgb(0, 255, 255)',    // Cyan
];

export default function UserWinningsBarChart({ userData, people }) {
  // Prepare the datasets for the stacked bar chart
  const datasets = [];
  
  // Process each gameweek
  userData.forEach((week, weekIndex) => {
    const weekLabel = week.__label;
    const colorIndex = weekIndex % CHART_COLORS.length;
    const color = CHART_COLORS[colorIndex];
    
    // Create a dataset for this gameweek
    const weekData = {
      label: weekLabel,
      data: people.map(person => {
        // Get the winnings for this person in this week
        const winnings = parseFloat(week[person]) || 0;
        // Only include positive winnings
        return winnings > 0 ? winnings : 0;
      }),
      backgroundColor: color,
      borderColor: color.replace('rgb', 'rgba').replace(')', ', 1)'),
      borderWidth: 1,
    };
    
    datasets.push(weekData);
  });

  // Chart data
  const data = {
    labels: people,
    datasets: datasets,
  };

  // Chart options
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e6eef8',
        },
      },
      title: {
        display: true,
        text: 'User Winnings by Gameweek',
        color: '#e6eef8',
        font: {
          size: 16,
        },
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            return `${context.dataset.label}: £${context.raw.toFixed(2)}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(38, 50, 68, 0.5)',
        },
        ticks: {
          color: '#8aa0b4',
        },
        title: {
          display: true,
          text: 'Users',
          color: '#8aa0b4',
        }
      },
      y: {
        stacked: true,
        grid: {
          color: 'rgba(38, 50, 68, 0.5)',
        },
        ticks: {
          color: '#8aa0b4',
          callback: function(value) {
            return '£' + value;
          }
        },
        title: {
          display: true,
          text: 'Winnings (£)',
          color: '#8aa0b4',
        }
      },
    },
  };

  return (
    <div className="chart-container">
      <Bar data={data} options={options} />
    </div>
  );
}