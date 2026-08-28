import { NextResponse } from "next/server";
import { z } from "zod";
import { FIREBASE_SESSION_COOKIE, isFirebaseConfigured } from "@/lib/firebase/config";
import { createAuthenticatedFirebaseServerApp } from "@/lib/firebase/server";

const bodySchema = z.object({ idToken: z.string().min(100).max(10_000) });

export async function POST(request: Request) {
  if (!isFirebaseConfigured()) return NextResponse.json({ error: "Firebase is not configured." }, { status: 503 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const { idToken } = bodySchema.parse(await request.json());
    await createAuthenticatedFirebaseServerApp(idToken);
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(FIREBASE_SESSION_COOKIE, idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 55 * 60,
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to authenticate this session." }, { status: 401 });
  }
}

