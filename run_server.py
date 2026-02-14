import subprocess
import threading

def stream_reader(pipe, output_file):
    with open(output_file, "a", encoding="utf-8") as f:
        for line in iter(pipe.readline, b""):
            try:
                decoded = line.decode("utf-8", errors="replace")
                f.write(decoded)
                f.flush()
                print(decoded, end="") # also print to console
            except Exception:
                pass

import sys
import os

# ... (stream_reader matches previous)

cmd = [sys.executable, "-m", "taskforge", "gui"]
print(f"Starting server: {cmd}")

env = os.environ.copy()
env["PYTHONPATH"] = os.getcwd() + "\\src;" + env.get("PYTHONPATH", "")
env["PYTHONIOENCODING"] = "utf-8"

with open("server.log", "w", encoding="utf-8") as f:
    f.write("Starting server log...\n")

process = subprocess.Popen(
    cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
    # bufsize default
)

t1 = threading.Thread(target=stream_reader, args=(process.stdout, "server.log"))
t2 = threading.Thread(target=stream_reader, args=(process.stderr, "server.log"))
t1.start()
t2.start()

try:
    process.wait()
except KeyboardInterrupt:
    process.terminate()
