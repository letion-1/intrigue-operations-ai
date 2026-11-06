import AccountDeletionPanel from '@/app/dashboard/account/AccountDeletionPanel';

// Account lifecycle is accessible even when the user no longer belongs to a
// workspace (e.g. immediately after ownership transfer).
export default function PrivacyPage(){
 return <main style={{maxWidth:960,margin:'40px auto',padding:'0 18px 50px',fontFamily:'system-ui',color:'#17253a'}}>
   <div style={{marginBottom:20}}><a href="/dashboard" style={{color:'#a67e41'}}>INTRIGUE STUDIOS · Back to workspace</a></div>
   <h1 style={{fontSize:24,fontWeight:650}}>Your privacy and account</h1>
   <AccountDeletionPanel />
 </main>;
}
