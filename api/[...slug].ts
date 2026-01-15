import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export default async function handler(req, res) {
  const { slug } = req.query

  if (!Array.isArray(slug)) {
    return res.status(400).json({ error: 'Invalid slug' })
  }

  const [boardSlug, ...rest] = slug

  try {
    if (rest.length === 0) {
      // Board page
      const { data: board, error: boardError } = await supabase
        .from('boards')
        .select('*')
        .eq('slug', boardSlug)
        .single()

      if (boardError || !board) {
        return res.status(404).json({ error: 'Board not found' })
      }

      // Get threads for this board
      const { data: threads, error: threadsError } = await supabase
        .from('threads')
        .select(`
          id,
          title,
          content,
          image_url,
          created_at,
          updated_at,
          post_count,
          user_id,
          profiles (
            username,
            is_anonymous
          ),
          latest_post:posts!threads_latest_post_id_fkey (
            content,
            created_at,
            is_private,
            user_id,
            profiles (
              username,
              is_anonymous
            )
          )
        `)
        .eq('board_id', board.id)
        .order('updated_at', { ascending: false })
        .limit(50)

      if (threadsError) {
        console.error('Threads error:', threadsError)
      }

      return res.status(200).json({
        component: 'Board',
        props: {
          board,
          threads: threads || [],
          auth: {} // Will be handled by frontend
        }
      })

    } else if (rest[0] === 'thread' && rest[1]) {
      // Thread page
      const threadId = rest[1]

      const { data: thread, error: threadError } = await supabase
        .from('threads')
        .select(`
          *,
          boards (
            slug,
            name
          ),
          profiles (
            username,
            is_anonymous
          )
        `)
        .eq('id', threadId)
        .single()

      if (threadError || !thread) {
        return res.status(404).json({ error: 'Thread not found' })
      }

      // Get posts for this thread
      const { data: posts, error: postsError } = await supabase
        .from('posts')
        .select(`
          *,
          profiles (
            username,
            is_anonymous
          )
        `)
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })

      if (postsError) {
        console.error('Posts error:', postsError)
      }

      return res.status(200).json({
        component: 'Thread',
        props: {
          thread,
          posts: posts || [],
          auth: {} // Will be handled by frontend
        }
      })
    }

    return res.status(404).json({ error: 'Not found' })

  } catch (error) {
    console.error('API Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}