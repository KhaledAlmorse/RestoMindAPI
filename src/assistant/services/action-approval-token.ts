import { createHmac, timingSafeEqual } from 'crypto';
import { Types } from 'mongoose';

const SECRET = process.env.JWT_SECRET || 'secret';
const TTL_MS = 15 * 60 * 1000; // window to click "approve" before re-requesting

export interface ActionTokenPayload {
  restaurantId: string;
  toolName: string;
  arguments: Record<string, any>;
  exp: number;
}

/**
 * Signs the exact tool + arguments shown to the user as a pending action or
 * recommendation. `/assistant/approve-action` executes ONLY what `verify`
 * returns from this token — never the client-supplied `toolName`/`arguments`
 * in the request body — so a tampered or forged approval request can't run a
 * different tool, or the same tool with different arguments, than what a
 * human actually saw and approved.
 */
function sign(restaurantId: Types.ObjectId, toolName: string, args: Record<string, any>): string {
  const payload: ActionTokenPayload = {
    restaurantId: restaurantId.toString(),
    toolName,
    arguments: args,
    exp: Date.now() + TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token: string | undefined, restaurantId: Types.ObjectId): ActionTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;

  let payload: ActionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || payload.exp < Date.now()) return null;
  if (payload.restaurantId !== restaurantId.toString()) return null;
  return payload;
}

export const ActionApprovalToken = { sign, verify };
