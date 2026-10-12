import { NextResponse } from "next/server";
import { handlers } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured(): Response {
  return NextResponse.json({ error: "Sign-in is not configured on this deployment." }, { status: 404 });
}

export const GET = handlers?.GET ?? notConfigured;
export const POST = handlers?.POST ?? notConfigured;
