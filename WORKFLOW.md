# JuzTracker Development Workflow

## Branch Strategy

This project uses a **beta-first development workflow**:

- **`main`** - Stable, production-ready releases only
- **`beta`** - Active development branch (default working branch)
- **Feature branches** - For individual features (optional, for larger work)

## Daily Development

### 1. Start Your Day
```bash
# Make sure you're on beta branch
git checkout beta

# Pull latest changes
git fetch origin
git pull origin beta
```

### 2. Make Changes
- Edit files as needed
- All development happens on the `beta` branch
- Commit frequently with clear messages

### 3. Push Changes
```bash
git push origin beta
```

## Releasing to Production

### When Beta is Stable

1. **Test thoroughly** on the beta branch
2. **Create a release PR** (via GitHub website):
   - Base: `main`
   - Compare: `beta`
3. **Review and merge** the PR
4. **Create a release tag**:
   ```bash
   git checkout main
   git pull origin main
   git tag -a v1.0.0 -m "Release version 1.0.0"
   git push origin v1.0.0
   ```

## VS Code Integration

### Switching Branches
1. Click the branch name in the bottom-left corner
2. Select the branch you want to switch to
3. VS Code will checkout that branch

### Publishing New Branches
When you create a new branch, VS Code will prompt you to "Publish Branch" - click it to push to GitHub.

### Source Control Panel
- `Ctrl+Shift+G` opens the Source Control panel
- Stage changes, write commit messages, and commit
- Click the sync button to push/pull

## Git Warning Note

You may see a warning about `.git\refs\remotes\origin\main` - this is harmless and occurs because Git stores some references in packed format for efficiency. The repository works correctly.

## Quick Reference

| Action | Command |
|--------|---------|
| Switch to beta | `git checkout beta` |
| Update beta from remote | `git pull origin beta` |
| Push changes to beta | `git push origin beta` |
| Create release tag | `git tag -a v1.0.0 -m "Message"` |
| Push tag | `git push origin v1.0.0` |

## Emergency Hotfix

If you need to fix something on main urgently:

1. `git checkout main`
2. `git pull origin main`
3. Make fix and commit
4. `git push origin main`
5. `git checkout beta`
6. `git merge main` (to bring fix into beta)
7. `git push origin beta`