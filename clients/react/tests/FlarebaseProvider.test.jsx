import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FlarebaseProvider, useFlarebase } from '../src/index.jsx';

describe('FlarebaseProvider - TDD Cycle 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children components', () => {
    // 测试：Provider 应该渲染子组件
    render(
      React.createElement(FlarebaseProvider, { baseURL: "http://localhost:3000" },
        React.createElement('div', { 'data-testid': 'child' }, 'Test Child')
      )
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toHaveTextContent('Test Child');
  });

  it('should provide Flarebase client instance via context', () => {
    // 测试：Provider 应该提供 Flarebase 客户端实例
    const TestComponent = () => {
      const client = useFlarebase();
      expect(client).toBeDefined();
      expect(client.baseURL).toBe('http://localhost:3000');
      return React.createElement('div', null, 'Test');
    };

    render(
      React.createElement(FlarebaseProvider, { baseURL: "http://localhost:3000" },
        React.createElement(TestComponent)
      )
    );
  });

  it('should support multiple nested providers', () => {
    // 测试：支持嵌套的 Provider
    render(
      React.createElement(FlarebaseProvider, { baseURL: "http://localhost:3000" },
        React.createElement(FlarebaseProvider, { baseURL: "http://localhost:3001" },
          React.createElement('div', { 'data-testid': 'nested' }, 'Nested Content')
        )
      )
    );

    expect(screen.getByTestId('nested')).toBeInTheDocument();
  });
});

describe('useFlarebase - TDD Cycle 1', () => {
  it('should throw error when used outside provider', () => {
    // 测试：在 Provider 外使用应该抛出错误
    const TestComponent = () => {
      try {
        useFlarebase();
      } catch (error) {
        expect(error.message).toBe('useFlarebase must be used within a FlarebaseProvider');
      }
      return React.createElement('div', null, 'Test');
    };

    render(React.createElement(TestComponent));
  });

  it('should return client instance when inside provider', () => {
    // 测试：在 Provider 内应该返回客户端实例
    const TestComponent = () => {
      const client = useFlarebase();
      expect(client).toBeDefined();
      expect(client.collection).toBeDefined();
      return React.createElement('div', null, 'Test');
    };

    render(
      React.createElement(FlarebaseProvider, { baseURL: "http://localhost:3000" },
        React.createElement(TestComponent)
      )
    );
  });
});
