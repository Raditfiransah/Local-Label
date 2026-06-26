from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime

class SettingsBase(BaseModel):
    provider: str
    base_url: str
    model: str
    prompt: str
    target_column: str
    custom_labels: str
    batch_size: int
    workers: int

class SettingsUpdate(SettingsBase):
    pass

class SettingsResponse(SettingsBase):
    id: int
    updated_at: datetime

    class Config:
        from_attributes = True

class BenchmarkResult(BaseModel):
    optimal_batch_size: int
    optimal_workers: int
    estimated_speed_rpm: float
    estimated_finish_mins: float
    error_rate: float
    token_throughput: float

class DatasetSummaryResponse(BaseModel):
    total_rows: int
    labeled_rows: int
    pending_rows: int
    failed_rows: int
    columns: List[str]
    target_column: Optional[str] = None

class ProgressResponse(BaseModel):
    total: int
    completed: int
    pending: int
    failed: int
    percentage: float
    is_running: bool
    current_row_id: Optional[int] = None
    elapsed_seconds: Optional[float] = None
    estimated_remaining_seconds: Optional[float] = None

class RowResponse(BaseModel):
    id: int
    original_text: str
    row_data: Dict[str, Any]
    ai_label: Optional[str] = None
    ai_response: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True

class RowUpdate(BaseModel):
    ai_label: str

class RowDeleteResponse(BaseModel):
    success: bool
    message: str

class TestConnectionRequest(BaseModel):
    provider: str
    base_url: str

class TestConnectionResponse(BaseModel):
    success: bool
    message: str
    models: List[str] = []

class StartLabelingRequest(SettingsBase):
    pass

class RetryRequest(BaseModel):
    row_ids: Optional[List[int]] = None

class LabelDistribution(BaseModel):
    label: str
    count: int
    percentage: float

class LabelDistributionResponse(BaseModel):
    total_labeled: int
    distributions: List[LabelDistribution]

class ClearResponse(BaseModel):
    success: bool
    message: str

class RetryAllResponse(BaseModel):
    success: bool
    message: str
    affected_rows: int
