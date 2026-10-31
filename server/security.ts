import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";
import type { ServerConfig } from "./config.js";
import { HttpError } from "./http.js";

const COOKIE = "nf_assistant_guest";
type SignedValue = {
  kind: "session" | "request";
  subject: string;
  session: string;
  expires: number;
  nonce?: string;
  digest?: string;
};

export function subjectHash(identity: string, secret: string) {
  return createHmac("sha256", secret).update(identity).digest("hex");
}

export function payloadDigest(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function signValue(value: SignedValue, secret: string) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyValue(
  token: string,
  secret: string,
  now = Date.now(),
): SignedValue {
  if (token.length > 1800)
    throw new HttpError(
      403,
      "invalid_ticket",
      "Please start a new assistant request.",
    );
  const [encoded, supplied, extra] = token.split(".");
  const expected = createHmac("sha256", secret)
    .update(encoded || "")
    .digest();
  const signature = Buffer.from(supplied || "", "base64url");
  if (
    extra ||
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    throw new HttpError(
      403,
      "invalid_ticket",
      "Please start a new assistant request.",
    );
  }
  let value: SignedValue;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(
      403,
      "invalid_ticket",
      "Please start a new assistant request.",
    );
  }
  if (
    !value ||
    !Number.isFinite(value.expires) ||
    value.expires <= now ||
    !/^[a-f0-9]{64}$/.test(value.subject) ||
    typeof value.session !== "string"
  ) {
    throw new HttpError(
      403,
      "expired_ticket",
      "Please start a new assistant request.",
    );
  }
  return value;
}

function cookieValue(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) || ""
  );
}

export function guestSubject(
  request: Request,
  config: ServerConfig,
  localIp = "127.0.0.1",
) {
  const address = config.trustedVercelProxy
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || ""
    : localIp;
  if (!isIP(address))
    throw new HttpError(
      503,
      "client_address_unavailable",
      "The assistant cannot verify this connection right now.",
    );
  return subjectHash(`guest:${address}`, config.signingSecret);
}

export function issueGuestTicket(
  request: Request,
  payload: unknown,
  config: ServerConfig,
  localIp?: string,
  now = Date.now(),
) {
  const subject = guestSubject(request, config, localIp);
  let session: string = randomUUID();
  try {
    const existing = verifyValue(
      cookieValue(request),
      config.signingSecret,
      now,
    );
    if (existing.kind === "session" && existing.subject === subject)
      session = existing.session;
  } catch {
    /* A new bounded guest session is safe; quota belongs to the IP hash. */
  }
  const sessionToken = signValue(
    { kind: "session", subject, session, expires: now + 86_400_000 },
    config.signingSecret,
  );
  const requestToken = signValue(
    {
      kind: "request",
      subject,
      session,
      nonce: randomUUID(),
      digest: payloadDigest(payload),
      expires: now + 300_000,
    },
    config.signingSecret,
  );
  return {
    requestToken,
    cookie: `${COOKIE}=${sessionToken}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=86400${config.production ? "; Secure" : ""}`,
  };
}

export function validateGuestRequest(
  request: Request,
  payload: unknown,
  config: ServerConfig,
  localIp?: string,
) {
  const token = request.headers.get("x-neurofront-request") || "";
  const ticket = verifyValue(token, config.signingSecret);
  const session = verifyValue(cookieValue(request), config.signingSecret);
  const subject = guestSubject(request, config, localIp);
  if (
    ticket.kind !== "request" ||
    session.kind !== "session" ||
    ticket.subject !== subject ||
    session.subject !== subject ||
    ticket.session !== session.session ||
    ticket.digest !== payloadDigest(payload) ||
    !ticket.nonce
  ) {
    throw new HttpError(
      403,
      "invalid_ticket",
      "Please start a new assistant request.",
    );
  }
  return { subject, requestId: ticket.nonce };
}
