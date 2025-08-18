import React, { useState } from 'react';

export default function CsvLoader({ onFileSelect, onCancel }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

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

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="card">
        <h2>CSV Loader Login</h2>
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
        <h2>CSV Loader</h2>
        <button className="button" onClick={handleLogout}>Logout</button>
      </div>
      
      <div style={{ marginBottom: '24px' }}>
        <p>Select a CSV file to load:</p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          style={{
            display: 'block',
            marginBottom: '16px'
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}