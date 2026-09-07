/**
 * Image upload: register with LinkedIn, PUT the bytes, record the URN.
 *
 * The bytes go through this server rather than straight from the browser to
 * LinkedIn's signed upload URL, because that URL wants the member access token
 * — and that token can post as the user for 60 days. Sending it to the browser
 * to save one hop would be trading a real credential for a minor optimisation.
 *
 * The cost is Vercel's ~4.5MB request body cap, which the client covers by
 * downscaling images before upload (see app/page.tsx). A modern phone photo is
 * 3-8MB at full size and about 400KB once resized to 1920px, so the resize is
 * doing real work here, not just being polite.
 */
import { NextResponse } from "next/server";
import { getUsableToken } from "../../../lib/accounts";

import { getRequestAgent } from "../../../lib/request-agent";
import { query } from "../../../lib/db";
import { initializeImageUpload, uploadImageBytes } from "../../../lib/linkedin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Server-side ceiling; the client aims well below this. */
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif"]);

export async function POST(request: Request) {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  const token = await getUsableToken(agent.agentId);
  if (!token.ok) {
    return NextResponse.json(
      { error: `linkedin_${token.reason}`, needsReauth: true },
      { status: 400 },
    );
  }

  let file: File | null = null;
  let altText = "";
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
    altText = String(form.get("altText") ?? "").slice(0, 300);
  } catch {
    return NextResponse.json({ error: "bad_form_data" }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "file_required" }, { status: 400 });
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "unsupported_type", detail: `${file.type} — LinkedIn accepts JPG, PNG and GIF` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", detail: `${Math.round(file.size / 1024)}KB, max ${MAX_BYTES / 1024}KB` },
      { status: 413 },
    );
  }

  const registered = await initializeImageUpload(token.token, token.memberUrn);
  if (!registered.ok) {
    return NextResponse.json(
      { error: "initialize_failed", detail: registered.reason, needsReauth: registered.needsReauth },
      { status: 502 },
    );
  }

  // Recorded before the PUT so a failed upload leaves a visible trace rather
  // than an image URN that exists at LinkedIn and nowhere here.
  const stored = await query<{ id: string }>(
    `INSERT INTO media_assets (agent_id, linkedin_urn, upload_url, alt_text, filename, status)
     VALUES ($1, $2, $3, $4, $5, 'initialized') RETURNING id`,
    [agent.agentId, registered.data.imageUrn, registered.data.uploadUrl, altText || null, file.name],
  );

  const uploaded = await uploadImageBytes(
    token.token,
    registered.data.uploadUrl,
    await file.arrayBuffer(),
    file.type,
  );
  if (!uploaded.ok) {
    await query("UPDATE media_assets SET status = 'failed' WHERE id = $1", [stored[0].id]);
    return NextResponse.json({ error: "upload_failed", detail: uploaded.reason }, { status: 502 });
  }

  await query("UPDATE media_assets SET status = 'uploaded' WHERE id = $1", [stored[0].id]);
  return NextResponse.json({
    ok: true,
    id: stored[0].id,
    imageUrn: registered.data.imageUrn,
    altText,
  });
}
