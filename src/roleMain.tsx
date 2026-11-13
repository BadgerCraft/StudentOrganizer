import React from 'react';
import ReactDOM from 'react-dom/client';
import { RoleEntry } from './RoleEntry';
import './index.css';
import { applyTheme, readTheme } from './services/theme';
applyTheme(readTheme());
import { DocumentErrorBoundary } from './components/DocumentErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DocumentErrorBoundary resetKey="application" label="This view"><RoleEntry /></DocumentErrorBoundary>
  </React.StrictMode>
);
