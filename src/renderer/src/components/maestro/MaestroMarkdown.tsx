type MaestroMarkdownProps = { content: string }

function renderInline(text: string): React.JSX.Element {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={`${part}-${index}`}
              className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]"
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
        }
        return <span key={`${part}-${index}`}>{part}</span>
      })}
    </>
  )
}

export function MaestroMarkdown({ content }: MaestroMarkdownProps): React.JSX.Element {
  const lines = content.slice(0, 64 * 1024).split('\n')
  return (
    <div className="space-y-2 text-sm leading-6 text-foreground">
      {lines.map((line, index) => {
        const key = `${index}-${line}`
        if (line.startsWith('# ')) {
          return (
            <h1 key={key} className="text-base font-semibold">
              {renderInline(line.slice(2))}
            </h1>
          )
        }
        if (line.startsWith('## ')) {
          return (
            <h2 key={key} className="text-sm font-semibold">
              {renderInline(line.slice(3))}
            </h2>
          )
        }
        if (line.startsWith('- ')) {
          return (
            <li key={key} className="ml-4 list-disc pl-1">
              {renderInline(line.slice(2))}
            </li>
          )
        }
        return line.trim() ? (
          <p key={key}>{renderInline(line)}</p>
        ) : (
          <div key={key} className="h-1" aria-hidden />
        )
      })}
    </div>
  )
}
