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

@Injectable()
export class ConversationStateService {
  private readonly states = new Map<string, PendingWorkflowState>();

  getSessionState(sessionId: string): PendingWorkflowState | undefined {
    return this.states.get(sessionId);
  }

  setSessionState(sessionId: string, state: PendingWorkflowState): void {
    state.lastUpdated = new Date();
    this.states.set(sessionId, state);
  }

  updateSessionParams(sessionId: string, params: Record<string, any>): PendingWorkflowState {
    const existing = this.states.get(sessionId) || {
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
