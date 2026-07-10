'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Editor' },
  { href: '/library', label: 'Library' },
]

export default function Nav() {
  const path = usePathname()
  return (
    <nav className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950 px-4 py-2">
      <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
        reel <span className="font-normal text-zinc-500">— browser video editor</span>
      </h1>
      <div className="flex gap-1">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              path === l.href ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
