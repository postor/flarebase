import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const EXPRESS_SERVER_URL = process.env.NEXT_PUBLIC_EXPRESS_SERVER_URL || 'http://localhost:3001';

interface RealtimeEvent {
  collection: string;
  document: any;
  operation: 'create' | 'update' | 'delete';
}

export function useRealtimeUpdates() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect to Express server's Socket.IO
    const socketInstance = io(EXPRESS_SERVER_URL);

    socketInstance.on('connect', () => {
      console.log('Connected to Express server');
      setIsConnected(true);
    });

    socketInstance.on('disconnect', () => {
      console.log('Disconnected from Express server');
      setIsConnected(false);
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const subscribe = (collection: string) => {
    if (socket) {
      socket.emit('subscribe', collection);
    }
  };

  const unsubscribe = (collection: string) => {
    if (socket) {
      socket.emit('unsubscribe', collection);
    }
  };

  const onDocumentCreated = (callback: (doc: any) => void) => {
    if (socket) {
      socket.on('flarebase:doc_created', callback);
    }
  };

  const onDocumentUpdated = (callback: (doc: any) => void) => {
    if (socket) {
      socket.on('flarebase:doc_updated', callback);
    }
  };

  const onDocumentDeleted = (callback: (payload: any) => void) => {
    if (socket) {
      socket.on('flarebase:doc_deleted', callback);
    }
  };

  return {
    isConnected,
    subscribe,
    unsubscribe,
    onDocumentCreated,
    onDocumentUpdated,
    onDocumentDeleted
  };
}

// Hook for listening to specific collection updates
export function useCollectionUpdates(collection: string, callbacks: {
  onCreated?: (doc: any) => void;
  onUpdated?: (doc: any) => void;
  onDeleted?: (payload: any) => void;
}) {
  const realtime = useRealtimeUpdates();

  useEffect(() => {
    if (realtime.isConnected) {
      // Subscribe to the collection
      realtime.subscribe(collection);

      // Set up event listeners
      if (callbacks.onCreated) {
        realtime.onDocumentCreated((doc) => {
          if (doc.collection === collection) {
            callbacks.onCreated?.(doc);
          }
        });
      }

      if (callbacks.onUpdated) {
        realtime.onDocumentUpdated((doc) => {
          if (doc.collection === collection) {
            callbacks.onUpdated?.(doc);
          }
        });
      }

      if (callbacks.onDeleted) {
        realtime.onDocumentDeleted((payload) => {
          // Handle deletion
          callbacks.onDeleted?.(payload);
        });
      }

      // Cleanup
      return () => {
        realtime.unsubscribe(collection);
      };
    }
  }, [realtime.isConnected, collection]);

  return realtime;
}