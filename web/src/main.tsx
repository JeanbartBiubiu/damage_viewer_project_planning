import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@arco-design/web-react/dist/css/arco.css';
import App from './App';
import { recordPageVisit } from './services/visitStatisticsClient';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root node #root was not found.');
}

void recordPageVisit();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
