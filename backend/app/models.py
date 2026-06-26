from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from app.database import Base

def _utcnow():
    return datetime.now(timezone.utc)

class DatasetRow(Base):
    __tablename__ = "dataset_rows"

    id = Column(Integer, primary_key=True, index=True)
    csv_row_id = Column(String, nullable=True, index=True)
    original_text = Column(Text, nullable=False)
    row_data = Column(Text, nullable=False)
    ai_label = Column(String, nullable=True, index=True)
    ai_response = Column(Text, nullable=True)
    status = Column(String, default="pending", index=True)
    error_message = Column(Text, nullable=True)
    edit_history = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        Index("idx_dataset_row_status_id", "status", "id"),
    )

class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, default=1)
    provider = Column(String, default="ollama")
    base_url = Column(String, default="http://localhost:11434")
    model = Column(String, default="")
    prompt = Column(Text, default="Classify the sentiment of the following text as Positive, Negative, or Neutral.\nAnswer with only the label word.\n\nText: {text}")
    target_column = Column(String, default="")
    custom_labels = Column(String, default="Positive, Negative, Neutral")
    batch_size = Column(Integer, default=10)
    workers = Column(Integer, default=2)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
