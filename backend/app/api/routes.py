import time as time_module
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, text
from typing import Optional
import pandas as pd
import json
import io
import asyncio
import logging

from app.database import get_db, SessionLocal
from app.models import DatasetRow, Settings
from app import schemas
from app.services.llm import fetch_provider_models
from app.services.labeling import labeling_manager

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_SORT_COLUMNS = {"id", "original_text", "ai_label", "status", "updated_at"}

def get_settings(db: Session) -> Settings:
    settings = db.query(Settings).first()
    if not settings:
        settings = Settings(
            id=1,
            custom_labels="Positive, Negative, Neutral",
            batch_size=10,
            workers=2
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@router.post("/upload", response_model=schemas.DatasetSummaryResponse)
async def upload_dataset(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    try:
        if labeling_manager.is_running:
            labeling_manager.stop()
            await asyncio.sleep(0.5)

        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents))

        if df.empty:
            raise HTTPException(status_code=400, detail="The CSV file is empty.")

        df = df.apply(lambda x: x.str.strip() if x.dtype == "object" else x)
        columns = list(df.columns)

        db.query(DatasetRow).delete()
        db.commit()

        id_col = None
        for col in columns:
            if str(col).lower() in ["id", "uuid", "row_id", "rowid", "key", "no"]:
                id_col = col
                break

        first_col = columns[0]
        db_rows = []
        for _, row in df.iterrows():
            row_dict = row.to_dict()
            row_dict_clean = {k: (None if pd.isna(v) else v) for k, v in row_dict.items()}

            csv_id_val = None
            if id_col is not None and row_dict_clean.get(id_col) is not None:
                csv_id_val = str(row_dict_clean.get(id_col))

            db_row = DatasetRow(
                csv_row_id=csv_id_val,
                original_text=str(row_dict_clean.get(first_col, "")) if row_dict_clean.get(first_col) is not None else "",
                row_data=json.dumps(row_dict_clean),
                status="pending"
            )
            db_rows.append(db_row)

        db.bulk_save_objects(db_rows)
        db.commit()

        settings = get_settings(db)
        settings.target_column = first_col
        db.commit()

        return schemas.DatasetSummaryResponse(
            total_rows=len(db_rows),
            labeled_rows=0,
            pending_rows=len(db_rows),
            failed_rows=0,
            columns=columns,
            target_column=first_col
        )

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process CSV file: {str(e)}")

