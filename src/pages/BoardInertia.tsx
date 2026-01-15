import { useEffect, useState, useRef } from "react"
import { Head, Link, usePage } from '@inertiajs/react'
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { ru } from "date-fns/locale"
import { ImageUpload } from "@/components/ImageUpload"
import { UserBadge } from "@/components/UserBadge"
import { InlineFormattingToolbar } from "@/components/InlineFormattingToolbar"
import { LinkButton } from "@/components/LinkButton"
import { PentagramLoader } from "@/components/PentagramLoader"
import { Layout } from "@/components/Layout"
import { supabase } from "@/integrations/supabase/client"
import { renderPreviewContent } from "@/utils/emojiUtils.tsx"

interface Board {
  id: string
  slug: string
  name: string
  description: string
  is_rules_board: boolean
}

interface Thread {
  id: string
  title: string
  content: string
  image_url: string | null
  created_at: string
  updated_at: string
  post_count: number
  user_id: string | null
  profiles: {
    username: string
    is_anonymous: boolean
  } | null
  latest_post?: {
    content: string
    created_at: string
    is_private: boolean
    user_id: string | null
    profiles: {
      username: string
      is_anonymous: boolean
    } | null
  }
}

// Function to check if content contains visibility tags
const hasVisibilityTags = (content: string): boolean => {
  return content.includes('[seeusers=') || content.includes('[nousers=') || content.includes('[adm]')
}

interface BoardProps {
  board: Board
  threads: Thread[]
}

