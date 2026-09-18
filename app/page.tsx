import Link from 'next/link';
import LegacyDashboard from './legacy-dashboard';
export const dynamic='force-dynamic';
export default function Page() {
  if(process.env.BYLINE_ALLOW_LEGACY_AUTH!=='false')return <LegacyDashboard/>;
  const download=process.env.BYLINE_ANDROID_DOWNLOAD_URL;
  return <main style={{maxWidth:760,margin:'10vh auto',padding:'32px 24px'}}>
    <p style={{letterSpacing:4}}>BYLINE · CLIENT PREVIEW</p>
    <h1 style={{fontSize:'clamp(36px,7vw,64px)',lineHeight:1.1}}>Your voice.<br/>A thoughtful daily post.</h1>
    <p style={{fontSize:20,lineHeight:1.7}}>Discover relevant stories, prepare LinkedIn drafts in your voice, and review them before publishing.</p>
    <p>ByLine is currently available by invitation. Your operator will help you install the app, connect LinkedIn, and add a Gemini key from your own Google project.</p>
    {download?.startsWith('https://') && <p><a href={download}>Download ByLine for Android</a></p>}
    <p>You control your AI connection and Google billing. Free provider allowances and hosting availability can change. Draft preparation may be delayed.</p>
    <nav style={{display:'flex',gap:24,marginTop:36}}><Link href="/privacy">Privacy</Link><Link href="/support">Support and account deletion</Link></nav>
  </main>;
}
