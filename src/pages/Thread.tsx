import { Head, Link, usePage } from '@inertiajs/react'
import { Layout } from "@/components/Layout"

interface Thread {
  id: string
  title: string
  content: string
  created_at: string
  boards: {
    slug: string
    name: string
  }
}

interface Post {
  id: string
  content: string
  created_at: string
  profiles: {
    username: string
    is_anonymous: boolean
  } | null
}

interface ThreadProps {
  thread: Thread
  posts: Post[]
}

const Thread = () => {
  const { props } = usePage<ThreadProps>()
  const { thread, posts } = props

  return (
    <Layout>
      <Head title={`${thread.title} — ${thread.boards.name} — gomo6 имиджборд`} />

      <main className="max-w-4xl mx-auto p-3 sm:p-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Link href="/" className="text-primary hover:underline">
              Главная
            </Link>
            <span className="text-muted-foreground">/</span>
            <Link href={`/${thread.boards.slug}`} className="text-primary hover:underline">
              /{thread.boards.slug}/
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-bold">{thread.title}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{thread.title}</h1>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Тред: {thread.title}</h2>
          <p className="text-muted-foreground">Контент треда будет загружен...</p>
        </div>

        <div className="bg-card border border-border p-6">
          <h3 className="text-lg font-bold mb-4">Ответы ({posts.length})</h3>
          {posts.length === 0 ? (
            <p className="text-muted-foreground">Пока нет ответов</p>
          ) : (
            <p className="text-muted-foreground">Ответы будут загружены...</p>
          )}
        </div>
      </main>
    </Layout>
  )
}

export default Thread