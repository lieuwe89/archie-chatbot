---
name: project-checkpoint
description: Saves project progress with git push and documentation. Use when the user wants to take a break or /clear the session. It handles git initialization, committing, pushing, and creating a checkpoint summary.
---

# Project Checkpoint

This skill automates the process of saving current progress, documenting the session's achievements and pending tasks, and pushing changes to a remote repository.

## Workflow

1.  **Identify Project Root:** Ensure you are in the project's root directory (where `.git` or `build.gradle`, `package.json`, etc., are located).
2.  **Git Initialization:** If the project is not a git repository, run `git init`.
3.  **Stage Changes:** Add all relevant changes with `git add .`.
4.  **Generate Session Summary:** Create or update a documentation file (e.g., `DOCS_CHECKPOINT.md`) that summarizes:
    *   **Completed:** Key tasks and bug fixes finished in this session.
    *   **Pending:** Tasks that were in progress or planned next.
    *   **Context:** Any specific technical details or state (e.g., specific file paths, build errors) needed for the next session.
5.  **Commit:** Commit the changes with a descriptive message.
6.  **Push:** If a remote repository exists (`git remote -v`), perform a `git push`. If not, notify the user.
7.  **Final Instructions:** Remind the user to run the `/clear` command to finish the session.

## Detailed Steps

### 1. Documentation Template

Use the following format for `DOCS_CHECKPOINT.md`:

```markdown
# Project Checkpoint - [Current Date]

## Last Session Summary
- **Accomplishments:**
  - [Task 1]
  - [Task 2]
- **Current State:**
  - [Brief description of the codebase state]
- **Remaining Work:**
  - [Next task 1]
  - [Next task 2]
- **Technical Notes:**
  - [Specific details like paths or configs]
```

### 2. Git Commands

-   `git init` (if needed)
-   `git add .`
-   `git commit -m "Checkpoint: [Summary of changes]"`
-   `git push [remote] [branch]` (usually `origin main` or `origin master`)

### 3. Clear Session

Tell the user: "Checkpoint complete. You can now safely run `/clear` to start a fresh session."
