import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { OfflineAppStatus } from './components/OfflineAppStatus';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OfflineAppStatus />
    <App />
  </React.StrictMode>
);
