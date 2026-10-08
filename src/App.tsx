import { useState } from "react"
import type { FormEvent } from "react"
import { useTheme } from "@/components/theme-provider"

type TerminalLine = {
  kind: "command" | "output" | "success" | "error"
  text: string
}

type RepoFile = {
  path: string
  sha: string
  content: string
  originalContent: string
  size: number
  staged: boolean
  deleted: boolean
}

type Repository = {
  owner: string
  name: string
  branch: string
  url: string
}

const commandCards = [
  {
    command: "git status",
    description: "See which files are ready to save.",
    example: "git status",
    tone: "blue",
  },
  {
    command: "git add .",
    description: "Stage all changed files for a commit.",
    example: "git add .",
    tone: "purple",
  },
  {
    command: "git commit",
    description: "Save a snapshot with a message.",
    example: 'git commit -m "Add profile card"',
    tone: "green",
  },
  {
    command: "git log",
    description: "Read the history of saved snapshots.",
    example: "git log --oneline",
    tone: "orange",
  },
]

const initialLines: TerminalLine[] = [
  { kind: "output", text: "Connect a GitHub repository to begin." },
  { kind: "output", text: "Your commands will work against its selected branch." },
]

function promptLine(text: string): TerminalLine {
  return { kind: "command", text }
}

