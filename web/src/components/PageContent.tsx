import { Component, Suspense, type PropsWithChildren } from 'react';
import { Button } from '@arco-design/web-react';

class PageErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <section className="page-load-error" role="alert">
        <p>页面加载失败，请检查网络后刷新，或切换到其他页面。</p>
        <Button onClick={() => window.location.reload()}>刷新页面</Button>
      </section>;
    }
    return this.props.children;
  }
}

export function SkipToContent() {
  return <a className="skip-link" href="#main-content" onClick={event => {
    event.preventDefault();
    const main = document.getElementById('main-content');
    const target = main?.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? main;
    if (!target) return;
    target.tabIndex = -1;
    target.focus();
    target.scrollIntoView({ block: 'center' });
  }}>跳到主要内容</a>;
}

export function PageContent({ children }: PropsWithChildren) {
  return <main id="main-content" className="page-content" tabIndex={-1}>
    <PageErrorBoundary>
      <Suspense fallback={<div className="page-loading" role="progressbar" aria-label="正在加载页面">正在加载页面…</div>}>
        {children}
      </Suspense>
    </PageErrorBoundary>
  </main>;
}
