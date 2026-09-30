// Type-only imports keep Node crypto out of browser bundles and share one API contract.
export type {
  Host, ReviewStatus, Permissions, Dependency, QualityEvidence, Manifest,
  SkillSummary, SkillDetail, SearchResponse, Submission, CampaignInput, Campaign,
  ReleaseMetadata, EvaluationCase, EvaluationInput, Evaluation, PublicEvaluation,
  InquiryInput, Inquiry, AdReport, MetricRow, ApiError, SkillVersionSummary,
  SkillVersionsResponse, Publication
} from "../../../mcp/src/shared";
import type { SkillSummary, Manifest, Evaluation, Metrics as RegistryMetrics, MetricRow } from "../../../mcp/src/shared";
export interface PageResponse<T> { items: T[]; total: number; offset: number; limit: number }
export interface Metrics extends RegistryMetrics { rows?: MetricRow[]; from?: string; to?: string }
export interface AuditItem { id: string | number; action: string; subject: string; createdAt: string; details?: unknown }
export interface AdminSkillDetail {
  skill: SkillSummary; manifest: Manifest; files: Record<string, string>; contentHash: string;
  evaluations: Evaluation[]; reviews: unknown[];
  diff: { baseVersion: string | null; added: string[]; removed: string[]; changed: Array<{ path: string; before: string; after: string }> };
}
export interface CampaignPreview { campaignId: string; disclosure: string; sponsor: string; text: string; url: string; preview: true }