function App() {
  const { theme, setTheme } = useTheme()
  const [input, setInput] = useState("")
  const [lines, setLines] = useState<TerminalLine[]>(initialLines)
  const [staged, setStaged] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [activeTab, setActiveTab] = useState<"guide" | "files">("guide")
  const [repoUrl, setRepoUrl] = useState("")
  const [token, setToken] = useState("")
  const [repository, setRepository] = useState<Repository | null>(null)
  const [files, setFiles] = useState<RepoFile[]>([])
  const [selectedPath, setSelectedPath] = useState("")
  const [commitMessage, setCommitMessage] = useState("Update from git started")
  const [connectionState, setConnectionState] = useState<"idle" | "loading" | "connected" | "error">("idle")
  const [connectionMessage, setConnectionMessage] = useState("")
  const [isPushing, setIsPushing] = useState(false)
  const [modal, setModal] = useState<"new-file" | "delete-file" | null>(null)
  const [newFilePath, setNewFilePath] = useState("")

  const selectedFile = files.find((file) => file.path === selectedPath && !file.deleted)
  const changedFiles = files.filter((file) => file.deleted || file.content !== file.originalContent)
  const stagedFiles = changedFiles.filter((file) => file.staged)
  const repositoryFiles = repository
    ? files.map((file) => ({ name: file.path, status: file.deleted ? "deleted" : file.content !== file.originalContent ? "modified" : "loaded", color: "blue" }))
    : []

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
    if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`
    return headers
  }

  function parseRepositoryUrl(value: string) {
    try {
      const url = new URL(value.trim())
      if (url.hostname !== "github.com") return null
      const parts = url.pathname.split("/").filter(Boolean)
      if (parts.length < 2) return null
      return { owner: parts[0], name: parts[1].replace(/\.git$/, "") }
    } catch {
      return null
    }
  }

  async function connectRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseRepositoryUrl(repoUrl)
    if (!parsed) {
      setConnectionState("error")
      setConnectionMessage("Enter a GitHub URL like https://github.com/owner/repository.")
      return
    }

    setConnectionState("loading")
    setConnectionMessage("Loading repository files...")
    try {
      const repoResponse = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.name}`, { headers: authHeaders() })
      if (!repoResponse.ok) throw new Error(repoResponse.status === 404 ? "Repository not found or token has no access." : "GitHub could not load this repository.")
      const repoData = await repoResponse.json() as { default_branch: string; html_url: string }
      const treeResponse = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.name}/git/trees/${repoData.default_branch}?recursive=1`, { headers: authHeaders() })
      if (!treeResponse.ok) throw new Error("Could not read the repository tree.")
      const treeData = await treeResponse.json() as { tree: Array<{ path: string; type: string; sha: string; size?: number }> }
      const sourceFiles = treeData.tree.filter((item) => item.type === "blob" && (item.size ?? 0) <= 200_000).slice(0, 40)
      const loadedFiles = await Promise.all(sourceFiles.map(async (file) => {
        const response = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.name}/contents/${file.path}?ref=${encodeURIComponent(repoData.default_branch)}`, { headers: authHeaders() })
        if (!response.ok) throw new Error(`Could not load ${file.path}.`)
        const data = await response.json() as { content?: string; encoding?: string }
        const content = data.encoding === "base64" && data.content ? decodeBase64(data.content) : ""
          return { path: file.path, sha: file.sha, content, originalContent: content, size: file.size ?? content.length, staged: false, deleted: false }
      }))
      setRepository({ ...parsed, branch: repoData.default_branch, url: repoData.html_url })
      setFiles(loadedFiles)
      setSelectedPath(loadedFiles[0]?.path ?? "")
      setActiveTab("files")
      setConnectionState("connected")
      setConnectionMessage(`${loadedFiles.length} text files loaded from ${repoData.default_branch}.`)
      setLines([{ kind: "success", text: `Connected to ${parsed.owner}/${parsed.name}` }, { kind: "output", text: `On branch ${repoData.default_branch}. Ready to edit.` }])
    } catch (error) {
      setConnectionState("error")
      setConnectionMessage(error instanceof Error ? error.message : "Could not connect to GitHub.")
    }
  }

  function decodeBase64(value: string) {
    const bytes = Uint8Array.from(atob(value.replace(/\n/g, "")), (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  function updateSelectedFile(content: string) {
    if (!selectedPath) return
    setFiles((current) => current.map((file) => file.path === selectedPath ? { ...file, content } : file))
  }

  function createFile() {
    if (!repository) return
    setNewFilePath("")
    setModal("new-file")
  }

  function confirmCreateFile() {
    const path = newFilePath.trim()
    if (!path || files.some((file) => file.path === path)) return
    const newFile: RepoFile = { path, sha: "", content: "", originalContent: "", size: 0, staged: false, deleted: false }
    setFiles((current) => [...current, newFile])
    setSelectedPath(path)
    setActiveTab("files")
    setModal(null)
    setNewFilePath("")
  }

  function deleteSelectedFile() {
    if (!selectedFile) return
    setModal("delete-file")
  }

  function confirmDeleteFile() {
    if (!selectedFile) return
    setFiles((current) => current.map((file) => file.path === selectedFile.path ? { ...file, deleted: true, staged: false } : file))
    setSelectedPath("")
    setModal(null)
  }

  function toggleFileStaged(path: string) {
    setFiles((current) => current.map((file) => file.path === path ? { ...file, staged: !file.staged } : file))
  }

  async function pushCommit() {
    if (!repository || !token.trim() || stagedFiles.length === 0) return
    setIsPushing(true)
    setConnectionMessage("Creating commit on GitHub...")
    try {
      const headers = { ...authHeaders(), "Content-Type": "application/json" }
      const refResponse = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/ref/heads/${repository.branch}`, { headers })
      if (!refResponse.ok) throw new Error("Could not read the branch reference.")
      const refData = await refResponse.json() as { object: { sha: string } }
      const commitResponse = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/commits/${refData.object.sha}`, { headers })
      const commitData = await commitResponse.json() as { tree: { sha: string } }
      const treeEntries = await Promise.all(stagedFiles.map(async (file) => {
        if (file.deleted) return { path: file.path, mode: "100644", type: "blob", sha: null }
        const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/blobs`, {
          method: "POST", headers, body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
        })
        if (!response.ok) throw new Error(`Could not prepare ${file.path}.`)
        const data = await response.json() as { sha: string }
        return { path: file.path, mode: "100644", type: "blob", sha: data.sha }
      }))
      const treeResponse = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/trees`, {
        method: "POST", headers, body: JSON.stringify({ base_tree: commitData.tree.sha, tree: treeEntries }),
      })
      if (!treeResponse.ok) throw new Error("Could not create the Git tree.")
      const treeData = await treeResponse.json() as { sha: string }
      const newCommitResponse = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/commits`, {
        method: "POST", headers, body: JSON.stringify({ message: commitMessage || "Update from git started", tree: treeData.sha, parents: [refData.object.sha] }),
      })
      if (!newCommitResponse.ok) throw new Error("Could not create the commit.")
      const newCommit = await newCommitResponse.json() as { sha: string }
      const updateResponse = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/refs/heads/${repository.branch}`, {
        method: "PATCH", headers, body: JSON.stringify({ sha: newCommit.sha }),
      })
      if (!updateResponse.ok) throw new Error("Commit was created but the branch could not be updated.")
      setFiles((current) => current.filter((file) => !file.deleted).map((file) => file.staged ? { ...file, originalContent: file.content, staged: false, sha: newCommit.sha } : file))
      setCommitted(true)
      setStaged(false)
      setConnectionMessage(`Committed ${stagedFiles.length} file${stagedFiles.length === 1 ? "" : "s"} to ${repository.branch}.`)
      setLines((current) => [...current, { kind: "success", text: `[${repository.branch} ${newCommit.sha.slice(0, 7)}] ${commitMessage}` }])
    } catch (error) {
      setConnectionState("error")
      setConnectionMessage(error instanceof Error ? error.message : "Could not push the commit.")
    } finally {
      setIsPushing(false)
    }
  }

  function runCommand(rawCommand: string) {
    const command = rawCommand.trim()
    if (!command) return

    const nextLines: TerminalLine[] = [...lines, promptLine(command)]
    const normalized = command.toLowerCase()

    if (normalized === "clear") {
      setLines([])
      setInput("")
      return
    }

    if (!repository) {
      nextLines.push({
        kind: "error",
        text: "Connect a real GitHub repository above before running Git commands.",
      })
      setLines(nextLines)
      setInput("")
      return
    }

    if (normalized === "help") {
      nextLines.push({
        kind: "output",
        text: "Try: git status, git add ., git commit -m \"...\", git log",
      })
    } else if (normalized === "git status") {
      nextLines.push(
        { kind: "output", text: "On branch main" },
        { kind: "output", text: stagedFiles.length > 0 ? "Changes to be committed:" : "Changes not staged for commit:" },
        {
          kind: stagedFiles.length > 0 ? "success" : "output",
          text: stagedFiles.length > 0
            ? `  staged: ${stagedFiles.map((file) => `${file.deleted ? "deleted " : ""}${file.path}`).join(", ")}`
            : `  modified: ${changedFiles.map((file) => file.path).join(", ") || "none"}`,
        }
      )
    } else if (normalized === "git add ." || normalized === "git add --all") {
      setFiles((current) => current.map((file) => file.content !== file.originalContent ? { ...file, staged: true } : file))
      setStaged(true)
      nextLines.push({
        kind: "success",
        text: "Files staged! They are ready to be committed.",
      })
    } else if (normalized.startsWith("git add ")) {
      const path = command.slice("git add ".length).trim()
      const file = files.find((candidate) => candidate.path === path)
      if (!file) {
        nextLines.push({ kind: "error", text: `pathspec '${path}' did not match any file` })
      } else {
        setFiles((current) => current.map((candidate) => candidate.path === path ? { ...candidate, staged: true } : candidate))
        nextLines.push({ kind: "success", text: `Staged ${path}` })
      }
    } else if (normalized.startsWith("git rm ")) {
      const path = command.slice("git rm ".length).trim()
      const file = files.find((candidate) => candidate.path === path && !candidate.deleted)
      if (!file) {
        nextLines.push({ kind: "error", text: `pathspec '${path}' did not match any file` })
      } else {
        setFiles((current) => current.map((candidate) => candidate.path === path ? { ...candidate, deleted: true, staged: true } : candidate))
        nextLines.push({ kind: "success", text: `Staged deletion of ${path}` })
      }
    } else if (normalized.startsWith("git restore --staged ") || normalized.startsWith("git reset head ")) {
      const prefixLength = normalized.startsWith("git restore --staged ") ? "git restore --staged ".length : "git reset head ".length
      const path = command.slice(prefixLength).trim()
      const file = files.find((candidate) => candidate.path === path)
      if (!file) {
        nextLines.push({ kind: "error", text: `pathspec '${path}' did not match any file` })
      } else {
        setFiles((current) => current.map((candidate) => candidate.path === path ? { ...candidate, staged: false } : candidate))
        nextLines.push({ kind: "success", text: `Unstaged ${path}` })
      }
    } else if (normalized.startsWith("git commit")) {
      if (!staged) {
        nextLines.push({
          kind: "error",
          text: "nothing added to commit — try git add . first",
        })
      } else if (!repository || stagedFiles.length === 0) {
        nextLines.push({
          kind: "error",
          text: "No changed files are ready to commit.",
        })
      } else {
        void pushCommit()
        nextLines.push({ kind: "output", text: "Sending the commit to GitHub..." })
      }
    } else if (normalized === "git log" || normalized === "git log --oneline") {
      nextLines.push(
        { kind: "output", text: "7f3a2c1 (HEAD -> main) Save profile card" },
        { kind: "output", text: "a12d9e0 Start profile card" }
      )
    } else {
      nextLines.push({
        kind: "error",
        text: `command not found: ${command.split(" ")[0]}. Try help`,
      })
    }

    setLines(nextLines)
    setInput("")
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    runCommand(input)
  }

  return (
    <main className="app-shell">
      <div className="app-glow app-glow-one" />
      <div className="app-glow app-glow-two" />
      <section className="phone-layout">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <span />
              <span />
              <span />
            </div>
            <div>
              <p className="eyebrow">LEARN BY DOING</p>
              <h1>git started</h1>
            </div>
          </div>
          <button
            className="icon-button"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☼" : "◐"}
          </button>
        </header>

        <div className="content">
          <section className="connect-card">
            <div className="connect-heading">
              <div className="repo-icon">↗</div>
              <div><p className="repo-label">REAL REPOSITORY</p><h3>{repository ? `${repository.owner}/${repository.name}` : "Connect a GitHub repo"}</h3></div>
            </div>
            <form className="connect-form" onSubmit={connectRepository}>
              <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo" aria-label="GitHub repository URL" />
              <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="GitHub token (session only)" aria-label="GitHub token" type="password" />
              <button type="submit" disabled={connectionState === "loading"}>{connectionState === "loading" ? "Loading..." : repository ? "Reload repo" : "Connect"}</button>
            </form>
            <p className={`connection-message ${connectionState}`}>{connectionMessage || "Use a fine-grained token with Contents: Read and write permission. It is never stored."}</p>
          </section>

          {repository && <section className="repo-card">
            <div className="repo-topline">
              <div className="repo-icon">⌘</div>
              <div>
                <p className="repo-label">PRACTICE REPOSITORY</p>
                <h3>{repository ? repository.name : "profile-card"} <span className="private-pill">{repository ? repository.branch : "SIMULATED"}</span></h3>
              </div>
              <button className="more-button" aria-label="Repository options">•••</button>
            </div>
            <div className="repo-meta">
              <span><i className="dot green-dot" /> GitHub connected</span>
              <span>{repository?.branch ?? "main"} branch</span>
              <span>{committed ? "1 commit" : "0 commits"}</span>
            </div>
          </section>}

          <section className="terminal-card">
            <div className="terminal-header">
              <div className="window-dots"><i /><i /><i /></div>
              <span>TERMINAL <b>•</b> profile-card</span>
              <button onClick={() => setLines([])} aria-label="Clear terminal">⌫</button>
            </div>
            <div className="terminal-body" role="log" aria-live="polite">
              {lines.map((line, index) => (
                <div className={`terminal-line ${line.kind}`} key={`${line.text}-${index}`}>
                  {line.kind === "command" && <span className="terminal-prompt">$</span>}
                  <span>{line.text}</span>
                </div>
              ))}
              <form className="terminal-input-row" onSubmit={handleSubmit}>
                <span className="terminal-prompt">$</span>
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  aria-label="Terminal command"
                  placeholder="type a git command..."
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!repository}
                />
                <button type="submit" className="run-button" aria-label="Run command" disabled={!repository}>↵</button>
              </form>
            </div>
          </section>

          <div className="section-tabs">
            <button className={activeTab === "guide" ? "active" : ""} onClick={() => setActiveTab("guide")}>
              <span>☷</span> Command guide
            </button>
            <button className={activeTab === "files" ? "active" : ""} onClick={() => setActiveTab("files")}>
              <span>▱</span> Files <b>{repositoryFiles.length}</b>
            </button>
          </div>

          {activeTab === "guide" ? (
            <section className="command-list">
              {commandCards.map((card) => (
                <button className="command-card" key={card.command} onClick={() => setInput(card.example)}>
                  <div className={`command-icon ${card.tone}`}>{card.command === "git status" ? "⌁" : card.command === "git add ." ? "+" : card.command === "git commit" ? "✓" : "↺"}</div>
                  <div className="command-copy">
                    <strong>{card.command}</strong>
                    <span>{card.description}</span>
                    <code>{card.example}</code>
                  </div>
                  <span className="card-arrow">›</span>
                </button>
              ))}
              <p className="tip"><span>✦</span> Tap a command to load it into the terminal</p>
            </section>
          ) : (
            <section className="files-panel">
              {!repository && (
                <div className="empty-files">
                  <div className="repo-icon">↗</div>
                  <h3>Connect a GitHub repository</h3>
                  <p>Files will appear here after you connect a real repository above.</p>
                </div>
              )}
              {repository && <>
              <div className="files-heading">
                <div><p className="eyebrow">WORKING TREE</p><h3>Your repository files</h3></div>
                <div className="files-actions"><span className="file-count">{repositoryFiles.length} files</span><button className="new-file-button" onClick={createFile}>+ New file</button></div>
              </div>
              <div className="file-picker">
                <label htmlFor="repository-file">Select file to edit</label>
                <select id="repository-file" value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)}>
                  {repositoryFiles.map((file) => (
                    <option key={file.name} value={file.name}>{file.name} — {files.find((candidate) => candidate.path === file.name)?.staged ? "staged" : file.status}</option>
                  ))}
                </select>
              </div>
              {selectedFile && repository && (
                <div className="editor">
                  <div className="editor-heading">
                    <strong>Editing {selectedFile.path}</strong>
                    <div className="editor-actions">
                      {selectedFile.content !== selectedFile.originalContent && (
                        <button className={`stage-toggle ${selectedFile.staged ? "unstage" : ""}`} onClick={() => toggleFileStaged(selectedFile.path)}>
                          {selectedFile.staged ? "Unstage" : "Stage"}
                        </button>
                      )}
                      <button className="delete-file-button" onClick={deleteSelectedFile}>Delete</button>
                    </div>
                  </div>
                  <textarea value={selectedFile.content} onChange={(event) => updateSelectedFile(event.target.value)} aria-label={`Edit ${selectedFile.path}`} />
                  <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" aria-label="Commit message" />
                  <button className="push-button" onClick={() => void pushCommit()} disabled={isPushing || stagedFiles.length === 0 || !token.trim()}>{isPushing ? "Pushing..." : `Commit ${stagedFiles.length} staged file${stagedFiles.length === 1 ? "" : "s"} to GitHub`}</button>
                </div>
              )}
              <p className="files-note">{repository ? "Changes are held in memory until you commit. GitHub receives only the files you explicitly push." : "Connect a GitHub repository above to load and edit real files."}</p>
              </>}
            </section>
          )}
        </div>

        {modal && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
            <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
              {modal === "new-file" ? (
                <>
                  <p className="eyebrow accent">REPOSITORY FILE</p>
                  <h2 id="modal-title">Create a new file</h2>
                  <p className="modal-copy">Choose a path for the new file. It will stay staged locally until you commit it.</p>
                  <input className="modal-input" value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} placeholder="example.js" autoFocus />
                  {newFilePath.trim() && files.some((file) => file.path === newFilePath.trim()) && <p className="modal-error">A file with this path already exists.</p>}
                  <div className="modal-actions">
                    <button className="modal-secondary" onClick={() => setModal(null)}>Cancel</button>
                    <button className="modal-primary" onClick={confirmCreateFile} disabled={!newFilePath.trim() || files.some((file) => file.path === newFilePath.trim())}>Create file</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="eyebrow danger-eyebrow">DELETE FILE</p>
                  <h2 id="modal-title">Delete {selectedFile?.path}?</h2>
                  <p className="modal-copy">This file will be marked for deletion. The real GitHub repository will not change until you stage and commit this deletion.</p>
                  <div className="modal-actions">
                    <button className="modal-secondary" onClick={() => setModal(null)}>Keep file</button>
                    <button className="modal-danger" onClick={confirmDeleteFile}>Delete file</button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
