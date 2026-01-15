import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export default async function handler(req, res) {
  // Handle Inertia requests - return JSON for SPA navigation
  const isInertiaRequest = req.headers['x-inertia'] || req.headers['x-requested-with'] === 'XMLHttpRequest'

  try {
    // Get data for the index page
    const { data: boards } = await supabase
      .from("boards")
      .select("*")
      .eq("is_rules_board", false)
      .order("created_at", { ascending: true })

    const { data: popularThreads } = await supabase
      .from("threads")
      .select(`
        id,
        title,
        post_count,
        board_id,
        boards!inner(slug, name)
      `)
      .order("post_count", { ascending: false })
      .limit(5)

    // Get random threads
    const { data: randomThreads } = await supabase
      .from("threads")
      .select(`
        id,
        title,
        board_id,
        boards!inner(slug)
      `)
      .limit(100)

    let randomThread = null
    if (randomThreads && randomThreads.length > 0) {
      const randomIndex = Math.floor(Math.random() * randomThreads.length)
      randomThread = randomThreads[randomIndex]
    }

    // Filter out /faq/ and /bugs/ boards from the main list
    const filteredBoards = boards?.filter(board => board.slug !== 'faq' && board.slug !== 'bugs') || []

    // Get 2 random boards
    const shuffled = [...filteredBoards].sort(() => 0.5 - Math.random())
    const randomBoards = shuffled.slice(0, 2)

    console.log('API /index: Returning data for', filteredBoards.length, 'boards')

    return res.status(200).json({
      component: 'Index',
      props: {
        boards: filteredBoards,
        randomBoards,
        randomThread,
        popularThreads: popularThreads || [],
        auth: {} // Will be handled by frontend
      }
    })

  } catch (error) {
    console.error('API Error:', error)
    // Return fallback data instead of 500 error
    return res.status(200).json({
      component: 'Index',
      props: {
        boards: [],
        randomBoards: [],
        randomThread: null,
        popularThreads: [],
        auth: {}
      }
    })
  }
}