import Link from 'next/link';
export const dynamic='force-dynamic';
export default function SupportPage() {
  const email=process.env.BYLINE_SUPPORT_EMAIL;
  return <main style={{maxWidth:760,margin:'48px auto',padding:24,lineHeight:1.8}}>
    <Link href="/">ByLine</Link><h1>Support</h1>
    <p>Contact the ByLine operator who provided your invitation for installation, privacy or account help.</p>
    {email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && <p><a href={`mailto:${email}`}>{email}</a></p>}
    <h2>Gemini connection</h2><p>Open Settings → Gemini to replace or remove your key. Check your project’s quota and billing in Google AI Studio. Never send your API key or LinkedIn password in a support message.</p>
    <h2>Export or delete your account</h2><p>Open Settings → Export account data for a JSON copy of your content. To delete, open Settings → Delete ByLine account. If you cannot sign in, contact your operator to request deletion after verifying account ownership. An unresolved publish request must be checked before deletion.</p>
    <h2>Publishing</h2><p>Review drafts for accuracy, attribution and suitability before publishing. Scheduling and free hosting depend on provider availability. If a publishing result is uncertain, check LinkedIn before trying again to avoid a duplicate post.</p>
  </main>;
}
