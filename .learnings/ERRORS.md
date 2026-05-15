# Errors

Command failures and integration errors.

---

## [ERR-20260514-002] zsh-status-variable-shadowing

**Logged**: 2026-05-14T11:27:30+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary

A shell test wrapper assigned to `status`, which is a read-only special variable in zsh.

### Error

```text
zsh:1: read-only variable: status
```

### Context

- Command attempted to capture a test command's exit code after redirecting output to `/tmp`.
- zsh reserves `status`, so assignment fails before diagnostic grep runs.

### Suggested Fix

Use `exit_code`, `cmd_status`, or another neutral variable name for captured command status.

### Metadata

- Reproducible: yes
- Related Files: none

### Resolution

- **Resolved**: 2026-05-14T11:27:30+08:00
- **Notes**: Retried the command with `exit_code`.

---

## [ERR-20260514-001] zsh-path-variable-shadowing

**Logged**: 2026-05-14T11:19:17+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary

A shell loop used the variable name `path` in zsh, which shadowed zsh's special `path` array and broke command lookup.

### Error

```text
zsh:6: command not found: git
```

### Context

- Command attempted to iterate unmerged Git paths and resolve conflicts.
- In zsh, assigning to `path` mutates the command search path.

### Suggested Fix

Use a neutral variable name such as `file_path` in zsh shell loops.

### Metadata

- Reproducible: yes
- Related Files: none

### Resolution

- **Resolved**: 2026-05-14T11:19:17+08:00
- **Notes**: Retry the conflict-resolution loop using `file_path` instead of `path`.

---
