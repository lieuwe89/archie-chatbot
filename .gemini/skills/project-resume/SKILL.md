---
name: project-resume
description: Loads project progress from a previous checkpoint. Use when the user wants to pick up where they left off in a previous session, particularly after a /clear or a new terminal session.
---

# Project Resume

This skill helps the agent quickly regain context by reading session documentation left during a previous checkpoint.

## Workflow

1.  **Locate Checkpoint Documentation:** Search the project root for files named `DOCS_CHECKPOINT.md` or similar (e.g., `checkpoint.md`, `summary.md`).
2.  **Read and Process:** Read the content of the checkpoint file.
3.  **Summarize Context:**
    *   State the last accomplishments.
    *   Explain the current state of the codebase.
    *   List the next tasks to be performed.
    *   Inform the user about any important technical notes from the previous session.
4.  **Confirm and Proceed:** Ask the user if they'd like to proceed with the next task identified in the checkpoint or if they have a new objective.

## Tips

-   If the checkpoint file is missing, check the `git log` to see recent commit messages for context.
-   Always check the project's root files (like `build.gradle`, `package.json`) to confirm the project's technology stack.
-   Verify if any pending tasks from the last session were already partially completed.
