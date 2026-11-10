'use client';

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main style={{ minHeight:'100vh', background:'#0b1928', color:'#f6eee1',
    display:'grid', placeItems:'center', padding:24 }}>
    <section role="alert" style={{width:'100%',maxWidth:520,border:'1px solid #b99760',borderRadius:16,padding:28,background:'#15283b'}}>
      <p style={{fontSize:12,letterSpacing:'.16em',color:'#d6ad63'}}>INTRIGUE STUDIOS</p>
      <h1 style={{fontSize:28,margin:'12px 0'}}>This page couldn't load.</h1>
      <p style={{lineHeight:1.7}}>Your changes may not have saved. Try again. If this keeps happening, contact support from the Help Center.</p>
      <div style={{display:'flex',gap:12,marginTop:22,flexWrap:'wrap'}}>
        <button onClick={reset} style={{background:'#d6ad63',color:'#102237',border:0,borderRadius:9,minHeight:44,padding:'0 18px',cursor:'pointer'}}>Try again</button>
        <a href="/help-center" style={{color:'#f7dfaa',alignSelf:'center'}}>Open Help Center</a>
      </div>
    </section>
  </main>;
}
