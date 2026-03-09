import React from 'react';
import SenseArticleStateView from './SenseArticleStateView';

class SenseArticleErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[sense-article] render boundary', error, info);
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (typeof this.props.onReset === 'function') {
      this.props.onReset();
    }
  };

  render() {
    const { hasError, error } = this.state;
    const { children, onBack, style, title = '释义百科页面发生异常' } = this.props;
    if (!hasError) return children;

    return (
      <div className="sense-article-page" style={style}>
        <SenseArticleStateView
          kind="error"
          title={title}
          description={error?.message || '当前页面已被安全隔离，请返回后重试。'}
          action={(
            <>
              <button type="button" className="btn btn-secondary" onClick={this.handleReset}>重试当前页面</button>
              {onBack ? <button type="button" className="btn btn-primary" onClick={onBack}>返回</button> : null}
            </>
          )}
        />
      </div>
    );
  }
}

export default SenseArticleErrorBoundary;
