"""AI Doctor — hardware detection, model recommendations, diagnostics."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from taskforge.config import get_settings


def _subprocess_kwargs() -> dict[str, Any]:
    """Return platform-safe subprocess kwargs.

    On Windows, prevents console window popup from subprocess calls.
    """
    kwargs: dict[str, Any] = {
        "capture_output": True,
        "text": True,
        "timeout": 10,
    }
    if sys.platform == "win32":
        # CREATE_NO_WINDOW = 0x08000000
        kwargs["creationflags"] = 0x08000000
    return kwargs


def _get_ram_gb() -> float | None:
    """Get total RAM in GB (cross-platform)."""
    try:
        if platform.system() == "Linux":
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        return round(kb / (1024 * 1024), 1)
        elif platform.system() == "Windows":
            import ctypes
            kernel32 = ctypes.windll.kernel32
            c_ulonglong = ctypes.c_ulonglong
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", c_ulonglong),
                    ("ullAvailPhys", c_ulonglong),
                    ("ullTotalPageFile", c_ulonglong),
                    ("ullAvailPageFile", c_ulonglong),
                    ("ullTotalVirtual", c_ulonglong),
                    ("ullAvailVirtual", c_ulonglong),
                    ("ullAvailExtendedVirtual", c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(stat)
            kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return round(stat.ullTotalPhys / (1024**3), 1)
        elif platform.system() == "Darwin":
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                **_subprocess_kwargs(),
            )
            if result.returncode == 0:
                return round(int(result.stdout.strip()) / (1024**3), 1)
    except Exception:
        pass
    return None


def _get_gpu_info() -> dict[str, Any]:
    """Detect NVIDIA GPU via nvidia-smi (cross-platform)."""
    result: dict[str, Any] = {"available": False}
    try:
        proc = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version",
             "--format=csv,noheader,nounits"],
            **_subprocess_kwargs(),
        )
        if proc.returncode == 0:
            lines = proc.stdout.strip().split("\n")
            gpus = []
            for line in lines:
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 4:
                    gpus.append({
                        "name": parts[0],
                        "vram_mb": int(parts[1]),
                        "vram_free_mb": int(parts[2]),
                        "driver": parts[3],
                    })
            if gpus:
                result["available"] = True
                result["gpus"] = gpus
    except FileNotFoundError:
        result["detail"] = "nvidia-smi not found"
    except Exception as exc:
        result["detail"] = str(exc)
    return result


def _get_cuda_available() -> bool:
    """Check if CUDA is available (try torch or just nvidia-smi)."""
    try:
        import torch  # type: ignore[import-untyped]
        return torch.cuda.is_available()
    except ImportError:
        pass
    # Fallback: nvidia-smi
    return shutil.which("nvidia-smi") is not None


def _dir_size_mb(path: Path) -> float | None:
    """Calculate total size of directory in MB."""
    if not path.exists():
        return None
    total = 0
    try:
        for f in path.rglob("*"):
            if f.is_file():
                total += f.stat().st_size
    except PermissionError:
        pass
    return round(total / (1024 * 1024), 1)


def _recommend_profile(ram_gb: float | None, gpu_info: dict[str, Any]) -> str:
    """Recommend a model profile based on hardware."""
    vram = 0
    if gpu_info.get("available") and gpu_info.get("gpus"):
        vram = gpu_info["gpus"][0].get("vram_mb", 0)

    ram = ram_gb or 8

    if vram >= 8000 and ram >= 16:
        return "heavy (phi3:medium or larger — you have plenty of VRAM and RAM)"
    if vram >= 4000:
        return "reason (phi3:mini — good GPU, use GPU layers for speed)"
    if ram >= 12:
        return "default (phi3:mini — CPU mode, sufficient RAM)"
    return "fast (phi3:mini quantized — limited RAM, keep models small)"


def _estimate_model_memory(model_name: str) -> str:
    """Rough memory estimate based on model name patterns."""
    name = model_name.lower()
    if "medium" in name or "14b" in name:
        return "~8-10 GB RAM"
    if "mini" in name or "3b" in name or "3.8b" in name:
        return "~2-4 GB RAM"
    if "small" in name or "7b" in name:
        return "~4-6 GB RAM"
    if "large" in name or "70b" in name:
        return "~40+ GB RAM"
    return "~2-6 GB RAM (estimate)"


def run_doctor(console: Console | None = None) -> dict[str, Any]:
    """Run full diagnostics and print results."""
    con = console or Console()
    settings = get_settings()

    ram = _get_ram_gb()
    gpu = _get_gpu_info()
    cuda = _get_cuda_available()
    recommendation = _recommend_profile(ram, gpu)

    # Model paths and sizes
    ollama_path = settings.ollama_models_path
    ollama_size = _dir_size_mb(ollama_path) if ollama_path else None

    gguf_path = settings.gguf_path
    gguf_size = _dir_size_mb(gguf_path) if gguf_path.exists() else None

    report: dict[str, Any] = {
        "provider": settings.ai_provider,
        "active_model": settings.ai_model_default,
        "model_tiers": {
            "default": settings.ai_model_default,
            "fast": settings.ai_model_fast,
            "reason": settings.ai_model_reason,
            "heavy": settings.ai_model_heavy,
        },
        "ollama_host": settings.ollama_host,
        "ollama_models_path": str(ollama_path) if ollama_path else "not found",
        "ollama_disk_mb": ollama_size,
        "gguf_model_dir": str(gguf_path),
        "gguf_disk_mb": gguf_size,
        "ram_gb": ram,
        "gpu": gpu,
        "cuda_available": cuda,
        "recommendation": recommendation,
    }

    # ── Display ───────────────────────────────────────────────────────

    con.print(Panel("TaskForge AI Doctor", style="cyan"))

    # System info
    sys_table = Table(title="System", show_header=False, border_style="dim")
    sys_table.add_column("Key", style="bold")
    sys_table.add_column("Value")
    sys_table.add_row("Platform", f"{platform.system()} {platform.release()}")
    sys_table.add_row("RAM", f"{ram} GB" if ram else "unknown")
    sys_table.add_row("CUDA", "available" if cuda else "not detected")

    if gpu.get("available"):
        for g in gpu.get("gpus", []):
            sys_table.add_row(
                "GPU", f"{g['name']} — {g['vram_mb']} MB VRAM ({g['vram_free_mb']} MB free)"
            )
    else:
        sys_table.add_row("GPU", gpu.get("detail", "not detected"))

    con.print(sys_table)

    # AI config
    ai_table = Table(title="AI Configuration", show_header=False, border_style="dim")
    ai_table.add_column("Key", style="bold")
    ai_table.add_column("Value")
    ai_table.add_row("Provider", settings.ai_provider)
    ai_table.add_row("Ollama Host", settings.ollama_host)
    ai_table.add_row("Default Model", settings.ai_model_default)
    ai_table.add_row("Fast Model", settings.ai_model_fast)
    ai_table.add_row("Reason Model", settings.ai_model_reason)
    ai_table.add_row("Heavy Model", settings.ai_model_heavy)
    con.print(ai_table)

    # Storage
    stor_table = Table(title="Model Storage", show_header=False, border_style="dim")
    stor_table.add_column("Key", style="bold")
    stor_table.add_column("Value")
    stor_table.add_row(
        "Ollama Models",
        f"{ollama_path} ({ollama_size} MB)" if ollama_path and ollama_size else str(ollama_path or "not found"),
    )
    stor_table.add_row(
        "GGUF Models",
        f"{gguf_path} ({gguf_size} MB)" if gguf_size else str(gguf_path),
    )

    # Env vars
    env_vars = ["HF_HOME", "TRANSFORMERS_CACHE", "HUGGINGFACE_HUB_CACHE", "GGUF_MODEL_DIR", "OLLAMA_MODELS_DIR"]
    for var in env_vars:
        val = os.environ.get(var)
        if val:
            stor_table.add_row(var, val)

    con.print(stor_table)

    # Recommendation
    con.print(Panel(f"Recommendation: {recommendation}", style="green"))

    return report