const BoardInertia = () => {
  const { props } = usePage<BoardProps>()
  const { board, threads } = props

  const [user, setUser] = useState<any>(null)
  const [isModerator, setIsModerator] = useState(false)
  const [currentUserUsername, setCurrentUserUsername] = useState("")
  const [currentUserColor, setCurrentUserColor] = useState("")
  const [showNewThread, setShowNewThread] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)

      if (session?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id)

        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false)

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
          .single()

        if (profile) {
          setCurrentUserUsername(profile.username)
        }

        // Load current user color
        const { data: achievements } = await supabase
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", session.user.id)

        if (achievements) {
          const colorRewards = achievements
            .filter((a: any) => a.achievements?.reward_type === "username_color")
            .map((a: any) => a.achievements.reward_value)

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan']
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p)
              break
            }
          }
        }
      }
    }
    checkAuth()
  }, [])

  const handleCreateThread = async () => {
    if (!user || !title.trim() || !content.trim()) return

    setLoading(true)
    try {
      // Create the thread
      const { data: threadData, error: threadError } = await supabase
        .from("threads")
        .insert({
          title: title.trim(),
          content: content.trim(),
          board_id: board.id,
          user_id: user.id,
          image_url: imageUrls.length > 0 ? imageUrls[0] : null,
        })
        .select()
        .single()

      if (threadError) throw threadError

      // Create the first post (OP post)
      const { error: postError } = await supabase
        .from("posts")
        .insert({
          thread_id: threadData.id,
          content: content.trim(),
          user_id: user.id,
          image_url: imageUrls.length > 0 ? imageUrls[0] : null,
        })

      if (postError) throw postError

      toast.success("Тред создан!")
      setShowNewThread(false)
      setTitle("")
      setContent("")
      setImageUrls([])

      // Navigate to the new thread
      window.location.href = `/${board.slug}/thread/${threadData.id}`

    } catch (error) {
      console.error("Error creating thread:", error)
      toast.error("Ошибка при создании треда")
    } finally {
      setLoading(false)
    }
  }

  const formatContent = (text: string) => {
    return renderPreviewContent(text, false, false, false)
  }

  return (
    <Layout>
      <Head title={`/${board.slug}/ - ${board.name} — gomo6 имиджборд`} />

      <main className="max-w-4xl mx-auto p-3 sm:p-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Link href="/" className="text-primary hover:underline">
              Главная
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-bold">/{board.slug}/</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{board.name}</h1>
          <p className="text-muted-foreground">{board.description}</p>
        </div>

        {/* New Thread Button */}
        {user && (
          <div className="mb-6">
            <Button
              onClick={() => setShowNewThread(!showNewThread)}
              className="w-full sm:w-auto"
              variant={showNewThread ? "secondary" : "default"}
            >
              {showNewThread ? "Отменить" : "Создать тред"}
            </Button>
          </div>
        )}

        {/* New Thread Form */}
        {showNewThread && user && (
          <div className="bg-card border border-border p-6 mb-6">
            <h3 className="text-lg font-bold mb-4">Создать новый тред</h3>

            <div className="space-y-4">
              <div>
                <Input
                  placeholder="Заголовок треда"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <InlineFormattingToolbar
                  textareaRef={contentTextareaRef}
                  onContentChange={setContent}
                />
                <Textarea
                  ref={contentTextareaRef}
                  placeholder="Содержание треда..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[120px] mt-2"
                />
              </div>

              <div>
                <ImageUpload
                  onImagesChange={setImageUrls}
                  maxImages={1}
                  currentImages={imageUrls}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleCreateThread}
                  disabled={loading || !title.trim() || !content.trim()}
                >
                  {loading ? "Создание..." : "Создать тред"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNewThread(false)
                    setTitle("")
                    setContent("")
                    setImageUrls([])
                  }}
                >
                  Отмена
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Threads List */}
        <div className="space-y-4">
          {threads.map((thread) => (
            <div key={thread.id} className="bg-card border border-border p-4">
              <div className="flex gap-4">
                {/* Thread Image */}
                {thread.image_url && (
                  <div className="flex-shrink-0">
                    <img
                      src={thread.image_url}
                      alt=""
                      className="w-20 h-20 object-cover border border-border"
                    />
                  </div>
                )}

                {/* Thread Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <Link
                      href={`/${board.slug}/thread/${thread.id}`}
                      className="text-lg font-bold hover:text-primary transition-colors line-clamp-2"
                    >
                      {thread.title}
                    </Link>
                    <div className="text-sm text-muted-foreground flex-shrink-0">
                      {formatDistanceToNow(new Date(thread.updated_at), {
                        addSuffix: true,
                        locale: ru
                      })}
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground mb-2">
                    <UserBadge
                      userId={thread.user_id}
                      username={thread.profiles?.username}
                      isAnonymous={thread.profiles?.is_anonymous}
                      color={currentUserColor}
                      currentUserId={user?.id}
                    />
                    <span className="mx-2">•</span>
                    <span>{thread.post_count} ответов</span>
                  </div>

                  <div className="text-sm line-clamp-3">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: formatContent(thread.content)
                      }}
                    />
                  </div>

                  {/* Latest Post Preview */}
                  {thread.latest_post && thread.post_count > 1 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="text-xs text-muted-foreground mb-1">
                        Последний ответ от{" "}
                        <UserBadge
                          userId={thread.latest_post.user_id}
                          username={thread.latest_post.profiles?.username}
                          isAnonymous={thread.latest_post.profiles?.is_anonymous}
                          color={currentUserColor}
                          currentUserId={user?.id}
                        />
                        {" "}
                        {formatDistanceToNow(new Date(thread.latest_post.created_at), {
                          addSuffix: true,
                          locale: ru
                        })}
                      </div>
                      <div className="text-sm line-clamp-2 opacity-75">
                        <div
                          dangerouslySetInnerHTML={{
                            __html: formatContent(thread.latest_post.content)
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex justify-end">
                <LinkButton
                  href={`/${board.slug}/thread/${thread.id}`}
                  variant="ghost"
                  size="sm"
                >
                  Ответить →
                </LinkButton>
              </div>
            </div>
          ))}
        </div>

        {threads.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg mb-2">В этой доске пока нет тредов</p>
            <p>Будьте первым, кто создаст обсуждение!</p>
          </div>
        )}
      </main>
    </Layout>
  )
}

export default BoardInertia