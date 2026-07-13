'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Editor' },
  { href: '/library', label: 'Library' },
]

export default function Nav() {
  const path = usePathname()
  if (path === '/') return null // editor is full-bleed; it has its own floating chrome
  return (
    <nav className="flex items-center justify-between border-b border-white/10 bg-zinc-950 px-4 py-2">
      <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span className="h-2.5 w-2.5 rounded-full bg-lime-300" />
        reel <span className="font-normal text-zinc-500">— browser video editor</span>
      </h1>
      <div className="flex gap-1">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              path === l.href
                ? 'bg-lime-300 font-semibold text-zinc-900'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
