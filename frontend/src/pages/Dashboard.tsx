import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UploadCloud, CheckCircle, AlertCircle, Play, Square, Download,
  Search, Moon, Sun, RefreshCw, Cpu, Database, Sliders,
  ChevronLeft, ChevronRight, Info, ChevronDown, Trash2, RotateCcw,
  BarChart3
} from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Button, Input, Select, Textarea, Progress, Badge, Modal
} from "../components/UI";
import { useToast } from "../components/Toast";
import {
  fetchDatasetSummary, fetchCurrentSettings, fetchModels,
  testConnection, startLabeling, stopLabeling, fetchRows,
  updateRowLabel, uploadDataset, runAutoBenchmark, getProgressStreamUrl,
  clearDataset, deleteRow, retryRow, retryAllFailed, getExportUrl,
  fetchLabelDistribution,
} from "../api/client";
import type { DatasetRowData, BenchmarkResult, ProgressState, LabelDistribution } from "../api/client";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export const Dashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Dark Mode with localStorage persistence
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode");
    return saved !== null ? saved === "true" : true;
  });
  useEffect(() => {
    localStorage.setItem("darkMode", String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  // Sidebar States
  const [provider, setProvider] = useState<string>("ollama");
  const [baseUrl, setBaseUrl] = useState<string>("http://localhost:11434");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [targetColumn, setTargetColumn] = useState<string>("");
  const [promptTemplate, setPromptTemplate] = useState<string>(
    "Classify the sentiment of the following text as Positive, Negative, or Neutral.\nAnswer with only the label word.\n\nText: {text}"
  );
  const [customLabels, setCustomLabels] = useState<string>("Positive, Negative, Neutral");
  const [batchSize, setBatchSize] = useState<number>(10);
  const [workers, setWorkers] = useState<number>(2);
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null);
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [showStartConfirm, setShowStartConfirm] = useState(false);

  const [isTestingConn, setIsTestingConn] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // Table Query States
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(10);
  const [sortBy, setSortBy] = useState<string>("id");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [selectedRow, setSelectedRow] = useState<DatasetRowData | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastErrorToastTime = useRef<number>(0);
  const completedRef = useRef<number>(0);
  const [labelDistributions, setLabelDistributions] = useState<LabelDistribution[]>([]);

  // Completion notification
  useEffect(() => {
    if (progressState && !progressState.is_running && completedRef.current > 0 && progressState.percentage >= 100) {
      toast("Labeling complete! All rows have been processed.", "success");
    }
    if (progressState) {
      completedRef.current = progressState.completed;
    }
  }, [progressState?.is_running]);

  // Fetch label distribution on completion
  useEffect(() => {
    if (!progressState?.is_running && (progressState?.completed ?? 0) > 0) {
      fetchLabelDistribution()
        .then(data => setLabelDistributions(data.distributions))
        .catch(() => {});
    }
  }, [progressState?.is_running, progressState?.completed]);

  const applyTemplate = (type: "binary" | "ternary") => {
    if (type === "binary") {
      setPromptTemplate("Classify the sentiment of the following text as Positive or Negative. Answer with only the label word.\n\nText: {text}");
      setCustomLabels("Positive, Negative");
    } else if (type === "ternary") {
      setPromptTemplate("Classify the sentiment of the following text as Positive, Neutral, or Negative. Answer with only the label word.\n\nText: {text}");
      setCustomLabels("Positive, Neutral, Negative");
    }
  };

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(handler);
  }, [search]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    setProvider(selected);
    setBaseUrl(selected === "ollama" ? "http://localhost:11434" : "http://localhost:1234");
    setSelectedModel("");
    setAvailableModels([]);
  };

  // Queries
  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ["datasetSummary"],
    queryFn: fetchDatasetSummary,
    refetchOnMount: true,
  });

  const { data: savedSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchCurrentSettings,
  });

  useEffect(() => {
    if (savedSettings) {
      setProvider(savedSettings.provider);
      setBaseUrl(savedSettings.base_url);
      setPromptTemplate(savedSettings.prompt);
      if (savedSettings.target_column) setTargetColumn(savedSettings.target_column);
      if (savedSettings.custom_labels) setCustomLabels(savedSettings.custom_labels);
      if (savedSettings.batch_size) setBatchSize(savedSettings.batch_size);
      if (savedSettings.workers) setWorkers(savedSettings.workers);

      fetchModels(savedSettings.provider, savedSettings.base_url)
        .then((models) => {
          setAvailableModels(models);
          if (models.includes(savedSettings.model)) setSelectedModel(savedSettings.model);
          else if (models.length > 0) setSelectedModel(models[0]);
        })
        .catch(() => {});
    }
  }, [savedSettings]);

  useEffect(() => {
    if (summary && summary.target_column && !targetColumn) {
      setTargetColumn(summary.target_column);
    }
  }, [summary, targetColumn]);

  // Fetch Rows Query
  const { data: rowsData, refetch: refetchRows } = useQuery({
    queryKey: ["rows", page, limit, debouncedSearch, labelFilter, statusFilter, sortBy, sortOrder],
    queryFn: () => fetchRows({ page, limit, search: debouncedSearch, label: labelFilter, status: statusFilter, sortBy, sortOrder }),
  });

  // SSE progress streaming
  useEffect(() => {
    const url = getProgressStreamUrl();
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data: ProgressState = JSON.parse(event.data);
        setProgressState(data);
      } catch (err) {
        console.error("Error parsing progress stream event:", err);
      }
    };

    eventSource.onerror = () => {
      const now = Date.now();
      if (now - lastErrorToastTime.current > 10000) {
        toast("Connection to progress stream lost. Retrying...", "error");
        lastErrorToastTime.current = now;
      }
    };

    return () => eventSource.close();
  }, []);

  // Debounced refetch during labeling (every 3s instead of every tick)
  const lastRefetchRef = useRef(0);
  useEffect(() => {
    if (progressState?.is_running) {
      const now = Date.now();
      if (now - lastRefetchRef.current > 3000) {
        lastRefetchRef.current = now;
        refetchRows();
        refetchSummary();
      }
    }
  }, [progressState?.completed]);

  // Refetch on stop
  useEffect(() => {
    if (progressState && !progressState.is_running) {
      refetchRows();
      refetchSummary();
    }
  }, [progressState?.is_running]);

  const handleTestConnection = async () => {
    setIsTestingConn(true);
    try {
      const res = await testConnection(provider, baseUrl);
      if (res.success) {
        setAvailableModels(res.models);
        if (res.models.length > 0) setSelectedModel(res.models[0]);
        toast(`Connected successfully! Found ${res.models.length} model(s).`, "success");
      } else {
        toast(`Connection failed: ${res.message}`, "error");
      }
    } catch (err: any) {
      toast(`Connection error: ${err.message}`, "error");
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleRunBenchmark = async () => {
    if (isBenchmarking) return;
    if (!selectedModel) { toast("Please select a model first.", "warning"); return; }
    if (!targetColumn) { toast("Please select a target column first.", "warning"); return; }
    setIsBenchmarking(true);
    try {
      const res = await runAutoBenchmark({
        provider, base_url: baseUrl, model: selectedModel, prompt: promptTemplate,
        target_column: targetColumn, custom_labels: customLabels, batch_size: batchSize, workers,
      });
      setBenchmarkResult(res);
      toast("Benchmark finished successfully!", "success");
    } catch (err: any) {
      toast(`Benchmark failed: ${err.message}`, "error");
    } finally {
      setIsBenchmarking(false);
    }
  };

  // Upload
  const uploadMutation = useMutation({
    mutationFn: uploadDataset,
    onSuccess: (data) => {
      toast(`Dataset uploaded successfully! Loaded ${data.total_rows} rows.`, "success");
      setTargetColumn(data.columns[0] || "");
      setLabelDistributions([]);
      queryClient.invalidateQueries({ queryKey: ["datasetSummary"] });
      queryClient.invalidateQueries({ queryKey: ["rows"] });
      setPage(1);
    },
    onError: (err: any) => toast(`Failed to upload CSV: ${err.message}`, "error"),
  });

  // Start
  const startMutation = useMutation({
    mutationFn: startLabeling,
    onSuccess: () => {
      toast("Labeling process started!", "success");
      setShowStartConfirm(false);
      completedRef.current = 0;
      queryClient.invalidateQueries({ queryKey: ["datasetSummary"] });
    },
    onError: (err: any) => toast(`Failed to start labeling: ${err.message}`, "error"),
  });

  const handleStartLabeling = () => {
    if (!selectedModel) { toast("Please select a model first.", "warning"); return; }
    if (!targetColumn) { toast("Please select a column to label.", "warning"); return; }
    if (summary && summary.total_rows > 100) {
      setShowStartConfirm(true);
    } else {
      doStart();
    }
  };

  const doStart = () => {
    startMutation.mutate({
      provider, base_url: baseUrl, model: selectedModel, prompt: promptTemplate,
      target_column: targetColumn, custom_labels: customLabels, batch_size: batchSize, workers,
    });
  };

  // Stop
  const stopMutation = useMutation({
    mutationFn: stopLabeling,
    onSuccess: () => toast("Stop requested.", "warning"),
    onError: (err: any) => toast(`Failed to stop: ${err.message}`, "error"),
  });

  // Manual edit
  const updateLabelMutation = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) => updateRowLabel(id, label),
    onSuccess: (updatedRow) => {
      toast("Label updated manually.", "success");
      queryClient.invalidateQueries({ queryKey: ["rows"] });
      queryClient.invalidateQueries({ queryKey: ["datasetSummary"] });
      if (selectedRow && selectedRow.id === updatedRow.id) setSelectedRow(updatedRow);
    },
    onError: (err: any) => toast(`Error updating label: ${err.message}`, "error"),
  });

  // Clear dataset
  const clearMutation = useMutation({
    mutationFn: clearDataset,
    onSuccess: () => {
      toast("Dataset cleared successfully.", "success");
      setLabelDistributions([]);
      queryClient.setQueryData(["datasetSummary"], { total_rows: 0, labeled_rows: 0, pending_rows: 0, failed_rows: 0, columns: [] });
      queryClient.invalidateQueries({ queryKey: ["rows"] });
    },
    onError: (err: any) => toast(`Failed to clear dataset: ${err.message}`, "error"),
  });

  // Delete row
  const deleteRowMutation = useMutation({
    mutationFn: deleteRow,
    onSuccess: () => {
      toast("Row deleted.", "success");
      setSelectedRow(null);
      queryClient.invalidateQueries({ queryKey: ["rows"] });
      queryClient.invalidateQueries({ queryKey: ["datasetSummary"] });
    },
    onError: (err: any) => toast(`Failed to delete row: ${err.message}`, "error"),
  });

  // Retry row
  const retryRowMutation = useMutation({
    mutationFn: retryRow,
    onSuccess: () => {
      toast("Row queued for retry.", "success");
      setSelectedRow(null);
      queryClient.invalidateQueries({ queryKey: ["rows"] });
      queryClient.invalidateQueries({ queryKey: ["datasetSummary"] });
    },
    onError: (err: any) => toast(`Failed to retry: ${err.message}`, "error"),
  });

  // Retry all failed
  const retryAllMutation = useMutation({
    mutationFn: retryAllFailed,
    onSuccess: (res) => {
      if (res.success) {
        toast(`${res.affected_rows} failed rows queued for retry.`, "success");
      } else {
        toast(res.message, "info");
      }
      queryClient.invalidateQueries({ queryKey: ["rows"] });
      queryClient.invalidateQueries({ queryKey: ["datasetSummary"] });
    },
    onError: (err: any) => toast(`Failed to retry: ${err.message}`, "error"),
  });

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.[0]) {
      const file = e.dataTransfer.files[0];
      file.name.endsWith(".csv") ? uploadMutation.mutate(file) : toast("Please upload a CSV file.", "error");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) uploadMutation.mutate(e.target.files[0]);
  };

  const handleSort = (column: string) => {
    if (sortBy === column) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortBy(column); setSortOrder("asc"); }
    setPage(1);
  };

  const isLabelingRunning = progressState?.is_running || false;
  const currentProgressPercent = progressState?.percentage ?? (
    summary && summary.total_rows > 0 ? Math.round((summary.labeled_rows / summary.total_rows) * 100) : 0
  );
  const totalFailedRows = summary?.failed_rows ?? 0;

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 transition-colors duration-200 dark:bg-zinc-950 dark:text-zinc-50">

      {/* ---------------- SIDEBAR ---------------- */}
      <aside className="w-80 border-r border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950 flex flex-col gap-6 overflow-y-auto shrink-0 select-none">

        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-md">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-none tracking-tight">Auto Labeler</h1>
            <span className="text-xs font-medium text-zinc-400">Local AI Labeling</span>
          </div>
        </div>

        <hr className="border-zinc-100 dark:border-zinc-800" />

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Sliders className="h-4.5 w-4.5" />
            <span>AI Configuration</span>
          </div>

          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Provider</label>
              <Select value={provider} onChange={handleProviderChange} disabled={isLabelingRunning}>
                <option value="ollama">Ollama</option>
                <option value="lm-studio">LM Studio (OpenAI Compatible)</option>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Base URL</label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" disabled={isLabelingRunning} />
            </div>

            <Button variant="outline" size="sm" onClick={handleTestConnection} isLoading={isTestingConn} disabled={isLabelingRunning} className="w-full flex items-center justify-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Test Connection
            </Button>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Select Model</label>
              <Select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={isLabelingRunning || availableModels.length === 0}>
                {availableModels.length === 0 ? (
                  <option value="">{isTestingConn ? "Connecting..." : "No models loaded"}</option>
                ) : availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Target CSV Column</label>
              <Select value={targetColumn} onChange={(e) => setTargetColumn(e.target.value)} disabled={isLabelingRunning || !summary || summary.columns.length === 0}>
                {!summary || summary.columns.length === 0 ? (
                  <option value="">Upload a dataset first</option>
                ) : summary.columns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Custom Labels</label>
              <Input value={customLabels} onChange={(e) => setCustomLabels(e.target.value)} placeholder="Positive, Negative, Neutral" disabled={isLabelingRunning} />
            </div>

            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Max Batch Size</label>
                <span className="text-xs font-bold font-mono text-zinc-600 dark:text-zinc-300">{batchSize}</span>
              </div>
              <input type="range" min="5" max="30" value={batchSize} onChange={(e) => setBatchSize(parseInt(e.target.value))} disabled={isLabelingRunning}
                className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-900 dark:accent-zinc-100" />
              <span className="text-[10px] text-zinc-400 leading-none">Max texts per batch.</span>
            </div>

            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Parallel Workers</label>
                <span className="text-xs font-bold font-mono text-zinc-600 dark:text-zinc-300">{workers}</span>
              </div>
              <input type="range" min="1" max="8" value={workers} onChange={(e) => setWorkers(parseInt(e.target.value))} disabled={isLabelingRunning}
                className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-900 dark:accent-zinc-100" />
              <span className="text-[10px] text-zinc-400 leading-none">Concurrent requests.</span>
            </div>
          </div>
        </div>

        <hr className="border-zinc-100 dark:border-zinc-800" />

        <div className="flex flex-col gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Templates</span>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="text-xs font-bold py-1 h-8" onClick={() => applyTemplate("binary")} disabled={isLabelingRunning}>
              Binary (2-Class)
            </Button>
            <Button variant="outline" size="sm" className="text-xs font-bold py-1 h-8" onClick={() => applyTemplate("ternary")} disabled={isLabelingRunning}>
              Ternary (3-Class)
            </Button>
          </div>
        </div>

        <hr className="border-zinc-100 dark:border-zinc-800" />

        {/* Auto Benchmark */}
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Auto Benchmark</span>
          <Button variant="outline" size="sm" onClick={handleRunBenchmark} isLoading={isBenchmarking}
            disabled={isLabelingRunning || isBenchmarking || !selectedModel || !summary || summary.total_rows === 0}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-bold">
            <Cpu className="h-3.5 w-3.5" />
            Benchmark Hardware
          </Button>

          {benchmarkResult && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40 flex flex-col gap-2.5 text-xs animate-fade-in">
              <div className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-50">
                <CheckCircle className="h-4 w-4 text-emerald-500 animate-pulse" />
                <span>Optimal Settings</span>
              </div>
              <div className="flex flex-col gap-1.5 font-medium text-zinc-600 dark:text-zinc-400">
                <div className="flex justify-between"><span>Batch Size:</span><span className="font-bold text-zinc-900 dark:text-zinc-50">{benchmarkResult.optimal_batch_size}</span></div>
                <div className="flex justify-between"><span>Workers:</span><span className="font-bold text-zinc-900 dark:text-zinc-50">{benchmarkResult.optimal_workers}</span></div>
                <div className="flex justify-between"><span>Speed:</span><span className="font-bold text-zinc-900 dark:text-zinc-50">{benchmarkResult.estimated_speed_rpm} rows/min</span></div>
                <div className="flex justify-between"><span>ETA:</span><span className="font-bold text-zinc-900 dark:text-zinc-50">{benchmarkResult.estimated_finish_mins} mins</span></div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => { setBatchSize(benchmarkResult.optimal_batch_size); setWorkers(benchmarkResult.optimal_workers); toast("Benchmark config applied!", "success"); }}
                className="w-full text-xs font-bold h-8">Apply Configuration</Button>
            </div>
          )}
        </div>

        <hr className="border-zinc-100 dark:border-zinc-800" />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Prompt Template</span>
            <div className="group relative">
              <Info className="h-4 w-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer" />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-48 -translate-x-1/2 rounded bg-zinc-950 p-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-zinc-800">
                Use <code className="rounded bg-white/20 px-1">{`{text}`}</code> as placeholder.
              </div>
            </div>
          </div>
          <Textarea value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} placeholder="Classify: {text}"
            className="h-32 text-xs font-mono resize-none leading-relaxed" disabled={isLabelingRunning} />
        </div>

        <hr className="mt-auto border-zinc-100 dark:border-zinc-800" />

        {/* Controls */}
        <div className="flex flex-col gap-2.5">
          {!isLabelingRunning ? (
            <Button variant="primary" onClick={handleStartLabeling}
              disabled={uploadMutation.isPending || !summary || summary.total_rows === 0}
              className="w-full flex items-center justify-center gap-2">
              <Play className="h-4 w-4 fill-current" />
              Start Labeling
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => stopMutation.mutate()}
              className="w-full flex items-center justify-center gap-2 animate-pulse">
              <Square className="h-4 w-4 fill-current" />
              Stop Labeling
            </Button>
          )}
        </div>
      </aside>

      {/* ---------------- MAIN CONTENT ---------------- */}
      <main className="flex-1 p-8 flex flex-col gap-6 overflow-y-auto max-w-[1600px] mx-auto w-full">

        {/* HEADER */}
        <header className="flex items-center justify-between select-none">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Labeling Dashboard</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage datasets, configure prompts, and label data offline.</p>
          </div>
          <div className="flex items-center gap-3">
            {summary && summary.total_rows > 0 && (
              <a href={getExportUrl()} download>
                <Button variant="outline" size="sm" className="flex items-center gap-2 text-xs font-semibold">
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
              </a>
            )}
            <Button variant="ghost" size="icon" onClick={() => setDarkMode(!darkMode)}
              className="rounded-xl border border-zinc-200/60 dark:border-zinc-800">
              {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </header>

        {/* STATS CARDS */}
        {summary && summary.total_rows > 0 ? (
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-6 select-none">
            <Card><CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Total</span><Database className="h-4.5 w-4.5 text-zinc-400" /></div>
              <div className="text-2xl font-bold">{summary.total_rows}</div>
            </CardContent></Card>
            <Card><CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Completed</span><CheckCircle className="h-4.5 w-4.5 text-emerald-500" /></div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{progressState?.completed ?? summary.labeled_rows}</div>
            </CardContent></Card>
            <Card><CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Pending</span>
                <RefreshCw className={`h-4.5 w-4.5 text-zinc-400 ${isLabelingRunning ? "animate-spin" : ""}`} /></div>
              <div className="text-2xl font-bold text-zinc-600 dark:text-zinc-400">{progressState?.pending ?? summary.pending_rows}</div>
            </CardContent></Card>
            <Card><CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Failed</span><AlertCircle className="h-4.5 w-4.5 text-red-500" /></div>
              <div className="text-2xl font-bold text-red-500">{progressState?.failed ?? summary.failed_rows}</div>
            </CardContent></Card>
            <Card><CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Progress</span><span className="text-sm font-bold text-zinc-500 dark:text-zinc-400">{currentProgressPercent}%</span></div>
              <div className="mt-2.5"><Progress value={currentProgressPercent} colorClassName="bg-zinc-900 dark:bg-zinc-100" /></div>
            </CardContent></Card>
            <Card><CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">ETA</span><BarChart3 className="h-4.5 w-4.5 text-zinc-400" /></div>
              <div className="text-lg font-bold">
                {progressState?.estimated_remaining_seconds != null
                  ? formatDuration(progressState.estimated_remaining_seconds)
                  : "--"}
              </div>
            </CardContent></Card>
          </section>
        ) : null}

        {/* LABEL DISTRIBUTION */}
        {labelDistributions.length > 0 && !isLabelingRunning && (
          <section className="select-none">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-zinc-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Label Distribution</span>
                </div>
                <div className="flex flex-col gap-2">
                  {labelDistributions.map((d) => (
                    <div key={d.label} className="flex items-center gap-3">
                      <span className="text-xs font-semibold w-20 text-right">{d.label}</span>
                      <div className="flex-1 h-4 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div className="h-full rounded-full bg-zinc-900 dark:bg-zinc-50 transition-all" style={{ width: `${d.percentage}%` }} />
                      </div>
                      <span className="text-xs font-mono text-zinc-500 w-16">{d.count} ({d.percentage}%)</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* UPLOADER */}
        {(!summary || summary.total_rows === 0) ? (
          <section>
            <Card>
              <CardContent className="p-10">
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 transition-all duration-200 cursor-pointer ${
                    isDragOver
                      ? "border-zinc-900 bg-zinc-50/50 dark:border-zinc-50 dark:bg-zinc-900/20"
                      : "border-zinc-200/80 bg-white hover:border-zinc-900/40 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700/60"
                  }`}
                  onClick={() => fileInputRef.current?.click()}>
                  <UploadCloud className="h-12 w-12 text-zinc-400 mb-4 animate-bounce-short" />
                  <h3 className="text-lg font-semibold mb-1">Upload CSV Dataset</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 text-center max-w-sm">Drag & drop CSV here, or click to browse.</p>
                  <Button variant="outline" size="sm" isLoading={uploadMutation.isPending}>Select File</Button>
                  <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileChange} />
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {/* PROGRESS */}
        {isLabelingRunning && progressState && (
          <section className="animate-fade-in select-none">
            <Card className="border-l-4 border-l-zinc-900 dark:border-l-zinc-100 shadow-md">
              <CardContent className="p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-950 dark:bg-zinc-50" />
                    </span>
                    <span className="text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">Processing...</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {progressState.elapsed_seconds != null && (
                      <span className="text-xs font-medium text-zinc-400">Elapsed: {formatDuration(progressState.elapsed_seconds)}</span>
                    )}
                    {progressState.estimated_remaining_seconds != null && (
                      <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">ETA: {formatDuration(progressState.estimated_remaining_seconds)}</span>
                    )}
                    <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">{progressState.completed} / {progressState.total}</span>
                  </div>
                </div>
                <Progress value={progressState.percentage} />
              </CardContent>
            </Card>
          </section>
        )}

        {/* DATA TABLE */}
        {summary && summary.total_rows > 0 ? (
          <section className="flex-1 flex flex-col gap-4 min-h-[500px]">
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardHeader className="flex flex-col md:flex-row md:items-center justify-between pb-4 gap-4 select-none">
                <div>
                  <CardTitle>Dataset Records</CardTitle>
                  <CardDescription>Browse, filter, and review labels.</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3.5">
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input placeholder="Search text..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                  </div>
                  <div className="w-36">
                    <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                      <option value="">All Statuses</option>
                      <option value="pending">Pending</option>
                      <option value="processing">Processing</option>
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                    </Select>
                  </div>
                  {rowsData && rowsData.unique_labels && (
                    <div className="w-36">
                      <Select value={labelFilter} onChange={(e) => { setLabelFilter(e.target.value); setPage(1); }}>
                        <option value="">All Labels</option>
                        <option value="null">Unlabeled</option>
                        {rowsData.unique_labels.map((lbl) => (<option key={lbl} value={lbl}>{lbl}</option>))}
                      </Select>
                    </div>
                  )}

                  {/* Retry All Failed */}
                  {totalFailedRows > 0 && !isLabelingRunning && (
                    <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 dark:border-zinc-800"
                      onClick={() => retryAllMutation.mutate()}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry {totalFailedRows} Failed
                    </Button>
                  )}

                  {/* Reset */}
                  <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 dark:border-zinc-800"
                    onClick={() => { if (confirm("Clear entire dataset?")) clearMutation.mutate(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0 flex-1 flex flex-col justify-between overflow-hidden">
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30 text-zinc-500 dark:text-zinc-400 select-none">
                        <th className="py-3 px-4 font-semibold w-16">No</th>
                        <th className="py-3 px-4 font-semibold cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors" onClick={() => handleSort("original_text")}>
                          <div className="flex items-center gap-1">Text <ChevronDown className={`h-4 w-4 transform transition-transform ${sortBy === "original_text" && sortOrder === "desc" ? "rotate-180" : ""}`} /></div>
                        </th>
                        <th className="py-3 px-4 font-semibold cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors w-48" onClick={() => handleSort("ai_label")}>
                          <div className="flex items-center gap-1">Label <ChevronDown className={`h-4 w-4 transform transition-transform ${sortBy === "ai_label" && sortOrder === "desc" ? "rotate-180" : ""}`} /></div>
                        </th>
                        <th className="py-3 px-4 font-semibold cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors w-24" onClick={() => handleSort("status")}>
                          <div className="flex items-center gap-1">Status <ChevronDown className={`h-4 w-4 transform transition-transform ${sortBy === "status" && sortOrder === "desc" ? "rotate-180" : ""}`} /></div>
                        </th>
                        <th className="py-3 px-4 font-semibold w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {rowsData && rowsData.rows.length > 0 ? (
                        rowsData.rows.map((row, index) => {
                          const rowNumber = (page - 1) * limit + index + 1;
                          return (
                            <tr key={row.id} className="group hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors cursor-pointer" onClick={() => setSelectedRow(row)}>
                              <td className="py-3.5 px-4 font-mono text-xs text-zinc-400 select-none">{rowNumber}</td>
                              <td className="py-3.5 px-4 max-w-xl truncate font-medium" title={row.original_text}>{row.original_text}</td>
                              <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                                <select value={row.ai_label || ""} onChange={(e) => updateLabelMutation.mutate({ id: row.id, label: e.target.value })}
                                  className="h-8 rounded border border-zinc-200/80 bg-white px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950/20 dark:border-zinc-800/80 dark:bg-zinc-950 dark:text-zinc-50 appearance-none pr-6 relative w-36 font-semibold cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                                  style={{ backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center", backgroundSize: "12px" }}>
                                  <option value="">-- No Label --</option>
                                  {customLabels.split(",").map(s => s.trim()).filter(Boolean).map((lbl) => (<option key={lbl} value={lbl}>{lbl}</option>))}
                                  {row.ai_label && !customLabels.split(",").map(s => s.trim()).filter(Boolean).includes(row.ai_label) && (
                                    <option value={row.ai_label}>{row.ai_label}</option>
                                  )}
                                </select>
                              </td>
                              <td className="py-3.5 px-4 select-none">
                                <Badge variant={row.status === "completed" ? "success" : row.status === "processing" ? "warning" : row.status === "failed" ? "error" : "secondary"}
                                  className="w-24 justify-center">{row.status.toUpperCase()}</Badge>
                              </td>
                              <td className="py-3.5 px-4 select-none" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1">
                                  {row.status === "failed" && !isLabelingRunning && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-500" title="Retry" onClick={() => retryRowMutation.mutate(row.id)}>
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr><td colSpan={5} className="py-12 text-center text-zinc-500">
                          {debouncedSearch || statusFilter || labelFilter ? "No matching records." : "Loading records..."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* PAGINATION */}
                {rowsData && rowsData.pages > 1 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800 p-4 flex items-center justify-between select-none">
                    <span className="text-xs font-semibold text-zinc-400">Page {page} of {rowsData.pages} ({rowsData.total} items)</span>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage(page - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      {Array.from({ length: rowsData.pages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === rowsData.pages || Math.abs(p - page) <= 1)
                        .map((p, idx, arr) => {
                          const prev = arr[idx - 1];
                          const showEllipsis = prev && p - prev > 1;
                          return (
                            <React.Fragment key={p}>
                              {showEllipsis && <span className="text-zinc-400 px-1">...</span>}
                              <Button variant={p === page ? "primary" : "outline"} size="sm" className="h-8 w-8 text-xs font-bold" onClick={() => setPage(p)}>{p}</Button>
                            </React.Fragment>
                          );
                        })}
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === rowsData.pages} onClick={() => setPage(page + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        ) : null}
      </main>

      {/* DETAIL MODAL */}
      <Modal isOpen={selectedRow !== null} onClose={() => setSelectedRow(null)} title={`Record #${selectedRow?.id}`}>
        {selectedRow && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Original Text</span>
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100 dark:bg-zinc-900/60 dark:border-zinc-800 text-sm font-medium leading-relaxed max-h-40 overflow-y-auto">{selectedRow.original_text}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">AI Response</span>
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100 dark:bg-zinc-900/60 dark:border-zinc-800 font-mono text-xs leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                {selectedRow.ai_response || <span className="text-zinc-400 italic">No response yet.</span>}
              </div>
            </div>
            {selectedRow.error_message && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-red-400">Error</span>
                <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50 text-xs">{selectedRow.error_message}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Current Label</span>
                <div className="h-10 flex items-center">
                  {selectedRow.ai_label ? <Badge variant="success" className="px-3.5 py-1 text-sm font-bold">{selectedRow.ai_label}</Badge>
                    : <span className="text-xs text-zinc-400 italic">Unlabeled</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Edit Label</span>
                <Select value={selectedRow.ai_label || ""} onChange={(e) => updateLabelMutation.mutate({ id: selectedRow.id, label: e.target.value })}>
                  <option value="">-- No Label --</option>
                  {customLabels.split(",").map(s => s.trim()).filter(Boolean).map((lbl) => (<option key={lbl} value={lbl}>{lbl}</option>))}
                  {selectedRow.ai_label && !customLabels.split(",").map(s => s.trim()).filter(Boolean).includes(selectedRow.ai_label) && (
                    <option value={selectedRow.ai_label}>{selectedRow.ai_label}</option>
                  )}
                </Select>
              </div>
            </div>
            <div className="flex justify-between gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <div className="flex gap-2">
                {selectedRow.status === "failed" && !isLabelingRunning && (
                  <Button variant="outline" size="sm" className="text-amber-600" onClick={() => retryRowMutation.mutate(selectedRow.id)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
                  </Button>
                )}
                <Button variant="outline" size="sm" className="text-red-500" onClick={() => {
                  if (confirm("Delete this row?")) deleteRowMutation.mutate(selectedRow.id);
                }}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
              </div>
              <Button variant="secondary" onClick={() => setSelectedRow(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* CONFIRMATION MODAL */}
      <Modal isOpen={showStartConfirm} onClose={() => setShowStartConfirm(false)} title="Confirm Start Labeling">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You are about to label <strong>{summary?.total_rows}</strong> rows using:
          </p>
          <ul className="text-sm space-y-1 text-zinc-600 dark:text-zinc-400">
            <li>Model: <strong>{selectedModel}</strong></li>
            <li>Batch Size: <strong>{batchSize}</strong></li>
            <li>Workers: <strong>{workers}</strong></li>
            <li>Labels: <strong>{customLabels}</strong></li>
          </ul>
          {benchmarkResult && (
            <p className="text-xs text-zinc-500">Estimated time: <strong>{benchmarkResult.estimated_finish_mins} mins</strong></p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowStartConfirm(false)}>Cancel</Button>
            <Button variant="primary" onClick={doStart} isLoading={startMutation.isPending}>Start Now</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
