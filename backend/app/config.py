"""Application settings, read from environment variables or a `.env` file.

API keys are never stored by the app: providers read them from the environment
variable named in their preset (see `app/llm/registry.py`).
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = BACKEND_DIR / "data"
    cors_origins: str = "http://localhost:3000"
    max_upload_mb: int = 50

    # Default provider/model. The settings page can override these at runtime
    # (persisted in data/settings.json); environment variables are the fallback.
    llm_provider: str = "mock"
    llm_model: str = ""
    # Reasoning effort for models that support it (Anthropic effort, OpenAI reasoning_effort).
    llm_effort: Literal["low", "medium", "high"] = "medium"
    # Send the original PDF to providers that accept PDF input (better equation fidelity).
    use_native_pdf: bool = True
    # Max repair attempts when a model returns JSON that fails schema validation.
    llm_max_repairs: int = 2

    sandbox_backend: Literal["auto", "docker", "subprocess", "disabled"] = "auto"
    sandbox_timeout_s: float = 10.0
    sandbox_docker_image: str = "python:3.12-slim"

    # Optional generic OpenAI-compatible endpoint (LM Studio, vLLM, Together, DeepSeek, ...).
    custom_openai_base_url: str = ""
    custom_openai_model: str = ""
    ollama_base_url: str = "http://localhost:11434/v1"
    # Per-request input budget for local models (Ollama's context window is often small).
    ollama_input_budget_tokens: int = 12000
    # Groq's free plan allows ~8K tokens/minute; enable pacing + small requests.
    groq_free_tier: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


def _load_env_files() -> None:
    """Export `.env` entries to os.environ (real environment variables win).

    pydantic-settings only fills the Settings fields; provider API keys are looked up by
    variable name in os.environ, so they need to be exported as well.
    """
    for path in (BACKEND_DIR / ".env", REPO_DIR / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and value:
                os.environ.setdefault(key, value)


@lru_cache
def get_settings() -> Settings:
    _load_env_files()
    return Settings()
