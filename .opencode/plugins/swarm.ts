import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { tool, type Plugin } from "@opencode-ai/plugin"

export interface SwarmTask {
  id: string
  title: string
  description: string
  targetFiles: string[]
  dependencies: string[]
  status: "pending" | "in_progress" | "passed" | "failed"
}

export interface WorktreeManagerOptions {
  baseDir?: string
  baseBranch?: string
}

class WorktreeManager {
  private baseDir: string
  private baseBranch: string

  constructor(options: WorktreeManagerOptions = {}) {
    this.baseDir = options.baseDir ?? process.cwd()
    this.baseBranch = options.baseBranch ?? "master"
  }

  get rootDir(): string {
    return path.join(this.baseDir, ".swarm", "worktrees")
  }

  worktreePath(taskId: string): string {
    return path.join(this.rootDir, `task-${taskId}`)
  }

  branchName(taskId: string): string {
    return `swarm/task-${taskId}`
  }

  private git(args: string): string {
    return execSync(`git -C "${this.baseDir}" ${args}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    })
  }

  private branchExists(branchName: string): boolean {
    try {
      this.git(`rev-parse --verify --quiet "refs/heads/${branchName}"`)
      return true
    } catch {
      return false
    }
  }

  private ensureBaseCommit(): void {
    try {
      this.git("rev-parse --verify --quiet HEAD")
    } catch {
      throw new Error(
        `Cannot create a swarm worktree: branch "${this.baseBranch}" has no commit yet. Create an initial commit first.`,
      )
    }
  }

  createWorktree(taskId: string): string {
    this.ensureBaseCommit()
    const worktreePath = this.worktreePath(taskId)
    const branchName = this.branchName(taskId)
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
    if (this.branchExists(branchName)) {
      this.git(`worktree add "${worktreePath}" ${branchName}`)
    } else {
      this.git(`worktree add -b ${branchName} "${worktreePath}" ${this.baseBranch}`)
    }
    return worktreePath
  }

  removeWorktree(taskId: string): void {
    const worktreePath = this.worktreePath(taskId)
    const branchName = this.branchName(taskId)
    try {
      this.git(`worktree remove --force "${worktreePath}"`)
    } catch (error) {
      console.warn(`[swarm] worktree remove warning for task ${taskId}:`, error)
    }
    try {
      this.git(`branch -D ${branchName}`)
    } catch (error) {
      console.warn(`[swarm] branch delete warning for task ${taskId}:`, error)
    }
  }

  mergeWorktree(taskId: string, targetBranch?: string): boolean {
    const branchName = this.branchName(taskId)
    const target = targetBranch ?? this.baseBranch
    try {
      this.git(`checkout ${target}`)
      this.git(`merge --no-ff ${branchName} -m "swarm: merge completed task ${taskId}"`)
      return true
    } catch (error) {
      console.error(`[swarm] merge conflict for task ${taskId}; aborting auto-merge.`, error)
      try {
        this.git("merge --abort")
      } catch {}
      return false
    }
  }

  status(taskId: string): string {
    const worktreePath = this.worktreePath(taskId)
    const branchName = this.branchName(taskId)
    return JSON.stringify(
      {
        taskId,
        branch: branchName,
        path: worktreePath,
        worktreeExists: fs.existsSync(worktreePath),
        branchExists: this.branchExists(branchName),
      },
      null,
      2,
    )
  }
}

const resolveBaseDir = (directory?: string, worktree?: string): string => {
  if (worktree && worktree.length > 0) return worktree
  if (directory && directory.length > 0) return directory
  return process.cwd()
}

export const SwarmPlugin: Plugin = async ({ directory, worktree }) => {
  const fallbackBaseDir = resolveBaseDir(directory, worktree)
  return {
    tool: {
      swarm_create_worktree: tool({
        description:
          "Create an isolated git worktree and branch (swarm/task-<id>) under .swarm/worktrees for a swarm task.",
        args: {
          taskId: tool.schema.string().describe("Unique swarm task id, e.g. t1"),
          baseBranch: tool.schema.string().optional().describe("Branch to fork from (default: master)"),
        },
        async execute(args, context) {
          const manager = new WorktreeManager({
            baseDir: resolveBaseDir(context.directory, context.worktree) || fallbackBaseDir,
            baseBranch: args.baseBranch,
          })
          const worktreePath = manager.createWorktree(args.taskId)
          return { title: `swarm worktree task-${args.taskId}`, output: worktreePath }
        },
      }),
      swarm_remove_worktree: tool({
        description:
          "Force-remove a swarm worktree and delete its branch. Use after a task is merged or abandoned.",
        args: {
          taskId: tool.schema.string().describe("Swarm task id to clean up"),
        },
        async execute(args, context) {
          const manager = new WorktreeManager({
            baseDir: resolveBaseDir(context.directory, context.worktree) || fallbackBaseDir,
          })
          manager.removeWorktree(args.taskId)
          return {
            title: `swarm cleanup task-${args.taskId}`,
            output: `Removed worktree and branch for task ${args.taskId}.`,
          }
        },
      }),
      swarm_merge_worktree: tool({
        description:
          "Merge a verified swarm task branch into the base branch with --no-ff. Only call after tests passed in the worktree. Aborts on conflict.",
        args: {
          taskId: tool.schema.string().describe("Swarm task id to merge"),
          targetBranch: tool.schema.string().optional().describe("Branch to merge into (default: master)"),
        },
        async execute(args, context) {
          const manager = new WorktreeManager({
            baseDir: resolveBaseDir(context.directory, context.worktree) || fallbackBaseDir,
          })
          const merged = manager.mergeWorktree(args.taskId, args.targetBranch)
          return {
            title: `swarm merge task-${args.taskId}`,
            output: merged
              ? `Merged swarm/task-${args.taskId} successfully.`
              : `Merge conflict for task ${args.taskId}; auto-merge aborted. Resolve manually.`,
          }
        },
      }),
      swarm_worktree_status: tool({
        description: "Report whether a swarm worktree and branch exist for a task.",
        args: {
          taskId: tool.schema.string().describe("Swarm task id to inspect"),
        },
        async execute(args, context) {
          const manager = new WorktreeManager({
            baseDir: resolveBaseDir(context.directory, context.worktree) || fallbackBaseDir,
          })
          return { title: `swarm status task-${args.taskId}`, output: manager.status(args.taskId) }
        },
      }),
    },
  }
}
