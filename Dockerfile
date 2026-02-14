FROM python:3.12-slim

# Build args
ARG DEBIAN_FRONTEND=noninteractive

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash taskforge
USER taskforge
WORKDIR /home/taskforge/app

# Copy project files
COPY --chown=taskforge:taskforge pyproject.toml README.md ./
COPY --chown=taskforge:taskforge src/ src/

# Install TaskForge
RUN pip install --user --no-cache-dir -e .

# Ensure scripts are on PATH
ENV PATH="/home/taskforge/.local/bin:${PATH}"

# Mount points for persistent data
VOLUME ["/home/taskforge/app/data", "/home/taskforge/app/out"]

# Default command
ENTRYPOINT ["jira-assist"]
CMD ["--help"]
