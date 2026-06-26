from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.api.routes import router
from app.services.labeling import labeling_manager

Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    if labeling_manager.is_running:
        labeling_manager.stop()

app = FastAPI(
    title="Auto Labeler Local AI API",
    description="Backend API for local automatic labeling of datasets using local LLMs",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/")
def read_root():
    return {"message": "Auto Labeler Local AI API is running."}
