import Link from 'next/link';
export default function PrivacyPage() {
  return <main style={{maxWidth:760,margin:'48px auto',padding:24,lineHeight:1.8}}>
    <Link href="/">ByLine</Link><h1>Privacy at ByLine</h1><p>Updated 18 September 2026.</p>
    <p>ByLine stores your sign-in identity, LinkedIn connection, writing preferences and samples, topics, schedule, drafts, publishing history, and delivery diagnostics. If you enable notifications, it stores your device’s notification token.</p>
    <h2>Your AI connection</h2>
    <p>Your Gemini key and LinkedIn access token are encrypted on the server. ByLine uses your Gemini key to send the context needed to prepare your drafts to Google, including writing preferences, samples, relevant source material and editorial history. Google project billing and quotas belong to you. ByLine does not replace your key with another customer’s or the operator’s key.</p>
    <p>Google’s unpaid-service terms prohibit submitting personal, sensitive or confidential information. Do not include it in samples or instructions. Google may use unpaid inputs and outputs for product improvement. Paid Services have different data terms and are required for users in the EEA, UK and Switzerland. <a href="https://ai.google.dev/gemini-api/terms">Read Google’s terms.</a></p>
    <h2>Services and access</h2>
    <p>The hosting and database providers process stored data to run ByLine. Google processes AI requests and, if enabled, notification delivery. LinkedIn receives content when you publish or authorize scheduled publishing. The ByLine operator administers this installation and its infrastructure. Encryption at rest does not prevent the operator of the running server from processing your credentials.</p>
    <h2>Retention and your choices</h2>
    <p>Account content remains until you delete it or your account. AI usage diagnostics are retained for up to 90 days, notification logs for 30 days, and scheduling records for 180 days. Cleanup runs periodically. You can remove your Gemini connection, disconnect LinkedIn, export your account data, or delete your ByLine account in Settings. Deleting your account does not delete posts already published on LinkedIn or revoke a Gemini key at Google.</p>
    <p>Deployment backups, when enabled by the operator, may retain deleted information until their retention period ends, up to 90 days. Contact the operator who provided your invitation for privacy requests. <Link href="/support">Support details</Link>.</p>
  </main>;
}
