import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// Mock fetch
global.fetch = vi.fn();

// Now import after mocking
const { FlarebaseProvider, usePlugin } = await import('../src/index.jsx');

const BASE_URL = 'http://localhost:3000';

// Helper to trigger socket events
function triggerPluginSuccess(data) {
  if (global.mockSocket) {
    global.mockSocket._triggerEvent('plugin_success', data);
  }
}

function triggerPluginError(error) {
  if (global.mockSocket) {
    global.mockSocket._triggerEvent('plugin_error', error);
  }
}

// Test component for plugin hook
function TestPluginComponent({ eventName, params = {}, options = {} }) {
  const { data, loading, error, callPlugin, reset, executed } = usePlugin(
    eventName,
    params,
    options
  );

  if (loading) return React.createElement('div', { 'data-testid': 'loading' }, 'Loading...');
  if (error) return React.createElement('div', { 'data-testid': 'error' }, error.message);
  if (data) return React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data));
  
  return React.createElement('div', {
    'data-testid': 'initial',
    'data-executed': executed
  }, 'Initial');
}

// Test component with manual execution and button
function TestManualPluginComponent({ eventName }) {
  const { data, loading, error, callPlugin } = usePlugin(
    eventName,
    { manual: true },
    { manual: true }
  );

  return React.createElement('div', null,
    React.createElement('button', {
      'data-testid': 'call-plugin',
      onClick: () => callPlugin({ name: 'Alice' })
    }, 'Call Plugin'),
    loading && React.createElement('div', { 'data-testid': 'loading' }, 'Loading...'),
    error && React.createElement('div', { 'data-testid': 'error' }, error.message),
    data && React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data))
  );
}

// Test component with reset functionality
function TestPluginWithReset() {
  const { data, loading, error, callPlugin, reset, executed } = usePlugin(
    'greet',
    { name: 'Bob' }
  );

  return React.createElement('div', null,
    React.createElement('button', {
      'data-testid': 'reset',
      onClick: reset
    }, 'Reset'),
    React.createElement('button', {
      'data-testid': 'call-again',
      onClick: () => callPlugin({ name: 'Charlie' })
    }, 'Call Again'),
    loading && React.createElement('div', { 'data-testid': 'loading' }, 'Loading...'),
    error && React.createElement('div', { 'data-testid': 'error' }, error.message),
    data && React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data)),
    React.createElement('div', {
      'data-testid': 'executed',
      'data-value': executed
    }, executed ? 'Executed' : 'Not Executed')
  );
}

describe('usePlugin Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (global.mockSocket) {
      global.mockSocket.emit.mockClear();
      global.mockSocket.on.mockClear();
      global.mockSocket.once.mockClear();
    }
  });

  it('should call plugin automatically on mount', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement(TestPluginComponent, {
          eventName: 'greet',
          params: { name: 'World' }
        })
      )
    );

    // Should show loading initially
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    // Trigger plugin success
    await act(async () => {
      triggerPluginSuccess({ ok: true, message: 'Hello, World!' });
    });

    // Wait for plugin call to complete
    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });

    const data = JSON.parse(screen.getByTestId('data').textContent);
    expect(data.ok).toBe(true);
    expect(data.message).toBe('Hello, World!');
  });

  it('should not call plugin automatically when manual=true', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement(TestPluginComponent, {
          eventName: 'greet',
          params: {},
          options: { manual: true }
        })
      )
    );

    // Should show initial state without loading
    expect(screen.getByTestId('initial')).toBeInTheDocument();
    expect(screen.getByTestId('initial').dataset.executed).toBe('false');
  });

  it('should call plugin manually when triggered', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement(TestManualPluginComponent, {
          eventName: 'greet'
        })
      )
    );

    // Click button to call plugin
    await act(async () => {
      fireEvent.click(screen.getByTestId('call-plugin'));
    });

    // Trigger response
    await act(async () => {
      triggerPluginSuccess({ ok: true, message: 'Hello, Alice!' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });

    const data = JSON.parse(screen.getByTestId('data').textContent);
    expect(data.ok).toBe(true);
  });

  it('should handle plugin errors', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement(TestPluginComponent, {
          eventName: 'nonexistent_plugin',
          params: {}
        })
      )
    );

    // Trigger error
    await act(async () => {
      triggerPluginError('Plugin not found');
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('error').textContent).toContain('Plugin not found');
  });

  it('should reset state when reset is called', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement(TestPluginWithReset)
      )
    );

    // Trigger initial plugin success
    await act(async () => {
      triggerPluginSuccess({ ok: true });
    });

    // Wait for initial plugin call
    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });

    expect(screen.getByTestId('executed').dataset.value).toBe('true');

    // Click reset
    await act(async () => {
      fireEvent.click(screen.getByTestId('reset'));
    });

    // Should reset state
    expect(screen.getByTestId('executed').dataset.value).toBe('false');
  });

  it('should allow re-calling plugin with different params', async () => {
    let callCount = 0;

    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement(TestPluginWithReset)
      )
    );

    // Trigger initial call
    await act(async () => {
      callCount++;
      triggerPluginSuccess({ ok: true, callNumber: callCount });
    });

    // Wait for initial call
    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });

    // Call again with different params
    await act(async () => {
      fireEvent.click(screen.getByTestId('call-again'));
    });

    // Trigger second response
    await act(async () => {
      callCount++;
      triggerPluginSuccess({ ok: true, callNumber: callCount });
    });

    await waitFor(() => {
      const data = JSON.parse(screen.getByTestId('data').textContent);
      expect(data.callNumber).toBe(2);
    });
  });
});

