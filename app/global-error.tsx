'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{margin:0,fontFamily:'system-ui, sans-serif',background:'#0b1928',color:'#f6eee1',minHeight:'100vh',display:'grid',placeItems:'center',padding:22}}>
    <main role="alert" style={{maxWidth:520,border:'1px solid #b99760',borderRadius:16,padding:28}}>
      <h1>INTRIGUE is temporarily unavailable.</h1>
      <p>Nothing has been confirmed as saved. Please try again or return to the login page.</p>
      <button onClick={reset} style={{background:'#d6ad63',color:'#102237',border:0,borderRadius:8,minHeight:44,padding:'0 16px',cursor:'pointer'}}>Try again</button>
      <p><a href="/auth/login" style={{color:'#f7dfaa'}}>Client sign in</a> · <a href="/platform/login" style={{color:'#f7dfaa'}}>Private admin sign in</a></p>
    </main>
  </body></html>;
}
