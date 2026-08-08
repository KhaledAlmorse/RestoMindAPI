import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';

export interface PendingWorkflowState {
  sessionId: string;
  restaurantId: string;
  userId: string;
  status: 'IDLE' | 'AWAITING_PARAMETERS' | 'AWAITING_HUMAN_APPROVAL';
  pendingAction?: string; // e.g. "CREATE_OFFER"
  collectedParams?: Record<string, any>;
  lastUpdated: Date;
}

/**
 * How long an abandoned workflow keeps its collected parameters. Longer than
 * any realistic multi-turn setup dialog, short enough that a stale "create
 * offer" flow can't resurface days later against changed inventory.
 */
export const SESSION_STATE_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class ConversationStateService {
  private readonly states = new Map<string, PendingWorkflowState>();

  /**
   * ponytail: in-process Map, so state is lost on restart and not shared across
   * instances. Move to Redis if the API is ever scaled past one replica —
   * until then a Map plus expiry is the whole requirement.
   */
  getSessionState(sessionId: string): PendingWorkflowState | undefined {
    const state = this.states.get(sessionId);
    if (!state) return undefined;

    // `lastUpdated` was written but never read, so the Map grew for the life of
    // the process and an abandoned workflow stayed resumable forever.
    if (Date.now() - state.lastUpdated.getTime() > SESSION_STATE_TTL_MS) {
      this.states.delete(sessionId);
      return undefined;
    }

    return state;
  }

  /** Drops every state past its TTL. Called opportunistically on write. */
  private evictExpired(): void {
    const cutoff = Date.now() - SESSION_STATE_TTL_MS;
    for (const [id, state] of this.states) {
      if (state.lastUpdated.getTime() < cutoff) this.states.delete(id);
    }
  }

  setSessionState(sessionId: string, state: PendingWorkflowState): void {
    this.evictExpired();
    state.lastUpdated = new Date();
    this.states.set(sessionId, state);
  }

  updateSessionParams(sessionId: string, params: Record<string, any>): PendingWorkflowState {
    this.evictExpired();
    // getSessionState (not the raw Map) so an expired state starts fresh
    // rather than resuming half-collected parameters.
    const existing = this.getSessionState(sessionId) || {
      sessionId,
      restaurantId: '',
      userId: '',
      status: 'AWAITING_PARAMETERS',
      collectedParams: {},
      lastUpdated: new Date(),
    };

    existing.collectedParams = {
      ...(existing.collectedParams || {}),
      ...params,
    };
    existing.lastUpdated = new Date();

    this.states.set(sessionId, existing);
    return existing;
  }

  clearSessionState(sessionId: string): void {
    this.states.delete(sessionId);
  }
}
