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

export default function LineChart({ userData, userName }) {
  // Calculate cumulative winnings for the user
  const cumulativeData = [];
  let runningTotal = 0;
  
  userData.forEach(week => {
    // Add the current week's winnings to the running total
    const weekValue = parseFloat(week[userName]) || 0;
    runningTotal += weekValue;
    cumulativeData.push(runningTotal);
  });

  // Prepare labels (gameweeks)
  const labels = userData.map(week => week.__label);

  // Chart data
  const data = {
    labels,
    datasets: [
      {
        label: `${userName} Cumulative Winnings`,
        data: cumulativeData,
        borderColor: 'rgb(98, 208, 255)',
        backgroundColor: 'rgba(98, 208, 255, 0.5)',
        tension: 0.1,
      },
    ],
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
        text: `${userName}'s Winnings Over Time`,
        color: '#e6eef8',
        font: {
          size: 16,
        },
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            return `£${context.raw.toFixed(2)}`;
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
      },
    },
  };

  return (
    <div className="chart-container">
      <Line data={data} options={options} />
    </div>
  );
}