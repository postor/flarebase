# Client Usage Guide

?????????????????????:

- [../guides/CLIENT_PATTERNS.md](../guides/CLIENT_PATTERNS.md)
- [../architecture/TRANSPORT.md](../architecture/TRANSPORT.md)
- [../reference/NAMED_QUERIES.md](../reference/NAMED_QUERIES.md)

## ????

- ???????? WebSocket?
- `useSWR` / `useSwr`?SSR???????? REST named query?
- ???????????? custom plugin,??? custom hook?

## React ????

```tsx
import { FlarebaseProvider, useFlarebase } from '@flarebase/react';
import { useEffect } from 'react';

function App() {
  return (
    <FlarebaseProvider baseURL="http://localhost:3000">
      <Posts />
    </FlarebaseProvider>
  );
}

function Posts() {
  const db = useFlarebase();

  useEffect(() => {
    return db.collection('posts').onSnapshot((change) => {
      console.log(change);
    });
  }, [db]);

  return null;
}
```

## SWR ??

```tsx
import useSWR from 'swr';

function usePublishedPosts(db) {
  return useSWR(
    ['list_published_posts', { limit: 10 }],
    ([name, params]) => db.namedQuery(name, params)
  );
}
```
