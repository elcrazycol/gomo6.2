import { Head, Link, usePage } from '@inertiajs/react'
import { Button } from "@/components/ui/button"
import { PentagramLoader } from "@/components/PentagramLoader"
import { Layout } from "@/components/Layout"

interface Board {
  id: string
  slug: string
  name: string
  description: string
}

interface RandomThread {
  id: string
  title: string
  board_id: string
  boards: {
    slug: string
  }
}

interface PopularThread {
  id: string
  title: string
  post_count: number
  board_id: string
  boards: {
    slug: string
    name: string
  }
}

interface IndexProps {
  boards: Board[]
  randomBoards: Board[]
  randomThread: RandomThread | null
  popularThreads: PopularThread[]
}

const Index = () => {
  const { props } = usePage<IndexProps>()

  const { boards, randomBoards, randomThread, popularThreads } = props

  return (
    <Layout>
      <Head title="gomo6.wtf — gomo6 имиджборд" />

      <main className="max-w-4xl mx-auto p-3 sm:p-6">
        <div className="text-center mb-6 sm:mb-8">
        </div>

        <div className="mb-4 text-center flex gap-3 justify-center flex-wrap">
          <Link href="/rules">
            <Button variant="outline" className="relative hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors group">
              Информация
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>
          </Link>

          <Link href="/bugs">
            <Button variant="outline" className="relative hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors group">
              Баги/Идеи
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>
          </Link>

          <Link href="/faq">
            <Button variant="outline" className="relative hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors group">
              FAQ
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>
          </Link>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Доски</h3>
          <div className="space-y-3">
            {boards.map((board) => (
              <Link
                key={board.id}
                href={`/${board.slug}`}
                className="block p-4 border border-border hover:bg-thread-hover transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="relative flex-1">
                    <h4 className="text-lg font-bold text-primary relative inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                      /{board.slug}/
                      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </h4>
                    <p className="text-base font-semibold transition-transform duration-200 group-hover:translate-x-0.5">{board.name}</p>
                    <p className="text-sm text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5">{board.description}</p>
                  </div>
                  <div className="text-primary transition-transform duration-200 group-hover:translate-x-0.5">→</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Популярные треды</h3>
          <div className="space-y-2">
            {popularThreads.map((thread) => (
              <Link
                key={thread.id}
                href={`/${thread.boards.slug}/thread/${thread.id}`}
                className="block p-3 border border-border hover:bg-thread-hover transition-all duration-200 group"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 relative">
                    <div className="font-bold relative inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                      {thread.title}
                      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </div>
                    <div className="text-sm text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5">
                      /{thread.boards.slug}/ - {thread.boards.name}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground ml-2 transition-transform duration-200 group-hover:translate-x-0.5">
                    {thread.post_count} отв.
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Случайность</h3>
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Случайные доски:</h4>
              <div className="space-y-2">
                {randomBoards.map((board) => (
                  <Link
                    key={board.id}
                    href={`/${board.slug}`}
                    className="block p-3 border border-border hover:bg-thread-hover transition-all duration-200 group relative"
                  >
                    <div className="font-bold text-primary relative inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                      /{board.slug}/ - {board.name}
                      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {randomThread && (
              <div>
                <h4 className="font-semibold mb-2">Случайный тред:</h4>
                <Link
                  href={`/${randomThread.boards.slug}/thread/${randomThread.id}`}
                  className="block p-3 border border-border hover:bg-thread-hover transition-all duration-200 group"
                >
                  <div className="font-bold relative inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                    {randomThread.title}
                    <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </div>
      </main>
    </Layout>
  )
}

export default Index