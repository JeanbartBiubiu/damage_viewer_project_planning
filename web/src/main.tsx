import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@arco-design/web-react/dist/css/arco.css';
import App from './App';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root node #root was not found.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