describe('usePlugin - Concurrent Calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle multiple plugin calls from different components', async () => {
    function MultiPluginTest({ userId, userName }) {
      const { data, loading, error } = usePlugin('identify', { userId, name: userName });

      if (loading) return React.createElement('div', { 'data-testid': `loading-${userId}` });
      if (error) return React.createElement('div', { 'data-testid': `error-${userId}` }, error.message);
      if (data) return React.createElement('div', { 'data-testid': `data-${userId}` }, JSON.stringify(data));
      
      return React.createElement('div', { 'data-testid': `initial-${userId}` });
    }

    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement('div', null,
          React.createElement(MultiPluginTest, { userId: 'user_1', userName: 'Alice' }),
          React.createElement(MultiPluginTest, { userId: 'user_2', userName: 'Bob' }),
          React.createElement(MultiPluginTest, { userId: 'user_3', userName: 'Charlie' })
        )
      )
    );

    // Trigger all plugin responses
    await act(async () => {
      triggerPluginSuccess({ ok: true, userId: 'user_1', name: 'Alice' });
      triggerPluginSuccess({ ok: true, userId: 'user_2', name: 'Bob' });
      triggerPluginSuccess({ ok: true, userId: 'user_3', name: 'Charlie' });
    });

    // Wait for all plugin calls to complete
    await waitFor(() => {
      expect(screen.getByTestId('data-user_1')).toBeInTheDocument();
      expect(screen.getByTestId('data-user_2')).toBeInTheDocument();
      expect(screen.getByTestId('data-user_3')).toBeInTheDocument();
    });

    // Verify each component got its own result
    const data1 = JSON.parse(screen.getByTestId('data-user_1').textContent);
    const data2 = JSON.parse(screen.getByTestId('data-user_2').textContent);
    const data3 = JSON.parse(screen.getByTestId('data-user_3').textContent);

    expect(data1.userId).toBe('user_1');
    expect(data1.name).toBe('Alice');
    expect(data2.userId).toBe('user_2');
    expect(data2.name).toBe('Bob');
    expect(data3.userId).toBe('user_3');
    expect(data3.name).toBe('Charlie');
  });
});

describe('usePlugin - Integration with FlarebaseProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have access to client.callPlugin method', async () => {
    function TestCallPluginMethod() {
      const { callPlugin } = usePlugin('test', {}, { manual: true });
      const [result, setResult] = React.useState(null);

      const handleCall = async () => {
        try {
          const res = await callPlugin({ foo: 'bar' });
          setResult(res);
        } catch (e) {
          setResult({ error: e.message });
        }
      };

      return React.createElement('div', null,
        React.createElement('button', {
          'data-testid': 'call-direct',
          onClick: handleCall
        }, 'Call Direct'),
        result && React.createElement('div', { 'data-testid': 'result' }, JSON.stringify(result))
      );
    }

    render(
      React.createElement(FlarebaseProvider, { baseURL: BASE_URL },
        React.createElement(TestCallPluginMethod)
      )
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('call-direct'));
    });

    // Trigger response
    await act(async () => {
      triggerPluginSuccess({ ok: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('result')).toBeInTheDocument();
    });
  });
});
