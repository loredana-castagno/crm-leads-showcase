import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { fetchEmailByGmailId } from "@/app/lib/gmailFetch";

const ALLOWED_ORIGIN_PATTERNS = [
  "http://crm.mycompany.co",
  "http://YOUR_SERVER_IP.nip.io",
  "http://localhost:3000",
  "http://localhost:80",
];

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "";
  const isAllowed =
    origin.startsWith("chrome-extension://") ||
    ALLOWED_ORIGIN_PATTERNS.some((pat) => origin.startsWith(pat));

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "null",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  // 1. Verify NextAuth JWT Token (from cookie or Authorization: Bearer header)
  const secret = process.env.NEXTAUTH_SECRET || process.env.SECRET;
  const token = await getToken({ req: request, secret });

  if (!token || !token.email) {
    return NextResponse.json(
      { error: "Unauthorized: Active CRM session required" },
      { status: 401, headers: corsHeaders }
    );
  }

  const authUserEmail = token.email;

  try {
    const body = await request.json();
    const { accountEmail, gmailMsgIdDec } = body;

    if (!accountEmail || !gmailMsgIdDec) {
      return NextResponse.json(
        { error: "Missing accountEmail or gmailMsgIdDec" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. Strict Security Check: Authenticated user can ONLY query their own account
    if (authUserEmail.toLowerCase() !== accountEmail.toLowerCase()) {
      return NextResponse.json(
        { error: `Forbidden: You are logged in as ${authUserEmail} and cannot fetch emails for ${accountEmail}` },
        { status: 403, headers: corsHeaders }
      );
    }

    const emailData = await fetchEmailByGmailId({ accountEmail, gmailMsgIdDec });

    if (emailData.imapFailed) {
      return NextResponse.json(
        {
          success: false,
          imapFailed: true,
          error: emailData.error,
          data: emailData,
        },
        { headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: emailData,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        imapFailed: true,
        error: error.message || "Failed to fetch email via IMAP",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
