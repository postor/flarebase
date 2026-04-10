// 文章列表页面示例 - 使用 SWR 和 JWT 认证
'use client';

import { useArticles, useAuth } from '@/lib/swr-hooks';
import { getFlarebaseClient } from '@/lib/flarebase-jwt';

export default function ArticlesPage() {
  const { user, isAuthenticated } = useAuth();
  const { data: articles, error, isLoading } = useArticles();

  // 如果未认证，显示登录提示
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">需要登录</h1>
          <p className="text-gray-600 mb-6">请先登录以查看文章列表</p>
          <a
            href="/auth"
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
          >
            前往登录
          </a>
        </div>
      </div>
    );
  }

  // 加载状态
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-red-600">
          <p>加载失败: {error.message}</p>
        </div>
      </div>
    );
  }

  // 空状态
  if (!articles || articles.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <header className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">文章列表</h1>
            <div className="text-sm text-gray-600">
              当前用户: {user?.email}
            </div>
          </header>

          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-500 mb-4">暂无文章</p>
            <button className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700">
              创建第一篇文章
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 显示文章列表
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">文章列表</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              当前用户: {user?.email}
            </span>
            <a
              href="/auth"
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              账户设置
            </a>
          </div>
        </header>

        <div className="space-y-4">
          {articles.map((article: any) => (
            <article
              key={article.id}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            >
              <h2 className="text-xl font-bold mb-2">{article.title}</h2>
              <p className="text-gray-600 mb-4">{article.excerpt || article.content?.substring(0, 200)}</p>

              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center gap-4">
                  <span>作者: {article.author_name || '未知'}</span>
                  <span>
                    发布时间: {article.created_at ? new Date(article.created_at).toLocaleDateString() : 'N/A'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded ${
                    article.status === 'published'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {article.status === 'published' ? '已发布' : '草稿'}
                  </span>

                  <a
                    href={`/posts/${article.id}`}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    查看详情 →
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          共 {articles.length} 篇文章
        </div>
      </div>
    </div>
  );
}
