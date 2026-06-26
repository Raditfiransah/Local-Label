const BASE_URL = "http://localhost:8000";

export interface Settings {
  provider: string;
  base_url: string;
  model: string;
  prompt: string;
  target_column: string;
  custom_labels: string;
  batch_size: number;
  workers: number;
}

export interface DatasetSummary {
  total_rows: number;
  labeled_rows: number;
  pending_rows: number;
  failed_rows: number;
  columns: string[];
  target_column: string | null;
}

export interface ProgressState {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  percentage: number;
  is_running: boolean;
  current_row_id: number | null;
  elapsed_seconds: number | null;
  estimated_remaining_seconds: number | null;
}

export interface DatasetRowData {
  id: number;
  original_text: string;
  row_data: Record<string, any>;
  ai_label: string | null;
  ai_response: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  updated_at: string;
}

export interface RowsResponse {
  total: number;
  page: number;
  limit: number;
  pages: number;
  rows: DatasetRowData[];
  unique_labels: string[];
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  models: string[];
}

export interface BenchmarkResult {
  optimal_batch_size: number;
  optimal_workers: number;
  estimated_speed_rpm: number;
  estimated_finish_mins: number;
  error_rate: number;
  token_throughput: number;
}

export interface LabelDistribution {
  label: string;
  count: number;
  percentage: number;
}

export interface LabelDistributionResponse {
  total_labeled: number;
  distributions: LabelDistribution[];
}

export interface StartLabelingPayload extends Settings {}

// ---------------- API CLIENT FUNCTIONS ----------------

export async function uploadDataset(file: File): Promise<DatasetSummary> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown upload error" }));
    throw new Error(err.detail || "Failed to upload dataset.");
  }
  return res.json();
}

export async function clearDataset(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/clear`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to clear dataset.");
  return res.json();
}

export async function fetchDatasetSummary(): Promise<DatasetSummary> {
  const res = await fetch(`${BASE_URL}/dataset`);
  if (!res.ok) throw new Error("Failed to fetch dataset summary.");
  return res.json();
}

export async function fetchLabelDistribution(): Promise<LabelDistributionResponse> {
  const res = await fetch(`${BASE_URL}/dataset/labels`);
  if (!res.ok) throw new Error("Failed to fetch label distribution.");
  return res.json();
}

export async function fetchCurrentSettings(): Promise<Settings> {
  const res = await fetch(`${BASE_URL}/settings`);
  if (!res.ok) throw new Error("Failed to fetch settings.");
  return res.json();
}

export async function testConnection(provider: string, baseUrl: string): Promise<TestConnectionResponse> {
  const res = await fetch(`${BASE_URL}/test-connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, base_url: baseUrl }),
  });
  if (!res.ok) throw new Error("Failed to connect to LLM provider.");
  return res.json();
}

export async function fetchModels(provider: string, baseUrl: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/models?provider=${encodeURIComponent(provider)}&base_url=${encodeURIComponent(baseUrl)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to fetch models" }));
    throw new Error(err.detail || "Failed to fetch models.");
  }
  const data = await res.json();
  return data.models || [];
}

export async function startLabeling(payload: StartLabelingPayload): Promise<ProgressState> {
  const res = await fetch(`${BASE_URL}/start-labeling`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to start labeling" }));
    throw new Error(err.detail || "Failed to start labeling.");
  }
  return res.json();
}

export async function stopLabeling(): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/stop-labeling`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop labeling.");
  return res.json();
}

export async function fetchProgress(): Promise<ProgressState> {
  const res = await fetch(`${BASE_URL}/progress`);
  if (!res.ok) throw new Error("Failed to fetch progress.");
  return res.json();
}

export interface FetchRowsParams {
  page: number;
  limit: number;
  search?: string;
  label?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function fetchRows(params: FetchRowsParams): Promise<RowsResponse> {
  const queryParts = [
    `page=${params.page}`,
    `limit=${params.limit}`,
    params.search ? `search=${encodeURIComponent(params.search)}` : "",
    params.label ? `label=${encodeURIComponent(params.label)}` : "",
    params.status ? `status=${encodeURIComponent(params.status)}` : "",
    params.sortBy ? `sort_by=${encodeURIComponent(params.sortBy)}` : "",
    params.sortOrder ? `sort_order=${encodeURIComponent(params.sortOrder)}` : "",
  ].filter(Boolean);
  const res = await fetch(`${BASE_URL}/rows?${queryParts.join("&")}`);
  if (!res.ok) throw new Error("Failed to fetch rows.");
  return res.json();
}

export async function updateRowLabel(id: number, label: string): Promise<DatasetRowData> {
  const res = await fetch(`${BASE_URL}/row/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ai_label: label }),
  });
  if (!res.ok) throw new Error("Failed to update manual label.");
  return res.json();
}

export async function deleteRow(id: number): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/row/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete row.");
  return res.json();
}

export async function retryRow(id: number): Promise<DatasetRowData> {
  const res = await fetch(`${BASE_URL}/retry/${id}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to retry row" }));
    throw new Error(err.detail || "Failed to retry row.");
  }
  return res.json();
}

export async function retryAllFailed(): Promise<{ success: boolean; message: string; affected_rows: number }> {
  const res = await fetch(`${BASE_URL}/retry-failed`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to retry failed rows.");
  return res.json();
}

export function getExportUrl(status?: string, label?: string): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (label) params.set("label", label);
  const qs = params.toString();
  return `${BASE_URL}/export${qs ? "?" + qs : ""}`;
}

export async function runAutoBenchmark(payload: StartLabelingPayload): Promise<BenchmarkResult> {
  const res = await fetch(`${BASE_URL}/benchmark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to run benchmark" }));
    throw new Error(err.detail || "Failed to run benchmark.");
  }
  return res.json();
}

export function getProgressStreamUrl(): string {
  return `${BASE_URL}/progress/stream`;
}
