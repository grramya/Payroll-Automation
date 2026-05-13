# Session Rules (Token Efficiency)

Follow these rules for every session in this project:

1. **Model**: Use Sonnet unless explicitly asked for Opus.
2. **File reads**: Only read files directly relevant to the current task — no broad exploration unless asked.
3. **Agents**: Avoid spawning subagents for tasks doable with Grep, Glob, or Read directly.
4. **Parallel agents**: Do not run multiple agents in parallel unless explicitly requested.
5. **Context**: Do not reload or re-read files already read in this session.
6. **Responses**: Keep responses concise — no long summaries, no restating what you just did.
7. **Tools**: Prefer Grep/Glob over Bash find/grep. Prefer Edit over full file rewrites.

