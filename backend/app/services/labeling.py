import asyncio
import logging
import time
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import DatasetRow

logger = logging.getLogger(__name__)

class LabelingManager:
    def __init__(self):
        self.is_running = False
        self.is_cancelled = False
        self._workers_tasks = []
        self.current_row_id = None
        self.start_time = None
        self.clients = []
        self.db_lock = asyncio.Lock()
        self._start_lock = asyncio.Lock()

    def get_progress(self, db: Session) -> dict:
        total = db.query(DatasetRow).count()
        completed = db.query(DatasetRow).filter(DatasetRow.status == "completed").count()
        failed = db.query(DatasetRow).filter(DatasetRow.status == "failed").count()
        pending = db.query(DatasetRow).filter(DatasetRow.status == "pending").count()
        processing = db.query(DatasetRow).filter(DatasetRow.status == "processing").count()

        pending_total = pending + processing
        percentage = (completed / total * 100) if total > 0 else 0.0

        elapsed = None
        remaining = None
        if self.start_time is not None and self.is_running:
            elapsed = time.time() - self.start_time
            done = completed + failed
            if done > 0:
                rate = done / elapsed
                if rate > 0:
                    remaining = (total - done) / rate

        return {
            "total": total,
            "completed": completed,
            "pending": pending_total,
            "failed": failed,
            "percentage": round(percentage, 2),
            "is_running": self.is_running,
            "current_row_id": self.current_row_id,
            "elapsed_seconds": round(elapsed, 1) if elapsed is not None else None,
            "estimated_remaining_seconds": round(remaining, 1) if remaining is not None else None
        }

    def broadcast_progress(self, db: Session):
        progress = self.get_progress(db)
        for client_queue in list(self.clients):
            try:
                client_queue.put_nowait(progress)
            except Exception:
                pass

    def start(self, provider: str, base_url: str, model: str, prompt: str, custom_labels: str, max_batch_size: int, num_workers: int) -> bool:
        if self.is_running:
            return False

        self.is_running = True
        self.is_cancelled = False
        self.current_row_id = None
        self.start_time = time.time()

        asyncio.create_task(
            self._run_labeling_pool(provider, base_url, model, prompt, custom_labels, max_batch_size, num_workers)
        )
        return True

    def stop(self):
        if not self.is_running:
            return False
        self.is_cancelled = True
        return True

    async def _run_labeling_pool(
        self,
        provider: str,
        base_url: str,
        model: str,
        prompt_template: str,
        custom_labels: str,
        max_batch_size: int,
        num_workers: int
    ):
        db = SessionLocal()
        try:
            pending_rows = db.query(DatasetRow).filter(
                DatasetRow.status.in_(["pending", "failed", "processing"])
            ).order_by(DatasetRow.id.asc()).all()

            if not pending_rows:
                logger.info("No pending rows to label.")
                self.is_running = False
                self.broadcast_progress(db)
                return

            for r in pending_rows:
                r.status = "pending"
            db.commit()

            avg_word_count = sum(len(r.original_text.split()) for r in pending_rows) / len(pending_rows)

            if avg_word_count <= 25:
                adaptive_size = 30
            elif avg_word_count <= 100:
                adaptive_size = 15
            elif avg_word_count <= 400:
                adaptive_size = 8
            else:
                adaptive_size = 4

            batch_size = min(max_batch_size, adaptive_size)
            logger.info(f"Adaptive batch sizing calculated: avg_words={avg_word_count:.1f}, batch_size={batch_size}")

            items = []
            for r in pending_rows:
                stable_id = r.csv_row_id if r.csv_row_id else str(r.id)
                items.append({
                    "id": stable_id,
                    "db_id": r.id,
                    "text": r.original_text
                })

            batches = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]

            queue = asyncio.Queue()
            for b in batches:
                await queue.put((b, 0))

            self._workers_tasks = []
            for w_idx in range(num_workers):
                task = asyncio.create_task(
                    self._worker(w_idx, queue, provider, base_url, model, prompt_template, custom_labels)
                )
                self._workers_tasks.append(task)

            await queue.join()

            for task in self._workers_tasks:
                if not task.done():
                    task.cancel()

            await asyncio.gather(*self._workers_tasks, return_exceptions=True)

        except Exception as e:
            logger.error(f"Fatal error in queue processor: {str(e)}")
        finally:
            self.is_running = False
            self.is_cancelled = False
            self.start_time = None
            self.broadcast_progress(db)
            db.close()

    async def _worker(
        self,
        worker_id: int,
        queue: asyncio.Queue,
        provider: str,
        base_url: str,
        model: str,
        prompt_template: str,
        custom_labels: str
    ):
        db = SessionLocal()
        from app.services.llm import generate_batch_labels

        try:
            while not self.is_cancelled:
                try:
                    batch_data, attempts = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                logger.info(f"Worker {worker_id} popped batch of size {len(batch_data)} (attempt {attempts})")

                db_ids = [item["db_id"] for item in batch_data]
                async with self.db_lock:
                    db.query(DatasetRow).filter(DatasetRow.id.in_(db_ids)).update({"status": "processing"}, synchronize_session=False)
                    db.commit()
                self.broadcast_progress(db)

                prompt_items = [{"id": item["id"], "text": item["text"]} for item in batch_data]

                try:
                    results = await generate_batch_labels(
                        provider=provider,
                        base_url=base_url,
                        model=model,
                        prompt_template=prompt_template,
                        custom_labels=custom_labels,
                        items=prompt_items
                    )

                    async with self.db_lock:
                        for item in batch_data:
                            row_id = item["id"]
                            db_id = item["db_id"]
                            res_item = results.get(row_id, {"label": "Error", "raw_response": "Failed validation"})

                            row = db.query(DatasetRow).filter(DatasetRow.id == db_id).first()
                            if row:
                                row.ai_label = res_item["label"]
                                row.ai_response = res_item["raw_response"]
                                row.status = "completed"
                                row.error_message = None
                        db.commit()

                    logger.info(f"Worker {worker_id} successfully labeled batch of size {len(batch_data)}")
                    queue.task_done()
                    self.broadcast_progress(db)

                except Exception as e:
                    logger.warning(f"Worker {worker_id} encountered batch error (size {len(batch_data)}): {str(e)}")

                    if attempts >= 5:
                        logger.error(f"Worker {worker_id} exceeded maximum progressive split attempts. Failing all rows in batch.")
                        async with self.db_lock:
                            db.query(DatasetRow).filter(DatasetRow.id.in_(db_ids)).update(
                                {"status": "failed", "error_message": f"Exceeded split retry attempts: {str(e)}"},
                                synchronize_session=False
                            )
                            db.commit()
                        queue.task_done()
                        self.broadcast_progress(db)
                        continue

                    if len(batch_data) > 1:
                        mid = len(batch_data) // 2
                        left = batch_data[:mid]
                        right = batch_data[mid:]

                        logger.info(f"Worker {worker_id} splitting batch of {len(batch_data)} -> {len(left)} and {len(right)}")

                        async with self.db_lock:
                            db.query(DatasetRow).filter(DatasetRow.id.in_(db_ids)).update({"status": "pending"}, synchronize_session=False)
                            db.commit()

                        await queue.put((left, attempts + 1))
                        await queue.put((right, attempts + 1))
                        queue.task_done()
                        self.broadcast_progress(db)
                    else:
                        single_item = batch_data[0]
                        db_id = single_item["db_id"]

                        if attempts < 1:
                            logger.info(f"Worker {worker_id} retrying single row ID {db_id}")
                            await queue.put((batch_data, attempts + 1))
                            queue.task_done()
                        else:
                            async with self.db_lock:
                                row = db.query(DatasetRow).filter(DatasetRow.id == db_id).first()
                                if row:
                                    row.status = "failed"
                                    row.error_message = str(e)
                                db.commit()
                            logger.error(f"Worker {worker_id} failed single row ID {db_id} after retries: {str(e)}")
                            queue.task_done()
                            self.broadcast_progress(db)

        except asyncio.CancelledError:
            logger.info(f"Worker {worker_id} cancelled.")
        finally:
            db.close()

labeling_manager = LabelingManager()
