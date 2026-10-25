"""Exit when the process that started the backend is gone.

The Obsidian plugin starts the backend as a child process and passes its own PID in
P2C_PARENT_PID. If Obsidian quits or crashes without stopping it (a window reload, for example,
never runs the plugin's unload), the backend would keep running in the background. This thread
notices the parent is gone and ends the process.
"""

import logging
import os
import sys
import threading
import time

log = logging.getLogger(__name__)


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return bool(ok) and code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch_parent(pid: int, interval_s: float = 5.0, on_gone=None) -> threading.Thread:
    """Start a daemon thread that calls `on_gone` (default: exit the process) once `pid` dies."""

    def exit_now() -> None:
        log.warning("parent process %d is gone; shutting down", pid)
        os._exit(0)

    def run() -> None:
        while pid_alive(pid):
            time.sleep(interval_s)
        (on_gone or exit_now)()

    t = threading.Thread(target=run, name="parent-watchdog", daemon=True)
    t.start()
    return t
