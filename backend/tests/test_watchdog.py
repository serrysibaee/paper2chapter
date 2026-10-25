"""The parent watchdog that stops a plugin-started backend once Obsidian is gone."""

import os
import subprocess
import sys
import threading

from app.watchdog import pid_alive, watch_parent


def test_pid_alive():
    assert pid_alive(os.getpid())
    assert not pid_alive(0)
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    assert not pid_alive(proc.pid)


def test_watchdog_fires_when_parent_exits():
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.5)"])
    gone = threading.Event()
    watch_parent(proc.pid, interval_s=0.1, on_gone=gone.set)
    assert not gone.wait(0.2)
    proc.wait()
    assert gone.wait(5)
