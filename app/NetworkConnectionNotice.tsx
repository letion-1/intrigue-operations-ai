'use client';

import { useEffect, useState } from 'react';

/** Only appears when the browser itself reports that the device is offline. */
export default function NetworkConnectionNotice() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const refresh = () => setOffline(!navigator.onLine);
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);
  if (!offline) return null;
  return <div role="status" aria-live="polite" style={{
    position: 'fixed', left: '50%', bottom: 'max(14px, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)', zIndex: 9999, padding: '12px 16px',
    maxWidth: 'calc(100vw - 28px)', borderRadius: 12,
    border: '1px solid #d6ad63', color: '#f7f0e5', background: '#0b1b2b',
    boxShadow: '0 8px 25px rgba(0,0,0,.3)', fontSize: 14,
  }}>You're offline. Changes may not save until you reconnect.</div>;
}
