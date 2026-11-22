import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import '@arco-design/web-react/dist/css/arco.css';
import './index.css';

export function mountApp(app: ReactElement): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('Root node #root was not found.');
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}
