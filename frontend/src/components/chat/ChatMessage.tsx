import { useMemo, type ReactNode } from 'react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

const CHART_COLORS = ['#400f61', '#7b2d9a', '#b45fd0', '#d4a0e8', '#f0d6f7', '#2d0a45']

// ── Chart renderer ─────────────────────────────────────────────────────────────

interface ChartSpec {
  chart_type: string
  title: string
  purpose?: string
  x_axis: { label: string; values: string[] }
  y_axis: { label: string }
  series: { name: string; data: number[] }[]
  insights?: string[]
  business_value?: string
}

function ChartRenderer({ spec }: { spec: ChartSpec }) {
  const { chart_type, title, x_axis, y_axis, series, insights } = spec

  const data = x_axis.values.map((x, i) => {
    const row: Record<string, unknown> = { x }
    series.forEach(s => { row[s.name] = s.data[i] ?? 0 })
    return row
  })

  const isPie = chart_type === 'pie' || chart_type === 'donut'
  const pieData = isPie
    ? (series[0]?.data ?? []).map((val, i) => ({ name: x_axis.values[i] ?? `Item ${i}`, value: val }))
    : []

  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text)' }}>{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        {isPie ? (
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              innerRadius={chart_type === 'donut' ? 40 : 0}
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              labelLine={false}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        ) : chart_type === 'scatter' ? (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="x" name={x_axis.label} tick={{ fontSize: 11 }} />
            <YAxis name={y_axis.label} tick={{ fontSize: 11 }} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Legend />
            {series.map((s, i) => (
              <Scatter key={s.name} name={s.name} data={data.map(d => ({ x: d.x, y: d[s.name] }))} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </ScatterChart>
        ) : chart_type === 'area' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="x" label={{ value: x_axis.label, position: 'insideBottom', offset: -2, fontSize: 11 }} tick={{ fontSize: 11 }} />
            <YAxis label={{ value: y_axis.label, angle: -90, position: 'insideLeft', fontSize: 11 }} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s, i) => (
              <Area key={s.name} type="monotone" dataKey={s.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.15} strokeWidth={2} dot={false} />
            ))}
          </AreaChart>
        ) : chart_type === 'bar' || chart_type === 'stacked_bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis label={{ value: y_axis.label, angle: -90, position: 'insideLeft', fontSize: 11 }} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={CHART_COLORS[i % CHART_COLORS.length]} stackId={chart_type === 'stacked_bar' ? 'stack' : undefined} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          /* default: line */
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis label={{ value: y_axis.label, angle: -90, position: 'insideLeft', fontSize: 11 }} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s, i) => (
              <Line key={s.name} type="monotone" dataKey={s.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
      {insights && insights.length > 0 && (
        <ul style={{ margin: '8px 0 0 0', padding: '0 0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
          {insights.map((ins, i) => <li key={i} style={{ marginBottom: 2 }}>{ins}</li>)}
        </ul>
      )}
    </div>
  )
}

// ── Inline markdown renderer ───────────────────────────────────────────────────

function inlineFormat(text: string): ReactNode {
  const parts: ReactNode[] = []
  // patterns: **bold**, *italic*, `code`
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[2] != null) parts.push(<strong key={match.index}>{match[2]}</strong>)
    else if (match[3] != null) parts.push(<em key={match.index}>{match[3]}</em>)
    else if (match[4] != null) parts.push(<code key={match.index} style={{ background: '#f3f0f7', padding: '1px 4px', borderRadius: 3, fontSize: '0.9em', fontFamily: 'monospace' }}>{match[4]}</code>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function renderMarkdownBlock(block: string, key: number): ReactNode {
  const trimmed = block.trim()
  if (!trimmed) return null

  // Headings
  const h3 = trimmed.match(/^### (.+)/)
  if (h3) return <h3 key={key} style={{ fontSize: 13, fontWeight: 700, margin: '10px 0 4px', color: 'var(--p)' }}>{inlineFormat(h3[1])}</h3>
  const h2 = trimmed.match(/^## (.+)/)
  if (h2) return <h2 key={key} style={{ fontSize: 14, fontWeight: 700, margin: '12px 0 4px', color: 'var(--p)' }}>{inlineFormat(h2[1])}</h2>
  const h1 = trimmed.match(/^# (.+)/)
  if (h1) return <h1 key={key} style={{ fontSize: 15, fontWeight: 700, margin: '12px 0 6px', color: 'var(--p)' }}>{inlineFormat(h1[1])}</h1>

  // Markdown table — every line starts with |
  const lines = trimmed.split('\n')
  if (lines.length >= 2 && lines[0].startsWith('|') && lines[1].match(/^\|[\s\-|]+\|$/)) {
    const headers = lines[0].split('|').filter(c => c.trim()).map(c => c.trim())
    const rows = lines.slice(2).filter(l => l.startsWith('|')).map(l =>
      l.split('|').filter(c => c.trim()).map(c => c.trim())
    )
    return (
      <div key={key} style={{ overflowX: 'auto', margin: '8px 0' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>{headers.map((h, i) => (
              <th key={i} style={{ border: '1px solid #d4d0da', padding: '4px 8px', background: '#f5eefa', color: 'var(--p)', textAlign: 'left', fontWeight: 600 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: '1px solid #d4d0da', padding: '4px 8px' }}>{inlineFormat(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // Unordered list
  if (lines.every(l => l.match(/^[-*•] /))) {
    return (
      <ul key={key} style={{ margin: '4px 0', paddingLeft: 18 }}>
        {lines.map((l, i) => (
          <li key={i} style={{ marginBottom: 2 }}>{inlineFormat(l.replace(/^[-*•] /, ''))}</li>
        ))}
      </ul>
    )
  }

  // Ordered list
  if (lines.every(l => l.match(/^\d+\. /))) {
    return (
      <ol key={key} style={{ margin: '4px 0', paddingLeft: 18 }}>
        {lines.map((l, i) => (
          <li key={i} style={{ marginBottom: 2 }}>{inlineFormat(l.replace(/^\d+\. /, ''))}</li>
        ))}
      </ol>
    )
  }

  // Mixed list (some bullet, some ordered — render as bullets)
  if (lines.some(l => l.match(/^[-*•\d]/) && !l.match(/^\d{4}/))) {
    return (
      <ul key={key} style={{ margin: '4px 0', paddingLeft: 18 }}>
        {lines.map((l, i) => (
          <li key={i} style={{ marginBottom: 2 }}>{inlineFormat(l.replace(/^[-*•] /, '').replace(/^\d+\. /, ''))}</li>
        ))}
      </ul>
    )
  }

  // Default paragraph
  return (
    <p key={key} style={{ margin: '4px 0', lineHeight: 1.6 }}>
      {inlineFormat(trimmed)}
    </p>
  )
}

function renderMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = []
  // Split out fenced code blocks (```lang ... ```)
  const parts = text.split(/(```[\s\S]*?```)/g)

  parts.forEach((part, pi) => {
    const fenceMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/)
    if (fenceMatch) {
      const lang = fenceMatch[1]
      const code = fenceMatch[2].trim()

      if (lang === 'chart') {
        try {
          const spec: ChartSpec = JSON.parse(code)
          nodes.push(<ChartRenderer key={pi} spec={spec} />)
          return
        } catch { /* fall through to code block */ }
      }

      nodes.push(
        <pre key={pi} style={{
          background: '#1a1a2e', color: '#e8e8f0', padding: '10px 14px',
          borderRadius: 6, fontSize: 12, overflowX: 'auto', margin: '8px 0',
          fontFamily: 'monospace', lineHeight: 1.5,
        }}>
          <code>{code}</code>
        </pre>
      )
      return
    }

    // Split remaining text into paragraph blocks and render each
    const blocks = part.split(/\n{2,}/)
    blocks.forEach((block, bi) => {
      const node = renderMarkdownBlock(block, pi * 1000 + bi)
      if (node) nodes.push(node)
    })
  })

  return <>{nodes}</>
}

// ── ChatMessage component ──────────────────────────────────────────────────────

export default function ChatMessage({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user'

  const rendered = useMemo(() => {
    if (isUser) return <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
    return renderMarkdown(msg.content)
  }, [msg.content, isUser])

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--p)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, marginRight: 8, marginTop: 2, fontSize: 13, color: '#fff', fontWeight: 700,
        }}>
          AI
        </div>
      )}
      <div style={{
        maxWidth: '88%',
        padding: '9px 13px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
        background: isUser ? 'var(--p)' : '#f5f5f5',
        color: isUser ? '#fff' : 'var(--text)',
        fontSize: 13,
        lineHeight: 1.55,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        {rendered}
      </div>
    </div>
  )
}
