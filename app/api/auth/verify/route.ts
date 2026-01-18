import { NextResponse } from "next/server";
import { signAuthToken, verifySignature } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const address = body?.address as string | undefined;
    const signature = body?.signature as string | undefined;
    const nonce = body?.nonce as string | undefined;

    if (!address || !signature || !nonce) {
      return NextResponse.json(
        { error: "address, signature, and nonce are required" },
        { status: 400 }
      );
    }

    await verifySignature({ address, signature, nonce });
    const tokenResponse = signAuthToken(address);

    return NextResponse.json(tokenResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
