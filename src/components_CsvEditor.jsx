import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';

export default function CsvEditor({ rawRows, onSave, onCancel }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [editableRows, setEditableRows] = useState([]);
  const [newRow, setNewRow] = useState({});
  const [columns, setColumns] = useState([]);

  useEffect(() => {
    if (rawRows.length > 0) {
      setEditableRows([...rawRows]);

      // Extract column names from the first row
      const firstRow = rawRows[0];
      const cols = Object.keys(firstRow).filter(key => key !== '__label');
      setColumns(cols);

      // Initialize new row with empty values for each column
      const emptyRow = {};
      cols.forEach(col => {
        emptyRow[col] = '';
      });
      setNewRow(emptyRow);
    }
  }, [rawRows]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === 'Admin User 3' && password === 'admin3') {
      setIsAuthenticated(true);
      setLoginError('');
    } else {
      setLoginError('Invalid username or password');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUsername('');
    setPassword('');
  };

  const handleInputChange = (column, value) => {
    setNewRow(prev => ({
      ...prev,
      [column]: value
    }));
  };

  const handleAddRow = () => {
    // Create a new row with the current values
    const rowToAdd = { ...newRow };

    // Add the row to the editable rows
    const updatedRows = [...editableRows, rowToAdd];

    // Update the labels for all rows
    const updatedRowsWithLabels = updatedRows.map((row, i) => ({
      ...row,
      __label: `GW ${i + 1}`
    }));

    setEditableRows(updatedRowsWithLabels);

    // Reset the new row form
    const emptyRow = {};
    columns.forEach(col => {
      emptyRow[col] = '';
    });
    setNewRow(emptyRow);
  };

  const handleSave = () => {
    // Prepare rows for saving by removing __label property
    // since it will be regenerated when the CSV is parsed
    const rowsForSaving = editableRows.map(row => {
      const { __label, ...rest } = row;
      return rest;
    });

    // Convert the editable rows to CSV format
    const csv = Papa.unparse(rowsForSaving);

    // Create a Blob from the CSV string
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

    // Create a download link for the CSV file
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'updated_data.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Call the onSave callback with the updated rows
    onSave(editableRows);
  };

  if (!isAuthenticated) {
    return (
      <div className="card">
        <h2>CSV Editor Login</h2>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px' }}>Username:</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: '#162235',
                color: 'var(--text)'
              }}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px' }}>Password:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: '#162235',
                color: 'var(--text)'
              }}
            />
          </div>
          {loginError && (
            <div style={{ color: '#ff6b6b', marginBottom: '16px' }}>
              {loginError}
            </div>
          )}
          <button
            type="submit"
            className="button"
            style={{ marginRight: '8px' }}
          >
            Login
          </button>
          <button
            type="button"
            className="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2>CSV Editor</h2>
        <button className="button" onClick={handleLogout}>Logout</button>
      </div>

      <div className="table-wrap" style={{ marginBottom: '24px' }}>
        <table>
          <thead>
            <tr>
              <th>Gameweek</th>
              {columns.map(col => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editableRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td>{row.__label || `GW ${rowIndex + 1}`}</td>
                {columns.map(col => (
                  <td key={col}>{row[col]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3>Add New Gameweek</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          {columns.map(col => (
            <div key={col}>
              <label style={{ display: 'block', marginBottom: '8px' }}>{col}:</label>
              <input
                type="text"
                value={newRow[col] || ''}
                onChange={(e) => handleInputChange(col, e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: '#162235',
                  color: 'var(--text)'
                }}
              />
            </div>
          ))}
        </div>
        <button className="button" onClick={handleAddRow}>Add Gameweek</button>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="button" onClick={handleSave}>Save Changes</button>
        <button className="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