@router.post("/clear", response_model=schemas.ClearResponse)
async def clear_dataset(db: Session = Depends(get_db)):
    try:
        if labeling_manager.is_running:
            labeling_manager.stop()
            await asyncio.sleep(0.5)

        db.query(DatasetRow).delete()
        db.commit()
        return {"success": True, "message": "Dataset cleared successfully."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to clear dataset: {str(e)}")

@router.get("/dataset", response_model=schemas.DatasetSummaryResponse)
def get_dataset(db: Session = Depends(get_db)):
    total = db.query(DatasetRow).count()
    if total == 0:
        return schemas.DatasetSummaryResponse(
            total_rows=0,
            labeled_rows=0,
            pending_rows=0,
            failed_rows=0,
            columns=[]
        )

    labeled = db.query(DatasetRow).filter(DatasetRow.status == "completed").count()
    failed = db.query(DatasetRow).filter(DatasetRow.status == "failed").count()
    processing = db.query(DatasetRow).filter(DatasetRow.status == "processing").count()
    pending = db.query(DatasetRow).filter(DatasetRow.status == "pending").count()

    first_row = db.query(DatasetRow).first()
    columns = []
    if first_row:
        try:
            columns = list(json.loads(first_row.row_data).keys())
        except Exception:
            pass

    settings = get_settings(db)

    return schemas.DatasetSummaryResponse(
        total_rows=total,
        labeled_rows=labeled,
        pending_rows=pending + processing,
        failed_rows=failed,
        columns=columns,
        target_column=settings.target_column
    )

@router.get("/dataset/labels", response_model=schemas.LabelDistributionResponse)
def get_label_distribution(db: Session = Depends(get_db)):
    rows = db.query(DatasetRow).filter(DatasetRow.status == "completed").all()
    if not rows:
        return schemas.LabelDistributionResponse(total_labeled=0, distributions=[])

    counts = {}
    for r in rows:
        lbl = r.ai_label or "Unknown"
        counts[lbl] = counts.get(lbl, 0) + 1

    total_labeled = len(rows)
    distributions = [
        schemas.LabelDistribution(label=lbl, count=c, percentage=round(c / total_labeled * 100, 1))
        for lbl, c in sorted(counts.items(), key=lambda x: -x[1])
    ]

    return schemas.LabelDistributionResponse(
        total_labeled=total_labeled,
        distributions=distributions
    )

@router.post("/start-labeling", response_model=schemas.ProgressResponse)
async def start_labeling(payload: schemas.StartLabelingRequest, db: Session = Depends(get_db)):
    total_rows = db.query(DatasetRow).count()
    if total_rows == 0:
        raise HTTPException(status_code=400, detail="No dataset uploaded. Please upload a CSV first.")

    settings = get_settings(db)

    reset_needed = (settings.target_column != payload.target_column or
                    settings.prompt != payload.prompt or
                    settings.custom_labels != payload.custom_labels)

    settings.provider = payload.provider
    settings.base_url = payload.base_url
    settings.model = payload.model
    settings.prompt = payload.prompt
    settings.target_column = payload.target_column
    settings.custom_labels = payload.custom_labels
    settings.batch_size = payload.batch_size
    settings.workers = payload.workers
    db.commit()

    if reset_needed:
        rows = db.query(DatasetRow).all()
        for r in rows:
            try:
                row_dict = json.loads(r.row_data)
                r.original_text = str(row_dict.get(payload.target_column, ""))
                r.status = "pending"
                r.ai_label = None
                r.ai_response = None
                r.error_message = None
            except Exception:
                pass
        db.commit()
    else:
        rows = db.query(DatasetRow).all()
        for r in rows:
            try:
                row_dict = json.loads(r.row_data)
                r.original_text = str(row_dict.get(payload.target_column, ""))
            except Exception:
                pass
        db.commit()

    started = labeling_manager.start(
        provider=payload.provider,
        base_url=payload.base_url,
        model=payload.model,
        prompt=payload.prompt,
        custom_labels=payload.custom_labels,
        max_batch_size=payload.batch_size,
        num_workers=payload.workers
    )

    if not started and not labeling_manager.is_running:
        raise HTTPException(status_code=500, detail="Failed to start labeling runner.")

    return labeling_manager.get_progress(db)

@router.post("/stop-labeling")
async def stop_labeling(db: Session = Depends(get_db)):
    stopped = labeling_manager.stop()
    if not stopped:
        return {"message": "Labeling process was not running."}
    return {"message": "Labeling process stop requested."}

@router.get("/progress", response_model=schemas.ProgressResponse)
def get_progress(db: Session = Depends(get_db)):
    return labeling_manager.get_progress(db)

@router.get("/progress/stream")
async def progress_stream(request: Request):
    client_queue = asyncio.Queue()
    labeling_manager.clients.append(client_queue)

    db = SessionLocal()
    try:
        initial = labeling_manager.get_progress(db)
        client_queue.put_nowait(initial)
    finally:
        db.close()

    async def sse_event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    progress = await asyncio.wait_for(client_queue.get(), timeout=1.0)
                    yield f"data: {json.dumps(progress)}\n\n"
                    client_queue.task_done()
                except asyncio.TimeoutError:
                    continue
        except asyncio.CancelledError:
            pass
        finally:
            if client_queue in labeling_manager.clients:
                labeling_manager.clients.remove(client_queue)

    return StreamingResponse(sse_event_generator(), media_type="text/event-stream")

@router.post("/benchmark", response_model=schemas.BenchmarkResult)
async def auto_benchmark(payload: schemas.StartLabelingRequest, db: Session = Depends(get_db)):
    total_rows = db.query(DatasetRow).count()
    if total_rows == 0:
        raise HTTPException(status_code=400, detail="No dataset uploaded.")

    samples = db.query(DatasetRow).limit(3).all()
    sample_items = [{"id": str(s.csv_row_id if s.csv_row_id else s.id), "text": s.original_text} for s in samples]

    start_time = time_module.time()
    success = False
    time_taken = 0.0

    from app.services.llm import generate_batch_labels
    try:
        await asyncio.wait_for(
            generate_batch_labels(
                provider=payload.provider,
                base_url=payload.base_url,
                model=payload.model,
                prompt_template=payload.prompt,
                custom_labels=payload.custom_labels,
                items=sample_items
            ),
            timeout=15.0
        )
        time_taken = time_module.time() - start_time
        success = True
    except Exception as e:
        logger.warning(f"Inference benchmark failed, fallback to heuristic: {str(e)}")

    avg_words = sum(len(s.original_text.split()) for s in samples) / len(samples) if samples else 0

    if avg_words <= 25:
        suggested_batch = 20
    elif avg_words <= 100:
        suggested_batch = 12
    elif avg_words <= 400:
        suggested_batch = 6
    else:
        suggested_batch = 4

    optimal_batch_size = min(payload.batch_size, suggested_batch)

    if success:
        latency_per_text = time_taken / len(samples)
        if latency_per_text < 0.4:
            optimal_workers = 4
        elif latency_per_text < 1.2:
            optimal_workers = 2
        else:
            optimal_workers = 1
    else:
        optimal_workers = 2

    optimal_workers = max(1, min(payload.workers, optimal_workers))

    if success:
        latency_per_text = max(0.1, time_taken / len(samples))
        estimated_speed_rpm = (60.0 / latency_per_text) * optimal_workers
        token_throughput = (avg_words * 1.33) / latency_per_text
        error_rate_val = 0.0
    else:
        latency_per_text = max(0.4, (avg_words * 1.33) / 20.0)
        estimated_speed_rpm = (60.0 / latency_per_text) * optimal_workers
        token_throughput = 20.0 * optimal_workers
        error_rate_val = 100.0

    estimated_speed_rpm = max(1.0, estimated_speed_rpm)
    estimated_finish_mins = total_rows / estimated_speed_rpm

    return schemas.BenchmarkResult(
        optimal_batch_size=optimal_batch_size,
        optimal_workers=optimal_workers,
        estimated_speed_rpm=round(estimated_speed_rpm, 1),
        estimated_finish_mins=round(estimated_finish_mins, 1),
        error_rate=round(error_rate_val, 1),
        token_throughput=round(token_throughput, 1)
    )

@router.get("/rows")
def get_rows(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    search: Optional[str] = Query(None),
    label: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("id"),
    sort_order: Optional[str] = Query("asc"),
    db: Session = Depends(get_db)
):
    if sort_by not in ALLOWED_SORT_COLUMNS:
        sort_by = "id"

    query = db.query(DatasetRow)

    if search:
        query = query.filter(DatasetRow.original_text.like(f"%{search}%"))
    if label:
        if label.lower() == "null" or label == "":
            query = query.filter(DatasetRow.ai_label.is_(None))
        else:
            query = query.filter(DatasetRow.ai_label == label)
    if status:
        query = query.filter(DatasetRow.status == status)

    sort_attr = getattr(DatasetRow, sort_by, DatasetRow.id)
    if sort_order == "desc":
        query = query.order_by(desc(sort_attr))
    else:
        query = query.order_by(asc(sort_attr))

    total_count = query.count()
    offset = (page - 1) * limit
    results = query.offset(offset).limit(limit).all()

    serialized_rows = []
    for r in results:
        try:
            row_dict = json.loads(r.row_data)
        except Exception:
            row_dict = {}
        serialized_rows.append({
            "id": r.id,
            "original_text": r.original_text,
            "row_data": row_dict,
            "ai_label": r.ai_label,
            "ai_response": r.ai_response,
            "status": r.status,
            "error_message": r.error_message,
            "updated_at": r.updated_at
        })

    all_labels_query = db.query(DatasetRow.ai_label).filter(DatasetRow.ai_label.isnot(None)).distinct().all()
    unique_labels = [l[0] for l in all_labels_query if l[0]]

    return {
        "total": total_count,
        "page": page,
        "limit": limit,
        "pages": (total_count + limit - 1) // limit,
        "rows": serialized_rows,
        "unique_labels": unique_labels
    }

@router.put("/row/{id}", response_model=schemas.RowResponse)
def update_row(id: int, payload: schemas.RowUpdate, db: Session = Depends(get_db)):
    row = db.query(DatasetRow).filter(DatasetRow.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found.")

    # Audit trail
    old_label = row.ai_label
    new_label = payload.ai_label
    if old_label != new_label:
        history_entry = {
            "from": old_label,
            "to": new_label,
            "timestamp": time_module.time()
        }
        existing_history = []
        if row.edit_history:
            try:
                existing_history = json.loads(row.edit_history)
            except Exception:
                existing_history = []
        existing_history.append(history_entry)
        row.edit_history = json.dumps(existing_history)

    row.ai_label = new_label
    row.status = "completed"
    row.error_message = None
    db.commit()
    db.refresh(row)

    try:
        row_dict = json.loads(row.row_data)
    except Exception:
        row_dict = {}

    return schemas.RowResponse(
        id=row.id,
        original_text=row.original_text,
        row_data=row_dict,
        ai_label=row.ai_label,
        ai_response=row.ai_response,
        status=row.status,
        error_message=row.error_message,
        updated_at=row.updated_at
    )

@router.delete("/row/{id}", response_model=schemas.RowDeleteResponse)
def delete_row(id: int, db: Session = Depends(get_db)):
    row = db.query(DatasetRow).filter(DatasetRow.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found.")

    db.delete(row)
    db.commit()
    return {"success": True, "message": f"Row {id} deleted successfully."}

@router.post("/retry/{id}", response_model=schemas.RowResponse)
def retry_row(id: int, db: Session = Depends(get_db)):
    row = db.query(DatasetRow).filter(DatasetRow.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found.")

    if labeling_manager.is_running:
        raise HTTPException(status_code=400, detail="Labeling is currently running. Stop it first.")

    row.status = "pending"
    row.ai_label = None
    row.ai_response = None
    row.error_message = None
    db.commit()
    db.refresh(row)

    try:
        row_dict = json.loads(row.row_data)
    except Exception:
        row_dict = {}

    return schemas.RowResponse(
        id=row.id,
        original_text=row.original_text,
        row_data=row_dict,
        ai_label=row.ai_label,
        ai_response=row.ai_response,
        status=row.status,
        error_message=row.error_message,
        updated_at=row.updated_at
    )

@router.post("/retry-failed", response_model=schemas.RetryAllResponse)
def retry_all_failed(db: Session = Depends(get_db)):
    if labeling_manager.is_running:
        raise HTTPException(status_code=400, detail="Labeling is currently running. Stop it first.")

    failed_rows = db.query(DatasetRow).filter(DatasetRow.status == "failed").all()
    if not failed_rows:
        return {"success": False, "message": "No failed rows to retry.", "affected_rows": 0}

    for r in failed_rows:
        r.status = "pending"
        r.ai_label = None
        r.ai_response = None
        r.error_message = None
    db.commit()

    return {"success": True, "message": f"Queued {len(failed_rows)} failed rows for retry.", "affected_rows": len(failed_rows)}

@router.get("/models")
async def get_models(provider: str, base_url: str):
    try:
        models = await fetch_provider_models(provider, base_url)
        return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/test-connection", response_model=schemas.TestConnectionResponse)
async def test_connection(payload: schemas.TestConnectionRequest):
    try:
        models = await fetch_provider_models(payload.provider, payload.base_url)
        return schemas.TestConnectionResponse(
            success=True,
            message="Connection successful!",
            models=models
        )
    except Exception as e:
        return schemas.TestConnectionResponse(
            success=False,
            message=str(e),
            models=[]
        )

@router.get("/export")
def export_dataset(
    status: Optional[str] = Query(None),
    label: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(DatasetRow)
    if status:
        query = query.filter(DatasetRow.status == status)
    if label:
        query = query.filter(DatasetRow.ai_label == label)

    rows = query.all()
    if not rows:
        raise HTTPException(status_code=400, detail="No dataset rows match the filter criteria.")

    records = []
    for r in rows:
        try:
            row_dict = json.loads(r.row_data)
        except Exception:
            row_dict = {}

        export_row = row_dict.copy()
        export_row["ai_label"] = r.ai_label
        export_row["ai_response"] = r.ai_response
        export_row["status"] = r.status
        records.append(export_row)

    df = pd.DataFrame(records)
    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)

    response = StreamingResponse(
        iter([csv_buffer.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=labeled_dataset.csv",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )
    return response

@router.get("/settings", response_model=schemas.SettingsResponse)
def get_current_settings(db: Session = Depends(get_db)):
    return get_settings(db)
