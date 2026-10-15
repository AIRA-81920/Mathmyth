import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import { memo, useMemo } from 'react'
import { normalizeMathContent } from './mathContent.js'
import { splitStreamingMarkdown } from './streamingMarkdown.js'

const remarkPlugins = [remarkMath, remarkGfm]
const rehypePlugins = [[rehypeKatex, { throwOnError: false, strict: 'ignore', errorColor: 'currentColor', trust: false }]]
const previewComponents = { a: ({ children }) => <span>{children}</span> }

const MarkdownBlock = memo(function MarkdownBlock({ text, staticLinks = false }) {
  return <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={staticLinks ? previewComponents : undefined} skipHtml>{normalizeMathContent(text)}</Markdown>
})

export default function MathMarkdown({ children, streaming = false, staticLinks = false }) {
  const text = String(children ?? '')
  const checkpoint = useMemo(() => streaming ? splitStreamingMarkdown(text) : null, [text, streaming])
  return (
    <div className="math-markdown">
      {checkpoint ? <>{checkpoint.blocks.map((block, index) => <MarkdownBlock key={index} text={block} staticLinks={staticLinks} />)}
        {checkpoint.pending && <span className="markdown-pending">{checkpoint.pending}</span>}</> : <MarkdownBlock text={text} staticLinks={staticLinks} />}
    </div>
  )
}
