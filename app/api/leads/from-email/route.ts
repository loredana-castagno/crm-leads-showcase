import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { revalidatePath } from "next/cache";
import { db as prisma } from "@/app/lib/db";
import { fetchEmailByGmailId } from "@/app/lib/gmailFetch";
import { summarizeEmail } from "@/app/lib/ai";
import { addSystemLog } from "@/app/actions/systemLog";
import { recordCompanyTypeChange } from "@/app/actions/commercial/history";

const ALLOWED_ORIGIN_PATTERNS = [
  "http://crm.mycompany.co",
  "http://YOUR_SERVER_IP.nip.io",
  "http://localhost:3000",
  "http://localhost:80",
];

const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "me.com",
]);

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "";
  const isAllowed =
    origin.startsWith("chrome-extension://") ||
    ALLOWED_ORIGIN_PATTERNS.some((pat) => origin.startsWith(pat));

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "null",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/**
 * Who is calling. Either a real CRM session, or the headless service credential
 * used by the ally-inbox worker.
 *
 * The route is gated twice — `proxy.ts` and here — and this is the gate that
 * decides *identity*. proxy.ts accepts several API keys (cron secret, Chrome
 * extension); only `CRM_SERVICE_API_KEY` grants an identity here, so the
 * extension's publicly-readable key cannot impersonate the service actor.
 */
const SERVICE_ACTOR_LABEL = "Ally Inbox Bot";

type Actor = { label: string; email: string | null; isService: boolean };

async function resolveActor(request: NextRequest): Promise<Actor | null> {
  const secret = process.env.NEXTAUTH_SECRET || process.env.SECRET;
  const token = await getToken({ req: request, secret });
  if (token?.email) {
    // Existing behaviour: extension calls are labelled by their surface, not the person.
    return { label: "Gmail Extension", email: String(token.email), isService: false };
  }

  const serviceKey = process.env.CRM_SERVICE_API_KEY;
  if (serviceKey && request.headers.get("x-api-key") === serviceKey) {
    return { label: SERVICE_ACTOR_LABEL, email: null, isService: true };
  }

  return null;
}

/**
 * A session caller may only pull IMAP mail for their own mailbox. A service
 * caller has no mailbox at all, so it may not pass `accountEmail` — otherwise a
 * leaked bot key could read any account that has an app password stored, turning
 * a "create contacts" credential into a "read anyone's inbox" one.
 * Returns an error message, or null when the request is allowed.
 */
function checkMailboxAccess(actor: Actor, accountEmail?: string): string | null {
  if (!accountEmail) return null;
  if (actor.isService) {
    return "Forbidden: service credentials cannot fetch a user's mailbox. Omit accountEmail and send subject/bodyText instead.";
  }
  if (actor.email && actor.email.toLowerCase() !== accountEmail.toLowerCase()) {
    return `Forbidden: You are logged in as ${actor.email} and cannot fetch emails for ${accountEmail}`;
  }
  return null;
}

