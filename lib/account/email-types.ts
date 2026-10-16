export type ReportEmailStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "unavailable";
export interface ReportEmailRequest {
  id: string;
  status: ReportEmailStatus;
  requestedAt: string;
  updatedAt: string;
  errorCode?: string;
  deliveryEvent?: string;
}
