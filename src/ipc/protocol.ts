export type IpcRequestType =
  | 'capture_observation'
  | 'capture_user_prompt'
  | 'recall_initial_context'
  | 'recall_relevant'
  | 'summarize_session'
  | 'save_session_snapshot';

export interface IpcRequest {
  id: string;
  type: IpcRequestType;
  payload: Record<string, unknown>;
}

export interface IpcResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
