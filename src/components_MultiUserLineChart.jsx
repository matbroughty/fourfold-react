import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// Array of colors for different users
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

export default function MultiUserLineChart({ userData, people }) {
  // Prepare labels (gameweeks)
  const labels = userData.map(week => week.__label);

  // Create datasets for each user
  const datasets = people.map((person, index) => {
    // Calculate cumulative winnings for the user
    const cumulativeData = [];
    let runningTotal = 0;
    
    userData.forEach(week => {
      // Add the current week's winnings to the running total
      const weekValue = parseFloat(week[person]) || 0;
      runningTotal += weekValue;
      cumulativeData.push(runningTotal);
    });

    // Get color for this user (cycle through colors if more users than colors)
    const colorIndex = index % CHART_COLORS.length;
    const color = CHART_COLORS[colorIndex];

    return {
      label: person,
      data: cumulativeData,
      borderColor: color,
      backgroundColor: `${color.replace('rgb', 'rgba').replace(')', ', 0.5)')}`,
      tension: 0.1,
    };
  });

  // Chart data
  const data = {
    labels,
    datasets,
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
        text: 'All Users Winnings Over Time',
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
          text: 'Gameweeks',
          color: '#8aa0b4',
        }
      },
      y: {
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
      <Line data={data} options={options} />
    </div>
  );
}