import React from 'react';
import ReactDOM from 'react-dom/client';
import { EncryptedBootstrap } from './security/EncryptedBootstrap';
import './index.css';
import { applyTheme, readTheme } from './services/theme';
applyTheme(readTheme());
import { DocumentErrorBoundary } from './components/DocumentErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DocumentErrorBoundary resetKey="application" label="This view"><EncryptedBootstrap /></DocumentErrorBoundary>
  </React.StrictMode>
);