function extractDomain(urlOrEmail: string): string {
  if (!urlOrEmail) return "";
  let str = urlOrEmail.trim().toLowerCase();
  if (str.includes("@")) {
    str = str.split("@")[1];
  }
  str = str.replace(/^https?:\/\//, "").replace(/^www\./, "");
  str = str.split("/")[0].split("?")[0].split(":")[0];
  return str;
}

async function resolveAccountForSender(email: string) {
  if (!email || !email.includes("@")) {
    return { suggestedTarget: "lead", matchedAccount: null };
  }

  const senderDomain = extractDomain(email);
  if (!senderDomain || PUBLIC_DOMAINS.has(senderDomain)) {
    return { suggestedTarget: "lead", matchedAccount: null };
  }

  try {
    const companies = await (prisma as any).company.findMany({
      where: {
        isArchived: false,
        OR: [
          { website: { not: null } },
          { linkedinUrl: { not: null } },
        ],
      },
      select: {
        id: true,
        name: true,
        type: true,
        website: true,
        linkedinUrl: true,
      },
    });

    for (const company of companies) {
      const companyDomain = extractDomain(company.website || "");
      const linkedinDomain = extractDomain(company.linkedinUrl || "");

      if (
        (companyDomain && companyDomain === senderDomain) ||
        (linkedinDomain && linkedinDomain === senderDomain)
      ) {
        return {
          suggestedTarget: "contact",
          matchedAccount: {
            id: company.id,
            name: company.name,
            type: company.type || "CUSTOMER",
          },
        };
      }
    }
  } catch (e) {
    console.error("resolveAccountForSender error:", e);
  }

  return { suggestedTarget: "lead", matchedAccount: null };
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: getCorsHeaders(request) });
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  // Accept a CRM session, or the headless service credential.
  const actor = await resolveActor(request);
  if (!actor) {
    return NextResponse.json(
      { error: "Unauthorized: an active CRM session or a valid service API key is required" },
      { status: 401, headers: corsHeaders }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawEmail = searchParams.get("email");

  if (!rawEmail || !rawEmail.trim()) {
    return NextResponse.json(
      { exists: false, message: "Email parameter is required" },
      { headers: corsHeaders }
    );
  }

  const cleanEmail = rawEmail.trim().toLowerCase();

  try {
    const contact = await (prisma as any).contact.findFirst({
      where: {
        OR: [
          { email: { equals: cleanEmail } },
          { secondaryEmail: { equals: cleanEmail } },
        ],
      },
      include: {
        // The Contact -> Company relation is named `account`, not `company`
        // (`company` is only the scalar `companyId`). Prisma rejects the wrong
        // name outright, which made this whole lookup throw.
        account: {
          select: { id: true, name: true },
        },
        campaignEnrollments: {
          where: { isArchived: false },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            isActive: true,
            isComplete: true,
            currentStep: true,
            campaign: {
              select: { id: true, name: true },
            },
          },
        },
        followUpLogs: {
          where: { replyDetectedAt: { not: null } },
          orderBy: { replyDetectedAt: "desc" },
          take: 1,
          select: { replyDetectedAt: true, step: true },
        },
        notes: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { name: true, email: true } },
          },
        },
        owner: {
          select: { name: true, email: true },
        },
      },
    });

    if (contact) {
      const recentNotes = contact.notes || [];
      const historyBrief = recentNotes.length > 0
        ? recentNotes.map((n: any) => {
            const dateStr = new Date(n.createdAt).toLocaleDateString();
            const authorStr = n.author?.name || "CRM";
            return `• [${dateStr} - ${authorStr}]: ${n.content}`;
          }).join("\n")
        : "No previous notes in CRM.";

      const contactType = contact.type || "LEAD"; // LEAD or CLIENT_CONTACT

      // Etapa 2.5: Campaign Context
      let campaignInfo = null;
      const activeEnrollment = contact.campaignEnrollments?.[0];
      const replyLog = contact.followUpLogs?.[0];
      const hasReplied = Boolean(replyLog);

      if (activeEnrollment) {
        campaignInfo = {
          name: activeEnrollment.campaign?.name || "Campaign",
          step: activeEnrollment.currentStep || 1,
          isActive: activeEnrollment.isActive,
          isComplete: activeEnrollment.isComplete,
          hasReplied,
          statusText: hasReplied
            ? `💬 Replied (Step ${replyLog.step})`
            : activeEnrollment.isActive
            ? `🚀 Active in "${activeEnrollment.campaign?.name}" (Step ${activeEnrollment.currentStep || 1})`
            : `⏸️ Enrolled in "${activeEnrollment.campaign?.name}" (Inactive)`
        };
      } else if (hasReplied) {
        campaignInfo = {
          name: "Previous Campaign",
          hasReplied: true,
          statusText: `💬 Replied to Campaign (Step ${replyLog.step})`
        };
      }

      return NextResponse.json(
        {
          exists: true,
          type: contactType,
          archived: Boolean(contact.isArchived),
          archiveReason: contact.archiveReason || null,
          campaignInfo,
          lead: {
            id: contact.id,
            fullName: contact.fullName,
            email: contact.email,
            secondaryEmail: contact.secondaryEmail || "",
            phone: contact.phone || "",
            company: contact.account?.name || contact.companyName || "",
            companyId: contact.companyId || null,
            title: contact.title || "",
            linkedinUrl: contact.linkedinUrl || "",
            status: contact.status || "NEW",
            owner: contact.owner?.name || contact.owner?.email || "Unassigned",
            updatedAt: contact.updatedAt,
          },
          notesCount: recentNotes.length,
          historyBrief,
        },
        { headers: corsHeaders }
      );
    }

    // Sender does not exist in CRM: Check if email domain matches an existing Account
    const suggestion = await resolveAccountForSender(cleanEmail);

    return NextResponse.json(
      {
        exists: false,
        suggestedTarget: suggestion.suggestedTarget,
        matchedAccount: suggestion.matchedAccount,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    return NextResponse.json(
      { exists: false, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  // 1. Accept a CRM session, or the headless service credential.
  const actor = await resolveActor(request);
  if (!actor) {
    return NextResponse.json(
      { error: "Unauthorized: an active CRM session or a valid service API key is required" },
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const body = await request.json();
    const {
      accountEmail,
      gmailMsgIdDec,
      email: previewEmail,
      fullName: previewFullName,
      firstName: previewFirstName,
      source,
    } = body;

    // A session caller may only read its own mailbox; a service caller, none.
    const mailboxError = checkMailboxAccess(actor, accountEmail);
    if (mailboxError) {
      return NextResponse.json({ error: mailboxError }, { status: 403, headers: corsHeaders });
    }

    // 2. Fetch authoritative email content via IMAP
    let emailData: any = null;
    if (accountEmail && gmailMsgIdDec) {
      try {
        emailData = await fetchEmailByGmailId({ accountEmail, gmailMsgIdDec });
      } catch (err: any) {
        console.warn("IMAP fetch failed during POST /api/leads/from-email, using preview fallback:", err.message);
      }
    }

    const targetEmail = (emailData?.fromEmail || previewEmail || "").trim().toLowerCase();
    const targetFullName = (emailData?.fromName || previewFullName || "").trim();

    if (!targetEmail) {
      return NextResponse.json(
        { error: "Email is required to create a lead" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 3. Duplicate check by email
    const existingContact = await (prisma as any).contact.findFirst({
      where: {
        OR: [
          { email: { equals: targetEmail } },
          { secondaryEmail: { equals: targetEmail } },
        ],
      },
    });

    if (existingContact) {
      const existingType = existingContact.type || "LEAD";
      const redirectUrl = existingType === "CLIENT_CONTACT"
        ? `/commercial/contacts/${existingContact.id}`
        : `/commercial/leads/${existingContact.id}`;

      // Contact already exists. Rather than dead-ending at a 409, make Add idempotent:
      // restore it if archived, and log this email to its history (deduped by msg-id).
      const wasArchived = Boolean(existingContact.isArchived);
      if (wasArchived) {
        await (prisma as any).contact.update({
          where: { id: existingContact.id },
          data: { isArchived: false, archiveReason: null, archivedAt: null, archivedBy: null, lastModifiedBy: actor.label },
        });
        try {
          await addSystemLog({
            entityType: existingType === "CLIENT_CONTACT" ? "contact" : "lead",
            entityId: existingContact.id,
            action: "restored",
            description: "Restored via Gmail Extension",
            changedBy: actor.label,
          });
        } catch {}
      }

      // Log the email as a note (Message-ID dedupe), same format as creation.
      const emailSubject = emailData?.subject || body.subject || "Email Inquiry";
      const emailBody = emailData?.bodyText || body.bodyText || "(No email body)";
      const emailDate = emailData?.date ? new Date(emailData.date).toLocaleDateString() : new Date().toLocaleDateString();
      const rfc822MsgId = emailData?.rfc822MessageId || `msg-${gmailMsgIdDec || Date.now()}`;
      const priorNotes = await (prisma as any).note.findMany({
        where: { contactId: existingContact.id }, select: { content: true },
      });
      const alreadyLogged = priorNotes.some((n: any) => n.content && n.content.includes(rfc822MsgId));
      if (!alreadyLogged) {
        const summaryResult = await summarizeEmail({ subject: emailSubject, from: `${targetFullName} <${targetEmail}>`, bodyText: emailBody });
        let noteContent = `📧 Email via Gmail Extension — ${emailDate}\nSubject: ${emailSubject}\nFrom: ${targetFullName} <${targetEmail}>`;
        if (summaryResult.isAutoReply) noteContent += `\n⚠️ Automatic reply / out-of-office`;
        noteContent += `\n\nSummary:\n${summaryResult.summary}`;
        if (summaryResult.keyPoints && summaryResult.keyPoints.length > 0) {
          noteContent += `\n\nKey Points:\n` + summaryResult.keyPoints.map((kp: string) => `• ${kp}`).join("\n");
        }
        noteContent += `\n\n[msgid:${rfc822MsgId}]`;
        await (prisma as any).note.create({ data: { content: noteContent, contact: { connect: { id: existingContact.id } } } });
      }

      revalidatePath("/commercial/leads");
      revalidatePath("/commercial/contacts");
      revalidatePath(`/commercial/leads/${existingContact.id}`);

      // If nothing changed (active + this email already logged) → report as duplicate.
      if (!wasArchived && alreadyLogged) {
        return NextResponse.json(
          { duplicate: true, id: existingContact.id, type: existingType, url: redirectUrl, archived: false, message: "Contact already exists in CRM" },
          { status: 409, headers: corsHeaders }
        );
      }

      return NextResponse.json(
        {
          success: true,
          restored: wasArchived,
          alreadyLogged,
          id: existingContact.id,
          type: existingType,
          url: redirectUrl,
          message: wasArchived ? "Lead restored and email logged" : "Email logged to existing lead",
        },
        { headers: corsHeaders }
      );
    }

    // 4. Resolve Target (Lead vs Contact) + ensure the company exists as an Account
    const suggestion = await resolveAccountForSender(targetEmail);
    const nameParts = targetFullName.split(" ");
    const derivedFirstName = previewFirstName || nameParts[0] || "Unknown";
    const derivedLastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    // Derive company name + domain (skip public mailbox providers like gmail/outlook)
    const senderDomain = targetEmail.includes("@") ? extractDomain(targetEmail) : "";
    const isPublicDomain = !senderDomain || PUBLIC_DOMAINS.has(senderDomain);
    let derivedCompany = "";
    if (!isPublicDomain) {
      derivedCompany = senderDomain.split(".")[0];
      derivedCompany = derivedCompany.charAt(0).toUpperCase() + derivedCompany.slice(1);
    }

    // Resolve the account to link: an existing match, or a newly-created PROSPECT
    // (deduped). Public-domain senders get no account (plain LEAD, company as text).
    let linkedAccountId: number | null = null;
    let linkedAccountType: string | null = null;

    if (suggestion.suggestedTarget === "contact" && suggestion.matchedAccount) {
      // Sender domain matched an existing Account (any type)
      linkedAccountId = suggestion.matchedAccount.id;
      linkedAccountType = suggestion.matchedAccount.type || "CUSTOMER";
    } else if (!isPublicDomain && derivedCompany) {
      // No domain match — find-or-create a PROSPECT account (dedupe by name)
      let account = await (prisma as any).company.findFirst({
        where: { isArchived: false, name: { equals: derivedCompany } },
        select: { id: true, type: true },
      });
      if (!account) {
        account = await (prisma as any).company.create({
          data: {
            name: derivedCompany,
            type: "PROSPECT",
            website: senderDomain,               // enables future domain-based dedupe
            source: source || "Gmail Extension",
            lastModifiedBy: actor.label,
          },
          select: { id: true, type: true },
        });
        // Audit trail for the newly-created account (non-fatal)
        try { await recordCompanyTypeChange(account.id, null, "PROSPECT", "gmail_extension"); } catch {}
        try {
          await addSystemLog({
            entityType: "account",
            entityId: account.id,
            action: "created",
            description: "Account created as PROSPECT from Gmail Extension",
            changedBy: actor.label,
          });
        } catch {}
      }
      linkedAccountId = account.id;
      linkedAccountType = account.type || "PROSPECT";
    }

    const contactData: any = {
      firstName: derivedFirstName,
      lastName: derivedLastName,
      fullName: targetFullName || `${derivedFirstName} ${derivedLastName}`.trim(),
      email: targetEmail,
      status: "New",
      source: source || "Gmail Extension",
      lastModifiedBy: actor.label,
    };

    if (linkedAccountId && linkedAccountType && linkedAccountType !== "PROSPECT") {
      // Linked to a real client account (CUSTOMER / FORMER_CUSTOMER) → account contact
      contactData.type = "CLIENT_CONTACT";
      contactData.companyId = linkedAccountId;
      contactData.companyName = derivedCompany || null;
    } else if (linkedAccountId) {
      // Linked to a PROSPECT account → keep it a LEAD (stays in the Leads module),
      // but link it so the "Related Account" is a real, clickable Prospect account.
      contactData.type = "LEAD";
      contactData.companyId = linkedAccountId;
      contactData.companyName = derivedCompany || null;
    } else {
      // Public domain / no company → plain LEAD with free-text company (if any)
      contactData.type = "LEAD";
      contactData.companyName = derivedCompany || null;
    }

    const createdContact = await (prisma as any).contact.create({
      data: contactData,
    });

    // Record creation in the contact's System Information timeline
    try {
      await addSystemLog({
        entityType: createdContact.type === "CLIENT_CONTACT" ? "contact" : "lead",
        entityId: createdContact.id,
        action: "created",
        description: "Created via Gmail Extension",
        changedBy: actor.label,
      });
    } catch {}

    // 5. Generate AI Summary using Claude.
    // Fall back to the subject/body the extension read from the DOM when IMAP failed,
    // so the summary reflects the real email instead of "(No email body)".
    const emailSubject = emailData?.subject || body.subject || "Email Inquiry";
    const emailBody = emailData?.bodyText || body.bodyText || "(No email body)";
    const emailDate = emailData?.date ? new Date(emailData.date).toLocaleDateString() : new Date().toLocaleDateString();
    const rfc822MsgId = emailData?.rfc822MessageId || `msg-${gmailMsgIdDec || Date.now()}`;

    const summaryResult = await summarizeEmail({
      subject: emailSubject,
      from: `${targetFullName} <${targetEmail}>`,
      bodyText: emailBody,
    });

    // 6. Create Initial Note with AI Summary & Message-ID Dedupe marker
    let noteContent = `📧 Email via Gmail Extension — ${emailDate}\nSubject: ${emailSubject}\nFrom: ${targetFullName} <${targetEmail}>`;
    if (summaryResult.isAutoReply) {
      noteContent += `\n⚠️ Automatic reply / out-of-office`;
    }
    noteContent += `\n\nSummary:\n${summaryResult.summary}`;
    if (summaryResult.keyPoints && summaryResult.keyPoints.length > 0) {
      noteContent += `\n\nKey Points:\n` + summaryResult.keyPoints.map((kp: string) => `• ${kp}`).join("\n");
    }
    noteContent += `\n\n[msgid:${rfc822MsgId}]`;

    await (prisma as any).note.create({
      data: {
        content: noteContent,
        contact: { connect: { id: createdContact.id } },
      },
    });

    revalidatePath("/commercial/leads");
    revalidatePath("/commercial/contacts");

    const finalType = createdContact.type || "LEAD";
    const redirectUrl = finalType === "CLIENT_CONTACT"
      ? `/commercial/contacts/${createdContact.id}`
      : `/commercial/leads/${createdContact.id}`;

    return NextResponse.json(
      {
        success: true,
        id: createdContact.id,
        type: finalType,
        url: redirectUrl,
        message: "Contact created successfully from Gmail",
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to create contact from email" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function PUT(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  // Accept a CRM session, or the headless service credential.
  const actor = await resolveActor(request);
  if (!actor) {
    return NextResponse.json(
      { error: "Unauthorized: an active CRM session or a valid service API key is required" },
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const body = await request.json();
    const {
      id,
      email: rawEmail,
      accountEmail,
      gmailMsgIdDec,
    } = body;

    // A session caller may only read its own mailbox; a service caller, none.
    const mailboxError = checkMailboxAccess(actor, accountEmail);
    if (mailboxError) {
      return NextResponse.json({ error: mailboxError }, { status: 403, headers: corsHeaders });
    }

    const cleanEmail = (rawEmail || "").trim().toLowerCase();

    // 1. Find existing contact
    let contact = null;
    if (id) {
      contact = await (prisma as any).contact.findUnique({
        where: { id: Number(id) },
        include: { notes: true },
      });
    } else if (cleanEmail) {
      contact = await (prisma as any).contact.findFirst({
        where: {
          OR: [
            { email: { equals: cleanEmail } },
            { secondaryEmail: { equals: cleanEmail } },
          ],
        },
        include: { notes: true },
      });
    }

    if (!contact) {
      return NextResponse.json(
        { deleted: true, error: "Contact not found or has been deleted from CRM" },
        { status: 404, headers: corsHeaders }
      );
    }

    // 1b. If the contact was archived (soft-deleted), restore it — re-engaging via
    // the extension un-archives it and logs the event, regardless of note dedupe below.
    const wasArchived = Boolean(contact.isArchived);
    if (wasArchived) {
      await (prisma as any).contact.update({
        where: { id: contact.id },
        data: { isArchived: false, archiveReason: null, archivedAt: null, archivedBy: null, lastModifiedBy: actor.label },
      });
      try {
        await addSystemLog({
          entityType: contact.type === "CLIENT_CONTACT" ? "contact" : "lead",
          entityId: contact.id,
          action: "restored",
          description: "Restored via Gmail Extension",
          changedBy: actor.label,
        });
      } catch {}
    }

    // 2. Fetch authoritative email content via IMAP
    let emailData: any = null;
    if (accountEmail && gmailMsgIdDec) {
      try {
        emailData = await fetchEmailByGmailId({ accountEmail, gmailMsgIdDec });
      } catch (err: any) {
        console.warn("IMAP fetch failed during PUT /api/leads/from-email, using preview fallback:", err.message);
      }
    }

    const rfc822MsgId = emailData?.rfc822MessageId || `msg-${gmailMsgIdDec || Date.now()}`;
    const emailSubject = emailData?.subject || body.subject || "Email Inquiry";
    const emailBody = emailData?.bodyText || body.bodyText || "(No email body)";
    const emailDate = emailData?.date ? new Date(emailData.date).toLocaleDateString() : new Date().toLocaleDateString();
    const senderName = emailData?.fromName || contact.fullName || "Sender";
    const senderEmail = emailData?.fromEmail || contact.email || cleanEmail;

    // 3. Dedupe check: check if any note contains [msgid:<rfc822MsgId>]
    const existingNotes = contact.notes || [];
    const isAlreadyLogged = existingNotes.some((n: any) =>
      n.content && n.content.includes(rfc822MsgId)
    );

    if (isAlreadyLogged) {
      return NextResponse.json(
        {
          success: true,
          id: contact.id,
          alreadyLogged: true,
          restored: wasArchived,
          message: wasArchived
            ? "Contact restored (email was already logged)"
            : "This email is already logged in the CRM history",
        },
        { headers: corsHeaders }
      );
    }

    // 4. Generate AI Email Summary
    const summaryResult = await summarizeEmail({
      subject: emailSubject,
      from: `${senderName} <${senderEmail}>`,
      bodyText: emailBody,
    });

    // 5. Create new Note attached to contact
    let noteContent = `📧 Email via Gmail Extension — ${emailDate}\nSubject: ${emailSubject}\nFrom: ${senderName} <${senderEmail}>`;
    if (summaryResult.isAutoReply) {
      noteContent += `\n⚠️ Automatic reply / out-of-office`;
    }
    noteContent += `\n\nSummary:\n${summaryResult.summary}`;
    if (summaryResult.keyPoints && summaryResult.keyPoints.length > 0) {
      noteContent += `\n\nKey Points:\n` + summaryResult.keyPoints.map((kp: string) => `• ${kp}`).join("\n");
    }
    noteContent += `\n\n[msgid:${rfc822MsgId}]`;

    await (prisma as any).note.create({
      data: {
        content: noteContent,
        contact: { connect: { id: contact.id } },
      },
    });

    // 6. Conservative Field Update (fill empty/null fields only)
    const updates: any = {};
    if (!contact.companyName && emailData?.fromEmail) {
      const domain = extractDomain(emailData.fromEmail);
      if (!PUBLIC_DOMAINS.has(domain)) {
        let derived = domain.split(".")[0];
        updates.companyName = derived.charAt(0).toUpperCase() + derived.slice(1);
      }
    }

    if (Object.keys(updates).length > 0) {
      await (prisma as any).contact.update({
        where: { id: contact.id },
        data: updates,
      });
    }

    revalidatePath("/commercial/leads");
    revalidatePath("/commercial/contacts");
    revalidatePath(`/commercial/leads/${contact.id}`);
    revalidatePath(`/commercial/contacts/${contact.id}`);

    return NextResponse.json(
      {
        success: true,
        id: contact.id,
        alreadyLogged: false,
        restored: wasArchived,
        message: wasArchived ? "Contact restored and email logged to CRM history" : "New email logged to CRM history",
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update lead with email" },
      { status: 500, headers: corsHeaders }
    );
  }
}
