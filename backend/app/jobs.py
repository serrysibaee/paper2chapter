"""In-process background jobs with progress persisted to the paper record.

Jobs run as asyncio tasks inside the API process. This is deliberately simple: a restart
interrupts running jobs (they are marked failed on startup and can be retried). A task queue
(e.g. arq/Celery) is the upgrade path if jobs need to survive restarts or scale out.
"""

import asyncio
import logging
import traceback
from collections.abc import Awaitable, Callable

from .models import JobKind, JobState, PaperRecord, PaperStatus, utcnow
from .storage import Store

log = logging.getLogger(__name__)

RUNNING_STATUS: dict[JobKind, PaperStatus] = {
    "extract": "extracting",
    "analyze": "analyzing",
    "generate": "generating",
}


class UserFacingError(Exception):
    """An error whose message is safe and useful to show in the UI."""


class Progress:
    """Callback handle passed to job functions."""

    def __init__(self, store: Store, paper_id: str):
        self.store = store
        self.paper_id = paper_id

    def update(self, stage: str, progress: float, message: str = "") -> None:
        rec = self.store.get_paper(self.paper_id)
        if rec.job is None:
            return
        rec.job.stage = stage
        rec.job.progress = max(0.0, min(1.0, progress))
        rec.job.message = message
        if message:
            rec.job.log = (rec.job.log + [f"{utcnow()} {message}"])[-200:]
        self.store.save_paper(rec)

    def log(self, message: str) -> None:
        rec = self.store.get_paper(self.paper_id)
        if rec.job is not None:
            rec.job.log = (rec.job.log + [f"{utcnow()} {message}"])[-200:]
            self.store.save_paper(rec)


JobFn = Callable[[Progress], Awaitable[PaperStatus]]


class JobManager:
    def __init__(self, store: Store):
        self.store = store
        self.tasks: dict[str, asyncio.Task] = {}

    def is_running(self, paper_id: str) -> bool:
        t = self.tasks.get(paper_id)
        return t is not None and not t.done()

    def start(self, paper_id: str, kind: JobKind, fn: JobFn) -> PaperRecord:
        if self.is_running(paper_id):
            raise UserFacingError("A job is already running for this paper.")
        rec = self.store.get_paper(paper_id)
        rec.job = JobState(kind=kind, stage="queued", message=f"{kind} started")
        rec.status = RUNNING_STATUS[kind]
        self.store.save_paper(rec)
        self.tasks[paper_id] = asyncio.create_task(self._run(paper_id, kind, fn))
        return rec

    async def _run(self, paper_id: str, kind: JobKind, fn: JobFn) -> None:
        progress = Progress(self.store, paper_id)
        try:
            final_status = await fn(progress)
            rec = self.store.get_paper(paper_id)
            rec.status = final_status
            if rec.job:
                rec.job.status = "succeeded"
                rec.job.progress = 1.0
                rec.job.stage = "done"
                rec.job.finished_at = utcnow()
            self.store.save_paper(rec)
        except Exception as exc:  # report every failure to the UI
            if isinstance(exc, UserFacingError):
                message = str(exc)
            else:
                log.error("job %s/%s failed:\n%s", paper_id, kind, traceback.format_exc())
                message = f"{type(exc).__name__}: {exc}"
            try:
                rec = self.store.get_paper(paper_id)
            except Exception:
                return  # paper was deleted mid-job
            rec.status = "failed"
            if rec.job:
                rec.job.status = "failed"
                rec.job.error = message
                rec.job.finished_at = utcnow()
            self.store.save_paper(rec)

    def mark_interrupted(self) -> None:
        """Called at startup: jobs that were running when the process died cannot resume."""
        for rec in self.store.list_papers():
            if rec.job and rec.job.status == "running":
                rec.job.status = "failed"
                rec.job.error = "Interrupted by a server restart. Please retry."
                rec.job.finished_at = utcnow()
                rec.status = "failed"
                self.store.save_paper(rec)
