import { NextResponse } from "next/server";
import { FIREBASE_SESSION_COOKIE, isFirebaseConfigured } from "@/lib/firebase/config";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL(isFirebaseConfigured() ? "/login" : "/", request.url), { status: 303 });
  response.cookies.set(FIREBASE_SESSION_COOKIE, "", { httpOnly: true, expires: new Date(0), path: "/", sameSite: "lax" });
  return response;
}
