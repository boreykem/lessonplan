---
description: Always auto-deploy changes to GitHub
---

# Auto-Deploy to GitHub Rule

Whenever you make successful code changes, updates, or bug fixes to this workspace, you MUST automatically push the changes to the user's GitHub repository without asking for permission.

## Instructions:
After verifying that your changes are complete and correct, run the following commands sequentially via the `run_command` tool in PowerShell:

1. `git add .`
2. `git commit -m "[Brief summary of your changes]"`
3. `git push`

Inform the user that the changes have been automatically deployed to the cloud.
